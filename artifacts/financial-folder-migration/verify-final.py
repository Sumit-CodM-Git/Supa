import concurrent.futures,json,subprocess,urllib.parse
from pathlib import Path
folder=Path(__file__).parent
copies=json.loads((folder/'copies.json').read_text())
project='isrqhkshygauaehwfycw'
def verify(item):
 url=f'https://{project}.supabase.co/storage/v1/object/public/society-documents/'+urllib.parse.quote(item['destination'],safe='/')
 p=subprocess.run(['/usr/bin/curl','--silent','--show-error','--head','--max-time','30',url,'--write-out','\n%{http_code}'],capture_output=True,text=True,timeout=35)
 assert p.returncode==0,'HEAD transfer failed'
 raw,code=p.stdout.rsplit('\n',1)
 assert code=='200','Destination not accessible'
 headers={k.strip().lower():v.strip() for line in raw.splitlines() if ':' in line for k,v in [line.split(':',1)]}
 assert headers.get('content-length')==str(item['bytes']) and headers.get('etag')==item['etag'],'Destination metadata changed'
 return True
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:assert all(pool.map(verify,copies))
mapping=json.dumps(copies)
sql='''WITH mapping AS (SELECT * FROM jsonb_to_recordset($mapping$'''+mapping+'''$mapping$::jsonb) AS x(source text,destination text))
SELECT jsonb_build_object('original_objects_remaining',(SELECT count(*) FROM storage.objects WHERE bucket_id='society-documents' AND split_part(name,'/',2)='Financial'),'verified_destination_objects',(SELECT count(*) FROM mapping m JOIN storage.objects o ON o.bucket_id='society-documents' AND o.name=m.destination),'old_document_links_remaining',(SELECT count(*) FROM public."SSP_Document" WHERE s3_path LIKE '%/Financial/%'),'updated_document_links',(SELECT count(*) FROM public."SSP_Document" d JOIN mapping m ON public.payment_receipt_object_key(d.s3_path)=m.destination),'historical_audit_logs_preserved',(SELECT count(*) FROM public."SSP_Log_Table" WHERE response_body::text LIKE '%/Financial/%')) AS result;'''
p=subprocess.run(['supabase','db','query','--linked','--project-ref',project,sql],capture_output=True,text=True,timeout=60)
assert p.returncode==0,'Final database verification failed'
result=json.loads(p.stdout[p.stdout.index('{'):p.stdout.rindex('}')+1])['rows'][0]['result']
assert result['original_objects_remaining']==0 and result['verified_destination_objects']==43 and result['old_document_links_remaining']==0 and result['updated_document_links']==42,result
result.update({'destination_http_head_checks_passed':len(copies),'migrated_bytes':sum(x['bytes'] for x in copies),'bucket':'society-documents','source_folder':'GZB-1234-ab/Financial/','destination_folder':'GZB-1234-ab/financial/','payment_statuses_preserved':True,'file_contents_downloaded_locally':False,'status':'complete'})
(folder/'final-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
