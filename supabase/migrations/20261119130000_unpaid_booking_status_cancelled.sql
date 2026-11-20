-- Retain all resident cancellation history, including unpaid bookings without proof.
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
    lower(trim(coalesce(request_row.status, ''))) NOT IN ('waiting_payment', 'requested', 'pending_verification', 'cancelled')
  ) THEN RETURN false; END IF;

  -- A document created for a signed upload URL is not proof of an upload.
  -- Require an actual, non-empty stored object, or a submitted/settled payment status.
  IF v_payment_rec_id IS NOT NULL THEN
    retain_history := lower(trim(coalesce(payment_row.payment_status, ''))) IN
      ('successful', 'success', 'paid', 'completed', 'under review', 'under_review', 'processing')
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

  -- All resident cancellations preserve booking, payment and receipt history.
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

-- Proof submission and facility approval are independent states.
CREATE OR REPLACE FUNCTION public.confirm_resident_payment_proof(p_payment_id uuid,p_resident_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public."SSP_Payment"%ROWTYPE; facility_payment boolean; approval text;
BEGIN
 SELECT * INTO p FROM public."SSP_Payment" WHERE pay_rec_id=p_payment_id
   AND society_user IS NOT DISTINCT FROM p_resident_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('http_status',404,'message','Payment not found.'); END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='society-documents'
   AND coalesce((o.metadata->>'size')::numeric,0)>0
   AND (o.name=public.payment_receipt_object_key(p.receipt_url) OR EXISTS(
     SELECT 1 FROM public."SSP_Document" d WHERE d.payment=p.pay_rec_id
       AND o.name=public.payment_receipt_object_key(d.s3_path)))) THEN
   RETURN jsonb_build_object('http_status',409,'message','Receipt upload is incomplete. Upload the image before confirming payment.');
 END IF;
 facility_payment := replace(lower(btrim(coalesce(p.payment_type,''))),'_',' ')='facility booking'
   OR EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.payment=p.pay_rec_id);
 IF upper(btrim(coalesce(p.payment_status,''))) IN ('UNPAID','REJECTED','','UNDER REVIEW')
   AND NOT EXISTS(SELECT 1 FROM public."SSP_Facility_Booking" b WHERE b.payment=p.pay_rec_id)
   AND NOT EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.payment=p.pay_rec_id
     AND lower(btrim(coalesce(r.status,''))) NOT IN ('waiting_payment','pending_verification','requested','cancelled')) THEN
   UPDATE public."SSP_Payment" SET payment_status=CASE WHEN facility_payment THEN 'Successful' ELSE 'UNDER REVIEW' END
     WHERE pay_rec_id=p.pay_rec_id RETURNING * INTO p;
 END IF;
 SELECT coalesce(b.approval_status,b.booking_status) INTO approval FROM public."SSP_Facility_Booking" b WHERE b.payment=p.pay_rec_id LIMIT 1;
 IF approval IS NULL THEN SELECT r.status INTO approval FROM public."SSP_Facility_Booking_Request" r WHERE r.payment=p.pay_rec_id LIMIT 1; END IF;
 RETURN jsonb_build_object('payment_status',p.payment_status,'approval_status',approval);
END $$;
REVOKE ALL ON FUNCTION public.confirm_resident_payment_proof(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_resident_payment_proof(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_facility_payment_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF upper(btrim(coalesce(NEW.payment_status,''))) IN ('SUCCESSFUL','UNDER REVIEW') THEN
  UPDATE public."SSP_Facility_Booking_Request" SET status='pending_verification'
   WHERE payment=NEW.pay_rec_id AND (lower(btrim(coalesce(status,''))) IN ('waiting_payment','requested')
     OR (lower(btrim(coalesce(status,'')))='cancelled' AND upper(btrim(coalesce(OLD.payment_status,''))) IN ('UNPAID','PENDING','WAITING_PAYMENT')));
 ELSIF upper(btrim(coalesce(NEW.payment_status,'')))='REJECTED' THEN
  UPDATE public."SSP_Facility_Booking_Request" SET status='rejected',rejection_reason=NEW.rejection_reason,rejected_at=now()
   WHERE payment=NEW.pay_rec_id AND lower(btrim(coalesce(status,''))) IN ('waiting_payment','requested','pending_verification');
 END IF;
 RETURN NEW;
END $$;


-- Enforce unpaid booking status for every database writer, including legacy clients.
CREATE OR REPLACE FUNCTION public.cancel_unpaid_facility_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public."SSP_Payment" p WHERE p.pay_rec_id=NEW.payment
   AND lower(btrim(coalesce(p.payment_status,''))) IN ('unpaid','pending','waiting_payment')) THEN
   NEW.status := 'cancelled';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cancel_unpaid_facility_request ON public."SSP_Facility_Booking_Request";
CREATE TRIGGER cancel_unpaid_facility_request BEFORE INSERT OR UPDATE OF status,payment
ON public."SSP_Facility_Booking_Request" FOR EACH ROW EXECUTE FUNCTION public.cancel_unpaid_facility_request();

-- Correct existing unpaid requests, including Sumit Test 2. Keep payment unpaid
-- so genuine subsequent proof can still be submitted; explicit cancel sets both cancelled.
UPDATE public."SSP_Facility_Booking_Request" r SET status='cancelled'
FROM public."SSP_Payment" p WHERE p.pay_rec_id=r.payment
 AND lower(btrim(coalesce(p.payment_status,''))) IN ('unpaid','pending','waiting_payment')
 AND lower(btrim(coalesce(r.status,''))) IN ('waiting_payment','requested','pending_verification');
NOTIFY pgrst,'reload schema';
