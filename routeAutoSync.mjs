export function decideRouteSync(base, local, remote, localEmpty) {
  if (remote && local === remote.fingerprint) return "adopt";
  if (!base) {
    if (!remote) return "push";
    return localEmpty ? "pull" : "conflict";
  }
  if (!remote) return "conflict";
  if (local === base.fingerprint) return "pull";
  if (remote.revision === base.revision && remote.fingerprint === base.fingerprint) return "push";
  return "conflict";
}
const baseKey = uid => `logiroute_auto_base_v1:${uid}`;
export function readAutoBase(uid, storage) {
  const raw = storage.getItem(baseKey(uid));
  if (raw === null) return null;
  const b = JSON.parse(raw);
  if (!b || b.userId !== uid || !Number.isSafeInteger(b.revision) || b.revision < 1 || typeof b.fingerprint !== "string") throw new Error("Base de sincronización inválida. Se requiere revisión; no se sobrescriben datos.");
  return b;
}
export function writeAutoBase(uid, row, fingerprint, storage) {
  if (row.user_id !== uid || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Propietario o revisión de nube inválidos.");
  readAutoBase(uid, storage);
  storage.setItem(baseKey(uid), JSON.stringify({ userId: uid, revision: row.revision, fingerprint }));
}
export async function syncRouteStep(c) {
  if (!c.isCurrent() || c.isBlocked()) return { kind: "paused" };
  const baseline = c.readBase();
  const local = JSON.parse(JSON.stringify(c.getLocal()));
  const fp = c.fingerprint(local.deliveries, local.sequence);
  const row = await c.load();
  if (!c.isCurrent() || c.isBlocked()) return { kind: "paused" };
  if (row && row.user_id !== c.userId) throw new Error("La ruta recibida pertenece a otra cuenta.");
  const current = c.getLocal();
  if (c.fingerprint(current.deliveries, current.sequence) !== fp) return { kind: "defer" };
  const remote = row ? { revision: row.revision, fingerprint: c.fingerprint(row.deliveries, row.sequence) } : null;
  const decision = decideRouteSync(baseline, fp, remote, local.deliveries.length === 0 && local.sequence.length === 0);
  if (decision === "conflict") return { kind: "conflict", row };
  if (decision === "adopt") { c.accept(row); return { kind: "adopt", row }; }
  if (decision === "pull") {
    c.backup();
    if (!c.isCurrent() || c.isBlocked()) return { kind: "paused" };
    if (!c.apply(row)) throw new Error("No se pudo guardar la ruta recibida en este dispositivo.");
    c.accept(row);
    return { kind: "pull", row };
  }
  const saved = await c.save(local.deliveries, local.sequence, row?.revision ?? null);
  if (!c.isCurrent() || c.isBlocked()) return { kind: "paused" };
  if (!saved || saved.user_id !== c.userId) throw new Error("Respuesta de guardado inválida o de otra cuenta.");
  c.accept(saved);
  return { kind: "push", row: saved };
}
