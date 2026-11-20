-- Exercise the deployed trigger using temporary fixtures; every write rolls back.
-- This verifies live database behavior, not a binary Storage API upload or app UI.
BEGIN;
DO $$
DECLARE
  fixture_id uuid;
  object_key text := 'codex-verification/receipt-review-' || gen_random_uuid()::text || '.jpg';
  saved_status text;
BEGIN
  INSERT INTO public."SSP_Payment" (amount,payment_status,receipt_url)
    VALUES (1,'unpaid','https://isrqhkshygauaehwfycw.supabase.co/storage/v1/object/public/society-documents/' || object_key)
    RETURNING pay_rec_id INTO fixture_id;
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=fixture_id;
  IF saved_status <> 'unpaid' THEN RAISE EXCEPTION 'Preparing receipt changed status'; END IF;
  INSERT INTO storage.objects (bucket_id,name,metadata)
    VALUES ('society-documents',object_key,'{"size":0}'::jsonb);
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=fixture_id;
  IF saved_status <> 'unpaid' THEN RAISE EXCEPTION 'Empty receipt changed status'; END IF;
  UPDATE storage.objects SET metadata='{"size":100}'::jsonb
    WHERE bucket_id='society-documents' AND name=object_key;
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=fixture_id;
  IF saved_status <> 'UNDER REVIEW' THEN RAISE EXCEPTION 'Completed receipt did not enter review'; END IF;
  UPDATE public."SSP_Payment" SET payment_status='REJECTED' WHERE pay_rec_id=fixture_id;
  UPDATE storage.objects SET metadata='{"size":200}'::jsonb
    WHERE bucket_id='society-documents' AND name=object_key;
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=fixture_id;
  IF saved_status <> 'REJECTED' THEN RAISE EXCEPTION 'Metadata maintenance reversed rejection'; END IF;
  object_key := object_key || '-new';
  UPDATE public."SSP_Payment" SET receipt_url=object_key WHERE pay_rec_id=fixture_id;
  INSERT INTO storage.objects (bucket_id,name,metadata)
    VALUES ('society-documents',object_key,'{"size":100}'::jsonb);
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=fixture_id;
  IF saved_status <> 'UNDER REVIEW' THEN RAISE EXCEPTION 'New receipt did not resubmit rejection'; END IF;
  object_key := object_key || '-paid';
  UPDATE public."SSP_Payment" SET receipt_url=object_key,payment_status='PAID' WHERE pay_rec_id=fixture_id;
  INSERT INTO storage.objects (bucket_id,name,metadata)
    VALUES ('society-documents',object_key,'{"size":100}'::jsonb);
  SELECT payment_status INTO saved_status FROM public."SSP_Payment" WHERE pay_rec_id=fixture_id;
  IF saved_status <> 'PAID' THEN RAISE EXCEPTION 'Upload modified paid payment'; END IF;
END;
$$;
SELECT 'passed' AS live_database_trigger_checks, 'All fixture writes rolled back; Storage HTTP upload and UI not tested' AS scope;
ROLLBACK;
