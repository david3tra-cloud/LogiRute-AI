const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTsModule(relativePath, mocks = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  const transpiled = ts.transpileModule(source, {
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
      throw new Error(`Unexpected dependency ${id} in ${relativePath}`);
    },
    console,
  });
  vm.runInContext(transpiled, context);
  return moduleObj.exports;
}

const normalizeRecipientText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();

const identity = loadTsModule("decaTransportistaIdentity.ts", {
  "./destinatariosService": { normalizeRecipientText },
});

const profileA = {
  id: "legacy-a",
  nombre: "Transportista repetido",
  nif: "T-A",
  direccion: "Calle A",
  ciudad: "Madrid",
  codigoPostal: "28001",
  provincia: "Madrid",
  pais: "España",
  telefono: "600000001",
  email: "a@example.test",
  notas: "Ficha A",
  esPredeterminado: false,
  createdAt: "",
  updatedAt: "",
};
const profileB = {
  ...profileA,
  id: "legacy-b",
  nif: "T-B",
  direccion: "Calle B",
  telefono: "600000002",
  email: "b@example.test",
  notas: "Ficha B",
};

const individualSelection = identity.selectTransportistaFields(
  identity.transportistaFieldsFromDeCA({
    transportista: "",
    transportistaId: "",
  }),
  profileB,
);
assert.equal(individualSelection.transportistaId, "legacy-b");
assert.equal(individualSelection.transportistaNif, "T-B");
assert.equal(individualSelection.transportistaDireccion, "Calle B");
console.log("PASS (helper): seleccionar una ficha devuelve el ID y sus datos.");

const manualEdit = identity.editTransportistaIdentityFields(
  { ...individualSelection, transportistaEmail: "independiente@example.test" },
  "transportista",
  "Transportista escrito a mano",
  profileB,
);
assert.equal(manualEdit.transportistaId, "");
assert.equal(manualEdit.transportistaNif, "");
assert.equal(manualEdit.transportistaDireccion, "");
assert.equal(manualEdit.transportistaEmail, "independiente@example.test");
assert.equal(manualEdit.transportista, "Transportista escrito a mano");
console.log("PASS (helper): cambiar el nombre invalida el ID y limpia datos derivados no editados.");

const manualNifEdit = identity.editTransportistaIdentityFields(
  individualSelection,
  "transportistaNif",
  "T-CUSTOM",
  profileB,
);
assert.equal(manualNifEdit.transportistaId, "");
assert.equal(manualNifEdit.transportistaNif, "T-CUSTOM");
assert.equal(manualNifEdit.transportistaDireccion, "");
console.log("PASS (helper): cambiar el NIF invalida el ID y conserva el nuevo NIF.");

const manualCountryFields = identity.editTransportistaIdentityFields(
  individualSelection,
  "transportista",
  "Transportista escrito a mano",
  profileB,
  (field) => field === "transportistaPais",
);
assert.equal(manualCountryFields.transportistaId, "");
assert.equal(manualCountryFields.transportistaPais, profileB.pais);
assert.equal(manualCountryFields.transportistaDireccion, "");
console.log("PASS (helper): conserva el país marcado manualmente aunque coincida con la ficha.");

const carrierRows = [
  {
    id: "uuid-a",
    user_id: "user-1",
    legacy_id: "legacy-a",
    nombre: profileA.nombre,
    nif: profileA.nif,
    direccion: profileA.direccion,
    ciudad: profileA.ciudad,
    codigo_postal: profileA.codigoPostal,
    provincia: profileA.provincia,
    pais: profileA.pais,
    telefono: profileA.telefono,
    email: profileA.email,
    notas: profileA.notas,
    es_predeterminado: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
  },
  {
    id: "uuid-b",
    user_id: "user-1",
    legacy_id: "legacy-b",
    nombre: profileB.nombre,
    nif: profileB.nif,
    direccion: profileB.direccion,
    ciudad: profileB.ciudad,
    codigo_postal: profileB.codigoPostal,
    provincia: profileB.provincia,
    pais: profileB.pais,
    telefono: profileB.telefono,
    email: profileB.email,
    notas: profileB.notas,
    es_predeterminado: false,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    deleted_at: null,
  },
  {
    id: "uuid-foreign",
    user_id: "user-2",
    legacy_id: "legacy-foreign",
    nombre: "Transportista ajeno",
    nif: "T-X",
    direccion: "Calle X",
    ciudad: "Sevilla",
    codigo_postal: "41001",
    provincia: "Sevilla",
    pais: "España",
    telefono: "",
    email: "",
    notas: "",
    es_predeterminado: false,
    created_at: "2026-01-03T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
    deleted_at: null,
  },
];
const carrierQueries = [];
const carrierSupabase = {
  from(table) {
    assert.equal(table, "transportistas_habituales");
    const filters = [];
    carrierQueries.push(filters);
    const query = {
      select() {
        return this;
      },
      eq(column, value) {
        filters.push([column, value]);
        return this;
      },
      order() {
        const data = carrierRows.filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        );
        return Promise.resolve({ data, error: null });
      },
    };
    return query;
  },
};

const transportistaService = loadTsModule(
  "transportistasHabitualesSupabaseService.ts",
  {
    "./database.types": {},
    "./decaSupabaseService": {
      getCurrentUserId: async () => "user-1",
    },
    "./lib/supabase": { supabase: carrierSupabase },
    "./types": {},
    "./destinatariosService": { normalizeRecipientText },
  },
);
const resolveTransportista =
  transportistaService.resolveUserTransportistaHabitualForDeCA;

(async () => {
  const repeatedNameMatch = await resolveTransportista(
    "uuid-b",
    "T-B",
    "Transportista repetido",
  );
assert.equal(repeatedNameMatch.row.id, "uuid-b");
assert.equal(repeatedNameMatch.profile.id, "legacy-b");
assert.ok(
  carrierQueries.at(-1).some(
    ([column, value]) => column === "user_id" && value === "user-1",
  ),
);
console.log("PASS: un ID explícito resuelve el nombre repetido dentro del usuario.");

await assert.rejects(
  resolveTransportista(
    "uuid-a",
    "T-WRONG",
    "Transportista repetido",
  ),
  /no corresponden a la misma ficha/,
);
await assert.rejects(
  resolveTransportista(
    "legacy-foreign",
    "T-X",
    "Transportista ajeno",
  ),
  /No se encontró la ficha del transportista indicada por ID/,
);
await assert.rejects(
  resolveTransportista(undefined, undefined, "Transportista repetido"),
  /varias fichas de transportista coincidentes/,
);
console.log("PASS: se rechazan contradicciones, IDs ajenos y nombres ambiguos sin ID.");

let lastUpdatePayload;
let lastUpdateFilters;
let updateCalls = 0;
const decaSupabase = {
  auth: {
    getUser: async () => ({
      data: { user: { id: "user-1" } },
      error: null,
    }),
  },
  from(table) {
    assert.equal(table, "decas");
    lastUpdateFilters = [];
    const query = {
      update(payload) {
        lastUpdatePayload = payload;
        updateCalls += 1;
        return this;
      },
      eq(column, value) {
        lastUpdateFilters.push([column, value]);
        return this;
      },
      is(column, value) {
        lastUpdateFilters.push([column, value]);
        return this;
      },
      select() {
        return this;
      },
      maybeSingle() {
        return this;
      },
      returns() {
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  },
};
const decaService = loadTsModule("decaSupabaseService.ts", {
  "./lib/supabase": {
    supabase: decaSupabase,
    supabaseStorageUrl: "https://local.invalid/storage/v1",
  },
  "./empresasHabitualesSupabaseService": {
    loadUserEmpresaHabitualForDeCA: async () => undefined,
  },
  "./transportistasHabitualesSupabaseService": {
    resolveUserTransportistaHabitualForDeCA: resolveTransportista,
  },
});

const savedRow = {
  id: "deca-1",
  user_id: "user-1",
  deleted_at: null,
  estado: "BORRADOR",
  fecha: "2026-11-21",
  empresa_habitual_id: null,
  cargador: "Cargador",
  cargador_nif: null,
  destinatario: "Destino",
  destinatario_nif: null,
  destinatario_codigo_postal: null,
  destinatario_pais: null,
  transportista: "Transportista repetido",
  transportista_habitual_id: "uuid-b",
  transportista_nif: "T-B",
  transportista_direccion: "Calle B",
  transportista_ciudad: "Madrid",
  transportista_codigo_postal: "28001",
  transportista_provincia: "Madrid",
  transportista_pais: "España",
  transportista_telefono: "600000002",
  transportista_email: "b@example.test",
  transportista_notas: "Ficha B",
  mercancia: "Cajas",
  bultos: 1,
  peso_bruto: 2,
  matricula: "1234-ABC",
  origen: null,
  destino: "Calle destino",
  ciudad_destino: "Madrid",
  referencia_albaran: null,
  observaciones: null,
  created_at: "2026-11-21T00:00:00.000Z",
  updated_at: "2026-11-21T00:00:00.000Z",
  emitted_at: null,
  pdf_path: null,
  pdf_public_url: null,
  pdf_version: null,
  pdf_sha256: null,
  emission_request_id: null,
  emission_started_at: null,
  emission_error: null,
};
  const loadedDraft = decaService.mapSupabaseDecaToLocal(savedRow);
  const loadedFields = identity.transportistaFieldsFromDeCA(loadedDraft);
  assert.equal(loadedFields.transportistaId, "uuid-b");
  assert.equal(
    identity.findTransportistaProfileForFields(loadedFields, [
      profileA,
      profileB,
    ]).id,
    "legacy-b",
  );
  const loadedUpdate = identity.transportistaUpdateFields(loadedFields);
  await decaService.updateUserDeca("deca-1", {
    ...loadedUpdate,
    observaciones: "Actualizado",
  });
  assert.equal(lastUpdatePayload.transportista_habitual_id, "uuid-b");
  assert.equal(lastUpdatePayload.transportista_nif, "T-B");
  assert.ok(
    lastUpdateFilters.some(
      ([column, value]) => column === "estado" && value === "BORRADOR",
    ),
  );
  console.log("PASS: cargar y guardar un borrador mantiene el vínculo por ID.");

  const resolverCallCountBeforeUnlink = carrierQueries.length;
  const unchangedIdentityFields = identity.transportistaUpdateFields(
    loadedFields,
    false,
  );
  assert.equal(
    Object.hasOwn(unchangedIdentityFields, "transportista_habitual_id"),
    false,
  );
  await decaService.updateUserDeca("deca-1", {
    ...unchangedIdentityFields,
    observaciones: "Solo otro campo",
  });
  assert.equal(
    Object.hasOwn(lastUpdatePayload, "transportista_habitual_id"),
    false,
  );
  assert.equal(carrierQueries.length, resolverCallCountBeforeUnlink);
  console.log("PASS: guardar otros cambios omite la identidad sin resolverla.");

  await decaService.updateUserDeca("deca-1", { observaciones: "Otro campo" });
  assert.equal(
    Object.hasOwn(lastUpdatePayload, "transportista_habitual_id"),
    false,
  );
  console.log("PASS: actualizar otro campo omite el vínculo y no lo recalcula.");

  await decaService.updateUserDeca("deca-1", {
    transportista_habitual_id: null,
  });
  assert.equal(lastUpdatePayload.transportista_habitual_id, null);
  assert.equal(carrierQueries.length, resolverCallCountBeforeUnlink);
  console.log("PASS: el null explícito desvincula sin volver a resolver la ficha.");

  const updateCountBeforeInvalidIdentity = updateCalls;
  await assert.rejects(
    decaService.updateUserDeca("deca-1", {
      transportista_habitual_id: "uuid-a",
      transportista: "Transportista repetido",
      transportista_nif: "T-WRONG",
    }),
    /no corresponden a la misma ficha/,
  );
  await assert.rejects(
    decaService.updateUserDeca("deca-1", {
      transportista_habitual_id: "legacy-foreign",
      transportista: "Transportista ajeno",
      transportista_nif: "T-X",
    }),
    /No se encontró la ficha del transportista indicada por ID/,
  );
  assert.equal(updateCalls, updateCountBeforeInvalidIdentity);
  console.log("PASS: la actualización no escribe identidades contradictorias o ajenas.");

  await decaService.updateUserDeca("deca-1", {
    transportista_habitual_id: "uuid-b",
    transportista: "Transportista repetido",
    transportista_nif: "T-B",
  });
  assert.equal(lastUpdatePayload.transportista_habitual_id, "uuid-b");
  console.log("PASS: el payload persiste la ficha correcta entre nombres repetidos.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
