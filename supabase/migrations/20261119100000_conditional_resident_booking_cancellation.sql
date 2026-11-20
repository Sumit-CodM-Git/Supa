-- Delete abandoned unpaid bookings; retain submitted/paid cancellation history.
CREATE OR REPLACE FUNCTION public.cancel_resident_facility_booking(
  p_booking_id text, p_resident_id uuid, p_unpaid_only boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  request_row public."SSP_Facility_Booking_Request"%ROWTYPE;
  booking_row public."SSP_Facility_Booking"%ROWTYPE;
  v_payment_rec_id uuid;
  payment_row public."SSP_Payment"%ROWTYPE;
  retain_history boolean := false;
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
    SELECT * INTO payment_row FROM public."SSP_Payment"
    WHERE pay_rec_id = v_payment_rec_id AND society_user = p_resident_id
      AND (NOT p_unpaid_only OR lower(trim(payment_status)) IN ('unpaid', 'pending', 'waiting_payment'))
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;

  IF p_unpaid_only AND (
    v_payment_rec_id IS NULL OR request_row.request_id IS NULL OR
    lower(trim(coalesce(request_row.status, ''))) NOT IN ('waiting_payment', 'requested', 'pending_verification')
  ) THEN RETURN false; END IF;

  -- A document created for a signed upload URL is not proof of an upload.
  -- Require an actual, non-empty stored object, or a submitted/settled payment status.
  IF v_payment_rec_id IS NOT NULL THEN
    retain_history := lower(trim(coalesce(payment_row.payment_status, ''))) NOT IN
      ('', 'unpaid', 'pending', 'waiting_payment')
      OR EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'society-documents'
          AND coalesce((o.metadata->>'size')::numeric, 0) > 0
          AND (o.name = public.payment_receipt_object_key(payment_row.receipt_url)
            OR EXISTS (SELECT 1 FROM public."SSP_Document" d
              WHERE d.payment = v_payment_rec_id
                AND o.name = public.payment_receipt_object_key(d.s3_path)))
      );
  END IF;
  -- Abort must never remove a submitted payment, even during an upload race.
  IF p_unpaid_only AND retain_history THEN RETURN false; END IF;

  IF retain_history THEN
    UPDATE public."SSP_Facility_Booking_Request" SET status = 'cancelled'
    WHERE requested_by = p_resident_id
      AND (request_id = request_row.request_id OR payment = v_payment_rec_id);
    UPDATE public."SSP_Facility_Booking"
    SET booking_status = 'cancelled', approval_status = 'cancelled', payment_status = 'cancelled'
    WHERE requested_by = p_resident_id
      AND (name = booking_row.name OR payment = v_payment_rec_id);
    UPDATE public."SSP_Payment" SET payment_status = 'cancelled'
    WHERE pay_rec_id = v_payment_rec_id AND society_user = p_resident_id;
    RETURN true;
  END IF;

  -- Booking and payment removal commit together or all roll back.
  DELETE FROM public."SSP_Facility_Booking"
  WHERE requested_by = p_resident_id
    AND (name = booking_row.name OR payment = v_payment_rec_id);
  DELETE FROM public."SSP_Facility_Booking_Request"
  WHERE requested_by = p_resident_id
    AND (request_id = request_row.request_id OR payment = v_payment_rec_id);
  -- Preserve receipt documents while clearing their foreign key to the deleted payment.
  UPDATE public."SSP_Document" SET payment = NULL WHERE payment = v_payment_rec_id;
  DELETE FROM public."SSP_Payment"
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
