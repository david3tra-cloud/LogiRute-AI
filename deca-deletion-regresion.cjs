const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTsModule(relativePath) {
  const filePath = path.resolve(process.cwd(), relativePath);
  const code = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const moduleObj = { exports: {} };
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: () => ({}),
    console,
    Date,
    Math,
    String,
    Number,
    Set,
    Map,
    Array,
    Promise,
    Error,
  });

  const script = new vm.Script(transpiled, { filename: filePath });
  script.runInContext(ctx);
  return moduleObj.exports;
}

const decaDeletion = loadTsModule("decaDeletionService.ts");

function createMockDeps(overrides = {}) {
  let pendingQueue = [];
  const inFlightInserts = new Set();
  const deletedInFlight = new Set();
  const remoteReferences = new Map(); // key: userId:id -> reference
  let currentUserId = "user-123";

  return {
    deleteRemoteDeca: async () => ({ deleted: true }),
    getCurrentUserId: async () => currentUserId,
    setCurrentUserId: (id) => { currentUserId = id; },
    findRemoteReference: (id, userId) => remoteReferences.get(`${userId}:${id}`),
    addKnownRemoteReference: (ref) => remoteReferences.set(`${ref.userId}:${ref.id}`, ref),
    readPendingDeletes: () => [...pendingQueue],
    enqueuePendingDelete: (ref) => {
      if (!pendingQueue.some((item) => item.id === ref.id && item.userId === ref.userId)) {
        pendingQueue.push(ref);
      }
      return true;
    },
    removePendingDelete: (ref) => {
      pendingQueue = pendingQueue.filter(
        (item) => item.id !== ref.id || item.userId !== ref.userId,
      );
      return true;
    },
    isInsertPending: (id) => inFlightInserts.has(id),
    markDeletedPendingInsert: (id) => deletedInFlight.add(id),
    addInFlightInsert: (id) => inFlightInserts.add(id),
    deletedPendingInsertIds: deletedInFlight,
    getQueue: () => [...pendingQueue],
    ...overrides,
  };
}

async function runTests() {
  console.log("Iniciando pruebas de regresión para decaDeletionService...");

  // Prueba 1: Fallo al encolar (persistencia local)
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps({
      enqueuePendingDelete: () => false,
    });
    const ref = { id: "deca-1", userId: "user-123" };
    const res = await decaDeletion.attemptRemoteDecaDelete(ref, deps);

    assert.equal(res.status, "unconfirmed");
    assert.equal(res.remoteConfirmed, false);
    assert.equal(res.queuedForRetry, false);
    assert.match(res.errorMessage, /No se pudo guardar la baja pendiente/);
    console.log("PASS 1: Fallo al encolar aborta sin llamar a remoto y reporta queuedForRetry=false.");
  }

  // Prueba 2: Servidor devuelve deleted === false
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps({
      deleteRemoteDeca: async () => ({ deleted: false }),
    });
    const ref = { id: "deca-2", userId: "user-123" };
    const res = await decaDeletion.attemptRemoteDecaDelete(ref, deps);

    assert.equal(res.status, "unconfirmed");
    assert.equal(res.remoteConfirmed, false);
    assert.equal(res.queuedForRetry, true);
    assert.equal(deps.getQueue().length, 1);
    console.log("PASS 2: Servidor responde deleted=false; la entrada permanece en la cola.");
  }

  // Prueba 3: Excepción remota (error de red o Supabase)
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps({
      deleteRemoteDeca: async () => { throw new Error("Fallo de red 503"); },
    });
    const ref = { id: "deca-3", userId: "user-123" };
    const res = await decaDeletion.attemptRemoteDecaDelete(ref, deps);

    assert.equal(res.status, "unconfirmed");
    assert.equal(res.remoteConfirmed, false);
    assert.equal(res.queuedForRetry, true);
    assert.match(res.errorMessage, /Fallo de red 503/);
    assert.equal(deps.getQueue().length, 1);
    console.log("PASS 3: Excepción remota conserva la entrada en cola para reintento.");
  }

  // Prueba 4: Baja confirmada en Supabase pero fallo al retirar la cola local
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps({
      deleteRemoteDeca: async () => ({ deleted: true }),
      removePendingDelete: () => false,
    });
    const ref = { id: "deca-4", userId: "user-123" };
    const res = await decaDeletion.attemptRemoteDecaDelete(ref, deps);

    assert.equal(res.status, "confirmed");
    assert.equal(res.remoteConfirmed, true);
    assert.equal(res.queueCleaned, false);
    assert.equal(res.queuedForRetry, true);
    assert.match(res.errorMessage, /no se pudo retirar la entrada de la cola local/);
    console.log("PASS 4: Baja remota confirmada con fallo de limpieza local no se degrada a fallo remoto.");
  }

  // Prueba 5: Concurrencia y registro de bloqueos (mismo userId + id)
  {
    decaDeletion.clearActiveDeletionLocks();
    let rpcCalls = 0;
    const deps = createMockDeps({
      deleteRemoteDeca: async () => {
        rpcCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return { deleted: true };
      },
    });
    const ref = { id: "deca-5", userId: "user-123" };

    const [res1, res2] = await Promise.all([
      decaDeletion.attemptRemoteDecaDelete(ref, deps),
      decaDeletion.attemptRemoteDecaDelete(ref, deps),
    ]);

    assert.equal(rpcCalls, 1, "Debe ejecutarse exactamente una llamada RPC compartida");
    assert.equal(res1.status, "confirmed");
    assert.equal(res2.status, "confirmed");
    assert.equal(decaDeletion.getActiveDeletionLockCount(), 0, "El bloqueo debe liberarse en finally");
    console.log("PASS 5: Concurrencia por userId+id comparte promesa y libera bloqueo.");
  }

  // Prueba 6: Cambio de usuario / sesión no coincidente
  {
    decaDeletion.clearActiveDeletionLocks();
    let rpcCalled = false;
    let enqueueCalled = false;
    const deps = createMockDeps({
      getCurrentUserId: async () => "otro-usuario",
      deleteRemoteDeca: async () => { rpcCalled = true; return { deleted: true }; },
      enqueuePendingDelete: () => { enqueueCalled = true; return true; },
    });
    const ref = { id: "deca-6", userId: "user-123" };
    const res = await decaDeletion.attemptRemoteDecaDelete(ref, deps);

    assert.equal(res.status, "unconfirmed");
    assert.equal(res.queuedForRetry, false, "No se debe marcar para reintento si no se encoló");
    assert.equal(rpcCalled, false, "No debe llamar al servidor si el usuario no coincide");
    assert.equal(enqueueCalled, false, "No debe encolar si el usuario no coincide");
    assert.equal(deps.getQueue().length, 0, "La cola inicialmente vacía debe seguir vacía");
    assert.match(res.errorMessage, /no coincide con el usuario/);
    console.log("PASS 6: Protección ante cambio de sesión; no ejecuta peticiones de otro usuario.");
  }

  // Prueba 7: Inserción en vuelo y tramitación completa
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps();
    deps.addInFlightInsert("deca-7");

    // Paso 7a: Solicitud de borrado mientras la inserción está en curso
    const deleteRes = await decaDeletion.deleteDecaDocument(
      { id: "deca-7", estado: "BORRADOR" },
      deps,
    );
    assert.equal(deleteRes.status, "in_flight_insert_marked");
    assert.ok(deps.deletedPendingInsertIds.has("deca-7"));

    // Paso 7b: La inserción remota finaliza y procesa la marca acumulada
    const ref = { id: "deca-7", userId: "user-123" };
    const insertRes = await decaDeletion.processCompletedInFlightInsert(
      ref,
      deps.deletedPendingInsertIds,
      deps,
    );
    assert.equal(insertRes.wasMarkedForDeletion, true);
    assert.equal(insertRes.deletionResult?.status, "confirmed");
    assert.equal(deps.deletedPendingInsertIds.has("deca-7"), false);
    console.log("PASS 7: Inserción en vuelo marcada y tramitada con baja remota al completar.");
  }

  // Prueba 8: Exclusión de documentos en estado EMITIENDO
  {
    decaDeletion.clearActiveDeletionLocks();
    let rpcCalled = false;
    const deps = createMockDeps({
      deleteRemoteDeca: async () => { rpcCalled = true; return { deleted: true }; },
    });
    const res = await decaDeletion.deleteDecaDocument(
      { id: "deca-8", estado: "EMITIENDO" },
      deps,
    );
    assert.equal(res.status, "rejected");
    assert.equal(rpcCalled, false);
    assert.match(res.errorMessage, /proceso de emisión/);
    console.log("PASS 8: Exclusión estricta de documentos en estado EMITIENDO.");
  }

  // Prueba 9: Documento con estado indeterminado (sin referencia ni en vuelo)
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps();
    const res = await decaDeletion.deleteDecaDocument(
      { id: "deca-desconocido", estado: "BORRADOR" },
      deps,
    );
    assert.equal(res.status, "rejected");
    assert.match(res.errorMessage, /No se pudo determinar el estado remoto/);
    console.log("PASS 9: Documentos sin evidencia remota ni en vuelo no se ocultan ni aceptan.");
  }

  // Prueba 10: Reintento de bajas en cola filtrando por usuario
  {
    decaDeletion.clearActiveDeletionLocks();
    const deps = createMockDeps();
    deps.enqueuePendingDelete({ id: "deca-10-mio", userId: "user-123" });
    deps.enqueuePendingDelete({ id: "deca-10-ajeno", userId: "user-456" });

    const retryRes = await decaDeletion.retryPendingDecaDeletes("user-123", deps);
    assert.equal(retryRes.completedIds.length, 1);
    assert.equal(retryRes.completedIds[0], "deca-10-mio");
    const queueRestante = deps.getQueue();
    assert.equal(queueRestante.length, 1);
    assert.equal(queueRestante[0].userId, "user-456", "La cola de otro usuario permanece intacta");
    console.log("PASS 10: retryPendingDecaDeletes procesa solo la sesión indicada y limpia confirmados.");
  }

  console.log("\nTodas las pruebas de regresión de borrado pasaron satisfactoriamente (10/10).");
}

runTests().catch((err) => {
  console.error("ERROR en pruebas de regresión:", err);
  process.exit(1);
});
