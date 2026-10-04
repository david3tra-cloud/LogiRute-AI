import type { DeCA } from "./types";
import {
  normalizeCsvHeader,
  normalizeRecipientText,
  parseCsvRows,
} from "./destinatariosService";

const DECA_CSV_HEADERS = [
  "fecha",
  "cargador",
  "destinatario",
  "ciudad_destino",
  "mercancia",
  "bultos",
  "peso_kg",
] as const;

export type DecaCsvRow = {
  rowNumber: number;
  deca?: DeCA;
  reason?: string;
  duplicate?: boolean;
};

export type DecaCsvPreview = {
  rows: DecaCsvRow[];
  detectedRows: number;
  headerError?: string;
};

const normalizeDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
};

const parseWeight = (value: string) => {
  const normalized = value.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? String(parsed) : null;
};

const isValidPackageCount = (value: string) =>
  /^\d+$/.test(value) && Number.isSafeInteger(Number(value));

const decaDuplicateKey = (
  deca: Pick<DeCA, "fecha" | "cargador" | "destinatario">,
) =>
  [deca.fecha, deca.cargador, deca.destinatario]
    .map(normalizeRecipientText)
    .join("\u0000");

export const previewDecasCsv = (
  content: string,
  existing: DeCA[] = [],
): DecaCsvPreview => {
  try {
    const rawRows = parseCsvRows(content);
    if (rawRows.length < 2) {
      return {
        rows: [],
        detectedRows: 0,
        headerError: "El CSV no contiene filas de datos.",
      };
    }

    const headerIndexes = new Map<string, number>();
    rawRows[0].forEach((header, index) => {
      const normalized = normalizeCsvHeader(header);
      if (!headerIndexes.has(normalized)) headerIndexes.set(normalized, index);
    });
    const requiredHeaders = DECA_CSV_HEADERS.map((header) => ({
      header,
      normalized: normalizeCsvHeader(header),
    }));
    const missingHeaders = requiredHeaders
      .filter(({ normalized }) => !headerIndexes.has(normalized))
      .map(({ header }) => header);
    if (missingHeaders.length > 0) {
      return {
        rows: [],
        detectedRows: Math.max(0, rawRows.length - 1),
        headerError: `Faltan las columnas obligatorias: ${missingHeaders.join(", ")}.`,
      };
    }

    const dataRows = rawRows
      .slice(1)
      .filter((row) => row.some((cell) => cell.trim()));
    if (dataRows.length === 0) {
      return {
        rows: [],
        detectedRows: 0,
        headerError: "El CSV no contiene filas de datos.",
      };
    }
    const seenKeys = new Set(existing.map(decaDuplicateKey));
    const rows = dataRows.map((cells, index): DecaCsvRow => {
      const values = Object.fromEntries(
        requiredHeaders.map(({ header, normalized }) => [
          header,
          (cells[headerIndexes.get(normalized)!] ?? "").trim(),
        ]),
      ) as Record<(typeof DECA_CSV_HEADERS)[number], string>;

      const missingValues = DECA_CSV_HEADERS.filter(
        (header) => !values[header],
      );
      if (missingValues.length > 0) {
        return {
          rowNumber: index + 2,
          reason: `Falta valor en: ${missingValues.join(", ")}.`,
        };
      }
      if (!normalizeDate(values.fecha)) {
        return {
          rowNumber: index + 2,
          reason: "La fecha debe tener formato AAAA-MM-DD y ser válida.",
        };
      }
      if (!isValidPackageCount(values.bultos)) {
        return {
          rowNumber: index + 2,
          reason: "bultos debe ser un número entero no negativo.",
        };
      }
      const pesoKg = parseWeight(values.peso_kg);
      if (pesoKg === null) {
        return {
          rowNumber: index + 2,
          reason: "peso_kg debe ser un número no negativo.",
        };
      }

      const duplicateCandidate = {
        fecha: values.fecha,
        cargador: values.cargador,
        destinatario: values.destinatario,
      };
      const duplicateKey = decaDuplicateKey(duplicateCandidate);
      if (seenKeys.has(duplicateKey)) {
        return {
          rowNumber: index + 2,
          duplicate: true,
          reason: "Duplicado por fecha, cargador y destinatario.",
        };
      }
      seenKeys.add(duplicateKey);

      const now = new Date().toISOString();
      const deca: DeCA = {
        id:
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        fecha: values.fecha,
        cargador: values.cargador,
        transportista: "",
        destinatario: values.destinatario,
        direccionDestino: "",
        ciudadDestino: values.ciudad_destino,
        mercancia: values.mercancia,
        numeroBultos: values.bultos,
        pesoKg,
        referenciaAlbaran: "",
        matriculaVehiculo: "",
        notas: "",
        estado: "borrador",
        createdAt: now,
        updatedAt: now,
      };
      return { rowNumber: index + 2, deca };
    });

    return { rows, detectedRows: dataRows.length };
  } catch {
    return {
      rows: [],
      detectedRows: 0,
      headerError:
        "No se pudo interpretar el CSV. Comprueba que esté bien formado.",
    };
  }
};

export const decaTemplateCsv = () =>
  `\uFEFF${DECA_CSV_HEADERS.join(";")}\r\n2026-10-04;Empresa Ejemplo S.L.;Cliente Ejemplo S.L.;Valencia;Mercancía de ejemplo;12;1250.5`;
