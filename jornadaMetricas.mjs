const DECIMAL_INPUT = /^\d+(?:[.,]\d+)?$/;

export function parseLecturaKm(value) {
  const text = String(value ?? "").trim();
  if (!text || !DECIMAL_INPUT.test(text)) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function validateLecturasKm(inicial, final) {
  if (!String(inicial ?? "").trim() || !String(final ?? "").trim()) {
    return { ok: false, reason: "Introduce las lecturas inicial y final del cuentakilómetros." };
  }
  const start = parseLecturaKm(inicial);
  const end = parseLecturaKm(final);
  if (start === null || end === null) {
    return { ok: false, reason: "Las lecturas deben ser números válidos, iguales o superiores a cero." };
  }
  if (end < start) {
    return { ok: false, reason: "El kilometraje final no puede ser inferior al inicial." };
  }
  return { ok: true, start, end, distance: end - start };
}

export function pesoKgDeParada(stop) {
  if (typeof stop?.pesoKg === "number") {
    return Number.isFinite(stop.pesoKg) && stop.pesoKg >= 0 ? stop.pesoKg : null;
  }
  // Only parse the exact application-generated DeCA label; never arbitrary numbers.
  if (stop?.pesoKg !== undefined || stop?.sourceType !== "DECA" || !stop?.decaId || typeof stop?.notes !== "string") return null;
  const labels = stop.notes.match(/Peso:/g) ?? [];
  const matches = [...stop.notes.matchAll(/(?:^| · )Peso:\s*(\d+(?:[.,]\d+)?)\s*kg(?= · |$)/g)];
  if (labels.length !== 1 || matches.length !== 1) return null;
  const value = Number(matches[0][1].replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function aggregatePesos(records) {
  const result = {
    deliveries: { plannedKg: 0, plannedWithWeight: 0, plannedMissing: 0, completedKg: 0, completedWithWeight: 0, completedMissing: 0 },
    pickups: { plannedKg: 0, plannedWithWeight: 0, plannedMissing: 0, completedKg: 0, completedWithWeight: 0, completedMissing: 0 },
    missingSnapshots: 0,
  };
  for (const record of records) {
    if (!Array.isArray(record.snapshot?.deliveries)) { result.missingSnapshots++; continue; }
    for (const stop of record.snapshot.deliveries) {
      const bucket = stop.type === "PICKUP" ? result.pickups : stop.type === "DELIVERY" ? result.deliveries : null;
      if (!bucket) continue;
      const weight = pesoKgDeParada(stop);
      if (weight === null) bucket.plannedMissing++;
      else { bucket.plannedKg += weight; bucket.plannedWithWeight++; }
      if (stop.status === "COMPLETED") {
        if (weight === null) bucket.completedMissing++;
        else { bucket.completedKg += weight; bucket.completedWithWeight++; }
      }
    }
  }
  return result;
}

export function aggregateKilometros(records) {
  let km = 0;
  let missing = 0;
  for (const record of records) {
    const value = record.snapshot?.kilometrosRecorridos;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) missing++;
    else km += value;
  }
  return { km, missing, total: records.length };
}

export function orderedStops(snapshot) {
  const deliveries = Array.isArray(snapshot?.deliveries) ? snapshot.deliveries : [];
  const sequence = Array.isArray(snapshot?.sequence) ? snapshot.sequence : [];
  const byId = new Map(deliveries.map((item) => [item.id, item]));
  return [...sequence.map((id) => byId.get(id)).filter(Boolean), ...deliveries.filter((item) => !sequence.includes(item.id))];
}
