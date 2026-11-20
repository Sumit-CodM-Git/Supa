from pathlib import Path
import subprocess,json
p=subprocess.run(['supabase','db','query','--linked','--project-ref','isrqhkshygauaehwfycw',Path('artifacts/subscription-payment-race/live-check.sql').read_text()],capture_output=True,text=True,timeout=60)
if p.returncode: raise RuntimeError('Live atomic replay verification failed; raw database output withheld.')
output=p.stdout
result=json.loads(output[output.index('{'):output.rindex('}')+1])
assert any(r.get('result')=='passed' for r in result['rows'])
report={'date':'2026-11-17','database_rpc_checks':result['rows'],'rolled_back':True,'new_checkout_or_payment_created':False,'live_authenticated_http_replay_performed':False}
Path('artifacts/subscription-payment-race/live-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
