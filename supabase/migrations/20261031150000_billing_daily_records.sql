CREATE TABLE public.billing_daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  source_jornada_id text NOT NULL,
  source_fingerprint text NOT NULL,
  work_date date NOT NULL,
  source_closed_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT billing_daily_records_user_source_unique UNIQUE (user_id, source_jornada_id)
);

ALTER TABLE public.billing_daily_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_daily_records_select_own
  ON public.billing_daily_records FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.billing_daily_records TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billing_daily_records FROM anon, authenticated;

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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_jornada_id IS NULL OR p_jornada_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journey id is required.';
  END IF;

  -- Idempotent retries return the immutable original even if its source was later deleted.
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
      'sequence', v_jornada.sequence
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
