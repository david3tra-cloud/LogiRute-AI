CREATE TABLE public.kilometraje_jornadas (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  source_jornada_id text NOT NULL,
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'COMPLETA')),
  kilometraje_inicial numeric,
  kilometraje_final numeric,
  kilometros_recorridos numeric GENERATED ALWAYS AS (kilometraje_final - kilometraje_inicial) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, source_jornada_id),
  CONSTRAINT kilometraje_jornadas_state_values CHECK (
    (estado = 'PENDIENTE' AND kilometraje_inicial IS NULL AND kilometraje_final IS NULL AND completed_at IS NULL)
    OR
    (estado = 'COMPLETA' AND kilometraje_inicial IS NOT NULL AND kilometraje_inicial >= 0
      AND kilometraje_final IS NOT NULL AND kilometraje_final >= kilometraje_inicial
      AND completed_at IS NOT NULL)
  )
);

ALTER TABLE public.kilometraje_jornadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY kilometraje_jornadas_select_own ON public.kilometraje_jornadas
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
GRANT SELECT ON public.kilometraje_jornadas TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.kilometraje_jornadas FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.marcar_kilometraje_jornada_nueva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO public.kilometraje_jornadas (user_id, source_jornada_id, estado)
  VALUES (NEW.user_id, NEW.id, 'PENDIENTE')
  ON CONFLICT (user_id, source_jornada_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.marcar_kilometraje_jornada_nueva() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.marcar_kilometraje_jornada_nueva() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER registro_jornadas_exigir_kilometraje
  AFTER INSERT ON public.registro_jornadas
  FOR EACH ROW EXECUTE FUNCTION public.marcar_kilometraje_jornada_nueva();

CREATE OR REPLACE FUNCTION public.guardar_kilometraje_jornada_cerrada(
  p_jornada_id text,
  p_kilometraje_inicial text,
  p_kilometraje_final text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_inicial numeric;
  v_final numeric;
  v_jornada public.registro_jornadas%ROWTYPE;
  v_state public.kilometraje_jornadas%ROWTYPE;
  v_has_state boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_jornada_id IS NULL OR p_jornada_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journey id is required.';
  END IF;

  IF (p_kilometraje_inicial IS NULL OR pg_catalog.btrim(p_kilometraje_inicial) = '')
     AND (p_kilometraje_final IS NULL OR pg_catalog.btrim(p_kilometraje_final) = '') THEN
    v_inicial := NULL;
    v_final := NULL;
  ELSE
    IF p_kilometraje_inicial IS NULL OR pg_catalog.btrim(p_kilometraje_inicial) = ''
       OR p_kilometraje_final IS NULL OR pg_catalog.btrim(p_kilometraje_final) = ''
       OR p_kilometraje_inicial !~ '^[0-9]+([.][0-9]+)?$'
       OR p_kilometraje_final !~ '^[0-9]+([.][0-9]+)?$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Both odometer readings must be valid nonnegative numbers.';
    END IF;
    v_inicial := p_kilometraje_inicial::numeric;
    v_final := p_kilometraje_final::numeric;
    IF v_final < v_inicial THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Final odometer reading is below initial reading.';
    END IF;
  END IF;

  -- A finalized capture is immutable; an identical retry is safe even after soft deletion.
  SELECT metric.* INTO v_state
  FROM public.kilometraje_jornadas AS metric
  WHERE metric.user_id = v_user_id AND metric.source_jornada_id = p_jornada_id
  FOR UPDATE;
  v_has_state := FOUND;
  IF v_has_state AND v_state.estado = 'COMPLETA' THEN
    IF v_inicial IS DISTINCT FROM v_state.kilometraje_inicial
       OR v_final IS DISTINCT FROM v_state.kilometraje_final THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Journey odometer values are immutable.';
    END IF;
    RETURN 'COMPLETA';
  END IF;

  SELECT journey.* INTO v_jornada
  FROM public.registro_jornadas AS journey
  WHERE journey.user_id = v_user_id AND journey.id = p_jornada_id
  FOR UPDATE;
  IF NOT FOUND OR v_jornada.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Journey not found or deleted for this account.';
  END IF;

  -- No status row means the journey predates this migration; never invent a historical capture.
  IF NOT v_has_state THEN
    RETURN 'HISTORICA';
  END IF;

  IF v_state.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Journey odometer state is invalid.';
  END IF;
  IF v_inicial IS NULL OR v_final IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'New journeys require both odometer readings.';
  END IF;

  UPDATE public.kilometraje_jornadas AS metric
  SET estado = 'COMPLETA',
      kilometraje_inicial = v_inicial,
      kilometraje_final = v_final,
      completed_at = pg_catalog.now()
  WHERE metric.user_id = v_user_id
    AND metric.source_jornada_id = p_jornada_id
    AND metric.estado = 'PENDIENTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Journey odometer capture changed; retry with the same closure marker.';
  END IF;
  RETURN 'COMPLETA';
END;
$function$;

ALTER FUNCTION public.guardar_kilometraje_jornada_cerrada(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guardar_kilometraje_jornada_cerrada(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_kilometraje_jornada_cerrada(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enviar_jornada_a_facturacion(p_jornada_id text)
RETURNS SETOF public.billing_daily_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_jornada public.registro_jornadas%ROWTYPE;
  v_record public.billing_daily_records%ROWTYPE;
  v_kilometraje public.kilometraje_jornadas%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_jornada_id IS NULL OR p_jornada_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journey id is required.';
  END IF;

  -- Existing immutable billing records remain idempotently readable, including after source deletion.
  SELECT record.* INTO v_record
  FROM public.billing_daily_records AS record
  WHERE record.user_id = v_user_id AND record.source_jornada_id = p_jornada_id;
  IF FOUND THEN
    RETURN NEXT v_record;
    RETURN;
  END IF;

  SELECT journey.* INTO v_jornada
  FROM public.registro_jornadas AS journey
  WHERE journey.user_id = v_user_id AND journey.id = p_jornada_id
  FOR SHARE;
  IF NOT FOUND OR v_jornada.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active journey not found for this account.';
  END IF;

  SELECT metric.* INTO v_kilometraje
  FROM public.kilometraje_jornadas AS metric
  WHERE metric.user_id = v_user_id AND metric.source_jornada_id = p_jornada_id;
  IF FOUND AND v_kilometraje.estado = 'PENDIENTE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Journey odometer capture is not finalized.';
  END IF;

  INSERT INTO public.billing_daily_records (
    user_id, source_jornada_id, source_fingerprint, work_date, source_closed_at, snapshot
  ) VALUES (
    v_user_id,
    v_jornada.id,
    v_jornada.fingerprint,
    (v_jornada.fecha_cierre AT TIME ZONE 'Europe/Madrid')::date,
    v_jornada.fecha_cierre,
    pg_catalog.jsonb_build_object(
      'id', v_jornada.id,
      'userId', v_user_id,
      'fingerprint', v_jornada.fingerprint,
      'fechaCierre', v_jornada.fecha_cierre,
      'resumen', v_jornada.resumen,
      'deliveries', v_jornada.deliveries,
      'sequence', v_jornada.sequence,
      'kilometrajeInicial', v_kilometraje.kilometraje_inicial,
      'kilometrajeFinal', v_kilometraje.kilometraje_final,
      'kilometrosRecorridos', v_kilometraje.kilometros_recorridos
    )
  ) ON CONFLICT (user_id, source_jornada_id) DO NOTHING;

  SELECT record.* INTO v_record
  FROM public.billing_daily_records AS record
  WHERE record.user_id = v_user_id AND record.source_jornada_id = p_jornada_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Billing record could not be confirmed.';
  END IF;
  RETURN NEXT v_record;
END;
$function$;

ALTER FUNCTION public.enviar_jornada_a_facturacion(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enviar_jornada_a_facturacion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_jornada_a_facturacion(text) TO authenticated;
