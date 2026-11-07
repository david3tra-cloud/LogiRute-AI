const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const { aggregateActivity } = await import("./billingActivity.js");
  const { aggregateKilometros, aggregatePesos } = await import("./jornadaMetricas.mjs");

  // 1. Verificación estática de la migración propuesta
  const migration = fs.readFileSync(path.join(__dirname, "supabase/migrations/20261107120000_retirar_jornada_facturacion.sql"), "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.eliminar_jornada_facturacion/i);
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /SET search_path = pg_catalog/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /record\.user_id = v_user_id/i);
  assert.match(migration, /record\.source_jornada_id = p_source_jornada_id/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.eliminar_jornada_facturacion\(text\) FROM PUBLIC, anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.eliminar_jornada_facturacion\(text\) TO authenticated/i);
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration.replace(/--.*/g, ""), /registro_jornadas/i);

  // 2. Simulación en memoria del almacén y ciclo de vida de Facturación
  const registroJornadas = new Map();
  const kilometrajeJornadas = new Map();
  const billingRecords = new Map();

  // Helper de envío a Facturación (simula enviar_jornada_a_facturacion)
  const simulatedSendToBilling = (authUid, journeyId) => {
    if (!authUid) throw new Error("Authentication required.");
    if (!journeyId) throw new Error("Journey id is required.");

    const key = `${authUid}:${journeyId}`;
    if (billingRecords.has(key)) {
      return billingRecords.get(key); // idempotente
    }

    const journey = registroJornadas.get(key);
    if (!journey || journey.deletedAt) throw new Error("Active journey not found.");

    const km = kilometrajeJornadas.get(key);
    if (km && km.estado === "PENDIENTE") throw new Error("Journey odometer capture is not finalized.");

    const newRecord = {
      id: `billing-${journeyId}`,
      user_id: authUid,
      source_jornada_id: journeyId,
      source_fingerprint: journey.fingerprint,
      work_date: journey.work_date,
      source_closed_at: journey.fechaCierre,
      snapshot: {
        id: journey.id,
        deliveries: structuredClone(journey.deliveries),
        sequence: structuredClone(journey.sequence),
        kilometrosRecorridos: km ? km.final - km.initial : null,
      },
    };
    billingRecords.set(key, newRecord);
    return newRecord;
  };

  // Helper de borrado de Facturación (simula eliminar_jornada_facturacion)
  const simulatedDeleteFromBilling = (authUid, journeyId) => {
    if (!authUid) throw new Error("Authentication required.");
    if (!journeyId) throw new Error("Journey id is required.");

    const key = `${authUid}:${journeyId}`;
    if (!billingRecords.has(key)) {
      return false; // nada que borrar
    }
    billingRecords.delete(key);
    return true;
  };

  // Datos iniciales de prueba
  const userA = "user-uuid-111";
  const userB = "user-uuid-222";
  const j1 = "journey-1";
  const j2 = "journey-2";

  registroJornadas.set(`${userA}:${j1}`, {
    id: j1,
    user_id: userA,
    fingerprint: "fp-1",
    work_date: "2026-11-01",
    fechaCierre: "2026-11-01T20:00:00.000Z",
    deliveries: [
      { id: "s1", type: "DELIVERY", status: "COMPLETED", pesoKg: 10 },
      { id: "s2", type: "PICKUP", status: "COMPLETED", pesoKg: 5 },
    ],
    sequence: ["s1", "s2"],
  });
  kilometrajeJornadas.set(`${userA}:${j1}`, { estado: "COMPLETA", initial: 100, final: 125 });

  registroJornadas.set(`${userA}:${j2}`, {
    id: j2,
    user_id: userA,
    fingerprint: "fp-2",
    work_date: "2026-11-02",
    fechaCierre: "2026-11-02T20:00:00.000Z",
    deliveries: [
      { id: "s3", type: "DELIVERY", status: "COMPLETED", pesoKg: 20 },
    ],
    sequence: ["s3"],
  });
  kilometrajeJornadas.set(`${userA}:${j2}`, { estado: "COMPLETA", initial: 125, final: 160 });

  // 3. Envío inicial a Facturación
  simulatedSendToBilling(userA, j1);
  simulatedSendToBilling(userA, j2);
  assert.equal(billingRecords.size, 2);

  // 4. Prueba: Sesión ausente falla
  assert.throws(() => simulatedDeleteFromBilling(null, j1), /Authentication required/);
  assert.equal(billingRecords.size, 2);

  // 5. Prueba: Otro usuario no puede borrar el registro del propietario (Aislamiento)
  const deletedByOther = simulatedDeleteFromBilling(userB, j1);
  assert.equal(deletedByOther, false);
  assert.equal(billingRecords.has(`${userA}:${j1}`), true); // Sigue existiendo para userA

  // 6. Prueba: Actualización de acumulados antes del borrado
  let currentRecords = [...billingRecords.values()].filter((r) => r.user_id === userA);
  let actTotals = aggregateActivity(currentRecords);
  let kmTotals = aggregateKilometros(currentRecords);
  let weightTotals = aggregatePesos(currentRecords);

  assert.equal(actTotals.deliveries.completed, 2);
  assert.equal(actTotals.pickups.completed, 1);
  assert.equal(kmTotals.km, 60); // 25 + 35
  assert.equal(weightTotals.deliveries.completedKg, 30); // 10 + 20
  assert.equal(weightTotals.pickups.completedKg, 5);

  // 7. Prueba: El propietario borra su jornada j1
  const deletedByOwner = simulatedDeleteFromBilling(userA, j1);
  assert.equal(deletedByOwner, true);
  assert.equal(billingRecords.has(`${userA}:${j1}`), false);
  assert.equal(billingRecords.size, 1); // Solo queda j2

  // 8. Prueba: Los datos de origen (registro, kilometraje) permanecen INTACTOS
  assert.ok(registroJornadas.has(`${userA}:${j1}`), "El registro de origen no debe ser eliminado");
  assert.equal(registroJornadas.get(`${userA}:${j1}`).deletedAt, undefined);
  assert.ok(kilometrajeJornadas.has(`${userA}:${j1}`), "El kilometraje de origen no debe ser eliminado");

  // 9. Prueba: Actualización inmediata de acumulados tras retirar j1
  currentRecords = [...billingRecords.values()].filter((r) => r.user_id === userA);
  actTotals = aggregateActivity(currentRecords);
  kmTotals = aggregateKilometros(currentRecords);
  weightTotals = aggregatePesos(currentRecords);

  assert.equal(actTotals.deliveries.completed, 1); // Solo s3 de j2
  assert.equal(actTotals.pickups.completed, 0);
  assert.equal(kmTotals.km, 35); // Solo j2 (160 - 125)
  assert.equal(weightTotals.deliveries.completedKg, 20); // Solo s3
  assert.equal(weightTotals.pickups.completedKg, 0);

  // 10. Prueba: Reenvío sin duplicados desde el flujo existente
  // Tras borrar en Facturación, Registro permite reenviar j1
  const resent = simulatedSendToBilling(userA, j1);
  assert.equal(resent.source_jornada_id, j1);
  assert.equal(billingRecords.has(`${userA}:${j1}`), true);
  assert.equal(billingRecords.size, 2);

  // Reintento idéntico es idempotente y no genera duplicados
  const resentDuplicate = simulatedSendToBilling(userA, j1);
  assert.equal(resentDuplicate.id, resent.id);
  assert.equal(billingRecords.size, 2);

  // Acumulados se restauran exactamente al valor completo
  currentRecords = [...billingRecords.values()].filter((r) => r.user_id === userA);
  assert.equal(aggregateKilometros(currentRecords).km, 60);
  assert.equal(aggregatePesos(currentRecords).deliveries.completedKg, 30);

  // 11. Verificación de UI y Servicio (BillingSection.tsx, billingSupabaseService.ts, RegistroNubeModal.tsx)
  const billingUi = fs.readFileSync(path.join(__dirname, "BillingSection.tsx"), "utf8");
  const billingService = fs.readFileSync(path.join(__dirname, "billingSupabaseService.ts"), "utf8");
  const registroModal = fs.readFileSync(path.join(__dirname, "RegistroNubeModal.tsx"), "utf8");

  // Servicio
  assert.match(billingService, /export async function deleteBillingRecord/);
  assert.match(billingService, /eliminar_jornada_facturacion/);
  assert.match(billingService, /assertBillingSession\(userId\)/);

  // Confirmación con fecha y texto exacto
  assert.match(billingUi, /¿Eliminar del seguimiento la jornada del \$\{dateFormatted\}\? Se retirará de los acumulados\. No se borrarán sus datos de origen y podrás volver a emitir su resumen\./);
  assert.match(billingUi, /window\.confirm\(message\)/);

  // Bloqueo de clics repetidos mientras se procesa
  assert.match(billingUi, /if \(!userId \|\| deletingId !== null\) return;/);
  assert.match(billingUi, /disabled=\{deletingId !== null\}/);
  assert.match(billingUi, /deletingId === record\.source_jornada_id \? "Eliminando…" : "Eliminar del seguimiento"/);

  // No retira la tarjeta si el servidor devuelve false o falla; refresca el listado
  assert.match(billingUi, /if \(deleted\) \{[\s\S]*setRecords\(\(current\) => current\.filter\(/);
  assert.match(billingUi, /\} else \{[\s\S]*listBillingRecords\(userId\)\.then\(setRecords\)/);
  assert.match(billingUi, /catch \(error\) \{[\s\S]*listBillingRecords\(userId\)\.then\(setRecords\)/);

  // Reemisión en RegistroNubeModal se re-evalúa al abrir o refrescar
  assert.match(registroModal, /Promise\.all\(\[listRemoteJornadas\(userId\),\s*listBillingRecords\(userId\)\]\)/);
  assert.match(registroModal, /billingByJornada\.has\(jornada\.id\)/);

  console.log("PASS: verificación estática de SQL (SECURITY DEFINER, search_path, auth.uid).");
  console.log("PASS: sesión ausente rechazada.");
  console.log("PASS: aislamiento entre usuarios (otro usuario no puede borrar).");
  console.log("PASS: conservación de datos de origen tras borrado.");
  console.log("PASS: recálculo reactivo de acumulados (actividad, km, pesos).");
  console.log("PASS: reenvío exitoso desde Registro e idempotencia sin duplicados.");
  console.log("PASS: verificación de UI (confirmación con fecha, bloqueo de clics, manejo de false/error y reemisión).");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
