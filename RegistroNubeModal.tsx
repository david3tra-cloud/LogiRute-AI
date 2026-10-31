import React, { useEffect, useRef, useState } from "react";
import { DeliveryStatus, DeliveryType, JornadaRegistro } from "./types";
import { loadRegistroJornadasWithStatus } from "./registroJornadasService";
import {
  loadDeletedJornadaIdsForUser,
  rememberDeletedJornadaForUser,
  removeJornadaFromLocalForUser,
} from "./registroJornadasService";
import { deleteRemoteJornada, listRemoteJornadas } from "./rutasSupabaseService";
import {
  executeJornadaDeletion,
  executeLocalJornadaDeletion,
  mergeJornadaSnapshots,
} from "./registroJornadaSync";

interface Props { isOpen: boolean; onClose: () => void; userId?: string }
export const RegistroNubeModal: React.FC<Props> = ({ isOpen, onClose, userId }) => {
  const [items, setItems] = useState<JornadaRegistro[]>([]);
  const [remoteIds, setRemoteIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const generation = useRef(0);
  const deletingIds = useRef(new Set<string>());
  useEffect(() => {
    const token = ++generation.current;
    setItems([]); setRemoteIds(new Set()); setExpanded(null); setNotice("");
    setDeletingId(null);
    if (!isOpen || !userId) { setBusy(false); return; }
    const local = loadRegistroJornadasWithStatus(userId);
    const rememberedDeletedIds = loadDeletedJornadaIdsForUser(userId);
    setBusy(true);
    setNotice(local.corrupted ? "El Registro local contiene datos inválidos. No se modifica." : "Cargando registro...");
    void listRemoteJornadas(userId).then(remote => {
      if (generation.current !== token) return;
      const merged = mergeJornadaSnapshots(
        local.items,
        remote,
        rememberedDeletedIds,
      );
      for (const item of remote) {
        if (item.deletedAt) rememberDeletedJornadaForUser(userId, item.id);
      }
      setRemoteIds(merged.remoteIds);
      setItems(merged.items);
      setNotice(`${merged.conflicts ? `${merged.conflicts} jornadas tienen diferencias entre la copia local y la nube; se muestra la versión de nube sin borrar la local.` : ""}${local.corrupted ? " El Registro local requiere revisión." : ""}`);
    }).catch(error => {
      if (generation.current === token) {
        setItems(mergeJornadaSnapshots(local.items, [], rememberedDeletedIds).items);
        setNotice(`No se pudo consultar Supabase: ${String(error?.message ?? error)}. Solo se muestran los datos locales de esta cuenta.`);
      }
    }).finally(() => { if (generation.current === token) setBusy(false); });
    return () => { generation.current++; };
  }, [isOpen, userId, refresh]);
  if (!isOpen) return null;
  const visible = items.filter(item => item.userId === userId);
  const handleDelete = async (jornada: JornadaRegistro) => {
    if (!userId || !remoteIds.has(jornada.id)) return;
    const ownerId = userId;
    const token = generation.current;
    const operationKey = `${ownerId}:${jornada.id}`;
    if (deletingIds.current.has(operationKey)) return;
    if (!window.confirm("¿Eliminar únicamente este resumen de jornada? No se eliminarán DeCAs ni se modificará la ruta activa.")) return;

    deletingIds.current.add(operationKey);
    setDeletingId(jornada.id);
    const isCurrent = () =>
      generation.current === token && userId === ownerId && isOpen;
    try {
      const result = await executeJornadaDeletion({
        userId: ownerId,
        jornadaId: jornada.id,
        deleteRemote: deleteRemoteJornada,
        isCurrent,
        rememberTombstone: rememberDeletedJornadaForUser,
        removeLocalCopy: removeJornadaFromLocalForUser,
      });
      if (result.kind === "stale" || !isCurrent()) return;
      setItems((current) => current.filter((item) => item.id !== jornada.id));
      setRemoteIds((current) => {
        const next = new Set(current);
        next.delete(jornada.id);
        return next;
      });
      setNotice(
        result.tombstoneCached && result.localCopyRemoved
          ? "El servidor confirmó la eliminación del resumen. Los DeCAs y la ruta activa se conservaron."
          : "El servidor confirmó la eliminación. La copia local no pudo limpiarse por completo; la marca remota evitará que reaparezca al sincronizar.",
      );
    } catch (error) {
      if (isCurrent()) {
        setNotice(`Borrado no confirmado: ${String((error as { message?: string })?.message ?? error)}. Actualiza el registro para comprobar el estado antes de volver a intentarlo.`);
      }
    } finally {
      deletingIds.current.delete(operationKey);
      if (isCurrent()) setDeletingId(null);
    }
  };
  const handleDeleteLocal = async (jornada: JornadaRegistro) => {
    if (!userId || remoteIds.has(jornada.id) || jornada.userId !== userId) return;
    const ownerId = userId;
    const token = generation.current;
    const operationKey = `${ownerId}:${jornada.id}`;
    if (deletingIds.current.has(operationKey)) return;
    if (!window.confirm("¿Eliminar únicamente este resumen de este dispositivo? No se eliminarán registros de nube, DeCAs ni se modificará la ruta activa.")) return;

    setDeletingId(jornada.id);
    const isCurrent = () =>
      generation.current === token && userId === ownerId && isOpen;
    try {
      const result = await executeLocalJornadaDeletion({
        userId: ownerId,
        jornada,
        isCurrent,
        operationLocks: deletingIds.current,
        removeLocalCopy: removeJornadaFromLocalForUser,
      });
      if (result.kind === "stale" || !isCurrent()) return;
      if (result.kind === "duplicate") return;
      setItems((current) => current.filter((item) => item.id !== jornada.id));
      setNotice("Se eliminó únicamente este resumen de este dispositivo. Los registros de nube, los DeCAs y la ruta activa no se modificaron.");
    } catch (error) {
      if (isCurrent()) {
        setNotice(`No se pudo eliminar la copia local: ${String((error as { message?: string })?.message ?? error)}.`);
      }
    } finally {
      if (isCurrent()) setDeletingId(null);
    }
  };
  const status = (s: DeliveryStatus) => ({ COMPLETED: "Completada", ISSUE: "Incidencia", IN_PROGRESS: "En curso", CANCELLED: "Cancelada", PENDING: "Pendiente" })[s] ?? s;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="registro-nube-title">
    <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl">
      <header className="flex items-center justify-between gap-3 border-b p-5">
        <h2 id="registro-nube-title" className="text-xl font-black">Registro de jornadas</h2>
        <button type="button" disabled={busy || deletingId !== null} onClick={() => setRefresh(n => n + 1)} aria-label="Actualizar registro" title="Actualizar registro" className="ml-auto rounded border px-3 py-2 disabled:opacity-40">&#8635;</button>
        <button type="button" onClick={onClose} className="rounded border px-3 py-2">Cerrar</button>
      </header>
      {(busy || notice) && <div className="border-b bg-blue-50 p-4 text-xs" role="status">{notice}</div>}
      <div className="space-y-3 overflow-y-auto p-5">
        {!visible.length && <p>{busy ? "Cargando..." : "Todavía no hay jornadas archivadas."}</p>}
        {visible.map(item => {
          const byId = new Map(item.deliveries.map(d => [d.id, d]));
          const ordered = [...item.sequence.map(id => byId.get(id)).filter((d): d is typeof item.deliveries[number] => Boolean(d)), ...item.deliveries.filter(d => !item.sequence.includes(d.id))];
          return <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
            <button type="button" className="w-full text-left" aria-expanded={expanded === item.id} onClick={() => setExpanded(id => id === item.id ? null : item.id)}>
              <span className="block font-bold">{new Date(item.fechaCierre).toLocaleString("es-ES")} — {remoteIds.has(item.id) ? "En nube" : "Solo en este dispositivo"}</span>
              <span className="text-xs">{item.resumen.totalStops} paradas · {item.resumen.completedStops} completadas · {item.resumen.issueStops} incidencias · {item.resumen.pendingStops} pendientes · {item.resumen.deliveriesCount} entregas / {item.resumen.pickupsCount} recogidas</span>
            </button>
            {remoteIds.has(item.id) ? (
              <button
                type="button"
                disabled={busy || deletingId !== null}
                onClick={() => void handleDelete(item)}
                className="mt-3 rounded border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
              >
                {deletingId === item.id ? "Confirmando eliminación…" : "Eliminar resumen"}
              </button>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Solo en este dispositivo; no está sincronizado.</p>
                <button type="button" disabled={busy || deletingId !== null} onClick={() => handleDeleteLocal(item)} className="rounded border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">
                  {deletingId === item.id ? "Eliminando copia local…" : "Eliminar de este dispositivo"}
                </button>
              </div>
            )}
            {expanded === item.id && <ol className="mt-3 space-y-2">{ordered.map((d, index) => <li key={d.id} className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-bold">{index + 1}. {d.recipient || "Sin destinatario"} — {d.type === DeliveryType.PICKUP ? "Recogida" : "Entrega"} — {status(d.status)}</p>
              <p>{d.address || "Sin dirección"}</p>{d.phone && <p>{d.phone}</p>}{d.concept && <p>{d.concept}</p>}{d.notes && <p>{d.notes}</p>}
            </li>)}</ol>}
          </article>;
        })}
      </div>
    </div>
  </div>;
};
