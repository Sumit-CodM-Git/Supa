from pathlib import Path
import importlib.util,json
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
a=api.db('SELECT c.phone,s.registration_number,u.unit_flat_number FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society '+f"WHERE u.user_id='{api.HOST}';")[0]
cred={'phoneNumber':str(a['phone']),'registrationNumber':a['registration_number']}
status,otp=api.post('get-otp',cred,record=False);assert status==200
status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);assert status==200

checks=[]
for endpoint,payload in [('visitor-pass-operations',{'actionType':'FETCH_RESIDENTS_BY_FLAT','societyRegistrationNumber':a['registration_number'],'flatNumber':a['unit_flat_number'],'page':1,'limit':20}),('security-gate-console',{'actionType':'FETCH_PRE_APPROVALS','societyRegistrationNumber':a['registration_number'],'page':1,'limit':1}),('resident-visitor',{'action':'VIEW','page':1,'limit':1})]:
 status,result=api.post(endpoint,payload,login['token'],record=False);assert status==200,(endpoint,status)
 if endpoint=='visitor-pass-operations':
  plans=[r['subscriptionPlan'] for r in result['data']['residents']];assert plans and all(p in ['FREE','STARTER','GROWTH','PREMIUM'] for p in plans)
 checks.append({'endpoint':endpoint,'http_status':status})
status,result=api.post('send-notification',{'record':{'delivery_status':'sent'}},record=False);assert status==200 and result.get('skipped') is True
checks.append({'endpoint':'send-notification','http_status':status})
snapshot=json.loads(Path('artifacts/visitor-plan-rules/deployment/before.json').read_text())
for f in snapshot['functions']:
 escaped=f['definition'].replace("'","''")
 rows=api.db("SELECT pg_get_functiondef(p.oid) = '"+escaped+"' AS restored FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='"+f['name']+"';")
 assert rows and rows[0]['restored'],f['name']
rows=api.db("""SELECT * FROM public."SSP_Plan_Feature" WHERE feature_id IN (SELECT feature_id FROM public."SSP_Feature" WHERE feature_code IN ('VISITOR_APPROVAL','VISITOR_OTP','VISITOR_TAB','VISITOR_DASHBOARD_CARD')) AND plan_id IN (SELECT plan_id FROM public."SSP_Subscription_Plan" WHERE plan_code IN ('FREE','STARTER','GROWTH','PREMIUM'));""")
fields=['plan_feature_id','plan_id','feature_id','enabled','config']
assert sorted([{k:r[k] for k in fields} for r in rows],key=lambda r:r['plan_feature_id'])==sorted([{k:r[k] for k in fields} for r in snapshot['plan_features']],key=lambda r:r['plan_feature_id'])
report={'checks':checks,'subscriptionPlans':plans,'database_functions_restored':True,'feature_settings_restored':True,'visitor_created':False,'notification_sent':False}
Path('artifacts/visitor-otp-revert/live-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
