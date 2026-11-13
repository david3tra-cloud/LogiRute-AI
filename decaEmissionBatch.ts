export type DeCAEmissionOutcome =
  | { status: "emitted"; message?: string }
  | { status: "failed"; message: string }
  | { status: "pending"; message: string };

export type DeCAEmissionBatchResult = {
  id: string;
  outcome: DeCAEmissionOutcome;
};

export type DeCADraftSelection = {
  id: string;
  estado: string;
};

export const selectDeCADrafts = <T extends DeCADraftSelection>(
  decas: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] =>
  decas.filter(
    (deca) =>
      selectedIds.has(deca.id) &&
      (deca.estado === "borrador" || deca.estado === "BORRADOR"),
  );

export class DeCAEmissionBatchGate {
  private locked = false;

  get isLocked(): boolean {
    return this.locked;
  }

  tryAcquire(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  release(): void {
    this.locked = false;
  }
}

export const runDeCAEmissionBatch = async (
  ids: readonly string[],
  emitOne: (id: string) => Promise<DeCAEmissionOutcome>,
): Promise<DeCAEmissionBatchResult[]> => {
  const results: DeCAEmissionBatchResult[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      results.push({ id, outcome: await emitOne(id) });
    } catch (error) {
      results.push({
        id,
        outcome: {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Error desconocido durante la emisión.",
        },
      });
    }
  }
  return results;
};
