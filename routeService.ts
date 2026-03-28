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
  // 1) Separar por estado
  const active = deliveries.filter(
    (d) =>
      (d.status === DeliveryStatus.PENDING ||
        d.status === DeliveryStatus.IN_PROGRESS)
  );

  const completed = deliveries.filter(
    (d) =>
      d.status === DeliveryStatus.COMPLETED ||
      d.status === DeliveryStatus.ISSUE
  );

  // 2) De las activas, separar las que tienen coordenadas válidas
  const withCoords: Delivery[] = [];
  const withoutCoords: Delivery[] = [];

  for (const d of active) {
    if (
      Array.isArray(d.coordinates) &&
      typeof d.coordinates[0] === "number" &&
      typeof d.coordinates[1] === "number"
    ) {
      withCoords.push(d);
    } else {
      withoutCoords.push(d);
    }
  }

  // 3) Nearest Neighbor solo para las que tienen coords
  const remaining = [...withCoords];
  const optimized: Delivery[] = [];
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
    optimized.push({ ...next, sequence: seq });
    current = { lat: next.coordinates[0], lng: next.coordinates[1] };
    seq++;
  }

  // 4) A las que no tienen coords les asignamos secuencia detrás, manteniendo su orden original
  const withoutCoordsWithSeq = withoutCoords.map((d) => ({
    ...d,
    sequence: seq++,
  }));

  // 5) Las completadas e incidencias se devuelven al final tal cual
  return [...optimized, ...withoutCoordsWithSeq, ...completed];
}