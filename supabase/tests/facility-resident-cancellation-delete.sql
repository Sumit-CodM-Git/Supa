-- Disposable fixtures only; all writes roll back.
BEGIN;
DO $$
DECLARE
 owner_id uuid; facility_id uuid; v_payment_rec_id uuid; v_request_id uuid; booking_id text;
 current_payment_status text; result boolean;
BEGIN
 SELECT user_id INTO owner_id FROM public."SSP_Society_User" LIMIT 1;
 SELECT id INTO facility_id FROM public."SSP_Facility" LIMIT 1;
 IF owner_id IS NULL OR facility_id IS NULL THEN RAISE EXCEPTION 'Fixtures need resident and facility'; END IF;
 FOREACH current_payment_status IN ARRAY ARRAY['unpaid','Successful','UNDER REVIEW','Paid','cancelled','Rejected','proof_uploaded','upload_url_only'] LOOP
  INSERT INTO public."SSP_Payment" (amount,payment_status,society_user,facility)
  VALUES (1,CASE WHEN current_payment_status IN ('proof_uploaded','upload_url_only') THEN 'unpaid' ELSE current_payment_status END,owner_id,facility_id) RETURNING pay_rec_id INTO v_payment_rec_id;
  INSERT INTO public."SSP_Facility_Booking_Request"
   (requested_by,facility,payment,status,created_at,booking_start_date,booking_end_date)
  VALUES (owner_id,facility_id,v_payment_rec_id,'waiting_payment',now(),'2090-01-01 10:00:00','2090-01-01 11:00:00')
  RETURNING "SSP_Facility_Booking_Request".request_id INTO v_request_id;
  IF current_payment_status IN ('proof_uploaded','upload_url_only') THEN
    UPDATE public."SSP_Payment" SET receipt_url='cancel-test/' || v_payment_rec_id::text || '.png'
    WHERE pay_rec_id=v_payment_rec_id;
  END IF;
  IF current_payment_status = 'proof_uploaded' THEN
    INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES ('society-documents','cancel-test/' || v_payment_rec_id::text || '.png','{"size":12}'::jsonb);
    -- Simulate the short window before payment status synchronisation.
    UPDATE public."SSP_Payment" SET payment_status='unpaid' WHERE pay_rec_id=v_payment_rec_id;
  END IF;
  INSERT INTO public."SSP_Facility_Booking"
   (requested_by,facility,payment,booking_start_date,booking_end_date,approval_status,booking_status)
  VALUES (owner_id,facility_id,v_payment_rec_id,'2090-01-01 10:00:00','2090-01-01 11:00:00','approved','approved')
  RETURNING name::text INTO booking_id;
  IF public.cancel_resident_facility_booking(v_request_id::text,gen_random_uuid()) THEN RAISE EXCEPTION 'Foreign owner accepted'; END IF;
  IF current_payment_status NOT IN ('unpaid','upload_url_only') AND public.cancel_resident_facility_booking(v_request_id::text,owner_id,true) THEN
   RAISE EXCEPTION 'Abort accepted protected payment %',current_payment_status;
  END IF;
  result := CASE WHEN current_payment_status IN ('unpaid','upload_url_only')
    THEN public.cancel_resident_facility_booking(v_request_id::text,owner_id,true)
    ELSE public.cancel_resident_facility_booking(booking_id,owner_id) END;
  IF NOT result THEN RAISE EXCEPTION 'Cancellation failed for %',current_payment_status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."SSP_Payment" WHERE pay_rec_id=v_payment_rec_id AND payment_status='cancelled')
    OR NOT EXISTS (SELECT 1 FROM public."SSP_Facility_Booking_Request" WHERE payment=v_payment_rec_id AND status='cancelled')
    OR NOT EXISTS (SELECT 1 FROM public."SSP_Facility_Booking" WHERE payment=v_payment_rec_id AND booking_status='cancelled' AND approval_status='cancelled' AND payment_status='cancelled')
  THEN RAISE EXCEPTION 'Cancellation history or cancelled status missing for %',current_payment_status; END IF;
  IF NOT public.cancel_resident_facility_booking(booking_id,owner_id) THEN RAISE EXCEPTION 'Repeated cancellation failed'; END IF;
 END LOOP;
END;
$$;
ROLLBACK;
