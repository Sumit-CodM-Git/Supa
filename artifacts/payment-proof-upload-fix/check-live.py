"""Real byte-upload regression; disposable resident, auth, and payment fixtures; no SMS/email."""
import base64,importlib.util,json,secrets,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('api',ROOT/'supabase/tests/live-visitor-name-check.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
folder=Path(__file__).parent
project=api.PROJECT;origin=f'https://{project}.supabase.co'
marker='PROOF-CHECK-'+uuid.uuid4().hex[:12].upper()
resident=str(uuid.uuid4())
contact_id=str(uuid.uuid4())
fixture_created=False
phone='000'+str(uuid.uuid4().int)[-7:]
report={'checks':[],'cleanup':{}}
auth_id=None;payment_id=None;object_key=None
image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=')
fixture=folder/'fixture.png';fixture.write_bytes(image)
def http(url,method='GET',body=None,token=None,apikey=None,binary=False):
 config=['url = '+json.dumps(url),'request = '+json.dumps(method),'write-out = "\\n%{http_code}"']
 if token:config+=['header = '+json.dumps('Authorization: Bearer '+token)]
 if apikey:config+=['header = '+json.dumps('apikey: '+apikey)]
 if body is not None:
  config+=['header = '+json.dumps('Content-Type: '+('image/png' if binary else 'application/json'))]
  config+=['data-binary = '+json.dumps('@'+str(fixture))] if binary else ['data = '+json.dumps(json.dumps(body))]
 p=subprocess.run(['/usr/bin/curl','--silent','--show-error','--max-time','40','--config','-'],input='\n'.join(config).encode(),capture_output=True,timeout=45)
 if p.returncode:raise RuntimeError('HTTP transfer failed; raw output withheld')
 raw,code=p.stdout.rsplit(b'\n',1)
 try:data=json.loads(raw)
 except Exception:data=raw
 return int(code),data
def check(name,ok,**details):
 report['checks'].append({'check':name,'passed':bool(ok),**details});print(name+': '+('PASS' if ok else 'FAIL'),flush=True)
 if not ok:raise RuntimeError(name)
try:
 p=subprocess.run(['supabase','projects','api-keys','--project-ref',project,'--output','json'],capture_output=True,text=True,timeout=45)
 if p.returncode:raise RuntimeError('Key lookup failed; raw output withheld')
 keys=json.loads(p.stdout);keys=keys if isinstance(keys,list) else keys.get('api_keys',keys.get('keys',[]))
 service=next(x['api_key'] for x in keys if x['name']=='service_role')
 anon=next(x['api_key'] for x in keys if x['name']=='anon')
 email=marker.lower()+'@example.invalid';password=secrets.token_urlsafe(32)
 otp=str(secrets.randbelow(900000)+100000)
 api.db(f"BEGIN; INSERT INTO public.\"SSP_Contact\" (contact_id,name,phone,email,society) VALUES ('{contact_id}','{marker}','{phone}','{email}','74628c82-7e11-4f5a-952a-d062193b3fb9'); INSERT INTO public.\"SSP_Society_User\" (user_id,contact,society,role,one_time_password_otp) VALUES ('{resident}','{contact_id}','74628c82-7e11-4f5a-952a-d062193b3fb9',ARRAY['resident'],'{otp}'); COMMIT;")
 fixture_created=True
 code,user=http(origin+'/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'user_metadata':{'user_id':resident}},service,service)
 check('Disposable test authentication created without sending messages',code in (200,201),http_status=code)
 auth_id=user['id']
 code,session=api.post('verify-otp',{'phoneNumber':phone,'registrationNumber':'GZB-1234-ab','otp':otp},record=False)
 check('Disposable resident app session issued',code==200 and bool(session.get('token')),http_status=code)
 token=session['token']
 payment_id=api.db('INSERT INTO public."SSP_Payment" (payment_id,amount,payment_status,payment_type,payment_method,society_user) '+f"VALUES ('{marker}',0,'unpaid','facility_booking','qr','{resident}') RETURNING pay_rec_id;")[0]['pay_rec_id']
 code,submitted=api.post('resident-payments-console',{'actionType':'SUBMIT_PAYMENT','societyRegistrationNumber':'GZB-1234-ab','paymentId':marker,'fileName':marker+'.png','fileType':'image/png','fileSize':len(image)},token,record=False)
 check('Payment API prepares signed upload URL',code==200 and bool(submitted.get('data',{}).get('uploadUrl')),http_status=code)
 data=submitted['data']
 paths=api.db(f"SELECT s3_path FROM public.\"SSP_Document\" WHERE payment='{payment_id}';")
 object_key=paths[0]['s3_path'].split('/society-documents/',1)[1]
 code,uploaded=http(data['uploadUrl'],'PUT',image,binary=True)
 check('Actual image bytes upload to signed URL',code in (200,201),http_status=code,error=uploaded if code not in (200,201) else None)
 state=api.db(f"SELECT payment_status FROM public.\"SSP_Payment\" WHERE pay_rec_id='{payment_id}';")[0]
 check('Upload automatically sets UNDER REVIEW without confirmation',state['payment_status']=='UNDER REVIEW',payment_status=state['payment_status'])
 code,fetched=api.post('resident-payments-console',{'actionType':'FETCH_OWN','societyRegistrationNumber':'GZB-1234-ab','search':marker},token,record=False)
 row=next((p for p in fetched.get('data',{}).get('payments',[]) if p['customPaymentId']==payment_id),{})
 check('Payment list returns stored proof image',code==200 and bool(row.get('receiptUrl')),http_status=code)
 code,downloaded=http(row['receiptUrl'])
 check('Downloaded proof matches uploaded bytes',code==200 and downloaded==image,http_status=code,bytes=len(downloaded))
 report['result']='passed'
except Exception as e:
 import traceback;traceback.print_tb(e.__traceback__);report['result']='failed';report['error']=str(e) if isinstance(e,RuntimeError) else type(e).__name__;print('Check stopped: '+report['error'],flush=True)
finally:
 if object_key:
  p=subprocess.run(['supabase','storage','rm','ss:///society-documents/'+object_key,'--linked','--project-ref',project,'--experimental','--yes'],capture_output=True,text=True,timeout=45)
  report['cleanup']['storage_object_removed']=p.returncode==0
 if payment_id:
  api.db(f"DELETE FROM public.\"SSP_Document\" WHERE payment='{payment_id}'; DELETE FROM public.\"SSP_Payment\" WHERE pay_rec_id='{payment_id}' AND payment_id='{marker}';")
  report['cleanup']['test_payment_removed']=True
 if auth_id:
  code,_=http(origin+'/auth/v1/admin/users/'+auth_id,'DELETE',token=service,apikey=service)
  report['cleanup']['disposable_auth_removed']=code in (200,204)
 if fixture_created:
  api.db(f"BEGIN; DELETE FROM public.\"SSP_Society_User\" WHERE user_id='{resident}'; DELETE FROM public.\"SSP_Contact\" WHERE contact_id='{contact_id}'; COMMIT;")
  report['cleanup']['disposable_resident_removed']=True
 (folder/'live-result.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
raise SystemExit(0 if report.get('result')=='passed' and all(report['cleanup'].values()) else 1)
