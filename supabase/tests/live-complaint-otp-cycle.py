"""Exercise both OTP endpoints using one isolated complaint, then delete it."""
import importlib.util,json,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path(__file__).with_name('live-visitor-name-check.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
id=str(uuid.uuid4());created=False;checks=[]
def dbstate():
 return a.db('SELECT status,start_otp_verified_at,end_otp_verified_at,completion_date_time FROM public."SSP_Complaint" '+f"WHERE complaint_id='{id}';")[0]
def call(endpoint,payload,expected=200):
 status,body=a.post(endpoint,{'complaintId':id,**payload},token,record=False)
 assert status==expected,(endpoint,payload,status,body)
 checks.append({'endpoint':endpoint,'action':payload.get('action',payload.get('stage')),'httpStatus':status,'state':dbstate()})
 print(endpoint,payload.get('action',payload.get('stage')),status,flush=True)
 return body
try:
 actor=a.db('SELECT c.phone FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '+f"WHERE u.user_id='{a.HOST}';")[0]
 credentials={'phoneNumber':str(actor['phone']),'registrationNumber':'GZB-1234-ab'}
 status,otp=a.post('get-otp',credentials,record=False);assert status==200
 status,auth=a.post('verify-otp',{**credentials,'otp':otp['otp']},record=False);assert status==200
 token=auth['token']
 a.db('INSERT INTO public."SSP_Complaint" (complaint_id,name,status,society_user,assigned_agent) '+f"VALUES ('{id}','Codex OTP cycle test {id}','assigned','{a.HOST}','{a.HOST}') RETURNING complaint_id;");created=True
 call('staff-complaint-workflow',{'action':'END_OTP'},400)
 call('staff-complaint-workflow',{'action':'START_OTP'})
 # Read only our fixture's OTP in memory; never print or save its value.
 def stored(stage):return a.db(f'''SELECT {stage}_otp AS value FROM public."SSP_Complaint" WHERE complaint_id='{id}';''')[0]['value']
 call('staff-complaint-workflow',{'action':'START_OTP'})
 call('staff-complaint-workflow',{'action':'VERIFY_START','otp':'000000'},400)
 call('staff-complaint-workflow',{'action':'VERIFY_START','otp':stored('start')})
 call('staff-complaint-workflow',{'action':'START_OTP'})
 call('staff-complaint-workflow',{'action':'END_OTP'})
 call('staff-complaint-workflow',{'action':'END_OTP'})
 call('staff-complaint-workflow',{'action':'VERIFY_END','otp':stored('end')})
 call('staff-complaint-workflow',{'action':'END_OTP'})
 assert dbstate()['status']=='resolved'
 # Reopen through the app's status update API and check that its old cycle resets.
 call('staff-complaints',{'societyRegistrationNumber':'GZB-1234-ab','staffType':'SERVICE_AGENT','staffId':a.HOST,'actionType':'UPDATE','newStatus':'assigned'})
 state=dbstate();assert state['start_otp_verified_at'] is None and state['end_otp_verified_at'] is None
 call('complaint-otp',{'stage':'START'})
 call('complaint-otp',{'stage':'START','otp':stored('start')})
 call('complaint-otp',{'stage':'END'})
 call('staff-complaint-workflow',{'action':'VERIFY_END','otp':stored('end')})
 call('complaint-otp',{'stage':'END'})
 # Reproduce stale END verification with active status, as in the affected record.
 a.db(f'''UPDATE public."SSP_Complaint" SET status='in_progress',completion_date_time=NULL WHERE complaint_id='{id}' RETURNING complaint_id;''')
 call('staff-complaint-workflow',{'action':'END_OTP'})
 assert dbstate()['end_otp_verified_at'] is None
 call('staff-complaint-workflow',{'action':'VERIFY_END','otp':stored('end')})
 assert dbstate()['status']=='resolved' and dbstate()['completion_date_time'] is not None
finally:
 if created:
  a.db(f'''DELETE FROM public."SSP_Complaint" WHERE complaint_id='{id}' AND name='Codex OTP cycle test {id}' RETURNING complaint_id;''')
  print('Test complaint deleted.',flush=True)
 Path('artifacts/complaint-otp').mkdir(parents=True,exist_ok=True)
 Path('artifacts/complaint-otp/live-results.json').write_text(json.dumps(checks,indent=2))
