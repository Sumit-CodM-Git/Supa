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
 out=list(s);quoted=False;esc=False;i=0
 while i<len(s):
  if quoted:
   if esc:esc=False
   elif s[i]=='\\':esc=True
   elif s[i]=='"':quoted=False
  elif s[i]=='"':quoted=True
  elif s[i:i+2]=='//':
   while i<len(s) and s[i]!='\n':out[i]=' ';i+=1
   continue
  i+=1
 return ''.join(out)
def blocks(s):
 text=clean(s);pos=0;out=[]
 while True:
  m=re.search(r'(?m)^\{',text[pos:])
  if not m:break
  start=pos+m.start();obj,end=json.JSONDecoder().raw_decode(text[start:]);end+=start;out.append((start,end,obj));pos=end
 return out
def block(label,obj):
 s=json.dumps(obj,indent=2)
 for key,opts in [('nextStep','VERIFY_OTP, COMPLETED'),('otpVerified','true, false'),('isNewVisitor','true, false'),('requiresVisitorDetails','true, false')]:
  s=re.sub(r'("'+key+r'": (?:"[^"\n]*"|true|false),?)',lambda m:m[0]+' // Allowed: '+opts,s)
 return label+'\n'+s
prefix='JSONC illustrative examples; remove // comments before sending JSON. IDs and timestamps are examples, not live API samples.\n\n'
policy='Gate visitor creation and approval do not require a subscription or VISITOR_APPROVAL feature row. The target resident effective plan from get_current_plan_code is authoritative: only PREMIUM requires OTP before resident notification. FREE, STARTER, GROWTH, no subscription and expired-subscription fallback proceed without OTP. Real name and pending approval are still required before notifying; existing away/device preferences still apply. Tab/dashboard visibility rules are separate and unchanged.'
req={'societyUserId':'<RESIDENT_USER_UUID>','visitorId':'<EXISTING_VISITOR_UUID>','phoneNumber':'9000000000','fullName':'Example Visitor'}
otpRequest=prefix+block('Generate/resend OTP for existing Premium visitor',req)+'\n\n'+block('Verify Premium visitor OTP',{**req,'otp':'<ENTERED_6_DIGIT_OTP>'})+'\nOmit visitorId only when intentionally starting a new visit. Non-Premium callers skip this endpoint; their visitor is created through REQUEST_APPROVAL without OTP.'
base={'visitorId':'<VISITOR_UUID>','phoneNumber':'9000000000','name':'Example Visitor','visitorName':'Example Visitor','message':'OTP has been sent. Please verify OTP.','otpVerified':False,'isNewVisitor':True,'nextStep':'VERIFY_OTP','requiresVisitorDetails':False}
otpResponse=prefix+'\n\n'.join([
 block('Generate/resend HTTP 200',{'success':True,'data':base}),
 block('Verify named visitor HTTP 200',{'success':True,'data':{**base,'message':'OTP verified successfully.','otpVerified':True,'nextStep':'COMPLETED'}}),
 block('Verify unnamed visitor HTTP 200; details are still required before approval notification',{'success':True,'data':{**base,'name':None,'visitorName':None,'message':'OTP verified successfully.','otpVerified':True,'nextStep':'COMPLETED','requiresVisitorDetails':True}}),
 block('Non-Premium OTP operation HTTP 402 (does not block REQUEST_APPROVAL creation)',{'success':False,'error':'FEATURE_NOT_AVAILABLE_FOR_RESIDENT','message':"The selected resident's plan does not include Visitor OTP. Their plan: FREE.",'requiredFeature':'VISITOR_OTP','residentPlan':'FREE'}),
 block('Incorrect OTP HTTP 400',{'success':False,'error':'ERROR','message':'Invalid OTP provided. Please try again.'}),
])
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',N):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=cells.get('G' if i==1 else 'E')
  if ep not in ['visitor-pass-operations','security-gate-console','visitor-otp','send-notification']:continue
  reqcol,rescol,desccol,datecol,srccol=('M','T','K','S','U') if i==1 else ('K','R','I','Q','T')
  request=cells[reqcol];response=cells[rescol]
  if ep in ['visitor-pass-operations','security-gate-console','send-notification']:
   cuts=[]
   for start,end,obj in blocks(response):
    if obj.get('requiredFeature')=='VISITOR_APPROVAL' or obj.get('reason')=='visitor_feature_not_available':
     heading=response.rfind('\n\n',0,start);cuts.append((max(0,heading),end))
   for start,end in reversed(cuts):response=response[:start]+response[end:]
   response=response.replace('visitor_phone_not_verified applies only when VISITOR_OTP is enabled (Premium).','visitor_phone_not_verified applies only to effective Premium plans.')
   response+='\n\n'+policy+'\nFor no subscription/Free/Starter/Growth: data.otpRequired=false and data.nextStep=COMPLETED after creating the Pending visitor. For unverified Premium: data.otpRequired=true and data.nextStep=VERIFY_OTP. Existing IDs, wrappers and visitor fields are retained. No-OTP plans do not set is_otp_verified=true.'
  else:request=otpRequest;response=otpResponse
  request+='\n\n'+policy
  source=f'supabase/functions/{ep}/index.ts';sha=hashlib.sha256(Path(source).read_bytes()).hexdigest()
  updates={reqcol:request,rescol:response,desccol:cells[desccol]+'\n'+policy,datecol:'2026-11-16',srccol:source+'\nSource SHA-256: '+sha+'\nVisitor policy helper SHA-256: '+hashlib.sha256(Path('supabase/functions/_shared/visitor-plan.ts').read_bytes()).hexdigest()+'\nMigration: supabase/migrations/20261116130000_premium_only_visitor_otp.sql\nLocal creation/delivery and PostgreSQL/PGlite tests passed for active Premium, other plans, absent feature rows, no subscription, expired fallback and no-flat fallback. No production migration/deployment for this correction. Earlier live OTP checks exercised the prior deployed version.'}
  if i==1:updates['Q']='Existing endpoint remains live. Subscription-independent/Premium-only visitor correction is local, NOT DEPLOYED. Local tests passed.'
  else:updates['N']='Local visitor creation, OTP, delivery and PostgreSQL/PGlite tests passed; correction not live-tested.';updates['O']=cells['O']+'; Premium-only OTP correction is local, NOT DEPLOYED.'
  if ep=='visitor-otp':
   updates['L']='phoneNumber and societyUserId required. visitorId recommended for an existing visit. otp required only for verification; effective Premium resident plan required for OTP operations.'
   updates['M']='visitorId optional for new-visit generation; fullName/name/visitorName aliases and visitorData name envelope supported. Name aliases must agree. Use exact saved resident, visitor and phone identifiers.'
  for col,s in updates.items():
   assert len(s)<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  for doc in [request,response]:
   for start,end,obj in blocks(doc):json.loads(json.dumps(obj))
  matches.append((i,row.get('r'),ep))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==6,matches
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):val(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',N)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',N):
  assert len(val(c))<=32767
  if (i,c.get('r')) not in touched:assert val(c)==before.get(c.get('r'),'')
out=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(out,'w') as z:
 for entry in entries:z.writestr(entry,changed.get(entry.filename,original[entry.filename]))
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
out.replace(P)
print('Canonical workbook updated:',matches,'; JSONC examples, cell sizes, unrelated contents and ZIP/XML integrity validated.')
