"""Run the local Postman collection against the deployed APIs; keep credentials temporary."""
from pathlib import Path
import importlib.util,json,subprocess,tempfile,uuid,re,os
ROOT=Path(__file__).resolve().parents[3]
os.chdir(ROOT)
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
OUT=Path('artifacts/visitor-optional-phone/postman')
report={'tool':'Newman (Postman collection runner)','postman_cli_signin_required':True,'date':'2026-11-17','result':'failed'}
prefix='POSTMAN_OPTIONAL_'+uuid.uuid4().hex
suffix=str(uuid.uuid4().int)[-7:]
testPhones=['700'+suffix,'701'+suffix]
host=None
try:
 candidates=api.db('''SELECT u.user_id AS host,u.society,s.registration_number,
 (SELECT p.user_id FROM public."SSP_Society_User" p WHERE p.society=u.society AND p.deleted_at IS NULL AND 'resident'=ANY(p.role)
  AND public.get_current_plan_code(p.society,p.tower,p.block,p.unit_flat_number)='PREMIUM' LIMIT 1) AS premium,
 (SELECT g.user_id FROM public."SSP_Society_User" g WHERE g.society=u.society AND g.deleted_at IS NULL AND 'security'=ANY(g.role) AND g.contact IS NOT NULL LIMIT 1) AS guard
 FROM public."SSP_Society_User" u JOIN public."SSP_Society" s ON s.society_id=u.society
 WHERE u.deleted_at IS NULL AND 'resident'=ANY(u.role)
 AND public.get_current_plan_code(u.society,u.tower,u.block,u.unit_flat_number)='FREE'
 AND NOT EXISTS(SELECT 1 FROM public."SSP_User_Device" d WHERE d.user_id=u.user_id AND d.is_active=true);''')
 candidate=next((x for x in candidates if x['premium'] and x['guard']),None)
 assert candidate,'No suitable resident/guard test accounts available'
 host=str(uuid.UUID(candidate['host']));guard=str(uuid.UUID(candidate['guard']))
 creds=api.db('SELECT c.phone FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '+f"WHERE u.user_id='{guard}';")[0]
 credentials={'phoneNumber':str(creds['phone']),'registrationNumber':candidate['registration_number']}
 status,otp=api.post('get-otp',credentials,record=False);assert status==200 and otp.get('otp'),'Guard login OTP request failed'
 status,login=api.post('verify-otp',{**credentials,'otp':otp['otp']},record=False);assert status==200 and login.get('token'),'Guard login failed'
 assert 'security' in login['user']['roles'],'Login account is not security'
 token=login['token']
 with tempfile.TemporaryDirectory(prefix='ssp-postman-') as tmp:
  tmp=Path(tmp);env=tmp/'private.postman_environment.json'
  values={'token':token,'registration':candidate['registration_number'],'guardId':guard,'nonPremiumResidentId':host,'premiumResidentId':candidate['premium'],'testPrefix':prefix,'testPhone':testPhones[0],'legacyTestPhone':testPhones[1]}
  env.write_text(json.dumps({'name':'Temporary SSP live test','values':[{'key':k,'value':v,'enabled':True} for k,v in values.items()]}));env.chmod(0o600)
  run=subprocess.run(['/private/tmp/ssp-postman-runner/node_modules/.bin/newman','run',str(OUT/'visitor-optional-phone.postman_collection.json'),'-e',str(env),'--reporters','cli,json','--reporter-json-export',str(tmp/'reports'/'run.json'),'--timeout-request','30000','--timeout','180000'],capture_output=True,text=True,timeout=200)
  def scrub(text):
   text=text.replace(token,'[REDACTED_TOKEN]')
   return re.sub(r'Bearer\s+eyJ[A-Za-z0-9_.-]+','Bearer [REDACTED_TOKEN]',text)
  (OUT/'run-output.txt').write_text(scrub(run.stdout+'\n'+run.stderr))
  for path in (tmp/'reports').rglob('*'):
   if path.is_file():
    (OUT/path.name).write_text(scrub(path.read_text()))
  report['newman_exit_code']=run.returncode
  print(scrub(run.stdout[-14000:]),flush=True)
  assert run.returncode==0,'Postman collection run failed; see run-output.txt'
 saved=api.db('SELECT non_society_user_id,name,phone_number,is_otp_verified,visitor_status,visitor_approval_status FROM public."SSP_Non_Society_User" '+f"WHERE hosted_by='{host}' AND name LIKE '{prefix}%';")
 assert len(saved)==10, f'Expected 10 created visitors; found {len(saved)}'
 assert sum(row['phone_number'] is None for row in saved)==8,'Expected eight phone-less visitors'
 assert sum(row['phone_number'] in testPhones for row in saved)==2,'Optional supplied phone not retained'
 assert all(row['is_otp_verified'] is False for row in saved),'Creation must not forge OTP verification'
 report.update({'result':'passed','requests':16,'created_visitors':len(saved),'phone_less_visitors':8,'optional_supplied_phone_visitors':2,'otp_verified_false_for_all':True,'live_plan_coverage':['FREE','PREMIUM'],'endpoints':['visitor-pass-operations','security-gate-console'],'device_push_avoided':'Selected FREE resident has no active push devices','database_checks_passed':True})
finally:
 if host:
  ids=api.db('SELECT non_society_user_id FROM public."SSP_Non_Society_User" '+f"WHERE hosted_by='{host}' AND name LIKE '{prefix}%';")
  if ids:
   values=','.join("'"+str(uuid.UUID(r['non_society_user_id']))+"'" for r in ids)
   api.db('WITH cleared AS (DELETE FROM public."SSP_Notification" '+f"WHERE reference_table='SSP_Non_Society_User' AND reference_id IN ({values}) RETURNING notification_id) "+'DELETE FROM public."SSP_Non_Society_User" '+f'WHERE non_society_user_id IN ({values}) RETURNING non_society_user_id;')
  remaining=api.db('SELECT count(*) AS count FROM public."SSP_Non_Society_User" '+f"WHERE hosted_by='{host}' AND name LIKE '{prefix}%';")[0]['count']
  report['cleanup']={'removed_visitors':len(ids),'remaining_visitors':remaining}
  assert remaining==0,'Test visitor cleanup incomplete'
 (OUT/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
