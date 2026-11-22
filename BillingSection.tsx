import React, { useEffect, useMemo, useState } from "react";
import { deleteBillingRecord, listBillingRecords, type BillingRecord } from "./billingSupabaseService";
import {
  aggregateActivity,
  aggregateTotalParadas,
  formatBillingWorkDate,
} from "./billingActivity.js";
import JornadaDetalle from "./JornadaDetalle";
import { aggregateKilometros, aggregatePesos } from "./jornadaMetricas.mjs";
import { downloadBillingActivityPdf } from "./billingActivityPdf";

interface Props { userId?: string }

type WeightBucket = ReturnType<typeof aggregatePesos>["deliveries"];

const formatWeightBucket = (bucket: WeightBucket) =>
  `${bucket.plannedWithWeight ? `${bucket.plannedKg} kg planificados en ${bucket.plannedWithWeight} paradas con peso${bucket.plannedMissing ? `; ${bucket.plannedMissing} paradas sin dato` : ""}` : bucket.plannedMissing ? `${bucket.plannedMissing} paradas sin dato de peso` : "Sin datos planificados"}${bucket.completedWithWeight ? ` · ${bucket.completedKg} kg realizados en ${bucket.completedWithWeight} paradas completadas con peso${bucket.completedMissing ? `; ${bucket.completedMissing} sin dato` : ""}` : bucket.completedMissing ? ` · ${bucket.completedMissing} paradas completadas sin peso` : ""}`;

const formatCompactWeight = (
  bucket: WeightBucket,
  period: "planned" | "completed",
  hasIncompleteSnapshots: boolean,
) => {
  const isCompleted = period === "completed";
  const kg = isCompleted ? bucket.completedKg : bucket.plannedKg;
  const withWeight = isCompleted
    ? bucket.completedWithWeight
    : bucket.plannedWithWeight;
  const missing = isCompleted
    ? bucket.completedMissing
    : bucket.plannedMissing;
  const missingNoun = isCompleted
    ? missing === 1
      ? "parada completada"
      : "paradas completadas"
    : missing === 1
      ? "parada"
      : "paradas";

  if (withWeight > 0) {
    return `${kg} kg (${withWeight} con peso)${missing > 0 ? ` · ${missing} ${missingNoun} sin dato` : ""}`;
  }
  if (missing > 0) return `${missing} ${missingNoun} sin dato de peso`;
  if (hasIncompleteSnapshots) return "Sin datos";
  return isCompleted ? "Sin paradas completadas" : "Sin paradas";
};

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const formatStoredCount = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? String(value)
    : "Sin datos";

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
};

const BillingSection: React.FC<Props> = ({ userId }) => {
  const [activeTab, setActiveTab] = useState<"activity" | "economic">("activity");
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteJornada = async (record: BillingRecord) => {
    if (!userId || deletingId !== null) return;
    const dateFormatted = new Date(`${record.work_date}T12:00:00`).toLocaleDateString("es-ES", {
      dateStyle: "long",
      timeZone: "Europe/Madrid",
    });
    const message = `¿Eliminar del seguimiento la jornada del ${dateFormatted}? Se retirará de los acumulados. No se modificarán los datos de origen. Solo podrás volver a emitir su resumen si la jornada original sigue disponible en Registro.`;
    if (!window.confirm(message)) return;

    setDeletingId(record.source_jornada_id);
    setNotice("");
    try {
      const deleted = await deleteBillingRecord(userId, record.source_jornada_id);
      if (deleted) {
        setRecords((current) => current.filter((r) => r.source_jornada_id !== record.source_jornada_id));
        setNotice(`Jornada del ${dateFormatted} retirada de Facturación.`);
      } else {
        setNotice(`No se pudo retirar la jornada del ${dateFormatted} o ya no existe. Se ha actualizado el listado.`);
        void listBillingRecords(userId).then(setRecords);
      }
    } catch (error) {
      setNotice(`No se pudo eliminar la jornada: ${String((error as { message?: string })?.message ?? error)}.`);
      void listBillingRecords(userId).then(setRecords);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownloadPdf = (record: BillingRecord) => {
    setPdfError("");
    try {
      downloadBillingActivityPdf(record);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      setPdfError(`No se pudo generar o descargar el PDF: ${message}`);
    }
  };
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
  const activityMissingSnapshots = selected.filter(
    (record) => !Array.isArray(record.snapshot?.deliveries),
  ).length;
  const stopTotals = aggregateTotalParadas(selected);
  const kmTotals = aggregateKilometros(selected);
  const weightTotals = aggregatePesos(selected);

  return <div className="min-h-full bg-slate-100 px-3 py-4 sm:px-5 lg:px-7">
    <div className="mx-auto w-full max-w-7xl">
      <nav className="mb-4 flex gap-2 border-b border-slate-300" aria-label="Pestañas de Facturación">
        <button
          type="button"
          onClick={() => setActiveTab("activity")}
          className={`border-b-2 px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === "activity" ? "border-blue-700 text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          Seguimiento de actividad
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("economic")}
          className={`border-b-2 px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === "economic" ? "border-blue-700 text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          Facturación económica
        </button>
      </nav>

      {activeTab === "activity" ? <>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Seguimiento de actividad</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">Registro mensual de jornadas enviadas. Las tarifas por entrega, recogida, kilos y kilómetros se añadirán cuando estén disponibles. Esto no emite facturas fiscales.</p>
        {notice && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
        {pdfError && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{pdfError}</p>}
        {!userId ? <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">Inicia sesión para consultar tus jornadas enviadas.</p> : <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <label className="text-sm font-bold">Mes de trabajo
              <select className="ml-3 rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={month} onChange={(event) => setMonth(event.target.value)}>
                {!months.includes(month) && <option value={month}>{month}</option>}
                {months.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <span className="text-xs text-slate-500">
              {loading ? "Cargando…" : `${selected.length} ${selected.length === 1 ? "jornada" : "jornadas"}`}
            </span>
          </div>
          <section className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6" aria-label="Totales del mes">
            <div className="min-w-0 rounded-xl border border-slate-200 border-l-4 border-l-indigo-500 bg-white px-3 py-2.5 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Paradas</h2>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {loading
                  ? "Cargando…"
                  : selected.length === 0
                    ? "Sin jornadas en el periodo."
                    : stopTotals.missing === 0
                      ? `${stopTotals.total} paradas`
                      : stopTotals.total > 0
                        ? `${stopTotals.total} paradas contabilizadas; total parcial.`
                        : "No se puede calcular el total."}
              </p>
              {!loading && stopTotals.missing > 0 && (
                <p className="mt-1 text-xs leading-4 text-amber-900">
                  Faltan datos del total de paradas en {stopTotals.missing} de {stopTotals.count} jornadas.
                </p>
              )}
            </div>
            <div className="min-w-0 rounded-xl border border-slate-200 border-l-4 border-l-blue-600 bg-white px-3 py-2.5 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Entregas</h2>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {loading
                  ? "Cargando…"
                  : selected.length === 0
                    ? "Sin jornadas en el periodo."
                    : totals.complete
                      ? `${totals.deliveries.completed} realizadas / ${totals.deliveries.planned} planificadas`
                    : activityMissingSnapshots === selected.length
                      ? "Sin datos"
                      : `${totals.deliveries.completed} realizadas / ${totals.deliveries.planned} planificadas; parcial`}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-200 border-l-4 border-l-teal-600 bg-white px-3 py-2.5 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Recogidas</h2>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {loading
                  ? "Cargando…"
                  : selected.length === 0
                    ? "Sin jornadas en el periodo."
                    : totals.complete
                      ? `${totals.pickups.completed} realizadas / ${totals.pickups.planned} planificadas`
                    : activityMissingSnapshots === selected.length
                      ? "Sin datos"
                      : `${totals.pickups.completed} realizadas / ${totals.pickups.planned} planificadas; parcial`}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-200 border-l-4 border-l-violet-500 bg-white px-3 py-2.5 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Kilómetros recorridos</h2>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {loading
                  ? "Cargando…"
                  : kmTotals.total === 0 || kmTotals.missing === kmTotals.total
                    ? "Sin datos"
                    : kmTotals.missing === 0
                      ? `${kmTotals.km} km en ${kmTotals.total} jornadas`
                      : `${kmTotals.km} km registrados; total parcial.`}
              </p>
              {!loading && kmTotals.missing > 0 && kmTotals.missing < kmTotals.total && (
                <p className="mt-1 text-xs leading-4 text-amber-900">
                  Faltan datos en {kmTotals.missing} de {kmTotals.total} jornadas.
                </p>
              )}
            </div>
            <div className="min-w-0 rounded-xl border border-slate-200 border-l-4 border-l-emerald-600 bg-white px-3 py-2.5 shadow-sm sm:col-span-2 md:col-span-4 xl:col-span-2">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Peso</h2>
              {loading || selected.length === 0 ? <p className="mt-1 text-xs text-slate-600">{loading ? "Cargando…" : "Sin jornadas en el periodo."}</p> : (
                <div className="mt-1 space-y-1">
                  {([["Entregas", weightTotals.deliveries], ["Recogidas", weightTotals.pickups]] as const).map(([label, bucket]) => (
                    <div key={label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 text-xs leading-4">
                      <span className="font-semibold text-slate-700">{label}</span>
                      <span className="min-w-0">
                        <span className="font-bold text-emerald-800">Realizado: {formatCompactWeight(bucket, "completed", weightTotals.missingSnapshots > 0)}</span>
                        <span className="text-slate-600"> · Planificado: {formatCompactWeight(bucket, "planned", weightTotals.missingSnapshots > 0)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!loading && weightTotals.missingSnapshots > 0 && (
                <p className="mt-1 text-xs leading-4 text-amber-900">
                  Parcial: faltan datos en {weightTotals.missingSnapshots} {weightTotals.missingSnapshots === 1 ? "jornada" : "jornadas"}.
                </p>
              )}
            </div>
          </section>
          {!loading && selected.length > 0 && !totals.complete && (
            <p className="mt-2 text-xs text-amber-900">
              Desglose de paradas ausente en {activityMissingSnapshots} de {selected.length} jornadas; los totales de entregas y recogidas son parciales.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {!loading && selected.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">No hay jornadas enviadas para este mes.</p>}
            {selected.map((record) => {
              const counts = aggregateActivity([record]);
              const dayWeights = aggregatePesos([record]);
              const dayKilometers = aggregateKilometros([record]);
              const isExpanded = expandedId === record.id;
              const detailId = `billing-detail-${record.id}`;
              const closedAt = new Date(record.source_closed_at);
              const closedAtText = Number.isFinite(closedAt.getTime())
                ? closedAt.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
                : "Sin datos";
              return (
                <article key={record.id} className="rounded-xl border border-slate-200 border-l-4 border-l-blue-600 bg-white p-3 shadow-sm">
                  <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.1fr)_repeat(3,minmax(0,1fr))_auto] xl:items-center xl:gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold tracking-tight text-slate-900">
                        Jornada del {formatBillingWorkDate(record.work_date)}
                      </h2>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:col-span-3 xl:gap-1.5">
                        <div className="min-w-0 rounded-lg border border-slate-200 border-l-2 border-l-blue-500 bg-slate-50 px-2.5 py-2">
                          <dt className="text-xs font-semibold text-slate-600">
                            Entregas
                          </dt>
                          <dd className="mt-0.5 font-bold text-slate-900">
                            {counts.complete
                              ? `${counts.deliveries.completed} / ${counts.deliveries.planned}`
                              : "Sin datos"}
                          </dd>
                          <dd className="text-xs leading-4 text-slate-600">
                            Realizadas / planificadas
                          </dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-slate-200 border-l-2 border-l-teal-500 bg-slate-50 px-2.5 py-2">
                          <dt className="text-xs font-semibold text-slate-600">
                            Recogidas
                          </dt>
                          <dd className="mt-0.5 font-bold text-slate-900">
                            {counts.complete
                              ? `${counts.pickups.completed} / ${counts.pickups.planned}`
                              : "Sin datos"}
                          </dd>
                          <dd className="text-xs leading-4 text-slate-600">
                            Realizadas / planificadas
                          </dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-slate-200 border-l-2 border-l-violet-500 bg-slate-50 px-2.5 py-2">
                          <dt className="text-xs font-semibold text-slate-600">
                            Kilómetros recorridos
                          </dt>
                          <dd className="mt-0.5 font-bold text-slate-900">
                            {dayKilometers.missing === 0
                              ? `${dayKilometers.km} km`
                              : "Sin datos"}
                          </dd>
                        </div>
                    </dl>
                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={detailId}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : record.id)
                        }
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {isExpanded ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadPdf(record)}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      >
                        Descargar PDF
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <section
                      id={detailId}
                      aria-label={`Detalle de jornada del ${formatBillingWorkDate(record.work_date)}`}
                      className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <h3 className="font-bold text-slate-900">
                        Detalle de la jornada
                      </h3>
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="font-semibold text-slate-700">
                            Cierre
                          </dt>
                          <dd>{closedAtText}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-700">
                            Paradas
                          </dt>
                          <dd>
                            Total: {formatStoredCount(record.snapshot.resumen?.totalStops)} ·
                            completadas: {formatStoredCount(record.snapshot.resumen?.completedStops)} ·
                            incidencias: {formatStoredCount(record.snapshot.resumen?.issueStops)} ·
                            pendientes o en curso: {formatStoredCount(record.snapshot.resumen?.pendingStops)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-700">
                            Lectura inicial
                          </dt>
                          <dd>
                            {isNonNegativeNumber(record.snapshot.kilometrajeInicial)
                              ? `${record.snapshot.kilometrajeInicial} km`
                              : "Sin datos"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-700">
                            Lectura final
                          </dt>
                          <dd>
                            {isNonNegativeNumber(record.snapshot.kilometrajeFinal)
                              ? `${record.snapshot.kilometrajeFinal} km`
                              : "Sin datos"}
                          </dd>
                        </div>
                        {(["Entregas", "Recogidas"] as const).map((label, index) => {
                          const bucket =
                            index === 0
                              ? dayWeights.deliveries
                              : dayWeights.pickups;
                          return (
                            <div key={label}>
                              <dt className="font-semibold text-slate-700">
                                Peso de {label.toLowerCase()}
                              </dt>
                              <dd>
                                {dayWeights.missingSnapshots > 0
                                  ? "Sin datos: falta la instantánea de paradas."
                                  : formatWeightBucket(bucket)}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(record)}
                          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                        >
                          Descargar PDF
                        </button>
                      </div>
                      <JornadaDetalle
                      deliveries={Array.isArray(record.snapshot.deliveries) ? record.snapshot.deliveries : []}
                        sequence={
                          Array.isArray(record.snapshot.sequence)
                            ? record.snapshot.sequence
                            : []
                        }
                      />
                    </section>
                  )}
                  <div className="mt-2 flex items-center justify-end border-t border-slate-200 pt-2">
                  <button
                    type="button"
                    disabled={deletingId !== null}
                    onClick={() => void handleDeleteJornada(record)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                  >
                    {deletingId === record.source_jornada_id ? "Eliminando…" : "Eliminar del seguimiento"}
                  </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>}
      </> : <div className="rounded-2xl border bg-white p-5 text-sm text-slate-600">
        Pendiente de configurar: autofacturas y tarifas
      </div>}
    </div>
  </div>;
};

export default BillingSection;
