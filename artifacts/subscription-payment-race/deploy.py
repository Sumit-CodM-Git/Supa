from pathlib import Path
import subprocess,json
project='isrqhkshygauaehwfycw'
sql=Path('supabase/migrations/20261117200000_atomic_subscription_payment.sql').read_text()
p=subprocess.run(['supabase','db','query','--linked','--project-ref',project,'BEGIN;\n'+sql+'\nCOMMIT;'],capture_output=True,text=True,timeout=60)
if p.returncode: raise RuntimeError('Atomic payment migration failed; raw database output withheld.')
print('Applied service-only atomic payment finalizer.',flush=True)
results=[]
for ep in ['verify-razorpay-payment','razorpay-webhook']:
 p=subprocess.run(['supabase','functions','deploy',ep,'--project-ref',project],capture_output=True,text=True,timeout=100)
 if p.returncode: raise RuntimeError(f'Deployment failed: {ep}; inspect CLI output privately.')
 results.append(ep);print('Deployed '+ep,flush=True)
Path('artifacts/subscription-payment-race/deployment.json').write_text(json.dumps({'project':project,'functions':results,'migration_applied':True,'date':'2026-11-17'},indent=2))
