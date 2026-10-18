const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const assert = require("node:assert/strict");
const test = require("node:test");

function loadTs(name, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const module = { exports: {} };
  const requireMock = id => {
    if (!(id in imports)) throw new Error(`Import no permitido en prueba: ${id}`);
    return imports[id];
  };
  new Function("require", "module", "exports", compiled.outputText)(requireMock, module, module.exports);
  return module.exports;
}
const types = loadTs("types.ts");
const snapshot = loadTs("routeSnapshotStorage.ts", {
  "./types": types,
  "./destinatariosService": { userStorageKey: (key, uid) => `${key}:${uid}` },
});
const recovery = loadTs("routeCloudRecovery.ts");
const delivery = id => ({ id, recipient: id, address: "Prueba", status: "PENDING", type: "DELIVERY" });
function storage() {
  const data = new Map();
  let fail = false;
  let writes = 0;
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error("QuotaExceededError"); data.set(key, value); writes++; },
    removeItem: key => data.delete(key),
    fail: value => { fail = value; },
    writes: () => writes,
  };
}
function fixture() { const s = storage(); global.localStorage = s; return s; }
const legacy = () => ({ deliveries: [delivery("old")], sequence: ["old"] });

test("Instantánea: conserva las dos colecciones en una sola escritura", () => {
  const s = fixture();
  assert.equal(snapshot.saveRouteSnapshot("A", [delivery("a")], ["a"]), true);
  assert.equal(s.writes(), 1);
  assert.deepEqual(snapshot.loadRouteSnapshot("A", legacy).sequence, ["a"]);
  assert.equal(snapshot.loadRouteSnapshot("A", legacy).deliveries[0].id, "a");
});
test("Instantánea: fallo de escritura mantiene íntegra la versión previa", () => {
  const s = fixture();
  snapshot.saveRouteSnapshot("A", [delivery("old")], ["old"]);
  const before = [...s.data.entries()]; s.fail(true);
  assert.equal(snapshot.saveRouteSnapshot("A", [delivery("new")], ["new"]), false);
  assert.deepEqual([...s.data.entries()], before);
  assert.deepEqual(snapshot.loadRouteSnapshot("A", legacy), { userId: "A", ...legacy() });
});
test("Instantánea: fallo inicial no crea una ruta parcial", () => {
  const s = fixture(); s.fail(true);
  assert.equal(snapshot.saveRouteSnapshot("A", [delivery("a")], ["a"]), false);
  assert.equal(s.data.size, 0);
});
test("Instantánea: carga legacy sin escribir ni borrar sus claves", () => {
  const s = fixture(); s.data.set("legacy-evidence", "intacto");
  assert.deepEqual(snapshot.loadRouteSnapshot("A", legacy), { userId: "A", ...legacy() });
  assert.equal(s.writes(), 0); assert.equal(s.data.get("legacy-evidence"), "intacto");
});
test("Instantánea: prefiere versión nueva a legacy, incluso si está vacía", () => {
  fixture(); snapshot.saveRouteSnapshot("A", [], []);
  assert.deepEqual(snapshot.loadRouteSnapshot("A", legacy).deliveries, []);
});
test("Instantánea: usuarios distintos no comparten contenido", () => {
  fixture(); snapshot.saveRouteSnapshot("A", [delivery("a")], ["a"]);
  snapshot.saveRouteSnapshot("B", [delivery("b")], ["b"]);
  assert.equal(snapshot.loadRouteSnapshot("A", legacy).deliveries[0].id, "a");
  assert.equal(snapshot.loadRouteSnapshot("B", legacy).deliveries[0].id, "b");
});
test("Instantánea: JSON corrupto no usa fallback ni se sobrescribe", () => {
  const s = fixture(); snapshot.saveRouteSnapshot("A", [], []);
  const key = [...s.data.keys()][0]; s.data.set(key, "{corrupto");
  assert.throws(() => snapshot.loadRouteSnapshot("A", legacy));
  assert.equal(snapshot.saveRouteSnapshot("A", [], []), false);
  assert.equal(s.data.get(key), "{corrupto");
});
test("Instantánea: propietario inválido no se carga ni se sobrescribe", () => {
  const s = fixture(); snapshot.saveRouteSnapshot("A", [], []);
  const key = [...s.data.keys()][0]; const foreign = JSON.stringify({ userId: "B", deliveries: [], sequence: [] });
  s.data.set(key, foreign);
  assert.throws(() => snapshot.loadRouteSnapshot("A", legacy));
  assert.equal(snapshot.saveRouteSnapshot("A", [], []), false);
  assert.equal(s.data.get(key), foreign);
});
test("Instantánea: rechaza secuencia incompatible y paradas duplicadas", () => {
  const s = fixture();
  assert.equal(snapshot.saveRouteSnapshot("A", [delivery("a")], ["b"]), false);
  assert.equal(snapshot.saveRouteSnapshot("A", [delivery("a"), delivery("a")], ["a"]), false);
  assert.equal(s.writes(), 0);
});
test("Instantánea: legacy incoherente bloquea la carga sin mutaciones", () => {
  const s = fixture();
  assert.throws(() => snapshot.loadRouteSnapshot("A", () => ({ deliveries: [delivery("a")], sequence: ["b"] })));
  assert.equal(s.writes(), 0);
});
test("Cierre: solo reconoce el conflicto explícito del SQL esperado", () => {
  assert.equal(recovery.isDefinitiveRevisionConflict({ code: "40001", message: "La ruta ha cambiado en otro dispositivo" }), true);
  assert.equal(recovery.isDefinitiveRevisionConflict({ code: "40001", message: "Conflicto al cerrar la ruta" }), true);
  for (const error of [null, new Error("Failed to fetch"), { code: "40001", message: "serialization failure" }, { code: "500", message: "La ruta ha cambiado en otro dispositivo" }]) assert.equal(recovery.isDefinitiveRevisionConflict(error), false);
});
test("Cierre: retira solo el marcador esperado y no toca la ruta", () => {
  const s = fixture(); const marker = { id: "j1", fingerprint: "f1", revision: 2 };
  s.data.set("pending", JSON.stringify(marker)); s.data.set("route", "conservar");
  recovery.retireClosureMarker("pending", marker, s);
  assert.equal(s.getItem("pending"), null); assert.equal(s.getItem("route"), "conservar");
});
test("Cierre: no elimina un marcador sustituido en otra pestaña", () => {
  const s = fixture(); const marker = { id: "j1", fingerprint: "f1", revision: 2 };
  for (const other of [{ ...marker, id: "j2" }, { ...marker, fingerprint: "f2" }, { ...marker, revision: 3 }]) {
    s.data.set("pending", JSON.stringify(other));
    assert.throws(() => recovery.retireClosureMarker("pending", marker, s));
    assert.equal(s.getItem("pending"), JSON.stringify(other));
  }
});
test("Cierre: fallo de borrado mantiene marcador para reintento", () => {
  const s = fixture(); const marker = { id: "j1", fingerprint: "f1", revision: 2 };
  s.data.set("pending", JSON.stringify(marker));
  assert.throws(() => recovery.retireClosureMarker("pending", marker, { getItem: s.getItem, removeItem() { throw new Error("bloqueado"); } }));
  assert.notEqual(s.getItem("pending"), null);
});
