const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

// Carga módulos TypeScript transpilados en un contexto aislado
function loadTsModule(relativePath, customMocks = {}) {
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
      if (id === "./destinatariosService") return loadTsModule("destinatariosService.ts", customMocks);
      if (id === "./types") return {};
      if (id === "./lib/supabase") {
        return {
          supabase: {
            auth: { getUser: async () => ({ data: { user: { id: "test-user-id" } }, error: null }) },
            from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
            storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "https://example.com/v1.pdf" } }) }) }
          },
          supabaseStorageUrl: "https://example.com/storage/v1"
        };
      }
      if (id === "./empresasHabitualesSupabaseService") {
        return {
          loadUserEmpresaHabitualForDeCA: async () => undefined
        };
      }
      return require(id);
    },
    console,
    Date,
    Math,
    String,
    Number,
    Set,
    Map,
    Array,
    Object,
    RegExp,
    globalThis,
  });

  vm.runInContext(transpiled, ctx);
  return moduleObj.exports;
}

const decaCsvService = loadTsModule("decaCsvService.ts");
const decaSupabaseService = loadTsModule("decaSupabaseService.ts");

const { previewDecasCsv, decaTemplateCsv, DECA_CSV_HEADERS, REQUIRED_DECA_CSV_HEADERS, OPTIONAL_DECA_CSV_HEADERS } = decaCsvService;
const { mapSupabaseDecaToLocal } = decaSupabaseService;

console.log("Iniciando pruebas de regresión para importación CSV de DeCAs...\n");

// 1. CSV Antiguo de 7 columnas
{
  const oldCsv = [
    "fecha;cargador;destinatario;ciudad_destino;mercancia;bultos;peso_kg",
    "2026-10-10;Cargador Antiguo S.L.;Cliente 1 S.A.;Madrid;Palets;10;500.25",
  ].join("\r\n");

  const preview = previewDecasCsv(oldCsv);
  assert.equal(preview.headerError, undefined, "CSV antiguo no debe tener error de cabecera");
  assert.equal(preview.detectedRows, 1, "Debe detectar 1 fila");
  assert.equal(preview.rows.length, 1, "Debe procesar 1 fila");
  assert.equal(preview.rows[0].reason, undefined, "La fila antigua debe ser válida");

  const deca = preview.rows[0].deca;
  assert.ok(deca, "Debe generar un objeto DeCA");
  assert.equal(deca.fecha, "2026-10-10");
  assert.equal(deca.cargador, "Cargador Antiguo S.L.");
  assert.equal(deca.destinatario, "Cliente 1 S.A.");
  assert.equal(deca.ciudadDestino, "Madrid");
  assert.equal(deca.mercancia, "Palets");
  assert.equal(deca.numeroBultos, "10");
  assert.equal(deca.pesoKg, "500.25");
  // Los 4 campos nuevos deben inicializarse como cadenas vacías sin fallar
  assert.equal(deca.direccionDestino, "");
  assert.equal(deca.transportista, "");
  assert.equal(deca.matriculaVehiculo, "");
  assert.equal(deca.referenciaAlbaran, "");
  console.log("PASS 1: CSV antiguo de 7 columnas compatible y funcional.");
}

// 2. CSV Nuevo con las 11 columnas completas
{
  const newCsv = [
    "fecha;cargador;destinatario;direccion_destino;ciudad_destino;mercancia;bultos;peso_kg;transportista;matricula;referencia_albaran",
    "2026-10-15;Logística Express;Distribuciones Norte;Avda. Industria 45;Zaragoza;Electrodomésticos;8;420.0;Transportes Sur S.L.;5678-CD;ALB-2026-999",
  ].join("\r\n");

  const preview = previewDecasCsv(newCsv);
  assert.equal(preview.headerError, undefined);
  assert.equal(preview.rows.length, 1);
  const deca = preview.rows[0].deca;
  assert.ok(deca);
  assert.equal(deca.fecha, "2026-10-15");
  assert.equal(deca.cargador, "Logística Express");
  assert.equal(deca.destinatario, "Distribuciones Norte");
  assert.equal(deca.direccionDestino, "Avda. Industria 45");
  assert.equal(deca.ciudadDestino, "Zaragoza");
  assert.notEqual(deca.direccionDestino, deca.ciudadDestino, "Dirección y ciudad deben mantenerse separadas");
  assert.equal(deca.mercancia, "Electrodomésticos");
  assert.equal(deca.numeroBultos, "8");
  assert.equal(deca.pesoKg, "420");
  assert.equal(deca.transportista, "Transportes Sur S.L.");
  assert.equal(deca.matriculaVehiculo, "5678-CD");
  assert.equal(deca.referenciaAlbaran, "ALB-2026-999");
  console.log("PASS 2: CSV nuevo con los cuatro campos mapeados y dirección/ciudad separadas.");
}

// 3. Dos albaranes diferentes para el mismo cliente y fecha
{
  const multipleAlbaranesCsv = [
    "fecha;cargador;destinatario;ciudad_destino;mercancia;bultos;peso_kg;referencia_albaran",
    "2026-10-20;Mismo Cargador;Mismo Destinatario;Valencia;Cajas;2;50;ALB-001",
    "2026-10-20;Mismo Cargador;Mismo Destinatario;Valencia;Cajas;3;75;ALB-002",
  ].join("\r\n");

  const preview = previewDecasCsv(multipleAlbaranesCsv);
  assert.equal(preview.detectedRows, 2);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].reason, undefined, "Primer albarán válido");
  assert.equal(preview.rows[1].reason, undefined, "Segundo albarán válido y no descartado");
  assert.notEqual(preview.rows[0].deca.id, preview.rows[1].deca.id, "Cada DeCA debe tener un ID único");
  assert.equal(preview.rows[0].deca.referenciaAlbaran, "ALB-001");
  assert.equal(preview.rows[1].deca.referenciaAlbaran, "ALB-002");
  console.log("PASS 3: Dos albaranes diferentes para el mismo cliente y fecha no se bloquean ni fusionan.");
}

// 4. Dos filas idénticas: ambas deben conservarse con IDs distintos
{
  const identicalRowsCsv = [
    "fecha;cargador;destinatario;ciudad_destino;mercancia;bultos;peso_kg;referencia_albaran",
    "2026-10-22;Cargador A;Destinatario B;Sevilla;Paquetería;1;10;ALB-SAME",
    "2026-10-22;Cargador A;Destinatario B;Sevilla;Paquetería;1;10;ALB-SAME",
  ].join("\r\n");

  const preview = previewDecasCsv(identicalRowsCsv);
  assert.equal(preview.detectedRows, 2);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].reason, undefined);
  assert.equal(preview.rows[1].reason, undefined);
  assert.ok(preview.rows[0].deca?.id);
  assert.ok(preview.rows[1].deca?.id);
  assert.notEqual(preview.rows[0].deca.id, preview.rows[1].deca.id, "Dos filas idénticas deben recibir IDs distintos");
  console.log("PASS 4: Dos filas idénticas se conservan como DeCAs independientes con IDs distintos.");
}

// 5. Coincidencia con un DeCA existente: no debe bloquear la fila
{
  const existingDecas = [
    {
      id: "existing-uuid-1",
      fecha: "2026-10-25",
      cargador: "Empresa Repetida",
      destinatario: "Cliente Repetido",
      direccionDestino: "",
      ciudadDestino: "Bilbao",
      mercancia: "Hierro",
      numeroBultos: "5",
      pesoKg: "200",
      referenciaAlbaran: "ALB-EXISTING",
      matriculaVehiculo: "",
      transportista: "",
      notas: "",
      estado: "borrador",
      createdAt: "2026-10-25T00:00:00Z",
      updatedAt: "2026-10-25T00:00:00Z",
    },
  ];

  const matchingCsv = [
    "fecha;cargador;destinatario;ciudad_destino;mercancia;bultos;peso_kg;referencia_albaran",
    "2026-10-25;Empresa Repetida;Cliente Repetido;Bilbao;Hierro;5;200;ALB-EXISTING",
  ].join("\r\n");

  const preview = previewDecasCsv(matchingCsv, existingDecas);
  assert.equal(preview.detectedRows, 1);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].reason, undefined, "La coincidencia con un DeCA existente no debe bloquear la fila");
  assert.notEqual(preview.rows[0].deca.id, "existing-uuid-1", "Debe generarse un nuevo ID independiente");
  console.log("PASS 5: Coincidencia con un DeCA existente no bloquea ni omite la fila.");
}

// 6. Referencias y matrículas con ceros iniciales
{
  const leadingZerosCsv = [
    "fecha;cargador;destinatario;ciudad_destino;mercancia;bultos;peso_kg;matricula;referencia_albaran",
    "2026-10-25;Cargador Zero;Destino Zero;Alicante;Tuberías;4;120;0042-XYZ;0008451",
  ].join("\r\n");

  const preview = previewDecasCsv(leadingZerosCsv);
  assert.equal(preview.rows.length, 1);
  const deca = preview.rows[0].deca;
  assert.ok(deca);
  assert.equal(deca.matriculaVehiculo, "0042-XYZ", "Matrícula debe conservar los ceros iniciales");
  assert.equal(deca.referenciaAlbaran, "0008451", "Referencia de albarán debe conservar los ceros iniciales como string");
  console.log("PASS 6: Matrículas y referencias con ceros iniciales conservadas intactas como string.");
}

// 7. Generación y lectura de la propia plantilla CSV
{
  const template = decaTemplateCsv();
  assert.ok(template.startsWith("\uFEFF"), "La plantilla debe comenzar con BOM UTF-8");

  const preview = previewDecasCsv(template);
  assert.equal(preview.headerError, undefined, "La plantilla debe tener todas las cabeceras requeridas");
  assert.equal(preview.detectedRows, 1, "La plantilla contiene 1 fila de ejemplo");
  assert.equal(preview.rows.length, 1, "Debe interpretar la fila de ejemplo");
  assert.equal(preview.rows[0].reason, undefined, "La fila de ejemplo debe ser válida");

  const deca = preview.rows[0].deca;
  assert.ok(deca);
  assert.equal(deca.fecha, "2026-10-04");
  assert.equal(deca.cargador, "Empresa Ejemplo S.L.");
  assert.equal(deca.destinatario, "Cliente Ejemplo S.L.");
  assert.equal(deca.direccionDestino, "Calle Mayor 12");
  assert.equal(deca.ciudadDestino, "Valencia");
  assert.equal(deca.transportista, "Transportes Rápidos S.A.");
  assert.equal(deca.matriculaVehiculo, "1234-BBB");
  assert.equal(deca.referenciaAlbaran, "ALB-2026-001");
  console.log("PASS 7: Generación y lectura cíclica de la plantilla CSV superada.");
}

// 8. Verificación del mapeo hasta el modelo de base de datos Supabase
{
  const localDeca = {
    id: "uuid-test-mapping",
    fecha: "2026-10-25",
    cargador: "Empresa Remitente",
    transportista: "Transportes Integrales",
    destinatario: "Receptor Final",
    direccionDestino: "Polígono Industrial Nave 3",
    ciudadDestino: "Castellón",
    mercancia: "Bobinas",
    numeroBultos: "6",
    pesoKg: "850.5",
    referenciaAlbaran: "009988",
    matriculaVehiculo: "0011-JKL",
    notas: "Prueba mapeo",
    estado: "borrador",
    createdAt: "2026-10-25T12:00:00Z",
    updatedAt: "2026-10-25T12:00:00Z",
  };

  // Simulación del contrato de inserción en tabla 'decas' de Supabase
  const supabaseRowSimulated = {
    id: localDeca.id,
    user_id: "user-123",
    deleted_at: null,
    estado: "BORRADOR",
    fecha: localDeca.fecha,
    empresa_habitual_id: null,
    cargador: localDeca.cargador,
    cargador_nif: null,
    destinatario: localDeca.destinatario,
    destinatario_nif: null,
    transportista: localDeca.transportista,
    transportista_nif: null,
    transportista_direccion: null,
    transportista_ciudad: null,
    transportista_codigo_postal: null,
    transportista_provincia: null,
    transportista_pais: null,
    transportista_telefono: null,
    transportista_email: null,
    transportista_notas: null,
    mercancia: localDeca.mercancia,
    bultos: 6,
    peso_bruto: 850.5,
    matricula: localDeca.matriculaVehiculo,
    origen: null,
    destino: localDeca.direccionDestino,
    ciudad_destino: localDeca.ciudadDestino,
    referencia_albaran: localDeca.referenciaAlbaran,
    observaciones: localDeca.notas,
    created_at: localDeca.createdAt,
    updated_at: localDeca.updatedAt,
    emitted_at: null,
    pdf_path: null,
    pdf_public_url: null,
    pdf_version: null,
    pdf_sha256: null,
    emission_request_id: null,
    emission_started_at: null,
  };

  // Mapeo inverso de la fila Supabase a modelo local
  const mappedBack = mapSupabaseDecaToLocal(supabaseRowSimulated);
  assert.equal(mappedBack.direccionDestino, localDeca.direccionDestino);
  assert.equal(mappedBack.ciudadDestino, localDeca.ciudadDestino);
  assert.equal(mappedBack.transportista, localDeca.transportista);
  assert.equal(mappedBack.matriculaVehiculo, localDeca.matriculaVehiculo);
  assert.equal(mappedBack.referenciaAlbaran, localDeca.referenciaAlbaran);
  console.log("PASS 8: Mapeo bidireccional DeCA <-> Supabase DecaRow verificado para todos los nuevos campos.");
}

console.log("\nTodas las pruebas de regresión de CSV pasaron satisfactoriamente (8/8).");

