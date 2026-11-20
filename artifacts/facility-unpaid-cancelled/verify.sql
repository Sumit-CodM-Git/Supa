BEGIN;
DO $$
DECLARE v_resident uuid; v_facility_id uuid; v_payment_id uuid; v_request_id uuid; v_proof_key text;
BEGIN
 SELECT user_id INTO v_resident FROM public."SSP_Society_User" LIMIT 1;
 SELECT id INTO v_facility_id FROM public."SSP_Facility" LIMIT 1;
 INSERT INTO public."SSP_Payment"(amount,payment_status,payment_type,society_user,facility)
 VALUES(1,'unpaid','facility_booking',v_resident,v_facility_id) RETURNING pay_rec_id INTO v_payment_id;
 INSERT INTO public."SSP_Facility_Booking_Request"(requested_by,facility,payment,status,booking_start_date,booking_end_date)
 VALUES(v_resident,v_facility_id,v_payment_id,'waiting_payment','2099-05-01 05:00','2099-05-01 06:00') RETURNING "SSP_Facility_Booking_Request".request_id INTO v_request_id;
 IF NOT EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.request_id=v_request_id AND status='cancelled') THEN RAISE EXCEPTION 'Unpaid request not cancelled'; END IF;
 v_proof_key:='unpaid-status-test/'||v_payment_id::text||'.png';
 UPDATE public."SSP_Payment" SET receipt_url=v_proof_key WHERE pay_rec_id=v_payment_id;
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('society-documents',v_proof_key,'{"size":12}'::jsonb);
 IF NOT EXISTS(SELECT 1 FROM public."SSP_Payment" WHERE pay_rec_id=v_payment_id AND payment_status='Successful') OR NOT EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.request_id=v_request_id AND status='pending_verification') THEN RAISE EXCEPTION 'Uploaded proof failed to submit booking'; END IF;
 IF NOT public.cancel_resident_facility_booking(v_request_id::text,v_resident) THEN RAISE EXCEPTION 'Cancellation failed'; END IF;
 PERFORM public.confirm_resident_payment_proof(v_payment_id,v_resident);
 IF NOT EXISTS(SELECT 1 FROM public."SSP_Payment" WHERE pay_rec_id=v_payment_id AND payment_status='cancelled') OR NOT EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.request_id=v_request_id AND status='cancelled') THEN RAISE EXCEPTION 'Explicit cancellation was reopened'; END IF;
END $$;
ROLLBACK;
