const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  const { madridWorkDate, aggregateActivity } = await import("./billingActivity.js");
  const migration = fs.readFileSync("supabase/migrations/20261031150000_billing_daily_records.sql", "utf8");
  const service = fs.readFileSync("billingSupabaseService.ts", "utf8");
  const types = fs.readFileSync("types.ts", "utf8");

  assert.equal(madridWorkDate("2026-03-31T21:59:00.000Z"), "2026-03-31");
  assert.equal(madridWorkDate("2026-03-31T22:30:00.000Z"), "2026-04-01");
  assert.equal(madridWorkDate("2026-10-31T22:30:00.000Z"), "2026-10-31");
  assert.equal(madridWorkDate("2026-11-01T00:30:00.000Z"), "2026-11-01");

  const record = (deliveries) => ({ snapshot: { deliveries } });
  const totals = aggregateActivity([
    record([{ type: "DELIVERY", status: "COMPLETED" }, { type: "DELIVERY", status: "ISSUE" }, { type: "PICKUP", status: "PENDING" }]),
    record([{ type: "PICKUP", status: "COMPLETED" }]),
  ]);
  assert.deepEqual(totals, {
    deliveries: { planned: 2, completed: 1 },
    pickups: { planned: 2, completed: 1 },
    complete: true,
  });
  assert.deepEqual(aggregateActivity([record([])]), {
    deliveries: { planned: 0, completed: 0 }, pickups: { planned: 0, completed: 0 }, complete: true,
  });
  assert.equal(aggregateActivity([{ snapshot: {} }]).complete, false);
  assert.match(types, /interface Delivery\s*\{[\s\S]*?coordinates\?:\s*\[number, number\]/);
  assert.doesNotMatch(types.match(/interface Delivery\s*\{([^}]*)\}/)[1], /kilomet|peso|kilo/i);

  // Local model simulation only: database atomicity and the live RPC are not exercised here.
  const uniqueRows = new Map();
  const simulatedSend = (userId, journey) => {
    if (journey.deleted) throw new Error("deleted journey");
    const key = `${userId}:${journey.id}`;
    if (!uniqueRows.has(key)) uniqueRows.set(key, { ...journey, userId, snapshot: structuredClone(journey) });
    return uniqueRows.get(key);
  };
  const first = { id: "j-1", fingerprint: "fp", deleted: false, deliveries: [{ type: "DELIVERY", status: "COMPLETED" }] };
  const sent = simulatedSend("user-a", first); // first response is lost
  const retried = simulatedSend("user-a", first); // double click/retry returns one row
  assert.equal(sent, retried);
  assert.equal(uniqueRows.size, 1);
  const otherOwner = simulatedSend("user-b", first);
  assert.notEqual(otherOwner, sent);
  assert.equal(uniqueRows.size, 2);
  first.deleted = true; // deleting source after send leaves the independent snapshot
  assert.equal(uniqueRows.get("user-a:j-1").snapshot.deleted, false);
  assert.throws(() => simulatedSend("user-a", { id: "j-2", deleted: true }));

  assert.match(migration, /UNIQUE \(user_id, source_jornada_id\)/i);
  assert.match(migration, /journey\.user_id = v_user_id AND journey\.id = p_jornada_id/i);
  assert.match(migration, /v_jornada\.deleted_at IS NOT NULL/i);
  assert.match(migration, /AT TIME ZONE 'Europe\/Madrid'/i);
  assert.match(migration, /ON CONFLICT \(user_id, source_jornada_id\) DO NOTHING/i);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
  assert.doesNotMatch(migration, /FOR UPDATE TO authenticated/i);
  assert.match(service, /assertBillingSession\(userId\)/);
  console.log("PASS: fechas Europe/Madrid, corte mensual, acumulados y datos disponibles.");
  console.log("SIMULATED: unicidad/reintento, aislamiento, conservación tras borrado y rechazo de jornada eliminada.");
  console.log("STATIC ONLY: la migración contiene las barreras esperadas; la RPC real no fue ejecutada ni validada.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
