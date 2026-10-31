import { Delivery, DeliveryStatus, DeliveryType } from "./types";
import { userStorageKey } from "./destinatariosService";

export interface RouteSnapshot {
  userId: string;
  deliveries: Delivery[];
  sequence: string[];
  kilometrajeInicial?: string;
  kilometrajeFinal?: string;
  kilometrajeAsociacionPendiente?: boolean;
}
const keyFor = (userId: string) => userStorageKey("logiroute_route_snapshot_v1", userId);

function validate(value: unknown, userId: string): RouteSnapshot {
  const item = value as RouteSnapshot;
  if (!item || item.userId !== userId || !Array.isArray(item.deliveries) || !Array.isArray(item.sequence)) throw new Error("Copia local de ruta inválida. Se conserva sin sobrescribir.");
  if ((item.kilometrajeInicial !== undefined && typeof item.kilometrajeInicial !== "string") ||
      (item.kilometrajeFinal !== undefined && typeof item.kilometrajeFinal !== "string") ||
      (item.kilometrajeAsociacionPendiente !== undefined && typeof item.kilometrajeAsociacionPendiente !== "boolean")) {
    throw new Error("Lecturas locales de kilometraje inválidas. Se conserva la copia sin sobrescribir.");
  }
  const ids = new Set<string>();
  for (const d of item.deliveries) {
    if (!d || typeof d.id !== "string" || !d.id || ids.has(d.id) || typeof d.recipient !== "string" || typeof d.address !== "string" || !Object.values(DeliveryStatus).includes(d.status) || !Object.values(DeliveryType).includes(d.type)) throw new Error("Paradas locales inválidas. No se sobrescriben.");
    ids.add(d.id);
  }
  if (new Set(item.sequence).size !== item.sequence.length || item.sequence.some(id => typeof id !== "string" || !ids.has(id))) throw new Error("Orden local incompatible con las paradas. Se requiere revisión.");
  return item;
}

export function loadRouteSnapshot(userId: string, legacy: () => { deliveries: Delivery[]; sequence: string[] }): RouteSnapshot {
  if (!userId) throw new Error("Usuario no disponible.");
  const raw = localStorage.getItem(keyFor(userId));
  if (raw !== null) return validate(JSON.parse(raw), userId);
  return validate({ userId, ...legacy() }, userId);
}

export function saveRouteSnapshot(
  userId: string,
  deliveries: Delivery[],
  sequence: string[],
  odometer?: Pick<RouteSnapshot, "kilometrajeInicial" | "kilometrajeFinal" | "kilometrajeAsociacionPendiente">,
): boolean {
  if (!userId) return false;
  try {
    const previousRaw = localStorage.getItem(keyFor(userId));
    const previous = previousRaw === null ? undefined : validate(JSON.parse(previousRaw), userId);
    const snapshot = validate({
      userId,
      deliveries,
      sequence,
      kilometrajeInicial: odometer?.kilometrajeInicial ?? previous?.kilometrajeInicial ?? "",
      kilometrajeFinal: odometer?.kilometrajeFinal ?? previous?.kilometrajeFinal ?? "",
      kilometrajeAsociacionPendiente: odometer?.kilometrajeAsociacionPendiente ?? previous?.kilometrajeAsociacionPendiente ?? false,
    }, userId);
    localStorage.setItem(keyFor(userId), JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}
