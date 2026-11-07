const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTsModule(relativePath, customMocks = {}, globals = {}) {
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
    require: (id) => {
      if (customMocks[id]) return customMocks[id];
      return require(id);
    },
    Date,
    Math,
    Number,
    String,
    Set,
    Map,
    Array,
    Object,
    RegExp,
    globalThis,
    ...globals,
  });

  vm.runInContext(transpiled, ctx);
  return moduleObj.exports;
}

const csvHelpers = loadTsModule("destinatariosService.ts", {
  "./types": {},
});
const routeCsvService = loadTsModule("routeCsvService.ts", {
  "./types": {
    DeliveryStatus: { PENDING: "PENDING" },
    DeliveryType: { DELIVERY: "DELIVERY", PICKUP: "PICKUP" },
  },
  "./destinatariosService": csvHelpers,
});
const { appendImportedRouteStops, previewRoutesCsv, routeTemplateCsv } =
  routeCsvService;
const { getDeliveryCardTitle, getVisibleDeliveryNotes } =
  loadTsModule("deliveryDisplay.ts");

console.log("Iniciando pruebas de regresión para importación CSV de rutas...\n");

{
  const csv = [
    "\uFEFFfecha;cargador;destinatario;telefono;direccion_destino;ciudad_destino;mercancia;bultos;peso_kg;transportista;matricula;referencia_albaran;destinatario_codigo_postal;destinatario_pais;notas;tipo",
    [
      "2026-10-10",
      "Cargador",
      '"Cliente; Norte"',
      "+0034 06001234",
      "Calle Mayor 12",
      "Valencia",
      "Paquetería",
      "3",
      "125,5",
      "Transportista",
      "1234-ABC",
      "ALB-001",
      "46001",
      "España",
      '"Dejar en recepción"',
      "DELIVERY",
    ].join(";"),
    "",
    [
      "2026-10-10",
      "Cargador",
      "Cliente Recogida",
      "",
      "",
      "Madrid",
      "Devolución",
      "1",
      "20",
      "",
      "",
      "ALB-002",
      "",
      "",
      "",
      "PICKUP",
    ].join(";"),
    [
      "2026-10-10",
      "Cargador",
      "Cliente Entrega",
      "",
      "",
      "Sevilla",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join(";"),
  ].join("\r\n");
  const preview = previewRoutesCsv(csv);

  assert.equal(preview.headerError, undefined);
  assert.equal(preview.detectedRows, 3);
  assert.deepEqual(
    Array.from(preview.rows, (row) => row.kind),
    ["valid", "valid", "valid"],
  );
  const [delivery, pickup, defaultDelivery] = Array.from(
    preview.rows,
    (row) => row.delivery,
  );
  assert.equal(delivery.recipient, "Cliente; Norte");
  assert.equal(delivery.type, "DELIVERY");
  assert.equal(delivery.address, "Calle Mayor 12, Valencia");
  assert.equal(delivery.concept, "ALB-001");
  assert.equal(delivery.phone, "+0034 06001234");
  assert.equal(delivery.pesoKg, 125.5);
  assert.match(delivery.notes, /Bultos: 3/);
  assert.match(delivery.notes, /Dejar en recepción/);
  assert.equal(pickup.type, "PICKUP");
  assert.equal(pickup.address, "Madrid");
  assert.equal(defaultDelivery.type, "DELIVERY");
  assert.equal(pickup.phone, undefined);
  assert.equal(defaultDelivery.phone, undefined);
  assert.ok(delivery.id && pickup.id && defaultDelivery.id);
  assert.equal(new Set([delivery.id, pickup.id, defaultDelivery.id]).size, 3);
  for (const stop of [delivery, pickup, defaultDelivery]) {
    assert.equal(stop.decaId, undefined);
    assert.equal(stop.sourceType, undefined);
    assert.equal(stop.coordinates, undefined);
  }
  console.log("PASS 1: Formato DeCA, metadatos, tipos y paradas independientes.");
}

{
  assert.equal(
    getDeliveryCardTitle({ recipient: "Destinatario", concept: "REF-1" }),
    "Destinatario",
  );
  assert.equal(
    getDeliveryCardTitle({ recipient: "", concept: "REF-antigua" }),
    "REF-antigua",
  );
  assert.equal(
    getDeliveryCardTitle({
      recipient: "",
      concept: "",
      sourceType: "DECA",
    }),
    "Destinatario no especificado",
  );

  for (const header of [
    "telefono",
    "teléfono",
    "telefono_destinatario",
    "movil",
    "phone",
  ]) {
    const preview = previewRoutesCsv(
      `destinatario;ciudad_destino;${header}\nCliente;Madrid;+0034 06001234`,
    );
    assert.equal(preview.rows[0].kind, "valid");
    assert.equal(preview.rows[0].delivery.phone, "+0034 06001234");
  }

  const noPhoneColumn = previewRoutesCsv(
    "destinatario;ciudad_destino\nCliente;Madrid",
  );
  assert.equal(noPhoneColumn.rows[0].delivery.phone, undefined);
  console.log("PASS: Destinatario como título, respaldo antiguo y aliases de teléfono.");
}

{
  assert.equal(
    getVisibleDeliveryNotes(
      "Mercancía: Paquetería · Bultos: 3 · Peso: 20 kg · Referencia: ALB-001",
    ),
    "Mercancía: Paquetería · Bultos: 3 · Peso: 20 kg",
  );
  assert.equal(
    getVisibleDeliveryNotes("Referencia: ALB-001 · Entregar en recepción"),
    "Entregar en recepción",
  );
  assert.equal(
    getVisibleDeliveryNotes("Bultos: 2 · Peso: 8 kg"),
    "Bultos: 2 · Peso: 8 kg",
  );
  assert.equal(getVisibleDeliveryNotes("Referencia: ALB-001"), "");
  assert.equal(
    getVisibleDeliveryNotes("Avisar: la referencia está en el albarán"),
    "Avisar: la referencia está en el albarán",
  );
  console.log("PASS: Ocultación de referencia estructurada sin perder otras notas.");
}

{
  const phoneStop = {
    id: "route-csv-phone",
    recipient: "Cliente",
    address: "Madrid",
    phone: "+0034 06001234",
    status: "PENDING",
    type: "DELIVERY",
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const routeSnapshot = loadTsModule(
    "routeSnapshotStorage.ts",
    {
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
      "./destinatariosService": {
        userStorageKey: (key, userId) => `${key}:${encodeURIComponent(userId)}`,
      },
    },
    { localStorage },
  );
  assert.equal(
    routeSnapshot.saveRouteSnapshot("test-user", [phoneStop], [phoneStop.id]),
    true,
  );
  const restored = routeSnapshot.loadRouteSnapshot("test-user", () => {
    throw new Error("Debe cargar el snapshot guardado.");
  });
  assert.equal(restored.deliveries[0].phone, "+0034 06001234");
  assert.deepEqual(Array.from(restored.sequence), ["route-csv-phone"]);
  const appSource = fs.readFileSync(path.resolve(process.cwd(), "App.tsx"), "utf8");
  assert.match(appSource, /setNewPhoneInput\(delivery\.phone \?\? ""\)/);
  assert.match(appSource, /value=\{newPhoneInput\}/);
  console.log("PASS: Teléfono conservado tras guardar y recargar la ruta.");
}

{
  const csv = [
    "destinatario;direccion_destino;ciudad_destino;tipo",
    "Cliente sin dirección;;;entrega",
    ";;Madrid;recogida",
    "Cliente tipo desconocido;Calle 1;;envío",
    "",
    "Cliente válido;;Bilbao;entrega",
  ].join("\n");
  const preview = previewRoutesCsv(csv);

  assert.equal(preview.detectedRows, 4);
  assert.deepEqual(
    Array.from(preview.rows, (row) => row.kind),
    ["error", "error", "error", "valid"],
  );
  assert.equal(preview.rows[0].rowNumber, 2);
  assert.match(preview.rows[0].reason, /ubicación/);
  assert.equal(preview.rows[1].rowNumber, 3);
  assert.match(preview.rows[1].reason, /destinatario/);
  assert.equal(preview.rows[2].rowNumber, 4);
  assert.match(preview.rows[2].reason, /tipo desconocido/);
  assert.equal(preview.rows[3].rowNumber, 6);
  console.log("PASS 2: Errores por fila y numeración correcta con líneas vacías.");
}

{
  const missingRecipient = previewRoutesCsv(
    "direccion_destino;ciudad_destino\nCalle 1;Madrid",
  );
  const missingLocation = previewRoutesCsv(
    "destinatario;referencia_albaran\nCliente;REF-1",
  );
  const malformedCsv = previewRoutesCsv(
    'destinatario;ciudad_destino\n"Cliente;Madrid',
  );

  assert.match(missingRecipient.headerError, /destinatario/);
  assert.match(missingLocation.headerError, /ubicación/);
  assert.match(malformedCsv.headerError, /interpretar el CSV/);
  console.log("PASS 3: Cabeceras obligatorias y CSV mal formado.");
}

{
  const preview = previewRoutesCsv(
    [
      "destinatario;ciudad_destino;peso_kg;bultos;tipo",
      "Entrega minúscula;Madrid;10;1;entrega",
      "Entrega enum mayúscula;Sevilla;20;2;DELIVERY",
      "Recogida;Bilbao;30;3;Recogida",
      "Pickup enum;Valencia;40;4;PICKUP",
      "Tipo vacío;Zaragoza;;;",
      "Alias reparto;Málaga;;;reparto",
      "Alias recollida;Cádiz;;;recollida",
      "Tipo desconocido;Córdoba;;;envío",
    ].join("\n"),
  );
  assert.deepEqual(
    Array.from(preview.rows, (row) => row.kind),
    ["valid", "valid", "valid", "valid", "valid", "error", "error", "error"],
  );
  assert.deepEqual(
    Array.from(preview.rows.slice(0, 5), (row) => row.delivery.type),
    ["DELIVERY", "DELIVERY", "PICKUP", "PICKUP", "DELIVERY"],
  );
  for (const errorRow of preview.rows.slice(5)) {
    assert.match(errorRow.reason, /tipo desconocido/);
  }

  const invalidMeasures = previewRoutesCsv(
    [
      "destinatario;ciudad_destino;peso_kg;bultos",
      "Peso negativo;Madrid;-1;1",
      "Peso inválido;Madrid;abc;1",
      "Bultos fraccionarios;Madrid;10;1.5",
      "Bultos negativos;Madrid;10;-2",
    ].join("\n"),
  );
  assert.deepEqual(
    Array.from(invalidMeasures.rows, (row) => row.kind),
    ["error", "error", "error", "error"],
  );
  assert.match(invalidMeasures.rows[0].reason, /peso_kg/);
  assert.match(invalidMeasures.rows[1].reason, /peso_kg/);
  assert.match(invalidMeasures.rows[2].reason, /bultos/);
  assert.match(invalidMeasures.rows[3].reason, /bultos/);
  console.log("PASS: Tipos mixtos, valores desconocidos, peso y bultos inválidos.");
}

{
  const existingStops = [
    { id: "existing-2", recipient: "Segundo" },
    { id: "existing-1", recipient: "Primero" },
  ];
  const importedStops = [
    { id: "imported-1", recipient: "Importada 1" },
    { id: "imported-2", recipient: "Importada 2" },
  ];
  const combined = appendImportedRouteStops(existingStops, importedStops);
  assert.deepEqual(
    Array.from(combined, (stop) => stop.id),
    ["existing-2", "existing-1", "imported-1", "imported-2"],
  );
  assert.equal(combined[0], existingStops[0]);
  assert.equal(combined[1], existingStops[1]);
  assert.ok(routeTemplateCsv().startsWith("\uFEFFdestinatario;telefono;"));
  assert.match(routeTemplateCsv(), /Cliente Ejemplo S\.L\.;600000001;/);
  assert.match(routeTemplateCsv(), /Recogida Ejemplo S\.L\.;600000002;/);
  console.log("PASS: Anexado conserva orden existente y plantilla incluye teléfonos ficticios.");
}

console.log("\nTodas las pruebas del importador de rutas han pasado.");
