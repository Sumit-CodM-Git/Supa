"""Disposable society/resident/facility end-to-end booking, proof upload, approval and receipt test. No money transfer or outbound messages."""
import base64,importlib.util,json,secrets,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('api',ROOT/'supabase/tests/live-visitor-name-check.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
folder=Path(__file__).parent
project=api.PROJECT;origin=f'https://{project}.supabase.co'
marker='COMPAT-CHECK-'+uuid.uuid4().hex[:12].upper()
resident=str(uuid.uuid4())
contact_id=str(uuid.uuid4())
fixture_created=False
society_id=str(uuid.uuid4())
facility_id=str(uuid.uuid4())
registration=marker
request_id=None
public_payment_id=None
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
 (folder/'live-result.json').write_text(json.dumps(report,indent=2)+'\n')
 if not ok:raise RuntimeError(name)
try:
 p=subprocess.run(['supabase','projects','api-keys','--project-ref',project,'--output','json'],capture_output=True,text=True,timeout=45)
 if p.returncode:raise RuntimeError('Key lookup failed; raw output withheld')
 keys=json.loads(p.stdout);keys=keys if isinstance(keys,list) else keys.get('api_keys',keys.get('keys',[]))
 service=next(x['api_key'] for x in keys if x['name']=='service_role')
 anon=next(x['api_key'] for x in keys if x['name']=='anon')
 email=marker.lower()+'@example.invalid';password=secrets.token_urlsafe(32)
 otp=str(secrets.randbelow(900000)+100000)
 api.db(f"BEGIN; INSERT INTO public.\"SSP_Society\" (society_id,society_name,registration_number) VALUES ('{society_id}','{marker}','{registration}'); INSERT INTO public.\"SSP_Contact\" (contact_id,name,phone,email,society) VALUES ('{contact_id}','{marker}','{phone}','{email}','{society_id}'); INSERT INTO public.\"SSP_Society_User\" (user_id,contact,society,role,status,one_time_password_otp) VALUES ('{resident}','{contact_id}','{society_id}',ARRAY['resident','admin'],true,'{otp}'); INSERT INTO public.\"SSP_Facility\" (id,name,society,base_price,is_chargeable,booking_mode,opening_time,closing_time,on_maintenance) VALUES ('{facility_id}','{marker}','{society_id}',1,true,'hourly','00:00','23:59',false); COMMIT;")
 fixture_created=True
 code,user=http(origin+'/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'user_metadata':{'user_id':resident}},service,service)
 check('Disposable test authentication created without sending messages',code in (200,201),http_status=code)
 auth_id=user['id']
 code,session=api.post('verify-otp',{'phoneNumber':phone,'registrationNumber':registration,'otp':otp},record=False)
 check('Disposable resident app session issued',code==200 and bool(session.get('token')),http_status=code)
 token=session['token']
 from datetime import datetime,timedelta,timezone
 start=(datetime.now(timezone(timedelta(hours=5,minutes=30)))+timedelta(days=2)).replace(hour=10,minute=0,second=0,microsecond=0)
 code,booked=api.post('resident-facility-booking',{'action':'book','societyRegistrationNumber':registration,'residentId':resident,'facilityName':marker,'bookingStartDateTime':start.isoformat(),'bookingEndDateTime':(start+timedelta(hours=1)).isoformat(),'paymentMode':'qr','purpose':marker,'isAllDay':False},token,record=False)
 check('Real booking API creates disposable request',code==200 and bool(booked.get('data',{}).get('facilityBooking')),http_status=code,error=booked.get('message'))
 booking=booked['data']['facilityBooking'];payment_id=booking['payRecId'];public_payment_id=booking['paymentId'];request_id=booking['requestId']
 report['booking']={'request_id':request_id,'payment_id':public_payment_id,'amount':booking['amount'],'initial_status':booking['status']}
 code,submitted=api.post('resident-payments-console',{'actionType':'SUBMIT_PAYMENT','societyRegistrationNumber':registration,'paymentId':public_payment_id,'fileName':marker+'.png','fileType':'image/png','fileSize':len(image)},token,record=False)
 check('Payment API prepares signed upload URL',code==200 and bool(submitted.get('data',{}).get('uploadUrl')),http_status=code)
 check('Legacy and merged clients receive identical upload fields',submitted.get('uploadUrl')==submitted['data'].get('uploadUrl') and submitted.get('documentId')==submitted['data'].get('documentId') and submitted.get('paymentSubmission')==submitted['data'].get('paymentSubmission') and submitted.get('errorResponse') is None)
 data=submitted # Execute the legacy top-level parser for the actual byte upload.
 paths=api.db(f"SELECT s3_path FROM public.\"SSP_Document\" WHERE payment='{payment_id}';")
 object_key=paths[0]['s3_path'].split('/society-documents/',1)[1]
 code,uploaded=http(data['uploadUrl'],'PUT',image,binary=True)
 check('Actual image bytes upload to signed URL',code in (200,201),http_status=code,error=uploaded if code not in (200,201) else None)
 state=api.db(f"SELECT payment_status FROM public.\"SSP_Payment\" WHERE pay_rec_id='{payment_id}';")[0]
 check('Upload automatically sets UNDER REVIEW without confirmation',state['payment_status']=='UNDER REVIEW',payment_status=state['payment_status'])
 code,confirmation=api.post('resident-payments-console',{'actionType':'CONFIRM_RECEIPT_UPLOAD','societyRegistrationNumber':registration,'paymentId':public_payment_id},token,record=False)
 check('Confirmation supports both response contracts',code==200 and confirmation.get('paymentSubmission')==confirmation.get('data',{}).get('paymentSubmission') and confirmation.get('paymentSubmission',{}).get('receiptUploadStatus')=='uploaded',http_status=code)
 code,fetched=api.post('resident-payments-console',{'actionType':'FETCH_OWN','societyRegistrationNumber':registration,'search':public_payment_id},token,record=False)
 row=next((p for p in fetched.get('data',{}).get('payments',[]) if p['customPaymentId']==payment_id),{})
 check('Payment list returns stored proof image',code==200 and bool(row.get('receiptUrl')),http_status=code)
 code,downloaded=http(row['receiptUrl'])
 check('Downloaded proof matches uploaded bytes',code==200 and downloaded==image,http_status=code,bytes=len(downloaded))
 code,mine=api.post('get-my-facility-bookings',{'societyRegistrationNumber':registration,'residentId':resident},token,record=False)
 pending=next((x for x in mine.get('facilities',[]) if x.get('payRecId')==payment_id),{})
 check('My Bookings reports submitted payment UNDER REVIEW',code==200 and str(pending.get('paymentStatus','')).upper()=='UNDER REVIEW',http_status=code,booking_status=pending.get('bookingStatus'))
 report['intermediate_booking_status']=pending.get('bookingStatus')
 check('Booking stops waiting for payment after proof upload',pending.get('bookingStatus')=='pending_verification',booking_status=pending.get('bookingStatus'))
 code,admin=api.post('admin-payments-console',{'societyRegistrationNumber':registration,'actionType':'FETCH_ALL','searchText':public_payment_id},token,record=False)
 listed=admin.get('data',{}).get('payments',{}).get('payments',[])
 admin_row=next((x for x in listed if x.get('paymentID')==public_payment_id),{})
 check('Admin can retrieve payment proof',code==200 and str(admin_row.get('imageUrl','')).startswith('https://'),http_status=code)
 code,approved=api.post('admin-payments-console',{'societyRegistrationNumber':registration,'actionType':'VERIFY_PAYMENT','paymentId':public_payment_id,'action':'VERIFY'},token,record=False)
 check('Admin approves disposable test payment',code==200 and str(approved.get('data',{}).get('paymentStatus','')).lower()=='paid' and bool(approved.get('data',{}).get('bookingId')),http_status=code,error=approved.get('message'))
 code,mine=api.post('get-my-facility-bookings',{'societyRegistrationNumber':registration,'residentId':resident},token,record=False)
 confirmed=next((x for x in mine.get('facilities',[]) if x.get('payRecId')==payment_id),{})
 check('My Bookings shows Paid and Approved',code==200 and str(confirmed.get('paymentStatus','')).lower()=='paid' and str(confirmed.get('bookingStatus','')).lower()=='approved' and confirmed.get('recordType')=='booking',http_status=code,booking_status=confirmed.get('bookingStatus'),payment_status=confirmed.get('paymentStatus'))
 code,pdf=http(origin+'/functions/v1/generate-payment-receipt','POST',{'paymentId':payment_id,'responseFormat':'file'},token)
 check('Paid receipt downloads as a PDF',code==200 and isinstance(pdf,bytes) and pdf.startswith(b'%PDF-'),http_status=code,error=pdf if isinstance(pdf,dict) else None)
 report['real_money_transferred']=False
 report['result']='passed'
 (folder/'live-result.json').write_text(json.dumps(report,indent=2)+'\n')
except Exception as e:
 import traceback;traceback.print_tb(e.__traceback__);report['result']='failed';report['error']=str(e) if isinstance(e,RuntimeError) else type(e).__name__;print('Check stopped: '+report['error'],flush=True)
finally:
 if object_key:
  p=subprocess.run(['supabase','storage','rm','ss:///society-documents/'+object_key,'--linked','--project-ref',project,'--experimental','--yes'],capture_output=True,text=True,timeout=45)
  report['cleanup']['storage_object_removed']=p.returncode==0
 if payment_id:
  api.db(f"DELETE FROM public.\"SSP_Facility_Booking\" WHERE payment='{payment_id}'; DELETE FROM public.\"SSP_Facility_Booking_Request\" WHERE payment='{payment_id}'; DELETE FROM public.\"SSP_Document\" WHERE payment='{payment_id}'; DELETE FROM public.\"SSP_Payment\" WHERE pay_rec_id='{payment_id}' AND payment_id='{public_payment_id}';")
  report['cleanup']['test_payment_removed']=True
 if auth_id:
  code,_=http(origin+'/auth/v1/admin/users/'+auth_id,'DELETE',token=service,apikey=service)
  report['cleanup']['disposable_auth_removed']=code in (200,204)
 if fixture_created:
  api.db(f"BEGIN; DELETE FROM public.\"SSP_Facility\" WHERE id='{facility_id}'; DELETE FROM public.\"SSP_Society_User\" WHERE user_id='{resident}'; DELETE FROM public.\"SSP_Contact\" WHERE contact_id='{contact_id}'; DELETE FROM public.\"SSP_Society\" WHERE society_id='{society_id}'; COMMIT;")
  report['cleanup']['disposable_society_facility_resident_removed']=True
 (folder/'live-result.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
raise SystemExit(0 if report.get('result')=='passed' and all(report['cleanup'].values()) else 1)
