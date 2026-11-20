BEGIN;
CREATE TEMP TABLE review_before ON COMMIT DROP AS SELECT request_id,status FROM public."SSP_Facility_Booking_Request";
-- Payment proof submission must also stop the booking from asking for payment.
CREATE OR REPLACE FUNCTION public.sync_facility_payment_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF upper(btrim(coalesce(NEW.payment_status, ''))) = 'UNDER REVIEW' THEN
    UPDATE public."SSP_Facility_Booking_Request"
    SET status = 'pending_verification'
    WHERE payment = NEW.pay_rec_id
      AND lower(btrim(coalesce(status, ''))) = 'waiting_payment';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_facility_payment_review() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_facility_payment_review
AFTER UPDATE OF payment_status ON public."SSP_Payment"
FOR EACH ROW EXECUTE FUNCTION public.sync_facility_payment_review();

-- Repair the same mismatch for existing submitted proofs, preserving all
-- cancelled, rejected, approved and otherwise progressed booking requests.
UPDATE public."SSP_Facility_Booking_Request" r
SET status = 'pending_verification'
FROM public."SSP_Payment" p
WHERE r.payment = p.pay_rec_id
  AND upper(btrim(coalesce(p.payment_status, ''))) = 'UNDER REVIEW'
  AND lower(btrim(coalesce(r.status, ''))) = 'waiting_payment';

INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261118120000','sync_facility_payment_review',ARRAY[$migration$-- Payment proof submission must also stop the booking from asking for payment.
CREATE OR REPLACE FUNCTION public.sync_facility_payment_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF upper(btrim(coalesce(NEW.payment_status, ''))) = 'UNDER REVIEW' THEN
    UPDATE public."SSP_Facility_Booking_Request"
    SET status = 'pending_verification'
    WHERE payment = NEW.pay_rec_id
      AND lower(btrim(coalesce(status, ''))) = 'waiting_payment';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_facility_payment_review() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_facility_payment_review
AFTER UPDATE OF payment_status ON public."SSP_Payment"
FOR EACH ROW EXECUTE FUNCTION public.sync_facility_payment_review();

-- Repair the same mismatch for existing submitted proofs, preserving all
-- cancelled, rejected, approved and otherwise progressed booking requests.
UPDATE public."SSP_Facility_Booking_Request" r
SET status = 'pending_verification'
FROM public."SSP_Payment" p
WHERE r.payment = p.pay_rec_id
  AND upper(btrim(coalesce(p.payment_status, ''))) = 'UNDER REVIEW'
  AND lower(btrim(coalesce(r.status, ''))) = 'waiting_payment';
$migration$]);
SELECT count(*) AS requests_repaired FROM public."SSP_Facility_Booking_Request" r JOIN review_before b USING(request_id) WHERE r.status IS DISTINCT FROM b.status;
COMMIT;
