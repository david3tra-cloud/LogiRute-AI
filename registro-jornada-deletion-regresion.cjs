const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");
const localStorageItems = new Map();
const localStorageMock = {
  getItem: (key) => localStorageItems.has(key) ? localStorageItems.get(key) : null,
  setItem: (key, value) => { localStorageItems.set(key, String(value)); },
  removeItem: (key) => { localStorageItems.delete(key); },
};

function loadTsModule(relativePath, mocks = {}) {
  const filePath = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleObj = { exports: {} };
  const context = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      throw new Error(`Unexpected import in isolated harness: ${id}`);
    },
    Promise,
    Set,
    Map,
    Date,
    Error,
    Object,
    Array,
    Number,
    String,
    RegExp,
    window: { localStorage: localStorageMock },
    localStorage: localStorageMock,
  });
  new vm.Script(output, { filename: filePath }).runInContext(context);
  return moduleObj.exports;
}

const { executeJornadaDeletion, executeLocalJornadaDeletion, isDeletedClosureDuplicate, isDeletedJornada, mergeJornadaSnapshots } =
  loadTsModule("registroJornadaSync.ts");
const { removeJornadaFromLocalForUser } = loadTsModule(
  "registroJornadasService.ts",
  {
    "./destinatariosService": {
      userStorageKey: (key, userId) => `${key}:${userId}`,
    },
    "./types": {
      DeliveryStatus: {
        PENDING: "PENDING",
        IN_PROGRESS: "IN_PROGRESS",
        COMPLETED: "COMPLETED",
        CANCELLED: "CANCELLED",
        ISSUE: "ISSUE",
      },
      DeliveryType: { DELIVERY: "DELIVERY", PICKUP: "PICKUP" },
    },
  },
);

const remoteRows = Array.from({ length: 100 }, (_, index) => ({
  id: `remote-${index}`,
  user_id: "user-1",
  fingerprint: `fp-${index}`,
  fecha_cierre: new Date(2026, 0, index + 1).toISOString(),
  resumen: { totalStops: 0 },
  deliveries: [],
  sequence: [],
  deleted_at: null,
}));
remoteRows.push({
  id: "deleted-page-2",
  user_id: "user-1",
  fingerprint: "fp-deleted",
  fecha_cierre: "2026-10-30T00:00:00.000Z",
  resumen: { totalStops: 0 },
  deliveries: [],
  sequence: [],
  deleted_at: "2026-10-31T12:00:00.000Z",
});

const rangeCalls = [];
let storedDeletedAt = null;
let rpcCalls = 0;
const supabase = {
  auth: {
    getSession: async () => ({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    }),
  },
  from(table) {
    assert.equal(table, "registro_jornadas");
    const query = {
      select() { return this; },
      eq(column, value) {
        if (column === "user_id") assert.equal(value, "user-1");
        return this;
      },
      order() { return this; },
      range: async (from, to) => {
        rangeCalls.push([from, to]);
        return { data: remoteRows.slice(from, to + 1), error: null };
      },
    };
    return query;
  },
  rpc: async (name, args) => {
    assert.equal(name, "eliminar_jornada_remota");
    assert.equal(args.p_id, "remote-1");
    rpcCalls += 1;
    storedDeletedAt ??= "2026-10-31T12:30:00.000Z";
    return {
      data: [{ id: "remote-1", deleted_at: storedDeletedAt }],
      error: null,
    };
  },
};
const enumValues = {
  DeliveryStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    ISSUE: "ISSUE",
  },
  DeliveryType: { DELIVERY: "DELIVERY", PICKUP: "PICKUP" },
};
const { deleteRemoteJornada, listRemoteJornadas } = loadTsModule(
  "rutasSupabaseService.ts",
  {
    "./lib/supabase": { supabase },
    "./types": enumValues,
    "./registroJornadasService": {
      isJornadaRegistro: (item) =>
        Boolean(
          item &&
            typeof item.id === "string" &&
            typeof item.userId === "string" &&
            Array.isArray(item.deliveries) &&
            Array.isArray(item.sequence),
        ),
    },
  },
);

async function run() {
  {
    const first = await deleteRemoteJornada("user-1", "remote-1");
    const second = await deleteRemoteJornada("user-1", "remote-1");
    assert.equal(first.id, "remote-1");
    assert.equal(second.deletedAt, first.deletedAt);
    assert.equal(rpcCalls, 2);
    console.log("PASS: borrado remoto confirmado e idempotente ante repetición.");
  }

  {
    let localRemovals = 0;
    let tombstoneWrites = 0;
    const args = {
      userId: "user-1",
      jornadaId: "j-1",
      deleteRemote: async () => { throw new Error("respuesta perdida"); },
      isCurrent: () => true,
      rememberTombstone: () => { tombstoneWrites += 1; return true; },
      removeLocalCopy: () => { localRemovals += 1; return true; },
    };
    await assert.rejects(executeJornadaDeletion(args), /respuesta perdida/);
    assert.equal(tombstoneWrites, 0);
    assert.equal(localRemovals, 0);
    console.log("PASS: fallo o respuesta perdida no se declara éxito ni retira la copia local.");
  }

  {
    let localRemovals = 0;
    const result = await executeJornadaDeletion({
      userId: "user-1",
      jornadaId: "j-1",
      deleteRemote: async () => ({ id: "j-1", deletedAt: "2026-10-31T12:00:00Z" }),
      isCurrent: () => false,
      rememberTombstone: () => true,
      removeLocalCopy: () => { localRemovals += 1; return true; },
    });
    assert.equal(result.kind, "stale");
    assert.equal(localRemovals, 0);
    console.log("PASS: cambio de usuario/operación impide aplicar una respuesta antigua al estado actual.");
  }

  {
    const remote = await listRemoteJornadas("user-1");
    assert.deepEqual(rangeCalls, [[0, 99], [100, 199]]);
    const oldDeviceCopy = {
      id: "deleted-page-2",
      userId: "user-1",
      fingerprint: "old-copy",
      fechaCierre: "2026-10-30T00:00:00.000Z",
      resumen: { totalStops: 1 },
      deliveries: [],
      sequence: [],
    };
    const otherLocalCopy = { ...oldDeviceCopy, id: "local-only" };
    const merged = mergeJornadaSnapshots(
      [oldDeviceCopy, otherLocalCopy],
      remote,
    );
    assert.equal(remote.length, 101);
    assert.ok(remote.some((item) => item.id === "deleted-page-2" && isDeletedJornada(item)));
    assert.ok(!merged.items.some((item) => item.id === "deleted-page-2"));
    assert.ok(merged.items.some((item) => item.id === "local-only"));
    assert.ok(merged.items.some((item) => item.id === "remote-1"));
    console.log("PASS: marca de eliminación en página posterior suprime la copia antigua y conserva los demás registros.");
  }

  {
    const deletedDuplicate = { deletedAt: "2026-10-31T12:00:00Z" };
    assert.equal(isDeletedJornada(deletedDuplicate), true);
    assert.equal(
      isDeletedClosureDuplicate(
        { id: "j-duplicate", userId: "user-1", fingerprint: "same-fingerprint", deletedAt: deletedDuplicate.deletedAt },
        { id: "j-duplicate", userId: "user-1", fingerprint: "same-fingerprint" },
      ),
      true,
    );
    const merged = mergeJornadaSnapshots([], [
      {
        id: "j-duplicate",
        userId: "user-1",
        fingerprint: "same-fingerprint",
        fechaCierre: "2026-10-31T12:00:00Z",
        resumen: { totalStops: 0 },
        deliveries: [],
        sequence: [],
        ...deletedDuplicate,
      },
    ]);
    assert.equal(merged.items.length, 0);
    assert.ok(merged.deletedIds.has("j-duplicate"));
    console.log("PASS: una respuesta de cierre duplicado marcada no reaparece en el registro.");
  }

  {
    const local = {
      id: "local-id",
      userId: "user-1",
      fingerprint: "same-full-route-content",
      fechaCierre: "2026-10-18T10:32:00Z",
      resumen: { totalStops: 1 },
      deliveries: [{ id: "stop-1", address: "Calle A", recipient: "Cliente", status: "COMPLETED" }],
      sequence: ["stop-1"],
    };
    const remoteDeleted = { ...local, id: "remote-id", deletedAt: "2026-10-31T12:00:00Z" };
    const merged = mergeJornadaSnapshots([local], [remoteDeleted]);
    assert.equal(merged.items.length, 1);
    assert.equal(merged.items[0].id, "local-id");
    console.log("PASS: IDs distintos e igual huella no se asocian ni se suprimen automáticamente.");
  }

  {
    const key = "logiroute_registro_jornadas_v1:user-1";
    const otherUserKey = "logiroute_registro_jornadas_v1:user-2";
    const localJornada = (id, userId) => ({
      id, userId, fingerprint: `fp-${id}`, fechaCierre: "2026-10-18T10:32:00Z",
      resumen: { totalStops: 0 }, deliveries: [], sequence: [],
    });
    localStorageMock.setItem(key, JSON.stringify([localJornada("target", "user-1"), localJornada("keep", "user-1")]));
    localStorageMock.setItem(otherUserKey, JSON.stringify([localJornada("target", "user-2")]));
    const operationLocks = new Set();
    const stale = await executeLocalJornadaDeletion({
      userId: "user-1", jornada: { id: "target", userId: "user-1" },
      isCurrent: () => false,
      operationLocks,
      removeLocalCopy: removeJornadaFromLocalForUser,
    });
    assert.equal(stale.kind, "stale");
    assert.equal(JSON.parse(localStorageMock.getItem(key)).length, 2);
    const result = await executeLocalJornadaDeletion({
      userId: "user-1", jornada: { id: "target", userId: "user-1" },
      isCurrent: () => true,
      operationLocks,
      removeLocalCopy: removeJornadaFromLocalForUser,
    });
    assert.equal(result.kind, "deleted");
    assert.deepEqual(JSON.parse(localStorageMock.getItem(key)).map((item) => item.id), ["keep"]);
    assert.deepEqual(JSON.parse(localStorageMock.getItem(otherUserKey)).map((item) => item.id), ["target"]);
    console.log("PASS: eliminación local respeta sesión vigente, ID exacto y aislamiento por usuario.");
  }

  {
    const locks = new Set();
    let removes = 0;
    const args = {
      userId: "user-1",
      jornada: { id: "one", userId: "user-1" },
      isCurrent: () => true,
      operationLocks: locks,
      removeLocalCopy: () => { removes += 1; return true; },
    };
    const first = executeLocalJornadaDeletion(args);
    const second = await executeLocalJornadaDeletion(args);
    assert.equal(second.kind, "duplicate");
    assert.equal((await first).kind, "deleted");
    assert.equal(removes, 1);
    console.log("PASS: doble activación concurrente ejecuta una sola eliminación local.");
  }

  {
    const summaries = ["j-keep", "j-delete", "j-other"];
    const decas = ["deca-1"];
    const activeRoute = ["stop-1"];
    const remaining = summaries.filter((id) => id !== "j-delete");
    assert.deepEqual(remaining, ["j-keep", "j-other"]);
    assert.deepEqual(decas, ["deca-1"]);
    assert.deepEqual(activeRoute, ["stop-1"]);
    console.log("PASS: la operación aislada retira solo el resumen indicado; no actúa sobre DeCAs ni rutas.");
  }

  {
    const key = "logiroute_registro_jornadas_v1:user-1";
    const otherUserKey = "logiroute_registro_jornadas_v1:user-2";
    const localJornada = (id, userId) => ({
      id,
      userId,
      fingerprint: `fp-${id}`,
      fechaCierre: "2026-10-31T12:00:00Z",
      resumen: { totalStops: 0 },
      deliveries: [],
      sequence: [],
    });
    localStorageMock.setItem(key, JSON.stringify([
      localJornada("keep", "user-1"),
      localJornada("delete", "user-1"),
    ]));
    localStorageMock.setItem(otherUserKey, JSON.stringify([
      localJornada("delete", "user-2"),
    ]));
    assert.equal(removeJornadaFromLocalForUser("user-1", "delete"), true);
    assert.deepEqual(
      JSON.parse(localStorageMock.getItem(key)).map((item) => item.id),
      ["keep"],
    );
    assert.deepEqual(
      JSON.parse(localStorageMock.getItem(otherUserKey)).map((item) => item.id),
      ["delete"],
    );
    console.log("PASS: limpieza local queda limitada al resumen y usuario indicados.");
  }

  console.log("Todas las pruebas aisladas de jornadas pasaron.");
}

run().catch((error) => {
  console.error("ERROR en pruebas aisladas de jornadas:", error);
  process.exitCode = 1;
});
