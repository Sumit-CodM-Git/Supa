from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
P=Path('Society Sync Pro 2.0 - APIs - Updated.xlsx');NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(P) as z:entries=z.infolist();original={e.filename:z.read(e.filename) for e in entries}
shared=[''.join(x.itertext()) for x in E.fromstring(original['xl/sharedStrings.xml'])]
def value(c):
 v=c.find('m:v',NS)
 return shared[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',NS).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
def uncomment(text):
 out=list(text);quoted=False;escape_next=False;i=0
 while i<len(text):
  ch=text[i]
  if quoted:
   if escape_next:escape_next=False
   elif ch=='\\':escape_next=True
   elif ch=='"':quoted=False
  elif ch=='"':quoted=True
  elif text[i:i+2]=='//':
   while i<len(text) and text[i]!='\n':out[i]=' ';i+=1
   continue
  i+=1
 return ''.join(out)
def blocks(text):
 clean=uncomment(text);pos=0;result=[]
 while True:
  m=re.search(r'(?m)^\{',clean[pos:])
  if not m:break
  start=pos+m.start();obj,end=json.JSONDecoder().raw_decode(clean[start:]);end+=start
  result.append((start,end,obj,text[max(0,pos):start]));pos=end
 return result
allowed={'otpRequired':'true, false','nextStep':'VERIFY_OTP, COMPLETED','visitorTabEnabled':'true, false','visitorDashboardCardEnabled':'true, false','visitorOtpEnabled':'true, false'}
def render(obj,old=''):
 comments={m[1]:m[2] for m in re.finditer(r'"([^"\n]+)":.*?// Allowed: ([^\n]+)',old)}
 comments.update(allowed);s=json.dumps(obj,indent=2)
 for key,choices in comments.items():
  s=re.sub(r'("'+re.escape(key)+r'": (?:"[^"\n]*"|true|false|\[[^\n]*\]),?)',lambda m:m[0]+' // Allowed: '+choices,s)
 return s
def sha(file):return hashlib.sha256(Path(file).read_bytes()).hexdigest()
visitor={'visitorId':'<VISITOR_UUID>','name':'Example Visitor','visitorName':'Example Visitor','phoneNumber':'9000000000','role':'visitor','visitorStatus':'Pending','purpose':'Family visit','preApproved':False,'approvalStatus':'pending','requiresApproval':True,'canApprove':True,'canReject':True,'vehicleNumber':None,'idProofType':None,'gateNumber':'1','checkInTime':None,'checkOutTime':None,'imageUrl':'https://<PROJECT>.supabase.co/storage/v1/object/sign/society-documents/<OBJECT_KEY>?token=<TOKEN>','createdAt':'2026-11-16T10:00:00Z'}
processed={'parkingSlot':None,'visitorId':'<VISITOR_UUID>','name':'Example Visitor','visitorName':'Example Visitor','phone':'9000000000','platform':'N/A','purpose':'Family visit','vehicle':'N/A','status':'Pending','approvalStatus':'pending','preApproved':False,'checkIn':None,'checkOut':None,'createdAt':'2026-11-16T10:00:00Z','flat':'101','block':'<CONFIGURED_BLOCK>','tower':'<CONFIGURED_TOWER>','residentName':'Example Resident','imageUrl':None}
matrix='Visitor plan matrix: PREMIUM visitor access and OTP; GROWTH and STARTER visitor access without OTP; FREE no visitor access, visitor tab or visitor dashboard card. Plan decisions use the target resident flat entitlements, including billing expiry fallback, not the security guard plan. Other feature categories are outside this visitor change.'
error={'success':False,'error':'FEATURE_NOT_AVAILABLE_FOR_RESIDENT','message':"The selected resident's plan does not include visitor access.",'requiredFeature':'VISITOR_APPROVAL'}
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',NS):
  cells={re.sub(r'\d','',c.get('r')):value(c) for c in row}
  endpoint=cells.get('G' if i==1 else 'E')
  if endpoint not in ['visitor-pass-operations','security-gate-console','resident-visitor','get-dashboard','send-notification']:continue
  reqcol,rescol,desccol,datecol,reviewcol,deploycol,sourcecol=('M','T','K','S','Q','Q','U') if i==1 else ('K','R','I','Q','N','O','T')
  response=cells[rescol];changes=[]
  for start,end,obj,heading in blocks(response):
   if not isinstance(obj,dict):continue
   data=obj.get('data');modified=False
   if endpoint in ['security-gate-console','visitor-pass-operations'] and 'REQUEST_APPROVAL' in heading and isinstance(data,dict):
    data['otpRequired']=False;data['nextStep']='COMPLETED';data['visitorId']='<VISITOR_UUID>';modified=True
    if endpoint=='security-gate-console':data.update(name='Example Visitor',visitorName='Example Visitor')
    else:data['visitor']=processed
   if endpoint=='resident-visitor' and isinstance(data,dict) and 'visitors' in data:
    data['visitors']=[visitor];modified=True
   if endpoint=='get-dashboard' and isinstance(data,dict) and 'user' in data:
    data['features']={'visitorTabEnabled':False,'visitorDashboardCardEnabled':False,'visitorOtpEnabled':False}
    data['user']['status']=True;data['user']['tower']={'towerId':'<TOWER_UUID>','towerName':'<CONFIGURED_TOWER>'};data['user']['block']={'blockId':'<BLOCK_UUID>','blockName':'<CONFIGURED_BLOCK>'}
    data['alerts']['items']=[{'id':'<ALERT_UUID>','title':'Example notice','message':'Example society notice','type':'<ACTUAL_ALERT_TYPE>','publishedDate':'2026-11-16T10:00:00Z','expiryDate':None,'createdAt':'2026-11-16T10:00:00Z','isToday':True}];modified=True
   if modified:changes.append((start,end,render(obj,response[start:end])))
  for start,end,s in reversed(changes):response=response[:start]+s+response[end:]
  if endpoint in ['security-gate-console','visitor-pass-operations']:
   if endpoint=='security-gate-console':premium={'success':True,'data':{'Visitors':[],'visitorId':'<VISITOR_UUID>','name':'Example Visitor','visitorName':'Example Visitor','success':True,'otpRequired':True,'nextStep':'VERIFY_OTP'}}
   else:premium={'success':True,'data':{'visitor':processed,'visitorId':'<VISITOR_UUID>','success':True,'otpRequired':True,'nextStep':'VERIFY_OTP'}}
   response+='\n\nJSONC Premium REQUEST_APPROVAL response (remove comments before using JSON):\n'+render(premium)+'\n\nJSONC Free plan denial (HTTP 402):\n'+render(error)+'\nPremium clients continue with visitor-otp using visitorId, phoneNumber and societyUserId; Starter/Growth skip that endpoint and await resident approval. otpRequired describes the plan requirement; nextStep is COMPLETED if OTP was already verified. No-OTP plans leave is_otp_verified=false.'
  if endpoint=='resident-visitor':response+='\n\nJSONC Free plan denial for VIEW or LOGS (HTTP 402):\n'+render(error)
  if endpoint=='get-dashboard':response+='\nFree example above: all three data.features visitor flags are false. Starter/Growth: visitorTabEnabled=true, visitorDashboardCardEnabled=true, visitorOtpEnabled=false. Premium: all three flags true. The frontend must honor these booleans to hide the visitor tab/card and decide whether to show an OTP step.'
  if endpoint=='send-notification':response+='\n\nJSONC Free-plan suppressed delivery (HTTP 200):\n'+render({'success':True,'skipped':True,'reason':'visitor_feature_not_available'})+'\nvisitor_phone_not_verified applies only when VISITOR_OTP is enabled (Premium). Starter/Growth unverified phone state does not suppress delivery. Away suppression still applies independently.'
  response='JSONC examples; remove // comments before sending JSON.\n'+response
  updates={rescol:response,reqcol:cells[reqcol]+'\n\n'+matrix,desccol:cells[desccol]+'\n'+matrix,datecol:'2026-11-16',sourcecol:'supabase/functions/'+endpoint+'/index.ts\nSource SHA-256: '+sha('supabase/functions/'+endpoint+'/index.ts')+'\nVisitor helper SHA-256: '+sha('supabase/functions/_shared/visitor-plan.ts')+'\nMigration: supabase/migrations/20261116110000_plan_aware_visitors.sql\nTests: visitor-creation-flow.mjs, notification-delivery-otp.mjs, parking-consistency.mjs, visitor-photo-flow.mjs, user-availability.mjs, and local PostgreSQL/PGlite trigger tests passed. Evidence: artifacts/visitor-plan-rules/database-test.json. Local source changes only; not deployed and no live FCM test.'}
  if i==1:updates['Q']='Local source reviewed 2026-11-16; visitor plan regressions and local PostgreSQL trigger tests passed. Plan-aware visitor changes NOT DEPLOYED.'
  else:updates['N']='Source reviewed 2026-11-16; visitor plan regressions and local PostgreSQL trigger tests passed. No live API/device test of this change.';updates['O']=cells['O']+'; plan-aware visitor change local only, NOT DEPLOYED.'
  for col,s in updates.items():
   assert len(s)<=32767,(endpoint,col,len(s))
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  # Parse actual JSONC examples from both cells, preserving quoted URL strings.
  assert blocks(response)
  for _start,_end,obj,_heading in blocks(response):json.loads(json.dumps(obj))
  matches.append((i,row.get('r'),endpoint))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==7,matches
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):value(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',NS)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',NS):
  assert len(value(c))<=32767
  if (i,c.get('r')) not in touched:assert value(c)==before.get(c.get('r'),'')
tmp=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(tmp,'w') as z:
 for entry in entries:z.writestr(entry,changed.get(entry.filename,original[entry.filename]))
with zipfile.ZipFile(tmp) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
tmp.replace(P)
print('Updated all matching rows:',matches,'; JSONC examples, cell limits, unchanged unrelated cells/sheets and ZIP/XML integrity validated.')
