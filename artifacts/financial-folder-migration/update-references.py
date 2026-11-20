from pathlib import Path
import json,subprocess
folder=Path(__file__).parent
copies=json.loads((folder/'copies.json').read_text())
assert len(copies)==43 and all(x['head_verified'] for x in copies)
p=subprocess.run(['supabase','db','query','--linked','--project-ref','isrqhkshygauaehwfycw','--file',str(folder/'update-references.sql')],capture_output=True,text=True,timeout=75)
if p.returncode:raise SystemExit('Reference migration failed: '+p.stderr[-1500:])
v=json.loads(p.stdout[p.stdout.index('{'):p.stdout.rindex('}')+1])['rows'][0]['result']
assert v['document_links_updated']==42 and v['verified_copies']==43
(folder/'reference-update-result.json').write_text(json.dumps(v,indent=2)+'\n')
print(json.dumps(v,indent=2))
