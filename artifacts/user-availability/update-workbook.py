from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
P=Path('Society Sync Pro 2.0 - APIs - Updated.xlsx');NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(P) as z:entries=z.infolist();original={e.filename:z.read(e.filename) for e in entries}
shared=[''.join(x.itertext()) for x in E.fromstring(original['xl/sharedStrings.xml'])]
def value(c):
 v=c.find('m:v',NS)
 return shared[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',NS).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def block(label,obj):
 s=json.dumps(obj,indent=2)
 for field,allowed in [('action','GET_STATUS, SET_STATUS'),('status','active, inactive, away'),('delivery_status','pending, sent, failed')]:
  s=re.sub(r'("'+field+r'": "[^"\n]+",?)',lambda m:m[0]+' // Allowed: '+allowed,s)
 return label+'\n'+s
prefix='JSONC illustrative examples; remove // comments before sending JSON. Not live API samples.\n\n'
request=prefix+block('Read own status',{'action':'GET_STATUS'})+'\n\n'+block('Set own status',{'action':'SET_STATUS','status':'away'})
responses=[]
for state in ['active','inactive','away']:
 responses.append(block(state,{'success':True,'data':{'userId':'<JWT_APPLICATION_USER_UUID>','status':state,'notificationsEnabled':state!='away','updatedAt':'2026-11-16T10:00:00Z'}}))
responses.append(block('Default when no preference exists',{'success':True,'data':{'userId':'<JWT_APPLICATION_USER_UUID>','status':'active','notificationsEnabled':True,'updatedAt':None}}))
for label,msg in [('HTTP 400','status must be active, inactive, or away.'),('HTTP 403','You can only manage your own availability.'),('HTTP 500','Unable to read or update user availability.')]:
 responses.append(block(label,{'success':False,'error':'ERROR','message':msg}))
new_response=prefix+'\n\n'.join(responses)
new={'A':'API-USER-AVAILABILITY','B':'Authenticated application user (own account only)','C':'Notifications / user availability','D':'Read or set active, inactive or away status for the authenticated user.','E':'user-availability','F':'POST','G':'/user-availability','H':'Authorization: Bearer <JWT_TOKEN>; requireAuth verifies signature and derives application user ID. Caller must exist in SSP_Society_User or SSP_Non_Society_User.','I':'Global availability across the user identity and its devices. Only away mutes notifications; active and inactive both allow notifications. Missing preference defaults to active. Account activation/deactivation and device is_active flags are separate. Away notifications remain failed audit records with extra_data.suppressedReason=user_away; pending work is suppressed and is not replayed after reactivation. Notifications already handed to the network cannot be recalled.','J':'Content-Type: application/json\nAuthorization: Bearer <JWT_TOKEN>','K':request,'L':'action required: GET_STATUS or SET_STATUS. status required only for SET_STATUS. Identity is derived from the JWT.','M':'userId optional legacy-style assertion only; if supplied it must equal the JWT application user ID. No societyRegistrationNumber needed.','N':'Local handler, sender and SOS regressions passed; migration and trigger assertions passed in local PostgreSQL/PGlite with a notification schema fixture. Production schema was not changed and no live delivery was tested.','O':'New local endpoint; NOT DEPLOYED. Apply migration first, then deploy user-availability, send-notification and send-sos-push so both push paths include the new helper.','P':'''curl --request POST https://isrqhkshygauaehwfycw.supabase.co/functions/v1/user-availability \\
  --header 'Authorization: Bearer <JWT_TOKEN>' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{"action":"SET_STATUS","status":"away"}' ''','Q':'2026-11-16','R':new_response,'S':'action: GET_STATUS, SET_STATUS; status: active, inactive, away. Inactive does not mute notifications. No automatic away expiry.','T':'supabase/functions/user-availability/index.ts SHA-256: '+sha('supabase/functions/user-availability/index.ts')+'\nHelper SHA-256: '+sha('supabase/functions/_shared/user-availability.ts')+'\nMigration: supabase/migrations/20261116100000_user_availability.sql\nTests: supabase/tests/user-availability.mjs; supabase/tests/user-availability.sql; artifacts/user-availability/migration-test.json. Local validation only; not deployed.'}
notify_request=prefix+block('Database webhook (record must refer to a persisted SSP_Notification)',{'type':'INSERT','table':'SSP_Notification','schema':'public','record':{'notification_id':'<NOTIFICATION_UUID>','delivery_status':'pending','recipient_id':'<APPLICATION_USER_UUID>','recipient_type':'Resident','title':'Visitor Approval Required','message':'Example Visitor is waiting for your approval.','notification_type':'VISITOR_APPROVAL_REQUEST','reference_table':'SSP_Non_Society_User','reference_id':'<OTP_VERIFIED_VISITOR_UUID>','navigation_screen':'/visitor-details','extra_data':{'visitorName':'Example Visitor'},'action_data':{'screen':'visitor-details','visitorId':'<OTP_VERIFIED_VISITOR_UUID>'}},'old_record':None})
notify_responses=[]
for reason in ['already processed','user_away','visitor_phone_not_verified']:
 notify_responses.append(block('HTTP 200 skipped',{'success':True,'skipped':True,'reason':reason}))
notify_responses.append(block('HTTP 200 delivery summary',{'success':True,'devices_total':2,'success_count':1,'failure_count':1,'results':[{'device_id':'<DEVICE_UUID_1>','token':'<FCM_TOKEN_1>','ok':True},{'device_id':'<DEVICE_UUID_2>','token':'<FCM_TOKEN_2>','ok':False,'error':'Requested entity was not found.','errorCode':'UNREGISTERED'}]}))
notify_responses.append(block('HTTP 500 example',{'success':False,'error':'Missing notification record.'}))
changed={};matches=[];allowed_changes=set()
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 rows=root.findall('.//m:sheetData/m:row',NS)
 for row in rows:
  cols={re.sub(r'\d','',c.get('r')):value(c) for c in row};ep=cols.get('E')
  if ep not in ['send-notification','send-sos-push']:continue
  note=' Availability update 2026-11-16: away users are suppressed; active and inactive still receive notifications. Shared helper lookup failures prevent sending. Pending notification audit rows suppressed by away remain failed and are not replayed.'
  updates={'I':cols['I']+note,'Q':'2026-11-16','N':'Local user availability, notification OTP gating and SOS routing tests passed. Migration tested in local PostgreSQL/PGlite. No production migration or live push test for this change.','O':cols['O']+'; availability change is local and NOT DEPLOYED. Migration must precede redeployment.','T':cols['T']+'\n2026-11-16 availability source: '+sha('supabase/functions/_shared/user-availability.ts')+'; shared FCM source: '+sha('supabase/functions/_shared/fcm.ts')+'; local-only verification.'}
  if ep=='send-notification':
   updates.update(K=notify_request,R=prefix+'\n\n'.join(notify_responses)+'\n\n'+cols['R'][cols['R'].index('// FCM message.data example'):],L='record object with notification_id and delivery_status. A pending webhook is rechecked against the persisted notification; current persisted recipient, content and status are used.',P='''curl --request POST https://isrqhkshygauaehwfycw.supabase.co/functions/v1/send-notification --header 'Content-Type: application/json' --data-raw '{"record":{"notification_id":"<PERSISTED_NOTIFICATION_UUID>","delivery_status":"pending"}}' ''')
   updates['T']+='\nSender source SHA-256: '+sha('supabase/functions/send-notification/index.ts')
  else:updates['R']=cols['R']+'\nAway recipients are skipped by the shared FCM helper before device lookup; their sent/device counts are zero. Other recipients are still dispatched independently. SOS categories/payloads and wrapper remain as illustrated above. Status is looked up using the recipient identity passed to the shared helper.'
  for col,s in updates.items():
   assert len(s)<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);replacement=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+replacement+text[m.end():];allowed_changes.add((i,ref))
  matches.append((i,row.get('r'),ep))
 if i==2:
  target=next(row for row in rows if row.get('r')=='61');assert all(not value(c) for c in target if re.sub(r'\d','',c.get('r')) in new)
  E.register_namespace('',NS['m'])
  bycol={re.sub(r'\d','',c.get('r')):c for c in target}
  for col,s in new.items():
   assert len(s)<=32767
   c=bycol.get(col)
   if c is None:c=E.SubElement(target,'{'+NS['m']+'}c',{'r':col+'61'})
   for child in list(c):c.remove(child)
   c.set('t','inlineStr');t=E.SubElement(E.SubElement(c,'{'+NS['m']+'}is'),'{'+NS['m']+'}t');t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');t.text=s;allowed_changes.add((i,col+'61'))
  def colnum(c):
   out=0
   for ch in re.sub(r'\d','',c.get('r')):out=out*26+ord(ch)-64
   return out
  target[:]=sorted(target,key=colnum)
  m=re.search(r'<row\b[^>]*\br="61"[^>]*>.*?</row>',text,re.S);assert m
  text=text[:m.start()]+E.tostring(target,encoding='unicode')+text[m.end():]
  matches.append((2,'61','user-availability'))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==3
# Validate every generated or retained request/response JSONC example for these endpoints.
for doc in [request,new_response,notify_request,prefix+'\n\n'.join(notify_responses)]:
 cleaned=re.sub(r' //[^\n]*','',doc);pos=0
 while True:
  start=cleaned.find('\n{',pos)
  if start<0:break
  _,end=json.JSONDecoder().raw_decode(cleaned[start+1:]);pos=start+1+end
# Confirm other cells, worksheets and package entries are unchanged.
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml'
 before={c.get('r'):value(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',NS)}
 after={c.get('r'):value(c) for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',NS)}
 for ref,v in after.items():
  assert len(v)<=32767
  if (i,ref) not in allowed_changes:assert v==before.get(ref,''),(i,ref)
tmp=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(tmp,'w') as z:
 for e in entries:z.writestr(e,changed.get(e.filename,original[e.filename]))
with zipfile.ZipFile(tmp) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
tmp.replace(P)
print('Workbook updated:',matches,'; JSONC examples, cell limits, unrelated cells and worksheets, and ZIP/XML integrity verified.')
