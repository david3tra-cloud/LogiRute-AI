import { jsPDF } from "jspdf";
import { aggregateActivity } from "./billingActivity.js";
import {
  aggregateKilometros,
  aggregatePesos,
  orderedStops,
  pesoKgDeParada,
} from "./jornadaMetricas.mjs";
import type { BillingRecord } from "./billingSupabaseService";
import { DeliveryStatus, DeliveryType } from "./types";

const MARGIN = 11;
const CONTENT_BOTTOM_MARGIN = 15;
const FOOTER_BOTTOM_MARGIN = 8;
const ROW_FONT_SIZE = 9.5;
const ROW_LINE_HEIGHT = 3.7;
const ROW_PADDING = 1.5;

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);

const displayCount = (value: unknown): string =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? String(value)
    : "Sin datos";

const displayOptionalText = (value: unknown): string =>
  typeof value === "string" && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    : "Sin datos";

const stopTypeLabel = (type: string): string =>
  type === DeliveryType.DELIVERY
    ? "Entrega"
    : type === DeliveryType.PICKUP
      ? "Recogida"
      : "Tipo sin datos";

const stopStatusLabels: Record<string, string> = {
  [DeliveryStatus.COMPLETED]: "Completada",
  [DeliveryStatus.ISSUE]: "Incidencia",
  [DeliveryStatus.IN_PROGRESS]: "En curso",
  [DeliveryStatus.CANCELLED]: "Cancelada",
  [DeliveryStatus.PENDING]: "Pendiente",
};

const formatWeightValue = (
  bucket: ReturnType<typeof aggregatePesos>["deliveries"],
  completed: boolean,
  hasIncompleteSnapshots: boolean,
): string => {
  const kg = completed ? bucket.completedKg : bucket.plannedKg;
  const withWeight = completed
    ? bucket.completedWithWeight
    : bucket.plannedWithWeight;
  const missing = completed
    ? bucket.completedMissing
    : bucket.plannedMissing;

  if (withWeight > 0) {
    return `${formatNumber(kg)} kg (${withWeight} con peso)${missing > 0 ? `; ${missing} sin dato` : ""}`;
  }
  if (missing > 0) return `${missing} sin dato de peso`;
  if (hasIncompleteSnapshots) return "Sin datos";
  return completed ? "Sin paradas completadas" : "Sin paradas";
};

export function createBillingActivityPdf(record: BillingRecord): jsPDF {
  if (!record || !record.snapshot || typeof record.snapshot !== "object") {
    throw new Error("No hay una instantánea válida para generar el PDF.");
  }

  const document = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const contentBottom = pageHeight - CONTENT_BOTTOM_MARGIN;
  const numberColumnWidth = 10;
  const typeColumnWidth = 37;
  const detailsColumnX = MARGIN + numberColumnWidth + typeColumnWidth;
  const detailsColumnWidth = contentWidth - numberColumnWidth - typeColumnWidth;
  const summaryLineHeight = 4;
  let y = MARGIN;
  let tableStartY = 0;

  const cleanText = (value: string): string =>
    value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const getLines = (
    value: string,
    width: number,
    fontSize: number,
    bold = false,
  ): string[] => {
    document.setFont("helvetica", bold ? "bold" : "normal");
    document.setFontSize(fontSize);
    const wrapped = document.splitTextToSize(cleanText(value), width);
    return Array.isArray(wrapped) ? wrapped : [wrapped];
  };

  const drawDocumentHeader = (continued: boolean) => {
    document.setTextColor(15, 23, 42);
    document.setFont("helvetica", "bold");
    document.setFontSize(14);
    document.text("Resumen de actividad diaria", MARGIN, y + 5);
    document.setFont("helvetica", "normal");
    document.setFontSize(9.5);
    document.text(
      `Fecha de trabajo: ${record.work_date || "Sin datos"}`,
      pageWidth - MARGIN,
      y + 5,
      { align: "right" },
    );
    y += 9;
    if (continued) {
      document.setFont("helvetica", "bold");
      document.setFontSize(9);
      document.text("Desglose de paradas (continuación)", MARGIN, y + 3);
      y += 6;
    }
  };

  const drawTableHeader = () => {
    const headerHeight = 7;
    document.setFillColor(219, 234, 254);
    document.setDrawColor(203, 213, 225);
    document.rect(MARGIN, y, contentWidth, headerHeight, "FD");
    document.setTextColor(30, 64, 175);
    document.setFont("helvetica", "bold");
    document.setFontSize(8.5);
    document.text("N.º", MARGIN + 2, y + 4.8);
    document.text("Tipo / estado", MARGIN + numberColumnWidth + 2, y + 4.8);
    document.text("Datos de la parada", detailsColumnX + 2, y + 4.8);
    y += headerHeight + 1;
    tableStartY = y;
  };

  const addContinuationPage = () => {
    document.addPage();
    y = MARGIN;
    drawDocumentHeader(true);
    drawTableHeader();
  };

  const writeSummaryLine = (value: string, bold = false) => {
    const lines = getLines(value, contentWidth, 9, bold);
    document.setTextColor(51, 65, 85);
    document.setFont("helvetica", bold ? "bold" : "normal");
    document.setFontSize(9);
    for (const line of lines) {
      document.text(line, MARGIN, y + 3);
      y += summaryLineHeight;
    }
  };

  const snapshot = record.snapshot;
  const activity = aggregateActivity([record]);
  const kilometers = aggregateKilometros([record]);
  const weights = aggregatePesos([record]);
  const deliveries = Array.isArray(snapshot.deliveries)
    ? snapshot.deliveries
    : null;
  const hasIncompleteWeightSnapshots = weights.missingSnapshots > 0;

  document.setProperties({
    title: "Resumen de actividad diaria",
    subject: "Actividad registrada de jornada",
  });
  drawDocumentHeader(false);
  document.setTextColor(30, 64, 175);
  document.setFont("helvetica", "bold");
  document.setFontSize(9.5);
  document.text("Resumen", MARGIN, y + 3);
  y += 5;

  writeSummaryLine(
    `Paradas: ${displayCount(snapshot.resumen?.totalStops)} · Completadas: ${displayCount(snapshot.resumen?.completedStops)} · Incidencias: ${displayCount(snapshot.resumen?.issueStops)} · Pendientes o en curso: ${displayCount(snapshot.resumen?.pendingStops)}`,
  );
  if (activity.complete) {
    writeSummaryLine(
      `Entregas: ${activity.deliveries.completed} realizadas / ${activity.deliveries.planned} planificadas · Recogidas: ${activity.pickups.completed} realizadas / ${activity.pickups.planned} planificadas`,
    );
  } else {
    writeSummaryLine("Entregas y recogidas: sin datos; falta el desglose de paradas.");
  }

  const distance =
    kilometers.missing === 0
      ? `${formatNumber(kilometers.km)} km`
      : "Sin datos";
  const initialReading = isNonNegativeNumber(snapshot.kilometrajeInicial)
    ? `${formatNumber(snapshot.kilometrajeInicial)} km`
    : "Sin datos";
  const finalReading = isNonNegativeNumber(snapshot.kilometrajeFinal)
    ? `${formatNumber(snapshot.kilometrajeFinal)} km`
    : "Sin datos";
  writeSummaryLine(
    `Kilómetros recorridos: ${distance} · Lectura inicial: ${initialReading} · Lectura final: ${finalReading}`,
  );
  writeSummaryLine(
    `Entregas — Realizado: ${formatWeightValue(weights.deliveries, true, hasIncompleteWeightSnapshots)} · Planificado: ${formatWeightValue(weights.deliveries, false, hasIncompleteWeightSnapshots)}`,
  );
  writeSummaryLine(
    `Recogidas — Realizado: ${formatWeightValue(weights.pickups, true, hasIncompleteWeightSnapshots)} · Planificado: ${formatWeightValue(weights.pickups, false, hasIncompleteWeightSnapshots)}`,
  );
  if (hasIncompleteWeightSnapshots) {
    writeSummaryLine(
      `Peso parcial: faltan datos en ${weights.missingSnapshots} jornadas.`,
    );
  }
  y += 2;
  document.setDrawColor(203, 213, 225);
  document.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 2;
  drawTableHeader();

  if (!deliveries) {
    writeSummaryLine("Sin datos: la instantánea no contiene la lista de paradas.");
  } else if (deliveries.length === 0) {
    writeSummaryLine("No hay paradas registradas.");
  } else {
    const ordered = orderedStops({
      deliveries,
      sequence: Array.isArray(snapshot.sequence) ? snapshot.sequence : [],
    });

    ordered.forEach((stop, index) => {
      const weight = pesoKgDeParada(stop);
      const detailFields: string[] = [];
      if (typeof stop.concept === "string" && stop.concept.trim()) {
        detailFields.push(`Concepto: ${displayOptionalText(stop.concept)}`);
      }
      if (typeof stop.estimatedTime === "string" && stop.estimatedTime.trim()) {
        detailFields.push(
          `Hora estimada: ${displayOptionalText(stop.estimatedTime)}`,
        );
      }
      if (typeof stop.phone === "string" && stop.phone.trim()) {
        detailFields.push(`Teléfono: ${displayOptionalText(stop.phone)}`);
      }
      detailFields.push(
        `Peso asociado: ${weight === null ? "Sin datos" : `${formatNumber(weight)} kg`}`,
      );
      if (typeof stop.notes === "string" && stop.notes.trim()) {
        detailFields.push(`Observaciones: ${displayOptionalText(stop.notes)}`);
      }

      const recipientLines = getLines(
        `Destinatario: ${displayOptionalText(stop.recipient)} · Dirección: ${displayOptionalText(stop.address)}`,
        detailsColumnWidth - 4,
        ROW_FONT_SIZE,
        true,
      ).map((text) => ({ text, bold: true }));
      const detailLines = getLines(
        detailFields.join(" · "),
        detailsColumnWidth - 4,
        ROW_FONT_SIZE,
      ).map((text) => ({ text, bold: false }));
      const typeLines = getLines(
        `${stopTypeLabel(stop.type)} · ${stopStatusLabels[stop.status] ?? "Estado sin datos"}`,
        typeColumnWidth - 4,
        ROW_FONT_SIZE,
      );
      const rowLines = [...recipientLines, ...detailLines];
      const lineCount = Math.max(rowLines.length, typeLines.length, 1);
      const rowHeight = lineCount * ROW_LINE_HEIGHT + ROW_PADDING * 2;
      const pageRowCapacity = contentBottom - tableStartY;

      const drawRowPart = (
        offset: number,
        visibleLines: number,
        partHeight: number,
      ) => {
        const rowTop = y;
        const continuation = offset > 0;
        document.setFillColor(
          index % 2 === 0 ? 255 : 248,
          index % 2 === 0 ? 255 : 250,
          index % 2 === 0 ? 255 : 252,
        );
        document.setDrawColor(226, 232, 240);
        document.rect(MARGIN, rowTop, contentWidth, partHeight, "FD");
        document.setTextColor(71, 85, 105);
        document.setFont("helvetica", "bold");
        document.setFontSize(ROW_FONT_SIZE);
        document.text(
          continuation ? `${index + 1} (cont.)` : String(index + 1),
          MARGIN + 2,
          rowTop + ROW_PADDING + 3,
        );

        if (continuation) {
          document.setFont("helvetica", "normal");
          document.setFontSize(8.5);
          document.text(
            "Continúa",
            MARGIN + numberColumnWidth + 2,
            rowTop + ROW_PADDING + 3,
          );
        } else {
          typeLines.slice(offset, offset + visibleLines).forEach((line, lineIndex) => {
            document.setFont("helvetica", "normal");
            document.setFontSize(ROW_FONT_SIZE);
            document.text(
              line,
              MARGIN + numberColumnWidth + 2,
              rowTop + ROW_PADDING + 3 + lineIndex * ROW_LINE_HEIGHT,
            );
          });
        }

        rowLines.slice(offset, offset + visibleLines).forEach((line, lineIndex) => {
          document.setFont("helvetica", line.bold ? "bold" : "normal");
          document.setFontSize(ROW_FONT_SIZE);
          document.setTextColor(51, 65, 85);
          document.text(
            line.text,
            detailsColumnX + 2,
            rowTop + ROW_PADDING + 3 + lineIndex * ROW_LINE_HEIGHT,
          );
        });
        y += partHeight;
      };

      if (rowHeight > pageRowCapacity) {
        if (y > tableStartY) addContinuationPage();
        let offset = 0;
        while (offset < lineCount) {
          const availableHeight = contentBottom - y - ROW_PADDING * 2;
          const availableLines = Math.floor(availableHeight / ROW_LINE_HEIGHT);
          if (availableLines < 1) {
            addContinuationPage();
            continue;
          }
          const visibleLines = Math.min(availableLines, lineCount - offset);
          const partHeight =
            visibleLines * ROW_LINE_HEIGHT + ROW_PADDING * 2;
          drawRowPart(offset, visibleLines, partHeight);
          offset += visibleLines;
          if (offset < lineCount) addContinuationPage();
        }
      } else {
        if (y + rowHeight > contentBottom) addContinuationPage();
        drawRowPart(0, lineCount, rowHeight);
      }
    });
  }

  const pageCount = document.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    document.setPage(page);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.setTextColor(71, 85, 105);
    document.text(
      `Página ${page} de ${pageCount}`,
      pageWidth - MARGIN,
      pageHeight - FOOTER_BOTTOM_MARGIN,
      { align: "right" },
    );
  }
  return document;
}

export function downloadBillingActivityPdf(record: BillingRecord): void {
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(record.work_date)
    ? record.work_date
    : "sin-fecha";
  createBillingActivityPdf(record).save(`actividad-diaria-${datePart}.pdf`);
}
