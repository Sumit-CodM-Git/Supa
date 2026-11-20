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

changed={};touched=set();matches=[]
note="Visitor OTP rule (2026-11-17): resident approval and visitor notifications require OTP only when the target resident flat's effective get_current_plan_code is PREMIUM. FREE, STARTER, GROWTH and no active subscription proceed without OTP; is_otp_verified remains false until actual verification. Uses the resident society/tower/block/flat, never the security guard plan. Missing/deleted or society-mismatched hosts fail closed. Away-user suppression still applies. No request fields or response wrappers added."
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',N):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=cells.get('G' if i==1 else 'E')
  if ep not in ['send-notification','security-gate-console','visitor-pass-operations']:continue
  req,res,desc,date,src=('M','T','K','S','U') if i==1 else ('K','R','I','Q','T')
  updates={desc:cells[desc] if note in cells[desc] else cells[desc]+'\n'+note,date:'2026-11-17',src:f'supabase/functions/{ep}/index.ts\nMigration: supabase/migrations/20261117120000_visitor_otp_premium_only.sql\nDatabase migration applied 2026-11-17; send-notification ACTIVE v36 deployed with verify_jwt=false. Other endpoint source unchanged. Local visitor creation/delivery and database matrix passed. Live FREE/PREMIUM trigger checks passed with fixtures rolled back; deployed HTTP smoke check passed. No real device push test. Evidence: artifacts/visitor-otp-premium/live-verification.json; live-check.sql.'}
  updates[req]=cells[req].replace('<OTP_VERIFIED_VISITOR_UUID>','<VISITOR_UUID>')
  updates[res]=cells[res] if note in cells[res] else cells[res]+'\n// '+note
  if ep=='send-notification':
   updates[desc]=updates[desc].replace('Supports verified-visitor notification gating','Supports resident-plan-aware visitor notification gating')
   updates[res]+='\n// visitor_phone_not_verified: missing visitor or target host, or Premium resident visitor awaiting OTP. Plan lookup errors fail delivery with HTTP 500.'
  if i==1:updates['Q']='2026-11-17: visitor OTP database rule APPLIED; send-notification DEPLOYED v36. Live FREE/PREMIUM database checks and endpoint smoke passed; no device push test.'
  else:updates['N']='Local regression tests passed. Live FREE/PREMIUM notification triggers, OTP transition, deduplication and phone reset passed in rollback transaction. send-notification HTTP smoke passed. STARTER/GROWTH local-only; no device push test.';updates['O']='2026-11-17: database migration APPLIED; send-notification ACTIVE v36 DEPLOYED. Other endpoint source unchanged.'
  for col in [req,res]:
   assert blocks(updates[col]),(ep,col)
   for _,_,obj in blocks(updates[col]):json.loads(json.dumps(obj))
  for col,s in updates.items():
   assert len(s.encode('utf-16-le'))//2<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m,ref
   style=re.search(r'\bs="([^\"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  matches.append((i,row.get('r'),ep))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert matches
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):val(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',N)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',N):
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
out.replace(P);print('Updated workbook rows:',matches,'; JSONC examples, cell sizes and unrelated contents validated.')
