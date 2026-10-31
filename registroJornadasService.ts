import {
  Delivery,
  DeliveryStatus,
  DeliveryType,
  JornadaRegistro,
  JornadaRegistroResumen,
  JornadaCierreResult,
  PendingClosureMarker,
} from "./types";
import { userStorageKey } from "./destinatariosService";

export const REGISTRO_JORNADAS_STORAGE_KEY = "logiroute_registro_jornadas_v1";
export const PENDING_CLOSURE_STORAGE_KEY = "logiroute_pending_closure_v1";
export const DELETED_JORNADAS_STORAGE_KEY = "logiroute_deleted_jornadas_v1";

export const getRegistroStorageKey = (userId?: string): string =>
  userStorageKey(REGISTRO_JORNADAS_STORAGE_KEY, userId);

export const getPendingClosureStorageKey = (userId?: string): string =>
  userStorageKey(PENDING_CLOSURE_STORAGE_KEY, userId);

export const getDeletedJornadasStorageKey = (userId?: string): string =>
  userStorageKey(DELETED_JORNADAS_STORAGE_KEY, userId);

export const safeGetItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const computeRouteFingerprint = (
  deliveries: Delivery[],
  sequence: string[],
): string => {
  const sortedDeliveries = [...deliveries].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const items = sortedDeliveries.map((d) => [
    d.id,
    d.status,
    d.type,
    d.address ?? "",
    d.recipient ?? "",
    d.notes ?? "",
    d.decaId ?? "",
    d.concept ?? "",
    d.phone ?? "",
    d.estimatedTime ?? "",
    d.sourceUrl ?? "",
    d.coordinates ? `${d.coordinates[0]},${d.coordinates[1]}` : "",
  ]);
  return JSON.stringify({
    items,
    seq: sequence,
  });
};

export const generateStableId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `jornada_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

export const isPendingClosureMarker = (
  value: unknown,
): value is PendingClosureMarker => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.fingerprint === "string" &&
    typeof candidate.createdAt === "string" &&
    (candidate.status === "ARCHIVING" ||
      candidate.status === "CLEARING_ROUTE" ||
      candidate.status === "COMPLETED")
  );
};

export const loadPendingClosureMarker = (
  userId?: string,
): PendingClosureMarker | null => {
  if (!userId) return null;
  const raw = safeGetItem(getPendingClosureStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isPendingClosureMarker(parsed) && parsed.userId === userId
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export const savePendingClosureMarker = (
  marker: PendingClosureMarker,
): boolean => {
  try {
    localStorage.setItem(
      getPendingClosureStorageKey(marker.userId),
      JSON.stringify(marker),
    );
    return true;
  } catch {
    return false;
  }
};

export const removePendingClosureMarker = (userId: string): boolean => {
  try {
    localStorage.removeItem(getPendingClosureStorageKey(userId));
    return true;
  } catch {
    return false;
  }
};

export const isJornadaRegistro = (item: unknown): item is JornadaRegistro => {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.fingerprint === "string" &&
    typeof candidate.fechaCierre === "string" &&
    candidate.resumen !== null &&
    typeof candidate.resumen === "object" &&
    Array.isArray(candidate.deliveries) &&
    Array.isArray(candidate.sequence) &&
    (!Object.hasOwn(candidate, "deletedAt") ||
      candidate.deletedAt === null ||
      typeof candidate.deletedAt === "string")
  );
};

export const calculateJornadaResumen = (
  deliveries: Delivery[],
): JornadaRegistroResumen => {
  return {
    totalStops: deliveries.length,
    completedStops: deliveries.filter(
      (d) => d.status === DeliveryStatus.COMPLETED,
    ).length,
    issueStops: deliveries.filter((d) => d.status === DeliveryStatus.ISSUE)
      .length,
    pendingStops: deliveries.filter(
      (d) =>
        d.status === DeliveryStatus.PENDING ||
        d.status === DeliveryStatus.IN_PROGRESS,
    ).length,
    deliveriesCount: deliveries.filter(
      (d) => d.type === DeliveryType.DELIVERY,
    ).length,
    pickupsCount: deliveries.filter(
      (d) => d.type === DeliveryType.PICKUP,
    ).length,
  };
};

export type RegistroLoadResult = {
  items: JornadaRegistro[];
  corrupted: boolean;
};

export const loadRegistroJornadasWithStatus = (
  userId?: string,
): RegistroLoadResult => {
  if (!userId) return { items: [], corrupted: false };
  const raw = safeGetItem(getRegistroStorageKey(userId));
  if (!raw) return { items: [], corrupted: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { items: [], corrupted: true };
    }
    const validItems: JornadaRegistro[] = [];
    for (const item of parsed) {
      if (isJornadaRegistro(item) && item.userId === userId) {
        validItems.push(item);
      } else {
        return { items: [], corrupted: true };
      }
    }
    return { items: validItems, corrupted: false };
  } catch {
    return { items: [], corrupted: true };
  }
};

export const loadRegistroJornadasForUser = (
  userId?: string,
): JornadaRegistro[] => {
  return loadRegistroJornadasWithStatus(userId).items;
};

export const loadDeletedJornadaIdsForUser = (userId?: string): string[] => {
  if (!userId) return [];
  const raw = safeGetItem(getDeletedJornadasStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string")
      ? [...new Set(parsed)]
      : [];
  } catch {
    return [];
  }
};

export const rememberDeletedJornadaForUser = (
  userId: string,
  jornadaId: string,
): boolean => {
  if (!userId || !jornadaId) return false;
  try {
    const ids = new Set(loadDeletedJornadaIdsForUser(userId));
    ids.add(jornadaId);
    localStorage.setItem(
      getDeletedJornadasStorageKey(userId),
      JSON.stringify([...ids]),
    );
    return true;
  } catch {
    return false;
  }
};

export const removeJornadaFromLocalForUser = (
  userId: string,
  jornadaId: string,
): boolean => {
  if (!userId || !jornadaId) return false;
  const loaded = loadRegistroJornadasWithStatus(userId);
  if (loaded.corrupted) return false;
  const remaining = loaded.items.filter((item) => item.id !== jornadaId);
  if (remaining.length === loaded.items.length) return true;
  try {
    localStorage.setItem(getRegistroStorageKey(userId), JSON.stringify(remaining));
    return true;
  } catch {
    return false;
  }
};

export type ArchiveResult =
  | { ok: true; jornada: JornadaRegistro; isDuplicate: boolean; error?: undefined }
  | { ok: false; error: string; jornada?: undefined; isDuplicate?: undefined };

export const archiveJornadaForUser = (
  userId: string,
  deliveries: Delivery[],
  sequence: string[],
  stableJornadaId: string,
): ArchiveResult => {
  if (!userId) {
    return { ok: false, error: "Usuario no autenticado." };
  }
  if (deliveries.length === 0) {
    return {
      ok: false,
      error: "La ruta está vacía; no hay datos para archivar.",
    };
  }

  const existingLoad = loadRegistroJornadasWithStatus(userId);
  if (existingLoad.corrupted) {
    return {
      ok: false,
      error:
        "El Registro local contiene datos corruptos. Se ha cancelado la operación para evitar sobrescribir información.",
    };
  }

  // Deduplicación estricta por ID estable de jornada del marcador pendiente,
  // NUNCA deduplicar contra jornadas históricas pasadas por huella.
  const existingMatch = existingLoad.items.find(
    (item) => item.userId === userId && item.id === stableJornadaId,
  );
  if (existingMatch) {
    return { ok: true, jornada: existingMatch, isDuplicate: true };
  }

  const fingerprint = computeRouteFingerprint(deliveries, sequence);

  const jornada: JornadaRegistro = {
    id: stableJornadaId,
    userId,
    fingerprint,
    fechaCierre: new Date().toISOString(),
    resumen: calculateJornadaResumen(deliveries),
    deliveries: JSON.parse(JSON.stringify(deliveries)),
    sequence: [...sequence],
  };

  const updatedList = [jornada, ...existingLoad.items];

  try {
    localStorage.setItem(
      getRegistroStorageKey(userId),
      JSON.stringify(updatedList),
    );
    return { ok: true, jornada, isDuplicate: false };
  } catch (error) {
    return {
      ok: false,
      error: `Error al escribir en almacenamiento local: ${error instanceof Error ? error.message : "espacio insuficiente o fallo de guardado"}`,
    };
  }
};

export const executeCerrarJornada = async (params: {
  user: { id: string } | null;
  hydratedUserId: string | null;
  deliveries: Delivery[];
  manualSequence: string[];
  persistRouteFn: (
    userId: string,
    deliveries: Delivery[],
    sequence: string[],
  ) => { ok: boolean; rollbackOk?: boolean } | boolean;
  onRouteCleared: () => void;
  confirmPendingFn?: (pendingCount: number) => Promise<boolean> | boolean;
  confirmFinishFn?: (totalCount: number) => Promise<boolean> | boolean;
}): Promise<JornadaCierreResult> => {
  const {
    user,
    hydratedUserId,
    deliveries,
    manualSequence,
    persistRouteFn,
    onRouteCleared,
    confirmPendingFn,
    confirmFinishFn,
  } = params;

  if (!user?.id || hydratedUserId !== user.id) {
    return {
      status: "SESSION_MISMATCH",
      error:
        "No se puede cerrar la jornada: la sesión no está lista o pertenece a otro usuario.",
    };
  }

  const existingMarker = loadPendingClosureMarker(user.id);
  const hasActiveMarker = existingMarker && existingMarker.status !== "COMPLETED";

  // Caso: ruta activa vacía
  if (deliveries.length === 0) {
    if (!hasActiveMarker) {
      return { status: "EMPTY_ROUTE" };
    }

    // Recuperación de cierre incompleto tras recarga con deliveries vacío pero secuencia o marcador pendientes
    const existingLoad = loadRegistroJornadasWithStatus(user.id);
    const archivedJornada = existingLoad.items.find(
      (j) => j.id === existingMarker.id,
    );
    if (!archivedJornada) {
      return {
        status: "CLOSURE_CONFLICT",
        error:
          "Existe un marcador de cierre pendiente pero no se encuentra la jornada en el Registro. No se puede continuar sin verificar los datos.",
      };
    }

    // Intentar vaciar el almacenamiento de la ruta
    const clearResult = persistRouteFn(user.id, [], []);
    const clearOk =
      typeof clearResult === "boolean" ? clearResult : clearResult.ok;

    if (!clearOk) {
      return {
        status: "PARTIAL_SUCCESS",
        jornada: archivedJornada,
        error:
          "Se detectó un cierre pendiente previo, pero falló el vaciado de la secuencia en almacenamiento local. Puedes reintentar.",
      };
    }

    // Eliminar el marcador o pasarlo a COMPLETED si falla el borrado
    const markerRemoved = removePendingClosureMarker(user.id);
    if (!markerRemoved) {
      savePendingClosureMarker({
        ...existingMarker,
        status: "COMPLETED",
      });
    }

    onRouteCleared();
    return {
      status: "RECOVERY_COMPLETED",
      jornada: archivedJornada,
    };
  }

  const currentFingerprint = computeRouteFingerprint(
    deliveries,
    manualSequence,
  );

  let targetJornadaId: string;

  if (hasActiveMarker) {
    // Verificar que el contenido coincide
    if (existingMarker.fingerprint !== currentFingerprint) {
      return {
        status: "CLOSURE_CONFLICT",
        error:
          "Existe un cierre pendiente previo cuyo contenido no coincide con la ruta actual. No se vacían ni modifican los datos para evitar pérdida de información.",
      };
    }
    // Reintento: usar el mismo jornadaId estable
    targetJornadaId = existingMarker.id;
  } else {
    // Jornada nueva: confirmar antes de cualquier mutación
    const pendingCount = deliveries.filter(
      (d) =>
        d.status === DeliveryStatus.PENDING ||
        d.status === DeliveryStatus.IN_PROGRESS,
    ).length;

    if (pendingCount > 0) {
      const defaultPendingConfirm = () =>
        window.confirm(
          `Tienes ${pendingCount} ${pendingCount === 1 ? "parada pendiente" : "paradas pendientes"}. ¿Deseas cerrar la jornada de todos modos? Se guardarán en el registro con su estado actual.`,
        );
      const confirmed = confirmPendingFn
        ? await confirmPendingFn(pendingCount)
        : defaultPendingConfirm();
      if (!confirmed) {
        return { status: "CANCELLED" };
      }
    } else {
      const defaultFinishConfirm = () =>
        window.confirm(
          `¿Cerrar jornada con ${deliveries.length} ${deliveries.length === 1 ? "parada completada" : "paradas completadas"}? Se archivará en el Registro y se vaciará la ruta activa.`,
        );
      const confirmed = confirmFinishFn
        ? await confirmFinishFn(deliveries.length)
        : defaultFinishConfirm();
      if (!confirmed) {
        return { status: "CANCELLED" };
      }
    }

    // Re-validación de sesión inmediatamente antes de persistir
    if (!user?.id || hydratedUserId !== user.id) {
      return {
        status: "SESSION_MISMATCH",
        error: "La sesión del usuario cambió durante la confirmación.",
      };
    }

    targetJornadaId = generateStableId();

    const newMarker: PendingClosureMarker = {
      id: targetJornadaId,
      userId: user.id,
      fingerprint: currentFingerprint,
      createdAt: new Date().toISOString(),
      status: "ARCHIVING",
    };

    // 1. Persistir el marcador ANTES de archivar; si falla, no vaciar la ruta
    const markerSaved = savePendingClosureMarker(newMarker);
    if (!markerSaved) {
      return {
        status: "ARCHIVE_FAILED",
        error:
          "No se pudo registrar el marcador de cierre pendiente en el almacenamiento local. La ruta se conserva intacta.",
      };
    }
  }

  // 2. Archivar en Registro (asociado al targetJornadaId estable del marcador)
  const archiveResult = archiveJornadaForUser(
    user.id,
    deliveries,
    manualSequence,
    targetJornadaId,
  );
  if (!archiveResult.ok) {
    return {
      status: "ARCHIVE_FAILED",
      error: archiveResult.error,
    };
  }

  // Actualizar marcador a CLEARING_ROUTE
  savePendingClosureMarker({
    id: targetJornadaId,
    userId: user.id,
    fingerprint: currentFingerprint,
    createdAt: new Date().toISOString(),
    status: "CLEARING_ROUTE",
  });

  // 3. Vaciar la ruta activa en storage
  const clearResult = persistRouteFn(user.id, [], []);
  const clearOk =
    typeof clearResult === "boolean" ? clearResult : clearResult.ok;
  const rollbackOk =
    typeof clearResult === "boolean" ? true : (clearResult.rollbackOk ?? true);

  if (!clearOk) {
    if (rollbackOk) {
      return {
        status: "PARTIAL_SUCCESS",
        jornada: archiveResult.jornada,
        error:
          "La jornada se ha guardado en el Registro, pero no se pudo vaciar la ruta activa en este navegador. La ruta sigue visible para que no pierdas información; puedes reintentar cerrar la jornada.",
      };
    }
    return {
      status: "PARTIAL_SUCCESS",
      jornada: archiveResult.jornada,
      error:
        "La jornada se ha guardado en el Registro, pero el vaciado de la ruta falló y no se pudo restaurar la copia anterior. Al recargar, el sistema detectará el cierre pendiente para completarlo sin duplicar la jornada.",
    };
  }

  // 4. Retirar el marcador una vez confirmado el vaciado completo
  const markerRemoved = removePendingClosureMarker(user.id);
  if (!markerRemoved) {
    // Si la eliminación falla, registrar estado COMPLETED para distinguir que ya concluyó
    savePendingClosureMarker({
      id: targetJornadaId,
      userId: user.id,
      fingerprint: currentFingerprint,
      createdAt: new Date().toISOString(),
      status: "COMPLETED",
    });
  }

  // 5. Notificar vaciado en memoria / estado React
  onRouteCleared();

  return {
    status: "SUCCESS",
    jornada: archiveResult.jornada,
  };
};
