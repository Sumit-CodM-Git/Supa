from pathlib import Path
import subprocess,json
project='isrqhkshygauaehwfycw'
results=[]
for ep in ['add-members','crud-family','process-csv-import','resident-profile-console','update-member','update-residents-profile']:
 p=subprocess.run(['supabase','functions','deploy',ep,'--project-ref',project],capture_output=True,text=True,timeout=100)
 if p.returncode: raise RuntimeError(f'Deployment failed: {ep}; review CLI output privately.')
 results.append(ep)
 print('Deployed '+ep,flush=True)
sql=Path('supabase/migrations/20261117190000_contact_phone_insert_only.sql').read_text()
p=subprocess.run(['supabase','db','query','--linked','--project-ref',project,'BEGIN;\n'+sql+'\nCOMMIT;'],capture_output=True,text=True,timeout=60)
if p.returncode: raise RuntimeError('Contact insert-only migration failed; raw database output withheld.')
print('Applied contact insert-only trigger.',flush=True)
Path('artifacts/contact-insert-only/deployment.json').write_text(json.dumps({'project':project,'functions':results,'migration_applied':True,'date':'2026-11-17'},indent=2))
