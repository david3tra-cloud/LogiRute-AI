// routeService.ts
import { Delivery, DeliveryStatus } from "./types";

type Point = { lat: number; lng: number };

function distance(p1: Point, p2: Point): number {
  const dLat = p1.lat - p2.lat;
  const dLng = p1.lng - p2.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function optimizeDeliveries(
  deliveries: Delivery[],
  start: Point
): Delivery[] {
  const active = deliveries.filter(
    (d) =>
      d.status === DeliveryStatus.PENDING ||
      d.status === DeliveryStatus.IN_PROGRESS
  );
  const completed = deliveries.filter(
    (d) =>
      d.status === DeliveryStatus.COMPLETED ||
      d.status === DeliveryStatus.ISSUE
  );

  const remaining = [...active];
  const result: Delivery[] = [];
  let current = start;
  let seq = 1;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = remaining[i];
      const [lat, lng] = d.coordinates;
      const dist = distance(current, { lat, lng });
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }

    const next = remaining.splice(bestIndex, 1)[0];
    result.push({ ...next, sequence: seq });
    current = { lat: next.coordinates[0], lng: next.coordinates[1] };
    seq++;
  }

  return [...result, ...completed];
}