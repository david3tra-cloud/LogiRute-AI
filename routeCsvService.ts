// routeCsvService.ts
// Importación CSV de paradas para Rutas.
// Reutiliza parseCsvRows y normalizeCsvHeader de destinatariosService.
// Construye objetos Delivery independientes, sin crear DeCAs ni documentos.

import { Delivery, DeliveryStatus, DeliveryType } from "./types";
import { normalizeCsvHeader, parseCsvRows } from "./destinatariosService";

// ---------------------------------------------------------------------------
// Columnas reconocidas
// ---------------------------------------------------------------------------

/** Obligatoria: al menos una de {direccion_destino, ciudad_destino} junto con destinatario */
export const REQUIRED_ROUTE_CSV_HEADERS = ["destinatario"] as const;

export const OPTIONAL_ROUTE_CSV_HEADERS = [
  "direccion_destino",
  "ciudad_destino",
  "referencia_albaran",
  "mercancia",
  "peso_kg",
  "bultos",
  "notas",
  "tipo",
  "telefono",
] as const;

const PHONE_CSV_HEADERS = [
  "telefono",
  "telefono_destinatario",
  "movil",
  "phone",
] as const;

// Aliases para la columna 'tipo'
const TIPO_ENTREGA = new Set([
  "entrega",
  "delivery",
  "reparto",
]);
const TIPO_RECOGIDA = new Set([
  "recogida",
  "pickup",
  "recollida",
  "recoleccion",
]);

// ---------------------------------------------------------------------------
// Helpers (mismos criterios que decaCsvService)
// ---------------------------------------------------------------------------

const parseWeight = (value: string): number | null => {
  const normalized = value.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isValidPackageCount = (value: string): boolean =>
  /^\d+$/.test(value) && Number.isSafeInteger(Number(value));

const createStopId = (index: number): string => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `csv-${globalThis.crypto.randomUUID()}`;
  }
  return `csv-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RouteCsvRow =
  | { kind: "valid"; rowNumber: number; delivery: Omit<Delivery, "coordinates"> & { geocodeQuery: string } }
  | { kind: "error"; rowNumber: number; reason: string };

export type RouteCsvPreview = {
  rows: RouteCsvRow[];
  detectedRows: number;
  headerError?: string;
};

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export const previewRoutesCsv = (content: string): RouteCsvPreview => {
  try {
    const rawRows = parseCsvRows(content);
    if (rawRows.length < 2) {
      return {
        rows: [],
        detectedRows: 0,
        headerError: "El CSV no contiene filas de datos.",
      };
    }

    // Build header index map
    const headerIndexes = new Map<string, number>();
    rawRows[0].forEach((header, index) => {
      const normalized = normalizeCsvHeader(header);
      if (!headerIndexes.has(normalized)) headerIndexes.set(normalized, index);
    });
    const phoneHeaderIndex = PHONE_CSV_HEADERS
      .map((header) => headerIndexes.get(normalizeCsvHeader(header)))
      .find((index) => index !== undefined);

    // Check required: destinatario
    const missingRequired = REQUIRED_ROUTE_CSV_HEADERS.filter(
      (h) => !headerIndexes.has(normalizeCsvHeader(h)),
    );
    if (missingRequired.length > 0) {
      return {
        rows: [],
        detectedRows: Math.max(0, rawRows.length - 1),
        headerError: `Falta la columna obligatoria: ${missingRequired.join(", ")}.`,
      };
    }

    // Check location presence (at least one of the two)
    const hasDir = headerIndexes.has(normalizeCsvHeader("direccion_destino"));
    const hasCiu = headerIndexes.has(normalizeCsvHeader("ciudad_destino"));
    if (!hasDir && !hasCiu) {
      return {
        rows: [],
        detectedRows: Math.max(0, rawRows.length - 1),
        headerError:
          "El CSV debe incluir al menos una columna de ubicación: direccion_destino o ciudad_destino.",
      };
    }

    const dataRows = rawRows.slice(1).flatMap((cells, index) =>
      cells.some((cell) => cell.trim())
        ? [{ cells, rowNumber: index + 2 }]
        : [],
    );
    if (dataRows.length === 0) {
      return {
        rows: [],
        detectedRows: 0,
        headerError: "El CSV no contiene filas de datos.",
      };
    }

    const rows = dataRows.map(({ cells, rowNumber }, index): RouteCsvRow => {

      const getVal = (header: string): string => {
        const idx = headerIndexes.get(normalizeCsvHeader(header));
        return (idx !== undefined && cells[idx] !== undefined ? cells[idx] : "").trim();
      };

      const destinatario = getVal("destinatario");
      const direccion = getVal("direccion_destino");
      const ciudad = getVal("ciudad_destino");
      const referencia = getVal("referencia_albaran");
      const mercancia = getVal("mercancia");
      const pesoKgRaw = getVal("peso_kg");
      const bultosRaw = getVal("bultos");
      const notas = getVal("notas");
      const tipoRaw = getVal("tipo").toLocaleLowerCase("es-ES");
      const phone =
        phoneHeaderIndex !== undefined && cells[phoneHeaderIndex] !== undefined
          ? cells[phoneHeaderIndex].trim()
          : "";

      // --- Validations ---
      if (!destinatario) {
        return { kind: "error", rowNumber, reason: "Falta el destinatario." };
      }

      if (!direccion && !ciudad) {
        return {
          kind: "error",
          rowNumber,
          reason: "Falta la ubicación: se necesita direccion_destino o ciudad_destino.",
        };
      }

      if (pesoKgRaw && parseWeight(pesoKgRaw) === null) {
        return {
          kind: "error",
          rowNumber,
          reason: "peso_kg debe ser un número no negativo (ej: 125 o 1250.5).",
        };
      }

      if (bultosRaw && !isValidPackageCount(bultosRaw)) {
        return {
          kind: "error",
          rowNumber,
          reason: "bultos debe ser un número entero no negativo.",
        };
      }

      // --- tipo ---
      let type: DeliveryType;
      if (!tipoRaw) {
        type = DeliveryType.DELIVERY;
      } else if (TIPO_ENTREGA.has(tipoRaw)) {
        type = DeliveryType.DELIVERY;
      } else if (TIPO_RECOGIDA.has(tipoRaw)) {
        type = DeliveryType.PICKUP;
      } else {
        return {
          kind: "error",
          rowNumber,
          reason: `Valor de tipo desconocido: "${getVal("tipo")}". Usa: entrega, recogida, delivery o pickup.`,
        };
      }

      // --- Build address ---
      const addressParts = [direccion, ciudad].filter(Boolean);
      const address = addressParts.join(", ");

      // --- Build geocode query (same strategy as handleAddDeCAToRoutes) ---
      const geocodeQuery = [destinatario, direccion, ciudad].filter(Boolean).join(", ");

      // --- Build notes ---
      const notesParts: string[] = [];
      if (mercancia) notesParts.push(`Mercancía: ${mercancia}`);
      if (bultosRaw) notesParts.push(`Bultos: ${bultosRaw}`);
      if (pesoKgRaw) notesParts.push(`Peso: ${pesoKgRaw} kg`);
      if (referencia) notesParts.push(`Referencia: ${referencia}`);
      if (notas) notesParts.push(notas);

      // --- concept (referencia > mercancía > undefined) ---
      const concept = referencia || mercancia || undefined;

      const delivery: Omit<Delivery, "coordinates"> & { geocodeQuery: string } = {
        id: createStopId(index),
        concept,
        recipient: destinatario,
        address,
        phone: phone || undefined,
        status: DeliveryStatus.PENDING,
        type,
        notes: notesParts.join(" · ") || undefined,
        pesoKg: pesoKgRaw ? parseWeight(pesoKgRaw) : undefined,
        geocodeQuery,
      };

      return { kind: "valid", rowNumber, delivery };
    });

    return { rows, detectedRows: dataRows.length };
  } catch {
    return {
      rows: [],
      detectedRows: 0,
      headerError: "No se pudo interpretar el CSV. Comprueba que esté bien formado.",
    };
  }
};

// ---------------------------------------------------------------------------
// Template CSV (mismo separador y estructura que decaCsvService)
// ---------------------------------------------------------------------------
export const routeTemplateCsv = (): string =>
  `\uFEFFdestinatario;direccion_destino;ciudad_destino;referencia_albaran;mercancia;peso_kg;bultos;notas;tipo\r\nCliente Ejemplo S.L.;Calle Mayor 12;Valencia;ALB-2026-001;Paquetería;25.5;3;;entrega\r\nRecogida Ejemplo S.L.;Polígono Norte Nave 4;Madrid;;;50;1;;recogida\r\n`;
