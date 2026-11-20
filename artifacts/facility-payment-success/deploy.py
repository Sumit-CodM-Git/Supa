from pathlib import Path
import json,subprocess
folder=Path(__file__).parent;project='isrqhkshygauaehwfycw'
eps=['resident-payments-console','make-resident-payment','view-resident-payments','admin-payments-console','get-payments-list','resident-facility-booking','get-my-facility-bookings','facility-console']
p=subprocess.run(['supabase','functions','list','--project-ref',project,'--output','json'],capture_output=True,text=True,timeout=60)
assert p.returncode==0,'Function inventory failed'
a=json.loads(p.stdout);rows=a if isinstance(a,list) else a.get('functions',[]);before={x['slug']:x for x in rows if x['slug'] in eps};assert len(before)==len(eps)
(folder/'before-deployment.json').write_text(json.dumps(before,indent=2)+'\n')
p=subprocess.run(['supabase','db','query','--linked','--project-ref',project,'--file',str(folder/'deploy.sql')],capture_output=True,text=True,timeout=120)
if p.returncode:raise SystemExit('Migration failed: '+p.stderr[-1200:])
result=json.loads(p.stdout[p.stdout.index('{'):p.stdout.rindex('}')+1])['rows'];print('Migration applied: '+json.dumps(result),flush=True)
report={'migration':'20261118140000','migration_result':result,'functions':{}}
(folder/'deployment.json').write_text(json.dumps(report,indent=2)+'\n')
for ep in eps:
 args=['supabase','functions','deploy',ep,'--project-ref',project]
 if not before[ep].get('verify_jwt',True):args.append('--no-verify-jwt')
 p=subprocess.run(args,capture_output=True,text=True,timeout=120)
 if p.returncode:raise SystemExit('Deployment failed for '+ep+': '+p.stderr[-1200:])
 report['functions'][ep]={'deployed':True,'verify_jwt_preserved':before[ep].get('verify_jwt',True)}
 (folder/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(ep+': deployed',flush=True)
p=subprocess.run(['supabase','functions','list','--project-ref',project,'--output','json'],capture_output=True,text=True,timeout=60);assert p.returncode==0
rows=json.loads(p.stdout);rows=rows if isinstance(rows,list) else rows.get('functions',[])
for row in rows:
 if row['slug'] not in eps:continue
 assert row['status']=='ACTIVE' and row['verify_jwt']==before[row['slug']]['verify_jwt']
 report['functions'][row['slug']]['active_version']=row['version']
report['status']='deployed and ACTIVE';(folder/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],flush=True)
