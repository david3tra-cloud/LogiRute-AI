import test from "node:test";
import assert from "node:assert/strict";
import { decideRouteSync, readAutoBase, writeAutoBase, syncRouteStep } from "./routeAutoSync.mjs";

const fp = (deliveries, sequence) => JSON.stringify({ deliveries, sequence });
const local = id => ({ deliveries: id ? [{ id }] : [], sequence: id ? [id] : [] });
const row = (id, revision = 1, user_id = "A") => ({ user_id, ...local(id), revision, updated_at: "2026-10-19T00:00:00Z" });
function fixture({ localId = "a", remoteId = "a", revision = 1, baseline = true } = {}) {
  let here = local(localId);
  let there = remoteId === null ? null : row(remoteId, revision);
  let base = baseline ? { userId: "A", revision, fingerprint: fp(...Object.values(local("a"))) } : null;
  let current = true, blocked = false, saves = 0, applies = 0, backups = 0, accepts = 0;
  const c = {
    userId: "A",
    isCurrent: () => current,
    isBlocked: () => blocked,
    readBase: () => base,
    getLocal: () => here,
    fingerprint: fp,
    load: async () => there,
    save: async (deliveries, sequence, expected) => {
      saves++;
      if (there ? there.revision !== expected : expected !== null) throw new Error("revision conflict");
      there = { user_id: "A", deliveries, sequence, revision: (there?.revision ?? 0) + 1, updated_at: "2026-10-19T00:00:00Z" };
      return there;
    },
    backup: () => { backups++; },
    apply: route => { applies++; here = { deliveries: route.deliveries, sequence: route.sequence }; return true; },
    accept: route => { accepts++; base = { userId: "A", revision: route.revision, fingerprint: fp(route.deliveries, route.sequence) }; },
  };
  return { c, setLocal: id => { here = local(id); }, setRemote: value => { there = value; }, setCurrent: value => { current = value; }, setBlocked: value => { blocked = value; }, state: () => ({ here, there, base, saves, applies, backups, accepts }) };
}

test("Coincidencia: adopta revisión sin escribir la ruta", async () => {
  const f = fixture(); assert.equal((await syncRouteStep(f.c)).kind, "adopt");
  assert.equal(f.state().saves, 0); assert.equal(f.state().applies, 0);
});
test("Cambio local: guarda automáticamente con revisión esperada", async () => {
  const f = fixture({ localId: "edited" });
  assert.equal((await syncRouteStep(f.c)).kind, "push");
  assert.equal(f.state().there.deliveries[0].id, "edited"); assert.equal(f.state().there.revision, 2);
});
test("Cambio remoto y local limpio: recibe automáticamente", async () => {
  const f = fixture({ remoteId: "b" }); f.setRemote(row("b", 2));
  assert.equal((await syncRouteStep(f.c)).kind, "pull");
  assert.equal(f.state().here.deliveries[0].id, "b"); assert.equal(f.state().backups, 1); assert.equal(f.state().saves, 0);
});
test("Cierre remoto: vacía copia limpia sin reintroducir paradas", async () => {
  const f = fixture(); f.setRemote(row("", 3));
  assert.equal((await syncRouteStep(f.c)).kind, "pull");
  assert.deepEqual(f.state().here, local("")); assert.equal(f.state().saves, 0);
});
test("Dos cambios diferentes: conflicto, sin sustituir ni guardar", async () => {
  const f = fixture({ localId: "local" }); f.setRemote(row("remote", 2));
  assert.equal((await syncRouteStep(f.c)).kind, "conflict");
  assert.equal(f.state().saves, 0); assert.equal(f.state().applies, 0);
});
test("Sin base y versiones no vacías distintas: no elige ganador", async () => {
  const f = fixture({ localId: "local", remoteId: "remote", baseline: false });
  assert.equal((await syncRouteStep(f.c)).kind, "conflict"); assert.equal(f.state().saves, 0);
});
test("Dispositivo nuevo vacío: carga ruta remota", async () => {
  const f = fixture({ localId: "", baseline: false });
  assert.equal((await syncRouteStep(f.c)).kind, "pull"); assert.equal(f.state().here.deliveries[0].id, "a");
});
test("Sin ruta en nube ni base: crea con revisión null", async () => {
  const f = fixture({ remoteId: null, baseline: false });
  assert.equal((await syncRouteStep(f.c)).kind, "push"); assert.equal(f.state().there.revision, 1);
});
test("Fila remota desaparecida con base anterior: no la recrea", async () => {
  const f = fixture({ remoteId: null });
  assert.equal((await syncRouteStep(f.c)).kind, "conflict"); assert.equal(f.state().saves, 0);
});
test("Edición durante lectura: difiere, sin guardar instantánea antigua", async () => {
  const f = fixture(); f.c.load = async () => { f.setLocal("new"); return row("a"); };
  assert.equal((await syncRouteStep(f.c)).kind, "defer"); assert.equal(f.state().saves, 0); assert.equal(f.state().applies, 0);
});
test("Edición durante escritura: confirma la enviada, no borra la posterior", async () => {
  const f = fixture({ localId: "edit1" }); const save = f.c.save;
  f.c.save = async (...args) => { const result = await save(...args); f.setLocal("edit2"); return result; };
  assert.equal((await syncRouteStep(f.c)).kind, "push");
  assert.equal(f.state().here.deliveries[0].id, "edit2");
  assert.equal(f.state().base.fingerprint, fp(...Object.values(local("edit1"))));
  f.c.save = save;
  assert.equal((await syncRouteStep(f.c)).kind, "push"); assert.equal(f.state().there.deliveries[0].id, "edit2");
});
test("Cambio de sesión durante lectura: no aplica ni reconoce datos", async () => {
  const f = fixture(); f.c.load = async () => { f.setCurrent(false); return row("b", 2); };
  assert.equal((await syncRouteStep(f.c)).kind, "paused"); assert.equal(f.state().applies, 0); assert.equal(f.state().accepts, 0);
});
test("Cambio de sesión después de guardar: no reconoce con otra cuenta", async () => {
  const f = fixture({ localId: "edited" }); const save = f.c.save;
  f.c.save = async (...args) => { const result = await save(...args); f.setCurrent(false); return result; };
  assert.equal((await syncRouteStep(f.c)).kind, "paused"); assert.equal(f.state().accepts, 0);
});
test("Cierre pendiente: no inicia consultas ni guardados", async () => {
  const f = fixture(); f.setBlocked(true); f.c.load = async () => { throw new Error("no debe llamarse"); };
  assert.equal((await syncRouteStep(f.c)).kind, "paused"); assert.equal(f.state().saves, 0);
});
test("Cierre iniciado durante lectura: no aplica ni guarda", async () => {
  const f = fixture(); f.c.load = async () => { f.setBlocked(true); return row("b", 2); };
  assert.equal((await syncRouteStep(f.c)).kind, "paused"); assert.equal(f.state().applies, 0);
});
test("Respuesta de otra cuenta: se rechaza", async () => {
  const f = fixture(); f.setRemote(row("a", 1, "B"));
  await assert.rejects(() => syncRouteStep(f.c), /otra cuenta/); assert.equal(f.state().accepts, 0);
});
test("Fallo de copia local: no acepta nueva base ni modifica nube", async () => {
  const f = fixture({ remoteId: "b" }); f.c.apply = () => false;
  await assert.rejects(() => syncRouteStep(f.c), /dispositivo/); assert.equal(f.state().accepts, 0); assert.equal(f.state().saves, 0);
});
test("Conflicto de revisión durante guardado: no se fuerza", async () => {
  const f = fixture({ localId: "edited" }); f.c.save = async () => { throw new Error("revision conflict"); };
  await assert.rejects(() => syncRouteStep(f.c), /revision conflict/); assert.equal(f.state().accepts, 0);
});
test("Respuesta perdida tras guardar: siguiente lectura adopta sin duplicar", async () => {
  const f = fixture({ localId: "edited" }); const save = f.c.save;
  f.c.save = async (...args) => { await save(...args); throw new Error("network"); };
  await assert.rejects(() => syncRouteStep(f.c), /network/);
  assert.equal((await syncRouteStep(f.c)).kind, "adopt"); assert.equal(f.state().saves, 1);
});
test("Respuesta perdida y edición posterior: pausa en lugar de pisar", async () => {
  const f = fixture({ localId: "edited" }); const save = f.c.save;
  f.c.save = async (...args) => { await save(...args); f.setLocal("newer"); throw new Error("network"); };
  await assert.rejects(() => syncRouteStep(f.c));
  assert.equal((await syncRouteStep(f.c)).kind, "conflict"); assert.equal(f.state().here.deliveries[0].id, "newer");
});
test("Tras recargar: base anterior permite recuperar cierre remoto", async () => {
  const f = fixture(); f.setRemote(row("", 4));
  assert.equal((await syncRouteStep(f.c)).kind, "pull"); assert.equal(f.state().base.revision, 4);
});
test("Base persistente: aislamiento y corrupción defensiva", () => {
  const data = new Map(); const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(readAutoBase("A", storage), null);
  writeAutoBase("A", row("a"), "fp-a", storage);
  assert.equal(readAutoBase("A", storage).fingerprint, "fp-a"); assert.equal(readAutoBase("B", storage), null);
  assert.throws(() => writeAutoBase("B", row("a"), "fp-a", storage));
  const key = [...data.keys()][0]; data.set(key, "{broken");
  assert.throws(() => readAutoBase("A", storage));
  assert.throws(() => writeAutoBase("A", row("a"), "new", storage)); assert.equal(data.get(key), "{broken");
});
test("Base inválida: no consulta la nube ni envía nada", async () => {
  const f = fixture(); f.c.readBase = () => { throw new Error("base corrupta"); };
  f.c.load = async () => { throw new Error("no debe consultarse"); };
  await assert.rejects(() => syncRouteStep(f.c), /base corrupta/); assert.equal(f.state().saves, 0);
});
