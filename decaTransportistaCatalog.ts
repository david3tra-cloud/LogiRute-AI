import type { TransportistaHabitual } from "./types";

export const mergeTransportistaCatalog = (
  localItems: TransportistaHabitual[],
  remoteItems: TransportistaHabitual[],
  deletedLocalIds: string[],
  pendingDeleteIds: string[],
  syncEnabled: boolean,
): TransportistaHabitual[] => {
  const deletedIds = new Set(deletedLocalIds);
  const pendingIds = new Set(pendingDeleteIds);
  const merged = new Map(
    remoteItems
      .filter((item) => !pendingIds.has(item.id))
      .map((item) => [item.id, item]),
  );

  for (const item of localItems) {
    if (deletedIds.has(item.id) || pendingIds.has(item.id)) continue;
    const remoteItem = merged.get(item.id);
    if (!remoteItem) {
      merged.set(item.id, item);
      continue;
    }

    const localUpdatedAt = Date.parse(item.updatedAt);
    const remoteUpdatedAt = Date.parse(remoteItem.updatedAt);
    const datesAreComparable =
      Number.isFinite(localUpdatedAt) && Number.isFinite(remoteUpdatedAt);

    if (datesAreComparable && localUpdatedAt !== remoteUpdatedAt) {
      if (localUpdatedAt > remoteUpdatedAt) merged.set(item.id, item);
    } else if (!syncEnabled) {
      merged.set(item.id, item);
    }
  }

  const items = [...merged.values()];
  const defaultId = items.find((item) => item.esPredeterminado)?.id;
  return items.map((item) => ({
    ...item,
    esPredeterminado: item.id === defaultId,
  }));
};
