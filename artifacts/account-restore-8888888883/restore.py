from pathlib import Path
import subprocess,json
report=Path('artifacts/account-restore-8888888883')
before={'user_id':'120138e3-20d8-4e65-9196-c9e7062c8faa','phone':'8888888883','registration_number':'GZB-1234-ab','role':['admin','resident','service_agent','security'],'status':True,'deleted_at':'2026-11-17T08:24:57.012Z','move_out_date':None}
(report/'before.json').write_text(json.dumps(before,indent=2))
p=subprocess.run(['supabase','db','query','--linked','--project-ref','isrqhkshygauaehwfycw',(report/'restore.sql').read_text()],capture_output=True,text=True,timeout=45)
if p.returncode:raise RuntimeError('Targeted restoration failed; raw database output withheld.')
o=p.stdout;result=json.loads(o[o.index('{'):o.rindex('}')+1])['rows']
assert len(result)==1 and result[0]['deleted_at'] is None and result[0]['role']==before['role']
(report/'restored.json').write_text(json.dumps({'restored_accounts':1,'changed_field':'deleted_at','account':result[0]},indent=2))
print(json.dumps({'restored_accounts':1,'account':result[0]}))
