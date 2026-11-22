import type { AddDeCAToRoutesResult, DeCA } from "./types";

export type DeCABulkRouteAddItemResult =
  | AddDeCAToRoutesResult
  | { status: "failed"; message: string };

export interface DeCABulkRouteAddSummary {
  addedIds: string[];
  addedWithoutCoordinatesIds: string[];
  omittedIds: string[];
  errors: Array<{ id: string; message: string }>;
}

export class DeCABulkRouteAddGate {
  private locked = false;

  get isLocked() {
    return this.locked;
  }

  tryAcquire() {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  release() {
    this.locked = false;
  }
}

export const selectEligibleDeCAsForRoutes = (
  decas: DeCA[],
  selectedIds: Set<string>,
  isDeCAInRoutes: (decaId: string) => boolean,
) =>
  decas.filter(
    (deca) =>
      selectedIds.has(deca.id) &&
      deca.estado === "EMITIDO" &&
      !isDeCAInRoutes(deca.id),
  );

export const getDeCAIdsToRetry = (summary: DeCABulkRouteAddSummary) =>
  new Set(summary.errors.map(({ id }) => id));

export const runDeCABulkAddToRoutes = async (
  decas: DeCA[],
  addToRoutes: (deca: DeCA) => Promise<DeCABulkRouteAddItemResult>,
  gate: DeCABulkRouteAddGate,
): Promise<DeCABulkRouteAddSummary | null> => {
  if (!gate.tryAcquire()) return null;

  const summary: DeCABulkRouteAddSummary = {
    addedIds: [],
    addedWithoutCoordinatesIds: [],
    omittedIds: [],
    errors: [],
  };

  try {
    for (const deca of decas) {
      try {
        const result = await addToRoutes(deca);
        switch (result.status) {
          case "added":
            summary.addedIds.push(deca.id);
            if (!result.coordinatesAvailable) {
              summary.addedWithoutCoordinatesIds.push(deca.id);
            }
            break;
          case "already-in-routes":
          case "in-progress":
            summary.omittedIds.push(deca.id);
            break;
          case "failed":
            summary.errors.push({ id: deca.id, message: result.message });
            break;
        }
      } catch (error) {
        summary.errors.push({
          id: deca.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  } finally {
    gate.release();
  }
};
