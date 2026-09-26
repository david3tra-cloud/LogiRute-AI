import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Plus, Trash2, Upload } from "lucide-react";
import {
  DeCA,
  EmpresaHabitual,
  MatriculaHabitual,
  TransportistaHabitual,
} from "./types";
import DestinatariosManager from "./DestinatariosManager";
import TransportistasManager from "./TransportistasManager";
import {
  createRecipientId,
  EMPRESAS_STORAGE_KEY,
  loadEmpresas,
  normalizeRecipientText,
} from "./destinatariosService";
import {
  getImageDimensions,
  recognizeDachserRegions,
  type DachserRegionTexts,
  type DachserTemplateSignals,
  DACHSER_SIGNAL_LABELS,
  detectDachserTemplateSignals,
} from "./decaOcr";

const STORAGE_KEY = "transport_app_decas";

type DeCAForm = Pick<
  DeCA,
  | "fecha"
  | "cargador"
  | "destinatario"
  | "direccionDestino"
  | "ciudadDestino"
  | "numeroBultos"
  | "pesoKg"
  | "mercancia"
  | "referenciaAlbaran"
  | "matriculaVehiculo"
  | "notas"
  | "transportista"
  | "transportistaNif"
  | "transportistaDireccion"
  | "transportistaCiudad"
  | "transportistaCodigoPostal"
  | "transportistaProvincia"
  | "transportistaPais"
  | "transportistaTelefono"
  | "transportistaEmail"
  | "transportistaNotas"
> &
  Pick<DeCA, "fotoAlbaran" | "nombreFotoAlbaran">;

type SectionView = "list" | "form" | "detail" | "companies" | "carriers";
type OCRWorker = {
  recognize: (image: string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type SuggestibleField =
  | "fecha"
  | "destinatario"
  | "direccionDestino"
  | "ciudadDestino"
  | "numeroBultos"
  | "pesoKg"
  | "referenciaAlbaran";

type AppliedSuggestions = {
  previous: Partial<Record<SuggestibleField, string>>;
  applied: Partial<Record<SuggestibleField, string>>;
};
type SuggestionResult = {
  field: SuggestibleField;
  value: string;
  status: "applied" | "manual" | "existing" | "undone";
};

const SUGGESTIBLE_FIELD_LABELS: Record<SuggestibleField, string> = {
  fecha: "Fecha",
  destinatario: "Destinatario o empresa",
  direccionDestino: "Dirección de destino",
  ciudadDestino: "Ciudad de destino",
  numeroBultos: "Número de bultos",
  pesoKg: "Peso (kg)",
  referenciaAlbaran: "Referencia de albarán",
};

type OCRLine = { original: string; normalized: string; offsets: number[] };
type OCRLabel = { index: number; end: number };

const normalizeOCRLine = (original: string): OCRLine => {
  let normalized = "";
  const offsets: number[] = [];
  let pendingSpace = false;
  let spaceOffset = 0;

  for (let index = 0; index < original.length; index += 1) {
    const character = original[index];
    if (/\s/.test(character)) {
      if (normalized && !pendingSpace) {
        pendingSpace = true;
        spaceOffset = index;
      }
      continue;
    }

    if (pendingSpace) {
      normalized += " ";
      offsets.push(spaceOffset);
      pendingSpace = false;
    }
    const clean = character
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    normalized += clean;
    for (let charIndex = 0; charIndex < clean.length; charIndex += 1) {
      offsets.push(index);
    }
  }
  return { original, normalized, offsets };
};

const cleanOCRLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => normalizeOCRLine(line.trim()))
    .filter((line) => line.normalized.length >= 3);

const LABEL_ALIASES: Record<string, string[]> = {
  date: ["FECHA"],
  sender: ["REMITENTE", "EXPEDIDOR", "ORIGEN"],
  recipient: ["DESTINATARIO", "CONSIGNATARIO", "CLIENTE", "ENTREGA"],
  address: ["DIRECCION"],
  city: ["POBLACION", "CIUDAD"],
  weight: ["PESO", "PESC", "PFSO"],
  packages: ["BULTOS", "BULIOS", "PALETS", "PALET", "UNIDADES"],
  reference: ["ALBARAN", "REFERENCIA", "REF", "RFF", "REE", "PEDIDO"],
  goods: ["MERCANCIA", "DESCRIPCION", "CONCEPTO", "DETALLE", "ARTICULO"],
};

const levenshteinAtMostOne = (left: string, right: string) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let differences = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    differences += 1;
    if (differences > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return (
    differences +
      Number(leftIndex < left.length || rightIndex < right.length) <=
    1
  );
};

const findLabel = (line: OCRLine, aliases: string[]): OCRLabel | undefined => {
  const tokens = [...line.normalized.matchAll(/[A-Z0-9]+/g)];
  for (const token of tokens) {
    const value = token[0];
    const alias = aliases.find(
      (candidate) =>
        value === candidate ||
        (candidate.length >= 5 && levenshteinAtMostOne(value, candidate)),
    );
    if (alias)
      return {
        index: token.index ?? 0,
        end: (token.index ?? 0) + value.length,
      };
  }
  return undefined;
};

const valueAfterLabel = (line: OCRLine, label: OCRLabel) => {
  const originalStart = line.offsets[label.end] ?? line.original.length;
  return line.original
    .slice(originalStart)
    .replace(/^[\s:;#№º°.-]+/, "")
    .trim();
};

const uniqueValue = (values: string[]) => {
  const distinct = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return distinct.length === 1 ? distinct[0] : undefined;
};

const isAdministrativeLine = (line: OCRLine) =>
  /\b(?:TOTAL FACTURA|RECIBIDO|FIRMA|IVA|PORTES|NIF|CIF|TELEFONO|TELEF|FAX)\b/.test(
    line.normalized,
  ) ||
  /^\d{5}$/.test(line.normalized) ||
  /^(?:ES)?[A-Z]?\d{7,8}[A-Z]?$/.test(line.normalized) ||
  /^(?:\+?\d[\d\s()./-]{7,})$/.test(line.normalized);

const normalizeCandidates = (values: string[]) => uniqueValue(values);

const isSenderMarker = (line: OCRLine) =>
  Boolean(findLabel(line, LABEL_ALIASES.sender)) ||
  (/\bPLAZA\b/.test(line.normalized) && /\bORIGEN\b/.test(line.normalized));

const isRecipientMarker = (line: OCRLine) =>
  Boolean(findLabel(line, LABEL_ALIASES.recipient));

const isGoodsMarker = (line: OCRLine) =>
  Boolean(findLabel(line, LABEL_ALIASES.goods));

const isRecipientBlockBoundary = (line: OCRLine) =>
  isSenderMarker(line) ||
  isRecipientMarker(line) ||
  isGoodsMarker(line) ||
  /\b(?:OBSERVACIONES|FIRMA|RECIBIDO|TOTAL|IVA|PORTES)\b/.test(
    line.normalized,
  ) ||
  Boolean(findLabel(line, LABEL_ALIASES.reference)) ||
  Boolean(findLabel(line, LABEL_ALIASES.weight)) ||
  Boolean(findLabel(line, LABEL_ALIASES.packages));

const isPostalOrContactLine = (line: OCRLine) =>
  /\b\d{5}\b/.test(line.normalized) ||
  isAdministrativeLine(line) ||
  /\b(?:NIF|CIF|TEL|TELEFONO|FAX)\b/.test(line.normalized);

const isAddressLine = (line: OCRLine) =>
  /(?:\bCALLE\b|\bC\/|\bAVENIDA\b|\bAVDA\b|\bAV\b|\bPLAZA\b|\bPOLIGONO\b|\bPOL\.|\bCAMINO\b|\bCARRETERA\b|\bKM\b)/.test(
    line.normalized,
  ) || /\b\d{5}\b/.test(line.normalized);

const isDisallowedGoodsLine = (line: OCRLine) =>
  isAdministrativeLine(line) ||
  isAddressLine(line) ||
  /\b(?:CP|CANTIDAD|UNIDADES|PORTES|IMPORTE|TOTAL|IVA|PRECIO|FIRMA|OBSERVACIONES|REMITENTE|DESTINATARIO)\b/.test(
    line.normalized,
  ) ||
  /^\d+(?:[.,]\d+)?\s*(?:€|EUR)?$/.test(line.normalized);

const extractSuggestions = (
  text: string,
): Partial<Record<SuggestibleField, string>> => {
  const originalLines = cleanOCRLines(text);
  const normalizedText = originalLines
    .map((line) => line.normalized)
    .join("\n");
  const suggestions: Partial<Record<SuggestibleField, string>> = {};
  const dateValues: string[] = [];
  for (const match of normalizedText.matchAll(
    /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g,
  )) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      dateValues.push(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
  }
  const fecha = uniqueValue(dateValues);
  if (fecha) suggestions.fecha = fecha;

  const referenceCandidates = originalLines.flatMap((line, index) => {
    const label = findLabel(line, LABEL_ALIASES.reference);
    if (!label) return [];
    const cleanReferencePrefix = (value: string) =>
      value
        .replace(/^\s*(?:N[º°O.]?|NUM(?:ERO)?)\s*/i, "")
        .replace(/^\s*(?:ENV[IÍ]O|ALBAR[AÁ]N)\b\s*/i, "");
    const tail = cleanReferencePrefix(valueAfterLabel(line, label));
    const next = originalLines[index + 1];
    const rawValue =
      tail ||
      (next && !isAdministrativeLine(next)
        ? cleanReferencePrefix(next.original)
        : "");
    if (!rawValue) return [];
    const candidates = [...rawValue.matchAll(/[A-Z0-9]+(?:[/-][A-Z0-9]+)*/gi)]
      .map((match) => match[0])
      .filter(
        (value) =>
          value.length >= 2 && value.length <= 24 && !/^\d{10,}$/.test(value),
      );
    if (candidates.length === 1) return candidates;
    const shortCandidates = candidates.filter((value) => value.length <= 12);
    return shortCandidates.length === 1 ? shortCandidates : [];
  });
  const reference = normalizeCandidates(referenceCandidates);
  if (reference) suggestions.referenciaAlbaran = reference;

  const flattenedText = originalLines.map((line) => line.normalized).join(" ");
  const weightValues = [
    ...flattenedText.matchAll(
      /(?:^|[^\d.])((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)\s*KGS?\b/g,
    ),
  ].map((match) => match[1].replace(/\s+/g, ""));
  const packageValues = [
    ...flattenedText.matchAll(/\b(\d+)\s*(BULTOS?|BULIOS|PALETS?|UNIDADES)\b/g),
  ].map((match) => match[1]);
  const weight = uniqueValue(weightValues);
  const packages = uniqueValue(packageValues);
  if (weight) suggestions.pesoKg = weight;
  if (packages) suggestions.numeroBultos = packages;

  const recipientIndices = originalLines
    .map((line, index) => (isRecipientMarker(line) ? index : -1))
    .filter((index) => index >= 0);
  const recipientCandidates: string[] = [];
  const addressCandidates: string[] = [];
  const cityCandidates: string[] = [];
  const addressPattern =
    /(?:\bCALLE\b|\bC\/|\bAV\b|\bAVDA\b|\bAVENIDA\b|\bPLAZA\b|\bPOLIGONO\b|\bPOL\.|\bCAMINO\b|\bCARRETERA\b|\bKM\b)/;
  const scoreRecipient = (value: string) => {
    const normalized = normalizeOCRLine(value).normalized;
    if (addressPattern.test(normalized) || /\d{5}/.test(normalized))
      return -100;
    const words = normalized.match(/[A-Z]{2,}/g) ?? [];
    if (!words.length) return -100;
    const companyTerms =
      /\b(?:SL|SA|SLL|SCA|CB|COOP|COOPERATIVA|SOCIEDAD|TRANSPORTES|DISTRIBUCIONES|COMERCIAL)\b/;
    const digits = (normalized.match(/\d/g) ?? []).length;
    return (
      Math.min(words.join(" ").length, 45) +
      (companyTerms.test(normalized) ? 25 : 0) -
      digits * 4
    );
  };

  for (const start of recipientIndices) {
    let end = start + 1;
    while (
      end < originalLines.length &&
      !isRecipientBlockBoundary(originalLines[end])
    ) {
      end += 1;
    }
    const block = originalLines.slice(start, end);
    const recipientLabel = findLabel(block[0], LABEL_ALIASES.recipient);
    if (!recipientLabel) continue;

    const nameCandidates: string[] = [];
    const inlineName = valueAfterLabel(block[0], recipientLabel);
    if (inlineName) nameCandidates.push(inlineName);
    let destinationDetailsStarted = false;

    for (let index = 1; index < block.length; index += 1) {
      const line = block[index];
      if (isRecipientBlockBoundary(line)) break;
      if (isPostalOrContactLine(line)) {
        destinationDetailsStarted = true;
        if (/\b\d{5}\b/.test(line.normalized)) {
          const cityInPostalLine = line.original
            .replace(/\b\d{5}\b/g, " ")
            .replace(/[,:;.-]+/g, " ")
            .trim();
          if (cityInPostalLine && /[A-ZÁÉÍÓÚÜÑ]{3}/i.test(cityInPostalLine)) {
            cityCandidates.push(cityInPostalLine);
          } else {
            const nextLine = block[index + 1];
            if (
              nextLine &&
              !isRecipientBlockBoundary(nextLine) &&
              !isPostalOrContactLine(nextLine) &&
              !isAddressLine(nextLine)
            ) {
              cityCandidates.push(nextLine.original);
            }
          }
        }
        continue;
      }

      const addressLabel = findLabel(line, LABEL_ALIASES.address);
      const addressValue = addressLabel
        ? valueAfterLabel(line, addressLabel)
        : "";
      if (addressValue && isAddressLine(normalizeOCRLine(addressValue))) {
        destinationDetailsStarted = true;
        addressCandidates.push(addressValue);
        continue;
      }
      if (addressPattern.test(line.normalized)) {
        destinationDetailsStarted = true;
        addressCandidates.push(line.original);
        continue;
      }

      const cityLabel = findLabel(line, LABEL_ALIASES.city);
      if (cityLabel) {
        destinationDetailsStarted = true;
        const cityValue = valueAfterLabel(line, cityLabel);
        const cityLine = cityValue || block[index + 1]?.original || "";
        if (cityLine && !isAddressLine(normalizeOCRLine(cityLine))) {
          cityCandidates.push(cityLine.replace(/\b\d{5}\b/g, " ").trim());
        }
        continue;
      }

      if (
        !destinationDetailsStarted &&
        !findLabel(line, Object.values(LABEL_ALIASES).flat()) &&
        !isAddressLine(line) &&
        /[A-ZÁÉÍÓÚÜÑ]{3}/i.test(line.original)
      ) {
        nameCandidates.push(line.original);
      }
    }

    const cleanNames = [
      ...new Set(nameCandidates.map((name) => name.trim())),
    ].filter((name) => {
      const line = normalizeOCRLine(name);
      return (
        !isPostalOrContactLine(line) &&
        !isAddressLine(line) &&
        !isAdministrativeLine(line) &&
        !findLabel(line, Object.values(LABEL_ALIASES).flat())
      );
    });
    const rankedNames = cleanNames
      .map((value) => ({ value, score: scoreRecipient(value) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    if (
      rankedNames.length === 1 ||
      (rankedNames.length > 1 &&
        rankedNames[0].score > rankedNames[1].score + 8)
    ) {
      recipientCandidates.push(rankedNames[0].value);
    }
  }

  const uniqueRecipients = [
    ...new Set(
      recipientCandidates.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  const rankedRecipients = uniqueRecipients
    .map((value) => ({ value, score: scoreRecipient(value) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const destinatario =
    rankedRecipients.length === 1 ||
    (rankedRecipients.length > 1 &&
      rankedRecipients[0].score > rankedRecipients[1].score + 8)
      ? rankedRecipients[0].value
      : undefined;
  const direccionDestino = normalizeCandidates(addressCandidates);
  const ciudadDestino = normalizeCandidates(cityCandidates);
  if (destinatario) suggestions.destinatario = destinatario;
  if (direccionDestino) suggestions.direccionDestino = direccionDestino;
  if (ciudadDestino) suggestions.ciudadDestino = ciudadDestino;

  return suggestions;
};

const extractTemplateSuggestions = (
  text: string,
): Partial<Record<SuggestibleField, string>> => {
  const lines = cleanOCRLines(text);
  const suggestions: Partial<Record<SuggestibleField, string>> = {};
  const fieldBoundary =
    /\b(?:REMITENTE|CONSIGNATARIO|FECHA|BULTOS|PESO|KG\s+A\s+TASAR|TIPO\s+DE\s+PRODUCTO|CONCEPTO|OBSERVACIONES(?:\s+REPARTO)?|CONTACT|REF\.?\s*(?:EXPED|ADMON|CLI)\.?)\b/;

  const findExact = (line: OCRLine, pattern: RegExp): OCRLabel | undefined => {
    const match = pattern.exec(line.normalized);
    if (!match || match.index === undefined) return undefined;
    return { index: match.index, end: match.index + match[0].length };
  };

  const tailAfter = (line: OCRLine, label: OCRLabel) => {
    const nextBoundary = fieldBoundary.exec(line.normalized.slice(label.end));
    const end = nextBoundary
      ? label.end + nextBoundary.index
      : line.normalized.length;
    const originalStart = line.offsets[label.end] ?? line.original.length;
    const originalEnd = line.offsets[end] ?? line.original.length;
    return line.original
      .slice(originalStart, originalEnd)
      .replace(/^[\s:;#№º°.-]+/, "")
      .trim();
  };

  const valueNearLabel = (
    index: number,
    label: OCRLabel,
    matcher: RegExp,
    followingLines = 1,
  ) => {
    const valuesFor = (value: string) => {
      const globalMatcher = new RegExp(
        matcher.source,
        `${matcher.flags.replace(/g/g, "")}g`,
      );
      return [...value.matchAll(globalMatcher)].map(
        (match) => match[1] ?? match[0],
      );
    };
    const inline = tailAfter(lines[index], label);
    const inlineValues = valuesFor(inline);
    if (inlineValues.length === 1) return inlineValues;
    if (inlineValues.length > 1) return [];
    for (let offset = 1; offset <= followingLines; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate || fieldBoundary.test(candidate.normalized)) break;
      const nextValues = valuesFor(candidate.original);
      if (nextValues.length === 1) return nextValues;
      if (nextValues.length > 1) return [];
    }
    return [];
  };

  const readLabeledValues = (pattern: RegExp, matcher: RegExp) =>
    lines.flatMap((line, index) => {
      const label = findExact(line, pattern);
      return label ? valueNearLabel(index, label, matcher) : [];
    });

  const dateValues = readLabeledValues(
    /\bFECHA\b/,
    /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/,
  ).flatMap((value) => {
    const match = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    if (!match) return [];
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return [];
    }
    return [
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    ];
  });
  const fecha = uniqueValue(dateValues);
  if (fecha) suggestions.fecha = fecha;

  const packages = uniqueValue(
    readLabeledValues(/\bBULTOS\b/, /\b(\d{1,3})\b/),
  );
  if (packages) suggestions.numeroBultos = packages;

  const weights = uniqueValue(
    readLabeledValues(
      /\bPESO\b/,
      /\b((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)\s*(?:KGS?\b)?/,
    ),
  );
  if (weights) suggestions.pesoKg = weights.replace(/\s/g, "");

  const referenceSpecs: [RegExp, RegExp][] = [
    [/\bREF\.?\s*EXPED\.?\b/, /\b([A-Z0-9][A-Z0-9/-]{1,23})\b/i],
    [/\bREF\.?\s*ADMON\.?\b/, /\b([A-Z0-9][A-Z0-9/-]{1,23})\b/i],
    [/\bREF\.?\s*CLI\.?\b/, /\b([A-Z0-9][A-Z0-9/-]{1,23})\b/i],
  ];
  for (const [labelPattern, valuePattern] of referenceSpecs) {
    const reference = uniqueValue(
      readLabeledValues(labelPattern, valuePattern),
    );
    if (reference) {
      suggestions.referenciaAlbaran = reference;
      break;
    }
  }

  const recipientIndices = lines
    .map((line, index) => (findExact(line, /\bCONSIGNATARIO\b/) ? index : -1))
    .filter((index) => index >= 0);
  const recipientValues: string[] = [];
  const addressValues: string[] = [];
  const cityValues: string[] = [];
  const addressPattern =
    /\b(?:CALLE|C\/|AVENIDA|AVDA|AV|PLAZA|POLIGONO|POL\.|CAMINO|CARRETERA)\b/;
  const taxIdPattern =
    /^(?:[A-Z]\s*\d{7,8}[A-Z0-9]?|\d{8}[A-Z])\s*[-:|,;.]?\s*/i;
  const hasRecipientBoundary = (line: OCRLine) =>
    indexOfLabel(
      line,
      /\b(?:REMITENTE|CONSIGNATARIO|OBSERVACIONES\s+REPARTO)\b/,
    ) >= 0;

  for (const start of recipientIndices) {
    let end = start + 1;
    while (end < lines.length && !hasRecipientBoundary(lines[end])) end += 1;
    const block = lines.slice(start, end);
    let nifIndex = -1;
    let name = "";
    let nameIndex = -1;

    for (let index = 0; index < block.length; index += 1) {
      const nifLabel = findExact(block[index], /\bNIF\b/);
      if (!nifLabel) continue;
      nifIndex = index;
      const inlineAfterNif = tailAfter(block[index], nifLabel)
        .replace(taxIdPattern, "")
        .trim();
      if (
        inlineAfterNif &&
        !addressPattern.test(normalizeOCRLine(inlineAfterNif).normalized)
      ) {
        name = inlineAfterNif;
        nameIndex = index;
      }
      break;
    }

    if (nifIndex < 0) continue;
    if (!name) {
      for (let index = nifIndex + 1; index < block.length; index += 1) {
        const candidate = block[index];
        if (
          addressPattern.test(candidate.normalized) ||
          /\b\d{5}\b/.test(candidate.normalized) ||
          /\b(?:CONTACT|TELEFONO|TEL|NIF|CIF)\b/.test(candidate.normalized)
        ) {
          break;
        }
        const cleanCandidate = candidate.original
          .replace(taxIdPattern, "")
          .replace(/\b(?:CONTACT|TELEFONO|TEL)\b.*$/i, "")
          .trim();
        if (cleanCandidate && /[A-ZÁÉÍÓÚÜÑ]{2}/i.test(cleanCandidate)) {
          name = cleanCandidate;
          nameIndex = index;
          break;
        }
      }
    }

    if (
      !name ||
      nameIndex < 0 ||
      addressPattern.test(normalizeOCRLine(name).normalized)
    )
      continue;
    const nextLine = block[nameIndex + 1];
    if (!nextLine || !addressPattern.test(nextLine.normalized)) continue;
    const address = nextLine.original.trim();
    const postalCityLine = block[nameIndex + 2];
    const postalCity = postalCityLine?.original.match(
      /\b\d{5}\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]+)\b/i,
    );
    if (!postalCity) continue;

    recipientValues.push(name);
    addressValues.push(address);
    cityValues.push(postalCity[1].trim().replace(/[.,;]+$/, ""));
  }

  const destinatario = uniqueValue(recipientValues);
  const direccionDestino = uniqueValue(addressValues);
  const ciudadDestino = uniqueValue(cityValues);
  if (destinatario) suggestions.destinatario = destinatario;
  if (direccionDestino) suggestions.direccionDestino = direccionDestino;
  if (ciudadDestino) suggestions.ciudadDestino = ciudadDestino;

  const isReadableText = (value: string) => {
    const normalized = normalizeOCRLine(value).normalized;
    const alphanumericCount = (normalized.match(/[A-Z0-9]/g) ?? []).length;
    const compactLength = normalized.replace(/\s/g, "").length;
    return (
      alphanumericCount >= 3 &&
      compactLength > 0 &&
      alphanumericCount / compactLength >= 0.55 &&
      !/[|]{1,}/.test(value) &&
      !/[~^_=<>*{}\[\]\\]/.test(value)
    );
  };
  const isValidSuggestion = (field: SuggestibleField, value: string) => {
    const normalized = normalizeOCRLine(value).normalized.trim();
    if (!value.trim()) return false;
    if (field === "numeroBultos") return /^\d{1,3}$/.test(value.trim());
    if (field === "pesoKg")
      return /^\d{1,7}(?:[.,]\d{1,3})?$/.test(value.trim());
    if (field === "fecha") return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    if (!isReadableText(value)) return false;
    if (
      /\b\d{5}\b|\b(?:NIF|CIF|CONTACT|TELEFONO|TEL|PORTES|IMPORTE|TOTAL|EUR|IVA|PRECIO)\b/.test(
        normalized,
      ) ||
      /^(?:\+?\d[\d\s()./-]{7,})$/.test(value.trim()) ||
      /^(?:[A-Z]\d{7,8}[A-Z0-9]?|\d{8}[A-Z])$/i.test(value.trim()) ||
      /[|]{1,}/.test(value) ||
      /(?:PLAZA DE ORIGEN TIPO DE PRODUCTO|PLAZA DISTRIBUIDORA A PORTES)/.test(
        normalized,
      )
    )
      return false;
    if (
      /^(?:FECHA|BULTOS|PESO|PORTES|IMPORTE|TOTAL|EUR|ARTICULO|DESCRIPCION|CONCEPTO|OBSERVACIONES)$/.test(
        normalized,
      )
    )
      return false;
    if (field === "destinatario")
      return !isAddressLine(normalizeOCRLine(value));
    if (field === "direccionDestino")
      return isAddressLine(normalizeOCRLine(value));
    if (field === "ciudadDestino")
      return /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]+$/i.test(value.trim());
    if (field === "referenciaAlbaran") {
      return (
        value.length <= 24 && !/^\d{10,}$/.test(value) && !/[|]/.test(value)
      );
    }
    return true;
  };

  return Object.fromEntries(
    Object.entries(suggestions).filter(([field, value]) =>
      isValidSuggestion(field as SuggestibleField, value as string),
    ),
  ) as Partial<Record<SuggestibleField, string>>;
};

const indexOfLabel = (line: OCRLine, pattern: RegExp) =>
  pattern.exec(line.normalized)?.index ?? -1;

const extractRegionalSuggestions = (
  regions: DachserRegionTexts,
): Partial<Record<SuggestibleField, string>> => {
  const suggestions: Partial<Record<SuggestibleField, string>> = {};
  const uniqueMatches = (text: string, pattern: RegExp) => {
    const globalPattern = new RegExp(
      pattern.source,
      `${pattern.flags.replace(/g/g, "")}g`,
    );
    return uniqueValue(
      [...text.matchAll(globalPattern)].map((match) => match[1] ?? match[0]),
    );
  };

  const dates = [
    ...regions.fecha.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g),
  ]
    .map((match) => {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      )
        return "";
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    })
    .filter(Boolean);
  const fecha = uniqueValue(dates);
  if (fecha) suggestions.fecha = fecha;

  const referencia = uniqueMatches(
    regions.referenciaExpedicion,
    /\b(\d{3,9})\b/,
  );
  if (referencia) suggestions.referenciaAlbaran = referencia;

  const numeroBultos = uniqueMatches(regions.numeroBultos, /\b(\d{1,3})\b/);
  if (numeroBultos) suggestions.numeroBultos = numeroBultos;

  const pesoKg = uniqueMatches(regions.pesoKg, /\b(\d{1,5}(?:[.,]\d{1,3})?)\b/);
  if (pesoKg) suggestions.pesoKg = pesoKg.replace(/\s/g, "");

  const lines = regions.consignatario
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalize = (line: string) =>
    line
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  const consignatarioIndex = lines.findIndex((line) =>
    /\bCONSIGNATARIO\b/.test(normalize(line)),
  );
  if (consignatarioIndex >= 0) {
    const block = lines.slice(consignatarioIndex + 1);
    const nifIndex = block.findIndex((line) =>
      /\bN\.?\s*I\.?\s*F\.?\b/.test(normalize(line)),
    );
    const addressPattern =
      /^\s*(?:CALLE|C\/|AVENIDA|AVDA|AV\b|PLAZA|POLIGONO|POL\.?|CAMINO|CARRETERA)\b/i;
    const addressIndex = block.findIndex(
      (line, index) =>
        index > Math.max(nifIndex, -1) && addressPattern.test(normalize(line)),
    );

    if (nifIndex >= 0 && addressIndex > nifIndex) {
      const nameCandidates = block
        .slice(nifIndex + 1, addressIndex)
        .map((line) =>
          line.replace(/\b(?:CONTACT|TELEFONO|TEL)\b.*$/i, "").trim(),
        )
        .filter((line) => {
          const value = normalize(line);
          return (
            /[A-Z]{3}/.test(value) &&
            !/\b(?:NIF|CIF|CONTACT|TELEFONO|TEL)\b/.test(value) &&
            !/\b\d{5}\b/.test(value) &&
            !/^\+?\d[\d\s()./-]{6,}$/.test(line) &&
            !/^\d+$/.test(line)
          );
        });
      const destinatario =
        nameCandidates.length === 1 ? nameCandidates[0] : undefined;
      const direccion = block[addressIndex];
      const postalCity = block
        .slice(addressIndex + 1, addressIndex + 3)
        .map((line) =>
          line.match(/\b\d{5}\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]*)/i)?.[1]?.trim(),
        )
        .filter((value): value is string => Boolean(value));
      const ciudadDestino = uniqueValue(postalCity);

      if (destinatario) suggestions.destinatario = destinatario;
      if (direccion && addressPattern.test(normalize(direccion))) {
        suggestions.direccionDestino = direccion;
      }
      if (ciudadDestino) {
        suggestions.ciudadDestino = ciudadDestino.replace(/[.,;]+$/, "");
      }
    }
  }

  return suggestions;
};

const getToday = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const MATRICULAS_STORAGE_KEY = "logiroute_matriculas_v1";
const TRANSPORTISTAS_STORAGE_KEY = "logiroute_transportistas_v1";

const loadTransportistas = (): {
  items: TransportistaHabitual[];
  invalid: boolean;
} => {
  try {
    const saved = localStorage.getItem(TRANSPORTISTAS_STORAGE_KEY);
    if (saved === null) return { items: [], invalid: false };
    const parsed: unknown = JSON.parse(saved);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value: unknown) => {
        if (!value || typeof value !== "object") return false;
        const item = value as Record<string, unknown>;
        return (
          [
            "id",
            "nombre",
            "nif",
            "direccion",
            "ciudad",
            "codigoPostal",
            "provincia",
            "pais",
            "telefono",
            "email",
            "notas",
            "createdAt",
            "updatedAt",
          ].every((key) => typeof item[key] === "string") &&
          typeof item.esPredeterminado === "boolean"
        );
      })
    ) {
      return { items: [], invalid: true };
    }
    const items = parsed as TransportistaHabitual[];
    const defaultFound = items.findIndex((item) => item.esPredeterminado);
    return {
      items: items.map((item, index) => ({
        ...item,
        esPredeterminado: item.esPredeterminado && index === defaultFound,
      })),
      invalid: false,
    };
  } catch {
    return { items: [], invalid: true };
  }
};

const normalizePlate = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleUpperCase("es-ES");

const loadMatriculas = (): { items: MatriculaHabitual[]; invalid: boolean } => {
  try {
    const saved = localStorage.getItem(MATRICULAS_STORAGE_KEY);
    if (saved === null) return { items: [], invalid: false };
    const parsed: unknown = JSON.parse(saved);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (item: unknown) =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as MatriculaHabitual).id === "string" &&
          typeof (item as MatriculaHabitual).valor === "string" &&
          typeof (item as MatriculaHabitual).createdAt === "string" &&
          typeof (item as MatriculaHabitual).updatedAt === "string",
      )
    ) {
      return { items: [], invalid: true };
    }
    return { items: parsed, invalid: false };
  } catch {
    return { items: [], invalid: true };
  }
};

const createEmptyForm = (defaultCarrier?: TransportistaHabitual): DeCAForm => ({
  fecha: getToday(),
  cargador: "",
  transportista: defaultCarrier?.nombre ?? "",
  transportistaNif: defaultCarrier?.nif ?? "",
  transportistaDireccion: defaultCarrier?.direccion ?? "",
  transportistaCiudad: defaultCarrier?.ciudad ?? "",
  transportistaCodigoPostal: defaultCarrier?.codigoPostal ?? "",
  transportistaProvincia: defaultCarrier?.provincia ?? "",
  transportistaPais: defaultCarrier?.pais ?? "",
  transportistaTelefono: defaultCarrier?.telefono ?? "",
  transportistaEmail: defaultCarrier?.email ?? "",
  transportistaNotas: defaultCarrier?.notas ?? "",
  destinatario: "",
  direccionDestino: "",
  ciudadDestino: "",
  mercancia: "",
  numeroBultos: "",
  pesoKg: "",
  referenciaAlbaran: "",
  matriculaVehiculo: "",
  notas: "",
});

const loadDecas = (): DeCA[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const formatDate = (date: string) => {
  if (!date) return "Sin fecha";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
};

const getDeCAMeasureSummary = (deca: DeCA) => {
  const measures = [
    deca.numeroBultos ? `${deca.numeroBultos} bultos` : "",
    deca.pesoKg ? `${deca.pesoKg} kg` : "",
  ].filter(Boolean);
  return measures.length ? measures.join(" · ") : (deca.pesoOBultos ?? "");
};

const getDeCAMeasureDetails = (deca: DeCA): [string, string][] => {
  if (deca.numeroBultos || deca.pesoKg) {
    return [
      ...(deca.numeroBultos
        ? [
            ["Número de bultos", `${deca.numeroBultos} bultos`] as [
              string,
              string,
            ],
          ]
        : []),
      ...(deca.pesoKg
        ? [["Peso (kg)", `${deca.pesoKg} kg`] as [string, string]]
        : []),
    ];
  }
  return deca.pesoOBultos ? [["Peso o bultos", deca.pesoOBultos]] : [];
};

const getTransportistaDetails = (deca: DeCA): [string, string][] => {
  const details: [string, string][] = [
    ["NIF del transportista", deca.transportistaNif ?? ""],
    ["Dirección del transportista", deca.transportistaDireccion ?? ""],
    ["Ciudad del transportista", deca.transportistaCiudad ?? ""],
    ["Código postal del transportista", deca.transportistaCodigoPostal ?? ""],
    ["Provincia del transportista", deca.transportistaProvincia ?? ""],
    ["País del transportista", deca.transportistaPais ?? ""],
    ["Teléfono del transportista", deca.transportistaTelefono ?? ""],
    ["Email del transportista", deca.transportistaEmail ?? ""],
    ["Notas del transportista", deca.transportistaNotas ?? ""],
  ];
  return details.filter(([, value]) => Boolean(value));
};

const DeCASection: React.FC = () => {
  const [initialCompanyLoad] = useState(loadEmpresas);
  const [companies, setCompanies] = useState<EmpresaHabitual[]>(
    initialCompanyLoad.items,
  );
  const [companyStorageWarning, setCompanyStorageWarning] = useState(
    initialCompanyLoad.invalid,
  );
  const [companyMigrationNotice, setCompanyMigrationNotice] = useState(
    initialCompanyLoad.migrated
      ? `Se han migrado ${initialCompanyLoad.migratedCount} destinatarios a Empresas habituales.`
      : "",
  );
  const [companyManagerAction, setCompanyManagerAction] = useState<
    "create" | "import" | undefined
  >(undefined);
  const companyManagerReturnView = useRef<SectionView>("list");
  const [initialTransportistaLoad] = useState(loadTransportistas);
  const [transportistas, setTransportistas] = useState<TransportistaHabitual[]>(
    initialTransportistaLoad.items,
  );
  const [transportistaStorageWarning, setTransportistaStorageWarning] =
    useState(initialTransportistaLoad.invalid);
  const transportistaManagerReturnView = useRef<SectionView>("list");
  const [transportistaQuery, setTransportistaQuery] = useState("");
  const [transportistaPickerOpen, setTransportistaPickerOpen] = useState(false);
  const [transportistaLoadedNotice, setTransportistaLoadedNotice] =
    useState(false);
  const [loaderQuery, setLoaderQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [loaderPickerOpen, setLoaderPickerOpen] = useState(false);
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [loaderLoadedNotice, setLoaderLoadedNotice] = useState(false);
  const [destinationLoadedNotice, setDestinationLoadedNotice] = useState(false);
  const [initialPlateLoad] = useState(loadMatriculas);
  const [plates, setPlates] = useState<MatriculaHabitual[]>(
    initialPlateLoad.items,
  );
  const [plateStorageWarning, setPlateStorageWarning] = useState(
    initialPlateLoad.invalid,
  );
  const [plateManagerOpen, setPlateManagerOpen] = useState(false);
  const [editingPlateId, setEditingPlateId] = useState<string | null>(null);
  const [plateEditValue, setPlateEditValue] = useState("");
  const [plateManagerMessage, setPlateManagerMessage] = useState("");
  const [decas, setDecas] = useState<DeCA[]>(loadDecas);
  const [view, setView] = useState<SectionView>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<DeCAForm>(() =>
    createEmptyForm(
      initialTransportistaLoad.items.find((item) => item.esPredeterminado),
    ),
  );
  const [photoError, setPhotoError] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [ocrNotice, setOcrNotice] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [detectedText, setDetectedText] = useState<string | null>(null);
  const [regionDiagnostics, setRegionDiagnostics] =
    useState<DachserRegionTexts | null>(null);
  const [templateSignals, setTemplateSignals] =
    useState<DachserTemplateSignals | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [appliedSuggestions, setAppliedSuggestions] =
    useState<AppliedSuggestions | null>(null);
  const [suggestionResults, setSuggestionResults] = useState<
    SuggestionResult[]
  >([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const ocrWorkerRef = useRef<OCRWorker | null>(null);
  const mountedRef = useRef(true);
  const editedFieldsRef = useRef(new Set<keyof DeCAForm>());
  const defaultDateRef = useRef(getToday());
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const worker = ocrWorkerRef.current;
      ocrWorkerRef.current = null;
      if (worker) void worker.terminate().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decas));
    } catch {
      // La sección sigue siendo utilizable aunque el navegador no permita persistir.
    }
  }, [decas]);

  useEffect(() => {
    try {
      localStorage.setItem(EMPRESAS_STORAGE_KEY, JSON.stringify(companies));
    } catch {
      setCompanyStorageWarning(true);
    }
  }, [companies]);

  useEffect(() => {
    try {
      localStorage.setItem(MATRICULAS_STORAGE_KEY, JSON.stringify(plates));
    } catch {
      setPlateStorageWarning(true);
    }
  }, [plates]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TRANSPORTISTAS_STORAGE_KEY,
        JSON.stringify(transportistas),
      );
    } catch {
      setTransportistaStorageWarning(true);
    }
  }, [transportistas]);

  const selectedDeCA = decas.find((deca) => deca.id === selectedId);

  const updateField = (field: keyof DeCAForm, value: string) => {
    editedFieldsRef.current.add(field);
    const next = { ...formRef.current, [field]: value };
    formRef.current = next;
    setForm(next);
    if (
      field === "destinatario" ||
      field === "direccionDestino" ||
      field === "ciudadDestino"
    )
      setDestinationLoadedNotice(false);
    if (field === "cargador") setLoaderLoadedNotice(false);
    if (field.startsWith("transportista")) setTransportistaLoadedNotice(false);
  };

  const matchingCompanies = (query: string) =>
    companies
      .filter((company) => {
        const normalizedQuery = normalizeRecipientText(query);
        return (
          !normalizedQuery ||
          [
            company.nombre,
            company.direccion,
            company.ciudad,
            company.codigoPostal,
            company.nif,
            company.telefono,
            company.email,
            company.contacto,
          ].some((value) =>
            normalizeRecipientText(value).includes(normalizedQuery),
          )
        );
      })
      .sort((left, right) =>
        left.nombre.localeCompare(right.nombre, "es", { sensitivity: "base" }),
      );

  const selectDestinationCompany = (company: EmpresaHabitual) => {
    const next = {
      ...formRef.current,
      destinatario: company.nombre,
      direccionDestino: company.direccion,
      ciudadDestino: company.ciudad,
    };
    editedFieldsRef.current.add("destinatario");
    editedFieldsRef.current.add("direccionDestino");
    editedFieldsRef.current.add("ciudadDestino");
    formRef.current = next;
    setForm(next);
    setDestinationQuery(company.nombre);
    setDestinationPickerOpen(false);
    setDestinationLoadedNotice(true);
  };

  const selectLoaderCompany = (company: EmpresaHabitual) => {
    updateField("cargador", company.nombre);
    setLoaderQuery(company.nombre);
    setLoaderPickerOpen(false);
    setLoaderLoadedNotice(true);
  };

  const matchingTransportistas = (query: string) => {
    const needle = normalizeRecipientText(query);
    return transportistas
      .filter(
        (item) =>
          !needle ||
          [
            item.nombre,
            item.nif,
            item.direccion,
            item.ciudad,
            item.codigoPostal,
            item.telefono,
            item.email,
          ].some((value) => normalizeRecipientText(value).includes(needle)),
      )
      .sort((left, right) =>
        left.nombre.localeCompare(right.nombre, "es", { sensitivity: "base" }),
      );
  };

  const selectTransportista = (item: TransportistaHabitual) => {
    const next: DeCAForm = {
      ...formRef.current,
      transportista: item.nombre,
      transportistaNif: item.nif,
      transportistaDireccion: item.direccion,
      transportistaCiudad: item.ciudad,
      transportistaCodigoPostal: item.codigoPostal,
      transportistaProvincia: item.provincia,
      transportistaPais: item.pais,
      transportistaTelefono: item.telefono,
      transportistaEmail: item.email,
      transportistaNotas: item.notas,
    };
    [
      "transportista",
      "transportistaNif",
      "transportistaDireccion",
      "transportistaCiudad",
      "transportistaCodigoPostal",
      "transportistaProvincia",
      "transportistaPais",
      "transportistaTelefono",
      "transportistaEmail",
      "transportistaNotas",
    ].forEach((field) => editedFieldsRef.current.add(field as keyof DeCAForm));
    formRef.current = next;
    setForm(next);
    setTransportistaQuery(item.nombre);
    setTransportistaPickerOpen(false);
    setTransportistaLoadedNotice(true);
  };

  const openCompanyManager = (action?: "create" | "import") => {
    companyManagerReturnView.current = view === "companies" ? "list" : view;
    setCompanyManagerAction(action);
    setView("companies");
  };

  const updateCompanies = (next: EmpresaHabitual[]) => {
    setCompanies(next);
    setCompanyStorageWarning(false);
  };

  const openTransportistaManager = () => {
    transportistaManagerReturnView.current =
      view === "carriers" ? "list" : view;
    setView("carriers");
  };

  const updateTransportistas = (next: TransportistaHabitual[]) => {
    setTransportistas(next);
    setTransportistaStorageWarning(false);
  };

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDetectedText(null);
    setTemplateSignals(null);
    setOcrError("");
    setOcrNotice("");
    setRegionDiagnostics(null);
    setCopyMessage("");
    setAppliedSuggestions(null);
    setSuggestionResults([]);

    if (!file.type.startsWith("image/")) {
      setPhotoError("El archivo seleccionado no es una imagen.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError(
        "La imagen supera 5 MB. Haz una foto con menos calidad o selecciona otra.",
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setPhotoError("No se pudo leer la imagen. Selecciona otra.");
        return;
      }
      setForm((current) => ({
        ...current,
        fotoAlbaran: reader.result as string,
        nombreFotoAlbaran: file.name,
      }));
      setPhotoError("");
    };
    reader.onerror = () =>
      setPhotoError("No se pudo leer la imagen. Selecciona otra.");
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setForm((current) => {
      const {
        fotoAlbaran: _fotoAlbaran,
        nombreFotoAlbaran: _nombreFotoAlbaran,
        ...rest
      } = current;
      return rest;
    });
    setPhotoError("");
    setDetectedText(null);
    setTemplateSignals(null);
    setOcrError("");
    setOcrNotice("");
    setRegionDiagnostics(null);
    setTemplateSignals(null);
    setCopyMessage("");
    setAppliedSuggestions(null);
    setSuggestionResults([]);
  };

  const handleReadReceipt = async () => {
    if (!form.fotoAlbaran || ocrLoading) return;
    setOcrLoading(true);
    setOcrProgress(0);
    setOcrError("");
    setOcrNotice("");
    setDetectedText(null);
    setRegionDiagnostics(null);
    setCopyMessage("");
    setAppliedSuggestions(null);
    setSuggestionResults([]);
    const photoBeingRead = formRef.current.fotoAlbaran;

    let worker: OCRWorker | null = null;
    try {
      const tesseract = await import("tesseract.js");
      if (!mountedRef.current) return;
      const moduleApi = tesseract as unknown as {
        createWorker: (
          language: string,
          oem: undefined,
          options: {
            workerPath: string;
            corePath: string;
            langPath: string;
            gzip: boolean;
            workerBlobURL: boolean;
            logger: (message: { progress: number }) => void;
          },
        ) => Promise<OCRWorker>;
      };
      worker = await moduleApi.createWorker("spa", undefined, {
        workerPath: new URL("/tesseract/worker.min.js", window.location.origin)
          .href,
        corePath: new URL("/tesseract/core/", window.location.origin).href,
        langPath: new URL("/tesseract/lang/", window.location.origin).href,
        gzip: true,
        workerBlobURL: false,
        logger: ({ progress }) => {
          if (mountedRef.current) setOcrProgress(Math.round(progress * 100));
        },
      });
      if (!mountedRef.current) return;
      ocrWorkerRef.current = worker;

      const result = await worker.recognize(photoBeingRead ?? "");
      if (!mountedRef.current) return;
      if (formRef.current.fotoAlbaran !== photoBeingRead) return;
      const text = result.data.text.trim();
      setDetectedText(text);
      const signals = detectDachserTemplateSignals(text);
      setTemplateSignals(signals);
      await worker.terminate().catch(() => undefined);
      if (ocrWorkerRef.current === worker) ocrWorkerRef.current = null;
      worker = null;

      const dimensions = await getImageDimensions(photoBeingRead ?? "");
      if (!mountedRef.current || formRef.current.fotoAlbaran !== photoBeingRead)
        return;
      if (dimensions.width <= dimensions.height) {
        setOcrNotice(
          "Para leer automáticamente este albarán, haz una foto horizontal, completa y lo más recta posible.",
        );
        return;
      }
      if (Object.values(signals).filter(Boolean).length < 3) {
        setOcrNotice(
          "La imagen no parece corresponder a la plantilla Dachser. El texto completo queda disponible como ayuda, sin rellenar campos automáticamente.",
        );
        return;
      }

      let regionTexts: DachserRegionTexts;
      try {
        setOcrProgress(70);
        regionTexts = await recognizeDachserRegions(
          photoBeingRead ?? "",
          (progress) => {
            if (mountedRef.current) {
              setOcrProgress(70 + Math.round(progress * 30));
            }
          },
        );
      } catch {
        if (mountedRef.current) {
          setOcrNotice(
            "No se pudieron procesar las regiones de la plantilla. El texto OCR completo sigue disponible como ayuda.",
          );
        }
        return;
      }
      if (!mountedRef.current || formRef.current.fotoAlbaran !== photoBeingRead)
        return;

      setRegionDiagnostics(regionTexts);
      const suggestions = extractRegionalSuggestions(regionTexts);
      const previous: AppliedSuggestions["previous"] = {};
      const applied: AppliedSuggestions["applied"] = {};
      const currentForm = formRef.current;
      const next = { ...currentForm };
      const review: SuggestionResult[] = [];
      (Object.keys(suggestions) as SuggestibleField[]).forEach((field) => {
        const value = suggestions[field];
        if (!value) return;
        const currentValue = currentForm[field];
        const isDefaultDate =
          field === "fecha" && currentValue === defaultDateRef.current;
        if (editedFieldsRef.current.has(field)) {
          review.push({ field, value, status: "manual" });
          return;
        }
        if (currentValue.trim() && !isDefaultDate) {
          review.push({ field, value, status: "existing" });
          return;
        }
        previous[field] = currentValue;
        applied[field] = value;
        next[field] = value;
        review.push({ field, value, status: "applied" });
      });
      formRef.current = next;
      setForm(next);
      setAppliedSuggestions({ previous, applied });
      setSuggestionResults(review);
    } catch {
      if (mountedRef.current) {
        setOcrError(
          "No se pudo leer el albarán. Prueba con una foto más nítida, bien iluminada y sin reflejos.",
        );
      }
    } finally {
      if (worker) {
        if (ocrWorkerRef.current === worker) ocrWorkerRef.current = null;
        await worker.terminate().catch(() => undefined);
      }
      if (mountedRef.current) setOcrLoading(false);
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(detectedText ?? "");
      setCopyMessage("Texto copiado.");
    } catch {
      setCopyMessage("No se pudo copiar el texto desde este navegador.");
    }
  };

  const undoOcrSuggestions = () => {
    if (!appliedSuggestions) return;
    setForm((current) => {
      const next = { ...current };
      (Object.keys(appliedSuggestions.applied) as SuggestibleField[]).forEach(
        (field) => {
          if (
            current[field] === appliedSuggestions.applied[field] &&
            !editedFieldsRef.current.has(field)
          ) {
            next[field] = appliedSuggestions.previous[field] ?? "";
          }
        },
      );
      formRef.current = next;
      return next;
    });
    setAppliedSuggestions(null);
    setSuggestionResults((current) =>
      current.map((result) =>
        result.status === "applied" ? { ...result, status: "undone" } : result,
      ),
    );
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const savedForm = {
      ...form,
      matriculaVehiculo: normalizePlate(form.matriculaVehiculo),
    };
    if (selectedDeCA) {
      setDecas((current) =>
        current.map((deca) =>
          deca.id === selectedDeCA.id
            ? { ...deca, ...savedForm, updatedAt: now }
            : deca,
        ),
      );
    } else {
      const newDeCA: DeCA = {
        ...savedForm,
        id:
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        estado: "borrador",
        createdAt: now,
        updatedAt: now,
      };
      setDecas((current) => [newDeCA, ...current]);
    }
    setSelectedId(null);
    const nextForm = createEmptyForm(
      transportistas.find((item) => item.esPredeterminado),
    );
    setForm(nextForm);
    formRef.current = nextForm;
    setTransportistaQuery(nextForm.transportista);
    setTransportistaLoadedNotice(false);
    setLoaderQuery("");
    setDestinationQuery("");
    setLoaderLoadedNotice(false);
    setDestinationLoadedNotice(false);
    defaultDateRef.current = getToday();
    setView("list");
  };

  const handleDelete = () => {
    if (!selectedDeCA || !window.confirm("¿Eliminar este borrador DeCA?"))
      return;
    setDecas((current) =>
      current.filter((deca) => deca.id !== selectedDeCA.id),
    );
    setSelectedId(null);
    setView("list");
  };

  const startNewDeCA = () => {
    setSelectedId(null);
    const nextForm = createEmptyForm(
      transportistas.find((item) => item.esPredeterminado),
    );
    setForm(nextForm);
    formRef.current = nextForm;
    setTransportistaQuery(nextForm.transportista);
    setTransportistaLoadedNotice(false);
    setLoaderQuery("");
    setDestinationQuery("");
    setLoaderLoadedNotice(false);
    setDestinationLoadedNotice(false);
    setPhotoError("");
    setOcrError("");
    setDetectedText(null);
    setSuggestionResults([]);
    setAppliedSuggestions(null);
    defaultDateRef.current = getToday();
    editedFieldsRef.current.clear();
    setView("form");
  };

  const saveCurrentPlate = () => {
    const value = normalizePlate(formRef.current.matriculaVehiculo);
    if (!value || plates.some((plate) => normalizePlate(plate.valor) === value))
      return;
    const now = new Date().toISOString();
    setPlates((current) => [
      { id: createRecipientId(), valor: value, createdAt: now, updatedAt: now },
      ...current,
    ]);
    setPlateStorageWarning(false);
  };

  const saveEditedPlate = (plate: MatriculaHabitual) => {
    const value = normalizePlate(plateEditValue);
    if (
      !value ||
      plates.some(
        (item) => item.id !== plate.id && normalizePlate(item.valor) === value,
      )
    ) {
      setPlateManagerMessage("Escribe una matrícula única para guardarla.");
      return;
    }
    setPlates((current) =>
      current.map((item) =>
        item.id === plate.id
          ? { ...item, valor: value, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
    setEditingPlateId(null);
    setPlateManagerMessage("");
    setPlateStorageWarning(false);
  };

  const deletePlate = (plate: MatriculaHabitual) => {
    if (!window.confirm(`¿Eliminar la matrícula habitual ${plate.valor}?`))
      return;
    setPlates((current) => current.filter((item) => item.id !== plate.id));
    setPlateStorageWarning(false);
  };

  const editSelectedDeCA = () => {
    if (!selectedDeCA) return;
    const next: DeCAForm = {
      fecha: selectedDeCA.fecha ?? getToday(),
      cargador: selectedDeCA.cargador ?? "",
      transportista: selectedDeCA.transportista ?? "",
      transportistaNif: selectedDeCA.transportistaNif ?? "",
      transportistaDireccion: selectedDeCA.transportistaDireccion ?? "",
      transportistaCiudad: selectedDeCA.transportistaCiudad ?? "",
      transportistaCodigoPostal: selectedDeCA.transportistaCodigoPostal ?? "",
      transportistaProvincia: selectedDeCA.transportistaProvincia ?? "",
      transportistaPais: selectedDeCA.transportistaPais ?? "",
      transportistaTelefono: selectedDeCA.transportistaTelefono ?? "",
      transportistaEmail: selectedDeCA.transportistaEmail ?? "",
      transportistaNotas: selectedDeCA.transportistaNotas ?? "",
      destinatario: selectedDeCA.destinatario ?? "",
      direccionDestino: selectedDeCA.direccionDestino ?? "",
      ciudadDestino: selectedDeCA.ciudadDestino ?? "",
      mercancia: selectedDeCA.mercancia ?? "",
      numeroBultos: selectedDeCA.numeroBultos ?? "",
      pesoKg: selectedDeCA.pesoKg ?? "",
      referenciaAlbaran: selectedDeCA.referenciaAlbaran ?? "",
      matriculaVehiculo: selectedDeCA.matriculaVehiculo ?? "",
      notas: selectedDeCA.notas ?? "",
      fotoAlbaran: selectedDeCA.fotoAlbaran,
      nombreFotoAlbaran: selectedDeCA.nombreFotoAlbaran,
    };
    formRef.current = next;
    setForm(next);
    setTransportistaQuery(next.transportista);
    setTransportistaLoadedNotice(false);
    setLoaderQuery("");
    setDestinationQuery("");
    setPhotoError("");
    setOcrError("");
    setDetectedText(null);
    editedFieldsRef.current.clear();
    setView("form");
  };

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const labelClass = "mb-1.5 block text-xs font-bold text-slate-600";

  return (
    <div className="min-h-full bg-slate-50 px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <nav
          aria-label="Secciones DeCAs"
          className="mb-5 flex gap-2 border-b border-slate-200"
        >
          <button
            type="button"
            onClick={() => setView("list")}
            aria-current={
              view !== "companies" && view !== "carriers" ? "page" : undefined
            }
            className={`border-b-2 px-3 py-2 text-sm font-bold ${view !== "companies" && view !== "carriers" ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            DeCAs
          </button>
          <button
            type="button"
            onClick={() => {
              openCompanyManager();
            }}
            aria-current={view === "companies" ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-bold ${view === "companies" ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            Empresas
          </button>
          <button
            type="button"
            onClick={openTransportistaManager}
            aria-current={view === "carriers" ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-bold ${view === "carriers" ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            Transportistas
          </button>
        </nav>

        {companyMigrationNotice && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {companyMigrationNotice}
          </p>
        )}
        {companyStorageWarning && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
          >
            No se pudieron leer o guardar las Empresas habituales. La aplicación
            sigue disponible; revisa el almacenamiento del navegador.
          </p>
        )}

        {plateStorageWarning && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
          >
            No se pudieron leer o guardar las matrículas habituales. La
            aplicación sigue disponible.
          </p>
        )}

        {transportistaStorageWarning && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
          >
            No se pudieron leer o guardar los transportistas habituales. La
            aplicación sigue disponible.
          </p>
        )}

        {view === "companies" && (
          <DestinatariosManager
            recipients={companies}
            onChange={updateCompanies}
            initialAction={companyManagerAction}
            onClose={() => {
              setCompanyManagerAction(undefined);
              setView(companyManagerReturnView.current);
            }}
          />
        )}

        {view === "carriers" && (
          <TransportistasManager
            transportistas={transportistas}
            onChange={updateTransportistas}
            onClose={() => setView(transportistaManagerReturnView.current)}
          />
        )}

        {view === "list" && (
          <>
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h1 className="text-2xl font-black text-slate-900">
                  Mis DeCAs
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Documentos de control de transporte
                </p>
              </div>
              <button
                type="button"
                onClick={startNewDeCA}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
              >
                <Plus size={17} /> Nuevo DeCA
              </button>
            </div>

            {decas.length === 0 ? (
              <div className="border-y border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
                Aún no tienes ningún DeCA. Crea el primero.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
                {decas.map((deca) => (
                  <button
                    key={deca.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(deca.id);
                      setView("detail");
                    }}
                    className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-blue-50/50 sm:grid-cols-[0.8fr_2fr_1fr_1.2fr_auto] sm:items-center sm:px-5"
                  >
                    <span className="text-sm font-semibold text-slate-700">
                      {formatDate(deca.fecha)}
                    </span>
                    <span className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                      <span className="min-w-0">
                        <span className="block text-[10px] font-bold uppercase text-slate-500">
                          Cargador
                        </span>
                        <span className="block truncate text-sm font-bold text-slate-900">
                          {deca.cargador?.trim() || "Cargador no indicado"}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] font-bold uppercase text-slate-500">
                          Destinatario
                        </span>
                        <span className="block truncate text-sm font-bold text-slate-900">
                          {deca.destinatario?.trim() ||
                            "Destinatario no indicado"}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm text-slate-600">
                      <span className="block text-[10px] font-bold uppercase text-slate-500">
                        Ciudad de destino
                      </span>
                      {deca.ciudadDestino || "Sin ciudad"}
                    </span>
                    <span className="min-w-0 truncate text-sm text-slate-600">
                      <span className="block text-[10px] font-bold uppercase text-slate-500">
                        Mercancía
                      </span>
                      {deca.mercancia || "Sin mercancía"}
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="text-xs text-slate-500">
                        <span className="block text-[10px] font-bold uppercase text-slate-500">
                          Bultos / peso
                        </span>
                        {getDeCAMeasureSummary(deca)}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">
                        Borrador
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {view === "form" && (
          <div className="mx-auto max-w-3xl">
            <button
              type="button"
              onClick={() => setView("list")}
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={17} /> Volver a Mis DeCAs
            </button>
            <div className="border-y border-slate-200 bg-white px-4 py-5 sm:px-7">
              <div className="mb-5 flex items-center gap-3">
                <FileText className="text-blue-700" size={22} />
                <h1 className="text-xl font-black text-slate-900">
                  {selectedDeCA ? "Editar DeCA" : "Nuevo DeCA"}
                </h1>
              </div>
              <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
                <section className="relative space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="deca-loader-search"
                      className="text-xs font-bold text-slate-700"
                    >
                      Cargador habitual (opcional)
                    </label>
                    <button
                      type="button"
                      onClick={() => openCompanyManager()}
                      className="text-xs font-bold text-blue-700 hover:underline"
                    >
                      Gestionar empresas
                    </button>
                  </div>
                  <input
                    id="deca-loader-search"
                    className={inputClass}
                    value={loaderQuery}
                    onFocus={() => setLoaderPickerOpen(true)}
                    onChange={(event) => {
                      setLoaderQuery(event.target.value);
                      setLoaderPickerOpen(true);
                    }}
                    placeholder="Buscar por nombre, dirección, ciudad, CP, NIF, teléfono, email o contacto"
                    aria-label="Buscar cargador habitual en Empresas"
                    aria-autocomplete="list"
                    aria-expanded={loaderPickerOpen}
                  />
                  {loaderLoadedNotice && (
                    <p
                      role="status"
                      className="text-xs font-medium text-emerald-700"
                    >
                      Datos del cargador cargados desde Empresas habituales.
                    </p>
                  )}
                  {loaderPickerOpen &&
                    loaderQuery.trim() &&
                    matchingCompanies(loaderQuery).length > 0 && (
                      <ul
                        className="absolute inset-x-3 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
                        role="listbox"
                      >
                        {matchingCompanies(loaderQuery)
                          .slice(0, 10)
                          .map((company) => (
                            <li key={company.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected="false"
                                onClick={() => selectLoaderCompany(company)}
                                className="w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-blue-50"
                              >
                                <span className="block text-sm font-bold text-slate-800">
                                  {company.nombre}
                                </span>
                                <span className="block text-xs text-slate-500">
                                  {[
                                    company.direccion,
                                    company.codigoPostal,
                                    company.ciudad,
                                  ]
                                    .filter(Boolean)
                                    .join(", ")}
                                  {company.nif ? ` · NIF ${company.nif}` : ""}
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                </section>
                <section className="relative space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="deca-destination-search"
                      className="text-xs font-bold text-slate-700"
                    >
                      Destinatario habitual (opcional)
                    </label>
                    <button
                      type="button"
                      onClick={() => openCompanyManager()}
                      className="text-xs font-bold text-blue-700 hover:underline"
                    >
                      Gestionar empresas
                    </button>
                  </div>
                  <input
                    id="deca-destination-search"
                    className={inputClass}
                    value={destinationQuery}
                    onFocus={() => setDestinationPickerOpen(true)}
                    onChange={(event) => {
                      setDestinationQuery(event.target.value);
                      setDestinationPickerOpen(true);
                    }}
                    placeholder="Buscar por nombre, dirección, ciudad, CP, NIF, teléfono, email o contacto"
                    aria-label="Buscar destinatario habitual en Empresas"
                    aria-autocomplete="list"
                    aria-expanded={destinationPickerOpen}
                  />
                  {destinationLoadedNotice && (
                    <p
                      role="status"
                      className="text-xs font-medium text-emerald-700"
                    >
                      Datos del destinatario cargados desde Empresas habituales.
                    </p>
                  )}
                  {destinationPickerOpen &&
                    destinationQuery.trim() &&
                    matchingCompanies(destinationQuery).length > 0 && (
                      <ul
                        className="absolute inset-x-3 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
                        role="listbox"
                      >
                        {matchingCompanies(destinationQuery)
                          .slice(0, 10)
                          .map((company) => (
                            <li key={company.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected="false"
                                onClick={() =>
                                  selectDestinationCompany(company)
                                }
                                className="w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-blue-50"
                              >
                                <span className="block text-sm font-bold text-slate-800">
                                  {company.nombre}
                                </span>
                                <span className="block text-xs text-slate-500">
                                  {[
                                    company.direccion,
                                    company.codigoPostal,
                                    company.ciudad,
                                  ]
                                    .filter(Boolean)
                                    .join(", ")}
                                  {company.nif ? ` · NIF ${company.nif}` : ""}
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  {destinationPickerOpen &&
                    destinationQuery.trim() &&
                    matchingCompanies(destinationQuery).length === 0 &&
                    companies.length > 0 && (
                      <p className="text-xs text-slate-500">
                        No hay coincidencias. Puedes continuar rellenando a
                        mano.
                      </p>
                    )}
                  {companies.length === 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span>No hay empresas guardadas.</span>
                      <button
                        type="button"
                        onClick={() => openCompanyManager("create")}
                        className="font-bold text-blue-700 hover:underline"
                      >
                        Crear empresa
                      </button>
                      <button
                        type="button"
                        onClick={() => openCompanyManager("import")}
                        className="font-bold text-blue-700 hover:underline"
                      >
                        Importar CSV
                      </button>
                    </div>
                  )}
                </section>
                <section className="relative space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="deca-transportista-search"
                      className="text-xs font-bold text-slate-700"
                    >
                      Transportista habitual (opcional)
                    </label>
                    <button
                      type="button"
                      onClick={openTransportistaManager}
                      className="text-xs font-bold text-blue-700 hover:underline"
                    >
                      Gestionar transportistas
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="deca-transportista-search"
                      className={inputClass}
                      value={transportistaQuery}
                      onFocus={() => setTransportistaPickerOpen(true)}
                      onChange={(event) => {
                        setTransportistaQuery(event.target.value);
                        setTransportistaPickerOpen(true);
                      }}
                      placeholder="Buscar por nombre, NIF, dirección, ciudad, CP, teléfono o email"
                      aria-label="Buscar transportista habitual"
                      aria-autocomplete="list"
                      aria-expanded={transportistaPickerOpen}
                    />
                    {transportistaPickerOpen &&
                      transportistaQuery.trim() &&
                      matchingTransportistas(transportistaQuery).length > 0 && (
                        <ul
                          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
                          role="listbox"
                        >
                          {matchingTransportistas(transportistaQuery)
                            .slice(0, 10)
                            .map((item) => (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected="false"
                                  onClick={() => selectTransportista(item)}
                                  className="w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-blue-50"
                                >
                                  <span className="block text-sm font-bold text-slate-800">
                                    {item.nombre}
                                    {item.esPredeterminado
                                      ? " · Predeterminado"
                                      : ""}
                                  </span>
                                  <span className="block text-xs text-slate-500">
                                    {[item.nif, item.direccion, item.ciudad]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                  </div>
                  {transportistaLoadedNotice && (
                    <p
                      role="status"
                      className="text-xs font-medium text-emerald-700"
                    >
                      Datos del transportista cargados desde Transportistas
                      habituales.
                    </p>
                  )}
                  {transportistaPickerOpen &&
                    transportistaQuery.trim() &&
                    matchingTransportistas(transportistaQuery).length === 0 &&
                    transportistas.length > 0 && (
                      <p className="text-xs text-slate-500">
                        No hay coincidencias. Puedes introducir los datos
                        manualmente.
                      </p>
                    )}
                  {transportistas.length === 0 && (
                    <p className="text-xs text-slate-600">
                      No hay transportistas guardados. Puedes completar estos
                      datos manualmente.
                    </p>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(
                      [
                        ["transportista", "Nombre"],
                        ["transportistaNif", "NIF"],
                        ["transportistaDireccion", "Dirección"],
                        ["transportistaCiudad", "Ciudad"],
                        ["transportistaCodigoPostal", "Código postal"],
                        ["transportistaProvincia", "Provincia"],
                        ["transportistaPais", "País"],
                        ["transportistaTelefono", "Teléfono"],
                        ["transportistaEmail", "Email"],
                      ] as const
                    ).map(([field, label]) => (
                      <div
                        key={field}
                        className={
                          field === "transportistaDireccion"
                            ? "sm:col-span-2"
                            : ""
                        }
                      >
                        <label className={labelClass} htmlFor={`deca-${field}`}>
                          {label}
                        </label>
                        <input
                          id={`deca-${field}`}
                          className={inputClass}
                          type={
                            field === "transportistaEmail" ? "email" : "text"
                          }
                          value={form[field] ?? ""}
                          onChange={(event) =>
                            updateField(field, event.target.value)
                          }
                        />
                      </div>
                    ))}
                    <div className="sm:col-span-2">
                      <label
                        className={labelClass}
                        htmlFor="deca-transportistaNotas"
                      >
                        Notas del transportista
                      </label>
                      <textarea
                        id="deca-transportistaNotas"
                        className={`${inputClass} min-h-20 resize-y`}
                        value={form.transportistaNotas ?? ""}
                        onChange={(event) =>
                          updateField("transportistaNotas", event.target.value)
                        }
                      />
                    </div>
                  </div>
                </section>
                <div>
                  <label className={labelClass} htmlFor="deca-fecha">
                    Fecha
                  </label>
                  <input
                    id="deca-fecha"
                    className={inputClass}
                    type="date"
                    required
                    value={form.fecha}
                    onChange={(event) =>
                      updateField("fecha", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-cargador">
                    Cargador
                  </label>
                  <input
                    id="deca-cargador"
                    className={inputClass}
                    value={form.cargador}
                    onChange={(event) =>
                      updateField("cargador", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-destinatario">
                    Destinatario o empresa
                  </label>
                  <input
                    id="deca-destinatario"
                    className={inputClass}
                    required
                    value={form.destinatario}
                    onChange={(event) =>
                      updateField("destinatario", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="deca-direccion">
                    Dirección de destino
                  </label>
                  <input
                    id="deca-direccion"
                    className={inputClass}
                    required
                    value={form.direccionDestino}
                    onChange={(event) =>
                      updateField("direccionDestino", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-ciudad">
                    Ciudad de destino
                  </label>
                  <input
                    id="deca-ciudad"
                    className={inputClass}
                    required
                    value={form.ciudadDestino}
                    onChange={(event) =>
                      updateField("ciudadDestino", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-mercancia">
                    Mercancía
                  </label>
                  <input
                    id="deca-mercancia"
                    className={inputClass}
                    required
                    value={form.mercancia}
                    onChange={(event) =>
                      updateField("mercancia", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-bultos">
                    Número de bultos (opcional)
                  </label>
                  <input
                    id="deca-bultos"
                    className={inputClass}
                    inputMode="numeric"
                    value={form.numeroBultos ?? ""}
                    onChange={(event) =>
                      updateField("numeroBultos", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-peso-kg">
                    Peso (kg) (opcional)
                  </label>
                  <input
                    id="deca-peso-kg"
                    className={inputClass}
                    inputMode="decimal"
                    value={form.pesoKg ?? ""}
                    onChange={(event) =>
                      updateField("pesoKg", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-albaran">
                    Referencia de albarán (opcional)
                  </label>
                  <input
                    id="deca-albaran"
                    className={inputClass}
                    value={form.referenciaAlbaran}
                    onChange={(event) =>
                      updateField("referenciaAlbaran", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="deca-matricula">
                    Matrícula del vehículo
                  </label>
                  <input
                    id="deca-matricula"
                    className={inputClass}
                    list="deca-matriculas-habituales"
                    required
                    value={form.matriculaVehiculo}
                    onChange={(event) =>
                      updateField("matriculaVehiculo", event.target.value)
                    }
                  />
                  <datalist id="deca-matriculas-habituales">
                    {plates.map((plate) => (
                      <option key={plate.id} value={plate.valor} />
                    ))}
                  </datalist>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {normalizePlate(form.matriculaVehiculo) &&
                      !plates.some(
                        (plate) =>
                          normalizePlate(plate.valor) ===
                          normalizePlate(form.matriculaVehiculo),
                      ) && (
                        <button
                          type="button"
                          onClick={saveCurrentPlate}
                          className="text-xs font-bold text-blue-700 hover:underline"
                        >
                          Guardar matrícula
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => setPlateManagerOpen(true)}
                      className="text-xs font-bold text-blue-700 hover:underline"
                    >
                      Gestionar matrículas habituales
                    </button>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="deca-notas">
                    Observaciones (opcional)
                  </label>
                  <textarea
                    id="deca-notas"
                    className={`${inputClass} min-h-24 resize-y`}
                    value={form.notas}
                    onChange={(event) =>
                      updateField("notas", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className={labelClass}>
                    Foto del albarán (opcional)
                  </span>
                  <input
                    ref={cameraInputRef}
                    className="hidden"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                  />
                  <input
                    ref={galleryInputRef}
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      <FileText size={16} /> Hacer foto
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Upload size={16} /> Elegir foto
                    </button>
                  </div>
                  {form.fotoAlbaran && (
                    <>
                      <div className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 sm:p-4">
                        <h2 className="text-sm font-bold text-slate-900">
                          Revisar albarán
                        </h2>
                        {form.nombreFotoAlbaran && (
                          <p className="break-all text-xs text-slate-600">
                            {form.nombreFotoAlbaran}
                          </p>
                        )}
                        <img
                          src={form.fotoAlbaran}
                          alt="Vista previa del albarán"
                          className="max-h-[60vh] w-full rounded-lg border border-slate-200 bg-white object-contain"
                        />
                        <button
                          type="button"
                          onClick={handleReadReceipt}
                          disabled={ocrLoading}
                          className="min-h-11 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                        >
                          {ocrLoading
                            ? "Leyendo albarán…"
                            : "Leer datos del albarán"}
                        </button>
                        <div className="space-y-3">
                          {ocrLoading && (
                            <p role="status" className="text-sm text-slate-600">
                              Leyendo albarán… {ocrProgress}%
                            </p>
                          )}
                          {ocrError && (
                            <p
                              role="alert"
                              className="text-sm font-medium text-red-700"
                            >
                              {ocrError}
                            </p>
                          )}
                          {ocrNotice && (
                            <p
                              role="status"
                              className="text-sm font-medium text-amber-800"
                            >
                              {ocrNotice}
                            </p>
                          )}
                          {detectedText !== null && (
                            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-bold text-slate-900">
                                  Texto detectado
                                </h3>
                                <button
                                  type="button"
                                  onClick={handleCopyText}
                                  className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                                >
                                  Copiar texto
                                </button>
                              </div>
                              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                                {detectedText ||
                                  "No se detectó texto en la imagen."}
                              </pre>
                              {(regionDiagnostics || templateSignals) && (
                                <details className="rounded-md border border-slate-200 p-3">
                                  <summary className="cursor-pointer text-xs font-bold text-slate-700">
                                    Diagnóstico OCR por zonas
                                  </summary>
                                  {templateSignals && (
                                    <div className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-700">
                                      <p className="font-bold">
                                        Señales detectadas:{" "}
                                        {
                                          Object.values(templateSignals).filter(
                                            Boolean,
                                          ).length
                                        }
                                        /6
                                      </p>
                                      <p className="mt-1">
                                        {Object.entries(templateSignals)
                                          .filter(([, found]) => found)
                                          .map(
                                            ([key]) =>
                                              DACHSER_SIGNAL_LABELS[
                                                key as keyof typeof DACHSER_SIGNAL_LABELS
                                              ],
                                          )
                                          .join(", ") || "Ninguna"}
                                      </p>
                                    </div>
                                  )}
                                  {regionDiagnostics && (
                                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                                      {[
                                        ["Fecha", regionDiagnostics.fecha],
                                        [
                                          "Referencia expedición",
                                          regionDiagnostics.referenciaExpedicion,
                                        ],
                                        [
                                          "Número de bultos",
                                          regionDiagnostics.numeroBultos,
                                        ],
                                        ["Peso", regionDiagnostics.pesoKg],
                                        [
                                          "Consignatario",
                                          regionDiagnostics.consignatario,
                                        ],
                                      ].map(([label, value]) => (
                                        <div key={label} className="min-w-0">
                                          <dt className="text-[11px] font-bold text-slate-500">
                                            {label}
                                          </dt>
                                          <dd className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-700">
                                            {value || "Sin texto detectado"}
                                          </dd>
                                        </div>
                                      ))}
                                    </dl>
                                  )}
                                </details>
                              )}
                              <section className="space-y-2">
                                <h4 className="text-xs font-black uppercase text-slate-700">
                                  Sugerencias encontradas
                                </h4>
                                {suggestionResults.length > 0 ? (
                                  <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                                    {suggestionResults.map((result) => (
                                      <div
                                        key={result.field}
                                        className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-xs font-bold text-slate-700">
                                            {
                                              SUGGESTIBLE_FIELD_LABELS[
                                                result.field
                                              ]
                                            }
                                          </p>
                                          <p className="break-words text-sm text-slate-900">
                                            {result.value}
                                          </p>
                                        </div>
                                        <span
                                          className={`shrink-0 text-xs font-semibold ${
                                            result.status === "applied"
                                              ? "text-emerald-700"
                                              : "text-amber-800"
                                          }`}
                                        >
                                          {result.status === "applied"
                                            ? "Aplicada"
                                            : result.status === "manual"
                                              ? "No aplicada: editado manualmente"
                                              : result.status === "existing"
                                                ? "No aplicada: el campo ya tenía texto"
                                                : "Deshecha"}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-500">
                                    No se encontraron sugerencias claras para
                                    los campos.
                                  </p>
                                )}
                              </section>
                              <p className="text-sm font-semibold leading-5 text-amber-800">
                                {Object.keys(appliedSuggestions?.applied ?? {})
                                  .length > 0
                                  ? "Se han aplicado sugerencias del OCR. Revísalas antes de guardar."
                                  : "No se aplicaron sugerencias; los campos con contenido o editados manualmente se conservaron."}
                              </p>
                              {appliedSuggestions &&
                                Object.keys(appliedSuggestions.applied).length >
                                  0 && (
                                  <button
                                    type="button"
                                    onClick={undoOcrSuggestions}
                                    className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                                  >
                                    Deshacer sugerencias OCR
                                  </button>
                                )}
                              {copyMessage && (
                                <p
                                  role="status"
                                  className="text-xs text-slate-500"
                                >
                                  {copyMessage}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => galleryInputRef.current?.click()}
                            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            Cambiar foto
                          </button>
                          <button
                            type="button"
                            onClick={removePhoto}
                            className="min-h-11 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50"
                          >
                            Quitar foto
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                form.fotoAlbaran,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            Ver imagen completa
                          </button>
                        </div>
                      </div>
                      <p className="text-sm font-semibold leading-6 text-slate-700">
                        Revisa y completa los datos del albarán antes de guardar
                        el borrador.
                        <span className="mt-1 block text-xs font-normal text-slate-500">
                          Los campos se completan manualmente; la foto no
                          rellena datos automáticamente.
                        </span>
                      </p>
                    </>
                  )}
                  {photoError && (
                    <p
                      role="alert"
                      className="mt-2 text-sm font-medium text-red-700"
                    >
                      {photoError}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2 sm:flex sm:justify-end">
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 sm:w-auto"
                  >
                    {selectedDeCA ? "Guardar cambios" : "Guardar borrador"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {view === "detail" && selectedDeCA && (
          <div className="mx-auto max-w-3xl">
            <button
              type="button"
              onClick={() => setView("list")}
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={17} /> Volver a Mis DeCAs
            </button>
            <div className="border-y border-slate-200 bg-white px-4 py-5 sm:px-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-black text-slate-900">
                    {selectedDeCA.destinatario}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(selectedDeCA.fecha)}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                  Borrador
                </span>
              </div>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {[
                  ["Cargador", selectedDeCA.cargador],
                  ["Transportista", selectedDeCA.transportista],
                  ...getTransportistaDetails(selectedDeCA),
                  ["Destinatario", selectedDeCA.destinatario],
                  ["Dirección de destino", selectedDeCA.direccionDestino],
                  ["Ciudad de destino", selectedDeCA.ciudadDestino],
                  ["Mercancía", selectedDeCA.mercancia],
                  ...getDeCAMeasureDetails(selectedDeCA),
                  [
                    "Referencia de albarán",
                    selectedDeCA.referenciaAlbaran || "Sin referencia",
                  ],
                  ["Matrícula del vehículo", selectedDeCA.matriculaVehiculo],
                  ["Estado", "Borrador"],
                ].map(([label, value]) => (
                  <div key={label} className="border-b border-slate-100 py-3">
                    <dt className="text-xs font-bold text-slate-500">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-sm text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
                <div className="border-b border-slate-100 py-3 sm:col-span-2">
                  <dt className="text-xs font-bold text-slate-500">
                    Observaciones
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">
                    {selectedDeCA.notas || "Sin observaciones"}
                  </dd>
                </div>
              </dl>
              {selectedDeCA.fotoAlbaran && (
                <section className="mt-6 border-t border-slate-200 pt-5">
                  <h2 className="mb-3 text-sm font-bold text-slate-800">
                    Foto del albarán
                  </h2>
                  {selectedDeCA.nombreFotoAlbaran && (
                    <p className="mb-3 break-all text-xs text-slate-500">
                      {selectedDeCA.nombreFotoAlbaran}
                    </p>
                  )}
                  <img
                    src={selectedDeCA.fotoAlbaran}
                    alt={selectedDeCA.nombreFotoAlbaran || "Foto del albarán"}
                    className="max-h-96 w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        selectedDeCA.fotoAlbaran,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    Ver imagen completa
                  </button>
                </section>
              )}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={editSelectedDeCA}
                  className="mr-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Editar DeCA
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50"
                >
                  <Trash2 size={16} /> Eliminar borrador
                </button>
              </div>
            </div>
          </div>
        )}

        {plateManagerOpen && (
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="plate-manager-title"
              className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:p-6"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2
                  id="plate-manager-title"
                  className="text-lg font-black text-slate-900"
                >
                  Matrículas habituales
                </h2>
                <button
                  type="button"
                  aria-label="Cerrar gestión de matrículas"
                  onClick={() => {
                    setPlateManagerOpen(false);
                    setEditingPlateId(null);
                    setPlateManagerMessage("");
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
                >
                  Cerrar
                </button>
              </div>
              {plateManagerMessage && (
                <p role="alert" className="mb-3 text-sm text-red-700">
                  {plateManagerMessage}
                </p>
              )}
              {plates.length === 0 ? (
                <p className="border-y border-slate-200 py-6 text-center text-sm text-slate-500">
                  Aún no hay matrículas habituales guardadas.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {plates.map((plate) => (
                    <li
                      key={plate.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      {editingPlateId === plate.id ? (
                        <>
                          <input
                            aria-label="Editar matrícula habitual"
                            className={`${inputClass} min-w-40 flex-1`}
                            value={plateEditValue}
                            onChange={(event) =>
                              setPlateEditValue(event.target.value)
                            }
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveEditedPlate(plate)}
                              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlateId(null);
                                setPlateManagerMessage("");
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
                            >
                              Cancelar
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-slate-900">
                            {plate.valor}
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlateId(plate.id);
                                setPlateEditValue(plate.valor);
                                setPlateManagerMessage("");
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePlate(plate)}
                              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700"
                            >
                              Eliminar
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeCASection;
