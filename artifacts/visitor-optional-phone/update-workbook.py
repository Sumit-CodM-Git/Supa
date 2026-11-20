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

import subprocess,io
with zipfile.ZipFile(io.BytesIO(subprocess.check_output(['git','show','HEAD:'+str(P)]))) as z:baseline={n:z.read(n) for n in z.namelist()}
bstrings=[''.join(x.itertext()) for x in E.fromstring(baseline['xl/sharedStrings.xml'])]
def bval(c):
 v=c.find('m:v',N)
 return bstrings[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',N).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
report=json.loads(Path('artifacts/visitor-optional-phone/live-verification.json').read_text())
versions={f['slug']:f['version'] for f in report['functions']}
note="2026-11-17 replacement: only security-created, non-pre-approved walk-in visitors for non-Premium residents may omit phone/phoneNumber and skip visitor OTP. Omitted/null/blank phone is stored as null; verification stays false. Premium residents and vendor roles still require phone. Premium OTP verification remains required for approval notification. Resolve the target resident flat with get_current_plan_code; failed lookup prevents phone-less creation. Pre-approved arrival and check-in/check-out notification rules restored to pre-change behavior. No phone hiding was introduced."
required="REQUEST_APPROVAL: societyRegistrationNumber, societyUserId and visitorName (or a saved name from visitorId). phone/phoneNumber required for PREMIUM residents, vendor roles or pre-approved visitors; optional for non-Premium walk-in visitors."
changed={};touched=set();matches=[]
for i in range(1,4):
 part=f'xl/worksheets/sheet{i}.xml';text=original[part].decode()
 brows={r.get('r'):{re.sub(r'\d','',c.get('r')):bval(c) for c in r} for r in E.fromstring(baseline[part]).findall('.//m:sheetData/m:row',N)}
 for row in E.fromstring(original[part]).findall('.//m:sheetData/m:row',N):
  current={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=current.get('G' if i==1 else 'E')
  if ep not in ['visitor-pass-operations','security-gate-console','send-notification']:continue
  # Restore only today's affected rows to their pre-change contract, then document the narrower replacement.
  cells=brows[row.get('r')];updates=dict(cells)
  req,res,desc,reqfields,opt,date,src,curl=('M','T','K','N','O','S','U','R') if i==1 else ('K','R','I','L','M','Q','T','P')
  updates[desc]=cells[desc]+'\n'+note
  if ep!='send-notification':
   reqdoc=cells[req];cuts=[]
   for start,end,obj in blocks(reqdoc):
    if obj.get('actionType')=='REQUEST_APPROVAL':
     payload={'actionType':'REQUEST_APPROVAL','societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','societyUserId':'<RESIDENT_USER_UUID>','securityGuardId':'<SECURITY_GUARD_USER_UUID>','visitorName':'Example Visitor','role':'visitor'}
     example=json.dumps(payload,indent=2).replace('"role": "visitor"','"role": "visitor" // Allowed: visitor, vendor; vendor requires phone')
     premium={**payload,'phoneNumber':'9000000000','visitorId':'<VERIFIED_OTP_VISITOR_UUID>'}
     example+='\n\nREQUEST_APPROVAL for a Premium resident after OTP verification\n'+json.dumps(premium,indent=2).replace('"role": "visitor",','"role": "visitor", // Allowed: visitor, vendor')
     cuts.append((start,end,example))
   assert cuts,(i,ep,'request')
   for start,end,rendered in reversed(cuts):reqdoc=reqdoc[:start]+rendered+reqdoc[end:]
   updates[req]='JSONC examples; remove // comments before sending JSON. First REQUEST_APPROVAL example is a non-Premium walk-in with phone and OTP omitted. Optional purpose/gender/vehicleType values come from the society configuration.\n'+reqdoc
   # The second response example is REQUEST_APPROVAL in each documented operation sequence.
   response=cells[res];items=blocks(response);assert len(items)>1
   start,end,obj=items[1]
   if ep=='visitor-pass-operations':
    obj={'success':True,'data':{'visitor':{'parkingSlot':None,'visitorId':'<CREATED_VISITOR_UUID>','name':'Example Visitor','visitorName':'Example Visitor','phone':'','platform':'N/A','purpose':'N/A','vehicle':'N/A','status':'Pending','approvalStatus':'pending','preApproved':False,'checkIn':None,'checkOut':None,'createdAt':'2026-11-17T10:00:00Z','flat':'<ACTUAL_FLAT>','block':'<ACTUAL_BLOCK_NAME>','tower':'<ACTUAL_TOWER_NAME>','residentName':'Example Resident','imageUrl':None},'visitorId':'<CREATED_VISITOR_UUID>','success':True}}
   else:obj={'success':True,'data':{'Visitors':[],'visitorId':'<CREATED_VISITOR_UUID>','name':'Example Visitor','visitorName':'Example Visitor','success':True}}
   updates[res]='JSONC examples; remove // comments before sending JSON. REQUEST_APPROVAL illustrates a non-Premium walk-in without phone/OTP.\n'+response[:start]+json.dumps(obj,indent=2)+response[end:]
   old=cells[reqfields]
   old=old.replace('REQUEST_APPROVAL: societyUserId and visitorName plus phone/phoneNumber, or a verified OTP visitorId.',required)
   if required not in old:old+='\n'+required
   updates[reqfields]=old
   updates[opt]=cells[opt]+'\nphone/phoneNumber: optional for non-Premium walk-in visitor role; may be omitted, null or blank. otp: not sent to REQUEST_APPROVAL; non-Premium walk-ins skip visitor-otp entirely. Supplied phone numbers retain existing visibility.'
   updates[curl]=cells[curl]+"\n\nNon-Premium visitor without phone or OTP:\ncurl --request POST https://isrqhkshygauaehwfycw.supabase.co/functions/v1/"+ep+" --header 'Authorization: Bearer <LOGIN_TOKEN>' --header 'Content-Type: application/json' --data-raw '"+json.dumps(payload,separators=(',',':'))+"'"
  else:
   updates[res]=cells[res]+'\n// Only non-Premium walk-in VISITOR_APPROVAL_REQUEST notifications bypass OTP. Pre-approved arrival and other visitor notification types retain verified-only delivery.'
   updates[req]=cells[req].replace('<OTP_VERIFIED_VISITOR_UUID>','<VISITOR_UUID>')
  updates[date]='2026-11-17'
  updates[src]=f'supabase/functions/{ep}/index.ts\nSource SHA-256: '+hashlib.sha256(Path(f'supabase/functions/{ep}/index.ts').read_bytes()).hexdigest()+f'\nDEPLOYED ACTIVE v{versions[ep]}; verify_jwt=false preserved. Migration 20261117160000_optional_phone_nonpremium_walkins.sql APPLIED; supersedes today earlier broad rule.\nBoth guard routes tested locally with FREE/STARTER/GROWTH/PREMIUM, omitted/blank phone, vendor and lookup-error cases. Live FREE phone-less walk-in/PREMIUM trigger, deduplication and restored pre-approved OTP checks passed in rolled-back transaction. Deployed notification HTTP smoke passed. Postman collection executed live via Newman: 16 requests, 37 assertions passed across both guard APIs; 8 phone-less and 2 supplied-phone visitors verified in the database, then all 10 test visitors and their notifications removed. No real device push test. Evidence: artifacts/visitor-optional-phone/live-verification.json; live-check.sql; postman/result.json.'
  status=f'2026-11-17 DEPLOYED ACTIVE v{versions[ep]}; replacement migration APPLIED. Narrow non-Premium walk-in optional phone/OTP change.'
  if i==1:updates['Q']=status
  else:updates['N']='Local guard regression and live rollback-only database checks passed; notification HTTP smoke passed. Postman collection executed live via Newman: 16 requests, 37 assertions passed across both guard APIs; 8 phone-less and 2 supplied-phone visitors verified in the database, then all 10 test visitors and their notifications removed. No real device push test.';updates['O']=status
  for col in [req,res]:
   assert blocks(updates[col]),(ep,col)
   for _,_,obj in blocks(updates[col]):json.loads(json.dumps(obj))
  for col,value in updates.items():
   if value==current.get(col):continue
   assert len(value.encode('utf-16-le'))//2<=32767,(ep,col)
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S)
   if not m:assert not value,(ref,value);continue
   style=re.search(r'\bs="([^\"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  matches.append((i,row.get('r'),ep))
 if text.encode()!=original[part]:changed[part]=text.encode()
assert len(matches)==5,matches
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
out.replace(P);print('Updated canonical workbook:',matches,'; JSONC examples, cell sizes, unrelated content and workbook integrity validated.')
