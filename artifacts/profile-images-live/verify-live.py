"""Live profile upload test with a temporary visitor; credentials stay in memory."""
from pathlib import Path
import base64,importlib.util,json,subprocess,tempfile,uuid,os
ROOT=Path(__file__).resolve().parents[2];os.chdir(ROOT)
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
report={'date':'2026-11-17','result':'failed','checks':[]};owner=str(uuid.uuid4());created=False;object_key=None;service_key=None

def raw(url,method='GET',headers=None,payload=None,file_path=None,output=None):
 config=['url = '+json.dumps(url),'request = '+json.dumps(method),'write-out = "\\n%{http_code}"']
 for k,v in (headers or {}).items():config.append('header = '+json.dumps(k+': '+v))
 if payload is not None:config.append('data = '+json.dumps(json.dumps(payload)))
 if file_path:config.append('data-binary = '+json.dumps('@'+str(file_path)))
 if output:config.append('output = '+json.dumps(str(output)))
 p=subprocess.run(['/usr/bin/curl','--silent','--show-error','--max-time','40','--config','-'],input='\n'.join(config),capture_output=True,text=True,timeout=45)
 assert p.returncode==0,'Storage HTTP connection failed'
 body,status=p.stdout.rsplit('\n',1)
 return int(status),body

try:
 # Read the service key only for deleting the exact temporary storage object after the test.
 proc=subprocess.run(['supabase','projects','api-keys','--project-ref',api.PROJECT,'--output','json'],capture_output=True,text=True,check=True)
 keys=json.loads(proc.stdout)
 if isinstance(keys,dict):keys=keys.get('api_keys',keys.get('keys',[]))
 service_key=next(k['api_key'] for k in keys if k.get('name')=='service_role')
 guard=api.db('SELECT u.user_id,u.society,c.phone,s.registration_number FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society '+"WHERE u.deleted_at IS NULL AND 'security'=ANY(u.role) LIMIT 1;")[0]
 credentials={'phoneNumber':str(guard['phone']),'registrationNumber':guard['registration_number']}
 status,otp=api.post('get-otp',credentials,record=False);assert status==200 and otp.get('otp'),'Guard OTP request failed'
 status,login=api.post('verify-otp',{**credentials,'otp':otp['otp']},record=False);assert status==200 and login.get('token'),'Guard login failed'
 token=login['token']
 api.db('INSERT INTO public."SSP_Non_Society_User"(non_society_user_id,name,role,society,visitor_status,visitor_approval_status,pre_approved,is_otp_verified,hosted_by) '+f"VALUES('{owner}','Unknown Visitor','visitor','{guard['society']}','otp_pending','pending',false,false,'{guard['user_id']}') RETURNING non_society_user_id;")
 created=True;target={'ownerType':'non_society_user','ownerId':owner}
 status,result=api.post('profile-images',{'action':'FETCH',**target},record=False)
 assert status==401,'Unauthenticated image request must be rejected';report['checks'].append({'step':'unauthenticated request','http_status':status})
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=')
 common={**target,'fileName':'upload-verification.png'}
 status,prepared=api.post('profile-images',{'action':'PREPARE_UPLOAD',**common,'fileType':'image/png','fileSize':len(png)},token,record=False)
 assert status==200, 'PREPARE_UPLOAD failed: '+str(prepared.get('message',status))
 upload=prepared['data']['upload'];object_key=upload['objectKey'];report['checks'].append({'step':'PREPARE_UPLOAD','http_status':status})
 status,pending=api.post('profile-images',{'action':'CONFIRM_UPLOAD',**common,'objectKey':object_key},token,record=False)
 assert status==409,'Confirmation must require uploaded bytes';report['checks'].append({'step':'confirm before bytes uploaded','http_status':status})
 with tempfile.TemporaryDirectory(prefix='ssp-profile-test-') as tmp:
  tmp=Path(tmp);image=tmp/'pixel.png';image.write_bytes(png)
  status,_=raw(upload['uploadUrl'],upload['method'],upload['headers'],file_path=image,output=tmp/'upload.json')
  assert status in [200,201],'Signed image upload failed: '+str(status);report['checks'].append({'step':'PUT image bytes','http_status':status})
  status,confirmed=api.post('profile-images',{'action':'CONFIRM_UPLOAD',**common,'objectKey':object_key},token,record=False)
  assert status==200,'CONFIRM_UPLOAD failed: '+str(confirmed.get('message',status));assert confirmed['data']['image']['fileSize']==len(png)
  report['checks'].append({'step':'CONFIRM_UPLOAD','http_status':status})
  status,fetched=api.post('profile-images',{'action':'FETCH','owners':[target]},token,record=False)
  assert status==200 and fetched['data']['images'][0]['profileImageUrl'],'FETCH failed'
  report['checks'].append({'step':'FETCH','http_status':status})
  status,_=raw(fetched['data']['images'][0]['profileImageUrl'],output=tmp/'download.png')
  assert status==200 and (tmp/'download.png').read_bytes()==png,'Signed image download mismatch'
  report['checks'].append({'step':'signed image download, exact byte match','http_status':status})
 rows=api.db('SELECT file_type,file_size FROM public."SSP_Profile_Image" '+f"WHERE owner_type='non_society_user' AND owner_id='{owner}';")
 assert rows and rows[0]['file_type']=='image/png' and rows[0]['file_size']==len(png)
 report['metadata_verified']=True;report['result']='passed'
finally:
 if object_key and service_key:
  status,_=raw(f'https://{api.PROJECT}.supabase.co/storage/v1/object/profile-images','DELETE',{'Authorization':'Bearer '+service_key,'apikey':service_key,'Content-Type':'application/json'},payload={'prefixes':[object_key]})
  report['storage_test_object_removed']=status==200
 if created:
  api.db('DELETE FROM public."SSP_Non_Society_User" '+f"WHERE non_society_user_id='{owner}' AND name='Unknown Visitor' RETURNING non_society_user_id;")
  remaining=api.db('SELECT count(*) AS count FROM public."SSP_Profile_Image" '+f"WHERE owner_id='{owner}';")[0]['count']
  report['temporary_owner_and_metadata_removed']=remaining==0
 Path('artifacts/profile-images-live/verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
