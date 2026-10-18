import React, { useState, useEffect } from "react";
import { X, Calendar, Package, AlertTriangle, CheckCircle2, Clock, ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { JornadaRegistro, DeliveryStatus, DeliveryType } from "./types";
import { loadRegistroJornadasForUser } from "./registroJornadasService";

interface RegistroModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
}

const statusBadge = (status: DeliveryStatus) => {
  switch (status) {
    case DeliveryStatus.COMPLETED:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
          <CheckCircle2 size={12} /> Completada
        </span>
      );
    case DeliveryStatus.ISSUE:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
          <AlertTriangle size={12} /> Incidencia
        </span>
      );
    case DeliveryStatus.IN_PROGRESS:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
          <Clock size={12} /> En curso
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          <Clock size={12} /> Pendiente
        </span>
      );
  }
};

export const RegistroModal: React.FC<RegistroModalProps> = ({
  isOpen,
  onClose,
  userId,
}) => {
  const [jornadas, setJornadas] = useState<JornadaRegistro[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Cargar las jornadas del usuario al abrir o cambiar de cuenta
  useEffect(() => {
    if (!isOpen || !userId) {
      setJornadas([]);
      setExpandedId(null);
      return;
    }
    const items = loadRegistroJornadasForUser(userId);
    setJornadas(items);
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString("es-ES", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registro-modal-title"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-md">
              <Calendar size={22} />
            </div>
            <div>
              <h2
                id="registro-modal-title"
                className="text-xl font-black uppercase tracking-tight text-slate-800"
              >
                Registro de Jornadas
              </h2>
              <p className="text-xs font-semibold text-slate-400">
                Historial de jornadas cerradas para esta cuenta
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="Cerrar registro"
          >
            <X size={20} />
          </button>
        </div>

        {/* Aviso de almacenamiento local */}
        <div className="bg-amber-50/80 border-b border-amber-100 px-6 py-2.5 text-xs font-medium text-amber-800">
          ⚠️ Este registro se almacena localmente en este navegador. Aún no cuenta con sincronización entre dispositivos.
        </div>

        {/* Contenido / Listado */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {jornadas.length === 0 ? (
            <div className="py-16 text-center">
              <Package size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-base font-bold text-slate-700">
                No hay jornadas archivadas todavía
              </p>
              <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                Al finalizar una ruta desde el Panel de Control y pulsar «Cerrar jornada», se guardará aquí la instantánea completa con todas sus paradas.
              </p>
            </div>
          ) : (
            jornadas.map((jornada) => {
              const isExpanded = expandedId === jornada.id;
              const { resumen } = jornada;

              return (
                <div
                  key={jornada.id}
                  className="rounded-2xl border border-slate-200 bg-white transition-all shadow-sm hover:shadow"
                >
                  {/* Fila resumen */}
                  <div
                    onClick={() => toggleExpand(jornada.id)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 cursor-pointer gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-800">
                          {formatDate(jornada.fechaCierre)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          ID: {jornada.id.slice(0, 8)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-slate-600">
                          {resumen.totalStops} {resumen.totalStops === 1 ? "parada" : "paradas"}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="text-emerald-700 font-semibold">
                          {resumen.completedStops} completadas
                        </span>
                        {resumen.issueStops > 0 && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-amber-700 font-semibold">
                              {resumen.issueStops} con incidencia
                            </span>
                          </>
                        )}
                        {resumen.pendingStops > 0 && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-blue-700 font-semibold">
                              {resumen.pendingStops} pendientes
                            </span>
                          </>
                        )}
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-500">
                          ({resumen.deliveriesCount} entregas / {resumen.pickupsCount} recogidas)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
                      >
                        {isExpanded ? (
                          <>
                            <span>Ocultar</span>
                            <ChevronUp size={16} />
                          </>
                        ) : (
                          <>
                            <span>Ver detalle</span>
                            <ChevronDown size={16} />
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Detalle desplegable de paradas */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4 rounded-b-2xl space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                        Paradas de la jornada ({jornada.deliveries.length})
                      </p>
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {jornada.deliveries.map((delivery, index) => (
                          <div
                            key={delivery.id || index}
                            className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl bg-white p-3 border border-slate-100 shadow-sm gap-2"
                          >
                            <div className="flex items-start gap-3">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">
                                {index + 1}
                              </span>
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-black text-slate-800">
                                    {delivery.recipient || "Sin destinatario"}
                                  </span>
                                  <span
                                    className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                      delivery.type === DeliveryType.PICKUP
                                        ? "bg-red-50 text-red-600 border border-red-200"
                                        : "bg-blue-50 text-blue-600 border border-blue-200"
                                    }`}
                                  >
                                    {delivery.type === DeliveryType.PICKUP
                                      ? "Recogida"
                                      : "Entrega"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                  <MapPin size={12} className="shrink-0 text-slate-400" />
                                  <span>{delivery.address || "Dirección no especificada"}</span>
                                </div>
                                {delivery.notes && (
                                  <p className="text-[10px] text-slate-400 italic">
                                    Notas: {delivery.notes}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0 self-end sm:self-center">
                              {statusBadge(delivery.status)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pie de modal */}
        <div className="flex items-center justify-end border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-slate-900 px-6 py-2.5 text-xs font-black uppercase text-white hover:bg-slate-800 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

