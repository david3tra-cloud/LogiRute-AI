import React from "react";
import { Delivery, DeliveryStatus, DeliveryType } from "./types";
import { orderedStops, pesoKgDeParada } from "./jornadaMetricas.mjs";

interface Props { deliveries: Delivery[]; sequence: string[] }

const statusLabel: Record<DeliveryStatus, string> = {
  [DeliveryStatus.COMPLETED]: "Completada",
  [DeliveryStatus.ISSUE]: "Incidencia",
  [DeliveryStatus.IN_PROGRESS]: "En curso",
  [DeliveryStatus.CANCELLED]: "Cancelada",
  [DeliveryStatus.PENDING]: "Pendiente",
};

export default function JornadaDetalle({ deliveries, sequence }: Props) {
  const ordered = orderedStops({ deliveries, sequence });
  return <ol className="mt-3 space-y-2">
    {ordered.map((stop, index) => {
      const weight = pesoKgDeParada(stop);
      return <li key={stop.id} className="rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-bold">{index + 1}. {stop.recipient || "Sin destinatario"} · {stop.type === DeliveryType.PICKUP ? "Recogida" : "Entrega"} · {statusLabel[stop.status] ?? stop.status}</p>
        <p>{stop.address || "Sin dirección"}</p>
        {stop.concept && <p>Concepto: {stop.concept}</p>}
        {stop.phone && <p>Teléfono: {stop.phone}</p>}
        {stop.estimatedTime && <p>Hora estimada: {stop.estimatedTime}</p>}
        {stop.coordinates && <p>Coordenadas: {stop.coordinates[0]}, {stop.coordinates[1]}</p>}
        {weight !== null && <p>Peso asociado: {weight} kg</p>}
        {stop.sourceType && <p>Origen: {stop.sourceType}{stop.decaId ? ` · DeCA ${stop.decaId}` : ""}</p>}
        {stop.sourceUrl && <p>Enlace de origen: <a className="break-all underline" href={stop.sourceUrl} target="_blank" rel="noreferrer">{stop.sourceUrl}</a></p>}
        {stop.notes && <p className="whitespace-pre-wrap">Observaciones: {stop.notes}</p>}
      </li>;
    })}
  </ol>;
}
