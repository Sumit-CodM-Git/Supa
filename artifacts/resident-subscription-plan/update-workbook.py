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
request={'actionType':'FETCH_RESIDENTS_BY_FLAT','societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','flatNumber':'101','block':'<ACTUAL_BLOCK_NAME>','tower':'<ACTUAL_TOWER_NAME>','page':1,'limit':20}
response={'success':True,'data':{'residents':[{'parkingSlot':None,'phoneNumber':'9000000000','name':'Example Resident','flatNumber':'101','blockName':'<ACTUAL_BLOCK_NAME>','towerNumber':'<ACTUAL_TOWER_NAME>','societyUserId':'<RESIDENT_USER_UUID>','subscriptionPlan':'PREMIUM'}],'flatNumber':'101','pagination':{'currentPage':1,'pageSize':20,'totalRecords':1,'totalPages':1},'success':True}}
def render(obj):
 s=json.dumps(obj,indent=2)
 s=s.replace('"actionType": "FETCH_RESIDENTS_BY_FLAT",','"actionType": "FETCH_RESIDENTS_BY_FLAT", // Allowed: FETCH_PRE_APPROVALS, REQUEST_APPROVAL, UPDATE_STATUS, FETCH_INSIDE_LOGS, FETCH_RESIDENTS_BY_FLAT, FETCH_SERVANTS_BY_FLAT, UPDATE_SERVANT_STATUS')
 s=s.replace('"subscriptionPlan": "PREMIUM"','"subscriptionPlan": "PREMIUM" // Current catalog: FREE, STARTER, GROWTH, PREMIUM; null if lookup unavailable')
 return s
note='FETCH_RESIDENTS_BY_FLAT adds residents[].subscriptionPlan from the resident flat effective get_current_plan_code billing resolver, using society/tower/block/flat IDs. Current plan codes come from SSP_Subscription_Plan.plan_code (FREE, STARTER, GROWTH, PREMIUM). No active subscription resolves to FREE. Billing unavailability returns null without failing resident selection. All prior resident fields, ordering, primary-owner filters and pagination remain. UI must not interpret null as a known paid plan.'
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',N):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=cells.get('G' if i==1 else 'E')
  if ep!='visitor-pass-operations':continue
  req,res,desc,optional,date,src=('M','T','K','O','S','U') if i==1 else ('K','R','I','M','Q','T')
  reqDoc=cells[req];resDoc=cells[res];countReq=countRes=0
  cuts=[]
  for start,end,obj in blocks(reqDoc):
   if obj.get('actionType')=='FETCH_RESIDENTS_BY_FLAT':cuts.append((start,end,render(request)));countReq+=1
  for start,end,new in reversed(cuts):reqDoc=reqDoc[:start]+new+reqDoc[end:]
  cuts=[]
  for start,end,obj in blocks(resDoc):
   if isinstance(obj.get('data'),dict) and 'residents' in obj['data']:
    cuts.append((start,end,render(response)));countRes+=1
  for start,end,new in reversed(cuts):resDoc=resDoc[:start]+new+resDoc[end:]
  assert countReq and countRes,(i,row.get('r'),countReq,countRes)
  reqDoc+='\n'+note
  resDoc+='\n'+note+'\nExamples are JSONC: remove // comments before sending JSON. Block/tower request filters are actual configured names, not UUIDs. This source change is local and has not been deployed or live API tested.'
  updates={req:reqDoc,res:resDoc,desc:cells[desc]+'\n'+note,optional:cells.get(optional,'')+'\nFETCH_RESIDENTS_BY_FLAT block/tower filters remain optional names; no new request field is required.',date:'2026-11-16',src:'supabase/functions/visitor-pass-operations/index.ts\nSource SHA-256: '+hashlib.sha256(Path('supabase/functions/visitor-pass-operations/index.ts').read_bytes()).hexdigest()+'\nResident plan helper SHA-256: '+hashlib.sha256(Path('supabase/functions/_shared/resident-subscription-plan.ts').read_bytes()).hexdigest()+'\nVerified locally: resident-subscription-plan.mjs and visitor-creation-flow.mjs. Covers plan codes, missing subscription, cache isolation by actual tower/block IDs, pagination, primary-owner/society filtering, empty lists and billing failure. Not deployed; no live API test of this field.'}
  if i==1:updates['Q']='Existing live endpoint retained. New subscriptionPlan response field is local, NOT DEPLOYED; local tests passed.'
  else:updates['N']='Local resident subscription field and visitor creation regressions passed; no live API test of the new field.';updates['O']=cells['O']+'; subscriptionPlan field local only, NOT DEPLOYED.'
  for col,s in updates.items():
   assert len(s)<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  for doc in [reqDoc,resDoc]:
   for start,end,obj in blocks(doc):json.loads(json.dumps(obj))
  matches.append((i,row.get('r')))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==2,matches
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):val(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',N)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',N):
  assert len(val(c))<=32767
  if (i,c.get('r')) not in touched:assert val(c)==before.get(c.get('r'),'')
out=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(out,'w') as z:
 for e in entries:z.writestr(e,changed.get(e.filename,original[e.filename]))
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
out.replace(P)
print('Updated canonical workbook rows:',matches,'; JSONC examples, size limits, unrelated cells/worksheets and ZIP/XML integrity verified.')
