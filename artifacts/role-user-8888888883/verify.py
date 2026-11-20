import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
cred={'phoneNumber':'8888888883','registrationNumber':'GZB-1234-ab'}
status,otp=api.post('get-otp',cred,record=False);assert status==200,'OTP generation failed'
status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);assert status==200,('Login failed',status,login.get('message'))
roles=login['user']['roles'];assert set(roles)=={'admin','resident','service_agent','security','vendor'},roles
assert login['user']['name']=='yoBro'
report={'phone':'8888888883','society':'GZB-1234-ab','name':login['user']['name'],'society_user_id':login['user']['id'],'login_http_status':status,'login_roles':roles,'role_checks':[]}
for role in ['admin','resident','service_agent','security','vendor']:
 status,body=api.post('switch-user',{**cred,'role':role,'page':1,'limit':1},login['token'],record=False)
 check={'role':role,'http_status':status,'matched':body.get('matched')}
 report['role_checks'].append(check)
 if status!=200 or body.get('matched') is not True:
  check['message']=body.get('message');Path('artifacts/role-user-8888888883/verification.json').write_text(json.dumps(report,indent=2));raise AssertionError(check)
 if role=='vendor':report['vendor_user_id']=body['userDetail']['nonSocietyUserID']
report['old_user_removed']=api.db('''SELECT NOT EXISTS(SELECT 1 FROM public."SSP_Society_User" WHERE user_id='ac4e1eed-29db-4651-ad1c-8a7c50cddf8c') AND NOT EXISTS(SELECT 1 FROM public."SSP_Contact" WHERE contact_id='5b9035c7-9ad1-47c6-92c1-3fd13d83f9ba') AS removed''')[0]['removed'];assert report['old_user_removed']
Path('artifacts/role-user-8888888883/verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
