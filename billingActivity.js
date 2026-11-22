export function madridWorkDate(instant) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid closure instant.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function formatBillingWorkDate(workDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(workDate ?? ""));
  if (!match) return "Sin datos";
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "Sin datos";
  }
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    dateStyle: "long",
  }).format(date);
}

export function aggregateActivity(records) {
  const sum = records.reduce((total, record) => {
    if (!Array.isArray(record.snapshot?.deliveries)) {
      total.complete = false;
      return total;
    }
    for (const item of record.snapshot.deliveries) {
      if (item.type === "DELIVERY") {
        total.deliveries.planned += 1;
        if (item.status === "COMPLETED") total.deliveries.completed += 1;
      } else if (item.type === "PICKUP") {
        total.pickups.planned += 1;
        if (item.status === "COMPLETED") total.pickups.completed += 1;
      }
    }
    return total;
  }, { deliveries: { planned: 0, completed: 0 }, pickups: { planned: 0, completed: 0 }, complete: true });
  return sum;
}

export function aggregateTotalParadas(records) {
  let total = 0;
  let missing = 0;
  for (const record of records) {
    const value = record.snapshot?.resumen?.totalStops;
    const nextTotal = total + value;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !Number.isSafeInteger(nextTotal)
    ) {
      missing++;
      continue;
    }
    total = nextTotal;
  }
  return { total, missing, count: records.length };
}
