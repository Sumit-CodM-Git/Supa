import json,subprocess
from pathlib import Path
folder=Path(__file__).parent
p=subprocess.run(['supabase','db','query','--linked','--project-ref','isrqhkshygauaehwfycw','--file',str(folder/'preflight.sql')],capture_output=True,text=True,timeout=90)
if p.returncode:raise SystemExit('Inventory query failed: '+p.stderr[-1500:])
v=json.loads(p.stdout[p.stdout.index('{'):p.stdout.rindex('}')+1])['rows'][0]['preflight']
(folder/'inventory.json').write_text(json.dumps(v,indent=2)+'\n')
print(json.dumps({'objects':len(v['source_objects'] or []),'reference_columns':v['reference_columns'],'total_bytes':sum(int(x['metadata'].get('size',0)) for x in v['source_objects'])},indent=2))
