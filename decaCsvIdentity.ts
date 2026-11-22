import type {
  DecaCsvPreview,
} from "./decaCsvService";
import type {
  DeCA,
  EmpresaHabitual,
  TransportistaHabitual,
} from "./types";
import { normalizeRecipientText } from "./destinatariosService";

export type DeCACsvIdentityRole =
  | "cargador"
  | "transportista"
  | "destinatario";
export type DeCACsvIdentityStatus =
  | "resolved"
  | "ambiguous"
  | "missing"
  | "incomplete"
  | "contradictory"
  | "needs_selection"
  | "indistinguishable";

export type DeCACsvIdentityProfile = EmpresaHabitual | TransportistaHabitual;

export type DeCACsvIdentityGroup = {
  key: string;
  role: DeCACsvIdentityRole;
  name: string;
  nif: string;
  profileId: string;
  rowNumbers: number[];
  candidates: DeCACsvIdentityProfile[];
  selectableCandidates: DeCACsvIdentityProfile[];
  profile?: DeCACsvIdentityProfile;
  status: DeCACsvIdentityStatus;
};

const normalizeIdentifier = (value: string) =>
  value.trim().toLocaleUpperCase("es-ES").replace(/\s+/g, "");

const isCompleteProfile = (profile: DeCACsvIdentityProfile) =>
  Boolean(
    profile.nombre.trim() &&
      profile.nif.trim() &&
      profile.direccion.trim() &&
      profile.ciudad.trim() &&
      profile.codigoPostal.trim(),
  );

const profileMatchesGroup = (
  profile: DeCACsvIdentityProfile,
  group: Pick<DeCACsvIdentityGroup, "name" | "nif" | "profileId">,
) => {
  if (
    group.profileId &&
    profile.id.trim() !== group.profileId
  ) {
    return false;
  }
  if (
    group.nif &&
    normalizeIdentifier(profile.nif) !== normalizeIdentifier(group.nif)
  ) {
    return false;
  }
  return (
    !group.name ||
    normalizeRecipientText(profile.nombre) === normalizeRecipientText(group.name)
  );
};

export const resolveDeCACsvIdentityGroups = (
  preview: DecaCsvPreview,
  companies: EmpresaHabitual[],
  transportistas: TransportistaHabitual[],
  choices: Record<string, string> = {},
): DeCACsvIdentityGroup[] => {
  const grouped = new Map<
    string,
    Omit<DeCACsvIdentityGroup, "candidates" | "selectableCandidates" | "profile" | "status">
  >();

  for (const row of preview.rows) {
    if (!row.deca || row.reason) continue;
    const identities = [
      {
        role: "cargador" as const,
        name: row.deca.cargador,
        nif: row.deca.cargadorNif ?? "",
        profileId: row.deca.cargadorId ?? "",
      },
      {
        role: "transportista" as const,
        name: row.deca.transportista,
        nif: row.deca.transportistaNif ?? "",
        profileId: row.deca.transportistaId ?? "",
      },
      {
        role: "destinatario" as const,
        name: row.deca.destinatario,
        nif: row.deca.destinatarioNif ?? "",
        profileId: "",
      },
    ];

    for (const identity of identities) {
      if (
        identity.role === "transportista" &&
        !identity.name.trim() &&
        !identity.nif.trim() &&
        !identity.profileId.trim()
      ) {
        continue;
      }

      const key = JSON.stringify([
        identity.role,
        normalizeRecipientText(identity.name),
        normalizeIdentifier(identity.nif),
        identity.profileId.trim(),
      ]);
      const existing = grouped.get(key);
      if (existing) {
        existing.rowNumbers.push(row.rowNumber);
      } else {
        grouped.set(key, {
          key,
          role: identity.role,
          name: identity.name,
          nif: identity.nif,
          profileId: identity.profileId.trim(),
          rowNumbers: [row.rowNumber],
        });
      }
    }
  }

  return [...grouped.values()].map((group) => {
    const allProfiles: DeCACsvIdentityProfile[] =
      group.role === "transportista" ? transportistas : companies;
    const profiles = allProfiles.filter((profile) =>
      profileMatchesGroup(profile, group),
    );
    const hasIdentity = Boolean(group.profileId || group.nif || group.name);
    const hasAnyIdentifierMatch = allProfiles.some((profile) => {
      const idMatches =
        !group.profileId || profile.id.trim() === group.profileId;
      const nifMatches =
        !group.nif ||
        normalizeIdentifier(profile.nif) === normalizeIdentifier(group.nif);
      const nameMatches =
        !group.name ||
        normalizeRecipientText(profile.nombre) ===
          normalizeRecipientText(group.name);
      return (
        (group.profileId && idMatches) ||
        (group.nif && nifMatches) ||
        (group.name && nameMatches)
      );
    });
    const selectableCandidates = profiles.filter((profile) => {
      if (group.role !== "destinatario") return isCompleteProfile(profile);
      if (!profile.nombre.trim() || !profile.nif.trim()) return false;
      return (
        allProfiles.filter(
          (candidate) =>
            normalizeIdentifier(candidate.nif) ===
            normalizeIdentifier(profile.nif),
        ).length === 1
      );
    });
    const chosenId = choices[group.key];
    const chosen = selectableCandidates.find((profile) => profile.id === chosenId);
    const indistinguishableRecipientProfiles =
      group.role === "destinatario" &&
      (group.nif
        ? allProfiles.filter(
            (profile) =>
              normalizeIdentifier(profile.nif) ===
              normalizeIdentifier(group.nif),
          ).length > 1
        : (profiles.length > 1 && selectableCandidates.length === 0) ||
          profiles.some(
            (profile) =>
              profile.nif.trim() &&
              allProfiles.filter(
                (candidate) =>
                  normalizeIdentifier(candidate.nif) ===
                  normalizeIdentifier(profile.nif),
              ).length > 1,
          ));

    let status: DeCACsvIdentityStatus;
    let profile: DeCACsvIdentityProfile | undefined;
    if (indistinguishableRecipientProfiles) {
      status = "indistinguishable";
    } else if (chosen) {
      status = "resolved";
      profile = chosen;
    } else if (profiles.length === 0) {
      status =
        hasIdentity && hasAnyIdentifierMatch ? "contradictory" : "missing";
    } else if (profiles.length > 1) {
      status = "ambiguous";
    } else if (
      group.role === "destinatario"
        ? !selectableCandidates.includes(profiles[0])
        : !isCompleteProfile(profiles[0])
    ) {
      status = "incomplete";
    } else if (!hasIdentity) {
      status = "needs_selection";
    } else {
      status = "resolved";
      profile = profiles[0];
    }

    return {
      ...group,
      candidates: profiles,
      selectableCandidates: indistinguishableRecipientProfiles
        ? []
        : selectableCandidates,
      profile,
      status,
    };
  }).filter((group) => {
    if (
      group.role !== "destinatario" ||
      group.nif ||
      group.status === "ambiguous" ||
      group.status === "indistinguishable"
    ) {
      return true;
    }
    return group.candidates.length > 1 || group.status === "resolved";
  });
};

export const resolveDeCACsvRows = (
  preview: DecaCsvPreview,
  groups: DeCACsvIdentityGroup[],
): DeCA[] => {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  return preview.rows.flatMap((row) => {
    if (!row.deca || row.reason) return [];
    const cargadorKey = JSON.stringify([
      "cargador",
      normalizeRecipientText(row.deca.cargador),
      normalizeIdentifier(row.deca.cargadorNif ?? ""),
      (row.deca.cargadorId ?? "").trim(),
    ]);
    const transportistaKey = JSON.stringify([
      "transportista",
      normalizeRecipientText(row.deca.transportista),
      normalizeIdentifier(row.deca.transportistaNif ?? ""),
      (row.deca.transportistaId ?? "").trim(),
    ]);
    const destinatarioKey = JSON.stringify([
      "destinatario",
      normalizeRecipientText(row.deca.destinatario),
      normalizeIdentifier(row.deca.destinatarioNif ?? ""),
      "",
    ]);
    const cargadorGroup = byKey.get(cargadorKey);
    const transportistaGroup = byKey.get(transportistaKey);
    const destinatarioGroup = byKey.get(destinatarioKey);
    const cargador =
      cargadorGroup?.status === "resolved"
        ? cargadorGroup.profile
        : undefined;
    const transportista =
      transportistaGroup?.status === "resolved"
        ? transportistaGroup.profile
        : undefined;
    const destinatario =
      destinatarioGroup?.status === "resolved"
        ? destinatarioGroup.profile
        : undefined;
    const hasTransportistaIdentity = Boolean(
      row.deca.transportista.trim() ||
        row.deca.transportistaNif?.trim() ||
        row.deca.transportistaId?.trim(),
    );
    if (
      !cargador ||
      cargadorGroup?.role !== "cargador" ||
      (hasTransportistaIdentity &&
        (!transportista || transportistaGroup?.role !== "transportista")) ||
      (destinatarioGroup &&
        (!destinatario || destinatarioGroup.role !== "destinatario"))
    ) {
      return [];
    }

    const resolvedCargador = cargador as EmpresaHabitual;
    const resolvedTransportista = transportista as
      | TransportistaHabitual
      | undefined;
    return [
      {
        ...row.deca,
        cargador: resolvedCargador.nombre,
        cargadorId: resolvedCargador.id,
        cargadorNif: resolvedCargador.nif,
        ...(destinatario
          ? {
              destinatarioNif: destinatario.nif,
            }
          : {}),
        ...(resolvedTransportista
          ? {
              transportista: resolvedTransportista.nombre,
              transportistaId: resolvedTransportista.id,
              transportistaNif: resolvedTransportista.nif,
              transportistaDireccion: resolvedTransportista.direccion,
              transportistaCiudad: resolvedTransportista.ciudad,
              transportistaCodigoPostal: resolvedTransportista.codigoPostal,
              transportistaProvincia: resolvedTransportista.provincia,
              transportistaPais: resolvedTransportista.pais,
              transportistaTelefono: resolvedTransportista.telefono,
              transportistaEmail: resolvedTransportista.email,
              transportistaNotas: resolvedTransportista.notas,
            }
          : {}),
      },
    ];
  });
};
