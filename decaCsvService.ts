import type { DeCA } from "./types";
import {
  normalizeCsvHeader,
  parseCsvRows,
} from "./destinatariosService";

export const REQUIRED_DECA_CSV_HEADERS = [
  "fecha",
  "cargador",
  "destinatario",
  "ciudad_destino",
  "mercancia",
  "bultos",
  "peso_kg",
] as const;

export const OPTIONAL_DECA_CSV_HEADERS = [
  "direccion_destino",
  "transportista",
  "matricula",
  "referencia_albaran",
] as const;

export const DECA_CSV_HEADERS = [
  "fecha",
  "cargador",
  "destinatario",
  "direccion_destino",
  "ciudad_destino",
  "mercancia",
  "bultos",
  "peso_kg",
  "transportista",
  "matricula",
  "referencia_albaran",
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

const createUniqueDecaId = (index: number): string => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
};

export const previewDecasCsv = (
  content: string,
  _existing: DeCA[] = [],
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

    const missingHeaders = REQUIRED_DECA_CSV_HEADERS.filter(
      (header) => !headerIndexes.has(normalizeCsvHeader(header)),
    );

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

    const rows = dataRows.map((cells, index): DecaCsvRow => {
      const getVal = (header: string) => {
        const idx = headerIndexes.get(normalizeCsvHeader(header));
        return (idx !== undefined && cells[idx] !== undefined ? cells[idx] : "").trim();
      };

      const fecha = getVal("fecha");
      const cargador = getVal("cargador");
      const destinatario = getVal("destinatario");
      const ciudadDestino = getVal("ciudad_destino");
      const mercancia = getVal("mercancia");
      const bultos = getVal("bultos");
      const pesoKgRaw = getVal("peso_kg");

      const direccionDestino = getVal("direccion_destino");
      const transportista = getVal("transportista");
      const matriculaVehiculo = getVal("matricula");
      const referenciaAlbaran = getVal("referencia_albaran");

      const missingValues: string[] = [];
      if (!fecha) missingValues.push("fecha");
      if (!cargador) missingValues.push("cargador");
      if (!destinatario) missingValues.push("destinatario");
      if (!ciudadDestino) missingValues.push("ciudad_destino");
      if (!mercancia) missingValues.push("mercancia");
      if (!bultos) missingValues.push("bultos");
      if (!pesoKgRaw) missingValues.push("peso_kg");

      if (missingValues.length > 0) {
        return {
          rowNumber: index + 2,
          reason: `Falta valor en: ${missingValues.join(", ")}.`,
        };
      }

      if (!normalizeDate(fecha)) {
        return {
          rowNumber: index + 2,
          reason: "La fecha debe tener formato AAAA-MM-DD y ser válida.",
        };
      }
      if (!isValidPackageCount(bultos)) {
        return {
          rowNumber: index + 2,
          reason: "bultos debe ser un número entero no negativo.",
        };
      }
      const pesoKg = parseWeight(pesoKgRaw);
      if (pesoKg === null) {
        return {
          rowNumber: index + 2,
          reason: "peso_kg debe ser un número no negativo.",
        };
      }

      const now = new Date().toISOString();
      const deca: DeCA = {
        id: createUniqueDecaId(index),
        fecha,
        cargador,
        transportista,
        destinatario,
        direccionDestino,
        ciudadDestino,
        mercancia,
        numeroBultos: bultos,
        pesoKg,
        referenciaAlbaran,
        matriculaVehiculo,
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
  `\uFEFF${DECA_CSV_HEADERS.join(";")}\r\n2026-10-04;Empresa Ejemplo S.L.;Cliente Ejemplo S.L.;Calle Mayor 12;Valencia;Mercancía de ejemplo;12;1250.5;Transportes Rápidos S.A.;1234-BBB;ALB-2026-001`;
