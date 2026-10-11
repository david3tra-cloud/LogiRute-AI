import { supabase } from "./lib/supabase";
import type { Database } from "./database.types";
import type { EmpresaHabitual } from "./types";
import {
  isUuid,
  loadEmpresaIdMap,
  normalizeRecipientText,
  type EmpresaPayload,
} from "./destinatariosService";

export type EmpresaHabitualRow =
  Database["public"]["Tables"]["empresas_habituales"]["Row"];

export type EmpresaHabitualInsert =
  Database["public"]["Tables"]["empresas_habituales"]["Insert"];

export type EmpresaHabitualUpdate =
  Database["public"]["Tables"]["empresas_habituales"]["Update"];

const EMPRESA_COLUMNS =
  "id,user_id,nombre,direccion,ciudad,codigo_postal,provincia,pais,nif,telefono,email,contacto,notas,created_at,updated_at";

export class EmpresaServiceError extends Error {
  readonly code?: string;

  constructor(operation: string, message: string, code?: string) {
    super(`${operation}: ${message}`);
    this.name = "EmpresaServiceError";
    this.code = code;
  }
}

const throwSupabaseError = (
  operation: string,
  message: string,
  code?: string,
): never => {
  throw new EmpresaServiceError(operation, message, code);
};

const requireCurrentUserId = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return throwSupabaseError(
      "No se pudo consultar el usuario autenticado",
      error.message,
    );
  }

  const userId = data.user?.id;

  if (!userId) {
    throw new Error(
      "Se requiere una sesión iniciada para trabajar con empresas habituales.",
    );
  }

  return userId;
};

export async function listUserEmpresasHabituales(): Promise<
  EmpresaHabitualRow[]
> {
  const userId = await requireCurrentUserId();

  const { data, error } = await supabase
    .from("empresas_habituales")
    .select(EMPRESA_COLUMNS)
    .eq("user_id", userId)
    .order("nombre", { ascending: true });

  if (error) {
    return throwSupabaseError(
      "No se pudieron cargar las empresas habituales",
      error.message,
    );
  }

  return data ?? [];
}

export async function getUserEmpresaHabitual(
  id: string,
): Promise<EmpresaHabitualRow | null> {
  if (!isUuid(id)) {
    throw new Error("El identificador de la empresa habitual no es un UUID válido.");
  }
  const userId = await requireCurrentUserId();

  const { data, error } = await supabase
    .from("empresas_habituales")
    .select(EMPRESA_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return throwSupabaseError(
      "No se pudo cargar la empresa habitual",
      error.message,
    );
  }

  return data;
}

export async function loadUserEmpresaHabitualForDeCA(
  id: string | null | undefined,
  nif: string | null | undefined,
  nombre: string | null | undefined,
): Promise<EmpresaHabitual | undefined> {
  const userId = await requireCurrentUserId();

  const requestedId = id?.trim();
  const resolvedId = requestedId
    ? isUuid(requestedId)
      ? requestedId
      : loadEmpresaIdMap(userId)[requestedId]
    : undefined;
  if (resolvedId && isUuid(resolvedId)) {
    const { data, error } = await supabase
      .from("empresas_habituales")
      .select(EMPRESA_COLUMNS)
      .eq("id", resolvedId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return throwSupabaseError(
        "No se pudo cargar la empresa habitual del DeCA",
        error.message,
        error.code,
      );
    }
    if (data) return mapSupabaseEmpresaHabitualToLocal(data);
  }

  if (nif?.trim()) {
    const { data, error } = await supabase
      .from("empresas_habituales")
      .select(EMPRESA_COLUMNS)
      .eq("user_id", userId)
      .eq("nif", nif.trim())
      .limit(1)
      .maybeSingle();

    if (error) {
      return throwSupabaseError(
        "No se pudo buscar la empresa habitual por NIF",
        error.message,
      );
    }
    if (data) return mapSupabaseEmpresaHabitualToLocal(data);
  }

  const normalizedName = normalizeRecipientText(nombre ?? "");
  if (!normalizedName) return undefined;

  const { data, error } = await supabase
    .from("empresas_habituales")
    .select(EMPRESA_COLUMNS)
    .eq("user_id", userId)
    .order("nombre", { ascending: true });

  if (error) {
    return throwSupabaseError(
      "No se pudo buscar la empresa habitual por nombre",
      error.message,
    );
  }
  const match = (data ?? []).find(
    (row) => normalizeRecipientText(row.nombre) === normalizedName,
  );
  return match ? mapSupabaseEmpresaHabitualToLocal(match) : undefined;
}

export async function insertUserEmpresaHabitual(
  empresa: EmpresaHabitualInsert,
  expectedUserId?: string,
): Promise<EmpresaHabitualRow> {
  const userId = await requireCurrentUserId();
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(
      "La sesión cambió; no se puede insertar una empresa de otra cuenta.",
    );
  }

  const payload: EmpresaHabitualInsert = {
    ...empresa,
    user_id: expectedUserId ?? userId,
  };

  const { data, error } = await supabase
    .from("empresas_habituales")
    .insert(payload)
    .select(EMPRESA_COLUMNS)
    .single();

  if (error) {
    return throwSupabaseError(
      "No se pudo crear la empresa habitual",
      error.message,
      error.code,
    );
  }

  return data;
}

export async function updateUserEmpresaHabitual(
  id: string,
  changes: EmpresaHabitualUpdate,
  expectedUserId?: string,
): Promise<EmpresaHabitualRow> {
  if (!isUuid(id)) {
    throw new Error("El identificador de la empresa habitual no es un UUID válido.");
  }
  const userId = await requireCurrentUserId();
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(
      "La sesión cambió; no se puede actualizar una empresa de otra cuenta.",
    );
  }

  const {
    id: _ignoredId,
    user_id: _ignoredUserId,
    ...mutableChanges
  } = changes;

  void _ignoredId;
  void _ignoredUserId;

  const { data, error } = await supabase
    .from("empresas_habituales")
    .update({
      ...mutableChanges,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select(EMPRESA_COLUMNS)
    .single();

  if (error) {
    return throwSupabaseError(
      "No se pudo actualizar la empresa habitual",
      error.message,
      error.code,
    );
  }

  return data;
}

export async function deleteUserEmpresaHabitual(
  id: string,
): Promise<{ deleted: boolean }> {
  const userId = await requireCurrentUserId();

  const { data, error } = await supabase
    .from("empresas_habituales")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return throwSupabaseError(
      "No se pudo eliminar la empresa habitual",
      error.message,
    );
  }

  return { deleted: data !== null };
}
export async function getEmpresaRowByIdForUser(
  id: string,
  userId: string,
): Promise<EmpresaHabitualRow | null> {
  if (!isUuid(id)) {
    throw new EmpresaServiceError(
      "No se pudo confirmar la empresa habitual",
      "el identificador no es un UUID válido",
      "22P02",
    );
  }
  const { data, error } = await supabase
    .from("empresas_habituales")
    .select(EMPRESA_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return throwSupabaseError(
      "No se pudo confirmar la empresa habitual",
      error.message,
      error.code,
    );
  }
  return data;
}

export const payloadMatchesEmpresaRow = (
  payload: EmpresaPayload,
  row: EmpresaHabitualRow,
): boolean => {
  const clean = (value: string | null | undefined) => value ?? "";
  return (
    clean(payload.nombre) === clean(row.nombre) &&
    clean(payload.direccion) === clean(row.direccion) &&
    clean(payload.ciudad) === clean(row.ciudad) &&
    clean(payload.codigoPostal) === clean(row.codigo_postal) &&
    clean(payload.provincia) === clean(row.provincia) &&
    clean(payload.pais) === clean(row.pais) &&
    clean(payload.nif) === clean(row.nif) &&
    clean(payload.telefono) === clean(row.telefono) &&
    clean(payload.email) === clean(row.email) &&
    clean(payload.contacto) === clean(row.contacto) &&
    clean(payload.notas) === clean(row.notas)
  );
};

export function mapSupabaseEmpresaHabitualToLocal(
  row: EmpresaHabitualRow,
): EmpresaHabitual {
  return {
    id: row.id,
    nombre: row.nombre,
    direccion: row.direccion ?? "",
    ciudad: row.ciudad ?? "",
    codigoPostal: row.codigo_postal ?? "",
    provincia: row.provincia ?? "",
    pais: row.pais ?? "",
    nif: row.nif ?? "",
    telefono: row.telefono ?? "",
    email: row.email ?? "",
    contacto: row.contacto ?? "",
    notas: row.notas ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
