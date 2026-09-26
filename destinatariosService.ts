import { EmpresaHabitual } from "./types";

export const EMPRESAS_STORAGE_KEY = "logiroute_empresas_v1";
export const DESTINATARIOS_STORAGE_KEY = "logiroute_destinatarios_v1";

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

export const loadEmpresas = (): EmpresaLoadResult => {
  try {
    const saved = localStorage.getItem(EMPRESAS_STORAGE_KEY);
    if (saved !== null && saved.trim()) {
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed) || !parsed.every(isEmpresaHabitual)) {
        return { items: [], invalid: true, migrated: false, migratedCount: 0 };
      }
      if (parsed.length) {
        return {
          items: parsed,
          invalid: false,
          migrated: false,
          migratedCount: 0,
        };
      }
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

const parseCsvRows = (content: string) => {
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

const normalizeHeader = (value: string) =>
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
    const normalized = normalizeHeader(value);
    for (const canonical of CSV_HEADERS) {
      const aliases = [canonical, ...HEADER_ALIASES[canonical]];
      if (aliases.some((alias) => normalizeHeader(alias) === normalized)) {
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
        id:
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
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

export const createRecipientId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
