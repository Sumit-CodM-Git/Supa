-- Accept request IDs and confirmed facilityBookingId values from resident lists.
CREATE OR REPLACE FUNCTION public.cancel_resident_facility_booking(
  p_booking_id text, p_resident_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  request_row public."SSP_Facility_Booking_Request"%ROWTYPE;
  booking_row public."SSP_Facility_Booking"%ROWTYPE;
  payment_id uuid;
BEGIN
  SELECT * INTO request_row FROM public."SSP_Facility_Booking_Request"
  WHERE request_id::text = p_booking_id AND requested_by = p_resident_id
  FOR UPDATE;
  IF FOUND THEN
    payment_id := request_row.payment;
  ELSE
    SELECT * INTO booking_row FROM public."SSP_Facility_Booking"
    WHERE name::text = p_booking_id AND requested_by = p_resident_id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    payment_id := booking_row.payment;
  END IF;

  -- Lock and verify payment ownership before changing any record.
  IF payment_id IS NOT NULL THEN
    PERFORM 1 FROM public."SSP_Payment"
    WHERE pay_rec_id = payment_id AND society_user = p_resident_id FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;

  UPDATE public."SSP_Facility_Booking_Request" SET status = 'cancelled'
  WHERE requested_by = p_resident_id
    AND (request_id = request_row.request_id OR payment = payment_id);
  UPDATE public."SSP_Facility_Booking"
  SET booking_status = 'cancelled', approval_status = 'cancelled', payment_status = 'cancelled'
  WHERE requested_by = p_resident_id
    AND (name = booking_row.name OR payment = payment_id);
  UPDATE public."SSP_Payment" SET payment_status = 'cancelled'
  WHERE pay_rec_id = payment_id AND society_user = p_resident_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_resident_facility_booking(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_resident_facility_booking(text, uuid) TO service_role;
