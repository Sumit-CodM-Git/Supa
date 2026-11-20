exec(open('artifacts/resident-subscription-plan/update-workbook.py').read().split("request={'actionType'")[0])
import subprocess,io
with zipfile.ZipFile(io.BytesIO(subprocess.check_output(['git','show','HEAD:'+str(P)]))) as z:baseline={n:z.read(n) for n in z.namelist()}
bshared=[''.join(x.itertext()) for x in E.fromstring(baseline['xl/sharedStrings.xml'])]
def bval(c):
 v=c.find('m:v',N)
 return bshared[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',N).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
names=['visitor-pass-operations','security-gate-console','send-notification','get-dashboard','resident-visitor','visitor-otp']
versions={f['slug']:f for f in json.loads(Path('artifacts/visitor-otp-revert/functions-after.json').read_text())}
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 brows={r.get('r'):{re.sub(r'\d','',c.get('r')):bval(c) for c in r} for r in E.fromstring(baseline[name]).findall('.//m:sheetData/m:row',N)}
 for row in root.findall('.//m:sheetData/m:row',N):
  current={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=current.get('G' if i==1 else 'E')
  if ep not in names:continue
  cells=brows[row.get('r')];updates=dict(cells)
  req,res,desc,date,src=('M','T','K','S','U') if i==1 else ('K','R','I','Q','T')
  if ep=='visitor-pass-operations':
   doc=cells[res];cuts=[]
   for start,end,obj in blocks(doc):
    if isinstance(obj.get('data'),dict) and 'residents' in obj['data']:
     for resident in obj['data']['residents']:resident['subscriptionPlan']='PREMIUM'
     rendered=json.dumps(obj,indent=2).replace('"subscriptionPlan": "PREMIUM"','"subscriptionPlan": "PREMIUM" // Current catalog: FREE, STARTER, GROWTH, PREMIUM; null if lookup unavailable')
     cuts.append((start,end,rendered))
   assert cuts
   for start,end,s in reversed(cuts):doc=doc[:start]+s+doc[end:]
   note='FETCH_RESIDENTS_BY_FLAT preserves residents[].subscriptionPlan from get_current_plan_code for the resident society/tower/block/flat. No active subscription returns FREE; failed billing lookup returns null. No additional request field required.'
   updates[res]='JSONC examples; remove // comments before sending JSON.\n'+doc+'\n'+note;updates[desc]+='\n'+note
  if ep=='visitor-otp':
   updates[req]='JSONC examples; remove // comments before sending JSON. Resident flat must have VISITOR_OTP entitlement.\n'+'\n\n'.join('Request operation '+str(n+1)+'\n'+json.dumps(obj,indent=2) for n,(_,_,obj) in enumerate(blocks(current[req])))
   updates[res]='JSONC examples; remove // comments before sending JSON. Resident plan eligibility uses get_entitlements.VISITOR_OTP.\n'+'\n\n'.join('Response example '+str(n+1)+'\n'+json.dumps(obj,indent=2).replace('"nextStep": "VERIFY_OTP",','"nextStep": "VERIFY_OTP", // Allowed: VERIFY_OTP, COMPLETED').replace('"nextStep": "COMPLETED",','"nextStep": "COMPLETED", // Allowed: VERIFY_OTP, COMPLETED') for n,(_,_,obj) in enumerate(blocks(current[res])))
  if ep=='get-dashboard':
   note='Pending separate profile-image work remains local: optional GET query includeProfileImage=true adds data.user.profileImageUrl. This opt-in profile addition is NOT DEPLOYED. Default dashboard response restored; no data.features visitor flags.'
   updates[desc]+='\n'+note;updates[req]+='\n'+note
   doc=updates[res]
   for start,end,obj in blocks(current[res]):
    if isinstance(obj.get('data'),dict) and isinstance(obj['data'].get('user'),dict) and 'profileImageUrl' in obj['data']['user']:
     obj['data'].pop('features',None);doc+='\n\nJSONC local opt-in profile-image example (not deployed):\n'+json.dumps(obj,indent=2)
   updates[res]=doc+'\n'+note
  f=versions[ep];assert f['status']=='ACTIVE' and f['verify_jwt'] is False
  status=f"2026-11-16 visitor OTP rollback DEPLOYED: ACTIVE v{f['version']}; existing verify_jwt=false preserved. Prior visitor OTP/notification and resident access behavior restored. Today's plan-based visitor controls and otpRequired/nextStep additions to REQUEST_APPROVAL removed. Existing visitor-otp operation response fields retained. subscriptionPlan in FETCH_RESIDENTS_BY_FLAT retained."
  updates[date]='2026-11-16';updates[src]=f'supabase/functions/{ep}/index.ts\nDeployed source SHA-256: '+hashlib.sha256(Path('/tmp/ssp-visitor-otp-revert-deploy/supabase/functions',ep,'index.ts').read_bytes()).hexdigest()+'\n'+status+'\nTests: resident-subscription-plan, visitor-creation-flow, notification-delivery-otp, local PostgreSQL rollback migration. Evidence: artifacts/visitor-otp-revert/functions-after.json; live-verification.json. Database rollback: 20261116140000_revert_visitor_plan_rules.sql. No live visitor creation or push delivery test.'
  if i==1:updates['Q']=status
  else:updates['N']='Local OTP/creation/subscription/delivery tests and PostgreSQL rollback checks passed. Authenticated live resident/visitor reads verified; no live visitor creation or push.';updates['O']=status
  for col,s in updates.items():
   if s==current.get(col):continue
   assert len(s)<=32767,(ep,col)
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S)
   if not m:continue
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  for col in [req,res]:
   try:
    for _,_,obj in blocks(updates[col]):json.loads(json.dumps(obj))
   except Exception:
    print(ep,col,updates[col][:1500]);raise
  matches.append((i,row.get('r'),ep))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==8,matches
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
out.replace(P);print('Updated rollback API documentation:',matches,'; examples, cell sizes, unrelated content and workbook integrity verified.')
