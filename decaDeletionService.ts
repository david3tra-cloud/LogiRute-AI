import type { DeCA } from "./types";

export type RemoteDecaReference = {
  id: string;
  userId: string;
};

export type DecaDeletionStatus =
  | "confirmed"
  | "in_flight_insert_marked"
  | "unconfirmed"
  | "rejected";

export type DecaDeletionResult = {
  id: string;
  status: DecaDeletionStatus;
  remoteConfirmed?: boolean;
  queueCleaned?: boolean;
  queuedForRetry: boolean;
  errorMessage?: string;
};

export type DecaDeletionDeps = {
  // Operación remota contra Supabase
  deleteRemoteDeca: (id: string) => Promise<{ deleted: boolean }>;

  // Sesión activa real
  getCurrentUserId: () => Promise<string | null>;

  // Búsqueda de referencia remota conocida
  findRemoteReference: (
    id: string,
    userId: string,
  ) => RemoteDecaReference | undefined;

  // Gestión de la cola persistente de bajas pendientes
  readPendingDeletes: () => RemoteDecaReference[];
  enqueuePendingDelete: (reference: RemoteDecaReference) => boolean;
  removePendingDelete: (reference: RemoteDecaReference) => boolean;

  // Detección y marcado de inserciones en vuelo
  isInsertPending: (id: string) => boolean;
  markDeletedPendingInsert: (id: string) => void;
};

// Registro en memoria de operaciones de borrado en curso.
// Claveado por userId + ID para evitar llamadas concurrentes duplicadas.
const activeDeletionPromises = new Map<string, Promise<DecaDeletionResult>>();

/**
 * Consulta la cantidad de bloqueos de borrado activos (para pruebas y diagnóstico).
 */
export function getActiveDeletionLockCount(): number {
  return activeDeletionPromises.size;
}

/**
 * Limpia el registro de bloqueos en memoria (para aislamiento entre pruebas).
 */
export function clearActiveDeletionLocks(): void {
  activeDeletionPromises.clear();
}

/**
 * Intenta la baja remota para una referencia conocida { userId, id }.
 * - Comparte la promesa si ya hay una operación en curso para el mismo userId + id.
 * - Solo deleted === true confirma la baja remota.
 * - Si deleted !== true o hay excepción remota, se conserva en cola para reintento.
 * - Distingue fallos remotos de fallos al retirar la cola local tras confirmar la baja.
 */
export function attemptRemoteDecaDelete(
  reference: RemoteDecaReference,
  deps: DecaDeletionDeps,
): Promise<DecaDeletionResult> {
  const lockKey = `${reference.userId}:${reference.id}`;
  const existing = activeDeletionPromises.get(lockKey);
  if (existing) {
    return existing;
  }

  const run = async (): Promise<DecaDeletionResult> => {
    try {
      // 1. Validar que la sesión activa real coincida con el usuario del documento
      const currentUserId = await deps.getCurrentUserId();
      if (!currentUserId || currentUserId !== reference.userId) {
        return {
          id: reference.id,
          status: "unconfirmed",
          remoteConfirmed: false,
          queuedForRetry: false,
          errorMessage:
            "La sesión activa no coincide con el usuario asignado al documento.",
        };
      }

      // 2. Persistir en la cola local antes de llamar al servidor
      const enqueued = deps.enqueuePendingDelete(reference);
      if (!enqueued) {
        return {
          id: reference.id,
          status: "unconfirmed",
          remoteConfirmed: false,
          queuedForRetry: false,
          errorMessage:
            "No se pudo guardar la baja pendiente en la cola local.",
        };
      }

      // 3. Ejecutar la operación remota
      let remoteRes: { deleted: boolean };
      try {
        remoteRes = await deps.deleteRemoteDeca(reference.id);
      } catch (error) {
        return {
          id: reference.id,
          status: "unconfirmed",
          remoteConfirmed: false,
          queuedForRetry: true,
          errorMessage:
            error instanceof Error ? error.message : "Error remoto desconocido",
        };
      }

      // 4. Solo deleted === true confirma la baja remota
      if (remoteRes.deleted !== true) {
        return {
          id: reference.id,
          status: "unconfirmed",
          remoteConfirmed: false,
          queuedForRetry: true,
          errorMessage: "El servidor no confirmó la baja (deleted no fue true).",
        };
      }

      // 5. Baja remota confirmada: intentar retirar la entrada de la cola local
      let queueCleaned = false;
      try {
        queueCleaned = deps.removePendingDelete(reference);
      } catch {
        queueCleaned = false;
      }

      if (!queueCleaned) {
        // La baja se confirmó en Supabase, pero falló la limpieza local.
        // No se convierte en fallo remoto: se reporta como confirmada con advertencia de cola.
        return {
          id: reference.id,
          status: "confirmed",
          remoteConfirmed: true,
          queueCleaned: false,
          queuedForRetry: true,
          errorMessage:
            "La baja remota fue confirmada, pero no se pudo retirar la entrada de la cola local.",
        };
      }

      return {
        id: reference.id,
        status: "confirmed",
        remoteConfirmed: true,
        queueCleaned: true,
        queuedForRetry: false,
      };
    } finally {
      activeDeletionPromises.delete(lockKey);
    }
  };

  const promise = run();
  activeDeletionPromises.set(lockKey, promise);
  return promise;
}

/**
 * Tramita el borrado de un documento DeCA:
 * - Excluye documentos en estado EMITIENDO.
 * - Si tiene referencia remota, ejecuta la baja remota garantizando cola y bloqueos.
 * - Si es una inserción en vuelo, marca deletedPendingInsertIds para tramitar la baja al completarse.
 * - Si no tiene referencia remota ni inserción en vuelo, no se acepta el borrado para no ocultar documentos indeterminados.
 */
export async function deleteDecaDocument(
  deca: Pick<DeCA, "id"> & { estado?: string },
  deps: DecaDeletionDeps,
): Promise<DecaDeletionResult> {
  // 1. Exclusión obligatoria: documentos en proceso de emisión
  if (deca.estado === "EMITIENDO") {
    return {
      id: deca.id,
      status: "rejected",
      queuedForRetry: false,
      errorMessage: "Documento en proceso de emisión; no se puede eliminar.",
    };
  }

  // 2. Comprobar sesión de usuario activa
  const currentUserId = await deps.getCurrentUserId();
  if (!currentUserId) {
    return {
      id: deca.id,
      status: "rejected",
      queuedForRetry: false,
      errorMessage: "No hay una sesión activa de usuario.",
    };
  }

  // 3. Documento con referencia remota conocida
  const reference = deps.findRemoteReference(deca.id, currentUserId);
  if (reference) {
    return attemptRemoteDecaDelete(reference, deps);
  }

  // 4. Inserción en vuelo
  if (deps.isInsertPending(deca.id)) {
    deps.markDeletedPendingInsert(deca.id);
    return {
      id: deca.id,
      status: "in_flight_insert_marked",
      queuedForRetry: false,
    };
  }

  // 5. Estado indeterminado: la ausencia de referencia no demuestra que sea exclusivamente local
  return {
    id: deca.id,
    status: "rejected",
    queuedForRetry: false,
    errorMessage:
      "No se pudo determinar el estado remoto del documento; se mantiene visible para evitar inconsistencias.",
  };
}

/**
 * Reintenta las bajas pendientes contra Supabase para un usuario dado.
 * Devuelve tanto la lista de IDs confirmados como los resultados detallados.
 */
export async function retryPendingDecaDeletes(
  userId: string,
  deps: DecaDeletionDeps,
): Promise<{ completedIds: string[]; results: DecaDeletionResult[] }> {
  const currentUserId = await deps.getCurrentUserId();
  if (!currentUserId || currentUserId !== userId) {
    return { completedIds: [], results: [] };
  }

  const pending = deps.readPendingDeletes();
  const completedIds: string[] = [];
  const results: DecaDeletionResult[] = [];

  for (const reference of pending) {
    if (reference.userId !== userId) continue;

    const res = await attemptRemoteDecaDelete(reference, deps);
    results.push(res);
    if (res.remoteConfirmed === true) {
      completedIds.push(reference.id);
    }
  }

  return { completedIds, results };
}

/**
 * Procesa la culminación de una inserción en vuelo.
 * Si el documento fue marcado para borrado durante la inserción,
 * se tramita de inmediato la baja remota y se devuelve el resultado.
 */
export async function processCompletedInFlightInsert(
  reference: RemoteDecaReference,
  deletedPendingInsertIds: Set<string>,
  deps: DecaDeletionDeps,
): Promise<{ wasMarkedForDeletion: boolean; deletionResult?: DecaDeletionResult }> {
  if (!deletedPendingInsertIds.delete(reference.id)) {
    return { wasMarkedForDeletion: false };
  }

  const deletionResult = await attemptRemoteDecaDelete(reference, deps);
  return { wasMarkedForDeletion: true, deletionResult };
}

