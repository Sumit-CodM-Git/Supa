BEGIN;
CREATE TEMP TABLE receipt_review_before ON COMMIT DROP AS SELECT pay_rec_id,payment_status FROM public."SSP_Payment";
-- Receipt links are created before the signed upload completes. Confirmation
-- remains supported, but older clients must not leave an uploaded payment unpaid.
CREATE OR REPLACE FUNCTION public.payment_receipt_object_key(p_reference text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_reference ~ '^https?://' THEN
      substring(p_reference FROM '^https?://[^/]+/storage/v1/object/(?:public|sign)/society-documents/([^?]+)')
    ELSE nullif(btrim(p_reference), '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.review_uploaded_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.bucket_id <> 'society-documents'
     OR coalesce((NEW.metadata->>'size')::numeric, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- Metadata maintenance on an existing receipt must not undo a later rejection.
  IF TG_OP = 'UPDATE' THEN
    IF coalesce((OLD.metadata->>'size')::numeric, 0) > 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  UPDATE public."SSP_Payment" AS p
  SET payment_status = 'UNDER REVIEW'
  WHERE upper(btrim(coalesce(p.payment_status, ''))) IN ('UNPAID', 'REJECTED', '')
    AND (
      public.payment_receipt_object_key(p.receipt_url) = NEW.name
      OR EXISTS (
        SELECT 1 FROM public."SSP_Document" AS d
        WHERE d.payment = p.pay_rec_id
          AND public.payment_receipt_object_key(d.s3_path) = NEW.name
      )
    );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_receipt_object_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_uploaded_payment_receipt() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER payment_receipt_upload_review
AFTER INSERT OR UPDATE OF metadata ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.review_uploaded_payment_receipt();

-- Repair existing unpaid records only when a nonempty uploaded object exists.
-- Preserve rejected receipts: their previous upload is not a new submission.
UPDATE public."SSP_Payment" AS p
SET payment_status = 'UNDER REVIEW'
WHERE upper(btrim(coalesce(p.payment_status, ''))) IN ('UNPAID', '')
  AND EXISTS (
    SELECT 1 FROM storage.objects AS o
    WHERE o.bucket_id = 'society-documents'
      AND coalesce((o.metadata->>'size')::numeric, 0) > 0
      AND (
        public.payment_receipt_object_key(p.receipt_url) = o.name
        OR EXISTS (
          SELECT 1 FROM public."SSP_Document" AS d
          WHERE d.payment = p.pay_rec_id
            AND public.payment_receipt_object_key(d.s3_path) = o.name
        )
      )
  );

INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('20261118100000','receipt_upload_payment_review',ARRAY[$migration$-- Receipt links are created before the signed upload completes. Confirmation
-- remains supported, but older clients must not leave an uploaded payment unpaid.
CREATE OR REPLACE FUNCTION public.payment_receipt_object_key(p_reference text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_reference ~ '^https?://' THEN
      substring(p_reference FROM '^https?://[^/]+/storage/v1/object/(?:public|sign)/society-documents/([^?]+)')
    ELSE nullif(btrim(p_reference), '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.review_uploaded_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.bucket_id <> 'society-documents'
     OR coalesce((NEW.metadata->>'size')::numeric, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- Metadata maintenance on an existing receipt must not undo a later rejection.
  IF TG_OP = 'UPDATE' THEN
    IF coalesce((OLD.metadata->>'size')::numeric, 0) > 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  UPDATE public."SSP_Payment" AS p
  SET payment_status = 'UNDER REVIEW'
  WHERE upper(btrim(coalesce(p.payment_status, ''))) IN ('UNPAID', 'REJECTED', '')
    AND (
      public.payment_receipt_object_key(p.receipt_url) = NEW.name
      OR EXISTS (
        SELECT 1 FROM public."SSP_Document" AS d
        WHERE d.payment = p.pay_rec_id
          AND public.payment_receipt_object_key(d.s3_path) = NEW.name
      )
    );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_receipt_object_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_uploaded_payment_receipt() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER payment_receipt_upload_review
AFTER INSERT OR UPDATE OF metadata ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.review_uploaded_payment_receipt();

-- Repair existing unpaid records only when a nonempty uploaded object exists.
-- Preserve rejected receipts: their previous upload is not a new submission.
UPDATE public."SSP_Payment" AS p
SET payment_status = 'UNDER REVIEW'
WHERE upper(btrim(coalesce(p.payment_status, ''))) IN ('UNPAID', '')
  AND EXISTS (
    SELECT 1 FROM storage.objects AS o
    WHERE o.bucket_id = 'society-documents'
      AND coalesce((o.metadata->>'size')::numeric, 0) > 0
      AND (
        public.payment_receipt_object_key(p.receipt_url) = o.name
        OR EXISTS (
          SELECT 1 FROM public."SSP_Document" AS d
          WHERE d.payment = p.pay_rec_id
            AND public.payment_receipt_object_key(d.s3_path) = o.name
        )
      )
  );
$migration$]);
SELECT count(*) AS repaired_payments FROM public."SSP_Payment" p JOIN receipt_review_before b USING(pay_rec_id) WHERE p.payment_status IS DISTINCT FROM b.payment_status;
COMMIT;
