import { supabase } from "./lib/supabase";
import type { JornadaRegistro } from "./types";

export interface BillingRecord {
  id: string;
  user_id: string;
  source_jornada_id: string;
  source_fingerprint: string;
  work_date: string;
  source_closed_at: string;
  snapshot: JornadaRegistro;
  created_at: string;
}

async function assertBillingSession(userId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!userId || data.session?.user.id !== userId) {
    throw new Error("La sesión ha cambiado. Operación cancelada.");
  }
}

export async function listBillingRecords(userId: string): Promise<BillingRecord[]> {
  await assertBillingSession(userId);
  const { data, error } = await supabase
    .from("billing_daily_records")
    .select("id,user_id,source_jornada_id,source_fingerprint,work_date,source_closed_at,snapshot,created_at")
    .eq("user_id", userId)
    .order("work_date", { ascending: false })
    .order("source_closed_at", { ascending: false });
  if (error) throw error;
  await assertBillingSession(userId);
  return (data ?? []).map((row) => {
    if (row.user_id !== userId || !row.snapshot || typeof row.snapshot !== "object") {
      throw new Error("Registro de Facturación inválido.");
    }
    return row as BillingRecord;
  });
}

export async function sendJornadaToBilling(
  userId: string,
  jornadaId: string,
): Promise<BillingRecord> {
  await assertBillingSession(userId);
  const { data, error } = await supabase.rpc("enviar_jornada_a_facturacion", {
    p_jornada_id: jornadaId,
  });
  if (error) throw error;
  await assertBillingSession(userId);
  const row = (Array.isArray(data) ? data[0] : data) as BillingRecord | null;
  if (!row || row.user_id !== userId || row.source_jornada_id !== jornadaId || !row.snapshot) {
    throw new Error("La respuesta no confirma el registro de Facturación esperado.");
  }
  return row;
}
