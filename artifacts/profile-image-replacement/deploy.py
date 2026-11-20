from pathlib import Path
import subprocess,json
project='isrqhkshygauaehwfycw'
sql=Path('supabase/migrations/20261117210000_replace_profile_image.sql').read_text()
p=subprocess.run(['supabase','db','query','--linked','--project-ref',project,'BEGIN;\n'+sql+'\nCOMMIT;'],capture_output=True,text=True,timeout=60)
if p.returncode:raise RuntimeError('Profile replacement migration failed; raw output withheld.')
print('Applied profile replacement and cleanup migration.',flush=True)
p=subprocess.run(['supabase','functions','deploy','profile-images','--project-ref',project,'--no-verify-jwt'],capture_output=True,text=True,timeout=100)
if p.returncode:raise RuntimeError('Profile-images deployment failed; raw output withheld.')
print('Deployed profile-images; application JWT authorization remains in requireAuth.',flush=True)
Path('artifacts/profile-image-replacement/deployment.json').write_text(json.dumps({'date':'2026-11-17','project':project,'function':'profile-images','migration_applied':True,'deployed':True},indent=2))
