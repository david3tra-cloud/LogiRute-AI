const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTsModule(relativePath) {
  const filePath = path.resolve(process.cwd(), relativePath);
  const code = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleObj = { exports: {} };
  const context = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: () => ({}),
    Promise,
    Error,
  });
  new vm.Script(output, { filename: filePath }).runInContext(context);
  return moduleObj.exports;
}

const { EmissionReservationGate, prepareAndReserveDeCA } = loadTsModule(
  "decaEmissionPreparation.ts",
);
const {
  validateDeCAForEmission,
  resolveEffectiveRecipientAddress,
} = loadTsModule("decaEmissionValidation.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFixture(overrides = {}) {
  const gate = new EmissionReservationGate();
  const decaId = "deca-1";
  const lease = gate.acquire(decaId);
  let row = {
    id: decaId,
    user_id: "user-1",
    estado: "BORRADOR",
    deleted_at: null,
    updated_at: "version-1",
    empresa_habitual_id: null,
    cargador_nif: null,
    cargador: "Empresa Ejemplo",
  };
  let userId = "user-1";
  let contextCurrent = true;
  let reads = 0;
  let reserveCalls = 0;
  let resolveCalls = 0;

  const args = {
    decaId,
    expectedUserId: "user-1",
    lease,
    gate,
    getCurrentUserId: async () => userId,
    readRemoteDeCA: async () => {
      reads += 1;
      return row ? { ...row } : null;
    },
    isOwnedByUser: (candidate, expectedUserId) =>
      candidate.user_id === expectedUserId,
    isDraft: (candidate) => candidate.estado === "BORRADOR",
    sameDraft: (before, after) =>
      before.id === after.id &&
      before.user_id === after.user_id &&
      before.estado === after.estado &&
      before.deleted_at === after.deleted_at &&
      before.updated_at === after.updated_at &&
      before.empresa_habitual_id === after.empresa_habitual_id &&
      before.cargador_nif === after.cargador_nif &&
      before.cargador === after.cargador,
    resolveCarrier: async () => {
      resolveCalls += 1;
      return { nombre: "Empresa Ejemplo" };
    },
    resolveRecipient: async () => undefined,
    validate: () => [],
    reserve: async () => {
      reserveCalls += 1;
      row = { ...row, estado: "EMITIENDO" };
      return { ...row };
    },
    isCurrent: (activeLease, expectedUserId) =>
      contextCurrent &&
      gate.isCurrent(activeLease) &&
      activeLease.decaId === decaId &&
      expectedUserId === userId,
  };

  const customReserve = overrides.reserve;
  Object.assign(args, overrides);
  if (customReserve) {
    args.reserve = async (...reserveArgs) => {
      reserveCalls += 1;
      return customReserve(...reserveArgs);
    };
  }
  return {
    args,
    gate,
    lease,
    get row() { return row; },
    set row(value) { row = value; },
    get reads() { return reads; },
    get reserveCalls() { return reserveCalls; },
    get resolveCalls() { return resolveCalls; },
    set userId(value) { userId = value; },
    set contextCurrent(value) { contextCurrent = value; },
  };
}

async function run() {
  {
    const validDeCA = {
      fecha: "2026-10-31",
      cargador: "Cargador",
      cargadorNif: "LOAD-NIF",
      transportista: "Transportista",
      transportistaNif: "CARRIER-NIF",
      transportistaDireccion: "Calle Transporte 1",
      transportistaCiudad: "Madrid",
      transportistaCodigoPostal: "28001",
      transportistaPais: "ES",
      destinatario: "Destinatario",
      direccionDestino: "Calle Entrega 2",
      ciudadDestino: "Valencia",
      destinatarioCodigoPostal: "46001",
      destinatarioPais: "ES",
      matriculaVehiculo: "1234ABC",
      mercancia: "Cajas",
      numeroBultos: "",
      pesoKg: "",
    };
    const validCarrier = {
      nif: "LOAD-NIF",
      direccion: "Calle Cargador 3",
      ciudad: "Sevilla",
      codigoPostal: "41001",
      pais: "ES",
    };
    assert.equal(validateDeCAForEmission(validDeCA, validCarrier).length, 0);
    console.log("PASS: datos obligatorios completos permiten continuar sin perfil de destinatario.");

    assert.equal(
      validateDeCAForEmission(
        { ...validDeCA, transportistaPais: "", destinatarioPais: "" },
        { ...validCarrier, pais: "" },
      ).length,
      0,
    );
    console.log("PASS: país vacío en cargador, transportista y destinatario no bloquea la emisión.");

    const missingRequiredFields = [
      ["cargador", "cargador"],
      ["cargadorNif", "cargadorNif"],
      ["carrier.nif", "cargadorNif"],
      ["carrier.direccion", "cargadorDireccion"],
      ["carrier.ciudad", "cargadorCiudad"],
      ["carrier.codigoPostal", "cargadorCodigoPostal"],
      ["transportista", "transportista"],
      ["transportistaNif", "transportistaNif"],
      ["transportistaDireccion", "transportistaDireccion"],
      ["transportistaCiudad", "transportistaCiudad"],
      ["transportistaCodigoPostal", "transportistaCodigoPostal"],
      ["destinatario", "destinatario"],
      ["direccionDestino", "direccionDestino"],
      ["ciudadDestino", "ciudadDestino"],
      ["destinatarioCodigoPostal", "destinatarioCodigoPostal"],
      ["matriculaVehiculo", "matriculaVehiculo"],
      ["mercancia", "mercancia"],
    ];
    for (const [field, expectedError] of missingRequiredFields) {
      const isCarrierField = field.startsWith("carrier.");
      const fieldName = isCarrierField ? field.slice("carrier.".length) : field;
      const candidate = isCarrierField
        ? { ...validDeCA }
        : { ...validDeCA, [fieldName]: " " };
      const carrier = { ...validCarrier };
      if (field === "cargadorNif" || field === "carrier.nif") carrier.nif = "";
      if (field === "carrier.nif") candidate.cargadorNif = "";
      if (isCarrierField && fieldName !== "nif") carrier[fieldName] = "";
      const errors = validateDeCAForEmission(candidate, carrier);
      assert.ok(errors.some((error) => error.field === expectedError), field);
      const fixture = createFixture({ validate: () => errors });
      const preparation = await prepareAndReserveDeCA(fixture.args);
      assert.equal(preparation.kind, "validation_failed", field);
      assert.equal(fixture.reserveCalls, 0, field);
    }
    for (const invalidDate of ["", "2026-02-30", "31/10/2026"]) {
      const errors = validateDeCAForEmission(
        { ...validDeCA, fecha: invalidDate },
        validCarrier,
      );
      assert.ok(errors.some((error) => error.field === "fecha"));
    }
    console.log("PASS: cada campo obligatorio y una fecha inválida bloquean la validación.");

    const explicitDestination = {
      ...validDeCA,
      destinatarioCodigoPostal: " 46002 ",
      destinatarioPais: " ES ",
    };
    assert.equal(validateDeCAForEmission(explicitDestination, validCarrier).length, 0);
    const explicitEffective = resolveEffectiveRecipientAddress(explicitDestination, {
        direccion: "Perfil dirección",
        ciudad: "Perfil ciudad",
        codigoPostal: "00000",
        pais: "XX",
      });
    assert.equal(explicitEffective.direccion, "Calle Entrega 2");
    assert.equal(explicitEffective.ciudad, "Valencia");
    assert.equal(explicitEffective.codigoPostal, " 46002 ");
    assert.equal(explicitEffective.pais, " ES ");
    const profileFallback = {
      ...validDeCA,
      destinatarioCodigoPostal: "",
      destinatarioPais: "",
    };
    const profileEffective = resolveEffectiveRecipientAddress(profileFallback, {
        direccion: "Perfil dirección",
        ciudad: "Perfil ciudad",
        codigoPostal: "46003",
        pais: "FR",
      });
    assert.equal(profileEffective.direccion, "Calle Entrega 2");
    assert.equal(profileEffective.ciudad, "Valencia");
    assert.equal(profileEffective.codigoPostal, "46003");
    assert.equal(profileEffective.pais, "FR");
    assert.equal(
      validateDeCAForEmission(profileFallback, validCarrier, {
        direccion: "Perfil dirección",
        ciudad: "Perfil ciudad",
        codigoPostal: "46003",
        pais: "FR",
      }).length,
      0,
    );
    const missingRecipientFallback = validateDeCAForEmission(
      { ...profileFallback, destinatarioCodigoPostal: undefined, destinatarioPais: undefined },
      validCarrier,
    );
    assert.ok(missingRecipientFallback.some((error) => error.field === "destinatarioCodigoPostal"));
    assert.ok(!missingRecipientFallback.some((error) => error.field === "destinatarioPais"));
    console.log("PASS: destinatario sin perfil acepta campos explícitos y usa fallback de perfil solo si existe.");

    assert.equal(
      validateDeCAForEmission({ ...validDeCA, numeroBultos: "", pesoKg: "" }, validCarrier).length,
      0,
    );
    assert.equal(
      validateDeCAForEmission({ ...validDeCA, numeroBultos: "0", pesoKg: "0" }, validCarrier).length,
      0,
    );
    const invalidMeasures = validateDeCAForEmission(
      { ...validDeCA, numeroBultos: "1.5", pesoKg: "no es número" },
      validCarrier,
    );
    assert.ok(invalidMeasures.some((error) => error.field === "numeroBultos"));
    assert.ok(invalidMeasures.some((error) => error.field === "pesoKg"));
    console.log("PASS: bultos y peso vacíos o cero son válidos; formatos inválidos se rechazan.");
  }

  {
    const fixture = createFixture({
      validate: () => [{ field: "fecha", label: "Fecha de transporte", code: "invalid" }],
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "validation_failed");
    assert.equal(fixture.reserveCalls, 0);
    assert.equal(fixture.row.estado, "BORRADOR");
    console.log("PASS: la preparación no reserva cuando el validador compartido devuelve errores.");
  }

  {
    const fixture = createFixture({
      resolveCarrier: async () => ({
        nombre: "Cargador",
        nif: "",
        direccion: "",
        ciudad: "",
        codigoPostal: "",
        pais: "",
      }),
      validate: () => validateDeCAForEmission(
        {
          fecha: "2026-10-31",
          cargador: "Cargador",
          transportista: "T",
          destinatario: "D",
          direccionDestino: "A",
          ciudadDestino: "B",
          matriculaVehiculo: "M",
          mercancia: "C",
        },
        { nif: "", direccion: "", ciudad: "", codigoPostal: "", pais: "" },
      ),
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "validation_failed");
    assert.ok(result.errors.some((error) => error.field === "cargadorNif"));
    assert.equal(fixture.reserveCalls, 0);
    console.log("PASS: perfil de cargador existente pero incompleto se distingue del perfil ausente y no reserva.");
  }

  {
    const fixture = createFixture({
      resolveRecipient: async () => { throw new Error("consulta destinatario fallida"); },
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "preflight_error");
    assert.equal(result.stage, "recipient");
    assert.equal(fixture.reserveCalls, 0);
    console.log("PASS: error al resolver el perfil opcional del destinatario aborta sin reservar.");
  }

  {
    const fixture = createFixture({ resolveCarrier: async () => undefined });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "carrier_missing");
    assert.equal(fixture.reserveCalls, 0);
    assert.equal(fixture.row.estado, "BORRADOR");
    console.log("PASS: perfil inexistente no reserva y conserva BORRADOR.");
  }

  {
    const fixture = createFixture({
      resolveCarrier: async () => { throw new Error("consulta fallida"); },
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "preflight_error");
    assert.equal(result.stage, "carrier");
    assert.equal(fixture.reserveCalls, 0);
    assert.equal(fixture.row.estado, "BORRADOR");
    console.log("PASS: error al consultar cargador no reserva.");
  }

  {
    const fixture = createFixture({
      readRemoteDeCA: async () => { throw new Error("consulta remota fallida"); },
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "preflight_error");
    assert.equal(result.stage, "remote");
    assert.equal(fixture.reserveCalls, 0);
    console.log("PASS: error al consultar el DeCA remoto no reserva.");
  }

  {
    const fixture = createFixture();
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "reserved");
    assert.equal(result.row.estado, "EMITIENDO");
    assert.equal(fixture.reserveCalls, 1);
    console.log("PASS: perfil existente permite una reserva.");
  }

  {
    const fixture = createFixture();
    const secondLease = fixture.gate.acquire("deca-1");
    assert.equal(secondLease, null);
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "reserved");
    assert.equal(fixture.reserveCalls, 1);
    console.log("PASS: doble activación simultánea no duplica la operación.");
  }

  for (const invalidation of ["usuario", "documento", "desmontaje"]) {
    const resolverStarted = deferred();
    const releaseResolver = deferred();
    const fixture = createFixture({
      resolveCarrier: async () => {
        resolverStarted.resolve();
        await releaseResolver.promise;
        return { nombre: "Empresa Ejemplo" };
      },
    });
    const resultPromise = prepareAndReserveDeCA(fixture.args);
    await resolverStarted.promise;
    fixture.contextCurrent = false;
    if (invalidation === "usuario") fixture.userId = "user-2";
    if (invalidation === "documento") fixture.gate.invalidate();
    if (invalidation === "desmontaje") fixture.gate.invalidate();
    releaseResolver.resolve();
    const result = await resultPromise;
    assert.equal(result.kind, "stale", invalidation);
    assert.equal(fixture.reserveCalls, 0, invalidation);
    console.log(`PASS: cambio de ${invalidation} durante la consulta cancela la reserva.`);
  }

  {
    const fixture = createFixture({
      resolveCarrier: async () => {
        fixture.row = { ...fixture.row, updated_at: "version-2" };
        return { nombre: "Empresa Ejemplo" };
      },
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "document_changed");
    assert.equal(fixture.reserveCalls, 0);
    assert.equal(fixture.row.estado, "BORRADOR");
    console.log("PASS: cambio remoto del documento durante el preflight no reserva.");
  }

  {
    const fixture = createFixture({
      reserve: async () => {
        fixture.row = { ...fixture.row, estado: "EMITIENDO" };
        throw new Error("respuesta perdida");
      },
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "reservation_reconciled");
    assert.equal(result.row.estado, "EMITIENDO");
    assert.equal(fixture.reserveCalls, 1);
    console.log("PASS: respuesta perdida se concilia con EMITIENDO sin repetir reserva.");
  }

  {
    const fixture = createFixture({
      reserve: async () => { throw new Error("respuesta perdida"); },
      readRemoteDeCA: async () => {
        fixture.readCount = (fixture.readCount ?? 0) + 1;
        if (fixture.readCount === 3) throw new Error("conciliación inaccesible");
        return { ...fixture.row };
      },
    });
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "reservation_uncertain");
    assert.equal(fixture.reserveCalls, 1);
    console.log("PASS: si falla la conciliación, el resultado queda explícitamente incierto.");
  }

  {
    const fixture = createFixture();
    fixture.row = { ...fixture.row, estado: "EMITIENDO" };
    const result = await prepareAndReserveDeCA(fixture.args);
    assert.equal(result.kind, "remote_state");
    assert.equal(fixture.reserveCalls, 0);
    console.log("PASS: una nueva activación verifica estado remoto antes de reservar.");
  }

  {
    const gate = new EmissionReservationGate();
    const oldLease = gate.acquire("deca-1");
    gate.invalidate();
    const currentLease = gate.acquire("deca-2");
    assert.equal(gate.release(oldLease), false);
    assert.equal(gate.isCurrent(currentLease), true);
    console.log("PASS: finally antiguo no libera el bloqueo de una operación posterior.");
  }

  console.log("Todas las pruebas aisladas de preparación y validación de emisión pasaron.");
}

run().catch((error) => {
  console.error("ERROR en pruebas de preparación de emisión:", error);
  process.exit(1);
});
