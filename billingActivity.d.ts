import type { BillingRecord } from "./billingSupabaseService";
export function madridWorkDate(instant: string): string;
export function aggregateActivity(records: BillingRecord[]): {
  deliveries: { planned: number; completed: number };
  pickups: { planned: number; completed: number };
  complete: boolean;
};
