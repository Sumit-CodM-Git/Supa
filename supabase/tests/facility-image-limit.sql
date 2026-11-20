-- Uses temporary fixture rows and rolls every write back.
BEGIN;
DO $$
DECLARE
  v_society uuid;
  v_facility uuid;
  v_other_facility uuid;
  v_document uuid;
  v_rejected boolean;
  v_count integer;
BEGIN
  SELECT society_id INTO v_society FROM public."SSP_Society" LIMIT 1;
  INSERT INTO public."SSP_Facility" (name,society) VALUES ('IMAGE_LIMIT_TEST',v_society) RETURNING id INTO v_facility;
  INSERT INTO public."SSP_Facility" (name,society) VALUES ('IMAGE_BATCH_TEST',v_society) RETURNING id INTO v_other_facility;
  INSERT INTO public."SSP_Document" (facility,society,document_type,name)
  SELECT v_facility,v_society,'facility_attachment','test-'||n FROM generate_series(1,5) n;
  SELECT count(*) INTO v_count FROM public."SSP_Document" WHERE facility=v_facility;
  IF v_count<>5 THEN RAISE EXCEPTION 'Five images must be accepted'; END IF;
  v_rejected:=false;
  BEGIN
    INSERT INTO public."SSP_Document" (facility,document_type) VALUES (v_facility,'facility_attachment');
  EXCEPTION WHEN check_violation THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Sixth image was accepted'; END IF;
  UPDATE public."SSP_Document" SET name='metadata update' WHERE facility=v_facility;
  SELECT document_id INTO v_document FROM public."SSP_Document" WHERE facility=v_facility LIMIT 1;
  DELETE FROM public."SSP_Document" WHERE document_id=v_document;
  INSERT INTO public."SSP_Document" (facility,document_type) VALUES (v_facility,'facility_attachment');
  SELECT count(*) INTO v_count FROM public."SSP_Document" WHERE facility=v_facility;
  IF v_count<>5 THEN RAISE EXCEPTION 'Deleting one must permit one replacement'; END IF;
  v_rejected:=false;
  BEGIN
    INSERT INTO public."SSP_Document" (facility,document_type)
    SELECT v_other_facility,'facility_attachment' FROM generate_series(1,6);
  EXCEPTION WHEN check_violation THEN v_rejected:=true;
  END;
  SELECT count(*) INTO v_count FROM public."SSP_Document" WHERE facility=v_other_facility;
  IF NOT v_rejected OR v_count<>0 THEN RAISE EXCEPTION 'An oversized batch must roll back completely'; END IF;
  INSERT INTO public."SSP_Document" (facility,document_type) VALUES (v_other_facility,'facility_attachment') RETURNING document_id INTO v_document;
  v_rejected:=false;
  BEGIN
    UPDATE public."SSP_Document" SET facility=v_facility WHERE document_id=v_document;
  EXCEPTION WHEN check_violation THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Moving an image must enforce the destination cap'; END IF;
  INSERT INTO public."SSP_Document" (document_type)
  SELECT 'financial' FROM generate_series(1,6);
END;
$$;
ROLLBACK;
