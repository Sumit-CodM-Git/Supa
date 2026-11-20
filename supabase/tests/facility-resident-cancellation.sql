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
  confirmed_id text;
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

  IF public.cancel_resident_facility_booking(v_request_id::text, gen_random_uuid()) THEN
    RAISE EXCEPTION 'Foreign resident cancelled request';
  END IF;
  INSERT INTO public."SSP_Facility_Booking"
    (requested_by,facility,payment,booking_start_date,booking_end_date,approval_status,booking_status)
  VALUES (owner_id,facility_id,v_payment_id,'2090-01-01 10:00:00','2090-01-01 11:00:00','approved','approved')
  RETURNING name::text INTO confirmed_id;
  UPDATE public."SSP_Payment" SET payment_status='Paid' WHERE pay_rec_id=v_payment_id;
  IF NOT public.cancel_resident_facility_booking(confirmed_id, owner_id) THEN
    RAISE EXCEPTION 'Confirmed booking ID rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM public."SSP_Facility_Booking" WHERE payment=v_payment_id)
    OR EXISTS (SELECT 1 FROM public."SSP_Facility_Booking_Request" WHERE request_id=v_request_id)
    OR NOT EXISTS (SELECT 1 FROM public."SSP_Payment" WHERE pay_rec_id=v_payment_id AND payment_status='cancelled') THEN
    RAISE EXCEPTION 'Linked cancellation deletion incomplete';
  END IF;
  IF public.cancel_resident_facility_booking(v_request_id::text,owner_id) THEN
    RAISE EXCEPTION 'Removed request should return false';
  END IF;
END;
$$;
ROLLBACK;
