import type { BillingRecord } from "./billingSupabaseService";
import type { Delivery } from "./types";
export function parseLecturaKm(value: string): number | null;
export function validateLecturasKm(inicial: string, final: string): { ok: true; start: number; end: number; distance: number } | { ok: false; reason: string };
export function pesoKgDeParada(stop: Delivery): number | null;
export function aggregatePesos(records: BillingRecord[]): {
  deliveries: { plannedKg: number; plannedWithWeight: number; plannedMissing: number; completedKg: number; completedWithWeight: number; completedMissing: number };
  pickups: { plannedKg: number; plannedWithWeight: number; plannedMissing: number; completedKg: number; completedWithWeight: number; completedMissing: number };
  missingSnapshots: number;
};
export function aggregateKilometros(records: BillingRecord[]): { km: number; missing: number; total: number };
export function orderedStops(snapshot: Pick<BillingRecord["snapshot"], "deliveries" | "sequence">): Delivery[];
