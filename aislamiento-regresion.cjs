const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

// Regresión de aislamiento entre cuentas: ejercita las funciones REALES de
// almacenamiento por usuario y de listado remoto, extrayéndolas del código
// con el mismo patrón que empresas-regresion.cjs. Dobles simulados solo en
// los límites externos (localStorage y cliente Supabase/auth).
const appPath = path.resolve(process.cwd(), "App.tsx");
const decaSectionPath = path.resolve(process.cwd(), "DeCASection.tsx");
const servicePath = path.resolve(process.cwd(), "decaSupabaseService.ts");
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
const decaSectionSource = read(decaSectionPath, ts.ScriptKind.TSX);
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
      register(node.name.text, node.getText(ast).replace(/^export\s+/, ""));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

collect(recipientsSource, ["userStorageKey"]);
collect(appSource, [
  "STORAGE_KEY",
  "SEQUENCE_KEY",
  "safeGetItem",
  "deliveriesStorageKey",
  "sequenceStorageKey",
  "loadDeliveriesForUser",
  "loadSequenceForUser",
  "persistUserScopedJornada",
  "canPersistForCurrentSession",
]);
// "STORAGE_KEY" colisiona entre App.tsx y DeCASection.tsx: la constante de
// DeCASection se extrae con otro nombre para poder ejercitar loadDecas real.
collect(decaSectionSource, ["STORAGE_KEY"], {
  rename: { STORAGE_KEY: "DECAS_STORAGE_KEY" },
});
collect(decaSectionSource, [
  "DECA_PENDING_DELETES_STORAGE_KEY",
  "MATRICULAS_STORAGE_KEY",
  "TRANSPORTISTAS_STORAGE_KEY",
  "TRANSPORTISTAS_DELETES_STORAGE_KEY",
  "TRANSPORTISTAS_PENDING_SYNC_STORAGE_KEY",
  "isRemoteDecaReference",
  "readRemoteDecaReferences",
  "isActiveLocalDeCA",
  "loadDecas",
  "loadMatriculas",
  "loadTransportistas",
  "loadPendingTransportistaDeletes",
  "loadTransportistaPendingSync",
], { rename: { STORAGE_KEY: "DECAS_STORAGE_KEY" } });
collect(serviceSource, ["DECA_COLUMNS", "listUserDecas"]);
for (const name of [
  "userStorageKey",
  "STORAGE_KEY",
  "SEQUENCE_KEY",
  "safeGetItem",
  "deliveriesStorageKey",
  "sequenceStorageKey",
  "loadDeliveriesForUser",
  "loadSequenceForUser",
  "persistUserScopedJornada",
  "canPersistForCurrentSession",
  "DECAS_STORAGE_KEY",
  "loadDecas",
  "loadMatriculas",
  "loadTransportistas",
  "loadPendingTransportistaDeletes",
  "loadTransportistaPendingSync",
  "DECA_COLUMNS",
  "listUserDecas",
]) {
  assert(declarations.has(name), `Falta ${name}`);
}

const compiled = ts.transpileModule(
  [...declarations.values()].join("\n") +
    "\nglobalThis.subject = {" +
    [...declarations.keys()].join(",") +
    "};",
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  },
);
const syntaxErrors = (compiled.diagnostics || []).filter(
  (d) => d.category === ts.DiagnosticCategory.Error,
);
assert.equal(syntaxErrors.length, 0, "Error de sintaxis al extraer las funciones");

const userA = "usuario-a";
const userB = "usuario-b";

function fixture() {
  const state = { eqCalls: [], rows: [{ id: "1", user_id: userA }] };
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
  const sandbox = {
    console: { error: () => {} },
    localStorage,
    window: { localStorage },
    requireCurrentUserId: async () => userA,
    throwSupabaseError: (operation, message) => {
      throw new Error(`${operation}: ${message}`);
    },
    supabase: {
      from: (table) => ({
        select: () => ({
          eq: (column, value) => {
            state.eqCalls.push({ table, column, value });
            return {
              returns: async () => ({ data: state.rows, error: null }),
            };
          },
        }),
      }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled.outputText, sandbox, { timeout: 5000 });
  return { state, store, subject: sandbox.subject };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("las claves por usuario son disjuntas y la reserva global no se usa", () => {
  const f = fixture();
  const s = f.subject;
  assert.equal(s.STORAGE_KEY, "logiroute_deliveries_v3");
  assert.equal(s.deliveriesStorageKey(), "logiroute_deliveries_v3");
  assert.notEqual(s.deliveriesStorageKey(userA), s.deliveriesStorageKey(userB));
  assert.notEqual(s.sequenceStorageKey(userA), s.sequenceStorageKey(userB));
  // Reserva global presente: no se lee sin sesión ni para otra cuenta.
  f.store.set(s.STORAGE_KEY, JSON.stringify([{ id: "legacy" }]));
  assert.equal(s.loadDeliveriesForUser().length, 0, "sin sesión no se lee la reserva global");
  assert.equal(s.loadDeliveriesForUser(userB).length, 0, "B no lee la reserva global");
});

test("cambio de sesión A→B: no se escriben datos de A bajo la clave de B", () => {
  const f = fixture();
  const s = f.subject;
  const deliveryA = { id: "parada-a", decaId: "d1" };
  // A hidrata y persiste su jornada.
  assert.equal(s.canPersistForCurrentSession({ id: userA }, userA), true);
  assert.equal(s.persistUserScopedJornada(userA, [deliveryA], ["seq-a"]), true);
  // Transición: con el estado aún hidratado de A, el gate impide persistir.
  assert.equal(s.canPersistForCurrentSession({ id: userB }, userA), false);
  assert.equal(s.canPersistForCurrentSession({ id: userB }, null), false);
  assert.equal(s.canPersistForCurrentSession(null, null), false);
  // Hidratación de B completada: persiste solo lo suyo (vacío).
  assert.equal(s.canPersistForCurrentSession({ id: userB }, userB), true);
  assert.equal(s.persistUserScopedJornada(userB, [], []), true);
  assert.equal(s.loadDeliveriesForUser(userB).length, 0, "B no ve datos de A");
  assert.equal(
    JSON.stringify(s.loadDeliveriesForUser(userA)),
    JSON.stringify([deliveryA]),
  );
  assert.equal(
    JSON.stringify(s.loadSequenceForUser(userA)),
    JSON.stringify(["seq-a"]),
  );
  assert.equal(s.loadSequenceForUser(userB).length, 0);
  // La reserva global heredada queda intacta.
  assert.equal(f.store.has(s.STORAGE_KEY), false);
});

test("la cache de DeCAs usa la clave del usuario y filtra pendientes por propietario", () => {
  const f = fixture();
  const s = f.subject;
  const row = { id: "deca-1", deleted_at: null };
  f.store.set(s.DECAS_STORAGE_KEY, JSON.stringify([row]));
  assert.equal(s.loadDecas().length, 0, "sin sesión no se lee la reserva global");
  assert.equal(s.loadDecas(userB).length, 0, "B no hereda la reserva global");
  f.store.set(s.userStorageKey(s.DECAS_STORAGE_KEY, userA), JSON.stringify([row]));
  f.store.set(s.userStorageKey(s.DECAS_STORAGE_KEY, userB), JSON.stringify([row]));
  // Pendiente de borrado de A en la clave global (etiquetado por userId).
  f.store.set(
    s.DECA_PENDING_DELETES_STORAGE_KEY,
    JSON.stringify([{ id: "deca-1", userId: userA }]),
  );
  assert.equal(s.loadDecas(userA).length, 0, "el pendiente propio sí filtra");
  assert.equal(s.loadDecas(userB).length, 1, "el pendiente de A no afecta a B");
});

test("transportistas, matrículas y pendientes: B no procesa los datos de A", () => {
  const f = fixture();
  const s = f.subject;
  const carrier = {
    id: "c1", nombre: "T", nif: "", direccion: "", ciudad: "", codigoPostal: "",
    provincia: "", pais: "", telefono: "", email: "", notas: "",
    createdAt: "2026-01-01", updatedAt: "2026-01-01", esPredeterminado: true,
  };
  const plate = { id: "p1", valor: "1111 AAA", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  f.store.set(s.TRANSPORTISTAS_STORAGE_KEY, JSON.stringify([carrier]));
  f.store.set(s.MATRICULAS_STORAGE_KEY, JSON.stringify([plate]));
  f.store.set(s.TRANSPORTISTAS_DELETES_STORAGE_KEY, JSON.stringify(["c1"]));
  f.store.set(s.TRANSPORTISTAS_PENDING_SYNC_STORAGE_KEY, "true");
  // B: nada de esto es suyo.
  assert.equal(s.loadTransportistas(userB).items.length, 0);
  assert.equal(s.loadMatriculas(userB).items.length, 0);
  assert.equal(s.loadPendingTransportistaDeletes(userB).length, 0);
  assert.equal(s.loadTransportistaPendingSync(userB), false);
  assert.equal(s.loadTransportistas().items.length, 0, "sin sesión no se lee nada");
  // A: sus claves propias sí.
  f.store.set(s.userStorageKey(s.TRANSPORTISTAS_STORAGE_KEY, userA), JSON.stringify([carrier]));
  f.store.set(s.userStorageKey(s.MATRICULAS_STORAGE_KEY, userA), JSON.stringify([plate]));
  f.store.set(s.userStorageKey(s.TRANSPORTISTAS_DELETES_STORAGE_KEY, userA), JSON.stringify(["c1"]));
  f.store.set(s.userStorageKey(s.TRANSPORTISTAS_PENDING_SYNC_STORAGE_KEY, userA), "true");
  assert.equal(s.loadTransportistas(userA).items.length, 1);
  assert.equal(s.loadMatriculas(userA).items.length, 1);
  assert.equal(s.loadPendingTransportistaDeletes(userA).length, 1);
  assert.equal(s.loadTransportistaPendingSync(userA), true);
});

test("listUserDecas limita la consulta al propietario autenticado", async () => {
  const f = fixture();
  const rows = await f.subject.listUserDecas();
  assert.deepEqual(f.state.eqCalls, [
    { table: "decas", column: "user_id", value: userA },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(f.subject.DECA_COLUMNS.split(",").slice(0, 2), ["id", "user_id"]);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL: ${name}`);
      console.error(error);
    }
  }
  console.log(`\nResultado: ${tests.length - failed}/${tests.length} pruebas correctas.`);
  console.log("Pruebas de lógica con dobles simulados. No prueban la interfaz ni llaman a Supabase.");
  if (failed > 0) process.exit(1);
})();