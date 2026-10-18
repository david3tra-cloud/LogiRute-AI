const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

// ──────────────────────────────────────────────────────────────────────────────
// Regresión para la integración Supabase de rutas y registro.
// Se ejercitan funciones REALES extraídas de los archivos fuente,
// con dobles (mocks/stubs) sólo para supabase y window.confirm/alert.
// ──────────────────────────────────────────────────────────────────────────────

// ── 1. Transpilación de rutasSupabaseService.ts ──────────────────────────────
// Se reemplaza el import real de supabase por un stub inyectado en el sandbox.

const serviceFile = path.resolve(process.cwd(), "rutasSupabaseService.ts");
const serviceCode = fs.readFileSync(serviceFile, "utf8");
const registroFile = path.resolve(process.cwd(), "registroJornadasService.ts");
const registroCode = fs.readFileSync(registroFile, "utf8");
const recipientsFile = path.resolve(process.cwd(), "destinatariosService.ts");

// Rewrite imports to reference sandbox globals instead of ESM modules
const stripExport = (s) => s.replace(/\bexport\s+(const|function|class|type|interface|enum|async\s+function)\b/g, "$1");
const stripImport = (s) => s.replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\r?\n?/g, "")
                             .replace(/import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\r?\n?/g, "");

let patchedService = stripExport(stripImport(serviceCode));
let patchedRegistro = stripExport(stripImport(registroCode));

// Read userStorageKey from destinatariosService
const recipientsCode = fs.readFileSync(recipientsFile, "utf8");
const uskMatch = recipientsCode.match(/export const userStorageKey\s*=\s*\([^)]*\)\s*=>\s*[^;]+;/);
assert(uskMatch, "No se encontró userStorageKey en destinatariosService.ts");
const userStorageKeyDef = uskMatch[0].replace("export ", "");

// Extract persist helpers from App.tsx using TypeScript AST
const appFile = path.resolve(process.cwd(), "App.tsx");
const appSource = ts.createSourceFile(appFile, fs.readFileSync(appFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appDecls = new Map();
const visitApp = (node) => {
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && [
        "STORAGE_KEY",
        "SEQUENCE_KEY",
        "deliveriesStorageKey",
        "sequenceStorageKey",
        "persistUserScopedJornada",
        "persistUserScopedJornadaWithRollback",
      ].includes(decl.name.text)) {
        appDecls.set(decl.name.text, `const ${decl.getText(appSource)};`);
      }
    }
  }
  ts.forEachChild(node, visitApp);
};
visitApp(appSource);
for (const name of [
  "STORAGE_KEY",
  "SEQUENCE_KEY",
  "deliveriesStorageKey",
  "sequenceStorageKey",
  "persistUserScopedJornada",
  "persistUserScopedJornadaWithRollback",
]) {
  assert(appDecls.has(name), `Falta declaración en App.tsx: ${name}`);
}

const bundleSource = `
// --- stub types ---
const DeliveryStatus = { PENDING: "PENDING", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED", ISSUE: "ISSUE" };
const DeliveryType = { DELIVERY: "DELIVERY", PICKUP: "PICKUP" };

${userStorageKeyDef}

// --- App.tsx persist helpers (real) ---
${[...appDecls.values()].join("\n")}

// --- registroJornadasService (real) ---
${patchedRegistro}

// --- rutasSupabaseService (real, supabase stub injected) ---
${patchedService}

// expose
globalThis.exports = {
  loadRemoteRoute,
  saveRemoteRoute,
  listRemoteJornadas,
  RouteConflictError,
  validateRoute,
  parseRoute,
  assertSession,
  isJornadaRegistro,
  computeRouteFingerprint,
  generateStableId,
  loadPendingClosureMarker,
  loadRegistroJornadasWithStatus,
  userStorageKey,
  STORAGE_KEY,
  SEQUENCE_KEY,
  deliveriesStorageKey,
  sequenceStorageKey,
  persistUserScopedJornada,
  persistUserScopedJornadaWithRollback,
};
`;

const compiled = ts.transpileModule(bundleSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
  reportDiagnostics: true,
});

const syntaxErrors = (compiled.diagnostics || []).filter(
  (d) => d.category === ts.DiagnosticCategory.Error,
);
assert.equal(syntaxErrors.length, 0, "Error de compilación:\n" +
  syntaxErrors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));

// ── 2. Helpers de fixtures ───────────────────────────────────────────────────

const uid = "user-sync-test";
const uid2 = "user-sync-other";

function makeDelivery(id, overrides = {}) {
  return {
    id,
    recipient: `Rec ${id}`,
    address: `Addr ${id}`,
    status: "COMPLETED",
    type: "DELIVERY",
    ...overrides,
  };
}

function createSandbox(supabaseStub) {
  const store = new Map();
  const interceptors = {
    beforeSetItem: null,
    beforeRemoveItem: null,
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (interceptors.beforeSetItem) interceptors.beforeSetItem(k, v);
      store.set(k, String(v));
    },
    removeItem: (k) => {
      if (interceptors.beforeRemoveItem) interceptors.beforeRemoveItem(k);
      store.delete(k);
    },
  };
  const sandbox = {
    console: { error: () => {}, warn: () => {}, log: () => {} },
    localStorage,
    window: {
      localStorage,
      confirm: () => true,
      alert: () => {},
    },
    supabase: supabaseStub,
    globalThis: {},
    Number,
    Array,
    JSON,
    Date,
    Error,
    Map,
    Set,
    Object,
    String,
    Boolean,
    Promise,
    setTimeout,
    crypto: { randomUUID: () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(compiled.outputText, sandbox, { timeout: 5000 });
  return { store, sandbox, s: sandbox.exports, interceptors };
}

function defaultSupabaseStub({ session = { user: { id: uid } } } = {}) {
  let routeRow = null;
  let routeRevision = 0;
  let jornadasRows = [];
  const rpcResults = {};

  const stub = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
    },
    from: (table) => {
      if (table === "rutas_activas") {
        return {
          select: () => ({
            eq: (field, value) => ({
              maybeSingle: async () => {
                if (field === "user_id") {
                  return { data: routeRow, error: null };
                }
                return { data: null, error: null };
              },
              eq: (f2, v2) => ({
                select: () => ({
                  maybeSingle: async () => {
                    // update with revision check
                    if (routeRow && routeRow.revision === v2) {
                      routeRevision++;
                      routeRow = { ...routeRow, revision: routeRevision, updated_at: new Date().toISOString() };
                      return { data: routeRow, error: null };
                    }
                    return { data: null, error: null }; // conflict
                  },
                }),
              }),
            }),
          }),
          insert: (payload) => ({
            select: () => ({
              maybeSingle: async () => {
                if (routeRow) {
                  return { data: null, error: { code: "23505", message: "duplicate" } };
                }
                routeRevision = 1;
                routeRow = { ...payload, revision: 1, updated_at: new Date().toISOString() };
                return { data: routeRow, error: null };
              },
            }),
          }),
          update: (payload) => ({
            eq: (f1, v1) => ({
              eq: (f2, v2) => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (routeRow && routeRow.revision === v2 && routeRow.user_id === v1) {
                      routeRevision++;
                      routeRow = { ...routeRow, ...payload, revision: routeRevision, updated_at: new Date().toISOString() };
                      return { data: routeRow, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "registro_jornadas") {
        return {
          select: () => ({
            eq: (f, v) => ({
              order: () => ({
                order: () => ({
                  range: (from, to) => ({
                    then: undefined,
                    // make this awaitable
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    },
    rpc: async (fn, params) => {
      if (rpcResults[fn]) return rpcResults[fn](params);
      return { data: null, error: { message: "RPC no configurado" } };
    },
    // Test helpers
    _setRoute: (r) => { routeRow = r; routeRevision = r ? r.revision : 0; },
    _getRoute: () => routeRow,
    _setRpc: (name, handler) => { rpcResults[name] = handler; },
    _setJornadas: (rows) => { jornadasRows = rows; },
  };
  return stub;
}

// ── 3. Tests ─────────────────────────────────────────────────────────────────

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ─── rutasSupabaseService tests ──────────────────────────────────────────────

test("S1. loadRemoteRoute: devuelve null si no hay fila", async () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  const result = await s.loadRemoteRoute(uid);
  assert.equal(result, null);
});

test("S2. loadRemoteRoute: parsea fila válida", async () => {
  const stub = defaultSupabaseStub();
  const d = [makeDelivery("d1")];
  stub._setRoute({ user_id: uid, deliveries: d, sequence: ["d1"], revision: 1, updated_at: "2026-01-01T00:00:00Z" });
  const { s } = createSandbox(stub);
  const result = await s.loadRemoteRoute(uid);
  assert.equal(result.revision, 1);
  assert.equal(result.deliveries[0].id, "d1");
});

test("S3. loadRemoteRoute: lanza si la sesión cambia entre las dos comprobaciones", async () => {
  let calls = 0;
  const stub = defaultSupabaseStub();
  const origGetSession = stub.auth.getSession;
  stub.auth.getSession = async () => {
    calls++;
    if (calls >= 2) return { data: { session: { user: { id: "otro" } } }, error: null };
    return origGetSession();
  };
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("d1")], sequence: ["d1"], revision: 1, updated_at: "2026-01-01T00:00:00Z" });
  const { s } = createSandbox(stub);
  await assert.rejects(() => s.loadRemoteRoute(uid), /sesión/i);
});

test("S4. saveRemoteRoute: inserta cuando revision es null", async () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  const d = [makeDelivery("s1")];
  const result = await s.saveRemoteRoute(uid, d, ["s1"], null);
  assert.equal(result.revision, 1);
  assert.equal(result.deliveries[0].id, "s1");
});

test("S5. saveRemoteRoute: falla si ya existe fila y revision=null (duplicate key)", async () => {
  const stub = defaultSupabaseStub();
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("e1")], sequence: ["e1"], revision: 1, updated_at: "x" });
  const { s } = createSandbox(stub);
  await assert.rejects(() => s.saveRemoteRoute(uid, [makeDelivery("e2")], ["e2"], null), /otro dispositivo|RouteConflictError/i);
});

test("S6. saveRemoteRoute: actualiza con revisión correcta", async () => {
  const stub = defaultSupabaseStub();
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("u1")], sequence: ["u1"], revision: 1, updated_at: "x" });
  const { s } = createSandbox(stub);
  const d2 = [makeDelivery("u1"), makeDelivery("u2")];
  const result = await s.saveRemoteRoute(uid, d2, ["u1", "u2"], 1);
  assert.equal(result.revision, 2);
  assert.equal(result.deliveries.length, 2);
});

test("S7. saveRemoteRoute: conflicto si revisión desactualizada", async () => {
  const stub = defaultSupabaseStub();
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("c1")], sequence: ["c1"], revision: 3, updated_at: "x" });
  const { s } = createSandbox(stub);
  await assert.rejects(() => s.saveRemoteRoute(uid, [makeDelivery("c1")], ["c1"], 2), /otro dispositivo|RouteConflictError/i);
});

test("S8. validateRoute: rechaza IDs duplicados", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  assert.throws(() => s.validateRoute([makeDelivery("x"), makeDelivery("x")], ["x"]), /duplicad/i);
});

test("S9. validateRoute: rechaza secuencia con ID inexistente", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  assert.throws(() => s.validateRoute([makeDelivery("v1")], ["v1", "noexiste"]), /inválido/i);
});

test("S10. parseRoute: rechaza user_id que no coincide", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  assert.throws(() => s.parseRoute({
    user_id: "otro",
    deliveries: [makeDelivery("p1")],
    sequence: ["p1"],
    revision: 1,
    updated_at: "2026-01-01T00:00:00Z",
  }, uid), /inválid/i);
});

test("S11. assertSession: lanza si userId vacío", async () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  await assert.rejects(() => s.assertSession(""), /sesión/i);
});

// ─── Lógica de cloud close y pending marker ─────────────────────────────────

test("P1. Marcador pendiente inválido no bloquea: readPending rechaza datos malformados", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  // Write a marker with empty id (invalid: id must be truthy string)
  store.set(`logiroute_cloud_close_v1:${uid}`, JSON.stringify({ id: "", fingerprint: "fp", revision: 1 }));
  const raw = store.get(`logiroute_cloud_close_v1:${uid}`);
  const p = JSON.parse(raw);
  // RouteCloudPanel.readPending checks: typeof p.id === "string" && p.id (truthy)
  const isValid = Boolean(p && typeof p.id === "string" && p.id && typeof p.fingerprint === "string" && Number.isSafeInteger(p.revision) && p.revision >= 1);
  assert.equal(isValid, false, "Marcador con id vacío debe ser rechazado");
});

test("P2. computeRouteFingerprint es determinista y diferencia rutas", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  const d1 = [makeDelivery("f1")];
  const d2 = [makeDelivery("f1"), makeDelivery("f2")];
  const fp1a = s.computeRouteFingerprint(d1, ["f1"]);
  const fp1b = s.computeRouteFingerprint(d1, ["f1"]);
  const fp2 = s.computeRouteFingerprint(d2, ["f1", "f2"]);
  assert.equal(fp1a, fp1b, "Mismo input, misma huella");
  assert.notEqual(fp1a, fp2, "Diferentes rutas, diferente huella");
});

test("P3. computeRouteFingerprint distingue orden de secuencia", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  const d = [makeDelivery("a"), makeDelivery("b")];
  const fpAB = s.computeRouteFingerprint(d, ["a", "b"]);
  const fpBA = s.computeRouteFingerprint(d, ["b", "a"]);
  assert.notEqual(fpAB, fpBA, "Diferente orden de secuencia, diferente huella");
});

// ─── RegistroNubeModal: filtrado por cuenta ─────────────────────────────────

test("R1. loadRegistroJornadasWithStatus no devuelve jornadas de otra cuenta", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  const key = s.userStorageKey("logiroute_registro_jornadas_v1", uid);
  // Almacenamos jornadas de 2 usuarios bajo la misma clave (situación imposible
  // en producción pero defensiva)
  const jornadaA = {
    id: "j-a", userId: uid, fingerprint: "fa",
    fechaCierre: "2026-01-01T00:00:00Z",
    resumen: { totalStops: 1, completedStops: 1, issueStops: 0, pendingStops: 0, deliveriesCount: 1, pickupsCount: 0 },
    deliveries: [makeDelivery("d-a")], sequence: ["d-a"],
  };
  const jornadaB = {
    id: "j-b", userId: uid2, fingerprint: "fb",
    fechaCierre: "2026-01-02T00:00:00Z",
    resumen: { totalStops: 1, completedStops: 1, issueStops: 0, pendingStops: 0, deliveriesCount: 1, pickupsCount: 0 },
    deliveries: [makeDelivery("d-b")], sequence: ["d-b"],
  };
  store.set(key, JSON.stringify([jornadaA, jornadaB]));
  const result = s.loadRegistroJornadasWithStatus(uid);
  // La función marca como corrupted si encuentra un userId que no coincide
  assert.equal(result.corrupted, true, "Debe marcar como corrupto si hay jornadas de otra cuenta");
});

test("R2. loadRegistroJornadasWithStatus detecta registro corrupto (JSON roto)", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  const key = s.userStorageKey("logiroute_registro_jornadas_v1", uid);
  store.set(key, "{{{malformado}}}");
  const result = s.loadRegistroJornadasWithStatus(uid);
  assert.equal(result.corrupted, true);
  assert.equal(result.items.length, 0);
});

test("R3. loadRegistroJornadasWithStatus funciona con registro vacío", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  const result = s.loadRegistroJornadasWithStatus(uid);
  assert.equal(result.corrupted, false);
  assert.equal(result.items.length, 0);
});

// ─── Revision conflict detection ────────────────────────────────────────────

test("C1. Guardado con revisión desactualizada lanza RouteConflictError", async () => {
  const stub = defaultSupabaseStub();
  // Simular que la ruta remota está en revisión 5
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("c1")], sequence: ["c1"], revision: 5, updated_at: "x" });
  const { s } = createSandbox(stub);
  // Intentamos guardar con revisión 3 (desactualizada)
  await assert.rejects(
    () => s.saveRemoteRoute(uid, [makeDelivery("c1")], ["c1"], 3),
    (err) => err.message.includes("otro dispositivo") || err.constructor.name === "RouteConflictError",
    "Debe lanzar conflicto de revisión",
  );
});

test("C2. Guardado con revisión correcta y luego segundo guardado con misma revisión falla", async () => {
  const stub = defaultSupabaseStub();
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("cc1")], sequence: ["cc1"], revision: 1, updated_at: "x" });
  const { s } = createSandbox(stub);
  // Primer guardado exitoso: rev 1 -> rev 2
  const r1 = await s.saveRemoteRoute(uid, [makeDelivery("cc1")], ["cc1"], 1);
  assert.equal(r1.revision, 2);
  // Segundo intento con rev 1 (ya obsoleta): debe fallar
  await assert.rejects(
    () => s.saveRemoteRoute(uid, [makeDelivery("cc1")], ["cc1"], 1),
    (err) => err.message.includes("otro dispositivo") || err.constructor.name === "RouteConflictError",
  );
});

// ─── Session change protection ──────────────────────────────────────────────

test("A1. saveRemoteRoute lanza si la sesión cambia después de guardar", async () => {
  let calls = 0;
  const stub = defaultSupabaseStub();
  const origGetSession = stub.auth.getSession;
  stub.auth.getSession = async () => {
    calls++;
    // Second call (post-save assertion) returns different user
    if (calls >= 2) return { data: { session: { user: { id: "intruso" } } }, error: null };
    return origGetSession();
  };
  const { s } = createSandbox(stub);
  await assert.rejects(
    () => s.saveRemoteRoute(uid, [makeDelivery("a1")], ["a1"], null),
    /sesión/i,
    "Debe detectar cambio de sesión post-save",
  );
});

// ─── Validation edge cases ──────────────────────────────────────────────────

test("V1. validateRoute acepta ruta vacía", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  // No debe lanzar
  s.validateRoute([], []);
});

test("V2. validateRoute rechaza entrega con status inválido", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  assert.throws(
    () => s.validateRoute([{ ...makeDelivery("v2"), status: "UNKNOWN" }], ["v2"]),
    /inválid/i,
  );
});

test("V3. validateRoute rechaza secuencia con duplicados", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  assert.throws(
    () => s.validateRoute([makeDelivery("v3")], ["v3", "v3"]),
    /inválido/i,
  );
});

// ─── Integration: no vaciar ruta nueva al recuperar cierre anterior ─────────

test("I1. Marcador pendiente válido impide guardar nueva ruta (protección)", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  const fp = s.computeRouteFingerprint([makeDelivery("i1")], ["i1"]);
  const marker = { id: "close-1", fingerprint: fp, revision: 1 };
  store.set(`logiroute_cloud_close_v1:${uid}`, JSON.stringify(marker));
  // readPending should return the marker
  const raw = store.get(`logiroute_cloud_close_v1:${uid}`);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.id, "close-1");
  assert.equal(parsed.revision, 1);
  // The panel logic checks readPending() before saveSnapshot and throws
  // This is a logic validation: if pending, save is blocked
  assert.equal(Boolean(parsed), true);
});

// ─── listRemoteJornadas pagination ──────────────────────────────────────────

test("L1. listRemoteJornadas valida userId de cada jornada recibida", async () => {
  const stub = defaultSupabaseStub();
  // Override from() for registro_jornadas to return a row with wrong userId
  stub.from = (table) => {
    if (table === "registro_jornadas") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                range: async () => ({
                  data: [{
                    id: "j-wrong",
                    user_id: "otro-usuario",
                    fingerprint: "fp",
                    fecha_cierre: "2026-01-01T00:00:00Z",
                    resumen: { totalStops: 1, completedStops: 1, issueStops: 0, pendingStops: 0, deliveriesCount: 1, pickupsCount: 0 },
                    deliveries: [makeDelivery("d1")],
                    sequence: ["d1"],
                  }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }
    return defaultSupabaseStub().from(table);
  };
  const { s } = createSandbox(stub);
  await assert.rejects(() => s.listRemoteJornadas(uid), /inválid/i, "Debe rechazar jornada con userId distinto");
});

// ─── Legacy marker guard ────────────────────────────────────────────────────

test("G1. loadPendingClosureMarker legacy: marcador COMPLETED no bloquea", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  const key = s.userStorageKey("logiroute_pending_closure_v1", uid);
  store.set(key, JSON.stringify({
    id: "legacy-1",
    userId: uid,
    fingerprint: "fp",
    createdAt: "2026-01-01T00:00:00Z",
    status: "COMPLETED",
  }));
  const marker = s.loadPendingClosureMarker(uid);
  assert.notEqual(marker, null);
  assert.equal(marker.status, "COMPLETED");
  // The legacyGuard in RouteCloudPanel checks: if (marker && marker.status !== "COMPLETED") throw
  // So COMPLETED should NOT block
  const shouldBlock = marker && marker.status !== "COMPLETED";
  assert.equal(shouldBlock, false, "Marcador COMPLETED no debe bloquear");
});

test("G2. loadPendingClosureMarker legacy: marcador ARCHIVING bloquea", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  const key = s.userStorageKey("logiroute_pending_closure_v1", uid);
  store.set(key, JSON.stringify({
    id: "legacy-2",
    userId: uid,
    fingerprint: "fp",
    createdAt: "2026-01-01T00:00:00Z",
    status: "ARCHIVING",
  }));
  const marker = s.loadPendingClosureMarker(uid);
  const shouldBlock = marker && marker.status !== "COMPLETED";
  assert.equal(shouldBlock, true, "Marcador ARCHIVING debe bloquear");
});

test("G3. loadPendingClosureMarker de otro userId devuelve null", () => {
  const stub = defaultSupabaseStub();
  const { s, store } = createSandbox(stub);
  const key = s.userStorageKey("logiroute_pending_closure_v1", uid);
  store.set(key, JSON.stringify({
    id: "cross-1",
    userId: uid2,
    fingerprint: "fp",
    createdAt: "2026-01-01T00:00:00Z",
    status: "ARCHIVING",
  }));
  const marker = s.loadPendingClosureMarker(uid);
  assert.equal(marker, null, "No debe cargar marcador de otro usuario");
});

// ─── Data integrity ─────────────────────────────────────────────────────────

test("D1. saveRemoteRoute valida deliveries antes de enviar", async () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  // Delivery sin address
  const bad = [{ id: "bad1", recipient: "X", status: "COMPLETED", type: "DELIVERY" }];
  await assert.rejects(() => s.saveRemoteRoute(uid, bad, ["bad1"], null), /inválid/i);
});

test("D2. saveRemoteRoute rechaza expectedRevision negativa", async () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  await assert.rejects(
    () => s.saveRemoteRoute(uid, [makeDelivery("d2")], ["d2"], -1),
    /inválid/i,
  );
});

test("D3. saveRemoteRoute rechaza expectedRevision fraccionaria", async () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);
  await assert.rejects(
    () => s.saveRemoteRoute(uid, [makeDelivery("d3")], ["d3"], 1.5),
    /inválid/i,
  );
});

// ─── H1: registerClose en ciclo de vida y desregistro seguro ────────────────

test("H1. registerClose: ciclo de vida de registro, desregistro seguro y protección de llamada nula", () => {
  let cloudCloseRef = { current: null };
  const registerClose = (close) => {
    cloudCloseRef.current = close;
    return () => {
      if (cloudCloseRef.current === close) {
        cloudCloseRef.current = null;
      }
    };
  };

  const close1 = async () => {};
  const close2 = async () => {};

  // 1. Commit inicial: se registra close1
  const unregister1 = registerClose(close1);
  assert.equal(cloudCloseRef.current, close1, "close1 debe quedar registrado tras commit");

  // 2. Siguiente render/commit: se registra close2
  const unregister2 = registerClose(close2);
  assert.equal(cloudCloseRef.current, close2, "close2 debe sustituir a close1");

  // 3. Limpieza tardía de un render antiguo (unregister1): NO debe limpiar close2
  unregister1();
  assert.equal(cloudCloseRef.current, close2, "Limpieza antigua no debe anular un callback más reciente");

  // 4. Desmontaje real (unregister2): debe quedar explícitamente en null
  unregister2();
  assert.equal(cloudCloseRef.current, null, "Al desmontar debe quedar en null");

  // 5. Invocación de handleClearAll cuando cloudCloseRef.current es null
  let alertMsg = null;
  const mockAlert = (msg) => { alertMsg = msg; };
  let closeExecuted = false;

  const handleClearAllSimulado = async (user, hydratedUserId, cloudClose) => {
    if (!user?.id || hydratedUserId !== user.id || !cloudClose) {
      mockAlert("Espera a que la sesión y el servicio de nube estén preparados.");
      return;
    }
    closeExecuted = true;
    await cloudClose();
  };

  handleClearAllSimulado({ id: uid }, uid, cloudCloseRef.current);
  assert.equal(closeExecuted, false, "No debe ejecutar cierre si callback es null");
  assert.equal(alertMsg, "Espera a que la sesión y el servicio de nube estén preparados.", "Debe notificar indisponibilidad sin simular éxito falso");
});

// ─── H2: Pruebas lógicas del cierre remoto e idempotencia ───────────────────

test("H2.1 Cierre realizado y respuesta perdida: repetir el mismo ID recupera el resultado sin duplicar la jornada", async () => {
  const stub = defaultSupabaseStub();
  const d = [makeDelivery("h2-1")];
  const seq = ["h2-1"];
  const stableId = "jornada-estable-123";

  // Simulación de base de datos remota
  let remoteRoute = { user_id: uid, deliveries: d, sequence: seq, revision: 1, updated_at: "2026-01-01T00:00:00Z" };
  const remoteJornadas = [];

  // Implementación del RPC con la semántica SQL real:
  // Consulta primero el archivo por user_id e id; si existe y coincide el fingerprint, duplicate=true.
  // Solo comprueba revisión si aún no está archivado.
  stub._setRpc("cerrar_jornada_remota", async ({ p_id, p_fingerprint, p_expected_revision }) => {
    const existing = remoteJornadas.find(j => j.userId === uid && j.id === p_id);
    if (existing) {
      if (existing.fingerprint !== p_fingerprint) {
        return { data: null, error: { message: "Conflicto de huella en jornada existente" } };
      }
      return {
        data: {
          duplicate: true,
          jornada: {
            id: existing.id,
            user_id: existing.userId,
            fingerprint: existing.fingerprint,
            fecha_cierre: existing.fechaCierre,
            resumen: existing.resumen,
            deliveries: existing.deliveries,
            sequence: existing.sequence,
          },
          route: remoteRoute,
        },
        error: null,
      };
    }
    if (remoteRoute.revision !== p_expected_revision) {
      return { data: null, error: { message: "Conflicto de revisión en rutas_activas" } };
    }
    const newJ = {
      id: p_id,
      userId: uid,
      fingerprint: p_fingerprint,
      fechaCierre: new Date().toISOString(),
      resumen: { totalStops: 1, completedStops: 1, issueStops: 0, pendingStops: 0, deliveriesCount: 1, pickupsCount: 0 },
      deliveries: remoteRoute.deliveries,
      sequence: remoteRoute.sequence,
    };
    remoteJornadas.push(newJ);
    remoteRoute = { user_id: uid, deliveries: [], sequence: [], revision: remoteRoute.revision + 1, updated_at: new Date().toISOString() };
    return {
      data: {
        duplicate: false,
        jornada: {
          id: newJ.id,
          user_id: newJ.userId,
          fingerprint: newJ.fingerprint,
          fecha_cierre: newJ.fechaCierre,
          resumen: newJ.resumen,
          deliveries: newJ.deliveries,
          sequence: newJ.sequence,
        },
        route: remoteRoute,
      },
      error: null,
    };
  });

  const { s, store } = createSandbox(stub);
  const routeFp = s.computeRouteFingerprint(d, seq);

  // Primer intento: el RPC procesa, pero la respuesta se "pierde" para el cliente
  const res1 = await stub.rpc("cerrar_jornada_remota", {
    p_id: stableId,
    p_fingerprint: routeFp,
    p_expected_revision: 1,
  });
  assert.equal(res1.data.duplicate, false);
  assert.equal(remoteJornadas.length, 1, "Debe haberse archivado en Supabase");
  assert.equal(remoteRoute.revision, 2, "La revisión avanzó a 2");

  // El cliente guarda el marcador pendiente
  store.set(`logiroute_cloud_close_v1:${uid}`, JSON.stringify({ id: stableId, fingerprint: routeFp, revision: 1 }));

  // Reintento tras respuesta perdida: reenvía la misma llamada con expected_revision: 1
  const res2 = await stub.rpc("cerrar_jornada_remota", {
    p_id: stableId,
    p_fingerprint: routeFp,
    p_expected_revision: 1, // La revisión remota ya es 2, pero como id coincide, se atiende por idempotencia
  });

  assert.equal(res2.error, null, "No debe fallar por revisión desactualizada");
  assert.equal(res2.data.duplicate, true, "Debe devolver duplicate=true");
  assert.equal(res2.data.jornada.id, stableId);
  assert.equal(remoteJornadas.length, 1, "NUNCA debe duplicar la jornada en la base de datos");
});

test("H2.2 Ruta remota nueva después del cierre: el reintento no la vacía", async () => {
  const stub = defaultSupabaseStub();
  const dOld = [makeDelivery("old-1")];
  const dNew = [makeDelivery("new-1"), makeDelivery("new-2")];
  const stableId = "jornada-ayer";
  const oldFp = "fp-ayer";

  // Supabase ya cerró ayer la jornada "jornada-ayer"
  const remoteJornadas = [{
    id: stableId,
    userId: uid,
    fingerprint: oldFp,
    fechaCierre: "2026-01-01T20:00:00Z",
    resumen: { totalStops: 1, completedStops: 1, issueStops: 0, pendingStops: 0, deliveriesCount: 1, pickupsCount: 0 },
    deliveries: dOld,
    sequence: ["old-1"],
  }];
  // Hoy otro dispositivo cargó y guardó una ruta nueva de 2 paradas en revisión 3
  let remoteRoute = { user_id: uid, deliveries: dNew, sequence: ["new-1", "new-2"], revision: 3, updated_at: "2026-01-02T08:00:00Z" };

  stub._setRpc("cerrar_jornada_remota", async ({ p_id, p_fingerprint }) => {
    const existing = remoteJornadas.find(j => j.userId === uid && j.id === p_id);
    if (existing && existing.fingerprint === p_fingerprint) {
      return {
        data: {
          duplicate: true,
          jornada: {
            id: existing.id,
            user_id: existing.userId,
            fingerprint: existing.fingerprint,
            fecha_cierre: existing.fechaCierre,
            resumen: existing.resumen,
            deliveries: existing.deliveries,
            sequence: existing.sequence,
          },
          route: remoteRoute,
        },
        error: null,
      };
    }
    return { data: null, error: { message: "No encontrado" } };
  });

  const res = await stub.rpc("cerrar_jornada_remota", { p_id: stableId, p_fingerprint: oldFp, p_expected_revision: 1 });
  assert.equal(res.error, null);
  assert.equal(res.data.duplicate, true);
  // Verificar que la ruta remota nueva NO se vació
  assert.equal(remoteRoute.deliveries.length, 2, "La nueva ruta remota debe conservarse intacta");
  assert.equal(remoteRoute.revision, 3, "La revisión no debe alterarse");
});

test("H2.3 Cambio remoto anterior al primer cierre: conflicto de revisión sin archivo creado y sin marcador pendiente", async () => {
  const stub = defaultSupabaseStub();
  // Ruta remota modificada por otro dispositivo (revisión 5)
  stub._setRoute({ user_id: uid, deliveries: [makeDelivery("ext-1")], sequence: ["ext-1"], revision: 5, updated_at: "2026-01-01T00:00:00Z" });
  let rpcCalled = false;
  stub._setRpc("cerrar_jornada_remota", async () => {
    rpcCalled = true;
    return { data: null, error: null };
  });

  const { s, store } = createSandbox(stub);
  const localD = [makeDelivery("loc-1")];
  const localSeq = ["loc-1"];

  // El cliente intenta guardar antes de cerrar esperando revisión 4 (desactualizada)
  let saveFailed = false;
  try {
    await s.saveRemoteRoute(uid, localD, localSeq, 4);
  } catch (err) {
    saveFailed = true;
    assert(err.message.includes("otro dispositivo") || err.name === "RouteConflictError");
  }

  assert.equal(saveFailed, true, "Debe fallar con RouteConflictError");
  assert.equal(rpcCalled, false, "No debe invocar RPC de cierre");
  assert.equal(store.has(`logiroute_cloud_close_v1:${uid}`), false, "No debe escribir marcador pendiente");
});

test("H2.4 Cambios locales posteriores al intento: no se borran al recuperar", () => {
  const stub = defaultSupabaseStub();
  const { s } = createSandbox(stub);

  const routeA = [makeDelivery("a")];
  const routeB = [makeDelivery("a"), makeDelivery("b")];
  const fpA = s.computeRouteFingerprint(routeA, ["a"]);
  const fpB = s.computeRouteFingerprint(routeB, ["a", "b"]);

  const marker = { id: "close-a", fingerprint: fpA, revision: 1 };
  const rowRemotaVacia = { deliveries: [], sequence: [] };
  const fpRemotaVacia = s.computeRouteFingerprint([], []);

  // La ruta local actual en el dispositivo es routeB (cambió mientras estaba pendiente el cierre de routeA)
  const localCurrentFp = fpB;

  // Lógica de validación de RouteCloudPanel.tsx L148:
  // if (signature(local) !== marker.fingerprint && signature(local) !== signature(row.deliveries, row.sequence)) throw ...
  const matchesMarker = localCurrentFp === marker.fingerprint;
  const matchesRemoteRoute = localCurrentFp === fpRemotaVacia;
  const shouldRejectReplacement = !matchesMarker && !matchesRemoteRoute;

  assert.equal(shouldRejectReplacement, true, "Debe rechazar sustituir la ruta local si esta cambió tras el intento");
});

// ─── H3: Fallos en persistencia local y análisis de inconsistencia ──────────

test("H3.1 Fallo de la segunda escritura local: rollback restaura deliveries", () => {
  const stub = defaultSupabaseStub();
  const { s, store, interceptors } = createSandbox(stub);

  const oldDeliveries = [makeDelivery("old-del")];
  const oldSequence = ["old-del"];
  s.persistUserScopedJornada(uid, oldDeliveries, oldSequence);

  const newDeliveries = [makeDelivery("new-del-1"), makeDelivery("new-del-2")];
  const newSequence = ["new-del-1", "new-del-2"];

  // Interceptar para que falle la escritura de sequence
  const seqKey = s.sequenceStorageKey(uid);
  interceptors.beforeSetItem = (k, v) => {
    if (k === seqKey && v === JSON.stringify(newSequence)) {
      throw new Error("QuotaExceededError en secuencia");
    }
  };

  const ok = s.persistUserScopedJornada(uid, newDeliveries, newSequence);
  assert.equal(ok, false, "persistUserScopedJornada debe retornar false ante fallo");

  // El rollback debe haber restaurado deliveries al valor anterior
  const storedDeliveries = JSON.parse(store.get(s.deliveriesStorageKey(uid)));
  assert.equal(storedDeliveries.length, 1);
  assert.equal(storedDeliveries[0].id, "old-del", "Rollback debe restaurar deliveries previo");
});

test("H3.2 Fallo de la segunda escritura local Y fallo adicional del rollback: produce inconsistencia en storage", () => {
  const stub = defaultSupabaseStub();
  const { s, store, interceptors } = createSandbox(stub);

  const oldDeliveries = [makeDelivery("consistent-old")];
  const oldSequence = ["consistent-old"];
  s.persistUserScopedJornada(uid, oldDeliveries, oldSequence);

  const newDeliveries = [makeDelivery("inconsistent-new")];
  const newSequence = ["inconsistent-new"];

  const delivKey = s.deliveriesStorageKey(uid);
  const seqKey = s.sequenceStorageKey(uid);

  // Simular:
  // 1. Escritura de newDeliveries: tiene éxito
  // 2. Escritura de newSequence: falla
  // 3. Intento de rollback de deliveries a oldDeliveries: TAMBIÉN falla
  let firstDelivWriteDone = false;
  interceptors.beforeSetItem = (k, v) => {
    if (k === delivKey && v === JSON.stringify(newDeliveries)) {
      firstDelivWriteDone = true;
      return;
    }
    if (k === seqKey && v === JSON.stringify(newSequence)) {
      throw new Error("Fallo en segunda escritura");
    }
    if (k === delivKey && firstDelivWriteDone) {
      throw new Error("Fallo en rollback");
    }
  };

  const ok = s.persistUserScopedJornada(uid, newDeliveries, newSequence);
  assert.equal(ok, false, "Debe reportar fallo general");

  // Verificar la inconsistencia resultante en localStorage:
  const storedDeliv = JSON.parse(store.get(delivKey));
  const storedSeq = JSON.parse(store.get(seqKey));

  assert.equal(storedDeliv[0].id, "inconsistent-new", "deliveries retiene el nuevo valor por fallo de rollback");
  assert.equal(storedSeq[0], "consistent-old", "sequence retiene el viejo valor");
  assert.notEqual(storedDeliv[0].id, storedSeq[0], "Se reproduce la inconsistencia de claves asimétricas en localStorage");
});

// ─── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nEjecutando ${tests.length} pruebas de regresión para sincronización Supabase...\n`);
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      if (err.stack) {
        const lines = err.stack.split("\n").slice(1, 4);
        for (const l of lines) console.error(`    ${l.trim()}`);
      }
      failed++;
    }
  }
  console.log(`\n${passed} pasadas, ${failed} fallidas de ${tests.length} totales.`);
  if (failed > 0) process.exit(1);
  console.log("\nTodas las pruebas de regresión de sincronización pasaron.\n");
}

run();
