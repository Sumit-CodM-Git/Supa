"""Disposable society/resident/facility end-to-end booking, proof upload, approval and receipt test. No money transfer or outbound messages."""
import base64,importlib.util,json,secrets,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('api',ROOT/'supabase/tests/live-visitor-name-check.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
def test_db(sql):
 p=subprocess.run(['supabase','db','query','--linked','--project-ref',api.PROJECT,sql],capture_output=True,text=True,timeout=120)
 if p.returncode:raise RuntimeError('Fixture database request failed; raw output withheld')
 return json.loads(p.stdout[p.stdout.index('{'):p.stdout.rindex('}')+1])['rows']
api.db=test_db
folder=Path(__file__).parent
project=api.PROJECT;origin=f'https://{project}.supabase.co'
marker='CANCEL-DISPATCH-'+uuid.uuid4().hex[:12].upper()
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
object_keys=[]
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
 base_payload={'societyRegistrationNumber':registration,'residentId':resident,'facilityName':marker,'bookingStartDateTime':start.isoformat(),'bookingEndDateTime':(start+timedelta(hours=1)).isoformat(),'paymentMode':'qr','purpose':marker,'isAllDay':False}
 for invalid_action in ['cancel','cancel_payment','CANCEL_PAYMENT','typo','']:
  code,result=api.post('resident-facility-booking',{**base_payload,'action':invalid_action},token,record=False)
  state=api.db(f"SELECT (SELECT count(*) FROM public.\"SSP_Facility_Booking_Request\" WHERE requested_by='{resident}') AS request_count,(SELECT count(*) FROM public.\"SSP_Payment\" WHERE society_user='{resident}') AS payment_count")[0]
  check('No creation for '+repr(invalid_action)+' without booking ID',code==400 and state['request_count']==0 and state['payment_count']==0,http_status=code,**state)
 code,booked=api.post('resident-facility-booking',{'action':'book','societyRegistrationNumber':registration,'residentId':resident,'facilityName':marker,'bookingStartDateTime':start.isoformat(),'bookingEndDateTime':(start+timedelta(hours=1)).isoformat(),'paymentMode':'qr','purpose':marker,'isAllDay':False},token,record=False)
 check('Real booking API creates disposable request',code==200 and bool(booked.get('data',{}).get('facilityBooking')),http_status=code,error=booked.get('message'))
 booking=booked['data']['facilityBooking'];payment_id=booking['payRecId'];public_payment_id=booking['paymentId'];request_id=booking['requestId']
 report['booking']={'request_id':request_id,'payment_id':public_payment_id,'amount':booking['amount'],'initial_status':booking['status']}
 for action in ['cancel','abort_pending_booking']:
  if action=='abort_pending_booking':
   code,booked=api.post('resident-facility-booking',{'action':'book','societyRegistrationNumber':registration,'residentId':resident,'facilityName':marker,'bookingStartDateTime':start.isoformat(),'bookingEndDateTime':(start+timedelta(hours=1)).isoformat(),'paymentMode':'qr','purpose':marker,'isAllDay':False},token,record=False)
   check('Same slot can be rebooked after cancellation',code==200,http_status=code)
   booking=booked['data']['facilityBooking'];payment_id=booking['payRecId'];request_id=booking['requestId']
  if action=='cancel':
   api.db(f"INSERT INTO public.\"SSP_Facility_Booking\" (requested_by,facility,payment,booking_start_date,booking_end_date,approval_status,booking_status) SELECT requested_by,facility,payment,booking_start_date,booking_end_date,'requested','requested' FROM public.\"SSP_Facility_Booking_Request\" WHERE request_id='{request_id}'")
  code,cancelled=api.post('resident-facility-booking',{'action':action,'societyRegistrationNumber':registration,'residentId':resident,'bookingRequestId':request_id},token,record=False)
  check(action+' HTTP success',code==200,http_status=code,message=cancelled.get('message'))
  state=api.db(f"SELECT (SELECT count(*) FROM public.\"SSP_Facility_Booking_Request\" WHERE payment='{payment_id}') AS request_count,(SELECT count(*) FROM public.\"SSP_Facility_Booking\" WHERE payment='{payment_id}') AS booking_count,(SELECT payment_status FROM public.\"SSP_Payment\" WHERE pay_rec_id='{payment_id}') AS payment_status")[0]
  check(action+' physically removes request and booking; payment cancelled',state['request_count']==0 and state['booking_count']==0 and state['payment_status']=='cancelled',**state)
  code,listing=api.post('get-my-facility-bookings',{'societyRegistrationNumber':registration,'residentId':resident},token,record=False)
  check(action+' removed from resident booking list',code==200 and not listing.get('facilities'),http_status=code)
 report['result']='passed';report['passed']=True
except Exception as e:
 import traceback;traceback.print_tb(e.__traceback__);report['result']='failed';report['error']=str(e) if isinstance(e,RuntimeError) else type(e).__name__;print('Check stopped: '+report['error'],flush=True)
finally:
 for object_key in object_keys:
  p=subprocess.run(['supabase','storage','rm','ss:///society-documents/'+object_key,'--linked','--project-ref',project,'--experimental','--yes'],capture_output=True,text=True,timeout=60)
  if p.returncode:raise RuntimeError('Fixture storage cleanup failed')
 report['cleanup']['storage_objects_removed']=True
 if fixture_created:
  api.db(f"BEGIN; DELETE FROM public.\"SSP_Facility_Booking\" WHERE requested_by='{resident}'; DELETE FROM public.\"SSP_Facility_Booking_Request\" WHERE requested_by='{resident}'; DELETE FROM public.\"SSP_Document\" WHERE society='{society_id}'; DELETE FROM public.\"SSP_Payment\" WHERE society_user='{resident}'; COMMIT;")
  report['cleanup']['test_payments_removed']=True
 if auth_id:
  code,_=http(origin+'/auth/v1/admin/users/'+auth_id,'DELETE',token=service,apikey=service)
  report['cleanup']['disposable_auth_removed']=code in (200,204)
 if fixture_created:
  api.db(f"BEGIN; DELETE FROM public.\"SSP_Facility\" WHERE id='{facility_id}'; DELETE FROM public.\"SSP_Society_User\" WHERE user_id='{resident}'; DELETE FROM public.\"SSP_Contact\" WHERE contact_id='{contact_id}'; DELETE FROM public.\"SSP_Society\" WHERE society_id='{society_id}'; COMMIT;")
  report['cleanup']['disposable_society_facility_resident_removed']=True
 (folder/'live-result.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
raise SystemExit(0 if report.get('result')=='passed' and all(report['cleanup'].values()) else 1)
