"""Live OTP checks using an unnamed temporary visitor; no resident notification."""
import importlib.util,json,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('api',ROOT/'supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
guard='b5253054-4336-4d5b-bf62-db4d13ae766d';visitor=None
report={'checks':[]}
def check(label,condition,**details):
 report['checks'].append({'check':label,'passed':bool(condition),**details});print(label+': '+('PASS' if condition else 'FAIL'),flush=True)
 if not condition:raise RuntimeError(label+' failed')
try:
 actor=api.db('SELECT c.phone,s.registration_number FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society '+f"WHERE u.user_id='{guard}';")[0]
 cred={'phoneNumber':str(actor['phone']),'registrationNumber':actor['registration_number']}
 status,otp=api.post('get-otp',cred,record=False);check('Security login OTP',status==200,http_status=status)
 status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);check('Security authentication',status==200 and bool(login.get('token')),http_status=status)
 token=login['token'];base={'societyUserId':api.HOST,'phoneNumber':'7006'+str(uuid.uuid4().int)[-6:]}
 status,response=api.post('visitor-otp',base,token,record=False)
 check('Generate Premium visitor OTP',status==200 and response.get('data',{}).get('nextStep')=='VERIFY_OTP',http_status=status)
 visitor=str(uuid.UUID(response['data']['visitorId']))
 stored=api.db(f'SELECT one_time_password,is_otp_verified FROM public."SSP_Non_Society_User" WHERE non_society_user_id=\'{visitor}\';')[0]
 check('OTP saved and initially unverified',bool(stored['one_time_password']) and stored['is_otp_verified'] is False)
 wrong='000000' if str(stored['one_time_password'])!='000000' else '999999'
 status,response=api.post('visitor-otp',{**base,'visitorId':visitor,'otp':wrong},token,record=False)
 check('Incorrect OTP rejected',status==400 and response.get('success') is False,http_status=status,message=response.get('message'))
 status,response=api.post('visitor-otp',{**base,'visitorId':visitor,'otp':str(stored['one_time_password'])},token,record=False)
 check('Correct OTP verified',status==200 and response.get('data',{}).get('otpVerified') is True,http_status=status)
 report['verification_response']=response
 state=api.db(f'SELECT is_otp_verified,one_time_password IS NULL AS otp_cleared,public.visitor_ready_for_resident_approval(v) AS approval_ready FROM public."SSP_Non_Society_User" v WHERE non_society_user_id=\'{visitor}\';')[0]
 check('Verified flag persisted and OTP cleared',state['is_otp_verified'] is True and state['otp_cleared'] is True)
 check('Unnamed visitor does not request approval',state['approval_ready'] is False and response['data']['requiresVisitorDetails'] is True)
 pending=api.db(f'SELECT count(*) AS count FROM public."SSP_Notification" WHERE reference_id=\'{visitor}\';')[0]
 check('No resident notification generated',pending['count']==0)
 target=api.db('SELECT u.user_id FROM public."SSP_Society_User" u WHERE u.deleted_at IS NULL AND u.society=\'74628c82-7e11-4f5a-952a-d062193b3fb9\' AND u.unit_flat_number IS NOT NULL AND coalesce((public.get_entitlements(u.society,u.tower,u.block,u.unit_flat_number)->>\'VISITOR_OTP\')::boolean,false)=false LIMIT 1;')
 if target:
  status,response=api.post('visitor-otp',{'societyUserId':target[0]['user_id'],'phoneNumber':base['phoneNumber']},token,record=False)
  check('Non-Premium OTP access rejected',status==402 and response.get('requiredFeature')=='VISITOR_OTP',http_status=status,resident_plan=response.get('residentPlan'))
 report['result']='passed'
except Exception as error:
 report['result']='failed';report['error']=str(error) if isinstance(error,RuntimeError) else type(error).__name__;print('Diagnostic failed: '+report['error'],flush=True)
finally:
 if visitor:
  api.db(f'DELETE FROM public."SSP_Non_Society_User" WHERE non_society_user_id=\'{visitor}\' AND hosted_by=\'{api.HOST}\';')
  remaining=api.db(f'SELECT count(*) AS count FROM public."SSP_Non_Society_User" WHERE non_society_user_id=\'{visitor}\';')[0]
  report['test_visitor_removed']=remaining['count']==0
 (ROOT/'artifacts/visitor-otp-live-test/result.json').write_text(json.dumps(report,indent=2))
 print(json.dumps({'result':report.get('result'),'test_visitor_removed':report.get('test_visitor_removed')}),flush=True)
raise SystemExit(0 if report.get('result')=='passed' and report.get('test_visitor_removed') else 1)
