-- Propuesta de migración: Retirada de jornadas de Facturación
-- Permite al usuario autenticado eliminar únicamente su propio registro en billing_daily_records.
-- No borra ni modifica datos en registro_jornadas, kilometraje_jornadas, decas ni rutas.

CREATE OR REPLACE FUNCTION public.eliminar_jornada_facturacion(p_source_jornada_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_deleted boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_source_jornada_id IS NULL OR pg_catalog.btrim(p_source_jornada_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journey id is required.';
  END IF;

  DELETE FROM public.billing_daily_records AS record
  WHERE record.user_id = v_user_id
    AND record.source_jornada_id = p_source_jornada_id;

  v_deleted := FOUND;
  RETURN v_deleted;
END;
$function$;

ALTER FUNCTION public.eliminar_jornada_facturacion(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.eliminar_jornada_facturacion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_jornada_facturacion(text) TO authenticated;
