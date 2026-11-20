from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib,copy
from xml.sax.saxutils import escape
P=Path('Society Sync Pro 2.0 - APIs - Updated.xlsx');NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(P) as z:entries=z.infolist();original={e.filename:z.read(e.filename) for e in entries}
shared=[''.join(x.itertext()) for x in E.fromstring(original['xl/sharedStrings.xml'])]
def val(c):
 v=c.find('m:v',NS)
 return shared[int(v.text)] if c.get('t')=='s' else ''.join(c.find('m:is',NS).itertext()) if c.get('t')=='inlineStr' else v.text if v is not None else ''
def sha(file):return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def uncomment(text):
 out=list(text);quoted=False;escaped=False;i=0
 while i<len(text):
  if quoted:
   if escaped:escaped=False
   elif text[i]=='\\':escaped=True
   elif text[i]=='"':quoted=False
  elif text[i]=='"':quoted=True
  elif text[i:i+2]=='//':
   while i<len(text) and text[i]!='\n':out[i]=' ';i+=1
   continue
  i+=1
 return ''.join(out)
def blocks(text):
 clean=uncomment(text);pos=0;out=[]
 while True:
  m=re.search(r'(?m)^\{',clean[pos:])
  if not m:break
  start=pos+m.start();obj,n=json.JSONDecoder().raw_decode(clean[start:]);out.append(obj);pos=start+n
 return out
prefix='JSONC illustrative examples. Remove // comments before sending JSON. Replace placeholders with actual database values. Signed URLs shown are examples, not usable credentials.\n\n'
def block(label,obj):
 s=json.dumps(obj,indent=2)
 choices={'ownerType':'society_user, non_society_user, servant, society_staff','action':'PREPARE_UPLOAD, CONFIRM_UPLOAD, FETCH','actionType':'FETCH_ONE, FETCH_ALL, UPDATE','operation':'FETCH, CREATE, UPDATE, DELETE','fileType':'image/jpeg, image/png, image/webp','includeProfileImage':'true, false','uploadStatus':'pending_upload, uploaded'}
 for key,allowed in choices.items():
  s=re.sub(r'("'+key+r'": (?:"[^"\n]*"|true|false),?)',lambda m:m[0]+' // Allowed: '+allowed,s)
 return label+'\n'+s
def examples(pairs):return prefix+'\n\n'.join(block(label,obj) for label,obj in pairs)
url='https://<PROJECT_REF>.supabase.co/storage/v1/object/sign/profile-images/<OBJECT_KEY>?token=<SIGNED_TOKEN>'
reg='<SOCIETY_REGISTRATION_NUMBER>';owner='<APPLICATION_USER_UUID>';non='<NON_SOCIETY_USER_UUID>'
contact={'parkingSlot':None,'contactId':'<CONTACT_UUID>','fullName':'Example Resident','phone':'9000000000','email':'person@example.com','whatsAppPhone':'NA','gender':'NA','emergencyPhone':'NA','occupation':'NA','vehicleType':'NA','vehicleRegistrationNumber':'NA','idProofType':'NA','idProofNumber':'NA','societyId':'<SOCIETY_UUID>'}
socUser={'role':'Resident','blockName':'<CONFIGURED_BLOCK>','towerName':'<CONFIGURED_TOWER>','flatTypeId':'<FLAT_TYPE_UUID>','flatType':'<CONFIGURED_FLAT_TYPE>','unitFlatNumber':'101','status':'Active','moveInDate':None,'moveOutDate':None,'ownershipType':'primary','userType':'owner'}
address={'addressLine1':'Example Society','addressLine2':'NA','country':'India','city':'Example City','state':'Example State','postalCode':'000000'}
normalProfile={'contact':contact,'societyUser':socUser,'SocietyAddress':address,'serviceAgent':None,'vendor':None,'profileImageUrl':url,'errorResponse':None}
agentProfile=copy.deepcopy(normalProfile);agentProfile['societyUser']['role']='Service Agent';agentProfile['serviceAgent']={'parkingSlot':None,'agentId':'<CONTACT_UUID>','name':'Example Resident','contactId':'<CONTACT_UUID>','phoneNumber':'9000000000','agentAvailabilityStatus':'NA','agentServices':'NA'}
vendorProfile={'contact':None,'societyUser':None,'SocietyAddress':address,'serviceAgent':None,'vendor':{'vendorId':'<CUSTOM_VENDOR_ID_OR_NON_SOCIETY_USER_UUID>','name':'Example Vendor','phoneNumber':'9000000000','role':'vendor'},'profileImageUrl':url,'errorResponse':None}
profile={'userId':owner,'personalInformation':{'parkingSlot':None,'Name':'Example Resident','gender':'NA','occupation':'NA','idProoftype':'NA','idProofNumber':'NA','vehicleType':'NA','vehicleRegistrationNumber':'NA'},'contactInformation':{'parkingSlot':None,'contactID':'<CONTACT_UUID>','email':'person@example.com','phone':'9000000000','whatsAppPhone':'NA','emergencyPhone':'NA'},'residentialInformation':{'society':'Example Society','flatTypeId':'<FLAT_TYPE_UUID>','flatType':'<CONFIGURED_FLAT_TYPE>','flatNumber':'101','block':'<CONFIGURED_BLOCK>','tower':'<CONFIGURED_TOWER>','city':'Example City','pincode':'000000','state':'Example State','role':'resident','userType':'owner','ownershipType':'primary','status':'Active'},'profileImageUrl':url}
rawResident={'user_id':owner,'unit_flat_number':'101','flat_type_id':'<FLAT_TYPE_UUID>','flatTypeRecord':{'flat_type':'<CONFIGURED_FLAT_TYPE>'},'role':['resident'],'user_type':'owner','user_ownership_type':'primary','status':True,'move_in_date':None,'move_out_date':None,'tower':{'tower_id':'<TOWER_UUID>','name':'<CONFIGURED_TOWER>'},'block':{'block_id':'<BLOCK_UUID>','block_name':'<CONFIGURED_BLOCK>'},'contact':{'parking_slot':None,'contact_id':'<CONTACT_UUID>','name':'Example Resident','description':None,'email':'person@example.com','phone':'9000000000','whatsapp_phone':None,'emergency_phone':None,'gender':None,'occupation':None,'id_proof_type':None,'id_proof_number':None,'vehicle_type':None,'vehicle_registration_number':None},'flatTypeId':'<FLAT_TYPE_UUID>','flatType':'<CONFIGURED_FLAT_TYPE>','profileImageUrl':url}
member={'parkingSlot':None,'societyName':'Example Society','memberId':owner,'role':'resident','agentAvailabilityStatus':'NA','serviceAgentServices':'NA','blockName':'<CONFIGURED_BLOCK>','moveInDate':None,'moveOutDate':None,'gateNumber':None,'securityGuardId':'NA','securityGuardStatus':'NA','securityZone':'NA','serviceAgentRating':'NA','shift':'NA','status':'active','towerName':'<CONFIGURED_TOWER>','flatTypeId':'<FLAT_TYPE_UUID>','flatType':'<CONFIGURED_FLAT_TYPE>','unitFlatNumber':'101','userOwnershipType':'primary','userType':'owner','vendorName':None,'vendorServiceType':None,'fullName':'Example Resident','phone':'9000000000','email':'person@example.com','whatsappPhone':'NA','gender':'NA','emergencyPhone':'NA','occupation':'NA','vehicleType':'NA','vehicleRegistrationNumber':'NA','idProofType':'NA','idProofNumber':'NA','contactId':'<CONTACT_UUID>','registrationNumber':reg,'vendorId':'NA','vendorRating':'NA','recordId':None,'createdAt':'2026-11-16T10:00:00Z','profileImageUrl':url}
vendor={'recordId':non,'vendorId':'<CUSTOM_VENDOR_ID>','name':'Example Vendor','phoneNumber':'9000000000','email':None,'gender':None,'role':'vendor','serviceType':None,'idProofType':None,'idProofNumber':None,'vehicleNumber':None,'vehicleType':None,'vendorRating':None}
requestDocs={
 'get-profile':examples([('Resident/admin/security request (role must match the actual account role)',{'phoneNumber':'9000000000','registrationNumber':reg,'role':'resident','includeProfileImage':True}),('Service-agent request',{'phoneNumber':'9000000000','registrationNumber':reg,'role':'service_agent','includeProfileImage':True}),('Vendor request',{'phoneNumber':'9000000000','registrationNumber':reg,'role':'vendor','includeProfileImage':True})]),
 'get-members':examples([('Fetch paginated members',{'registrationNumber':reg,'role':'all','page':1,'limit':20,'includeProfileImage':True})]),
 'resident-profile-console':examples([('FETCH_ONE',{'actionType':'FETCH_ONE','societyRegistrationNumber':reg,'residentId':owner,'includeProfileImage':True}),('FETCH_ALL',{'actionType':'FETCH_ALL','societyRegistrationNumber':reg,'page':1,'limit':10,'includeProfileImage':True}),('UPDATE (existing operation; image upload uses profile-images)',{'actionType':'UPDATE','societyRegistrationNumber':reg,'residentId':owner,'name':'Example Resident','parkingSlot':'P-101'})]),
 'vendor-management':examples([('FETCH',{'operation':'FETCH','societyRegistrationNumber':reg,'page':1,'limit':10,'includeProfileImage':True}),('CREATE',{'operation':'CREATE','societyRegistrationNumber':reg,'name':'Example Vendor','phoneNumber':'9000000000','role':'vendor'}),('UPDATE',{'operation':'UPDATE','societyRegistrationNumber':reg,'recordId':non,'name':'Updated Vendor'}),('DELETE',{'operation':'DELETE','societyRegistrationNumber':reg,'recordId':non})]),
}
responseDocs={
 'get-profile':examples([('HTTP 200 resident/admin/security profile (role label follows requested actual role)',normalProfile),('HTTP 200 service-agent profile',agentProfile),('HTTP 200 vendor profile',vendorProfile)]),
 'get-members':examples([('HTTP 200',{'success':True,'data':{'total':1,'page':1,'limit':20,'totalPages':1,'members':[member],'filters':{'role':'all','flat':None,'block':None,'tower':None,'status':None},'search':None}})]),
 'resident-profile-console':examples([('FETCH_ONE HTTP 200',{'success':True,'data':{'profiles':[profile],'pagination':{'page':1,'limit':10,'retrievedRecords':1,'returnedProfiles':1}}}),('FETCH_ALL HTTP 200',{'success':True,'data':{'residents':[rawResident],'pagination':{'total':1,'page':1,'limit':10,'totalPages':1}}}),('UPDATE HTTP 200 (existing wrapper)',{'success':True,'data':{'profileUpdate':{'updated':"Profile for identifier '<APPLICATION_USER_UUID>' updated successfully.",'recordId':owner,'contactId':'<CONTACT_UUID>','flatTypeId':'<FLAT_TYPE_UUID>','flatType':'<CONFIGURED_FLAT_TYPE>','parkingSlot':'P-101'}}})]),
 'vendor-management':examples([('FETCH HTTP 200',{'success':True,'data':{'pagination':{'totalCount':1,'currentPage':1,'limit':10,'totalPages':1},'vendors':[{**vendor,'profileImageUrl':url}]}}),('CREATE HTTP 200',{'success':True,'data':{'vendor':{**vendor,'isSuccess':True}}}),('UPDATE HTTP 200',{'success':True,'data':{'vendor':{**vendor,'name':'Updated Vendor','isSuccess':True}}}),('DELETE HTTP 200',{'success':True,'data':{'vendor':{'recordId':non,'isSuccess':True}}})]),
}
newReq=examples([
 ('PREPARE_UPLOAD',{'action':'PREPARE_UPLOAD','ownerType':'society_user','ownerId':owner,'fileName':'avatar.png','fileType':'image/png','fileSize':68}),
 ('CONFIRM_UPLOAD (after successful PUT)',{'action':'CONFIRM_UPLOAD','ownerType':'society_user','ownerId':owner,'fileName':'avatar.png','objectKey':'<EXACT_OBJECT_KEY_FROM_PREPARE_UPLOAD>'}),
 ('FETCH single',{'action':'FETCH','ownerType':'society_user','ownerId':owner}),
 ('FETCH batch',{'action':'FETCH','owners':[{'ownerType':'society_user','ownerId':owner},{'ownerType':'non_society_user','ownerId':non},{'ownerType':'servant','ownerId':'<SERVANT_UUID>'},{'ownerType':'society_staff','ownerId':'<STAFF_UUID>'}]}),
])+'\nBetween PREPARE and CONFIRM: PUT raw binary image bytes to data.upload.uploadUrl using data.upload.method and data.upload.headers. This is a separate Storage request, not JSON or multipart. No profile database reference is saved by PREPARE. No societyRegistrationNumber is required; society and actor come from authenticated identity.'
newRes=examples([
 ('PREPARE_UPLOAD HTTP 200',{'success':True,'data':{'ownerType':'society_user','ownerId':owner,'uploadStatus':'pending_upload','upload':{'bucket':'profile-images','objectKey':'<SOCIETY_UUID>/society_user/<OWNER_UUID>/<RANDOM_UUID>.png','uploadUrl':'https://<PROJECT_REF>.supabase.co/storage/v1/object/upload/sign/profile-images/<OBJECT_KEY>?token=<UPLOAD_TOKEN>','method':'PUT','headers':{'Content-Type':'image/png'}}}}),
 ('CONFIRM_UPLOAD HTTP 200',{'success':True,'data':{'ownerType':'society_user','ownerId':owner,'uploadStatus':'uploaded','profileImageUrl':url,'expiresIn':900,'image':{'bucket':'profile-images','objectKey':'<EXACT_OBJECT_KEY_FROM_PREPARE_UPLOAD>','fileName':'avatar.png','fileType':'image/png','fileSize':68,'updatedAt':'2026-11-16T10:00:00Z'}}}),
 ('FETCH HTTP 200 (single requests use the same array wrapper)',{'success':True,'data':{'images':[{'ownerType':'society_user','ownerId':owner,'profileImageUrl':url},{'ownerType':'non_society_user','ownerId':non,'profileImageUrl':None},{'ownerType':'servant','ownerId':'<SERVANT_UUID>','profileImageUrl':url},{'ownerType':'society_staff','ownerId':'<STAFF_UUID>','profileImageUrl':url}],'expiresIn':900}}),
 ('HTTP 409 missing upload',{'success':False,'error':'ERROR','message':'Upload the image before confirming.'}),
 ('HTTP 403 unauthorized update',{'success':False,'error':'ERROR','message':'You cannot change this profile image.'}),
 ('HTTP 400 unsupported type',{'success':False,'error':'ERROR','message':'fileType must be image/jpeg, image/png, or image/webp.'}),
])
newCols={'A':'API-PROFILE-IMAGES','B':'Authenticated application users; society-scoped, role-authorized uploads','C':'Profiles / images','D':'Prepare, confirm and fetch role-independent profile avatars without using legacy document or capture-photo records.','E':'profile-images','F':'POST','G':'/profile-images','H':'Authorization: Bearer <JWT_TOKEN>; requireAuth verifies JWT. Actor is derived from JWT and resolved against existing identity tables.','I':'New private profile-images bucket; SSP_Profile_Image has one current image per owner_type/owner_id with validated foreign keys to society users, non-society users, servants and society staff. Self may upload own image; same-society admins may manage all; security may manage visitor and servant photos. Fetch is limited to actor society. JPEG/PNG/WebP, maximum 5242880 bytes. Signed display URLs last 900 seconds. Old objects are retained during replacement; current reference changes only after confirmation. No plan restrictions are added.','J':'Authorization: Bearer <JWT_TOKEN>\nContent-Type: application/json','K':newReq,'L':'action always required. PREPARE_UPLOAD: ownerType, ownerId, fileName, fileType. CONFIRM_UPLOAD: ownerType, ownerId, fileName, objectKey. FETCH: either ownerType+ownerId, or owners array with 1–50 entries.','M':'fileSize optional positive integer up to 5242880 (PREPARE). Actual stored size, MIME, image signature and owner-specific path are checked during confirmation. Owner IDs must be canonical UUIDs, not contact IDs, phone numbers or custom vendor IDs.','N':'Local permission, upload/confirm/fetch, corrupt/missing-file, tenant and optional-reader compatibility tests passed. Migration passed local PostgreSQL/PGlite FK, RLS/policy, owner/tenant and legacy-data-preservation checks. No live upload or UI test.','O':'New local endpoint and migration; NOT DEPLOYED. Apply 20261116120000_profile_images.sql before deployment. Deploy the new endpoint and opt-in readers after migration.','P':'''curl --request POST https://isrqhkshygauaehwfycw.supabase.co/functions/v1/profile-images \\
 --header 'Authorization: Bearer <JWT_TOKEN>' \\
 --header 'Content-Type: application/json' \\
 --data-raw '{"action":"PREPARE_UPLOAD","ownerType":"society_user","ownerId":"<APPLICATION_USER_UUID>","fileName":"avatar.png","fileType":"image/png","fileSize":68}' ''','Q':'2026-11-16','R':newRes,'S':'action: PREPARE_UPLOAD, CONFIRM_UPLOAD, FETCH. ownerType: society_user, non_society_user, servant, society_staff. fileType: image/jpeg, image/png, image/webp. uploadStatus: pending_upload, uploaded.','T':'supabase/functions/profile-images/index.ts SHA-256: '+sha('supabase/functions/profile-images/index.ts')+'\nHelper SHA-256: '+sha('supabase/functions/_shared/profile-images.ts')+'\nMigration: supabase/migrations/20261116120000_profile_images.sql\nReadme: supabase/functions/profile-images/README.md\nEvidence: artifacts/profile-images/database-test.json and profile image/reader/legacy compatibility tests. No production schema or deployment change.'}
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',NS):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row};ep=cells.get('G' if i==1 else 'E')
  if ep not in ['get-profile','get-dashboard','resident-profile-console','get-members','vendor-management']:continue
  req,res,desc,optional,date,src=('M','T','K','O','S','U') if i==1 else ('K','R','I','M','Q','T')
  if ep=='get-dashboard':
   samples=blocks(cells[res]);success=next(copy.deepcopy(s) for s in samples if s.get('success') is True and 'user' in s.get('data',{}));success['data']['user']['profileImageUrl']=url
   requests=prefix+'GET /get-dashboard?includeProfileImage=true\nNo JSON request body. Authorization: Bearer <JWT_TOKEN>. Omit the query parameter to preserve the original response.'
   responses=examples([('HTTP 200 with includeProfileImage=true',success)])
  else:requests=requestDocs[ep];responses=responseDocs[ep]
  requests+='\nProfile images are opt-in. Omit includeProfileImage (or send false) for the unchanged legacy request/response behavior. Role, flat type, service type and other society-specific choices must use actual account/configuration values.'
  responses+='\nprofileImageUrl appears only when explicitly requested. It is null when no confirmed avatar exists, the file is missing, permission fails or optional image retrieval is unavailable. Signed display URLs expire after 900 seconds. Other existing fields, status/filter behavior, wrappers and legacy imageUrl fields are unchanged. These examples are source-derived local examples, not live API responses.'
  updates={req:requests,res:responses,desc:cells[desc]+' Optional profile image enrichment via includeProfileImage=true; default behavior is unchanged. New profile metadata is separate from SSP_Document, captured visitor images and servant_image attachments.',optional:cells.get(optional,'')+'\nincludeProfileImage: optional boolean (default false); on get-dashboard use GET query string includeProfileImage=true.',date:'2026-11-16',src:'supabase/functions/'+ep+'/index.ts\nSource SHA-256: '+sha('supabase/functions/'+ep+'/index.ts')+'\nShared profile image helper SHA-256: '+sha('supabase/functions/_shared/profile-images.ts')+'\nNew opt-in image changes are local, NOT DEPLOYED. Default profile/member payload compatibility and local image permission/database tests passed. Existing deployed visitor-plan changes are preserved.'}
  if i==1:updates['Q']='Existing endpoint remains live; optional profile image source change NOT DEPLOYED. Local tests passed; no live profile image request.'
  else:updates['N']='Local profile image upload/reader/legacy compatibility and PostgreSQL migration tests passed; no live image or Flutter UI test.';updates['O']=cells['O']+'; profile-image opt-in change local only, NOT DEPLOYED.'
  # Keep cURL examples consistent with the documented opt-in requests.
  data=blocks(requests)
  if ep=='get-dashboard':curl="curl --request GET 'https://isrqhkshygauaehwfycw.supabase.co/functions/v1/get-dashboard?includeProfileImage=true' --header 'Authorization: Bearer <JWT_TOKEN>'"
  else:curl="curl --request POST https://isrqhkshygauaehwfycw.supabase.co/functions/v1/"+ep+" --header 'Authorization: Bearer <JWT_TOKEN>' --header 'Content-Type: application/json' --data-raw '"+json.dumps(data[0],separators=(',',':'))+"'"
  updates['R' if i==1 else 'P']=curl
  for col,s in updates.items():
   assert len(s)<=32767,(ep,col,len(s))
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);replacement=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+replacement+text[m.end():];touched.add((i,ref))
  for doc in [requests,responses]:
   for obj in blocks(doc):json.loads(json.dumps(obj))
  matches.append((i,row.get('r'),ep))
 if i==2:
  target=next(row for row in root.findall('.//m:sheetData/m:row',NS) if row.get('r')=='62');assert all(not val(c) for c in target if re.sub(r'\d','',c.get('r')) in newCols)
  E.register_namespace('',NS['m']);bycol={re.sub(r'\d','',c.get('r')):c for c in target}
  for col,s in newCols.items():
   assert len(s)<=32767
   c=bycol.get(col)
   if c is None:c=E.SubElement(target,'{'+NS['m']+'}c',{'r':col+'62'})
   for child in list(c):c.remove(child)
   c.set('t','inlineStr');t=E.SubElement(E.SubElement(c,'{'+NS['m']+'}is'),'{'+NS['m']+'}t');t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');t.text=s;touched.add((i,col+'62'))
  def number(c):
   out=0
   for ch in re.sub(r'\d','',c.get('r')):out=out*26+ord(ch)-64
   return out
  target[:]=sorted(target,key=number)
  m=re.search(r'<row\b[^>]*\br="62"[^>]*>.*?</row>',text,re.S);assert m
  text=text[:m.start()]+E.tostring(target,encoding='unicode')+text[m.end():];matches.append((2,'62','profile-images'))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==6,matches
for doc in [newReq,newRes]:
 assert blocks(doc)
 for obj in blocks(doc):json.loads(json.dumps(obj))
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):val(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',NS)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',NS):
  assert len(val(c))<=32767
  if (i,c.get('r')) not in touched:assert val(c)==before.get(c.get('r'),'')
tmp=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(tmp,'w') as z:
 for entry in entries:z.writestr(entry,changed.get(entry.filename,original[entry.filename]))
with zipfile.ZipFile(tmp) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
tmp.replace(P)
print('Updated canonical workbook:',matches,'; complete JSONC request/response examples, cell limits, unrelated cells/worksheets and ZIP/XML integrity verified.')
