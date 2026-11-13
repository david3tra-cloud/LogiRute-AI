const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTsModule(relativePath, mocks = {}) {
  const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
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
    Blob,
    require: (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === "./decaEmissionPreparation") return preparation;
      if (id === "./decaEmissionBatch") return batch;
      throw new Error(`Unexpected dependency ${id} in ${relativePath}`);
    },
    console,
  });
  vm.runInContext(transpiled, context);
  return moduleObj.exports;
}

const preparation = loadTsModule("decaEmissionPreparation.ts");
const batch = loadTsModule("decaEmissionBatch.ts");
const { emitDeCA } = loadTsModule("decaEmissionWorkflow.ts");
const { EmissionReservationGate } = preparation;

const makeRow = (id, estado = "BORRADOR") => ({
  id,
  user_id: "local-test-user",
  deleted_at: null,
  estado,
  updated_at: "2026-11-11T00:00:00.000Z",
  empresa_habitual_id: "company-1",
  cargador: "Cargador de prueba",
  cargador_nif: "X-111",
  transportista: "Transportista de prueba",
  transportista_habitual_id: "carrier-1",
  transportista_nif: "T-111",
  transportista_direccion: "Calle de prueba 1",
  transportista_ciudad: "Madrid",
  transportista_codigo_postal: "28001",
  transportista_provincia: "Madrid",
  transportista_pais: "España",
  transportista_telefono: "",
  transportista_email: "",
  transportista_notas: "",
  fecha: "2026-11-11",
  destinatario: "Cliente de prueba",
  destinatario_nif: null,
  destinatario_codigo_postal: "28002",
  destinatario_pais: "ES",
  mercancia: "Cajas",
  bultos: 1,
  peso_bruto: 2,
  matricula: "1234-ABC",
  destino: "Calle Cliente 1",
  ciudad_destino: "Madrid",
  referencia_albaran: "",
  observaciones: "",
  created_at: "2026-11-11T00:00:00.000Z",
  emitted_at: null,
  pdf_path: null,
  pdf_public_url: null,
  pdf_version: null,
  pdf_sha256: null,
  emission_request_id: null,
  emission_started_at: null,
  emission_error: null,
});

const company = {
  id: "company-1",
  nombre: "Cargador de prueba",
  nif: "X-111",
  direccion: "Calle de prueba 1",
  ciudad: "Madrid",
  codigoPostal: "28001",
  provincia: "Madrid",
  pais: "España",
  telefono: "",
  email: "",
  contacto: "",
  notas: "",
  createdAt: "",
  updatedAt: "",
};

const makeDependencies = (
  rows,
  {
    failPdfOnceId,
    ambiguousFinalizeId,
    releaseModeById = {},
  } = {},
) => {
  const pdfFailures = new Set();
  let reservations = 0;
  let finalizations = 0;
  const getRow = (id) => rows.get(id);
  const dependencies = {
    expectedUserId: "local-test-user",
    gate: new EmissionReservationGate(),
    getCurrentUserId: async () => "local-test-user",
    readRemoteDeCA: async (id) => {
      const row = getRow(id);
      return row ? { ...row } : null;
    },
    resolveCarrier: async () => company,
    resolveRecipient: async () => undefined,
    validate: () => [],
    reserve: async (id) => {
      reservations += 1;
      const row = getRow(id);
      if (!row || row.estado !== "BORRADOR") return null;
      row.estado = "EMITIENDO";
      row.emission_request_id = `request-${id}`;
      row.emission_started_at = "2026-11-11T12:00:00.000Z";
      row.emission_error = null;
      return { ...row };
    },
    getPdfLocation: async (id, emissionRequestId) => ({
      decaId: id,
      userId: "local-test-user",
      emissionRequestId,
      path: `local-test-user/${id}/v1-${emissionRequestId}.pdf`,
      publicUrl: `https://local-test.invalid/${id}/${emissionRequestId}.pdf`,
    }),
    generatePdf: async (deca) => {
      if (deca.id === failPdfOnceId && !pdfFailures.has(deca.id)) {
        pdfFailures.add(deca.id);
        throw new Error("Fallo local simulado de generación.");
      }
      return { blob: new Blob([`PDF local ${deca.id}`]) };
    },
    calculateSha256: async () => "a".repeat(64),
    uploadPdf: async () => ({ alreadyExists: false }),
    finalize: async ({ decaId, emissionRequestId, emittedAt, location, pdfSha256 }) => {
      finalizations += 1;
      const row = getRow(decaId);
      if (
        !row ||
        row.estado !== "EMITIENDO" ||
        row.emission_request_id !== emissionRequestId
      ) {
        return null;
      }
      row.estado = "EMITIDO";
      row.emitted_at = emittedAt;
      row.pdf_path = location.path;
      row.pdf_public_url = location.publicUrl;
      row.pdf_version = 1;
      row.pdf_sha256 = pdfSha256;
      row.emission_error = null;
      if (decaId === ambiguousFinalizeId) {
        throw new Error("Respuesta local ambigua después de finalizar.");
      }
      return { ...row };
    },
    recordFailure: async ({ decaId, emissionRequestId, message, returnToDraft }) => {
      const row = getRow(decaId);
      if (!row) return null;
      const releaseMode = returnToDraft ? releaseModeById[decaId] : undefined;
      if (releaseMode === "no-match") return null;
      if (releaseMode === "ambiguous-before-commit") {
        throw new Error("Respuesta local ambigua antes del commit.");
      }
      if (releaseMode === "emitted-race") {
        row.estado = "EMITIDO";
        row.emitted_at = "2026-11-11T12:01:00.000Z";
        row.pdf_path = `local-test-user/${decaId}/v1-request-${decaId}.pdf`;
        row.pdf_public_url = `https://local-test.invalid/${decaId}.pdf`;
        row.pdf_version = 1;
        row.pdf_sha256 = "a".repeat(64);
        return null;
      }
      if (emissionRequestId) {
        if (
          row.estado !== "EMITIENDO" ||
          row.emission_request_id !== emissionRequestId
        ) {
          return null;
        }
      } else if (row.estado !== "BORRADOR") {
        return null;
      }
      row.emission_error = message;
      if (returnToDraft) {
        row.estado = "BORRADOR";
        row.emission_request_id = null;
        row.emission_started_at = null;
        if (releaseMode === "ambiguous-after-commit") {
          throw new Error("Respuesta local ambigua después del commit.");
        }
      }
      return { ...row };
    },
    mapToLocal: (row) => ({
      id: row.id,
      fecha: row.fecha,
      cargadorId: row.empresa_habitual_id,
      cargador: row.cargador,
      cargadorNif: row.cargador_nif,
      transportista: row.transportista,
      transportistaId: row.transportista_habitual_id,
      transportistaNif: row.transportista_nif,
      transportistaDireccion: row.transportista_direccion,
      transportistaCiudad: row.transportista_ciudad,
      transportistaCodigoPostal: row.transportista_codigo_postal,
      transportistaProvincia: row.transportista_provincia,
      transportistaPais: row.transportista_pais,
      transportistaTelefono: row.transportista_telefono,
      transportistaEmail: row.transportista_email,
      transportistaNotas: row.transportista_notas,
      destinatario: row.destinatario,
      direccionDestino: row.destino,
      ciudadDestino: row.ciudad_destino,
      destinatarioCodigoPostal: row.destinatario_codigo_postal,
      destinatarioPais: row.destinatario_pais,
      mercancia: row.mercancia,
      numeroBultos: String(row.bultos),
      pesoKg: String(row.peso_bruto),
      matriculaVehiculo: row.matricula,
      estado: row.estado,
    }),
    isCurrent: (lease, userId) =>
      userId === "local-test-user" &&
      dependencies.gate.isCurrent(lease),
  };
  return {
    dependencies,
    counts: () => ({ reservations, finalizations }),
  };
};

const runWorkflowBatch = (ids, rows, dependencies) =>
  batch.runDeCAEmissionBatch(ids, (id) => emitDeCA(id, dependencies));

(async () => {
  for (const count of [1, 2, 40]) {
    const rows = new Map(
      Array.from({ length: count }, (_, index) => {
        const row = makeRow(`size-${count}-${index + 1}`);
        return [row.id, row];
      }),
    );
    const { dependencies, counts } = makeDependencies(rows);
    const results = await runWorkflowBatch(
      [...rows.keys()],
      rows,
      dependencies,
    );
    assert.equal(results.length, count);
    assert.ok(results.every((result) => result.outcome.status === "emitted"));
    assert.equal([...rows.values()].filter((row) => row.estado === "EMITIDO").length, count);
    assert.equal(counts().reservations, count);
    assert.equal(counts().finalizations, count);
  }
  console.log("PASS: workflow real con dependencias locales emite 1, 2 y 40 borradores.");

  const rows = new Map(
    Array.from({ length: 40 }, (_, index) => {
      const row = makeRow(`partial-${index + 1}`);
      return [row.id, row];
    }),
  );
  const failedId = "partial-17";
  const { dependencies, counts } = makeDependencies(rows, {
    failPdfOnceId: failedId,
  });
  const firstResults = await runWorkflowBatch(
    [...rows.keys()],
    rows,
    dependencies,
  );
  assert.equal(
    firstResults.filter((result) => result.outcome.status === "failed").length,
    1,
  );
  assert.equal(rows.get(failedId).estado, "BORRADOR");
  assert.match(rows.get(failedId).emission_error, /Fallo local simulado/);
  assert.equal([...rows.values()].filter((row) => row.estado === "EMITIDO").length, 39);

  const retryIds = [...rows.values()]
    .filter((row) => row.estado === "BORRADOR")
    .map((row) => row.id);
  assert.deepEqual(retryIds, [failedId]);
  const retryResults = await runWorkflowBatch(retryIds, rows, dependencies);
  assert.equal(retryResults[0].outcome.status, "emitted");
  assert.equal(rows.get(failedId).estado, "EMITIDO");
  assert.equal([...rows.values()].filter((row) => row.estado === "EMITIDO").length, 40);
  assert.equal(counts().reservations, 41);
  assert.equal(counts().finalizations, 40);
  console.log("PASS: fallo parcial vuelve a BORRADOR con motivo; el reintento solo emite esa fila.");

  const pending = makeRow("recovered", "EMITIENDO");
  pending.emission_request_id = "request-recovered";
  pending.emission_started_at = "2026-11-11T12:00:00.000Z";
  const pendingRows = new Map([[pending.id, pending]]);
  const recovered = makeDependencies(pendingRows);
  const recoveryResult = await emitDeCA(
    pending.id,
    recovered.dependencies,
  );
  assert.equal(recoveryResult.status, "emitted");
  assert.equal(pendingRows.get(pending.id).emission_request_id, "request-recovered");
  assert.equal(recovered.counts().reservations, 0);
  console.log("PASS: EMITIENDO se recupera con su reserva original tras recargar.");

  for (const [mode, expectedStatus, expectedState] of [
    ["no-match", "pending", "EMITIENDO"],
    ["ambiguous-before-commit", "pending", "EMITIENDO"],
    ["ambiguous-after-commit", "failed", "BORRADOR"],
    ["emitted-race", "emitted", "EMITIDO"],
  ]) {
    const row = makeRow(`release-${mode}`);
    const releaseCase = makeDependencies(new Map([[row.id, row]]), {
      failPdfOnceId: row.id,
      releaseModeById: { [row.id]: mode },
    });
    const result = await emitDeCA(row.id, releaseCase.dependencies);
    assert.equal(result.status, expectedStatus);
    assert.equal(
      releaseCase.dependencies.readRemoteDeCA
        ? (await releaseCase.dependencies.readRemoteDeCA(row.id)).estado
        : row.estado,
      expectedState,
    );
    if (expectedState === "EMITIENDO") {
      assert.equal(row.emission_request_id, `request-${row.id}`);
    }
  }
  console.log("PASS: no-match y RPC ambiguo no liberan por sí solos; se reconcilian.");
  console.log("PASS: release confirmado se reconcilia como borrador; carrera emitida no se revierte.");

  const ambiguous = makeRow("ambiguous");
  const ambiguousRows = new Map([[ambiguous.id, ambiguous]]);
  const ambiguousDeps = makeDependencies(ambiguousRows, {
    ambiguousFinalizeId: ambiguous.id,
  });
  const ambiguousResult = await emitDeCA(
    ambiguous.id,
    ambiguousDeps.dependencies,
  );
  assert.equal(ambiguousResult.status, "emitted");
  assert.equal(ambiguousRows.get(ambiguous.id).estado, "EMITIDO");
  assert.equal(ambiguousDeps.counts().reservations, 1);
  assert.equal(ambiguousDeps.counts().finalizations, 1);
  console.log("PASS: respuesta ambigua posterior a finalizar se reconcilia sin reservar otra vez.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
