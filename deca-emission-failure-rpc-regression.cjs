const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const migration = readFileSync(
  resolve(
    __dirname,
    "supabase/migrations/20261111190000_deca_identity_and_emission_recovery.sql",
  ),
  "utf8",
);
const normalizedMigration = migration.replace(/\s+/g, " ");
const functionBody = normalizedMigration.match(
  /CREATE OR REPLACE FUNCTION public\.record_deca_emission_failure\([\s\S]*?\$function\$;/i,
)?.[0];

assert.ok(functionBody, "the protected SQL function must be present");
assert.match(functionBody, /SECURITY DEFINER/i);
assert.match(functionBody, /SET search_path = pg_catalog/i);
assert.match(functionBody, /v_user_id uuid := auth\.uid\(\)/i);
assert.match(functionBody, /deca\.user_id = v_user_id/i);
assert.match(functionBody, /deca\.deleted_at IS NULL/i);
assert.match(functionBody, /deca\.estado = 'EMITIENDO'/i);
assert.match(
  functionBody,
  /deca\.emission_request_id = p_emission_request_id/i,
);
assert.match(
  functionBody,
  /SET estado = 'BORRADOR'[\s\S]*?emission_request_id = NULL[\s\S]*?emission_started_at = NULL[\s\S]*?emission_error = v_error_message/i,
);
assert.match(
  normalizedMigration,
  /REVOKE ALL ON FUNCTION public\.record_deca_emission_failure\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/i,
);
assert.match(
  normalizedMigration,
  /GRANT EXECUTE ON FUNCTION public\.record_deca_emission_failure\(uuid, uuid, text\) TO authenticated/i,
);

const simulateFunction = (row, authenticatedUserId, input) => {
  if (
    !row ||
    authenticatedUserId === null ||
    row.user_id !== authenticatedUserId ||
    row.deleted_at !== null ||
    row.estado !== "EMITIENDO" ||
    row.emission_request_id !== input.requestId
  ) {
    return null;
  }
  row.estado = "BORRADOR";
  row.emission_request_id = null;
  row.emission_started_at = null;
  row.emission_error = input.message.trim().slice(0, 2000);
  return { ...row };
};

const baseInput = {
  decaId: "deca-1",
  requestId: "request-current",
  message: "Fallo confirmado",
};
const makeRow = (overrides = {}) => ({
  id: "deca-1",
  user_id: "user-1",
  deleted_at: null,
  estado: "EMITIENDO",
  emission_request_id: "request-current",
  emission_started_at: "2026-11-11T12:00:00.000Z",
  emission_error: null,
  ...overrides,
});

{
  const row = makeRow({ user_id: "user-2" });
  assert.equal(simulateFunction(row, "user-1", baseInput), null);
  assert.equal(row.estado, "EMITIENDO");
}
console.log("PASS (simulada): una ficha de otro usuario no se libera.");

{
  const row = makeRow();
  assert.equal(
    simulateFunction(row, "user-1", {
      ...baseInput,
      requestId: "request-old",
    }),
    null,
  );
  assert.equal(row.estado, "EMITIENDO");
  assert.equal(row.emission_request_id, "request-current");
}
console.log("PASS (simulada): un token antiguo no modifica la reserva vigente.");

{
  const row = makeRow({
    estado: "EMITIDO",
    emission_request_id: "request-current",
  });
  assert.equal(simulateFunction(row, "user-1", baseInput), null);
  assert.equal(row.estado, "EMITIDO");
}
console.log("PASS (simulada): un DeCA ya emitido no vuelve a borrador.");

{
  const row = makeRow();
  const updated = simulateFunction(row, "user-1", baseInput);
  assert.equal(updated.estado, "BORRADOR");
  assert.equal(updated.emission_request_id, null);
  assert.equal(updated.emission_started_at, null);
  assert.equal(updated.emission_error, "Fallo confirmado");
}
console.log("PASS (simulada): la liberación válida registra el motivo y limpia la reserva.");

console.log(
  "Las comprobaciones de migración anteriores inspeccionan SQL local; las cuatro pruebas de comportamiento son simuladas y no sustituyen PostgreSQL/Supabase.",
);
