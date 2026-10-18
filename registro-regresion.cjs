const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

// Regresión de Cerrar jornada y Registro: ejercita las funciones REALES
// del flujo de cierre, marcador pending_closure, rollback, recuperación
// y prevención de duplicados, extrayéndolas directamente de App.tsx,
// registroJornadasService.ts y destinatariosService.ts.

const appPath = path.resolve(process.cwd(), "App.tsx");
const servicePath = path.resolve(process.cwd(), "registroJornadasService.ts");
const recipientsPath = path.resolve(process.cwd(), "destinatariosService.ts");

const read = (file, kind) =>
  ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    kind,
  );

const appSource = read(appPath, ts.ScriptKind.TSX);
const serviceSource = read(servicePath, ts.ScriptKind.TS);
const recipientsSource = read(recipientsPath, ts.ScriptKind.TS);

const declarations = new Map();
function collect(ast, names, { rename = {} } = {}) {
  const register = (original, text) => {
    const finalName = rename[original] ?? original;
    assert(!declarations.has(finalName), `Función duplicada: ${finalName}`);
    let out = text;
    for (const [from, to] of Object.entries(rename)) {
      out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
    }
    declarations.set(finalName, out);
  };
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text)
    ) {
      register(node.name.text, `const ${node.getText(ast)};`);
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      names.includes(node.name.text)
    ) {
      register(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

// 1. Helpers de destinatarios
collect(recipientsSource, ["userStorageKey"]);

// 2. Helpers y constantes de App
collect(appSource, [
  "STORAGE_KEY",
  "SEQUENCE_KEY",
  "deliveriesStorageKey",
  "sequenceStorageKey",
  "persistUserScopedJornadaWithRollback",
  "persistUserScopedJornada",
  "canPersistForCurrentSession",
]);

// 3. Servicio de Registro y Cierre
collect(serviceSource, [
  "REGISTRO_JORNADAS_STORAGE_KEY",
  "PENDING_CLOSURE_STORAGE_KEY",
  "getRegistroStorageKey",
  "getPendingClosureStorageKey",
  "safeGetItem",
  "computeRouteFingerprint",
  "generateStableId",
  "isPendingClosureMarker",
  "loadPendingClosureMarker",
  "savePendingClosureMarker",
  "removePendingClosureMarker",
  "isJornadaRegistro",
  "calculateJornadaResumen",
  "loadRegistroJornadasWithStatus",
  "loadRegistroJornadasForUser",
  "archiveJornadaForUser",
  "executeCerrarJornada",
]);

for (const name of [
  "userStorageKey",
  "STORAGE_KEY",
  "SEQUENCE_KEY",
  "deliveriesStorageKey",
  "sequenceStorageKey",
  "persistUserScopedJornadaWithRollback",
  "persistUserScopedJornada",
  "canPersistForCurrentSession",
  "REGISTRO_JORNADAS_STORAGE_KEY",
  "PENDING_CLOSURE_STORAGE_KEY",
  "getRegistroStorageKey",
  "getPendingClosureStorageKey",
  "safeGetItem",
  "computeRouteFingerprint",
  "generateStableId",
  "isPendingClosureMarker",
  "loadPendingClosureMarker",
  "savePendingClosureMarker",
  "removePendingClosureMarker",
  "isJornadaRegistro",
  "calculateJornadaResumen",
  "loadRegistroJornadasWithStatus",
  "loadRegistroJornadasForUser",
  "archiveJornadaForUser",
  "executeCerrarJornada",
]) {
  assert(declarations.has(name), `Falta declaración requerida: ${name}`);
}

const compiled = ts.transpileModule(
  [...declarations.values()].join("\n") +
    "\nglobalThis.subject = {" +
    [...declarations.keys()].join(",") +
    "};",
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
    reportDiagnostics: true,
  },
);

const syntaxErrors = (compiled.diagnostics || []).filter(
  (d) => d.category === ts.DiagnosticCategory.Error,
);
assert.equal(
  syntaxErrors.length,
  0,
  "Error de compilación al extraer funciones de Registro",
);

const userA = "usuario-test-a";
const userB = "usuario-test-b";

function fixture() {
  const store = new Map();
  const interceptors = {
    beforeSetItem: null,
    beforeRemoveItem: null,
  };

  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      if (interceptors.beforeSetItem) {
        interceptors.beforeSetItem(key, value);
      }
      store.set(key, String(value));
    },
    removeItem: (key) => {
      if (interceptors.beforeRemoveItem) {
        interceptors.beforeRemoveItem(key);
      }
      store.delete(key);
    },
  };

  const sandbox = {
    console: { error: () => {}, warn: () => {} },
    localStorage,
    window: { localStorage },
    DeliveryStatus: {
      PENDING: "PENDING",
      IN_PROGRESS: "IN_PROGRESS",
      COMPLETED: "COMPLETED",
      CANCELLED: "CANCELLED",
      ISSUE: "ISSUE",
    },
    DeliveryType: {
      DELIVERY: "DELIVERY",
      PICKUP: "PICKUP",
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(compiled.outputText, sandbox, { timeout: 5000 });

  return {
    store,
    subject: sandbox.subject,
    interceptors,
  };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("1. Dos jornadas de contenido exactamente idéntico generan dos IDs distintos tras completar el primer cierre", async () => {
  const f = fixture();
  const s = f.subject;

  const rutaHabitual = [
    {
      id: "hab-1",
      recipient: "Cliente Habitual A",
      address: "Polígono 1",
      status: "COMPLETED",
      type: "DELIVERY",
    },
    {
      id: "hab-2",
      recipient: "Cliente Habitual B",
      address: "Polígono 2",
      status: "COMPLETED",
      type: "PICKUP",
    },
  ];
  const seq = ["hab-1", "hab-2"];

  // Cierre jornada Día 1
  s.persistUserScopedJornada(userA, rutaHabitual, seq);
  const cierreDia1 = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries: rutaHabitual,
    manualSequence: seq,
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {},
    confirmFinishFn: () => true,
  });
  assert.equal(cierreDia1.status, "SUCCESS");
  const idDia1 = cierreDia1.jornada.id;

  // Se confirma que el marcador transitorio fue retirado tras concluir con éxito
  assert.equal(s.loadPendingClosureMarker(userA), null);

  // Cierre jornada Día 2 con EXACTAMENTE el mismo contenido y paradas
  s.persistUserScopedJornada(userA, rutaHabitual, seq);
  const cierreDia2 = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries: rutaHabitual,
    manualSequence: seq,
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {},
    confirmFinishFn: () => true,
  });
  assert.equal(cierreDia2.status, "SUCCESS");
  const idDia2 = cierreDia2.jornada.id;

  assert.notEqual(
    idDia1,
    idDia2,
    "Una jornada nueva con contenido idéntico debe obtener un ID nuevo y no reutilizar la antigua",
  );

  const registro = s.loadRegistroJornadasForUser(userA);
  assert.equal(registro.length, 2, "Deben existir 2 jornadas archivadas");
  assert.equal(registro[0].id, idDia2);
  assert.equal(registro[1].id, idDia1);
});

test("2. Fallo al guardar el marcador: la ruta se mantiene intacta y no se archiva nada", async () => {
  const f = fixture();
  const s = f.subject;

  const deliveries = [
    { id: "del-1", recipient: "Test", address: "Calle 1", status: "COMPLETED", type: "DELIVERY" },
  ];
  s.persistUserScopedJornada(userA, deliveries, ["del-1"]);

  // Interceptar escritura del marcador para simular fallo
  f.interceptors.beforeSetItem = (key) => {
    if (key === s.getPendingClosureStorageKey(userA)) {
      throw new Error("QuotaExceededError simulado al guardar marcador");
    }
  };

  let routeCleared = false;
  const result = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: ["del-1"],
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {
      routeCleared = true;
    },
    confirmFinishFn: () => true,
  });

  assert.equal(result.status, "ARCHIVE_FAILED");
  assert.equal(routeCleared, false, "No debe vaciar la ruta si falló el marcador");
  assert.equal(s.loadRegistroJornadasForUser(userA).length, 0, "No debe crear registro");
  assert.equal(
    JSON.parse(f.store.get(s.deliveriesStorageKey(userA))).length,
    1,
    "La ruta en storage permanece intacta",
  );
});

test("3. Fallo en la segunda escritura del vaciado ejecuta rollback restaurando paradas", async () => {
  const f = fixture();
  const s = f.subject;

  const deliveries = [
    { id: "rb-1", recipient: "Rollback Test", address: "C/ 1", status: "COMPLETED", type: "DELIVERY" },
  ];
  s.persistUserScopedJornada(userA, deliveries, ["rb-1"]);

  // Simular fallo en sequenceStorageKey al vaciar (cuando se intenta escribir "[]")
  const seqKey = s.sequenceStorageKey(userA);
  f.interceptors.beforeSetItem = (key, value) => {
    if (key === seqKey && value === "[]") {
      throw new Error("Fallo simulado al escribir secuencia vacía");
    }
  };

  let clearedInReact = false;
  const result = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: ["rb-1"],
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {
      clearedInReact = true;
    },
    confirmFinishFn: () => true,
  });

  assert.equal(result.status, "PARTIAL_SUCCESS");
  assert.equal(clearedInReact, false);

  // El archivo en Registro SÍ se conservó
  const reg = s.loadRegistroJornadasForUser(userA);
  assert.equal(reg.length, 1);

  // La ruta activa fue restaurada por el rollback en storage
  const activeDeliveries = JSON.parse(f.store.get(s.deliveriesStorageKey(userA)));
  assert.equal(activeDeliveries.length, 1, "Rollback debe restaurar deliveries");
  assert.equal(activeDeliveries[0].id, "rb-1");

  // El marcador sigue presente para permitir reintento sin duplicados
  const marker = s.loadPendingClosureMarker(userA);
  assert(marker !== null, "El marcador debe conservarse para reintento");
  assert.equal(marker.status, "CLEARING_ROUTE");
});

test("4. Fallo adicional del rollback y recuperación tras recarga sin bloquearse por ruta vacía", async () => {
  const f = fixture();
  const s = f.subject;

  const deliveries = [
    { id: "asym-1", recipient: "Asimétrico", address: "Av 2", status: "COMPLETED", type: "DELIVERY" },
  ];
  s.persistUserScopedJornada(userA, deliveries, ["asym-1"]);

  // Simular persistRouteFn donde falló la segunda escritura Y además falló el rollback
  const brokenPersistRoute = () => ({ ok: false, rollbackOk: false });

  // Simulamos que deliveries quedó [] y sequence quedó ["asym-1"] en storage
  f.store.set(s.deliveriesStorageKey(userA), "[]");
  f.store.set(s.sequenceStorageKey(userA), JSON.stringify(["asym-1"]));

  const attempt = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: ["asym-1"],
    persistRouteFn: brokenPersistRoute,
    onRouteCleared: () => {},
    confirmFinishFn: () => true,
  });
  assert.equal(attempt.status, "PARTIAL_SUCCESS");

  // Ahora simulamos que el usuario RECARGA la página:
  // Al recargar, deliveries en memoria/storage es [] pero sequence es ["asym-1"]
  // El usuario vuelve a pulsar "Cerrar jornada" con deliveries vacíos:
  let recoveryCleared = false;
  const recoveryAttempt = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries: [], // Ruta vacía al recargar
    manualSequence: ["asym-1"],
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {
      recoveryCleared = true;
    },
  });

  assert.equal(
    recoveryAttempt.status,
    "RECOVERY_COMPLETED",
    "No debe bloquearse con EMPTY_ROUTE; debe completar la recuperación",
  );
  assert.equal(recoveryCleared, true);

  // La secuencia en storage ahora sí quedó limpia
  assert.equal(JSON.parse(f.store.get(s.sequenceStorageKey(userA))).length, 0);

  // No se duplicó en registro
  assert.equal(s.loadRegistroJornadasForUser(userA).length, 1);
});

test("5. Reintento tras fallo de vaciado no duplica el archivo", async () => {
  const f = fixture();
  const s = f.subject;

  const deliveries = [
    { id: "dup-1", recipient: "No Dup", address: "Calle 3", status: "COMPLETED", type: "DELIVERY" },
  ];
  const seq = ["dup-1"];
  s.persistUserScopedJornada(userA, deliveries, seq);

  let attemptPasses = false;
  const persistRouteMock = (u, d, sq) => {
    if (!attemptPasses) return { ok: false, rollbackOk: true };
    return s.persistUserScopedJornadaWithRollback(u, d, sq);
  };

  // Intento 1: falla vaciado
  const res1 = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: seq,
    persistRouteFn: persistRouteMock,
    onRouteCleared: () => {},
    confirmFinishFn: () => true,
  });
  assert.equal(res1.status, "PARTIAL_SUCCESS");
  const firstId = res1.jornada.id;

  // Intento 2: vaciado exitoso con el mismo lote
  attemptPasses = true;
  let clearedAttempt2 = false;
  const res2 = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: seq,
    persistRouteFn: persistRouteMock,
    onRouteCleared: () => {
      clearedAttempt2 = true;
    },
    confirmFinishFn: () => true,
  });

  assert.equal(res2.status, "SUCCESS");
  assert.equal(clearedAttempt2, true);
  assert.equal(res2.jornada.id, firstId, "Mantiene el mismo ID estable");
  assert.equal(s.loadRegistroJornadasForUser(userA).length, 1, "Sin duplicados en Registro");
});

test("6. Fallo al eliminar el marcador lo transiciona a COMPLETED", async () => {
  const f = fixture();
  const s = f.subject;

  const deliveries = [
    { id: "delmark-1", recipient: "Marker test", address: "C 4", status: "COMPLETED", type: "DELIVERY" },
  ];
  s.persistUserScopedJornada(userA, deliveries, ["delmark-1"]);

  // Simular fallo al hacer removeItem del marcador
  const markerKey = s.getPendingClosureStorageKey(userA);
  f.interceptors.beforeRemoveItem = (key) => {
    if (key === markerKey) {
      throw new Error("Fallo al eliminar clave de marcador");
    }
  };

  const result = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: ["delmark-1"],
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {},
    confirmFinishFn: () => true,
  });

  assert.equal(result.status, "SUCCESS");
  // El marcador debe existir pero con status COMPLETED para distinguir que ya concluyó
  const marker = s.loadPendingClosureMarker(userA);
  assert(marker !== null);
  assert.equal(marker.status, "COMPLETED");
});

test("7. Conflicto si hay marcador pendiente pero el contenido actual cambió", async () => {
  const f = fixture();
  const s = f.subject;

  // Pre-crear marcador pendiente con paradas viejas
  s.savePendingClosureMarker({
    id: "marker-conflict",
    userId: userA,
    fingerprint: JSON.stringify({ items: [["old-1", "COMPLETED"]], seq: ["old-1"] }),
    createdAt: new Date().toISOString(),
    status: "CLEARING_ROUTE",
  });

  // Ruta actual con paradas diferentes
  const deliveriesDifferent = [
    { id: "new-1", recipient: "Nueva", address: "C 5", status: "COMPLETED", type: "DELIVERY" },
  ];

  let cleared = false;
  const result = await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries: deliveriesDifferent,
    manualSequence: ["new-1"],
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {
      cleared = true;
    },
  });

  assert.equal(result.status, "CLOSURE_CONFLICT");
  assert.equal(cleared, false, "No debe vaciar datos ante conflicto");
});

test("8. Aislamiento A/B y conservación de todas las demás colecciones", async () => {
  const f = fixture();
  const s = f.subject;

  // Pre-poblar colecciones que deben quedar intactas
  const decasKey = s.userStorageKey("transport_app_decas", userA);
  const matriculasKey = s.userStorageKey("logiroute_matriculas_v1", userA);
  const transportistasKey = s.userStorageKey("logiroute_transportistas_v1", userA);
  const transPendingDeletesKey = s.userStorageKey("logiroute_transportistas_pending_deletes_v1", userA);
  const transPendingSyncKey = s.userStorageKey("logiroute_transportistas_pending_sync_v1", userA);
  const empresasKey = s.userStorageKey("logiroute_empresas_v1", userA);
  const globalTombstonesKey = "transport_app_decas_pending_deletes_v1";

  f.store.set(decasKey, JSON.stringify([{ id: "deca-safe" }]));
  f.store.set(matriculasKey, JSON.stringify([{ id: "mat-safe", valor: "5678CCC" }]));
  f.store.set(transportistasKey, JSON.stringify([{ id: "tr-safe", nombre: "Ana" }]));
  f.store.set(transPendingDeletesKey, JSON.stringify([{ id: "del-safe" }]));
  f.store.set(transPendingSyncKey, JSON.stringify([{ id: "sync-safe" }]));
  f.store.set(empresasKey, JSON.stringify([{ id: "emp-safe" }]));
  f.store.set(globalTombstonesKey, JSON.stringify([{ id: "t-safe", userId: userA }]));

  // Cierre de A
  const deliveries = [
    { id: "del-a", recipient: "A", address: "C/ A", status: "COMPLETED", type: "DELIVERY" },
  ];
  await s.executeCerrarJornada({
    user: { id: userA },
    hydratedUserId: userA,
    deliveries,
    manualSequence: ["del-a"],
    persistRouteFn: s.persistUserScopedJornadaWithRollback,
    onRouteCleared: () => {},
    confirmFinishFn: () => true,
  });

  // Verificar aislamiento: B no tiene registro ni marcador de A
  assert.equal(s.loadRegistroJornadasForUser(userB).length, 0);
  assert.equal(s.loadPendingClosureMarker(userB), null);

  // Verificar colecciones de A intactas
  assert.equal(JSON.parse(f.store.get(decasKey))[0].id, "deca-safe");
  assert.equal(JSON.parse(f.store.get(matriculasKey))[0].id, "mat-safe");
  assert.equal(JSON.parse(f.store.get(transportistasKey))[0].id, "tr-safe");
  assert.equal(JSON.parse(f.store.get(transPendingDeletesKey))[0].id, "del-safe");
  assert.equal(JSON.parse(f.store.get(transPendingSyncKey))[0].id, "sync-safe");
  assert.equal(JSON.parse(f.store.get(empresasKey))[0].id, "emp-safe");
  assert.equal(JSON.parse(f.store.get(globalTombstonesKey))[0].id, "t-safe");
});

async function run() {
  console.log(`Ejecutando ${tests.length} pruebas de regresión para Registro y Cerrar jornada...`);
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log("\nTodas las pruebas de regresión pasaron satisfactoriamente.");
}

run();
