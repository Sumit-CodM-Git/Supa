from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
P=Path('Society Sync Pro 2.0 - APIs - Updated.xlsx');N={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(P) as z:entries=z.infolist();original={e.filename:z.read(e.filename) for e in entries}
shared=[''.join(x.itertext()) for x in E.fromstring(original['xl/sharedStrings.xml'])]
def val(c):
 v=c.find('m:v',N)
 return shared[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',N).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
def clean(s):
 out=list(s);quoted=False;escape_next=False;i=0
 while i<len(s):
  if quoted:
   if escape_next:escape_next=False
   elif s[i]=='\\':escape_next=True
   elif s[i]=='"':quoted=False
  elif s[i]=='"':quoted=True
  elif s[i:i+2]=='//':
   while i<len(s) and s[i]!='\n':out[i]=' ';i+=1
   continue
  i+=1
 return ''.join(out)
def blocks(s):
 text=clean(s);out=[];pos=0
 while True:
  m=re.search(r'(?m)^\{',text[pos:])
  if not m:break
  start=pos+m.start();obj,end=json.JSONDecoder().raw_decode(text[start:]);end+=start;out.append((start,end,obj));pos=end
 return out

verification=json.loads(Path('artifacts/profile-images-live/verification.json').read_text());assert verification['result']=='passed'
function=json.loads(Path('artifacts/profile-images-live/function.json').read_text())
changed={};touched=set();matches=[]
for i in range(1,4):
 part=f'xl/worksheets/sheet{i}.xml';text=original[part].decode()
 for row in E.fromstring(original[part]).findall('.//m:sheetData/m:row',N):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row}
  if cells.get('G' if i==1 else 'E')!='profile-images':continue
  desc,req,res,date,src=('K','M','T','S','U') if i==1 else ('I','K','R','Q','T')
  updates={date:'2026-11-17',desc:cells[desc]+' Deployment fix 2026-11-17: endpoint previously absent from production, causing gateway NOT_FOUND. Profile metadata migration and private bucket now applied; profile-images endpoint deployed. Existing opt-in reader endpoints are separate deployments.'}
  status=f"DEPLOYED ACTIVE v{function['version']} on 2026-11-17. Migration 20261116120000_profile_images.sql APPLIED. Endpoint requireAuth validates application JWT; gateway verify_jwt=false."
  checks='Live authenticated PREPARE_UPLOAD, binary PUT, CONFIRM_UPLOAD, FETCH and signed image download passed; bytes and metadata verified. Unauthenticated request rejected HTTP 401; confirm-before-upload rejected HTTP 409. Temporary owner, metadata and storage object removed. Flutter UI not exercised. Existing reader opt-in code not deployed in this task.'
  updates[src]='supabase/functions/profile-images/index.ts SHA-256: '+hashlib.sha256(Path('supabase/functions/profile-images/index.ts').read_bytes()).hexdigest()+'\nShared helper SHA-256: '+hashlib.sha256(Path('supabase/functions/_shared/profile-images.ts').read_bytes()).hexdigest()+'\n'+status+'\n'+checks+'\nEvidence: artifacts/profile-images-live/verification.json and function.json.'
  if i==1:updates['Q']=status
  else:updates['N']=checks;updates['O']=status
  for col in [req,res]:
   assert blocks(cells[col]),col
   for _,_,obj in blocks(cells[col]):json.loads(json.dumps(obj))
  for col,value in updates.items():
   assert len(value.encode('utf-16-le'))//2<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m,ref
   style=re.search(r'\bs="([^\"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  matches.append((i,row.get('r'),'profile-images'))
 if text.encode()!=original[part]:changed[part]=text.encode()
assert matches
for i in range(1,4):
 part=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):val(c) for c in E.fromstring(original[part]).findall('.//m:sheetData/m:row/m:c',N)}
 for c in E.fromstring(changed.get(part,original[part])).findall('.//m:sheetData/m:row/m:c',N):
  assert len(val(c).encode('utf-16-le'))//2<=32767
  if (i,c.get('r')) not in touched:assert val(c)==before.get(c.get('r'),'')
out=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(out,'w') as z:
 for entry in entries:z.writestr(entry,changed.get(entry.filename,original[entry.filename]))
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
out.replace(P);print('Profile upload deployment documented:',matches,'; examples, cell limits and workbook integrity validated; unrelated contents preserved.')
