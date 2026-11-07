const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTs(file, imports = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    if (!(id in imports)) throw new Error(`Import not allowed: ${id}`);
    return imports[id];
  }, module, module.exports);
  return module.exports;
}

async function main() {
  const metrics = await import("./jornadaMetricas.mjs");
  const { DeliveryStatus, DeliveryType } = {
    DeliveryStatus: { PENDING: "PENDING", COMPLETED: "COMPLETED", ISSUE: "ISSUE", IN_PROGRESS: "IN_PROGRESS", CANCELLED: "CANCELLED" },
    DeliveryType: { DELIVERY: "DELIVERY", PICKUP: "PICKUP" },
  };
  const snapshot = loadTs("routeSnapshotStorage.ts", {
    "./types": { DeliveryStatus, DeliveryType },
    "./destinatariosService": { userStorageKey: (key, user) => `${key}:${user}` },
  });
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const emptyRoute = () => ({ deliveries: [], sequence: [] });

  assert.deepEqual(metrics.validateLecturasKm("", "0"), { ok: false, reason: "Introduce las lecturas inicial y final del cuentakilómetros." });
  assert.equal(metrics.parseLecturaKm("-1"), null);
  assert.equal(metrics.parseLecturaKm("1e3"), null);
  assert.equal(metrics.parseLecturaKm("0"), 0);
  assert.deepEqual(metrics.validateLecturasKm("1.234,5", "1300"), { ok: false, reason: "Las lecturas deben ser números válidos, iguales o superiores a cero." });
  assert.equal(metrics.validateLecturasKm("100,5", "130,75").distance, 30.25);
  assert.equal(metrics.validateLecturasKm("130", "100").ok, false);

  assert.equal(snapshot.saveRouteSnapshot("user-a", [], [], { kilometrajeInicial: "120.5", kilometrajeFinal: "", kilometrajeAsociacionPendiente: true }), true);
  const reloaded = snapshot.loadRouteSnapshot("user-a", emptyRoute);
  assert.equal(reloaded.kilometrajeInicial, "120.5");
  assert.equal(reloaded.kilometrajeFinal, "");
  assert.equal(reloaded.kilometrajeAsociacionPendiente, true);
  assert.equal(snapshot.loadRouteSnapshot("legacy-user", emptyRoute).kilometrajeInicial, undefined);

  const legacyDeCA = {
    id: "stop-a", decaId: "deca-a", sourceType: "DECA", type: "DELIVERY", status: "COMPLETED",
    recipient: "Destino", address: "Calle 1", notes: "Fecha: 31/10 · Mercancía: cajas · Bultos: 2 bultos · Peso: 45,5 kg · Matrícula: 1234ABC",
  };
  assert.equal(metrics.pesoKgDeParada(legacyDeCA), 45.5);
  assert.equal(metrics.pesoKgDeParada({ ...legacyDeCA, notes: "Ref 123 · caja 20 kg" }), null);
  assert.equal(metrics.pesoKgDeParada({ ...legacyDeCA, notes: "Peso: 10 kg · Peso: 20 kg" }), null);
  assert.equal(metrics.pesoKgDeParada({ ...legacyDeCA, pesoKg: 0, notes: "Peso: 20 kg" }), 0);
  assert.equal(metrics.pesoKgDeParada({ ...legacyDeCA, pesoKg: 8 }), 8);

  const activity = [{ snapshot: { deliveries: [
    legacyDeCA,
    { id: "stop-b", type: "DELIVERY", status: "ISSUE", pesoKg: null },
    { id: "stop-c", type: "PICKUP", status: "COMPLETED", pesoKg: 12 },
    { id: "stop-d", type: "PICKUP", status: "PENDING" },
  ] } }];
  const weights = metrics.aggregatePesos(activity);
  assert.equal(weights.deliveries.plannedKg, 45.5);
  assert.equal(weights.deliveries.completedKg, 45.5);
  assert.equal(weights.deliveries.plannedMissing, 1);
  assert.equal(weights.pickups.plannedKg, 12);
  assert.equal(weights.pickups.completedKg, 12);
  assert.equal(weights.pickups.plannedMissing, 1);
  assert.equal(metrics.aggregatePesos([{ snapshot: {} }]).missingSnapshots, 1);

  const snapshotOnly = { deliveries: [legacyDeCA, { id: "stop-b", type: "PICKUP", status: "PENDING" }], sequence: ["stop-b", "stop-a"] };
  assert.deepEqual(metrics.orderedStops(snapshotOnly).map((stop) => stop.id), ["stop-b", "stop-a"]);
  assert.equal(metrics.orderedStops(snapshotOnly)[1].notes, legacyDeCA.notes);
  const km = metrics.aggregateKilometros([
    { snapshot: { kilometrosRecorridos: 30.25 } },
    { snapshot: { kilometrosRecorridos: null } },
  ]);
  assert.deepEqual(km, { km: 30.25, missing: 1, total: 2 });

  const billingUi = fs.readFileSync(path.join(__dirname, "BillingSection.tsx"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "supabase/migrations/20261031170000_jornada_metricas.sql"), "utf8");
  assert.match(billingUi, /record\.snapshot\.deliveries/);
  assert.match(billingUi, /record\.snapshot\.deliveries\) \? record\.snapshot\.deliveries/);
  assert.match(billingUi, /Kilos de entregas:\s*\{dayWeights\.missingSnapshots > 0/);
  assert.match(billingUi, /Kilos de recogidas:\s*\{dayWeights\.missingSnapshots > 0/);
  assert.doesNotMatch(billingUi, /listRemoteJornadas/);
  assert.match(migration, /kilometros_recorridos numeric GENERATED ALWAYS/);
  assert.match(migration, /Journey odometer values are immutable/);
  assert.match(migration, /AFTER INSERT ON public\.registro_jornadas/);
  assert.match(migration, /estado = 'PENDIENTE'/);
  assert.doesNotMatch(migration, /updated_at\s*<=\s*v_jornada\.fecha_cierre/);
  assert.doesNotMatch(migration, /kilometraje_jornada_activa/);
  assert.match(fs.readFileSync(path.join(__dirname, "RouteCloudPanel.tsx"), "utf8"), /saveClosedJourneyKilometraje\([\s\S]*jornada\.id[\s\S]*marker\.kilometrajeInicial/);

  // State-machine simulation of the trigger, finalizer and invoice gate (not a live RPC test).
  const summaries = new Map();
  const captures = new Map();
  let failNextFinalizeForNetwork = true;
  const closeJourney = (id) => {
    if (!summaries.has(id)) {
      summaries.set(id, { deleted: false, closedAt: 100 });
      captures.set(id, { estado: "PENDIENTE", initial: null, final: null }); // insert trigger
    }
    return summaries.get(id);
  };
  const finalize = (id, initial, final) => {
    if (failNextFinalizeForNetwork) { failNextFinalizeForNetwork = false; throw new Error("network lost before finalization"); }
    const previous = captures.get(id);
    if (previous?.estado === "COMPLETA") {
      if (previous.initial !== initial || previous.final !== final) throw new Error("immutable");
      return "COMPLETA";
    }
    const summary = summaries.get(id);
    if (!summary || summary.deleted) throw new Error("missing or deleted");
    if (!previous) {
      return "HISTORICA"; // rows predating the trigger never gain a capture retroactively
    }
    if (initial == null || final == null) throw new Error("both readings required");
    if (final < initial) throw new Error("invalid readings");
    captures.set(id, { estado: "COMPLETA", initial, final, capturedAt: 200 });
    return "COMPLETA";
  };
  const bill = (id) => {
    const existing = billing.get(id);
    if (existing) return existing;
    if (!summaries.has(id) || summaries.get(id).deleted) throw new Error("journey unavailable");
    if (captures.get(id)?.estado === "PENDIENTE") throw new Error("capture pending");
    const capture = captures.get(id);
    const snapshot = { kilometrosRecorridos: capture?.estado === "COMPLETA" ? capture.final - capture.initial : null };
    billing.set(id, snapshot);
    return snapshot;
  };
  const billing = new Map();

  closeJourney("journey-new");
  assert.throws(() => bill("journey-new"), /pending/); // invoice while final capture is outstanding
  assert.throws(() => finalize("journey-new", 100, 130), /network/); // network fails after summary before final capture
  assert.equal(closeJourney("journey-new"), summaries.get("journey-new")); // same closure ID recovers same summary
  assert.throws(() => finalize("journey-new", null, null), /both readings/); // new journey cannot skip
  assert.equal(finalize("journey-new", 100, 130), "COMPLETA"); // readings may be saved after close instant
  assert.equal(bill("journey-new").kilometrosRecorridos, 30);
  assert.equal(finalize("journey-new", 100, 130), "COMPLETA"); // identical retry
  assert.ok(captures.get("journey-new").capturedAt > summaries.get("journey-new").closedAt); // readings can finalize after closure instant
  assert.throws(() => finalize("journey-new", 100, 131), /immutable/);

  closeJourney("journey-other");
  assert.equal(finalize("journey-other", 500, 510), "COMPLETA");
  assert.equal(captures.get("journey-other").initial, 500); // explicit source journey key, no user-level date association
  assert.equal(captures.get("journey-new").initial, 100); // another journey's reading cannot be reused
  summaries.set("journey-deleted", { deleted: true });
  captures.set("journey-deleted", { estado: "PENDIENTE", initial: null, final: null });
  assert.throws(() => finalize("journey-deleted", 20, 25), /deleted/);
  assert.equal(finalize("journey-new", 100, 130), "COMPLETA"); // finalized retry remains idempotent after deletion
  summaries.get("journey-new").deleted = true;
  assert.equal(finalize("journey-new", 100, 130), "COMPLETA");

  summaries.set("journey-historical", { deleted: false }); // pre-trigger row has no capture state
  assert.equal(finalize("journey-historical", null, null), "HISTORICA");
  assert.equal(bill("journey-historical").kilometrosRecorridos, null);
  assert.equal(finalize("journey-historical", 10, 15), "HISTORICA"); // never backfills invented legacy odometers
  console.log("PASS: validación, persistencia local, histórico sin km y cálculo de diferencia.");
  console.log("PASS: detalle ordenado desde snapshot y extracción estricta de peso DeCA.");
  console.log("PASS: peso cero, ausente, ambiguo, duplicados, entregas/recogidas y actividad completada.");
  console.log("PASS: acumulado mensual de kilómetros marca jornadas ausentes; SQL revisado estáticamente.");
  console.log("SIMULATED: trigger-pendiente, cierre/reintento, factura bloqueada, histórico sin datos e idempotencia tras borrado.");
  console.log("STATIC/SIMULATED: no se llamaron RPC ni servicios remotos reales.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
