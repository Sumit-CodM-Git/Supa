-- Exercises temporary fixtures only. Every write is rolled back.
BEGIN;
DO $$
DECLARE
  owner_id uuid;
  facility_id uuid;
  v_payment_id uuid;
  v_request_id uuid;
  result boolean;
  saved_status text;
  test_status text;
BEGIN
  SELECT u.user_id INTO owner_id FROM public."SSP_Society_User" u LIMIT 1;
  SELECT id INTO facility_id FROM public."SSP_Facility" LIMIT 1;
  IF owner_id IS NULL OR facility_id IS NULL THEN RAISE EXCEPTION 'Test requires a resident and facility'; END IF;
  INSERT INTO public."SSP_Payment" (amount,payment_status,society_user,facility)
  VALUES (2000,'unpaid',owner_id,facility_id) RETURNING pay_rec_id INTO v_payment_id;
  INSERT INTO public."SSP_Facility_Booking_Request"
    (requested_by,facility,payment,status,created_at,booking_start_date,booking_end_date)
  VALUES (owner_id,facility_id,v_payment_id,'WAITING_PAYMENT',now(), '2090-01-01 10:00:00','2090-01-01 11:00:00')
  RETURNING request_id INTO v_request_id;

  result := public.release_unpaid_facility_request(v_request_id,gen_random_uuid());
  IF result THEN RAISE EXCEPTION 'Wrong owner must not release'; END IF;
  result := public.release_unpaid_facility_request(v_request_id,owner_id,now()-interval '5 minutes');
  IF result THEN RAISE EXCEPTION 'Fresh hold must not expire'; END IF;

  FOREACH test_status IN ARRAY ARRAY['paid','UNDER REVIEW','rejected','cancelled'] LOOP
    UPDATE public."SSP_Payment" SET payment_status=test_status WHERE pay_rec_id=v_payment_id;
    result := public.release_unpaid_facility_request(v_request_id,owner_id);
    IF result THEN RAISE EXCEPTION 'Protected payment % was released',test_status; END IF;
  END LOOP;

  UPDATE public."SSP_Payment" SET payment_status='unpaid' WHERE pay_rec_id=v_payment_id;
  UPDATE public."SSP_Facility_Booking_Request" SET status='approved' WHERE "SSP_Facility_Booking_Request".request_id=v_request_id;
  result := public.release_unpaid_facility_request(v_request_id,owner_id);
  IF result THEN RAISE EXCEPTION 'Approved request must not release'; END IF;

  UPDATE public."SSP_Facility_Booking_Request" SET status='WAITING_PAYMENT' WHERE "SSP_Facility_Booking_Request".request_id=v_request_id;
  INSERT INTO public."SSP_Facility_Booking" (requested_by,facility,payment,booking_start_date,booking_end_date,approval_status,booking_status)
  VALUES (owner_id,facility_id,v_payment_id,'2090-01-01 10:00:00','2090-01-01 11:00:00','approved','approved');
  result := public.release_unpaid_facility_request(v_request_id,owner_id);
  IF result THEN RAISE EXCEPTION 'Confirmed booking must not release'; END IF;
  DELETE FROM public."SSP_Facility_Booking" WHERE payment=v_payment_id;
  result := public.release_unpaid_facility_request(v_request_id,owner_id);
  IF NOT result THEN RAISE EXCEPTION 'Unpaid uppercase request must release'; END IF;
  SELECT status INTO saved_status FROM public."SSP_Facility_Booking_Request" r WHERE r.request_id=v_request_id;
  IF saved_status <> 'cancelled' THEN RAISE EXCEPTION 'Request not cancelled'; END IF;
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=v_payment_id;
  IF saved_status <> 'cancelled' THEN RAISE EXCEPTION 'Payment not cancelled'; END IF;
  IF NOT public.release_unpaid_facility_request(v_request_id,owner_id) THEN RAISE EXCEPTION 'Repeat release must be idempotent'; END IF;
END;
$$;
ROLLBACK;
