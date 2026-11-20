from pathlib import Path
import json,zipfile,xml.etree.ElementTree as E,re,hashlib
from xml.sax.saxutils import escape
p=Path('Society Sync Pro 2.0 - APIs - Updated.xlsx');ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
versions={f['slug']:f for f in json.loads(Path('artifacts/visitor-plan-rules/deployment/functions.json').read_text())}
live=json.loads(Path('artifacts/visitor-plan-rules/deployment/live-verification.json').read_text());assert all(c['http_status']==200 for c in live['checks'])
with zipfile.ZipFile(p) as z:entries=z.infolist();original={e.filename:z.read(e.filename) for e in entries}
shared=[''.join(x.itertext()) for x in E.fromstring(original['xl/sharedStrings.xml'])]
def val(c):
 v=c.find('m:v',ns)
 return shared[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',ns).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',ns):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=cells.get('G' if i==1 else 'E')
  if ep in versions:
   f=versions[ep];assert f['status']=='ACTIVE' and f['verify_jwt'] is False
   status=f"Deployed 2026-11-16: ACTIVE v{f['version']}; verify_jwt=false preserved. Visitor plan migration and availability-table dependency applied; migration history recorded."
   verification='Local visitor plan/creation/OTP/notification and PostgreSQL tests passed. Post-deploy authenticated read-only dashboard and visitor reads returned HTTP 200; sender already-processed skip returned HTTP 200. Live four-plan flags verified. No live visitor creation or mobile push delivery test during deployment.'
   source='supabase/functions/'+ep+'/index.ts';sha=hashlib.sha256(Path(source).read_bytes()).hexdigest()
   provenance=source+'\nSource SHA-256: '+sha+'\n'+status+'\n'+verification+'\nEvidence: artifacts/visitor-plan-rules/deployment/functions.json; live-verification.json. Backup: artifacts/visitor-plan-rules/deployment/before.json. UI must consume data.features and otpRequired/nextStep.'
   updates={'Q':status+' '+verification,'S':'2026-11-16','U':provenance} if i==1 else {'N':verification,'O':status,'Q':'2026-11-16','T':provenance}
   matches.append((i,row.get('r'),ep,f['version']))
  elif ep=='user-availability' and i==2:
   updates={'O':'Availability table and migration applied live 2026-11-16 as a dependency of visitor notification delivery. user-availability endpoint is NOT DEPLOYED. Regular send-notification away checks deployed; direct SOS helper change still pending deployment.','T':cells['T']+'\n2026-11-16 deployment note: availability schema applied and migration history recorded. No user status changed. This endpoint itself remains undeployed.'}
  else:continue
  for col,s in updates.items():
   assert len(s)<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==7,matches
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):val(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',ns)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',ns):
  assert len(val(c))<=32767
  if (i,c.get('r')) not in touched:assert val(c)==before.get(c.get('r'),'')
tmp=p.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(tmp,'w') as z:
 for e in entries:z.writestr(e,changed.get(e.filename,original[e.filename]))
with zipfile.ZipFile(tmp) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
tmp.replace(p)
print('Canonical workbook deployment/version/verification records updated in all seven matching rows; integrity and unrelated contents verified.')
