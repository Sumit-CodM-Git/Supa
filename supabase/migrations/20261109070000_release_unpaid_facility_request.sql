-- Release an unpaid reservation atomically, keeping payment/document history.
CREATE OR REPLACE FUNCTION public.release_unpaid_facility_request(
  p_request_id uuid,
  p_resident_id uuid,
  p_expired_before timestamptz DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  booking public."SSP_Facility_Booking_Request"%ROWTYPE;
  payment_row public."SSP_Payment"%ROWTYPE;
BEGIN
  SELECT * INTO booking FROM public."SSP_Facility_Booking_Request"
  WHERE request_id = p_request_id AND requested_by = p_resident_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF lower(trim(booking.status)) = 'cancelled' THEN RETURN true; END IF;
  IF lower(trim(booking.status)) NOT IN ('waiting_payment', 'requested', 'pending_verification')
     OR booking.status IS NULL THEN RETURN false; END IF;
  IF p_expired_before IS NOT NULL AND
     (booking.created_at IS NULL OR booking.created_at >= p_expired_before) THEN
    RETURN false;
  END IF;
  SELECT * INTO payment_row FROM public."SSP_Payment"
  WHERE pay_rec_id = booking.payment FOR UPDATE;
  IF NOT FOUND OR payment_row.society_user IS DISTINCT FROM p_resident_id THEN RETURN false; END IF;
  IF lower(trim(payment_row.payment_status)) NOT IN ('unpaid', 'pending', 'waiting_payment')
     OR payment_row.payment_status IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public."SSP_Facility_Booking" WHERE payment = booking.payment) THEN
    RETURN false;
  END IF;
  UPDATE public."SSP_Facility_Booking_Request" SET status = 'cancelled'
  WHERE request_id = booking.request_id;
  UPDATE public."SSP_Payment" SET payment_status = 'cancelled'
  WHERE pay_rec_id = payment_row.pay_rec_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.release_unpaid_facility_request(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_facility_request(uuid, uuid, timestamptz) TO service_role;
