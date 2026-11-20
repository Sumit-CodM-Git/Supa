BEGIN;
-- Resident cancellation removes booking rows and retains a cancelled payment ledger entry.
CREATE OR REPLACE FUNCTION public.cancel_resident_facility_booking(
  p_booking_id text, p_resident_id uuid, p_unpaid_only boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  request_row public."SSP_Facility_Booking_Request"%ROWTYPE;
  booking_row public."SSP_Facility_Booking"%ROWTYPE;
  v_payment_rec_id uuid;
BEGIN
  SELECT * INTO request_row FROM public."SSP_Facility_Booking_Request"
  WHERE request_id::text = p_booking_id AND requested_by = p_resident_id
  FOR UPDATE;
  IF FOUND THEN
    v_payment_rec_id := request_row.payment;
  ELSE
    SELECT * INTO booking_row FROM public."SSP_Facility_Booking"
    WHERE name::text = p_booking_id AND requested_by = p_resident_id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    v_payment_rec_id := booking_row.payment;
  END IF;

  -- Lock and verify payment ownership before changing any record.
  IF v_payment_rec_id IS NOT NULL THEN
    PERFORM 1 FROM public."SSP_Payment"
    WHERE pay_rec_id = v_payment_rec_id AND society_user = p_resident_id
      AND (NOT p_unpaid_only OR lower(trim(payment_status)) IN ('unpaid', 'pending', 'waiting_payment'))
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;

  IF p_unpaid_only AND (
    v_payment_rec_id IS NULL OR request_row.request_id IS NULL OR
    lower(trim(coalesce(request_row.status, ''))) NOT IN ('waiting_payment', 'requested', 'pending_verification')
  ) THEN RETURN false; END IF;

  -- Payment update and physical removal commit together or all roll back.
  DELETE FROM public."SSP_Facility_Booking"
  WHERE requested_by = p_resident_id
    AND (name = booking_row.name OR payment = v_payment_rec_id);
  DELETE FROM public."SSP_Facility_Booking_Request"
  WHERE requested_by = p_resident_id
    AND (request_id = request_row.request_id OR payment = v_payment_rec_id);
  UPDATE public."SSP_Payment" SET payment_status = 'cancelled'
  WHERE pay_rec_id = v_payment_rec_id AND society_user = p_resident_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_resident_facility_booking(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_resident_facility_booking(text, uuid, boolean) TO service_role;

-- Preserve the existing two-argument RPC contract for cancel_booking.
CREATE OR REPLACE FUNCTION public.cancel_resident_facility_booking(
  p_booking_id text, p_resident_id uuid
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.cancel_resident_facility_booking(p_booking_id, p_resident_id, false);
$$;
REVOKE ALL ON FUNCTION public.cancel_resident_facility_booking(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_resident_facility_booking(text, uuid) TO service_role;

DO $$
DECLARE
 owner_id uuid; facility_id uuid; v_payment_rec_id uuid; v_request_id uuid; booking_id text;
 current_payment_status text; result boolean;
BEGIN
 SELECT user_id INTO owner_id FROM public."SSP_Society_User" LIMIT 1;
 SELECT id INTO facility_id FROM public."SSP_Facility" LIMIT 1;
 IF owner_id IS NULL OR facility_id IS NULL THEN RAISE EXCEPTION 'Fixtures need resident and facility'; END IF;
 FOREACH current_payment_status IN ARRAY ARRAY['unpaid','Successful','UNDER REVIEW','Paid','cancelled'] LOOP
  INSERT INTO public."SSP_Payment" (amount,payment_status,society_user,facility)
  VALUES (1,current_payment_status,owner_id,facility_id) RETURNING pay_rec_id INTO v_payment_rec_id;
  INSERT INTO public."SSP_Facility_Booking_Request"
   (requested_by,facility,payment,status,created_at,booking_start_date,booking_end_date)
  VALUES (owner_id,facility_id,v_payment_rec_id,'waiting_payment',now(),'2090-01-01 10:00:00','2090-01-01 11:00:00')
  RETURNING "SSP_Facility_Booking_Request".request_id INTO v_request_id;
  INSERT INTO public."SSP_Facility_Booking"
   (requested_by,facility,payment,booking_start_date,booking_end_date,approval_status,booking_status)
  VALUES (owner_id,facility_id,v_payment_rec_id,'2090-01-01 10:00:00','2090-01-01 11:00:00','approved','approved')
  RETURNING name::text INTO booking_id;
  IF public.cancel_resident_facility_booking(v_request_id::text,gen_random_uuid()) THEN RAISE EXCEPTION 'Foreign owner accepted'; END IF;
  IF current_payment_status <> 'unpaid' AND public.cancel_resident_facility_booking(v_request_id::text,owner_id,true) THEN
   RAISE EXCEPTION 'Abort accepted protected payment %',current_payment_status;
  END IF;
  result := CASE WHEN current_payment_status='unpaid'
    THEN public.cancel_resident_facility_booking(v_request_id::text,owner_id,true)
    ELSE public.cancel_resident_facility_booking(booking_id,owner_id) END;
  IF NOT result THEN RAISE EXCEPTION 'Cancellation failed for %',current_payment_status; END IF;
  IF EXISTS (SELECT 1 FROM public."SSP_Facility_Booking" WHERE payment=v_payment_rec_id)
   OR EXISTS (SELECT 1 FROM public."SSP_Facility_Booking_Request" WHERE payment=v_payment_rec_id) THEN
   RAISE EXCEPTION 'Booking rows remain after cancellation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."SSP_Payment" WHERE pay_rec_id=v_payment_rec_id AND payment_status='cancelled') THEN
   RAISE EXCEPTION 'Cancelled payment ledger missing';
  END IF;
  IF public.cancel_resident_facility_booking(booking_id,owner_id) THEN RAISE EXCEPTION 'Deleted booking should return false'; END IF;
 END LOOP;
END;
$$;
ROLLBACK;
