CREATE OR REPLACE FUNCTION public.enforce_facility_image_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.facility IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.facility IS NOT DISTINCT FROM NEW.facility THEN RETURN NEW; END IF;
  -- Serialize changes for this facility, including parallel upload batches.
  PERFORM 1 FROM public."SSP_Facility" WHERE id=NEW.facility FOR UPDATE;
  IF (SELECT count(*) FROM public."SSP_Document"
      WHERE facility=NEW.facility AND document_id IS DISTINCT FROM NEW.document_id) >= 5 THEN
    RAISE EXCEPTION 'A facility can have a maximum of 5 images.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_facility_image_limit ON public."SSP_Document";
CREATE TRIGGER enforce_facility_image_limit
BEFORE INSERT OR UPDATE OF facility ON public."SSP_Document"
FOR EACH ROW EXECUTE FUNCTION public.enforce_facility_image_limit();
