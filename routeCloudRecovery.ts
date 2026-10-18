export interface ClosureMarker { id: string; fingerprint: string; revision: number }

export function isDefinitiveRevisionConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "40001" && (e.message === "La ruta ha cambiado en otro dispositivo" || e.message === "Conflicto al cerrar la ruta");
}

export function retireClosureMarker(key: string, expected: ClosureMarker, storage: Pick<Storage, "getItem" | "removeItem"> = localStorage): void {
  const raw = storage.getItem(key);
  if (raw === null) return;
  const marker = JSON.parse(raw) as ClosureMarker;
  if (!marker || marker.id !== expected.id || marker.fingerprint !== expected.fingerprint || marker.revision !== expected.revision) throw new Error("El marcador cambió en otra pestaña. No se retira.");
  storage.removeItem(key);
}
