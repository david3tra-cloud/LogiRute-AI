import type { DeCA } from "./types";
import { supabase } from "./lib/supabase";

export type DecaRow = {
  id: string;
  user_id: string;
  estado: "BORRADOR" | "EMITIDO";
  cargador: string | null;
  cargador_nif: string | null;
  destinatario: string | null;
  destinatario_nif: string | null;
  transportista: string | null;
  transportista_nif: string | null;
  mercancia: string | null;
  bultos: number | null;
  peso_bruto: number | null;
  matricula: string | null;
  origen: string | null;
  destino: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  emitted_at: string | null;
};

export type DecaInsert = Omit<
  DecaRow,
  "id" | "created_at" | "updated_at" | "emitted_at"
>;

export type DecaUpdate = Partial<
  Omit<DecaRow, "id" | "user_id" | "created_at" | "updated_at">
>;

const DECA_COLUMNS =
  "id,user_id,estado,cargador,cargador_nif,destinatario,destinatario_nif,transportista,transportista_nif,mercancia,bultos,peso_bruto,matricula,origen,destino,observaciones,created_at,updated_at,emitted_at";

const UPDATE_COLUMNS = [
  "estado",
  "cargador",
  "cargador_nif",
  "destinatario",
  "destinatario_nif",
  "transportista",
  "transportista_nif",
  "mercancia",
  "bultos",
  "peso_bruto",
  "matricula",
  "origen",
  "destino",
  "observaciones",
  "emitted_at",
] as const satisfies readonly (keyof DecaUpdate)[];

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const throwSupabaseError = (operation: string, message: string): never => {
  throw new Error(`${operation}: ${message}`);
};

const requireCurrentUserId = async () => {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Se requiere una sesión iniciada para trabajar con DeCAs.");
  }
  return userId;
};

const nullableText = (value: string | null | undefined) =>
  value == null || value.trim() === "" ? null : value;

const nullableNumber = (
  value: string | null | undefined,
  fieldName: string,
): number | null => {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`El campo ${fieldName} debe ser un número válido.`);
  }
  return parsed;
};

const nullableInteger = (
  value: string | null | undefined,
  fieldName: string,
): number | null => {
  const parsed = nullableNumber(value, fieldName);
  if (parsed !== null && !Number.isInteger(parsed)) {
    throw new Error(`El campo ${fieldName} debe ser un número entero.`);
  }
  return parsed;
};

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return throwSupabaseError(
        "No se pudo consultar el usuario autenticado",
        error.message,
      );
    }
    return data.user?.id ?? null;
  } catch (error) {
    throw new Error(
      `No se pudo consultar el usuario autenticado: ${errorMessage(error)}`,
    );
  }
}

export async function listUserDecas(): Promise<DecaRow[]> {
  await requireCurrentUserId();
  const { data, error } = await supabase
    .from("decas")
    .select(DECA_COLUMNS)
    .returns<DecaRow[]>();

  if (error) {
    return throwSupabaseError("No se pudieron cargar los DeCAs", error.message);
  }
  return data ?? [];
}

export async function insertUserDeca(deca: DeCA): Promise<DecaRow> {
  const userId = await requireCurrentUserId();
  const payload: DecaInsert = {
    user_id: userId,
    estado: "BORRADOR",
    cargador: nullableText(deca.cargador),
    cargador_nif: null,
    destinatario: nullableText(deca.destinatario),
    destinatario_nif: null,
    transportista: nullableText(deca.transportista),
    transportista_nif: nullableText(deca.transportistaNif),
    mercancia: nullableText(deca.mercancia),
    bultos: nullableInteger(deca.numeroBultos, "número de bultos"),
    peso_bruto: nullableNumber(deca.pesoKg, "peso bruto"),
    matricula: nullableText(deca.matriculaVehiculo),
    origen: null,
    destino: nullableText(deca.direccionDestino),
    observaciones: nullableText(deca.notas),
  };

  const { data, error } = await supabase
    .from("decas")
    .insert(payload)
    .select(DECA_COLUMNS)
    .single()
    .returns<DecaRow>();

  if (error) {
    return throwSupabaseError("No se pudo crear el DeCA", error.message);
  }
  return data;
}

export async function updateUserDeca(
  supabaseId: string,
  changes: DecaUpdate,
): Promise<DecaRow> {
  await requireCurrentUserId();

  // Whitelist mutable table columns so user_id and IDs cannot be overridden at runtime.
  const updatePayload: DecaUpdate = {};
  for (const column of UPDATE_COLUMNS) {
    if (Object.hasOwn(changes, column)) {
      Object.assign(updatePayload, { [column]: changes[column] });
    }
  }

  const { data, error } = await supabase
    .from("decas")
    .update({ ...updatePayload, updated_at: new Date().toISOString() })
    .eq("id", supabaseId)
    .select(DECA_COLUMNS)
    .single()
    .returns<DecaRow>();

  if (error) {
    return throwSupabaseError("No se pudo actualizar el DeCA", error.message);
  }
  return data;
}

export async function deleteUserDeca(
  supabaseId: string,
): Promise<{ deleted: boolean }> {
  await requireCurrentUserId();
  const { data, error } = await supabase
    .from("decas")
    .delete()
    .eq("id", supabaseId)
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();

  if (error) {
    return throwSupabaseError("No se pudo eliminar el DeCA", error.message);
  }
  return { deleted: data !== null };
}

export function mapSupabaseDecaToLocal(row: DecaRow): DeCA {
  if (row.estado !== "BORRADOR") {
    throw new Error(
      "No se puede convertir un DeCA EMITIDO: el tipo local DeCA solo admite estado borrador.",
    );
  }

  return {
    id: row.id,
    // La tabla no guarda fecha de transporte; created_at es el único fallback disponible.
    fecha: row.created_at.slice(0, 10),
    cargador: row.cargador ?? "",
    transportista: row.transportista ?? "",
    destinatario: row.destinatario ?? "",
    direccionDestino: row.destino ?? "",
    ciudadDestino: "",
    mercancia: row.mercancia ?? "",
    numeroBultos: row.bultos === null ? undefined : String(row.bultos),
    pesoKg: row.peso_bruto === null ? undefined : String(row.peso_bruto),
    referenciaAlbaran: "",
    matriculaVehiculo: row.matricula ?? "",
    notas: row.observaciones ?? "",
    estado: "borrador",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transportistaNif: row.transportista_nif ?? undefined,
  };
}
