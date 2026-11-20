-- All fixture changes roll back, including assignment updates.
BEGIN;
DO $$
DECLARE s uuid; u uuid; f uuid := gen_random_uuid(); result jsonb; catalog jsonb; others jsonb;
BEGIN
  SELECT society,user_id INTO s,u FROM public."SSP_Society_User"
    WHERE society IS NOT NULL AND deleted_at IS NULL LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'A society user is required for this test'; END IF;
  SELECT jsonb_agg(to_jsonb(p)) INTO catalog FROM public."SSP_Picklist_Config" p;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY flat_type_id) INTO others
    FROM public."SSP_Flat_Type" t WHERE society IS DISTINCT FROM s;
  INSERT INTO public."SSP_Flat_Type"(flat_type_id,society,flat_type,maintenance_charges)
    VALUES(f,s,'Codex deactivation test',123);
  UPDATE public."SSP_Society_User" SET flat_type_id=f WHERE user_id=u;
  IF public.deactivate_society_flat_type(gen_random_uuid(),f) IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-society request succeeded';
  END IF;
  result := public.deactivate_society_flat_type(s,f);
  IF result->>'clearedAssignments' <> '1' THEN RAISE EXCEPTION 'Assignment count mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."SSP_Flat_Type" WHERE flat_type_id=f AND NOT active AND maintenance_charges IS NULL) THEN
    RAISE EXCEPTION 'Configuration was not retained as inactive';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public."SSP_Society_User" WHERE user_id=u AND flat_type_id IS NULL)
 THEN
    RAISE EXCEPTION 'Assignments were not cleared';
  END IF;
  IF catalog IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p)) FROM public."SSP_Picklist_Config" p)
    OR others IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY flat_type_id) FROM public."SSP_Flat_Type" t WHERE society IS DISTINCT FROM s) THEN
    RAISE EXCEPTION 'Shared catalog or another society changed';
  END IF;
END;
$$;
ROLLBACK;
