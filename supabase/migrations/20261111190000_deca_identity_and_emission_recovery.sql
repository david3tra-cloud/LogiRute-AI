ALTER TABLE public.transportistas_habituales
  ADD CONSTRAINT transportistas_habituales_user_id_id_key
  UNIQUE (user_id, id);

ALTER TABLE public.decas
  ADD COLUMN transportista_habitual_id uuid,
  ADD COLUMN emission_error text,
  ADD CONSTRAINT decas_transportista_habitual_owner_fkey
    FOREIGN KEY (user_id, transportista_habitual_id)
    REFERENCES public.transportistas_habituales (user_id, id)
    ON DELETE SET NULL (transportista_habitual_id);

CREATE OR REPLACE FUNCTION public.record_deca_emission_failure(
  p_deca_id uuid,
  p_emission_request_id uuid,
  p_error_message text
)
RETURNS SETOF public.decas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_error_message text := pg_catalog.left(
    pg_catalog.btrim(p_error_message),
    2000
  );
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required.';
  END IF;

  IF p_deca_id IS NULL OR p_emission_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The DeCA and emission request identifiers are required.';
  END IF;

  IF v_error_message IS NULL OR v_error_message = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The emission failure message is required.';
  END IF;

  RETURN QUERY
  UPDATE public.decas AS deca
  SET estado = 'BORRADOR',
      emission_request_id = NULL,
      emission_started_at = NULL,
      emission_error = v_error_message,
      updated_at = pg_catalog.now()
  WHERE deca.id = p_deca_id
    AND deca.user_id = v_user_id
    AND deca.deleted_at IS NULL
    AND deca.estado = 'EMITIENDO'
    AND deca.emission_request_id = p_emission_request_id
  RETURNING deca.*;
END;
$function$;

ALTER FUNCTION public.record_deca_emission_failure(uuid, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_deca_emission_failure(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_deca_emission_failure(uuid, uuid, text)
  TO authenticated;
