import type { Database } from "./database.types";
import { getCurrentUserId } from "./decaSupabaseService";
import { supabase } from "./lib/supabase";
import type { TransportistaHabitual } from "./types";

export type TransportistaHabitualRow =
  Database["public"]["Tables"]["transportistas_habituales"]["Row"];
export type TransportistaHabitualInsert =
  Database["public"]["Tables"]["transportistas_habituales"]["Insert"];
export type TransportistaHabitualUpdate =
  Database["public"]["Tables"]["transportistas_habituales"]["Update"];

const COLUMNS =
  "id,user_id,legacy_id,nombre,nif,direccion,ciudad,codigo_postal,provincia,pais,telefono,email,notas,es_predeterminado,created_at,updated_at,deleted_at";
const REMOTE_ROW_PREFIX = "supabase-row:";

const requireUserId = async (): Promise<string> => {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error(
      "Se requiere una sesión iniciada para sincronizar transportistas.",
    );
  }
  return userId;
};

const throwError = (operation: string, message: string): never => {
  throw new Error(`${operation}: ${message}`);
};

export function mapSupabaseTransportistaHabitualToLocal(
  row: TransportistaHabitualRow,
): TransportistaHabitual {
  return {
    id: row.legacy_id ?? `${REMOTE_ROW_PREFIX}${row.id}`,
    nombre: row.nombre,
    nif: row.nif,
    direccion: row.direccion,
    ciudad: row.ciudad,
    codigoPostal: row.codigo_postal,
    provincia: row.provincia,
    pais: row.pais,
    telefono: row.telefono,
    email: row.email,
    notas: row.notas,
    esPredeterminado: row.es_predeterminado,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const toInsert = (
  item: TransportistaHabitual,
  userId: string,
): TransportistaHabitualInsert => {
  if (item.id.startsWith(REMOTE_ROW_PREFIX)) {
    throw new Error(
      "No se puede insertar como local una fila remota sin legacy_id.",
    );
  }
  return {
    user_id: userId,
    legacy_id: item.id,
    nombre: item.nombre,
    nif: item.nif,
    direccion: item.direccion,
    ciudad: item.ciudad,
    codigo_postal: item.codigoPostal,
    provincia: item.provincia,
    pais: item.pais || "España",
    telefono: item.telefono,
    email: item.email,
    notas: item.notas,
    es_predeterminado: item.esPredeterminado,
  };
};

const listRowsForUser = async (
  userId: string,
): Promise<TransportistaHabitualRow[]> => {
  const { data, error } = await supabase
    .from("transportistas_habituales")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    return throwError(
      "No se pudieron cargar los transportistas",
      error.message,
    );
  }
  return data ?? [];
};

const findRowByLocalIdForUser = async (
  userId: string,
  localId: string,
): Promise<TransportistaHabitualRow | null> => {
  const query = supabase
    .from("transportistas_habituales")
    .select(COLUMNS)
    .eq("user_id", userId);
  const { data, error } = localId.startsWith(REMOTE_ROW_PREFIX)
    ? await query
        .eq("id", localId.slice(REMOTE_ROW_PREFIX.length))
        .maybeSingle()
    : await query.eq("legacy_id", localId).maybeSingle();
  if (error) {
    return throwError("No se pudo buscar el transportista", error.message);
  }
  return data;
};

const updateRowForUser = async (
  userId: string,
  id: string,
  changes: TransportistaHabitualUpdate,
): Promise<TransportistaHabitualRow> => {
  const {
    id: _ignoredId,
    user_id: _ignoredUserId,
    legacy_id: _ignoredLegacyId,
    ...mutableChanges
  } = changes;
  void _ignoredId;
  void _ignoredUserId;
  void _ignoredLegacyId;

  const { data, error } = await supabase
    .from("transportistas_habituales")
    .update({ ...mutableChanges, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(COLUMNS)
    .single();
  if (error) {
    return throwError("No se pudo actualizar el transportista", error.message);
  }
  return data;
};

const insertForUser = async (
  userId: string,
  item: TransportistaHabitual,
): Promise<TransportistaHabitualRow | null> => {
  const { data, error } = await supabase
    .from("transportistas_habituales")
    .insert(toInsert(item, userId))
    .select(COLUMNS)
    .single();
  if (!error) return data;

  if (error.code === "23505") {
    const existing = await findRowByLocalIdForUser(userId, item.id);
    if (existing) {
      if (existing.deleted_at !== null) return null;
      return updateRowForUser(userId, existing.id, {
        nombre: item.nombre,
        nif: item.nif,
        direccion: item.direccion,
        ciudad: item.ciudad,
        codigo_postal: item.codigoPostal,
        provincia: item.provincia,
        pais: item.pais || "España",
        telefono: item.telefono,
        email: item.email,
        notas: item.notas,
        es_predeterminado: item.esPredeterminado,
      });
    }
  }
  return throwError("No se pudo crear el transportista", error.message);
};

export async function listUserTransportistasHabituales(): Promise<
  TransportistaHabitualRow[]
> {
  return listRowsForUser(await requireUserId());
}

export async function loadUserTransportistasWithTombstones(): Promise<{
  activeRows: TransportistaHabitualRow[];
  deletedLocalIds: string[];
}> {
  const rows = await listRowsForUser(await requireUserId());
  const deletedRows = rows.filter((row) => row.deleted_at !== null);
  return {
    activeRows: rows.filter((row) => row.deleted_at === null),
    deletedLocalIds: deletedRows.map(
      (row) => row.legacy_id ?? `${REMOTE_ROW_PREFIX}${row.id}`,
    ),
  };
}

export async function insertUserTransportistaHabitual(
  item: TransportistaHabitual,
): Promise<TransportistaHabitualRow> {
  const row = await insertForUser(await requireUserId(), item);
  if (!row) {
    throw new Error("El transportista está eliminado remotamente.");
  }
  return row;
}

export async function updateUserTransportistaHabitual(
  id: string,
  changes: TransportistaHabitualUpdate,
): Promise<TransportistaHabitualRow> {
  return updateRowForUser(await requireUserId(), id, changes);
}

const deleteForUser = async (
  userId: string,
  localId: string,
): Promise<boolean> => {
  const row = await findRowByLocalIdForUser(userId, localId);
  if (!row) return false;
  const { data, error } = await supabase
    .from("transportistas_habituales")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    return throwError("No se pudo eliminar el transportista", error.message);
  }
  if (data) return true;

  const currentRow = await findRowByLocalIdForUser(userId, localId);
  return currentRow !== null && currentRow.deleted_at !== null;
};

export async function deleteUserTransportistaHabitual(
  localId: string,
): Promise<{ deleted: boolean }> {
  return { deleted: await deleteForUser(await requireUserId(), localId) };
}

export type TransportistaDeleteSyncResult = {
  confirmedDeletedLocalIds: string[];
  cancelledLocalIds: string[];
  remoteDeletedLocalIds: string[];
  failedDeletes: { localId: string; error: Error }[];
};

export type TransportistaMigrationResult = TransportistaDeleteSyncResult & {
  items: TransportistaHabitual[];
};

const saveForUser = async (
  userId: string,
  item: TransportistaHabitual,
  rows: TransportistaHabitualRow[],
): Promise<"saved" | "remote-deleted"> => {
  const existing = item.id.startsWith(REMOTE_ROW_PREFIX)
    ? rows.find(
        (row) =>
          row.id === item.id.slice(REMOTE_ROW_PREFIX.length) &&
          row.legacy_id === null,
      )
    : rows.find((row) => row.legacy_id === item.id);

  if (item.id.startsWith(REMOTE_ROW_PREFIX) && !existing) {
    throw new Error("No se encontró la fila remota identificada por su UUID.");
  }
  if (existing && existing.deleted_at !== null) return "remote-deleted";
  if (!existing) {
    const inserted = await insertForUser(userId, item);
    if (!inserted) return "remote-deleted";
    rows.push(inserted);
    return "saved";
  }

  try {
    const updated = await updateRowForUser(userId, existing.id, {
      nombre: item.nombre,
      nif: item.nif,
      direccion: item.direccion,
      ciudad: item.ciudad,
      codigo_postal: item.codigoPostal,
      provincia: item.provincia,
      pais: item.pais || "España",
      telefono: item.telefono,
      email: item.email,
      notas: item.notas,
      es_predeterminado: item.esPredeterminado,
    });
    rows[rows.indexOf(existing)] = updated;
    return "saved";
  } catch (error) {
    const currentRow = await findRowByLocalIdForUser(userId, item.id);
    if (currentRow && currentRow.deleted_at !== null) {
      return "remote-deleted";
    }
    throw error;
  }
};

const syncForUser = async (
  userId: string,
  items: TransportistaHabitual[],
  deletedLocalIds: string[],
  shouldDelete: (localId: string) => boolean,
  initialRows?: TransportistaHabitualRow[],
): Promise<{
  rows: TransportistaHabitualRow[];
  deleteResult: TransportistaDeleteSyncResult;
}> => {
  const rows = initialRows ?? (await listRowsForUser(userId));
  const remoteDeletedIds = new Set(
    rows
      .filter((row) => row.deleted_at !== null)
      .map((row) => row.legacy_id ?? `${REMOTE_ROW_PREFIX}${row.id}`),
  );
  const syncItems = items.filter((item) => !remoteDeletedIds.has(item.id));
  const deleteResult: TransportistaDeleteSyncResult = {
    confirmedDeletedLocalIds: [],
    cancelledLocalIds: [],
    remoteDeletedLocalIds: [...remoteDeletedIds],
    failedDeletes: [],
  };
  const recordRemoteDeleted = (localId: string) => {
    if (remoteDeletedIds.has(localId)) return;
    remoteDeletedIds.add(localId);
    deleteResult.remoteDeletedLocalIds.push(localId);
  };

  const selectedDefault = syncItems.find((item) => item.esPredeterminado);
  const selectedRow = selectedDefault
    ? selectedDefault.id.startsWith(REMOTE_ROW_PREFIX)
      ? rows.find(
          (row) =>
            row.deleted_at === null &&
            row.id === selectedDefault.id.slice(REMOTE_ROW_PREFIX.length) &&
            row.legacy_id === null,
        )
      : rows.find(
          (row) =>
            row.deleted_at === null &&
            row.legacy_id === selectedDefault.id,
        )
    : undefined;

  for (const row of rows) {
    if (
      row.deleted_at === null &&
      row.es_predeterminado &&
      row.id !== selectedRow?.id
    ) {
      const updated = await updateRowForUser(userId, row.id, {
        es_predeterminado: false,
      });
      rows[rows.indexOf(row)] = updated;
    }
  }
  for (const item of syncItems.filter(
    (candidate) => !candidate.esPredeterminado,
  )) {
    const result = await saveForUser(
      userId,
      { ...item, esPredeterminado: false },
      rows,
    );
    if (result === "remote-deleted") recordRemoteDeleted(item.id);
  }
  if (selectedDefault) {
    const result = await saveForUser(
      userId,
      { ...selectedDefault, esPredeterminado: true },
      rows,
    );
    if (result === "remote-deleted") {
      recordRemoteDeleted(selectedDefault.id);
    }
  }

  for (const localId of [...new Set(deletedLocalIds)]) {
    if (!shouldDelete(localId)) {
      deleteResult.cancelledLocalIds.push(localId);
      continue;
    }
    try {
      const deleted = await deleteForUser(userId, localId);
      if (!deleted) continue;
      deleteResult.confirmedDeletedLocalIds.push(localId);
      recordRemoteDeleted(localId);
    } catch (error) {
      deleteResult.failedDeletes.push({
        localId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return { rows, deleteResult };
};

export async function migrateUserTransportistasHabituales(
  localItems: TransportistaHabitual[],
  deletedLocalIds: string[],
  shouldDelete: (localId: string) => boolean,
): Promise<TransportistaMigrationResult> {
  const userId = await requireUserId();
  const rows = await listRowsForUser(userId);
  const deleted = new Set(deletedLocalIds);
  const remoteDeletedIds = new Set(
    rows
      .filter((row) => row.deleted_at !== null)
      .map((row) => row.legacy_id ?? `${REMOTE_ROW_PREFIX}${row.id}`),
  );
  const remoteItems = rows
    .filter((row) => row.deleted_at === null)
    .map(mapSupabaseTransportistaHabitualToLocal)
    .filter(
      (item) =>
        !deleted.has(item.id) &&
        !remoteDeletedIds.has(item.id),
    );
  const merged = new Map(remoteItems.map((item) => [item.id, item]));
  for (const item of localItems) {
    if (!remoteDeletedIds.has(item.id)) merged.set(item.id, item);
  }

  const mergedItems = [...merged.values()];
  const defaultId =
    localItems.find(
      (item) =>
        item.esPredeterminado && !remoteDeletedIds.has(item.id),
    )?.id ??
    remoteItems.find((item) => item.esPredeterminado)?.id;
  const normalized = mergedItems.map((item) => ({
    ...item,
    esPredeterminado: item.id === defaultId,
  }));
  const { rows: savedRows, deleteResult } = await syncForUser(
    userId,
    normalized,
    deletedLocalIds,
    shouldDelete,
    rows,
  );
  for (const id of deleteResult.remoteDeletedLocalIds) {
    remoteDeletedIds.add(id);
  }
  return {
    items: savedRows
      .filter((row) => row.deleted_at === null)
      .map(mapSupabaseTransportistaHabitualToLocal)
      .filter(
        (item) =>
          !deleted.has(item.id) &&
          !remoteDeletedIds.has(item.id),
      ),
    ...deleteResult,
  };
}

export async function syncUserTransportistasHabituales(
  items: TransportistaHabitual[],
  deletedLocalIds: string[],
  shouldDelete: (localId: string) => boolean,
): Promise<TransportistaDeleteSyncResult> {
  const userId = await requireUserId();
  const { deleteResult } = await syncForUser(
    userId,
    items,
    deletedLocalIds,
    shouldDelete,
  );
  return deleteResult;
}
