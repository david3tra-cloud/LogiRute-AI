import { supabase } from "./lib/supabase";

async function assertSession(userId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!userId || data.session?.user.id !== userId) throw new Error("La sesión ha cambiado. Operación cancelada.");
}

export async function saveClosedJourneyKilometraje(
  userId: string,
  journeyId: string,
  initial: string | null,
  final: string | null,
): Promise<"COMPLETA" | "HISTORICA"> {
  await assertSession(userId);
  const { data, error } = await supabase.rpc("guardar_kilometraje_jornada_cerrada", {
    p_jornada_id: journeyId,
    p_kilometraje_inicial: initial?.trim() ? initial.trim().replace(",", ".") : null,
    p_kilometraje_final: final?.trim() ? final.trim().replace(",", ".") : null,
  });
  if (error) throw error;
  await assertSession(userId);
  if (data !== "COMPLETA" && data !== "HISTORICA") throw new Error("El servidor no confirmó el estado del kilometraje.");
  return data;
}
