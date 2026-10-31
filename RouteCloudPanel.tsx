import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { syncRouteStep, readAutoBase, writeAutoBase } from "./routeAutoSync.mjs";
import { isDefinitiveRevisionConflict, retireClosureMarker } from "./routeCloudRecovery";
import { Delivery, JornadaRegistro } from "./types";
import { loadRemoteRoute, saveRemoteRoute, RemoteRoute, RouteConflictError } from "./rutasSupabaseService";
import { computeRouteFingerprint, generateStableId, loadPendingClosureMarker, isJornadaRegistro, rememberDeletedJornadaForUser } from "./registroJornadasService";
import { isDeletedClosureDuplicate, isDeletedJornada } from "./registroJornadaSync";

interface Props {
  userId: string;
  hydratedUserId: string | null;
  deliveries: Delivery[];
  sequence: string[];
  suspendAuto?: boolean;
  applyRoute: (userId: string, route: RemoteRoute) => boolean;
  registerClose: (close: () => Promise<void>) => () => void;
}
interface PendingClose { id: string; fingerprint: string; revision: number }
const pendingKey = (uid: string) => `logiroute_cloud_close_v1:${uid}`;
const signature = (d: Delivery[], s: string[]) => computeRouteFingerprint(d, s);
const messageOf = (e: unknown) => e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);

export const RouteCloudPanel: React.FC<Props> = props => {
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const operation = useRef(false);
  const generation = useRef(0);
  const meta = useRef<RemoteRoute | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("Comprobando ruta en Supabase...");
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const autoFlight = useRef<Promise<void> | null>(null);
  const manualRequested = useRef(false);
  const autoPaused = useRef(false);
  const autoTick = useRef<(() => Promise<void>) | null>(null);
  const [autoWorking, setAutoWorking] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const uid = props.userId;
  const currentSignature = signature(props.deliveries, props.sequence);

  function context() {
    const token = generation.current;
    const valid = () => generation.current === token && latest.current.userId === uid && latest.current.hydratedUserId === uid;
    return { valid };
  }
  async function session() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== uid) throw new Error("La sesión ha cambiado.");
  }
  function readPending(): PendingClose | null {
    const text = localStorage.getItem(pendingKey(uid));
    if (!text) return null;
    const p = JSON.parse(text) as PendingClose;
    if (!p || typeof p.id !== "string" || !p.id || typeof p.fingerprint !== "string" || !Number.isSafeInteger(p.revision) || p.revision < 1) throw new Error("Marcador de cierre remoto inválido. Conserva los datos y solicita revisión.");
    return p;
  }
  function backup() {
    const p = latest.current;
    localStorage.setItem(`logiroute_before_cloud_v1:${uid}`, JSON.stringify({ userId: uid, deliveries: p.deliveries, sequence: p.sequence, at: new Date().toISOString() }));
  }
  function legacyGuard() {
    const marker = loadPendingClosureMarker(uid);
    if (marker && marker.status !== "COMPLETED") throw new Error("Hay un cierre local anterior pendiente. No se modifica la nube hasta revisarlo.");
  }
  function remember(row: RemoteRoute) {
    const fp = signature(row.deliveries, row.sequence);
    writeAutoBase(uid, row, fp, localStorage);
    meta.current = row; setReady(true); setSaved(fp);
    autoPaused.current = false; setShowTools(false);
  }
  async function run(action: (valid: () => boolean) => Promise<void>) {
    if (manualRequested.current || (operation.current && !autoFlight.current) || latest.current.hydratedUserId !== uid) return;
    const waitGeneration = generation.current;
    manualRequested.current = true;
    try {
      if (autoFlight.current) await autoFlight.current;
      if (generation.current !== waitGeneration || latest.current.hydratedUserId !== uid) return;
      operation.current = true; setBusy(true);
      generation.current++;
      const { valid } = context();
      try { await action(valid); }
      catch (e) { if (valid()) { setShowTools(true); setNotice(`No confirmado: ${messageOf(e)}. Se conservan los datos locales.`); } }
      finally { if (valid()) { operation.current = false; setBusy(false); } }
    } finally { manualRequested.current = false; }
  }
  useEffect(() => {
    generation.current++;
    operation.current = false;
    meta.current = undefined;
    autoPaused.current = false;
    setReady(false); setBusy(false); setSaved(null); setBlocked(false); setPending(false); setShowTools(false);
    if (props.hydratedUserId !== uid) return;
    try {
      setPending(Boolean(readPending()));
      legacyGuard();
      readAutoBase(uid, localStorage);
      setNotice("Conectando sincronización automática...");
    } catch (e) { autoPaused.current = true; setBlocked(true); setShowTools(true); setNotice(messageOf(e)); }
    return () => { generation.current++; };
  }, [uid, props.hydratedUserId]);

  async function tick() {
    if (operation.current || manualRequested.current || autoPaused.current || latest.current.suspendAuto || latest.current.hydratedUserId !== uid || document.visibilityState === "hidden") return;
    operation.current = true; setAutoWorking(true);
    const { valid } = context();
    const task = (async () => {
      try {
        legacyGuard();
        const result = await syncRouteStep({
          userId: uid,
          isCurrent: valid,
          isBlocked: () => Boolean(readPending()) || Boolean(latest.current.suspendAuto),
          readBase: () => readAutoBase(uid, localStorage),
          getLocal: () => ({ deliveries: latest.current.deliveries, sequence: latest.current.sequence }),
          fingerprint: signature,
          load: () => loadRemoteRoute(uid),
          save: (deliveries, sequence, revision) => saveRemoteRoute(uid, deliveries, sequence, revision),
          backup,
          apply: row => latest.current.applyRoute(uid, row),
          accept: remember,
        });
        if (!valid()) return;
        if (result.kind === "conflict") {
          autoPaused.current = true;
          meta.current = result.row; setReady(true); setSaved(null); setShowTools(true);
          setNotice("Requiere revisión: hay versiones diferentes. No se ha sobrescrito ninguna. Elige cargar la nube o conservar esta ruta.");
        } else if (result.kind === "paused") {
          setPending(Boolean(readPending()));
        } else if (result.kind !== "defer") {
          setNotice(result.kind === "pull" ? "Cambios del otro dispositivo recibidos." : "Guardado en tu cuenta.");
        }
      } catch (e) {
        if (valid()) {
          if (e instanceof RouteConflictError) { autoPaused.current = true; setSaved(null); }
          setShowTools(true);
          setNotice(`Sin confirmar: ${messageOf(e)}. No se borran los cambios locales.`);
        }
      } finally { if (valid()) { operation.current = false; setAutoWorking(false); } }
    })();
    autoFlight.current = task;
    try { await task; } finally { if (autoFlight.current === task) autoFlight.current = null; }
  }
  useEffect(() => { autoTick.current = tick; });
  useEffect(() => {
    if (props.hydratedUserId !== uid) return;
    const request = () => { void autoTick.current?.(); };
    const initial = window.setTimeout(request, 0);
    const timer = window.setInterval(request, 4000);
    window.addEventListener("focus", request);
    document.addEventListener("visibilitychange", request);
    return () => {
      window.clearTimeout(initial); window.clearInterval(timer);
      window.removeEventListener("focus", request);
      document.removeEventListener("visibilitychange", request);
    };
  }, [uid, props.hydratedUserId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void autoTick.current?.(); }, 700);
    return () => window.clearTimeout(timer);
  }, [currentSignature, uid]);

  async function saveSnapshot(valid: () => boolean) {
    legacyGuard();
    if (readPending()) throw new Error("Hay un cierre remoto pendiente: reintenta Cerrar jornada antes de guardar otra ruta.");
    if (meta.current === undefined) throw new Error("Primero consulta la nube con Cargar de nube.");
    const p = latest.current;
    const deliveries = JSON.parse(JSON.stringify(p.deliveries)) as Delivery[];
    const sequence = [...p.sequence];
    const fingerprint = signature(deliveries, sequence);
    const remote = meta.current;
    if (remote && signature(remote.deliveries, remote.sequence) !== fingerprint && saved === null && !window.confirm("La ruta de nube y la de este dispositivo son distintas. ¿Guardar esta ruta local como versión compartida? La nube rechazará la operación si otro dispositivo ya la cambió.")) return null;
    const row = await saveRemoteRoute(uid, deliveries, sequence, remote?.revision ?? null);
    if (!valid()) return null;
    remember(row);
    return { row, fingerprint };
  }
  const save = () => run(async valid => {
    const result = await saveSnapshot(valid);
    if (result && valid()) setNotice("Guardado en tu cuenta. Sincronización automática activada.");
  });
  const load = () => run(async valid => {
    if (readPending()) throw new Error("Hay un cierre remoto pendiente: reintenta Cerrar jornada.");
    const before = signature(latest.current.deliveries, latest.current.sequence);
    const route = await loadRemoteRoute(uid);
    if (!valid()) return;
    if (before !== signature(latest.current.deliveries, latest.current.sequence)) throw new Error("La ruta local cambió durante la consulta. No se sustituye.");
    meta.current = route; setReady(true);
    if (!route) { setNotice("No hay ruta en nube. La ruta local sigue intacta; puedes guardarla."); return; }
    if (before !== signature(route.deliveries, route.sequence) && !window.confirm("¿Cargar la ruta de nube y sustituir la que se ve en este dispositivo? Se conservará una copia local de seguridad de la ruta actual.")) { setSaved(null); setNotice("Carga cancelada. No se ha sustituido la ruta local."); return; }
    backup();
    if (!latest.current.applyRoute(uid, route)) throw new Error("No se pudo guardar la copia local de la ruta recibida.");
    remember(route); setNotice("Ruta de tu cuenta cargada. Sincronización automática activada.");
  });
  const close = () => run(async valid => {
    legacyGuard();
    let marker = readPending();
    if (!marker) {
      if (!ready) throw new Error("Primero consulta o guarda la ruta en nube.");
      if (!latest.current.deliveries.length) { setNotice("La ruta está vacía."); return; }
      if (!window.confirm("¿Cerrar jornada? Se guardará en el Registro de Supabase y se vaciará la ruta compartida. Las paradas pendientes conservarán su estado en el historial.")) return;
      const result = await saveSnapshot(valid);
      if (!result || !valid()) return;
      if (result.fingerprint !== signature(latest.current.deliveries, latest.current.sequence)) throw new Error("La ruta local cambió mientras se guardaba. No se cierra.");
      marker = { id: generateStableId(), fingerprint: result.fingerprint, revision: result.row.revision };
      localStorage.setItem(pendingKey(uid), JSON.stringify(marker)); setPending(true);
    }
    await session();
    if (!valid()) return;
    const { data, error } = await supabase.rpc("cerrar_jornada_remota", { p_id: marker.id, p_fingerprint: marker.fingerprint, p_expected_revision: marker.revision });
    if (error) {
      await session();
      if (!valid()) return;
      if (isDefinitiveRevisionConflict(error)) {
        retireClosureMarker(pendingKey(uid), marker);
        meta.current = undefined;
        setReady(false); setPending(false); setSaved(null);
        autoPaused.current = true; setShowTools(true);
        setNotice("El servidor rechazó este cierre por un cambio de revisión. No se ha vaciado la ruta local. Consulta Cargar de nube y decide qué versión conservar antes de volver a cerrar.");
        return;
      }
      throw error;
    }
    await session();
    if (!valid()) return;
    const row = data?.route as RemoteRoute;
    const a = data?.jornada;
    if (isDeletedClosureDuplicate(
      { id: a?.id, userId: a?.user_id, fingerprint: a?.fingerprint, deletedAt: a?.deleted_at },
      { id: marker.id, userId: uid, fingerprint: marker.fingerprint },
    )) {
      rememberDeletedJornadaForUser(uid, marker.id);
      retireClosureMarker(pendingKey(uid), marker);
      setPending(false);
      setNotice("Este cierre ya corresponde a un resumen eliminado. No se ha vuelto a archivar ni se ha vaciado la ruta activa.");
      return;
    }
    const jornada: JornadaRegistro = { id: a?.id, userId: a?.user_id, fingerprint: a?.fingerprint, fechaCierre: a?.fecha_cierre, resumen: a?.resumen, deliveries: a?.deliveries, sequence: a?.sequence, deletedAt: typeof a?.deleted_at === "string" ? a.deleted_at : null };
    if (!isJornadaRegistro(jornada) || jornada.userId !== uid || jornada.id !== marker.id || jornada.fingerprint !== marker.fingerprint || !row || row.user_id !== uid || !Array.isArray(row.deliveries) || !Array.isArray(row.sequence) || !Number.isSafeInteger(row.revision)) throw new Error("Respuesta de cierre inválida. Conserva el marcador para revisión.");
    if (isDeletedJornada(jornada)) {
      rememberDeletedJornadaForUser(uid, jornada.id);
      retireClosureMarker(pendingKey(uid), marker);
      setPending(false);
      setNotice("Este cierre ya corresponde a un resumen eliminado. No se ha vuelto a archivar ni se ha vaciado la ruta activa.");
      return;
    }
    if (signature(latest.current.deliveries, latest.current.sequence) !== marker.fingerprint && signature(latest.current.deliveries, latest.current.sequence) !== signature(row.deliveries, row.sequence)) {
      backup();
      retireClosureMarker(pendingKey(uid), marker);
      remember(row); setSaved(null); setPending(false);
      autoPaused.current = true; setShowTools(true);
      setNotice("La jornada está confirmada en el Registro de nube. Se han conservado los cambios locales posteriores SIN sustituirlos ni subirlos. Antes de guardar otra vez, revisa las paradas para no reintroducir las de la jornada cerrada.");
      return;
    }
    backup();
    if (!latest.current.applyRoute(uid, row)) throw new Error("La jornada está en nube, pero falló el guardado local. Reintenta el cierre.");
    remember(row);
    retireClosureMarker(pendingKey(uid), marker); setPending(false);
    setNotice("Jornada archivada en Supabase. Ruta compartida actualizada. Puedes abrir Registro en ambos dispositivos.");
  });
  useEffect(() => {
    return props.registerClose(close);
  }, [close, props.registerClose]);
  const disabled = busy || autoWorking || blocked || props.hydratedUserId !== uid;
  if (!busy && !pending && !showTools && !blocked) return null;
  return <aside className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" aria-label="Sincronización de rutas">
    <p role="status">{busy ? "Procesando cierre o revisión..." : autoWorking ? "Sincronizando..." : pending ? "Cierre pendiente de confirmar." : notice}</p>
    {(showTools || pending || blocked) && <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || pending} onClick={load} className="rounded border bg-white px-3 py-2 disabled:opacity-40">Cargar versión de nube</button>
      <button type="button" disabled={disabled || !ready || pending} onClick={save} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-40">Conservar esta ruta en nube</button>
      {pending && <button type="button" disabled={disabled} onClick={close} className="rounded border bg-white px-3 py-2">Reintentar cierre</button>}
    </div>}
    {busy && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 p-6 text-center text-white" role="alert">Procesando con Supabase. No cierres la aplicación.</div>}
  </aside>;
};
