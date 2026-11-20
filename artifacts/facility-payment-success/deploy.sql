BEGIN;
CREATE TEMP TABLE before_success_status ON COMMIT DROP AS SELECT pay_rec_id,payment_status FROM public."SSP_Payment";
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
     AND lower(btrim(coalesce(r.status,''))) NOT IN ('waiting_payment','pending_verification','requested')) THEN
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
   WHERE payment=NEW.pay_rec_id AND lower(btrim(coalesce(status,''))) IN ('waiting_payment','requested');
 ELSIF upper(btrim(coalesce(NEW.payment_status,'')))='REJECTED' THEN
  UPDATE public."SSP_Facility_Booking_Request" SET status='rejected',rejection_reason=NEW.rejection_reason,rejected_at=now()
   WHERE payment=NEW.pay_rec_id AND lower(btrim(coalesce(status,''))) IN ('waiting_payment','requested','pending_verification');
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.review_uploaded_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate record;
BEGIN
 IF NEW.bucket_id<>'society-documents' OR coalesce((NEW.metadata->>'size')::numeric,0)<=0 THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF coalesce((OLD.metadata->>'size')::numeric,0)>0 THEN RETURN NEW; END IF;
 END IF;
 FOR candidate IN SELECT pay_rec_id,society_user FROM public."SSP_Payment" p
   WHERE public.payment_receipt_object_key(p.receipt_url)=NEW.name OR EXISTS(
     SELECT 1 FROM public."SSP_Document" d WHERE d.payment=p.pay_rec_id AND public.payment_receipt_object_key(d.s3_path)=NEW.name)
 LOOP PERFORM public.confirm_resident_payment_proof(candidate.pay_rec_id,candidate.society_user); END LOOP;
 RETURN NEW;
END $$;

-- Convert only pending facility submissions with actual stored proof. Paid,
-- rejected, cancelled, approved and missing-upload records remain unchanged.
DO $$ DECLARE candidate record;
BEGIN
 FOR candidate IN SELECT p.pay_rec_id,p.society_user FROM public."SSP_Payment" p
   WHERE upper(btrim(coalesce(p.payment_status,''))) IN ('UNPAID','UNDER REVIEW')
   AND (replace(lower(btrim(coalesce(p.payment_type,''))),'_',' ')='facility booking'
     OR EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.payment=p.pay_rec_id))
 LOOP PERFORM public.confirm_resident_payment_proof(candidate.pay_rec_id,candidate.society_user); END LOOP;
END $$;
NOTIFY pgrst,'reload schema';

INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261118140000','successful_facility_payment_pending_approval',ARRAY[$migration$-- Proof submission and facility approval are independent states.
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
     AND lower(btrim(coalesce(r.status,''))) NOT IN ('waiting_payment','pending_verification','requested')) THEN
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
   WHERE payment=NEW.pay_rec_id AND lower(btrim(coalesce(status,''))) IN ('waiting_payment','requested');
 ELSIF upper(btrim(coalesce(NEW.payment_status,'')))='REJECTED' THEN
  UPDATE public."SSP_Facility_Booking_Request" SET status='rejected',rejection_reason=NEW.rejection_reason,rejected_at=now()
   WHERE payment=NEW.pay_rec_id AND lower(btrim(coalesce(status,''))) IN ('waiting_payment','requested','pending_verification');
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.review_uploaded_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate record;
BEGIN
 IF NEW.bucket_id<>'society-documents' OR coalesce((NEW.metadata->>'size')::numeric,0)<=0 THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF coalesce((OLD.metadata->>'size')::numeric,0)>0 THEN RETURN NEW; END IF;
 END IF;
 FOR candidate IN SELECT pay_rec_id,society_user FROM public."SSP_Payment" p
   WHERE public.payment_receipt_object_key(p.receipt_url)=NEW.name OR EXISTS(
     SELECT 1 FROM public."SSP_Document" d WHERE d.payment=p.pay_rec_id AND public.payment_receipt_object_key(d.s3_path)=NEW.name)
 LOOP PERFORM public.confirm_resident_payment_proof(candidate.pay_rec_id,candidate.society_user); END LOOP;
 RETURN NEW;
END $$;

-- Convert only pending facility submissions with actual stored proof. Paid,
-- rejected, cancelled, approved and missing-upload records remain unchanged.
DO $$ DECLARE candidate record;
BEGIN
 FOR candidate IN SELECT p.pay_rec_id,p.society_user FROM public."SSP_Payment" p
   WHERE upper(btrim(coalesce(p.payment_status,''))) IN ('UNPAID','UNDER REVIEW')
   AND (replace(lower(btrim(coalesce(p.payment_type,''))),'_',' ')='facility booking'
     OR EXISTS(SELECT 1 FROM public."SSP_Facility_Booking_Request" r WHERE r.payment=p.pay_rec_id))
 LOOP PERFORM public.confirm_resident_payment_proof(candidate.pay_rec_id,candidate.society_user); END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
$migration$]);
SELECT count(*) AS payments_updated FROM public."SSP_Payment" p JOIN before_success_status b USING(pay_rec_id) WHERE p.payment_status IS DISTINCT FROM b.payment_status;
COMMIT;
