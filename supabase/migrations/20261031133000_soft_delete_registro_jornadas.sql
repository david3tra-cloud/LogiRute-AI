ALTER TABLE public.registro_jornadas
  ADD COLUMN deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.eliminar_jornada_remota(p_id text)
RETURNS TABLE (id text, deleted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required.';
  END IF;

  RETURN QUERY
  UPDATE public.registro_jornadas AS jornada
  SET deleted_at = COALESCE(jornada.deleted_at, pg_catalog.now())
  WHERE jornada.user_id = auth.uid()
    AND jornada.id = p_id
  RETURNING jornada.id, jornada.deleted_at;
END;
$function$;

ALTER FUNCTION public.eliminar_jornada_remota(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.eliminar_jornada_remota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_jornada_remota(text) TO authenticated;
