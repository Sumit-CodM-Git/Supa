CREATE TEMP TABLE financial_reference_audit(table_name text,column_name text,matches bigint);
DO $$ DECLARE c record; n bigint;
BEGIN
 FOR c IN SELECT table_name,column_name FROM information_schema.columns
 WHERE table_schema='public' AND data_type IN ('text','character varying','character','json','jsonb','ARRAY') LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text LIKE %L',c.table_name,c.column_name,'%/Financial/%') INTO n;
  IF n>0 THEN INSERT INTO financial_reference_audit VALUES(c.table_name,c.column_name,n); END IF;
 END LOOP;
END $$;
SELECT jsonb_build_object(
 'source_objects',(SELECT jsonb_agg(jsonb_build_object('id',id,'source',name,'destination',split_part(name,'/',1)||'/financial/'||substring(name FROM length(split_part(name,'/',1))+12),'metadata',metadata,'created_at',created_at)) FROM storage.objects WHERE bucket_id='society-documents' AND split_part(name,'/',2)='Financial'),
 'reference_columns',(SELECT jsonb_agg(to_jsonb(a)) FROM financial_reference_audit a),
 'payment_status_counts',(SELECT jsonb_object_agg(payment_status,n) FROM (SELECT payment_status,count(*) n FROM public."SSP_Payment" GROUP BY payment_status)s)
) AS preflight;
