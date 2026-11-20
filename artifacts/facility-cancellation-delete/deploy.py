from pathlib import Path
import json,subprocess
folder=Path(__file__).parent
project='isrqhkshygauaehwfycw';endpoint='resident-facility-booking'
def run(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=120)
 if p.returncode:raise RuntimeError(p.stderr[-1500:] or p.stdout[-1500:])
 return p.stdout
raw=run(['supabase','functions','list','--project-ref',project,'--output','json']);rows=json.loads(raw);rows=rows if isinstance(rows,list) else rows['functions'];before=next(x for x in rows if x['slug']==endpoint)
sql='BEGIN;\n'+Path('supabase/migrations/20261118170000_delete_cancelled_resident_facility_booking.sql').read_text()+'\nCOMMIT;'
(folder/'deploy.sql').write_text(sql)
run(['supabase','db','query','--linked','--project-ref',project,'--file',str(folder/'deploy.sql')]);print('Cancellation deletion migration applied',flush=True)
report={'migration':'20261118170000','migration_applied':True};(folder/'deployment.json').write_text(json.dumps(report,indent=2)+'\n')
args=['supabase','functions','deploy',endpoint,'--project-ref',project]
if not before['verify_jwt']:args.append('--no-verify-jwt')
run(args)
raw=run(['supabase','functions','list','--project-ref',project,'--output','json']);rows=json.loads(raw);rows=rows if isinstance(rows,list) else rows['functions'];after=next(x for x in rows if x['slug']==endpoint)
assert after['status']=='ACTIVE' and after['verify_jwt']==before['verify_jwt']
report.update({'endpoint':endpoint,'version':after['version'],'status':after['status'],'verify_jwt_preserved':True});(folder/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
