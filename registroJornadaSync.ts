import type { JornadaRegistro } from "./types";

export type JornadaMergeResult = {
  items: JornadaRegistro[];
  remoteIds: Set<string>;
  deletedIds: Set<string>;
  conflicts: number;
};

export const isDeletedJornada = (
  jornada: Pick<JornadaRegistro, "deletedAt"> | null | undefined,
): boolean => Boolean(jornada?.deletedAt);

export const isDeletedClosureDuplicate = (
  jornada: {
    id?: unknown;
    userId?: unknown;
    fingerprint?: unknown;
    deletedAt?: unknown;
  } | null | undefined,
  expected: { id: string; userId: string; fingerprint: string },
): boolean =>
  typeof jornada?.deletedAt === "string" &&
  jornada.id === expected.id &&
  jornada.userId === expected.userId &&
  jornada.fingerprint === expected.fingerprint;

export const mergeJornadaSnapshots = (
  local: JornadaRegistro[],
  remote: JornadaRegistro[],
  rememberedDeletedIds: readonly string[] = [],
): JornadaMergeResult => {
  const deletedIds = new Set(rememberedDeletedIds);
  for (const jornada of remote) {
    if (isDeletedJornada(jornada)) deletedIds.add(jornada.id);
  }

  const activeRemote = remote.filter(
    (jornada) => !isDeletedJornada(jornada) && !deletedIds.has(jornada.id),
  );
  const merged = new Map<string, JornadaRegistro>();
  for (const jornada of local) {
    if (!deletedIds.has(jornada.id) && !isDeletedJornada(jornada)) {
      merged.set(jornada.id, jornada);
    }
  }

  let conflicts = 0;
  for (const jornada of activeRemote) {
    const previous = merged.get(jornada.id);
    if (previous && previous.fingerprint !== jornada.fingerprint) conflicts += 1;
    merged.set(jornada.id, jornada);
  }

  return {
    items: [...merged.values()].sort(
      (left, right) => Date.parse(right.fechaCierre) - Date.parse(left.fechaCierre),
    ),
    remoteIds: new Set(activeRemote.map((jornada) => jornada.id)),
    deletedIds,
    conflicts,
  };
};

export type JornadaDeletionMarker = {
  id: string;
  deletedAt: string;
};

export type JornadaDeletionResult =
  | {
      kind: "deleted";
      marker: JornadaDeletionMarker;
      tombstoneCached: boolean;
      localCopyRemoved: boolean;
    }
  | { kind: "stale" };

export const executeJornadaDeletion = async (args: {
  userId: string;
  jornadaId: string;
  deleteRemote: (userId: string, jornadaId: string) => Promise<JornadaDeletionMarker>;
  isCurrent: () => boolean;
  rememberTombstone: (userId: string, jornadaId: string) => boolean;
  removeLocalCopy: (userId: string, jornadaId: string) => boolean;
}): Promise<JornadaDeletionResult> => {
  const marker = await args.deleteRemote(args.userId, args.jornadaId);
  if (!args.isCurrent()) return { kind: "stale" };
  if (marker.id !== args.jornadaId || !marker.deletedAt) {
    throw new Error("El servidor no confirmó la marca de eliminación esperada.");
  }

  const tombstoneCached = args.rememberTombstone(args.userId, args.jornadaId);
  const localCopyRemoved = args.removeLocalCopy(args.userId, args.jornadaId);
  return { kind: "deleted", marker, tombstoneCached, localCopyRemoved };
};

export const executeLocalJornadaDeletion = async (args: {
  userId: string;
  jornada: Pick<JornadaRegistro, "id" | "userId">;
  isCurrent: () => boolean;
  operationLocks: Set<string>;
  removeLocalCopy: (userId: string, jornadaId: string) => boolean;
}): Promise<{ kind: "deleted" } | { kind: "stale" } | { kind: "duplicate" }> => {
  const operationKey = `${args.userId}:${args.jornada.id}`;
  if (args.operationLocks.has(operationKey)) return { kind: "duplicate" };
  if (!args.userId || args.jornada.userId !== args.userId || !args.jornada.id) {
    throw new Error("La jornada no pertenece al usuario actual.");
  }
  args.operationLocks.add(operationKey);
  try {
    if (!args.isCurrent()) return { kind: "stale" };
    await Promise.resolve();
    if (!args.isCurrent()) return { kind: "stale" };
    if (!args.removeLocalCopy(args.userId, args.jornada.id)) {
      throw new Error("No se pudo eliminar la copia local de la jornada.");
    }
    return { kind: "deleted" };
  } finally {
    args.operationLocks.delete(operationKey);
  }
};
