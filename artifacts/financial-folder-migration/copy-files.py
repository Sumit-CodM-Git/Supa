"""Copy within Storage only; inspect HEAD metadata without downloading file bodies."""
import concurrent.futures,json,subprocess,urllib.parse
from pathlib import Path
folder=Path(__file__).parent
inventory=json.loads((folder/'inventory.json').read_text())
preflight=json.loads((folder/'reference-backup.json').read_text())
assert preflight['destination_collisions']==0
assert preflight['payments_affected_by_copy_trigger']==0
project='isrqhkshygauaehwfycw';base=f'https://{project}.supabase.co/storage/v1'
p=subprocess.run(['supabase','projects','api-keys','--project-ref',project,'--output','json'],capture_output=True,text=True,timeout=45)
if p.returncode:raise SystemExit('Key lookup failed; credential output withheld')
keys=json.loads(p.stdout);keys=keys if isinstance(keys,list) else keys.get('api_keys',keys.get('keys',[]))
key=next(x['api_key'] for x in keys if x['name']=='service_role')
def request(url,body=None):
 config=['url = '+json.dumps(url),'header = '+json.dumps('Authorization: Bearer '+key),'header = '+json.dumps('apikey: '+key),'write-out = "\\n%{http_code}"']
 if body is not None:config+=['request = "POST"','header = "Content-Type: application/json"','data = '+json.dumps(json.dumps(body))]
 p=subprocess.run(['/usr/bin/curl','--silent','--show-error','--max-time','45','--config','-']+(['--head'] if body is None else []),input='\n'.join(config),capture_output=True,text=True,timeout=50)
 if p.returncode:raise RuntimeError('Storage request failed: '+p.stderr[-300:])
 raw,code=p.stdout.rsplit('\n',1);return int(code),raw
journal=folder/'copies.json'
finished=json.loads(journal.read_text()) if journal.exists() else []
done={x['source'] for x in finished}
def copy(item):
 code,raw=request(base+'/object/public/society-documents/'+urllib.parse.quote(item['destination'],safe='/'))
 if code!=200:
  if code not in (400,404):raise RuntimeError('Unexpected destination HEAD HTTP '+str(code))
  code,raw=request(base+'/object/copy',{'bucketId':'society-documents','sourceKey':item['source'],'destinationKey':item['destination']})
  if code not in (200,201):raise RuntimeError('Copy failed HTTP '+str(code)+' for '+item['source']+': '+raw[:300])
 heads=[]
 for field in ['source','destination']:
  code,raw=request(base+'/object/public/society-documents/'+urllib.parse.quote(item[field],safe='/'))
  if code!=200:raise RuntimeError('HEAD verification failed HTTP '+str(code)+' for '+field)
  headers={k.strip().lower():v.strip() for line in raw.splitlines() if ':' in line for k,v in [line.split(':',1)]}
  heads.append(headers)
 assert heads[0].get('content-length')==heads[1].get('content-length')==str(item['metadata']['size']), 'Size mismatch'
 assert heads[0].get('etag') and heads[0]['etag']==heads[1].get('etag'), 'ETag mismatch'
 return {'source':item['source'],'destination':item['destination'],'bytes':int(heads[1]['content-length']),'etag':heads[1]['etag'],'head_verified':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 futures=[pool.submit(copy,item) for item in inventory['source_objects'] if item['source'] not in done]
 for future in concurrent.futures.as_completed(futures):
  finished.append(future.result());journal.write_text(json.dumps(finished,indent=2)+'\n')
  if len(finished)%5==0 or len(finished)==len(inventory['source_objects']):print(f'{len(finished)}/{len(inventory["source_objects"])} files copied and HEAD-verified',flush=True)
assert len(finished)==len(inventory['source_objects'])
print('All copies verified; original files retained pending database reference update.',flush=True)
