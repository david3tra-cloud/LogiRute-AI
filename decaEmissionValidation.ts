import type { DeCA, EmpresaHabitual } from "./types";

export type DeCAEmissionField =
  | "fecha"
  | "cargador"
  | "cargadorNif"
  | "cargadorDireccion"
  | "cargadorCiudad"
  | "cargadorCodigoPostal"
  | "transportista"
  | "transportistaNif"
  | "transportistaDireccion"
  | "transportistaCiudad"
  | "transportistaCodigoPostal"
  | "destinatario"
  | "direccionDestino"
  | "ciudadDestino"
  | "destinatarioCodigoPostal"
  | "matriculaVehiculo"
  | "mercancia"
  | "numeroBultos"
  | "pesoKg";

export type DeCAEmissionFieldError = {
  field: DeCAEmissionField;
  label: string;
  code: "required" | "invalid";
};

export type EffectiveRecipientAddress = {
  direccion: string;
  ciudad: string;
  codigoPostal: string;
  pais: string;
};

const effectiveText = (explicit: string | undefined, fallback: string | undefined) =>
  explicit?.trim() ? explicit : fallback ?? "";

export const resolveEffectiveRecipientAddress = (
  deca: DeCA,
  recipient?: EmpresaHabitual,
): EffectiveRecipientAddress => ({
  direccion: effectiveText(deca.direccionDestino, recipient?.direccion),
  ciudad: effectiveText(deca.ciudadDestino, recipient?.ciudad),
  codigoPostal: effectiveText(
    deca.destinatarioCodigoPostal,
    recipient?.codigoPostal,
  ),
  pais: effectiveText(deca.destinatarioPais, recipient?.pais),
});

const isValidDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
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

const present = (value: string | undefined | null) => Boolean(value?.trim());

export const validateDeCAForEmission = (
  deca: DeCA,
  carrier: EmpresaHabitual,
  recipient?: EmpresaHabitual,
): DeCAEmissionFieldError[] => {
  const errors: DeCAEmissionFieldError[] = [];
  const required = (field: DeCAEmissionField, label: string, value: string | undefined | null) => {
    if (!present(value)) errors.push({ field, label, code: "required" });
  };

  if (!isValidDate(deca.fecha)) {
    errors.push({ field: "fecha", label: "Fecha de transporte", code: "invalid" });
  }

  required("cargador", "Nombre del cargador", deca.cargador);
  required("cargadorNif", "NIF del cargador", deca.cargadorNif || carrier.nif);
  required("cargadorDireccion", "Dirección del cargador", carrier.direccion);
  required("cargadorCiudad", "Ciudad del cargador", carrier.ciudad);
  required("cargadorCodigoPostal", "Código postal del cargador", carrier.codigoPostal);

  required("transportista", "Nombre del transportista", deca.transportista);
  required("transportistaNif", "NIF del transportista", deca.transportistaNif);
  required("transportistaDireccion", "Dirección del transportista", deca.transportistaDireccion);
  required("transportistaCiudad", "Ciudad del transportista", deca.transportistaCiudad);
  required("transportistaCodigoPostal", "Código postal del transportista", deca.transportistaCodigoPostal);

  const recipientAddress = resolveEffectiveRecipientAddress(deca, recipient);
  required("destinatario", "Nombre del destinatario", deca.destinatario);
  required("direccionDestino", "Dirección de entrega", recipientAddress.direccion);
  required("ciudadDestino", "Ciudad del destinatario", recipientAddress.ciudad);
  required("destinatarioCodigoPostal", "Código postal del destinatario", recipientAddress.codigoPostal);

  required("matriculaVehiculo", "Matrícula del vehículo", deca.matriculaVehiculo);
  required("mercancia", "Descripción de la mercancía", deca.mercancia);

  const packageCount = deca.numeroBultos?.trim();
  if (packageCount) {
    const parsed = Number(packageCount);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      errors.push({ field: "numeroBultos", label: "Número de bultos", code: "invalid" });
    }
  }

  const weight = deca.pesoKg?.trim();
  if (weight) {
    const parsed = Number(weight);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.push({ field: "pesoKg", label: "Peso (kg)", code: "invalid" });
    }
  }

  return errors;
};
