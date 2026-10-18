import { supabase } from './lib/supabase';
import { Delivery, DeliveryStatus, DeliveryType, JornadaRegistro } from './types';
import { isJornadaRegistro } from './registroJornadasService';

export interface RemoteRoute {
  user_id: string;
  deliveries: Delivery[];
  sequence: string[];
  revision: number;
  updated_at: string;
}

export class RouteConflictError extends Error {
  constructor() { super('La ruta ha cambiado en otro dispositivo. Recarga antes de guardar.'); }
}

async function assertSession(userId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!userId || data.session?.user.id !== userId) {
    throw new Error('La sesión ha cambiado. Operación cancelada.');
  }
}

function validateRoute(deliveries: Delivery[], sequence: string[]): void {
  if (!Array.isArray(deliveries) || !Array.isArray(sequence)) throw new Error('Ruta inválida.');
  const ids = new Set<string>();
  for (const d of deliveries) {
    if (!d || typeof d.id !== 'string' || !d.id || ids.has(d.id) ||
        typeof d.recipient !== 'string' || typeof d.address !== 'string' ||
        !Object.values(DeliveryStatus).includes(d.status) ||
        !Object.values(DeliveryType).includes(d.type)) throw new Error('Parada inválida o duplicada.');
    ids.add(d.id);
  }
  if (new Set(sequence).size !== sequence.length ||
      sequence.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('Orden de ruta inválido.');
}

function parseRoute(value: unknown, userId: string): RemoteRoute {
  const row = value as RemoteRoute;
  if (!row || row.user_id !== userId || !Number.isSafeInteger(row.revision) ||
      row.revision < 1 || typeof row.updated_at !== 'string') throw new Error('Respuesta de ruta inválida.');
  validateRoute(row.deliveries, row.sequence);
  return row;
}

export async function loadRemoteRoute(userId: string): Promise<RemoteRoute | null> {
  await assertSession(userId);
  const { data, error } = await supabase.from('rutas_activas').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  await assertSession(userId);
  return data ? parseRoute(data, userId) : null;
}

export async function saveRemoteRoute(userId: string, deliveries: Delivery[], sequence: string[], expectedRevision: number | null): Promise<RemoteRoute> {
  validateRoute(deliveries, sequence);
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new Error('Revisión inválida.');
  await assertSession(userId);
  const payload = { user_id: userId, deliveries, sequence };
  const result = expectedRevision === null
    ? await supabase.from('rutas_activas').insert(payload).select('*').maybeSingle()
    : await supabase.from('rutas_activas').update({ deliveries, sequence }).eq('user_id', userId).eq('revision', expectedRevision).select('*').maybeSingle();
  if (result.error?.code === '23505') throw new RouteConflictError();
  if (result.error) throw result.error;
  if (!result.data) throw new RouteConflictError();
  await assertSession(userId);
  return parseRoute(result.data, userId);
}

export async function listRemoteJornadas(userId: string): Promise<JornadaRegistro[]> {
  await assertSession(userId);
  const items: JornadaRegistro[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('registro_jornadas').select('*').eq('user_id', userId).order('fecha_cierre', { ascending: false }).order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    await assertSession(userId);
    for (const row of data ?? []) {
      const item = { id: row.id, userId: row.user_id, fingerprint: row.fingerprint, fechaCierre: row.fecha_cierre, resumen: row.resumen, deliveries: row.deliveries, sequence: row.sequence };
      if (!isJornadaRegistro(item) || item.userId !== userId) throw new Error('Jornada remota inválida.');
      validateRoute(item.deliveries, item.sequence);
      items.push(item);
    }
    if ((data ?? []).length < pageSize) return items;
  }
}
