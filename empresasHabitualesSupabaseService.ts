import { supabase } from "./lib/supabase";
import type { Database } from "./database.types";
import type { EmpresaHabitual } from "./types";

export type EmpresaHabitualRow =
  Database["public"]["Tables"]["empresas_habituales"]["Row"];

export type EmpresaHabitualInsert =
  Database["public"]["Tables"]["empresas_habituales"]["Insert"];

export type EmpresaHabitualUpdate =
  Database["public"]["Tables"]["empresas_habituales"]["Update"];

const EMPRESA_COLUMNS =
  "id,user_id,nombre,direccion,ciudad,codigo_postal,provincia,pais,nif,telefono,email,contacto,notas,created_at,updated_at";

const throwSupabaseError = (operation: string, message: string): never => {
  throw new Error(`${operation}: ${message}`);
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

export async function insertUserEmpresaHabitual(
  empresa: EmpresaHabitualInsert,
): Promise<EmpresaHabitualRow> {
  const userId = await requireCurrentUserId();

  const payload: EmpresaHabitualInsert = {
    ...empresa,
    user_id: userId,
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
    );
  }

  return data;
}

export async function updateUserEmpresaHabitual(
  id: string,
  changes: EmpresaHabitualUpdate,
): Promise<EmpresaHabitualRow> {
  const userId = await requireCurrentUserId();

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
