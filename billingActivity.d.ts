import type { BillingRecord } from "./billingSupabaseService";
export function madridWorkDate(instant: string): string;
export function formatBillingWorkDate(workDate: string): string;
export function aggregateActivity(records: BillingRecord[]): {
  deliveries: { planned: number; completed: number };
  pickups: { planned: number; completed: number };
  complete: boolean;
};
export function aggregateTotalParadas(
  records: readonly {
    snapshot?: { resumen?: { totalStops?: unknown } | null } | null;
  }[],
): { total: number; missing: number; count: number };
