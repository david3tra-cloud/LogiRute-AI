import type { DeCA } from "./types";
import { supabase } from "./lib/supabase";

export type DecaRow = {
  id: string;
  user_id: string;
  deleted_at: string | null;
  estado: "BORRADOR" | "EMITIENDO" | "EMITIDO";
  fecha: string | null;
  cargador: string | null;
  cargador_nif: string | null;
  destinatario: string | null;
  destinatario_nif: string | null;
  transportista: string | null;
  transportista_nif: string | null;
  transportista_direccion: string | null;
  transportista_ciudad: string | null;
  transportista_codigo_postal: string | null;
  transportista_provincia: string | null;
  transportista_pais: string | null;
  transportista_telefono: string | null;
  transportista_email: string | null;
  transportista_notas: string | null;
  mercancia: string | null;
  bultos: number | null;
  peso_bruto: number | null;
  matricula: string | null;
  origen: string | null;
  destino: string | null;
  ciudad_destino: string | null;
  referencia_albaran: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  emitted_at: string | null;
  pdf_path: string | null;
  pdf_public_url: string | null;
  pdf_version: number | null;
  pdf_sha256: string | null;
  emission_request_id: string | null;
  emission_started_at: string | null;
};

type DecaEmissionMetadata =
  | "emitted_at"
  | "pdf_path"
  | "pdf_public_url"
  | "pdf_version"
  | "pdf_sha256"
  | "emission_request_id"
  | "emission_started_at";

export type DecaInsert = Omit<
  DecaRow,
  "id" | "created_at" | "updated_at" | "deleted_at" | DecaEmissionMetadata
> &
  Partial<Pick<DecaRow, DecaEmissionMetadata>>;

export type DecaUpdate = Partial<
  Omit<DecaRow, "id" | "user_id" | "created_at" | "updated_at">
>;

const DECA_COLUMNS =
  "id,user_id,deleted_at,estado,fecha,cargador,cargador_nif,destinatario,destinatario_nif,transportista,transportista_nif,transportista_direccion,transportista_ciudad,transportista_codigo_postal,transportista_provincia,transportista_pais,transportista_telefono,transportista_email,transportista_notas,mercancia,bultos,peso_bruto,matricula,origen,destino,ciudad_destino,referencia_albaran,observaciones,created_at,updated_at,emitted_at,pdf_path,pdf_public_url,pdf_version,pdf_sha256,emission_request_id,emission_started_at";

const UPDATE_COLUMNS = [
  "fecha",
  "cargador",
  "cargador_nif",
  "destinatario",
  "destinatario_nif",
  "transportista",
  "transportista_nif",
  "transportista_direccion",
  "transportista_ciudad",
  "transportista_codigo_postal",
  "transportista_provincia",
  "transportista_pais",
  "transportista_telefono",
  "transportista_email",
  "transportista_notas",
  "mercancia",
  "bultos",
  "peso_bruto",
  "matricula",
  "origen",
  "destino",
  "ciudad_destino",
  "referencia_albaran",
  "observaciones",
] as const satisfies readonly (keyof DecaUpdate)[];

export const mapLocalDecaStatusToSupabase = (
  estado: DeCA["estado"],
): DecaRow["estado"] => (estado === "borrador" ? "BORRADOR" : estado);

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
    estado: mapLocalDecaStatusToSupabase(deca.estado),
    fecha: nullableText(deca.fecha),
    cargador: nullableText(deca.cargador),
    cargador_nif: null,
    destinatario: nullableText(deca.destinatario),
    destinatario_nif: null,
    transportista: nullableText(deca.transportista),
    transportista_nif: nullableText(deca.transportistaNif),
    transportista_direccion: nullableText(deca.transportistaDireccion),
    transportista_ciudad: nullableText(deca.transportistaCiudad),
    transportista_codigo_postal: nullableText(deca.transportistaCodigoPostal),
    transportista_provincia: nullableText(deca.transportistaProvincia),
    transportista_pais: nullableText(deca.transportistaPais),
    transportista_telefono: nullableText(deca.transportistaTelefono),
    transportista_email: nullableText(deca.transportistaEmail),
    transportista_notas: nullableText(deca.transportistaNotas),
    mercancia: nullableText(deca.mercancia),
    bultos: nullableInteger(deca.numeroBultos, "número de bultos"),
    peso_bruto: nullableNumber(deca.pesoKg, "peso bruto"),
    matricula: nullableText(deca.matriculaVehiculo),
    origen: null,
    destino: nullableText(deca.direccionDestino),
    ciudad_destino: nullableText(deca.ciudadDestino),
    referencia_albaran: nullableText(deca.referenciaAlbaran),
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
): Promise<DecaRow | null> {
  const userId = await requireCurrentUserId();

  // Only ordinary form fields may be changed through this path.
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
    .eq("user_id", userId)
    .eq("estado", "BORRADOR")
    .is("deleted_at", null)
    .select(DECA_COLUMNS)
    .maybeSingle()
    .returns<DecaRow>();

  if (error) {
    return throwSupabaseError("No se pudo actualizar el DeCA", error.message);
  }
  return data;
}

export async function reserveUserDecaEmission(
  decaId: string,
): Promise<DecaRow | null> {
  const userId = await requireCurrentUserId();
  const randomUUID = globalThis.crypto?.randomUUID;
  if (!randomUUID) {
    throw new Error(
      "Este navegador no permite generar un identificador seguro para reservar la emisión.",
    );
  }

  const { data, error } = await supabase
    .from("decas")
    .update({
      estado: "EMITIENDO",
      emission_request_id: randomUUID.call(globalThis.crypto),
      emission_started_at: new Date().toISOString(),
    })
    .eq("id", decaId)
    .eq("user_id", userId)
    .eq("estado", "BORRADOR")
    .is("deleted_at", null)
    .select(DECA_COLUMNS)
    .maybeSingle()
    .returns<DecaRow>();

  if (error) {
    return throwSupabaseError(
      "No se pudo reservar la emisión del DeCA",
      error.message,
    );
  }
  return data;
}

export async function deleteUserDeca(
  supabaseId: string,
): Promise<{ deleted: boolean }> {
  await requireCurrentUserId();
  const { data, error } = await supabase.rpc("soft_delete_deca", {
    p_deca_id: supabaseId,
  });

  if (error) {
    return throwSupabaseError("No se pudo eliminar el DeCA", error.message);
  }
  return { deleted: data === true };
}

export function mapSupabaseDecaToLocal(row: DecaRow): DeCA {
  return {
    id: row.id,
    fecha: row.fecha ?? row.created_at.slice(0, 10),
    cargador: row.cargador ?? "",
    transportista: row.transportista ?? "",
    destinatario: row.destinatario ?? "",
    direccionDestino: row.destino ?? "",
    ciudadDestino: row.ciudad_destino ?? "",
    mercancia: row.mercancia ?? "",
    numeroBultos: row.bultos === null ? undefined : String(row.bultos),
    pesoKg: row.peso_bruto === null ? undefined : String(row.peso_bruto),
    referenciaAlbaran: row.referencia_albaran ?? "",
    matriculaVehiculo: row.matricula ?? "",
    notas: row.observaciones ?? "",
    estado: row.estado === "BORRADOR" ? "borrador" : row.estado,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    emittedAt: row.emitted_at ?? undefined,
    pdfPath: row.pdf_path ?? undefined,
    pdfPublicUrl: row.pdf_public_url ?? undefined,
    pdfVersion: row.pdf_version ?? undefined,
    pdfSha256: row.pdf_sha256 ?? undefined,
    emissionRequestId: row.emission_request_id ?? undefined,
    emissionStartedAt: row.emission_started_at ?? undefined,
    transportistaNif: row.transportista_nif ?? undefined,
    transportistaDireccion: row.transportista_direccion ?? undefined,
    transportistaCiudad: row.transportista_ciudad ?? undefined,
    transportistaCodigoPostal: row.transportista_codigo_postal ?? undefined,
    transportistaProvincia: row.transportista_provincia ?? undefined,
    transportistaPais: row.transportista_pais ?? undefined,
    transportistaTelefono: row.transportista_telefono ?? undefined,
    transportistaEmail: row.transportista_email ?? undefined,
    transportistaNotas: row.transportista_notas ?? undefined,
  };
}
