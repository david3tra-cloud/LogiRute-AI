import React, { useState } from "react";
import { ChevronDown, ChevronUp, MapPin, QrCode } from "lucide-react";
import type { DeCA } from "./types";

type DeCAListCardProps = {
  deca: DeCA;
  dateLabel: string;
  measureSummary: string;
  badgeClasses: string;
  canShowQr: boolean;
  onOpen: () => void;
  onShowQr: () => void;
};

export default function DeCAListCard({
  deca,
  dateLabel,
  measureSummary,
  badgeClasses,
  canShowQr,
  onOpen,
  onShowQr,
}: DeCAListCardProps) {
  const [expanded, setExpanded] = useState(false);
  const title = deca.destinatario?.trim() || "Destinatario no indicado";
  const address = [deca.direccionDestino?.trim(), deca.ciudadDestino?.trim()]
    .filter(Boolean)
    .join(", ") || "Destino no indicado";
  const detailId = `deca-list-detail-${deca.id}`;
  const stateLabel =
    deca.estado === "EMITIDO"
      ? "EMITIDO"
      : deca.estado === "EMITIENDO"
        ? "EMITIENDO"
        : "Borrador";
  const sideClasses =
    deca.estado === "EMITIDO"
      ? "border-green-200 border-l-green-500"
      : deca.estado === "EMITIENDO"
        ? "border-amber-200 border-l-amber-500"
        : "border-blue-100 border-l-blue-500";

  return (
    <article
      className={`min-w-0 rounded-xl border-2 border-l-[6px] bg-white p-3 shadow-sm transition-shadow hover:shadow-md sm:p-4 ${sideClasses}`}
    >
      <div className="flex min-w-0 items-start gap-2 sm:gap-3">
        <button
          type="button"
          data-testid={`deca-row-${deca.id}`}
          onClick={onOpen}
          aria-label={`Abrir DeCA de ${title}`}
          className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span
              title={title}
              className="min-w-0 break-words text-sm font-bold uppercase tracking-tight text-slate-800 md:text-base"
            >
              {title}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-tight ${badgeClasses}`}
            >
              {stateLabel}
            </span>
          </span>
          <span className="mt-1 flex items-start gap-1 text-[11px] text-slate-500">
            <MapPin size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{address}</span>
          </span>
          <span className="mt-1.5 block text-[10px] font-semibold text-slate-500">
            {dateLabel}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${expanded ? "Contraer" : "Ver"} información de ${title}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      <div
        id={detailId}
        hidden={!expanded}
        className="mt-3 border-t border-slate-200/50 pt-3"
      >
        <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase text-slate-500">
              Cargador
            </dt>
            <dd className="break-words font-semibold text-slate-800">
              {deca.cargador?.trim() || "Cargador no indicado"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase text-slate-500">
              Mercancía
            </dt>
            <dd className="break-words text-slate-700">
              {deca.mercancia?.trim() || "Sin mercancía"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase text-slate-500">
              Bultos / peso
            </dt>
            <dd className="break-words text-slate-700">{measureSummary}</dd>
          </div>
          {deca.referenciaAlbaran?.trim() && (
            <div className="min-w-0">
              <dt className="text-[10px] font-bold uppercase text-slate-500">
                Referencia de albarán
              </dt>
              <dd className="break-words text-slate-700">
                {deca.referenciaAlbaran}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {canShowQr && (
          <button
            type="button"
            onClick={onShowQr}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <QrCode size={15} /> Ver QR
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="min-h-10 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100"
        >
          Abrir DeCA
        </button>
      </div>
    </article>
  );
}
