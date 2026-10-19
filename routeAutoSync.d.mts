import type { Delivery } from "./types";
import type { RemoteRoute } from "./rutasSupabaseService";
export interface AutoBase { userId: string; revision: number; fingerprint: string }
export function decideRouteSync(base: { revision: number; fingerprint: string } | null, local: string, remote: { revision: number; fingerprint: string } | null, localEmpty: boolean): "adopt" | "pull" | "push" | "conflict";
export function readAutoBase(uid: string, storage: Pick<Storage, "getItem">): AutoBase | null;
export function writeAutoBase(uid: string, row: RemoteRoute, fingerprint: string, storage: Pick<Storage, "getItem" | "setItem">): void;
export function syncRouteStep(c: {
  userId: string;
  isCurrent: () => boolean;
  isBlocked: () => boolean;
  readBase: () => AutoBase | null;
  getLocal: () => { deliveries: Delivery[]; sequence: string[] };
  fingerprint: (deliveries: Delivery[], sequence: string[]) => string;
  load: () => Promise<RemoteRoute | null>;
  save: (deliveries: Delivery[], sequence: string[], revision: number | null) => Promise<RemoteRoute>;
  backup: () => void;
  apply: (row: RemoteRoute) => boolean;
  accept: (row: RemoteRoute) => void;
}): Promise<{ kind: "paused" | "defer" | "conflict" | "adopt" | "pull" | "push"; row?: RemoteRoute | null }>;
