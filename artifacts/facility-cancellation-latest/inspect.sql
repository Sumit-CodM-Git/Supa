SELECT r.request_id,r.created_at,r.status,r.payment,r.requested_by,p.payment_status,p.receipt_url,
(SELECT jsonb_agg(jsonb_build_object('path',d.s3_path,'uploaded',EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='society-documents' AND o.name=public.payment_receipt_object_key(d.s3_path) AND coalesce((o.metadata->>'size')::numeric,0)>0))) FROM public."SSP_Document" d WHERE d.payment=r.payment) AS documents,
EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='society-documents' AND o.name=public.payment_receipt_object_key(p.receipt_url) AND coalesce((o.metadata->>'size')::numeric,0)>0) AS receipt_uploaded
FROM public."SSP_Facility_Booking_Request" r LEFT JOIN public."SSP_Payment" p ON p.pay_rec_id=r.payment ORDER BY r.created_at DESC LIMIT 5;
