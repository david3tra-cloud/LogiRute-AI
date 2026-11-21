import { normalizeRecipientText } from "./destinatariosService";
import type { DeCA, TransportistaHabitual } from "./types";

export type DeCATransportistaFields = Pick<
  DeCA,
  | "transportista"
  | "transportistaId"
  | "transportistaNif"
  | "transportistaDireccion"
  | "transportistaCiudad"
  | "transportistaCodigoPostal"
  | "transportistaProvincia"
  | "transportistaPais"
  | "transportistaTelefono"
  | "transportistaEmail"
  | "transportistaNotas"
>;

type TransportistaProfileField = Exclude<
  keyof DeCATransportistaFields,
  "transportista" | "transportistaId"
>;

type TransportistaProfileValueField = keyof Pick<
  TransportistaHabitual,
  | "nif"
  | "direccion"
  | "ciudad"
  | "codigoPostal"
  | "provincia"
  | "pais"
  | "telefono"
  | "email"
  | "notas"
>;

const profileFields: {
  formField: TransportistaProfileField;
  profileField: TransportistaProfileValueField;
}[] = [
  { formField: "transportistaNif", profileField: "nif" },
  { formField: "transportistaDireccion", profileField: "direccion" },
  { formField: "transportistaCiudad", profileField: "ciudad" },
  { formField: "transportistaCodigoPostal", profileField: "codigoPostal" },
  { formField: "transportistaProvincia", profileField: "provincia" },
  { formField: "transportistaPais", profileField: "pais" },
  { formField: "transportistaTelefono", profileField: "telefono" },
  { formField: "transportistaEmail", profileField: "email" },
  { formField: "transportistaNotas", profileField: "notas" },
];

const normalizeIdentifier = (value: string | undefined) =>
  normalizeRecipientText(value ?? "").replace(/\s+/g, "");

export const findTransportistaProfileForFields = (
  fields: DeCATransportistaFields,
  profiles: TransportistaHabitual[],
): TransportistaHabitual | undefined => {
  const idMatches = profiles.filter(
    (profile) => profile.id === fields.transportistaId,
  );
  if (idMatches.length === 1) return idMatches[0];
  if (!fields.transportistaId) return undefined;

  const nameMatches = profiles.filter(
    (profile) =>
      normalizeRecipientText(profile.nombre) ===
      normalizeRecipientText(fields.transportista),
  );
  const identityMatches = fields.transportistaNif
    ? nameMatches.filter(
        (profile) =>
          normalizeIdentifier(profile.nif) ===
          normalizeIdentifier(fields.transportistaNif),
      )
    : nameMatches;
  return identityMatches.length === 1 ? identityMatches[0] : undefined;
};

export const transportistaFieldsFromDeCA = (
  source: Partial<DeCATransportistaFields>,
): DeCATransportistaFields => ({
  transportista: source.transportista ?? "",
  transportistaId: source.transportistaId ?? "",
  transportistaNif: source.transportistaNif ?? "",
  transportistaDireccion: source.transportistaDireccion ?? "",
  transportistaCiudad: source.transportistaCiudad ?? "",
  transportistaCodigoPostal: source.transportistaCodigoPostal ?? "",
  transportistaProvincia: source.transportistaProvincia ?? "",
  transportistaPais: source.transportistaPais ?? "",
  transportistaTelefono: source.transportistaTelefono ?? "",
  transportistaEmail: source.transportistaEmail ?? "",
  transportistaNotas: source.transportistaNotas ?? "",
});

export const selectTransportistaFields = (
  current: DeCATransportistaFields,
  profile: TransportistaHabitual,
  preservePais = false,
): DeCATransportistaFields => ({
  transportista: profile.nombre,
  transportistaId: profile.id,
  transportistaNif: profile.nif,
  transportistaDireccion: profile.direccion,
  transportistaCiudad: profile.ciudad,
  transportistaCodigoPostal: profile.codigoPostal,
  transportistaProvincia: profile.provincia,
  transportistaPais: preservePais ? current.transportistaPais : profile.pais,
  transportistaTelefono: profile.telefono,
  transportistaEmail: profile.email,
  transportistaNotas: profile.notas,
});

export const editTransportistaIdentityFields = (
  current: DeCATransportistaFields,
  field: "transportista" | "transportistaNif",
  value: string,
  selectedProfile?: TransportistaHabitual,
  isFieldManuallyEdited: (field: TransportistaProfileField) => boolean = () =>
    false,
): DeCATransportistaFields => {
  const editedIdentity =
    field === "transportista"
      ? { transportista: value }
      : { transportistaNif: value };
  const next = { ...current, ...editedIdentity };
  if (!current.transportistaId) return next;
  if (!selectedProfile) {
    return { ...next, transportistaId: "" };
  }

  const identityStillMatches =
    field === "transportista"
      ? normalizeRecipientText(value) ===
        normalizeRecipientText(selectedProfile.nombre)
      : normalizeIdentifier(value) === normalizeIdentifier(selectedProfile.nif);
  if (identityStillMatches) return next;

  const clearedFields: Partial<DeCATransportistaFields> = {};
  for (const { formField, profileField } of profileFields) {
    if (
      !isFieldManuallyEdited(formField) &&
      (current[formField] ?? "") ===
      selectedProfile[profileField]
    ) {
      Object.assign(clearedFields, { [formField]: "" });
    }
  }

  return {
    ...next,
    ...clearedFields,
    transportistaId: "",
    ...editedIdentity,
  };
};

export const transportistaUpdateFields = (
  source: DeCATransportistaFields,
  includeIdentity = true,
) => ({
  transportista: source.transportista.trim() || null,
  ...(includeIdentity
    ? {
        transportista_habitual_id: source.transportistaId?.trim() || null,
      }
    : {}),
  transportista_nif: source.transportistaNif?.trim() || null,
  transportista_direccion: source.transportistaDireccion?.trim() || null,
  transportista_ciudad: source.transportistaCiudad?.trim() || null,
  transportista_codigo_postal:
    source.transportistaCodigoPostal?.trim() || null,
  transportista_provincia: source.transportistaProvincia?.trim() || null,
  transportista_pais: source.transportistaPais?.trim() || null,
  transportista_telefono: source.transportistaTelefono?.trim() || null,
  transportista_email: source.transportistaEmail?.trim() || null,
  transportista_notas: source.transportistaNotas?.trim() || null,
});
