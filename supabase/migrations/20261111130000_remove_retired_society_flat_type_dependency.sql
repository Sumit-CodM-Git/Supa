-- SSP_Society no longer stores a flat_type reference. Resident assignments
-- remain on SSP_Society_User, and society configuration on SSP_Flat_Type.
CREATE OR REPLACE FUNCTION public.deactivate_society_flat_type(p_society uuid, p_flat_type uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM 1 FROM public."SSP_Flat_Type"
    WHERE flat_type_id=p_flat_type AND society=p_society FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public."SSP_Society_User" SET flat_type_id=NULL
    WHERE society=p_society AND flat_type_id=p_flat_type;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public."SSP_Flat_Type" SET active=false, maintenance_charges=NULL
    WHERE flat_type_id=p_flat_type AND society=p_society;
  RETURN jsonb_build_object('clearedAssignments',v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.deactivate_society_flat_type(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_society_flat_type(uuid,uuid) TO service_role;
