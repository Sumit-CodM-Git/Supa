from pathlib import Path
import json,subprocess
folder=Path(__file__).parent
project='isrqhkshygauaehwfycw';endpoint='resident-facility-booking'
def run(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=120)
 if p.returncode:raise RuntimeError(p.stderr[-1500:] or p.stdout[-1500:])
 return p.stdout
raw=run(['supabase','functions','list','--project-ref',project,'--output','json']);rows=json.loads(raw);rows=rows if isinstance(rows,list) else rows['functions'];before=next(x for x in rows if x['slug']==endpoint)
report={}
args=['supabase','functions','deploy',endpoint,'--project-ref',project]
if not before['verify_jwt']:args.append('--no-verify-jwt')
run(args)
raw=run(['supabase','functions','list','--project-ref',project,'--output','json']);rows=json.loads(raw);rows=rows if isinstance(rows,list) else rows['functions'];after=next(x for x in rows if x['slug']==endpoint)
assert after['status']=='ACTIVE' and after['verify_jwt']==before['verify_jwt']
report.update({'endpoint':endpoint,'version':after['version'],'status':after['status'],'verify_jwt_preserved':True});(folder/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
