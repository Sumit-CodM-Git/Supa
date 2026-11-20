"""Check security visitor draft creation without sending approval notifications."""
import importlib.util,json,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('api',ROOT/'supabase/tests/live-visitor-name-check.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
api.GUARD='b5253054-4336-4d5b-bf62-db4d13ae766d'
report={'calls':[],'cleanup':[]};ids=[]
try:
 actor=api.db('SELECT c.phone,s.registration_number FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society '+f"WHERE u.user_id='{api.GUARD}';")[0]
 cred={'phoneNumber':str(actor['phone']),'registrationNumber':actor['registration_number']}
 status,otp=api.post('get-otp',cred,record=False);assert status==200
 status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);assert status==200
 token=login['token'];print('Security authentication: HTTP',status,flush=True)
 for endpoint in ['visitor-otp','security-gate-console','visitor-pass-operations']:
  phone='7007'+str(uuid.uuid4().int)[-6:]
  payload={'societyUserId':api.HOST,'phoneNumber':phone}
  if endpoint!='visitor-otp':payload.update(actionType='REQUEST_APPROVAL',societyRegistrationNumber=actor['registration_number'],securityGuardId=api.GUARD,visitorName='Diagnostic Visitor '+uuid.uuid4().hex[:6],role='visitor',purpose='Temporary creation diagnostic; OTP unverified')
  status,body=api.post(endpoint,payload,token,record=False)
  data=body.get('data',{});visitor_id=data.get('visitorId')
  if visitor_id:ids.append(str(uuid.UUID(visitor_id)))
  report['calls'].append({'endpoint':endpoint,'http_status':status,'response':body})
  print(endpoint,': HTTP',status,'created:',bool(visitor_id),'error:',body.get('message'),flush=True)
  if visitor_id:
   state=api.db('SELECT non_society_user_id,name,is_otp_verified,visitor_status,visitor_approval_status,public.visitor_ready_for_resident_approval(v) AS notification_eligible FROM public."SSP_Non_Society_User" v '+f"WHERE non_society_user_id='{visitor_id}';")[0]
   report['calls'][-1]['database_state']=state
   print('Saved visitor:',json.dumps(state),flush=True)
   if endpoint=='visitor-otp':
    otp_rows=api.db(f'SELECT one_time_password FROM public."SSP_Non_Society_User" WHERE non_society_user_id=\'{visitor_id}\';')
    verification_status,verification=api.post('visitor-otp',{**payload,'visitorId':visitor_id,'otp':otp_rows[0]['one_time_password']},token,record=False)
    report['calls'][-1]['otp_verification']={'http_status':verification_status,'response':verification}
    print('Unnamed draft OTP verification: HTTP',verification_status,'verified:',verification.get('data',{}).get('otpVerified'),flush=True)

finally:
 for vid in ids:
  api.db(f'DELETE FROM public."SSP_Non_Society_User" WHERE non_society_user_id=\'{vid}\' AND hosted_by=\'{api.HOST}\';')
  report['cleanup'].append(vid)
 (ROOT/'artifacts/security-visitor-diagnostic/result.json').write_text(json.dumps(report,indent=2))
 print('Removed diagnostic visitors:',len(ids),flush=True)
