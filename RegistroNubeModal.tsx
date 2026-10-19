import React, { useEffect, useRef, useState } from "react";
import { DeliveryStatus, DeliveryType, JornadaRegistro } from "./types";
import { loadRegistroJornadasWithStatus } from "./registroJornadasService";
import { listRemoteJornadas } from "./rutasSupabaseService";

interface Props { isOpen: boolean; onClose: () => void; userId?: string }
export const RegistroNubeModal: React.FC<Props> = ({ isOpen, onClose, userId }) => {
  const [items, setItems] = useState<JornadaRegistro[]>([]);
  const [remoteIds, setRemoteIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setItems([]); setRemoteIds(new Set()); setExpanded(null); setNotice("");
    if (!isOpen || !userId) { setBusy(false); return; }
    const local = loadRegistroJornadasWithStatus(userId);
    setItems(local.items);
    setBusy(true);
    setNotice(local.corrupted ? "El Registro local contiene datos inválidos. No se modifica." : "Cargando registro...");
    void listRemoteJornadas(userId).then(remote => {
      if (generation.current !== token) return;
      const merged = new Map(local.items.map(item => [item.id, item]));
      let conflicts = 0;
      for (const item of remote) {
        const old = merged.get(item.id);
        if (old && old.fingerprint !== item.fingerprint) conflicts++;
        merged.set(item.id, item);
      }
      setRemoteIds(new Set(remote.map(item => item.id)));
      setItems([...merged.values()].sort((a, b) => Date.parse(b.fechaCierre) - Date.parse(a.fechaCierre)));
      setNotice(`${conflicts ? `${conflicts} jornadas tienen diferencias entre la copia local y la nube; se muestra la versión de nube sin borrar la local.` : ""}${local.corrupted ? " El Registro local requiere revisión." : ""}`);
    }).catch(error => {
      if (generation.current === token) setNotice(`No se pudo consultar Supabase: ${String(error?.message ?? error)}. Solo se muestran los datos locales de esta cuenta.`);
    }).finally(() => { if (generation.current === token) setBusy(false); });
    return () => { generation.current++; };
  }, [isOpen, userId, refresh]);
  if (!isOpen) return null;
  const visible = items.filter(item => item.userId === userId);
  const status = (s: DeliveryStatus) => ({ COMPLETED: "Completada", ISSUE: "Incidencia", IN_PROGRESS: "En curso", CANCELLED: "Cancelada", PENDING: "Pendiente" })[s] ?? s;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="registro-nube-title">
    <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl">
      <header className="flex items-center justify-between gap-3 border-b p-5">
        <h2 id="registro-nube-title" className="text-xl font-black">Registro de jornadas</h2>
        <button type="button" disabled={busy} onClick={() => setRefresh(n => n + 1)} aria-label="Actualizar registro" title="Actualizar registro" className="ml-auto rounded border px-3 py-2 disabled:opacity-40">&#8635;</button>
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
