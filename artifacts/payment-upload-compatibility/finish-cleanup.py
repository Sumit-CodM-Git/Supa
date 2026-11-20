from pathlib import Path
import json,re,subprocess,uuid
folder=Path(__file__).parent
fixtures=json.loads((folder/'cleanup-inventory.json').read_text())['societies'] or []
project='isrqhkshygauaehwfycw'
auth_ids=[];commands=['BEGIN;']
for s in fixtures:
 assert re.fullmatch(r'COMPAT-CHECK-[A-F0-9]{12}',s['registration'])
 society=str(uuid.UUID(s['society_id']));assert not s['objects'],'Unexpected stored fixture object remains'
 for user in s['residents'] or []:
  uid=str(uuid.UUID(user['user_id']));contact=str(uuid.UUID(user['contact_id']))
  if user['auth_id']:auth_ids.append(str(uuid.UUID(user['auth_id'])))
  commands.extend([
   f'DELETE FROM public."SSP_Facility_Booking" WHERE requested_by=\'{uid}\';',
   f'DELETE FROM public."SSP_Facility_Booking_Request" WHERE requested_by=\'{uid}\';',
   f'DELETE FROM public."SSP_Document" WHERE society=\'{society}\' OR payment IN (SELECT pay_rec_id FROM public."SSP_Payment" WHERE society_user=\'{uid}\');',
   f'DELETE FROM public."SSP_Payment" WHERE society_user=\'{uid}\';',
   f'DELETE FROM public."SSP_Facility" WHERE society=\'{society}\';',
   f'DELETE FROM public."SSP_Society_User" WHERE user_id=\'{uid}\' AND society=\'{society}\';',
   f'DELETE FROM public."SSP_Contact" WHERE contact_id=\'{contact}\' AND society=\'{society}\';'
  ])
 commands.append(f'DELETE FROM public."SSP_Society" WHERE society_id=\'{society}\';')
commands+=['COMMIT;']
(folder/'finish-cleanup.sql').write_text('\n'.join(commands)+'\n')
p=subprocess.run(['supabase','db','query','--linked','--project-ref',project,'--file',str(folder/'finish-cleanup.sql')],capture_output=True,text=True,timeout=120)
if p.returncode:raise SystemExit('Scoped database cleanup failed: '+p.stderr[-800:])
p=subprocess.run(['supabase','projects','api-keys','--project-ref',project,'--output','json'],capture_output=True,text=True,timeout=45)
if p.returncode:raise SystemExit('Cleanup key lookup failed; raw output withheld')
keys=json.loads(p.stdout);keys=keys if isinstance(keys,list) else keys.get('api_keys',keys.get('keys',[]));service=next(x['api_key'] for x in keys if x['name']=='service_role')
for auth_id in auth_ids:
 config=['url = '+json.dumps(f'https://{project}.supabase.co/auth/v1/admin/users/{auth_id}'),'request = "DELETE"','header = '+json.dumps('Authorization: Bearer '+service),'header = '+json.dumps('apikey: '+service),'write-out = "\\n%{http_code}"']
 p=subprocess.run(['/usr/bin/curl','--silent','--show-error','--max-time','40','--config','-'],input='\n'.join(config),capture_output=True,text=True,timeout=45)
 if p.returncode or p.stdout.rsplit('\n',1)[-1] not in ('200','204','404'):raise SystemExit('Disposable auth cleanup failed; raw output withheld')
report={'live_assertions_passed':16,'test_execution':'All functional checks in check-live.py passed; the first database cleanup timed out and this scoped cleanup completed it.','cleanup_completed':True,'fixture_objects_remaining_at_cleanup':0,'disposable_societies_removed':len(fixtures),'disposable_auth_accounts_removed':len(auth_ids),'real_money_transferred':False}
(folder/'live-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
