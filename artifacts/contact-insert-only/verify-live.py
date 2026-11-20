from pathlib import Path
import subprocess,json
p=subprocess.run(['supabase','db','query','--linked','--project-ref','isrqhkshygauaehwfycw',Path('artifacts/contact-insert-only/live-check.sql').read_text()],capture_output=True,text=True,timeout=60)
if p.returncode: raise RuntimeError('Live rollback verification failed; raw database output withheld.')
output=p.stdout
result=json.loads(output[output.index('{'):output.rindex('}')+1])
assert any(r.get('result')=='passed' for r in result['rows']),result['rows']
report={'date':'2026-11-17','database_checks':result['rows'],'rolled_back':True,'live_member_or_profile_endpoint_test':False}
Path('artifacts/contact-insert-only/live-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
