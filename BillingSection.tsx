import React, { useEffect, useMemo, useState } from "react";
import { listBillingRecords, type BillingRecord } from "./billingSupabaseService";
import { aggregateActivity } from "./billingActivity.js";
import JornadaDetalle from "./JornadaDetalle";
import { aggregateKilometros, aggregatePesos } from "./jornadaMetricas.mjs";

interface Props { userId?: string }

type WeightBucket = ReturnType<typeof aggregatePesos>["deliveries"];

const formatWeightBucket = (bucket: WeightBucket) =>
  `${bucket.plannedWithWeight ? `${bucket.plannedKg} kg planificados en ${bucket.plannedWithWeight} paradas con peso${bucket.plannedMissing ? `; ${bucket.plannedMissing} paradas sin dato` : ""}` : bucket.plannedMissing ? `${bucket.plannedMissing} paradas sin dato de peso` : "Sin datos planificados"}${bucket.completedWithWeight ? ` · ${bucket.completedKg} kg realizados en ${bucket.completedWithWeight} paradas completadas con peso${bucket.completedMissing ? `; ${bucket.completedMissing} sin dato` : ""}` : bucket.completedMissing ? ` · ${bucket.completedMissing} paradas completadas sin peso` : ""}`;

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
};

const BillingSection: React.FC<Props> = ({ userId }) => {
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setRecords([]);
    setNotice("");
    if (!userId) return () => { active = false; };
    setLoading(true);
    void listBillingRecords(userId).then((rows) => {
      if (active) setRecords(rows);
    }).catch((error) => {
      if (active) setNotice(`No se pudo cargar Facturación: ${String((error as { message?: string })?.message ?? error)}`);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const months = useMemo(() => [...new Set(records.map((record) => record.work_date.slice(0, 7)))].sort().reverse(), [records]);
  const selected = records.filter((record) => record.work_date.startsWith(`${month}-`));
  const totals = aggregateActivity(selected);
  const kmTotals = aggregateKilometros(selected);
  const weightTotals = aggregatePesos(selected);

  return <div className="min-h-full bg-slate-50 px-4 py-6 sm:px-8 sm:py-8">
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black text-slate-900">Seguimiento de actividad</h1>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Registro mensual de jornadas enviadas. Las tarifas por entrega, recogida, kilos y kilómetros se añadirán cuando estén disponibles. Esto no emite facturas fiscales.</p>
      {notice && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      {!userId ? <p className="mt-6 rounded-xl bg-white p-4 text-sm">Inicia sesión para consultar tus jornadas enviadas.</p> : <>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-3 rounded-2xl border bg-white p-4">
          <label className="text-sm font-bold">Mes de trabajo
            <select className="ml-3 rounded-lg border px-3 py-2" value={month} onChange={(event) => setMonth(event.target.value)}>
              {!months.includes(month) && <option value={month}>{month}</option>}
              {months.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <span className="text-xs text-slate-500">{loading ? "Cargando…" : `${selected.length} jornadas`}</span>
        </div>
        <section className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Totales del mes">
          <div className="rounded-2xl border bg-white p-4"><h2 className="font-bold">Entregas</h2><p className="mt-1 text-sm">{totals.complete ? `${totals.deliveries.completed} realizadas / ${totals.deliveries.planned} planificadas` : "Datos incompletos"}</p></div>
          <div className="rounded-2xl border bg-white p-4"><h2 className="font-bold">Recogidas</h2><p className="mt-1 text-sm">{totals.complete ? `${totals.pickups.completed} realizadas / ${totals.pickups.planned} planificadas` : "Datos incompletos"}</p></div>
        </section>
        <section className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4"><h2 className="font-bold">Kilómetros recorridos</h2><p className="mt-1 text-sm">{kmTotals.total === 0 || kmTotals.missing === kmTotals.total ? "Sin datos" : kmTotals.missing === 0 ? `${kmTotals.km} km en ${kmTotals.total} jornadas` : `${kmTotals.km} km registrados; faltan datos en ${kmTotals.missing} de ${kmTotals.total} jornadas (acumulado parcial)`}</p>{kmTotals.total > 0 && kmTotals.missing === kmTotals.total && <p className="mt-1 text-xs text-amber-800">Faltan datos en las {kmTotals.missing} jornadas del mes.</p>}</div>
          <div className="rounded-2xl border bg-white p-4"><h2 className="font-bold">Peso de entregas y recogidas</h2>
            {([['Entregas', weightTotals.deliveries], ['Recogidas', weightTotals.pickups]] as const).map(([label, bucket]) => <p key={label} className="mt-1 text-sm">{label}: {formatWeightBucket(bucket)}</p>)}
            {weightTotals.missingSnapshots > 0 && <p className="mt-1 text-xs text-amber-800">No se pudieron evaluar los pesos de {weightTotals.missingSnapshots} jornadas por instantáneas incompletas; los valores mostrados no son un total completo.</p>}
          </div>
        </section>
        <div className="mt-5 space-y-3">
          {!loading && selected.length === 0 && <p className="rounded-2xl border bg-white p-5 text-sm text-slate-600">No hay jornadas enviadas para este mes.</p>}
          {selected.map((record) => {
            const counts = aggregateActivity([record]);
            const dayWeights = aggregatePesos([record]);
            const kilometers = record.snapshot.kilometrosRecorridos;
            const meterInitial = record.snapshot.kilometrajeInicial;
            const meterFinal = record.snapshot.kilometrajeFinal;
            const isExpanded = expandedId === record.id;
            return <article key={record.id} className="rounded-2xl border bg-white p-4">
              <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedId(isExpanded ? null : record.id)} className="w-full text-left"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-bold">Jornada del {new Date(`${record.work_date}T12:00:00`).toLocaleDateString("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" })}</h2><p className="mt-1 text-xs text-slate-500">Cierre: {new Date(record.source_closed_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} · ID {record.source_jornada_id.slice(0, 8)}</p></div><span className="text-xs text-emerald-700">Enviada</span></div>
              <p className="mt-3 text-sm">{counts.complete ? `Entregas: ${counts.deliveries.completed} realizadas / ${counts.deliveries.planned} planificadas · Recogidas: ${counts.pickups.completed} realizadas / ${counts.pickups.planned} planificadas` : "Datos de actividad: Sin datos"}</p>
              <p className="mt-1 text-sm">Kilos de entregas: {dayWeights.missingSnapshots > 0 ? "Sin datos" : formatWeightBucket(dayWeights.deliveries)}</p>
              <p className="mt-1 text-sm">Kilos de recogidas: {dayWeights.missingSnapshots > 0 ? "Sin datos" : formatWeightBucket(dayWeights.pickups)}</p>
              <p className="mt-1 text-sm">Lecturas del cuentakilómetros: {typeof meterInitial === "number" && typeof meterFinal === "number" ? `${meterInitial} km → ${meterFinal} km` : "Sin datos"}</p>
              <p className="mt-1 text-sm">Kilómetros recorridos: {typeof kilometers === "number" ? `${kilometers} km` : "Sin datos"}</p></button>
              {isExpanded && <JornadaDetalle deliveries={Array.isArray(record.snapshot.deliveries) ? record.snapshot.deliveries : []} sequence={Array.isArray(record.snapshot.sequence) ? record.snapshot.sequence : []} />}
            </article>;
          })}
        </div>
      </>}
    </div>
  </div>;
};

export default BillingSection;
