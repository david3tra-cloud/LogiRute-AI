export function madridWorkDate(instant) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid closure instant.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
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
