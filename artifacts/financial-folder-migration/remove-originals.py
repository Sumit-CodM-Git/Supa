"""Delete only inventoried originals after verified copies and link migration."""
from pathlib import Path
import json,subprocess
folder=Path(__file__).parent
items=json.loads((folder/'inventory.json').read_text())['source_objects']
copies=json.loads((folder/'copies.json').read_text())
links=json.loads((folder/'reference-update-result.json').read_text())
assert len(items)==len(copies)==43 and all(x['head_verified'] for x in copies)
assert links['document_links_updated']==42 and links['payment_statuses_preserved']
assert {x['source'] for x in items}=={x['source'] for x in copies}
p=subprocess.run(['supabase','storage','rm',*['ss:///society-documents/'+x['source'] for x in items],'--linked','--project-ref','isrqhkshygauaehwfycw','--experimental','--yes'],capture_output=True,text=True,timeout=90)
if p.returncode:raise SystemExit('Storage deletion failed: '+p.stderr[-1500:])
(folder/'removal-result.json').write_text(json.dumps({'api_deletion_succeeded':True,'exact_original_paths_deleted':len(items)},indent=2)+'\n')
print('Storage API removed the 43 exact verified originals; no recursive deletion used.')
