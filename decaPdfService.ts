import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import type { DeCA, EmpresaHabitual } from "./types";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 16;
const FOOTER_Y = PAGE_HEIGHT - 14;
const NO_INDICADO = "No indicado";

export type DeCAPdfResult = {
  blob: Blob;
  documentoId: string;
  pdfGeneradoEn: string;
  fileName: string;
};

const secureDocumentId = (fecha: string) => {
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha.replaceAll("-", "")
    : new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const secureRandom = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 8)
    : (() => {
        const bytes = new Uint8Array(4);
        if (!globalThis.crypto?.getRandomValues) {
          throw new Error("No se pudo generar un identificador seguro.");
        }
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
      })();
  return `DECA-${datePart}-${secureRandom.toUpperCase()}`;
};

const safeFilePart = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "NO-INDICADO";

const fileDate = (fecha: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date().toISOString().slice(0, 10);

const displayDate = (value: string) => {
  if (!value) return NO_INDICADO;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
};

const displayValue = (value: string | undefined) => value?.trim() || NO_INDICADO;

const qrValue = (value: string | undefined, limit = 36) =>
  (value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const createQrSummary = (deca: DeCA, documentoId: string) =>
  [
    "LOGIROUTE-DECA",
    `ID:${qrValue(documentoId, 42)}`,
    `FECHA:${qrValue(deca.fecha, 10)}`,
    `CARGADOR:${qrValue(deca.cargador)}`,
    `TRANSPORTISTA:${qrValue(deca.transportista)}`,
    `MATRICULA:${qrValue(deca.matriculaVehiculo, 18)}`,
    `DESTINATARIO:${qrValue(deca.destinatario)}`,
    `BULTOS:${qrValue(deca.numeroBultos, 12)}`,
    `PESO_KG:${qrValue(deca.pesoKg, 12)}`,
    `REF:${qrValue(deca.referenciaAlbaran, 24)}`,
  ].join("\n");

const makePdf = async (
  deca: DeCA,
  cargador?: EmpresaHabitual,
  destinatario?: EmpresaHabitual,
) => {
  const documentoId = deca.documentoId || secureDocumentId(deca.fecha);
  const pdfGeneradoEn = new Date().toISOString();
  const generatedDate = new Date(pdfGeneradoEn).toLocaleString("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const fileName = `DECA-${fileDate(deca.fecha)}-${safeFilePart(deca.destinatario)}.pdf`;
  const qrImage = await QRCode.toDataURL(createQrSummary(deca, documentoId), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 17;

  const addPage = () => {
    pdf.addPage("a4", "portrait");
    y = 20;
  };
  const reserve = (height: number) => {
    if (y + height > FOOTER_Y - 5) addPage();
  };
  const writeWrapped = (
    value: string,
    x: number,
    width: number,
    fontSize: number,
    lineHeight: number,
  ) => {
    pdf.setFontSize(fontSize);
    for (const paragraph of value.split(/\r?\n/)) {
      const lines = pdf.splitTextToSize(paragraph || " ", width) as string[];
      for (const line of lines) {
        reserve(lineHeight);
        pdf.text(line, x, y);
        y += lineHeight;
      }
    }
  };
  const writeSection = (title: string) => {
    reserve(13);
    y += 3;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(22, 54, 86);
    pdf.text(title, MARGIN, y);
    y += 2;
    pdf.setDrawColor(208, 218, 228);
    pdf.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
    y += 4;
  };
  const writeRow = (label: string, value: string | undefined) => {
    const content = displayValue(value);
    const lines = content
      .split(/\r?\n/)
      .flatMap((paragraph) =>
        pdf.splitTextToSize(paragraph || " ", PAGE_WIDTH - MARGIN * 2),
      ) as string[];
    reserve(9 + lines.length * 4.5);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(94, 108, 122);
    pdf.text(label, MARGIN, y);
    y += 4;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(32, 42, 52);
    for (const line of lines) {
      reserve(4.5);
      pdf.setFontSize(9.5);
      pdf.text(line, MARGIN, y);
      y += 4.5;
    }
    y += 1;
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(22, 54, 86);
  pdf.text("DOCUMENTO DE CONTROL DE TRANSPORTE", MARGIN, y, {
    maxWidth: 145,
  });
  pdf.addImage(qrImage, "PNG", PAGE_WIDTH - MARGIN - 25, 13, 25, 25);
  y += 9;
  if (deca.estado === "borrador") {
    pdf.setFontSize(9);
    pdf.setTextColor(166, 92, 0);
    pdf.text("BORRADOR — PENDIENTE DE REVISIÓN", MARGIN, y);
    y += 6;
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(50, 60, 70);
  pdf.text(`ID de documento: ${documentoId}`, MARGIN, y);
  y += 5;
  pdf.text(`Fecha y hora de generación: ${generatedDate}`, MARGIN, y);
  y += 5;
  pdf.text(`Fecha de transporte: ${displayDate(deca.fecha)}`, MARGIN, y);
  y += 2;

  writeSection("CARGADOR");
  writeRow("Nombre", deca.cargador);
  writeRow("NIF", cargador?.nif);
  writeRow("Dirección", cargador?.direccion);
  writeRow("Código postal", cargador?.codigoPostal);
  writeRow("Ciudad", cargador?.ciudad);
  writeRow("País", cargador?.pais);

  writeSection("TRANSPORTISTA");
  writeRow("Nombre", deca.transportista);
  writeRow("NIF", deca.transportistaNif);
  writeRow("Dirección", deca.transportistaDireccion);
  writeRow("Código postal", deca.transportistaCodigoPostal);
  writeRow("Ciudad", deca.transportistaCiudad);
  writeRow("Teléfono", deca.transportistaTelefono);
  writeRow("Email", deca.transportistaEmail);

  writeSection("VEHÍCULO Y MERCANCÍA");
  writeRow("Matrícula", deca.matriculaVehiculo);
  writeRow("Mercancía", deca.mercancia);
  writeRow("Número de bultos", deca.numeroBultos);
  writeRow("Peso en kg", deca.pesoKg);
  writeRow("Referencia de albarán", deca.referenciaAlbaran);

  writeSection("DESTINATARIO");
  writeRow("Nombre", deca.destinatario);
  writeRow("NIF", destinatario?.nif);
  writeRow("Dirección", deca.direccionDestino || destinatario?.direccion);
  writeRow("Código postal", destinatario?.codigoPostal);
  writeRow("Ciudad", deca.ciudadDestino || destinatario?.ciudad);
  writeRow("País", destinatario?.pais);
  writeRow("Contacto", destinatario?.contacto);

  writeSection("OBSERVACIONES");
  writeWrapped(deca.notas || NO_INDICADO, MARGIN, PAGE_WIDTH - MARGIN * 2, 9.5, 4.5);

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(208, 218, 228);
    pdf.line(MARGIN, FOOTER_Y - 5, PAGE_WIDTH - MARGIN, FOOTER_Y - 5);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(110, 120, 130);
    pdf.text("Generado por LogiRoute AI", MARGIN, FOOTER_Y);
    pdf.text(`Página ${page} de ${pages}`, PAGE_WIDTH - MARGIN, FOOTER_Y, {
      align: "right",
    });
  }

  return {
    blob: pdf.output("blob"),
    documentoId,
    pdfGeneradoEn,
    fileName,
  } satisfies DeCAPdfResult;
};

export const generateDeCAPdf = makePdf;