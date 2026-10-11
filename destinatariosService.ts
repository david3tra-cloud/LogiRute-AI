import { EmpresaHabitual } from "./types";

export const EMPRESAS_STORAGE_KEY = "logiroute_empresas_v1";
export const DESTINATARIOS_STORAGE_KEY = "logiroute_destinatarios_v1";

const userStorageKey = (key: string, userId?: string) =>
  userId ? `${key}:${encodeURIComponent(userId)}` : key;

export type EmpresaLoadResult = {
  items: EmpresaHabitual[];
  invalid: boolean;
  migrated: boolean;
  migratedCount: number;
};

export type CsvImportRow = {
  rowNumber: number;
  empresa?: EmpresaHabitual;
  reason?: string;
  duplicate?: boolean;
};

const CSV_HEADERS = [
  "nombre",
  "direccion",
  "ciudad",
  "codigoPostal",
  "provincia",
  "pais",
  "nif",
  "telefono",
  "email",
  "contacto",
  "notas",
] as const;

const HEADER_ALIASES: Record<(typeof CSV_HEADERS)[number], string[]> = {
  nombre: ["nombre", "cliente", "destinatario", "razon social"],
  direccion: ["direccion", "domicilio"],
  ciudad: ["ciudad", "poblacion", "localidad"],
  codigoPostal: ["codigopostal", "cp"],
  provincia: ["provincia"],
  pais: ["pais"],
  nif: ["nif", "cif", "vat"],
  telefono: ["telefono", "tel", "movil"],
  email: ["email", "e-mail", "correo"],
  contacto: [
    "contacto",
    "persona contacto",
    "persona de contacto",
    "contact person",
  ],
  notas: ["notas", "observaciones"],
};

export const normalizeRecipientText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();

export const recipientDuplicateKey = (
  recipient: Pick<EmpresaHabitual, "nombre" | "direccion" | "ciudad">,
) =>
  [recipient.nombre, recipient.direccion, recipient.ciudad]
    .map(normalizeRecipientText)
    .join("\u0000");

const isEmpresaHabitual = (value: unknown): value is EmpresaHabitual => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const strings = [
    "id",
    "nombre",
    "direccion",
    "ciudad",
    "codigoPostal",
    "provincia",
    "pais",
    "nif",
    "telefono",
    "email",
    "contacto",
    "notas",
    "createdAt",
    "updatedAt",
  ];
  return strings.every((key) => typeof item[key] === "string");
};

const isLegacyRecipient = (
  value: unknown,
): value is Omit<EmpresaHabitual, "contacto"> & { contacto?: string } => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    [
      "id",
      "nombre",
      "direccion",
      "ciudad",
      "codigoPostal",
      "provincia",
      "pais",
      "nif",
      "telefono",
      "email",
      "notas",
      "createdAt",
      "updatedAt",
    ].every((key) => typeof item[key] === "string") &&
    (item.contacto === undefined || typeof item.contacto === "string")
  );
};

export const loadEmpresas = (userId?: string): EmpresaLoadResult => {
  try {
    const saved = localStorage.getItem(
      userStorageKey(EMPRESAS_STORAGE_KEY, userId),
    );
    if (saved !== null && saved.trim()) {
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed) || !parsed.every(isEmpresaHabitual)) {
        return { items: [], invalid: true, migrated: false, migratedCount: 0 };
      }
      if (parsed.length || userId) {
        return {
          items: parsed,
          invalid: false,
          migrated: false,
          migratedCount: 0,
        };
      }
    }

    if (userId) {
      return { items: [], invalid: false, migrated: false, migratedCount: 0 };
    }

    const legacy = localStorage.getItem(DESTINATARIOS_STORAGE_KEY);
    if (legacy === null) {
      localStorage.setItem(EMPRESAS_STORAGE_KEY, "[]");
      return { items: [], invalid: false, migrated: false, migratedCount: 0 };
    }
    const parsedLegacy: unknown = JSON.parse(legacy);
    if (
      !Array.isArray(parsedLegacy) ||
      !parsedLegacy.every(isLegacyRecipient)
    ) {
      return { items: [], invalid: true, migrated: false, migratedCount: 0 };
    }
    const unique = new Map<string, EmpresaHabitual>();
    parsedLegacy.forEach((recipient) => {
      const empresa: EmpresaHabitual = {
        ...recipient,
        contacto: recipient.contacto ?? "",
      };
      const key = recipientDuplicateKey(empresa);
      if (!unique.has(key)) unique.set(key, empresa);
    });
    const items = [...unique.values()];
    localStorage.setItem(EMPRESAS_STORAGE_KEY, JSON.stringify(items));
    return {
      items,
      invalid: false,
      migrated: true,
      migratedCount: items.length,
    };
  } catch {
    return { items: [], invalid: true, migrated: false, migratedCount: 0 };
  }
};

export const saveEmpresas = (
  items: EmpresaHabitual[],
  userId?: string,
): boolean => {
  try {
    localStorage.setItem(
      userStorageKey(EMPRESAS_STORAGE_KEY, userId),
      JSON.stringify(items),
    );
    return true;
  } catch {
    return false;
  }
};

export const parseCsvRows = (content: string) => {
  const text = content.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const countOutsideQuotes = (line: string, delimiter: string) => {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === '"') {
        if (quoted && line[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (line[index] === delimiter && !quoted) {
        count += 1;
      }
    }
    return count;
  };
  const commaCount = countOutsideQuotes(firstLine, ",");
  const semicolonCount = countOutsideQuotes(firstLine, ";");
  const delimiter = semicolonCount >= commaCount ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV con comillas sin cerrar.");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

export const normalizeCsvHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const getHeaderMap = (header: string[]) => {
  const mapping = new Map<number, (typeof CSV_HEADERS)[number]>();
  header.forEach((value, index) => {
    const normalized = normalizeCsvHeader(value);
    for (const canonical of CSV_HEADERS) {
      const aliases = [canonical, ...HEADER_ALIASES[canonical]];
      if (aliases.some((alias) => normalizeCsvHeader(alias) === normalized)) {
        mapping.set(index, canonical);
        break;
      }
    }
  });
  return mapping;
};

const emptyRecipientFields = () => ({
  codigoPostal: "",
  provincia: "",
  pais: "España",
  nif: "",
  telefono: "",
  email: "",
  contacto: "",
  notas: "",
});

export const previewEmpresasCsv = (
  content: string,
  existing: EmpresaHabitual[],
): { rows: CsvImportRow[]; detectedRows: number; headerError?: string } => {
  try {
    const rawRows = parseCsvRows(content);
    if (rawRows.length < 2)
      return {
        rows: [],
        detectedRows: 0,
        headerError: "El CSV no contiene filas de datos.",
      };
    const mapping = getHeaderMap(rawRows[0]);
    const mappedFields = new Set(mapping.values());
    if (
      !mappedFields.has("nombre") ||
      !mappedFields.has("direccion") ||
      !mappedFields.has("ciudad")
    ) {
      return {
        rows: [],
        detectedRows: Math.max(0, rawRows.length - 1),
        headerError: "La cabecera debe incluir nombre, dirección y ciudad.",
      };
    }

    const validDataRows = rawRows
      .slice(1)
      .filter((row) => row.some((cell) => cell.trim()));
    const existingKeys = new Set(existing.map(recipientDuplicateKey));
    const importKeys = new Set<string>();
    const rows = validDataRows.map((cells, index): CsvImportRow => {
      const fields: Record<(typeof CSV_HEADERS)[number], string> = {
        nombre: "",
        direccion: "",
        ciudad: "",
        ...emptyRecipientFields(),
      };
      mapping.forEach((field, column) => {
        fields[field] = (cells[column] ?? "").trim();
      });
      if (!fields.nombre || !fields.direccion || !fields.ciudad) {
        const missing = [
          !fields.nombre ? "nombre" : "",
          !fields.direccion ? "dirección" : "",
          !fields.ciudad ? "ciudad" : "",
        ].filter(Boolean);
        return { rowNumber: index + 2, reason: `Falta ${missing.join(", ")}.` };
      }
      if (!fields.pais) fields.pais = "España";
      const timestamp = new Date().toISOString();
      const empresa: EmpresaHabitual = {
        id: createRecipientId(),
        ...fields,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const key = recipientDuplicateKey(empresa);
      if (existingKeys.has(key) || importKeys.has(key)) {
        return {
          rowNumber: index + 2,
          empresa,
          duplicate: true,
          reason: "Duplicado.",
        };
      }
      importKeys.add(key);
      return { rowNumber: index + 2, empresa };
    });
    return { rows, detectedRows: validDataRows.length };
  } catch {
    return {
      rows: [],
      detectedRows: 0,
      headerError:
        "No se pudo interpretar el CSV. Comprueba que esté bien formado.",
    };
  }
};

const escapeCsvCell = (value: string) =>
  /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const empresasToCsv = (recipients: EmpresaHabitual[]) => {
  const lines = [CSV_HEADERS.join(";")];
  recipients.forEach((recipient) => {
    lines.push(
      CSV_HEADERS.map((field) => escapeCsvCell(recipient[field])).join(";"),
    );
  });
  return `\uFEFF${lines.join("\r\n")}`;
};

export const empresaTemplateCsv = () =>
  `\uFEFF${CSV_HEADERS.join(";")}\r\nCliente Ejemplo S.L.;Calle Ejemplo 12;Valencia;46001;Valencia;España;B12345678;600000000;ejemplo@empresa.test;Persona de contacto;Registro de ejemplo`;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const uuidFromRandomBytes = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

/**
 * Genera siempre un UUID v4 válido. Nunca devuelve el antiguo fallback
 * `Date.now()-random`, que no puede enviarse a columnas o filtros UUID.
 * Si el entorno no expone criptografía segura, lanza un error en lugar
 * de crear un identificador no válido.
 */
export const createRecipientId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  if (globalThis.crypto?.getRandomValues) return uuidFromRandomBytes();
  throw new Error(
    "No se pudo generar un identificador de empresa seguro en este navegador.",
  );
};

// ---------------------------------------------------------------------------
// Pendientes duraderos de empresas (localStorage por origen/navegador).
// Cada operación guarda el usuario propietario para no mezclar cuentas.
// ---------------------------------------------------------------------------

export type EmpresaPayload = {
  nombre: string;
  direccion: string;
  ciudad: string;
  codigoPostal: string;
  provincia: string;
  pais: string;
  nif: string;
  telefono: string;
  email: string;
  contacto: string;
  notas: string;
};

export type EmpresaPendingOp = {
  userId: string;
  kind: "insert" | "update";
  localId: string;
  targetId: string;
  revision: number;
  payload: EmpresaPayload;
  /**
   * Evidencia durable del payload exacto enviado en el último INSERT.
   * Se persiste antes de llamar al servidor y se conserva hasta que la
   * transición a "update" o la confirmación final queden guardadas.
   */
  insertedPayload?: EmpresaPayload;
  createdAt: string;
  updatedAt: string;
};

export const EMPRESAS_PENDING_OPS_STORAGE_KEY =
  "logiroute_empresas_pending_ops_v1";
export const EMPRESAS_ID_MAP_STORAGE_KEY = "logiroute_empresas_id_map_v1";

export const empresaPayloadFrom = (
  empresa: EmpresaHabitual,
): EmpresaPayload => ({
  nombre: empresa.nombre,
  direccion: empresa.direccion,
  ciudad: empresa.ciudad,
  codigoPostal: empresa.codigoPostal,
  provincia: empresa.provincia,
  pais: empresa.pais,
  nif: empresa.nif,
  telefono: empresa.telefono,
  email: empresa.email,
  contacto: empresa.contacto,
  notas: empresa.notas,
});

export const empresaPayloadsEqual = (
  a: EmpresaPayload,
  b: EmpresaPayload,
): boolean =>
  (Object.keys(a) as (keyof EmpresaPayload)[]).every(
    (key) => a[key] === b[key],
  );

export const empresaBusinessFieldsEqual = (
  a: EmpresaHabitual,
  b: EmpresaHabitual,
): boolean =>
  empresaPayloadsEqual(empresaPayloadFrom(a), empresaPayloadFrom(b));

const isEmpresaPayload = (value: unknown): value is EmpresaPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return [
    "nombre",
    "direccion",
    "ciudad",
    "codigoPostal",
    "provincia",
    "pais",
    "nif",
    "telefono",
    "email",
    "contacto",
    "notas",
  ].every((key) => typeof payload[key] === "string");
};

const isEmpresaPendingOp = (value: unknown): value is EmpresaPendingOp => {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  return (
    typeof op.userId === "string" &&
    op.userId.length > 0 &&
    (op.kind === "insert" || op.kind === "update") &&
    typeof op.localId === "string" &&
    isUuid(op.targetId) &&
    typeof op.revision === "number" &&
    isEmpresaPayload(op.payload) &&
    (op.insertedPayload === undefined ||
      isEmpresaPayload(op.insertedPayload)) &&
    typeof op.createdAt === "string" &&
    typeof op.updatedAt === "string"
  );
};

export type EmpresaPendingOpLoad = {
  ops: EmpresaPendingOp[];
  invalid: boolean;
};

export const loadEmpresaPendingOps = (): EmpresaPendingOpLoad => {
  try {
    const saved = localStorage.getItem(EMPRESAS_PENDING_OPS_STORAGE_KEY);
    if (saved === null) return { ops: [], invalid: false };
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return { ops: [], invalid: true };
    const ops = parsed.filter(isEmpresaPendingOp);
    return { ops, invalid: ops.length !== parsed.length };
  } catch {
    return { ops: [], invalid: true };
  }
};

export const loadEmpresaPendingOpsForUser = (
  userId: string,
): EmpresaPendingOpLoad => {
  try {
    const scopedKey = userStorageKey(EMPRESAS_PENDING_OPS_STORAGE_KEY, userId);
    const scopedSaved = localStorage.getItem(scopedKey);
    const saved =
      scopedSaved ?? localStorage.getItem(EMPRESAS_PENDING_OPS_STORAGE_KEY);
    if (saved === null) return { ops: [], invalid: false };
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return { ops: [], invalid: true };
    const validOps = parsed.filter(isEmpresaPendingOp);
    const ops = validOps.filter((op) => op.userId === userId);
    return {
      ops,
      invalid: validOps.length !== parsed.length,
    };
  } catch {
    return { ops: [], invalid: true };
  }
};

export const saveEmpresaPendingOps = (ops: EmpresaPendingOp[]): boolean => {
  try {
    localStorage.setItem(EMPRESAS_PENDING_OPS_STORAGE_KEY, JSON.stringify(ops));
    return true;
  } catch {
    return false;
  }
};

export const saveEmpresaPendingOpsForUser = (
  userId: string,
  ops: EmpresaPendingOp[],
): boolean => {
  if (ops.some((op) => op.userId !== userId)) return false;
  try {
    localStorage.setItem(
      userStorageKey(EMPRESAS_PENDING_OPS_STORAGE_KEY, userId),
      JSON.stringify(ops),
    );
    return true;
  } catch {
    return false;
  }
};

export const loadEmpresaIdMap = (userId?: string): Record<string, string> => {
  try {
    const saved = localStorage.getItem(
      userStorageKey(EMPRESAS_ID_MAP_STORAGE_KEY, userId),
    );
    if (saved === null) return {};
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const idMap: Record<string, string> = {};

    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (isUuid(value)) {
        idMap[key] = value;
      }
    }

    return idMap;
  } catch {
    return {};
  }
};

export const saveEmpresaIdMap = (
  map: Record<string, string>,
  userId?: string,
): boolean => {
  try {
    localStorage.setItem(
      userStorageKey(EMPRESAS_ID_MAP_STORAGE_KEY, userId),
      JSON.stringify(map),
    );
    return true;
  } catch {
    return false;
  }
};

export type EmpresaMergeResult = {
  rows: EmpresaHabitual[];
  remaps: { from: string; to: string }[];
  ambiguous: boolean;
  localOnlyCount: number;
};

/**
 * Fusiona el estado local con la lista remota sin sobrescribir cambios
 * pendientes:
 * - filas con operaciones pendientes: se conserva la versión local;
 * - filas sincronizadas sin pendientes: gana la versión remota;
 * - filas locales sin equivalente remoto: se conservan (respaldo);
 * - coincidencias por recipientDuplicateKey con id distinto: si el contenido
 *   coincide se adopta el id remoto; si difiere o hay varias coincidencias,
 *   se conserva lo local y se marca ambigüedad.
 */
export const mergeEmpresaState = (
  localRows: EmpresaHabitual[],
  remoteRows: EmpresaHabitual[],
  pendingOps: EmpresaPendingOp[],
): EmpresaMergeResult => {
  const pendingIds = new Set<string>();
  pendingOps.forEach((op) => {
    pendingIds.add(op.localId);
    pendingIds.add(op.targetId);
  });

  const remoteByKey = new Map<string, EmpresaHabitual[]>();
  remoteRows.forEach((row) => {
    const key = recipientDuplicateKey(row);
    const bucket = remoteByKey.get(key);
    if (bucket) bucket.push(row);
    else remoteByKey.set(key, [row]);
  });

  const rows: EmpresaHabitual[] = [];
  const remaps: { from: string; to: string }[] = [];
  const consumedRemoteIds = new Set<string>();
  const excludedRemoteIds = new Set<string>();
  let ambiguous = false;
  let localOnlyCount = 0;

  for (const local of localRows) {
    if (pendingIds.has(local.id)) {
      rows.push(local);
      continue;
    }
    const sameRow = remoteRows.find((row) => row.id === local.id);
    if (sameRow) {
      rows.push({ ...local, ...sameRow });
      consumedRemoteIds.add(sameRow.id);
      continue;
    }
    const matches = remoteByKey.get(recipientDuplicateKey(local)) ?? [];
    if (matches.length === 1) {
      const match = matches[0];
      if (empresaBusinessFieldsEqual(local, match)) {
        if (match.id !== local.id)
          remaps.push({ from: local.id, to: match.id });
        rows.push({ ...local, id: match.id });
        consumedRemoteIds.add(match.id);
      } else {
        rows.push(local);
        excludedRemoteIds.add(match.id);
        ambiguous = true;
      }
    } else if (matches.length > 1) {
      rows.push(local);
      matches.forEach((match) => excludedRemoteIds.add(match.id));
      ambiguous = true;
    } else {
      rows.push(local);
      localOnlyCount += 1;
    }
  }

  for (const remote of remoteRows) {
    if (consumedRemoteIds.has(remote.id) || excludedRemoteIds.has(remote.id)) {
      continue;
    }
    if (pendingIds.has(remote.id)) continue;
    rows.push(remote);
  }

  return { rows, remaps, ambiguous, localOnlyCount };
};
