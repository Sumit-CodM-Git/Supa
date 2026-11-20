"""Post-deploy read-only API verification; no visitor or notification created."""
from pathlib import Path
import importlib.util,json,subprocess
root=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('api',root/'supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
actor=api.db('SELECT c.phone,s.registration_number,u.society,u.tower,u.block,u.unit_flat_number FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society '+f"WHERE u.user_id='{api.HOST}';")[0]
cred={'phoneNumber':str(actor['phone']),'registrationNumber':actor['registration_number']}
status,otp=api.post('get-otp',cred,record=False);assert status==200
status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);assert status==200
token=login['token'];report={'checks':[]}
config=['url = '+json.dumps(api.BASE+'get-dashboard'),'request = "GET"','header = '+json.dumps('Authorization: Bearer '+token),'write-out = "\\n%{http_code}"']
r=subprocess.run(['/usr/bin/curl','--silent','--show-error','--max-time','40','--config','-'],input='\n'.join(config),capture_output=True,text=True,timeout=45)
assert r.returncode==0
body,status=r.stdout.rsplit('\n',1);body=json.loads(body);assert status=='200',body
features=body.get('data',{}).get('features');assert features is not None, 'Deployed dashboard lacks feature flags'
report['checks'].append({'endpoint':'get-dashboard','http_status':200,'features':features})
for endpoint in ['security-gate-console','visitor-pass-operations']:
 status,result=api.post(endpoint,{'actionType':'FETCH_PRE_APPROVALS','societyRegistrationNumber':actor['registration_number'],'page':1,'limit':1},token,record=False)
 report['checks'].append({'endpoint':endpoint,'http_status':status});assert status==200,(endpoint,result.get('message'))
status,result=api.post('resident-visitor',{'action':'VIEW','page':1,'limit':1},token,record=False)
expected=200 if features['visitorTabEnabled'] else 402
report['checks'].append({'endpoint':'resident-visitor','http_status':status,'expected':expected});assert status==expected,result.get('message')
status,result=api.post('send-notification',{'record':{'delivery_status':'sent'}},record=False)
report['checks'].append({'endpoint':'send-notification','http_status':status,'response':result});assert status==200 and result.get('skipped') is True
report['visitor_created']=False;report['notification_sent']=False
(root/'artifacts/visitor-plan-rules/deployment/live-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
