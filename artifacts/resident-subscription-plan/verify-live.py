from pathlib import Path
import importlib.util,json
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
a=api.db('SELECT c.phone,s.registration_number,u.unit_flat_number FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society '+f"WHERE u.user_id='{api.HOST}';")[0]
cred={'phoneNumber':str(a['phone']),'registrationNumber':a['registration_number']}
status,otp=api.post('get-otp',cred,record=False);assert status==200
status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);assert status==200
status,result=api.post('visitor-pass-operations',{'actionType':'FETCH_RESIDENTS_BY_FLAT','societyRegistrationNumber':a['registration_number'],'flatNumber':a['unit_flat_number'],'page':1,'limit':20},login['token'],record=False)
assert status==200,(status,result.get('message'))
residents=result['data']['residents'];assert residents,'No residents returned'
assert all('subscriptionPlan' in r and r['subscriptionPlan'] in ['FREE','STARTER','GROWTH','PREMIUM'] for r in residents)
report={'endpoint':'visitor-pass-operations','actionType':'FETCH_RESIDENTS_BY_FLAT','http_status':status,'resident_count':len(residents),'subscriptionPlans':[r['subscriptionPlan'] for r in residents],'visitor_created':False,'notification_sent':False}
Path('artifacts/resident-subscription-plan/live-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
