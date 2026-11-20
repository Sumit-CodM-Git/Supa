"""Expand first-three-sheet request/response cells into complete annotated examples."""
from pathlib import Path
import copy,json,re,zipfile,xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[2];A=ROOT/'artifacts/api-workbook-audit'
ctx={'__file__':str(A/'update_workbook.py')}
exec((A/'update_workbook.py').read_text().split('updated_rows=[];represented=set();aliases=[]')[0],ctx)
facts=ctx['contracts'];material=json.loads((A/'materialized-responses.json').read_text());picklists=json.loads((A/'active-picklists.json').read_text())
UUID='00000000-0000-4000-8000-000000000001';STAMP='2026-11-11T10:00:00+05:30'
INPUT=ROOT/'Society Sync Pro 2.0 - APIs - Updated.xlsx';OUTPUT=ROOT/'Society Sync Pro 2.0 - APIs - Full Examples.xlsx'
pick={}
for p in picklists:pick.setdefault((p['table_name'],p['field_name']),[]).append(p['value'])

def norm(k):return re.sub('[^a-z0-9]','',k.lower())
def primary_table(api):
 if 'notice' in api:return 'SSP_Alert'
 if 'complaint' in api:return 'SSP_Complaint'
 if 'marketplace' in api or 'wishlist' in api:return 'SSP_Market_Place'
 if 'servant' in api:return 'SSP_Servant'
 if api=='crud-society-staff':return 'SSP_Society_Staff'
 if 'visitor' in api or api in ['security-gate-console','security-guard-image','update-approval-status']:return 'SSP_Non_Society_User'
 if 'facility' in api or 'facilities' in api:return 'SSP_Facility'
 if 'payment' in api or 'receipt' in api:return 'SSP_Payment'
 return 'SSP_Society_User'

def allowed(api,path,t=None,response=False):
 leaf=path.split('.')[-1].replace('[]','');key=norm(leaf);c=facts[api];en=c['enums'];vals=[]
 if key=='active' and 'filters.' in path:return [True,False,'all','active','inactive']
 if key in ['error','errorcode']:
  codes=re.findall(r'["\']((?:INVALID|MISSING|NOT_FOUND|UNAUTHORIZED|FORBIDDEN|DATABASE|SERVER|BAD_REQUEST|ALREADY|IN_USE|STORAGE)[A-Z_]*)["\']',(A/'source'/f'{api}.ts').read_text())
  return list(dict.fromkeys(codes))

 if isinstance(t,dict) and 'union' in t:
  vals=[json.loads(x) for x in t['union'] if isinstance(x,str) and x.startswith('"')]
  if not vals and 'boolean' in t['union']:vals=[True,False]
 if t=='boolean':vals=[True,False]
 if vals:return list(dict.fromkeys(vals))
 constants={'gender':['GENDER_VALUES','VALID_GENDER'],'idprooftype':['ID_PROOF_TYPE_VALUES','VALID_ID_PROOF'],'vehicletype':['VEHICLE_TYPE_VALUES'],'userownershiptype':['OWNERSHIP_TYPE_VALUES','ALLOWED_OWNERSHIP_TYPES','VALID_OWNERSHIP'],'ownershiptype':['OWNERSHIP_TYPE_VALUES','ALLOWED_OWNERSHIP_TYPES','VALID_OWNERSHIP'],'usertype':['USER_TYPE_VALUES','ALLOWED_USER_TYPES'],'priority':['VALID_PRIORITIES'],'shifttiming':['VALID_SHIFT_TIMING'],'deviceType':['VALID_DEVICE_TYPES'],'scope':['VALID_SCOPES'],'imageType':['validTypes'],'status':['VALID_STATUS']}
 for const in constants.get(key,[]):
  if en.get(const):return en[const]
 if key in ['action','actiontype','operation']:
  shape=ctx['get_schema'](api)
  for field,act in ctx['action_values'](api,shape):
   if norm(field)==key:vals.append(act)
  if vals:return list(dict.fromkeys(vals))
 if key in ['stage']:return ['START','END']
 if key=='billingperiod':return ['MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','THREE_YEAR']
 if key=='responseformat':return ['file','url']
 if key=='phase':return ['request','confirm']
 if key=='membertype':return ['admin','resident','security','service_agent','vendor']
 if key=='stafftype':return ['service_agent','vendor']
 if key in ['dir','order','sortdir','sortorder']:return ['asc','desc']
 if key in ['field','by'] and 'sort' in path:
  if en.get('VALID_SORT_FIELDS'):return en['VALID_SORT_FIELDS']
 if key=='active':return [True,False,'all','active','inactive'] if 'filters.' in path else [True,False]
 if key in ['role','roles']:
  if api=='crud-family':return ['resident']
  if en.get('VALID_ROLES'):return en['VALID_ROLES']
  if en.get('VALID_SERVANT_ROLES'):return en['VALID_SERVANT_ROLES']
  if api=='update-member':return en.get('ALLOWED_ROLES',[])
  if api in ['get-members']:return ['all','admin','resident','security','service_agent','vendor','visitor','nonresident']
  if api=='crud-society-staff':return pick.get(('SSP_Society_Staff','staff_role'),[])
  if primary_table(api)=='SSP_Servant':return pick.get(('SSP_Servant','role'),[])
 if key=='status' and response and path.count('.')==0:return ['SUCCESS','FAILURE']
 if key in ['otpverified','updated','success','isrecurring','preapproved','ismaintenance','onmaintenance','ischargeable','testmode','hasmore','hasnextpage','hasprevpage','isprimary','isallDay'.lower(),'isuploaded','blobexists','isrequired','isvisible']:return [True,False]
 if key=='receiptUploadStatus'.lower():return ['uploaded','missing','not_provided','unverified']
 if key=='recordtype':return ['booking','request']
 if key=='hiredstatus':return ['all','hired','available']
 if key=='filteroption' or key=='dateoption':return ['all','today','yesterday','thisweek','lastweek','thismonth','lastmonth','custom']
 if key=='imageType'.lower():return ['BEFORE','AFTER']
 if key=='nextstep':return ['VERIFY_OTP','COMPLETED'] if api=='visitor-otp' else ['VERIFY_START','END_OTP','VERIFY_END','COMPLETED'] if 'complaint' in api else []
 if key=='source' and api=='generate-payment-receipt':return ['stored','generated']
 if key=='userType'.lower() and api=='save-fcm-token':return ['society_user','staff','vendor']
 if key=='deviceType'.lower():return ['ios','android','web']
 if key in ['visitorstatus','newstatus','previousstatus'] and primary_table(api)=='SSP_Non_Society_User':return pick.get(('SSP_Non_Society_User','visitor_status'),[])
 if key=='newstatus' and primary_table(api)=='SSP_Complaint':return pick.get(('SSP_Complaint','status'),[])
 if key=='approvalstatus':return ['Pending','Approved','Rejected'] if 'facility' in api else ['pending','approved','rejected']
 if key=='bookingstatus':return pick.get(('SSP_Facility_Booking','booking_status'),[])
 if key=='status' and primary_table(api)=='SSP_Payment':return ['Paid','Unpaid','Pending','Rejected','UNDER REVIEW']
 mapping={'gender':('SSP_Contact','gender'),'idprooftype':('SSP_Contact','id_proof_type'),'vehicletype':('SSP_Contact','vehicle_type'),'usertype':('SSP_Society_User','user_type'),'userownershiptype':('SSP_Society_User','user_ownership_type'),'ownershiptype':('SSP_Society_User','user_ownership_type'),'relationship':('SSP_Society_User','relationship'),'shift':('SSP_Society_User','shift'),'securityzone':('SSP_Society_User','security_zone'),'securityguardstatus':('SSP_Society_User','security_guard_status'),'agentavailabilitystatus':('SSP_Society_User','agent_availability_status'),'availabilitystatus':('SSP_Society_Staff','availability_status'),'emergencycategory':('SSP_Society_Staff','emergency_category'),'subscriptionplan':('SSP_Society','subscription_plan'),'bookingmode':('SSP_Facility','booking_mode'),'facilitytype':('SSP_Facility','facility_type'),'closeddays':('SSP_Facility','closed_days'),'category':('SSP_Market_Place','category'),'pricetype':('SSP_Market_Place','price_type'),'paymenttype':('SSP_Payment','payment_type'),'paymentstatus':('SSP_Payment','payment_status'),'paymentmethod':('SSP_Payment','payment_method'),'complainttype':('SSP_Complaint','complaint_type'),'servicetype':('SSP_Non_Society_User','service_type'),'serviceagentservices':('SSP_Non_Society_User','service_type'),'purpose':('SSP_Non_Society_User','purpose'),'documenttype':('SSP_Document','document_type'),'filetype':('SSP_Document','file_type')}
 if key=='type':mapping[key]=(primary_table(api),{'SSP_Alert':'type','SSP_Complaint':'complaint_type','SSP_Facility':'facility_type'}.get(primary_table(api),'type'))
 if key=='priority':mapping[key]=(primary_table(api),'priority')
 if key=='status':mapping[key]=(primary_table(api),'status')
 if key in mapping:return pick.get(mapping[key],[])
 return []

def valtext(v):return str(v).lower() if isinstance(v,bool) else str(v)
def comment(api,path,t=None,value=None,response=False):
 opts=[True,False] if isinstance(value,bool) else allowed(api,path,t,response);notes=[]
 if len(opts)>1:notes.append(('Allowed per array item: ' if isinstance(value,list) else 'Allowed: ')+', '.join(map(valtext,opts)))
 key=path.split('.')[-1]
 if key in ['flatTypeId','flatType']:notes.append('Use an active type from this society’s societyConfiguration.flatTypes; not a global fixed enum')
 if key in ['objectKey','documentId'] and not response:notes.append('Use the value returned by the upload request phase when confirming')
 if isinstance(t,dict) and 'union' in t:
  if 'null' in t['union']:notes.append('null clears the value on update; omit to preserve')
  if any(isinstance(x,list) for x in t['union']) and 'string' in t['union']:notes.append('Accepts one string or a JSON array of values')
 return '; '.join(notes)

def scalar(api,k,t=None,response=False):
 opts=allowed(api,k,t,response)
 if opts and not isinstance(opts[0],dict):return opts[0]
 leaf=k.split('.')[-1].replace('[]','');key=norm(leaf)
 if key.endswith('id') or key in ['society','tower','block','contact','staffid','recordid','requestedby','uploadedby']:return UUID
 if key in ['societyregistrationnumber','registrationnumber']:return 'EXAMPLE-REG-001'
 if key in ['flatnumber','unitflatnumber','unitnumber','flat','toflatnumber']:return '101'
 if key=='flattype':return '2 BHK'
 if key=='flattypeid':return UUID
 if 'phone' in key:return '9000000000'
 if 'email' in key:return 'person@example.com'
 if key=='idproofnumber':return 'ABCDE1234F'
 if key=='idprooftype' and api in ['add-members','update-member']:return 'PAN Card'
 if key=='otp':return '123456'
 if key=='filebase64':return '<BASE64_ENCODED_IMAGE_BYTES>'
 if 'filename' in key:return 'example.jpg'
 if 'filesize' in key:return 102400
 if key in ['dateofbirth']:return '1990-01-01'
 if key in ['openingtime','scheduledarrival','starttime']:return '09:00:00'
 if key in ['closingtime','scheduleddeparture','endtime']:return '18:00:00'
 if 'url' in key:return 'https://example.com/example-file'
 if key=='objectkey' or key=='filepath':return 'example-society/documents/example.jpg'
 if 'parking' in key and 'slot' in key and key not in ['totalparkingslot']:return 'P-101'
 if key in ['page','currentpage','total','totalpages','totalcount','totalrecords','retrievedrecords','returnedprofiles','clearedassignments','count']:return 1
 if key in ['limit','pagesize']:return 20
 if re.search(r'^(total|count)|flats|occupied|vacant|owners|tenants|wheelers|^(pending|confirmed|resolved|upcoming)$|amount|charges|price|balance|deposit|fee|parkingcount|totalparking|coveredparking|openparking|floors|flatsperfloor|capacity|count|units|validitymonths|sortorder|attempts|duration|remaining|days|percentage',key):return 4 if 'rating' in key else 1500 if re.search('amount|charge|price|fee',key) else 1
 if key in ['active','success','updated','verified','testmode','reasonrequired','onmaintenance','hasmore','hasnextpage','hasprevpage'] or re.match(r'^(is|has|can|requires)[A-Z]',leaf):return False if key in ['onmaintenance','hasmore','hasnextpage','hasprevpage'] else True
 if key in ['deletedat','rejectionreason']:return None
 if key.endswith('ms'):return 25
 if key.endswith('at') or 'date' in key or key in ['timestamp','bookingstart','bookingend']:return STAMP
 if 'token' in key:return '<EXAMPLE_TOKEN>'
 if key in ['keyid']:return 'rzp_test_EXAMPLE'
 if key in ['currency']:return 'INR'
 if key in ['plancode','newplancode']:return 'PREMIUM'
 if key in ['planname']:return 'Premium'
 if 'message' in key:return 'Operation completed successfully.'
 if 'name' in key or key=='title':return 'Example '+leaf
 if key in ['description','note','reason','purposeofvisit']:return 'Example details'
 if t in ['number','number | string']:return 1
 if t=='boolean':return True
 return 'Example text'

def schema_sample(api,shape,path='',depth=0):
 if depth>12:return scalar(api,path)
 if isinstance(shape,str):
  c=facts[api]
  if shape in c['interfaces']:return schema_sample(api,ctx['resolve_type'](c['interfaces'][shape],c),path,depth+1)
  if shape in c['types']:return schema_sample(api,ctx['resolve_type'](c['types'][shape],c),path,depth+1)
  if shape.startswith('Array<') or shape.endswith('[]'):return [scalar(api,path)]
  if shape=='object' or shape.startswith('Record<'):return {}
  if shape.startswith('"'):
   try:return json.loads(shape)
   except ValueError:pass
  return scalar(api,path,shape)
 if isinstance(shape,list):return [schema_sample(api,shape[0],path+'[]',depth+1)] if shape else []
 if isinstance(shape,dict):
  if 'union' in shape:
   arr=next((t for t in shape['union'] if isinstance(t,list)),None)
   choice=arr or next((t for t in shape['union'] if t not in ['null','undefined']),None)
   return schema_sample(api,choice,path,depth+1)
  return {k.rstrip('?'):schema_sample(api,t,path+'.'+k.rstrip('?') if path else k.rstrip('?'),depth+1) for k,t in shape.items()}
 return scalar(api,path)

def deepmerge(a,b):
 out=copy.deepcopy(a)
 for k,v in b.items():out[k]=deepmerge(out[k],v) if isinstance(out.get(k),dict) and isinstance(v,dict) else copy.deepcopy(v)
 return out

def jsonc(api,obj,schema=None,path='',indent=0,response=False):
 schema=schema or {};space=' '*indent
 if isinstance(obj,dict):
  lines=['{']
  for index,(k,v) in enumerate(obj.items()):
   p=path+'.'+k if path else k;t=schema.get(k,schema.get(k+'?')) if isinstance(schema,dict) else None
   if isinstance(t,dict) and 'union' in t:
    childschema=next((x for x in t['union'] if isinstance(x,dict) and 'union' not in x),{})
   else:childschema=t
   rendered=jsonc(api,v,childschema,p,indent+2,response);line=' '*(indent+2)+json.dumps(k)+': '+rendered
   if index<len(obj)-1:line+=','
   note=comment(api,p,t,v,response)
   if note:line+=' // '+note
   lines.append(line)
  return '\n'.join(lines+[' '*indent+'}'])
 if isinstance(obj,list):
  if not obj:return '[]'
  childschema=schema[0] if isinstance(schema,list) and schema else {}
  if all(not isinstance(x,(dict,list)) for x in obj):return json.dumps(obj,ensure_ascii=False)
  return '[\n'+',\n'.join(' '*(indent+2)+jsonc(api,x,childschema,path+'[]',indent+2,response) for x in obj)+'\n'+' '*indent+']'
 return json.dumps(obj,ensure_ascii=False)

# Action-specific field applicability keeps full examples meaningful rather than
# combining CREATE, search and DELETE parameters into an invalid request.
context_fields={'societyRegistrationNumber','registrationNumber','adminId','adminPhone','residentId','requesterId'}
view_fields={'filters','sort','pagination','search','searchText','searchQuery','searchTerm','page','limit','status','role','preApproved','includeDeleted','filterOption','fromDate','toDate','startDate','endDate','scope','language','facilityName','facilityType','bookingDate','flatNumber','flat','block','tower','paymentStatus','paymentType','category','priceType','sortBy','sortDir','sortOrder','dateFrom','dateTo','showExpired','filterRole','filterStatus','filterUserType','filterUserOwnershipType','filterTower','filterBlock','approvalStatus','visitorStatus','hostedBy','isRecurring'}

def full_requests(api):
 shape=ctx['get_schema'](api);full=schema_sample(api,shape);minimal=ctx['examples'](api,shape);result=[]
 for label,sample in minimal:
  label=str(label);control=next((k for k in ['actionType','action','operation'] if k in sample),None);act=sample.get(control,'') if control else ''
  if act and act in ['VIEW','FETCH','FETCH_ALL','FETCH_ONE','FETCH_OWN','BROWSE','FETCH_WISHLIST','LOGS','LIST','FETCH_PRE_APPROVALS','FETCH_INSIDE_LOGS']:
   body={k:v for k,v in full.items() if k in context_fields|view_fields or k==control}
  elif act in ['DELETE','RESTORE','CHANGE_PRIMARY','LAYOFF','CANCEL']:
   body={k:v for k,v in full.items() if k in context_fields or k==control or k.endswith('Id') or k in ['reason','id']}
  elif act in ['CREATE','UPDATE']:
   body={k:v for k,v in full.items() if k not in (view_fields-{'status','role','isRecurring'}) and k not in ['includeDeleted']}
  else:body=copy.deepcopy(full)
  # Only one routing field is sent per request.
  for key in ['action','actionType','operation']:
   if key!=control and key not in sample:body.pop(key,None)
  body=deepmerge(body,sample)
  if api in ['crud-block','crud-tower','crud-flat-type','crud-society','crud-society-staff','crud-facility']:
   if act in ['VIEW','DELETE']:body.pop('payload',None)
   if act=='CREATE':
    for k in ['blockId','towerId','flatTypeId','staffId','id']:body.pop(k,None)
  if api=='crud-family':
   if act=='CREATE':
    body.pop('targetResidentId',None);body['ownershipType']='secondary';body['role']=['resident'];body['relationship']='spouse'
   if act in ['DELETE','RESTORE','CHANGE_PRIMARY']:body={**{k:v for k,v in sample.items()},'action':act}
  if api=='generate-payment-receipt':
   body=deepmerge(schema_sample(api,facts[api]['interfaces']['ListRequest']),sample) if label=='LIST' else {**sample}
  if api in ['crud-document','crud-resident-document']:
   if act in ['DOWNLOAD','DELETE']:body={k:v for k,v in body.items() if k in context_fields or k in ['action','documentId']}
   if body.get('phase')=='confirm':body={**{k:v for k,v in body.items() if k in context_fields},**sample}
   elif act=='UPLOAD':body['payload'].pop('objectKey',None);body.pop('documentId',None)
  result.append((label,body))
 if api=='add-members':
  for role in ['resident','admin','security','service_agent','vendor']:
   b=copy.deepcopy(full);b['memberType']=role;m=b['memberData'][0]
   for k in ['fullName','phone','idProofType','idProofNumber']:m[k]={'fullName':'Example Person','phone':'9000000000','idProofType':'PAN Card','idProofNumber':'ABCDE1234F'}[k]
   m['status']='active';m['parkingSlot']='P-101';m['relationship']='spouse';m['flatTypeId']=UUID;m['flatType']='2 BHK'
   m['userOwnershipType']='secondary' if role=='resident' else 'primary';m['userType']='owner'
   if role!='vendor':
    for k in ['vendorName','vendorServiceType','vendorRating']:m.pop(k,None)
   else:
    keep={'fullName','phone','idProofType','idProofNumber','vendorName','vendorServiceType','vendorRating','email','gender','vehicleType','vehicleRegistrationNumber'};m={k:v for k,v in m.items() if k in keep};b['memberData']=[m]
   result.append((role.upper(),b))
  result=[x for x in result if x[0]!='REQUEST']
 if api=='update-member':
  b=copy.deepcopy(full);b['updatedData'].update({'flatTypeId':UUID,'flatType':'2 BHK','parkingSlot':'P-101','role':['resident'],'userType':'owner','userOwnershipType':'secondary','status':True});result=[('SOCIETY MEMBER',b),('VENDOR',{'memberId':UUID,'updatedData':{'vendorName':'Example Vendor','vendorServiceType':'plumbing','vendorRating':4,'phoneNumber':'9000000000','email':'vendor@example.com','gender':'male','idProofType':'pan','idProofNumber':'ABCDE1234F','vehicleNumber':'DL01AB1234','vehicleType':'four_wheeler'}})]
 if api=='complaint-otp':result=[(stage+mode,{'complaintId':UUID,'stage':stage,**({'otp':'123456'} if mode==' VERIFY' else {})}) for stage in ['START','END'] for mode in [' GENERATE',' VERIFY']]
 if api=='visitor-otp':result=[('GENERATE',{'phoneNumber':'9000000000','societyUserId':UUID,'visitorName':'Example Visitor','name':'Example Visitor'}),('VERIFY',{'phoneNumber':'9000000000','societyUserId':UUID,'visitorId':UUID,'visitorName':'Example Visitor','name':'Example Visitor','otp':'123456'})]
 if api in ['staff-complaint-images','staff-complaint-workflow']:
  expanded=[]
  for label,body in result:
   if body.get('operation')=='UPLOAD' or body.get('action')=='UPLOAD_IMAGE':
    for uploaded in [False,True]:
     b=copy.deepcopy(body);b['isUploaded']=uploaded
     if not uploaded:
      for f in b.get('files',[]):f.pop('objectKey',None)
     expanded.append((label+(' CONFIRM' if uploaded else ' REQUEST'),b))
   else:expanded.append((label,body))
  result=expanded
 if api=='visitor-pass-operations':
  expanded=[]
  for label,body in result:
   if body.get('operation')=='UPLOAD':
    base64body=copy.deepcopy(body);base64body['fileBase64']='<BASE64_ENCODED_IMAGE_BYTES>';expanded.append(('UPLOAD BASE64',base64body));body.pop('fileBase64',None);body.pop('objectKey',None);expanded.append(('UPLOAD REQUEST (signed URL)',body))
   else:expanded.append((label,body))
  result=expanded
 if api=='delete-members':result=[('SOCIETY MEMBER',{'memberId':UUID,'memberType':'society'}),('VENDOR',{'memberId':UUID,'memberType':'vendor'})]
 if api=='get-societies':return [('GET /get-societies?page=1&limit=20&society_name=Example&registration_number=EXAMPLE&subscription_plan=premium',None),('GET /get-societies/me?page=1&limit=20',None),('GET /get-societies/'+UUID,None)]
 if api=='get-dashboard':return [('GET /get-dashboard',None)]
 if api=='get-subscription-info':return [('GET /get-subscription-info?action='+a+('&page=1&limit=20' if a=='history' else ''),None) for a in ['plans','myPlan','history']]
 if api=='cleanup-fcm-tokens':return [('POST /cleanup-fcm-tokens; no body. Headers: Authorization: Bearer <JWT>, x-cron-secret: <CRON_SECRET> when configured',None)]
 if api=='get-profile':result=[(role.upper(),{'phoneNumber':'9000000000','registrationNumber':'EXAMPLE-REG-001','role':role}) for role in ['resident','admin','security','service_agent','vendor']]
 return result

def shape_for(api,keys=(),owner=None):
 candidates=[x for x in material[api]['shapes'] if isinstance(x['value'],dict) and set(keys)<=set(x['value']) and (owner is None or x['owner']==owner)]
 if not candidates:return None
 # Prefer DTOs returned to clients over database insertion payloads.
 candidates.sort(key=lambda x:(x['kind'] in ['return','callback','push'],not bool(re.search(r'Payload|Headers|logger|statusMap',x['owner'])),len(x['value'])),reverse=True)
 return copy.deepcopy(candidates[0]['value'])

def interface_example(api,name):return schema_sample(api,ctx['resolve_type'](facts[api]['interfaces'][name],facts[api]))

def shared_booking():
 return {'facilityName':'Community Hall','bookingStatus':'approved','startDateTime':STAMP,'endDateTime':'2026-11-11T11:00:00+05:30','paymentStatus':'Paid','paymentMethod':'upi','capacity':1,'purpose':'Guest event','facilityBookingId':UUID,'payRecId':UUID,'recordType':'booking','requestId':UUID,'createdAt':STAMP}

def parse_select(api,text):
 # Parse PostgREST's named-column selections, including relationship aliases.
 parts=[];start=0;level=0
 for i,ch in enumerate(text):
  if ch=='(':level+=1
  if ch==')':level-=1
  if ch==',' and not level:parts.append(text[start:i].strip());start=i+1
 parts.append(text[start:].strip());row={}
 for part in parts:
  if not part or part=='*':continue
  head=part.split('(')[0].split('!')[0].strip();key=head.split(':')[0]
  row[key]=parse_select(api,part[part.index('(')+1:part.rindex(')')]) if '(' in part else scalar(api,key,response=True)
 return row

def raw_resident(api):
 code=(A/'source'/f'{api}.ts').read_text();matches=re.findall(r'\.from\("SSP_Society_User"\)\s*\.select\(\s*`(.*?)`',code,re.S)
 select=next((s for s in matches if 'unit_flat_number' in s and 'contact:SSP_Contact' in s),None)
 return parse_select(api,select) if select else {'user_id':UUID,'unit_flat_number':'101','flat_type_id':UUID,'flatTypeRecord':{'flat_type':'2 BHK'},'role':['resident'],'user_type':'owner','user_ownership_type':'secondary','status':True,'contact':{'contact_id':UUID,'name':'Example Resident','phone':'9000000000','parking_slot':'P-101'}}

def item_for(api,key):
 k=norm(key);sh=None
 rules={
 'marketplaces':('marketPlaceId','title'),'members':('memberId','fullName'),'membercreated':('memberId','fullName'),'familymembers':('residentId','relationship'),
 'profiles':('personalInformation','residentialInformation'),'visitors':('visitorId','name'),'recentvisitors':('visitorId','name'),'preapprovedvisitors':('visitorId','name'),'visitor':('visitorId','name'),
 'servants':('servantId','name'),'notices':('noticeId','title'),'complaints':('complaintId','title'),
 'payments':('amount','paymentStatus'),'documents':('documentId','fileName'),'images':('documentId','fileName'),
 'facilities':('name','bookingMode'),'availablefacilities':('facilityName','basePrice'),'facilitiesschedules':('facilityId','slots'),
 'receipts':('payRecId','fileName'),'wishlist':('wishlistId','item'),'uploads':('uploadUrl','fileName'),'uploadurls':('uploadUrl','fileName'),
 'towers':('towerId','floors'),'blocks':('blockId','blockName'),'flattypes':('flatTypeId','maintenanceCharges'),'staff':('staffId','name'),
 'bookings':('recordType','requestId'),'mybookings':('recordType','requestId'),'contacts':('contact_id','name'),
 'residents':('societyUserId','flatNumber'),'slots':('startTime','endTime')}
 if k=='residents' and api in ['resident-profile-console','update-residents-profile']:return raw_resident(api)
 if k in ['mybookings','facilities'] and api=='get-my-facility-bookings':return shared_booking()
 if k=='mybookings' and api=='facility-console':return shared_booking()
 if k=='profiles':sh=shape_for(api,rules[k])
 elif k in rules:sh=shape_for(api,rules[k])
 if sh:return sh
 if k=='familymembers':return shape_for('crud-family',('residentId','relationship'))
 if k in ['visitors','recentvisitors','preapprovedvisitors','visitor']:
  return shape_for('visitor-pass-operations',('visitorId','approvalStatus'))
 if k=='servants':return shape_for('crud-servant',('servantId','name'),owner='base')
 if k=='documents':return shape_for('crud-document',('documentId','fileName'))
 if k in ['images','uploads','uploadurls']:
  return {'fileName':'example.jpg','uploadUrl':'https://example.com/signed-upload','objectKey':'example-society/images/example.jpg'} if k!='images' else {'documentId':UUID,'fileName':'example.jpg','fileType':'image/jpeg','url':'https://example.com/example.jpg','fileSize':102400}
 if k in ['bookings','mybookings']:return shape_for('get-facility-bookings',('recordType','requestId')) or shared_booking()
 if k in ['facilities','availablefacilities']:return shape_for('get-facilities-details',('name','bookingMode'))
 if k=='facilitiesschedules':return shape_for('get-facility-schedule',('facilityId','slots'))
 if k=='payments':return shape_for('admin-payments-console',('amount','paymentStatus'))
 if k=='notices':return shape_for('crud-notice',('noticeId','title'))
 if k=='complaints':return shape_for('get-complaints',('complaintId','title'))
 if k=='contacts':return {'contact_id':UUID,'name':'Example Contact','phone':'9000000000','email':'person@example.com','society':UUID,'gender':'male','parking_slot':'P-101'}
 if k=='slots':return {'startTime':'10:00','endTime':'11:00','status':'Available','onMaintenance':False}
 return None

array_keys={'members','memberCreated','familyMembers','profiles','visitors','Visitors','recentVisitors','preApprovedVisitors','servants','notices','complaints','payments','documents','facilities','availableFacilities','facilitiesSchedules','myBookings','bookings','contacts','receipts','wishlist','images','uploads','uploadUrls','residents','towers','blocks','flatTypes','staff','slots','marketPlaces'}
scalar_array_keys={'imageUrls','removedDocumentIds','documentIds','targetAudience','roles','recurringDays','shiftTiming','currentAmenities','scope','closedDays','allRoles','hiredRoles','shiftTimings'}

def polish(api,obj,path='',seen=None):
 seen=set() if seen is None else seen
 if len(path)>500:return obj
 if isinstance(obj,dict):
  result={}
  for k,v in obj.items():
   p=path+'.'+k if path else k
   if k in array_keys and v is not None and (not isinstance(v,(list,dict)) or isinstance(v,list) and (not v or isinstance(v[0],dict) and set(v[0])<= {'id','name','flatTypeId','flatType'})):
    item=item_for(api,k)
    if item and (api,k) not in seen:v=[polish(api,item,p+'[]',seen|{(api,k)})]
   elif isinstance(v,list) and len(v)==1 and isinstance(v[0],list):v=v[0]
   if k in scalar_array_keys and v is not None and (not isinstance(v,list) or any(isinstance(x,(dict,list)) for x in v)):
    opts=allowed(api,p,response=True);v=['https://example.com/example.jpg'] if k=='imageUrls' else ['cook'] if k in ['allRoles','hiredRoles'] else [opts[0] if opts else 'both' if k=='targetAudience' else 'Monday' if k=='recurringDays' else 'morning' if k in ['shiftTiming','shiftTimings'] else 'example']
   if k=='role' and api=='crud-family':v=['resident']
   if k in ['role','roles'] and 'servant' in api:v=['cook']
   if k=='hireStatus' and 'servant' in api and not isinstance(v,dict):v=schema_sample(api,facts[api]['interfaces'].get('HireStatus',{}))
   if k=='roleStatus' and 'servant' in api:v=[schema_sample(api,facts[api]['interfaces'].get('RoleStatus',{}))]
   if k in ['imageUrls']:v=['https://example.com/example.jpg']
   if k=='priceType':v='fixed'
   if k=='idProofType' and v in ['Example value','Example text']:v='pan'
   if k in ['flatTypeRecord']:v={'flat_type':'2 BHK'}
   if k=='flat_type_id':v=UUID
   if k in ['flatTypeId','flatType'] and v is not None:v=UUID if k=='flatTypeId' else '2 BHK'
   if v=='Example value' or v=='Example text':v=scalar(api,p,response=True)
   if k in ['hasMore','hasNextPage','hasPrevPage']:v=False
   if k=='pageSize' or k=='limit':v=20
   if k=='fileName' and api=='generate-payment-receipt':v='receipt.pdf'
   if k=='status' and path.endswith('residents[]'):v=True
   if k=='role' and path.endswith('residents[]'):v=['resident']
   if k=='residentDetails' and isinstance(v,str):v=shape_for('get-complaints',('residentId','phone'))
   if k=='staffDetails' and isinstance(v,str):v=[{'staffId':UUID,'name':'Example Staff','role':'security','totalDevices':1,'sent':1,'failed':0}]
   if k=='agentServices' and isinstance(v,str):v='plumbing'
   if k=='imageDocuments' and isinstance(v,str):v=[{'documentId':UUID,'fileName':'example.jpg','fileType':'image/jpeg','url':'https://example.com/example.jpg'}]
   if k=='imagesRemoved' and isinstance(v,str):v=1
   if k=='policy':v='FULL_REFUND'
   if k in ['reasonRequired','testMode']:v=False
   result[k]=polish(api,v,p,seen) if isinstance(v,(dict,list)) else v
  # Flatten generated generic missing flat-type spreads only where the live DTO includes them.
  if api=='crud-family' and path.endswith('familyUpdate') and result.get('action') in ['CREATE','UPDATE']:
   result.update({'flatTypeId':UUID,'flatType':'2 BHK'})
  if api=='update-member' and path.endswith('updatedData'):result.update({'flatTypeId':UUID,'flatType':'2 BHK','parkingSlot':'P-101'})
  if api=='resident-profile-console' and path.endswith('profileUpdate'):result.update({'flatTypeId':UUID,'flatType':'2 BHK'})
  if api=='update-residents-profile' and path.endswith('profileUpdate'):result.update({'flatTypeId':UUID,'flatType':'2 BHK'})
  return result
 if isinstance(obj,list):return [polish(api,x,path+'[]',seen) for x in obj]
 return obj

def camel(k):return re.sub(r'_([a-z])',lambda m:m.group(1).upper(),k)
def rpcfields(name):
 d=next(x['definition'] for x in json.loads((A/'subscription-rpc-contracts.json').read_text()) if x['proname']==name)
 # Return success shapes; list/subscription payloads are separately expanded below.
 blocks=re.findall(r'RETURN\s+jsonb_build_object\((.*?)\);',d,re.S|re.I)
 final=blocks[-1] if blocks else ''
 keys=re.findall(r"(?:^|,)\s*'([a-z_]+)'\s*,",final)
 return {camel(k):scalar('manage-transfer',camel(k),response=True) for k in keys}


def response_variants(api):
 entries=[]
 for c in material[api]['responses']:
  obj=copy.deepcopy(c['value'])
  if not isinstance(obj,dict):continue
  if obj.get('success') is False or obj.get('status')=='FAILURE' or obj.get('errorResponse') or 'error' in obj:continue
  label=c['fn'].removeprefix('handle')
  # Prefer the closest operation condition over the outer if/else chain.
  literals=re.findall(r'===\s*["\']([^"\']+)',c['branch'])
  if literals:label=literals[-1]
  elif re.fullmatch(r'["\'][^"\']+["\']',c['branch']):label=c['branch'].strip('"\'')
  if label in ['HANDLER','buildDashboardResponse','downloadReceipt','listReceipts']:label={'downloadReceipt':'URL' if obj.get('mode')=='url' else 'FILE','listReceipts':'LIST'}.get(label,'SUCCESS')
  if api=='generate-payment-receipt' and 'contentType' in obj:continue
  entries.append((label,polish(api,obj)))
 # API-specific branches whose final response is assembled outside the branch.
 if api=='switch-user':
  shapes=material[api]['shapes'];users=[x['value'] for x in shapes if x['owner']=='userDetail'];soc=next(x['value'] for x in shapes if x['owner']=='societyDetail');agent=next(x['value'] for x in shapes if x['owner']=='serviceAgent');alert=shape_for(api,('title','message','type'));entries=[]
  for role in ['resident','admin','security','service_agent','vendor']:
   user=copy.deepcopy(users[-1] if role=='vendor' else users[0]);user['role']=role
   entries.append((role.upper(),polish(api,{'matched':True,'roles':[role],'userDetail':user,'societyDetail':copy.deepcopy(soc),'alerts':[alert],'serviceAgent':agent if role=='service_agent' else None,'pagination':{'page':1,'limit':20,'totalAlerts':1,'totalPages':1},'errorResponse':None})))
 if api=='process-csv-import':
  entries=[('IMPORT REPORT',{'success':True,'data':{'executionTimeMs':25,'summary':{'totalRowsInCSV':2,'societyUsersProcessed':1,'nonSocietyUsersProcessed':0,'totalFailedRows':1},'report':[{'rowNumber':2,'entityType':'society_user','identifier':UUID,'parkingSlot':'P-101','status':'success'},{'rowNumber':3,'entityType':'non_society_user','data':{'entity_type':'non_society_user','name':'Invalid Vendor','phone':''},'reason':'Missing mandatory fields for non-society user: name or phone','status':'failed'}],'pagination':{'page':1,'limit':20,'totalRecords':2,'totalPages':1}}})]
 if api=='get-members':
  base=entries[0][1];base['data']['members']=[polish(api,shape_for(api,('memberId','fullName')))];entries=[('MEMBER LIST — society user',base)]
  vendor=copy.deepcopy(base);vendor['data']['members']=[polish(api,material[api]['shapes'][1]['value'])];entries.append(('MEMBER LIST — non-society user',vendor))
 if api=='add-members':
  for label,obj in entries:
   body=obj['data'];body['memberType']='vendor' if body.get('memberType')=='vendor' else 'resident';body['memberCreated'][0]['role']=body['memberType']
  vendor=next(o for _,o in entries if o['data']['memberType']=='vendor');resident=next(o for _,o in entries if o['data']['memberType']=='resident');entries=[]
  for role in ['resident','admin','security','service_agent','vendor']:
   value=copy.deepcopy(vendor if role=='vendor' else resident);value['data']['memberType']=role;value['data']['memberCreated'][0]['role']=role;entries.append((role.upper()+' CREATE',value))
 if api=='update-member':
  for label,obj in entries:
   if 'updatedMember' in obj.get('data',{}):obj['data']['updatedMember']['updatedData']=schema_sample(api,ctx['get_schema'](api)['updatedData']);obj['data']['updatedMember']['updatedData'].update({'flatTypeId':UUID,'flatType':'2 BHK','parkingSlot':'P-101'})
 if api=='verify-otp':
  for _,obj in entries:
   obj['user']['roles']=['vendor'] if obj['user']['userType']=='vendor' else ['resident']
 if api=='vendor-management':
  fetch=next(o for _,o in entries if 'vendors' in o.get('data',{}));single=next(o for _,o in entries if 'vendor' in o.get('data',{}) and 'name' in o['data']['vendor']);deleted=next(o for _,o in entries if 'vendor' in o.get('data',{}) and 'name' not in o['data']['vendor']);entries=[('FETCH',fetch),('CREATE',copy.deepcopy(single)),('UPDATE',single),('DELETE',deleted)]
 if api=='facility-booking-action' and entries:
  base=entries[0][1];entries=[]
  for act,status in [('approve','Approved'),('reject','Rejected')]:
   obj=copy.deepcopy(base);data=obj.get('data',{});target=data.get('facilityBookingAction',data);target['approvalStatus']=status;target['bookingStatus']=status;target['rejectionReason']='Example rejection reason' if act=='reject' else None;entries.append((act.upper(),obj))
 if api=='get-profile':
  shapes={s['owner']:s['value'] for s in material[api]['shapes']};entries=[]
  for role in ['resident','admin','security','service_agent','vendor']:
   obj={'contact':copy.deepcopy(shapes.get('contactProfile')) if role!='vendor' else None,'societyUser':copy.deepcopy(shapes.get('societyUserDetail')) if role!='vendor' else None,'SocietyAddress':copy.deepcopy(shapes['societyAddress']),'serviceAgent':copy.deepcopy(shapes.get('serviceAgentDetail')) if role=='service_agent' else None,'vendor':copy.deepcopy(shapes.get('vendorDetail')) if role=='vendor' else None,'errorResponse':None}
   if obj['societyUser']:obj['societyUser']['role']=role
   if obj['vendor']:obj['vendor']['role']='vendor'
   entries.append((role.upper(),polish(api,obj)))
 if api in ['resident-profile-console','get-residents-profile']:
  profile=polish(api,shape_for(api,('personalInformation','residentialInformation')))
  for i,(label,obj) in enumerate(entries):
   if 'profiles' in obj.get('data',{}):obj['data']['profiles']=[copy.deepcopy(profile)]
   if 'profiles' in obj:obj['profiles']=[copy.deepcopy(profile)]
 if api=='crud-facility':
  deleted=next((o for _,o in entries if o.get('data',{}).get('deleted')),None);base=next((o for _,o in entries if not o.get('data',{}).get('deleted')),None);entries=[]
  for act in ['VIEW','CREATE','UPDATE']:
   v=copy.deepcopy(base);v['data']['operation']=act;entries.append((act,v))
  if deleted:entries.append(('DELETE',deleted))
 if api in ['get-my-facility-bookings','facility-console']:
  for label,obj in entries:
   d=obj.get('data',obj)
   if api=='get-my-facility-bookings':d['facilities']=[shared_booking()]
   if 'myBookings' in d:d['myBookings']=[shared_booking()]
 if api=='get-society-settings':
  for label,obj in entries:
   data=obj['data'];data['society'].update({'openParkingCount':80,'coveredParkingCount':20,'totalParkingSlot':'100','currentAmenities':['clubhouse','sports']})
   data['blocks']=[data['blocks'][0],{**data['blocks'][0],'blockId':'00000000-0000-4000-8000-000000000002','blockName':'Block B','active':False}]
   data['societyConfiguration']={'towers':[{'towerId':UUID,'name':'Tower A','blockId':UUID}],'blocks':[{'blockId':UUID,'blockName':'Block A','towerId':UUID},{'blockId':'00000000-0000-4000-8000-000000000002','blockName':'Block B','towerId':None}],'flatTypes':[{'flatTypeId':UUID,'flatType':'2 BHK'}]};data['configurationVersion']='example-config-v1'
 if api=='get-picklists':
  meta={'fieldLabel':'Flat Type','fieldPlaceholder':'Select flat type','fieldHelperText':'Choose a configured society flat type','inputType':'select','isRequired':False,'isVisible':True,'defaultValue':None,'validationRegex':None,'sortOrder':1,'options':[{'value':UUID,'label':'2 BHK'}]}
  obj={'status':'SUCCESS','version':'example-picklists-v1','generatedAt':STAMP,'language':'en','societyId':UUID,'scope':['SSP_Society_User','SSP_Flat_Type'],'picklistsByTable':{'SSP_Society_User':{'flat_type_id':meta,'role':{**meta,'fieldLabel':'Role','options':[{'value':'resident','label':'Resident'}]}},'SSP_Flat_Type':{'flat_type':{**meta,'options':[{'value':'2 BHK','label':'2 BHK'}]}},'SSP_Society':{'tower':{**meta,'fieldLabel':'Tower','options':[{'value':UUID,'label':'Tower A'}]},'block':{**meta,'fieldLabel':'Block','options':[{'value':UUID,'label':'Block A'}]},'flat_type':meta}},'societyConfiguration':{'towers':[{'towerId':UUID,'name':'Tower A','blockId':UUID}],'blocks':[{'blockId':UUID,'blockName':'Block A','towerId':UUID}],'flatTypes':[{'flatTypeId':UUID,'flatType':'2 BHK'}]},'configurationVersion':'example-config-v1','flatTypeCatalog':[{'value':v,'label':v} for v in pick[('SSP_Flat_Type','flat_type')]]};entries=[('200 — full configuration/picklists example',obj)]
 if api=='complaint-otp':
  entries=[]
  for stage in ['START','END']:
   for verified in [False,True]:
    data={'complaintId':UUID,'stage':stage,'otpVerified':verified,'status':('resolved' if stage=='END' else 'in_progress') if verified else ('in_progress' if stage=='END' else 'assigned'),'nextStep':('COMPLETED' if stage=='END' else 'END_OTP') if verified else 'VERIFY_'+stage,'message':('Work completed successfully.' if stage=='END' else 'Work started successfully.') if verified else stage+' OTP is ready. Ask the resident to share it. It is valid for 10 minutes.'};entries.append((stage+(' VERIFIED' if verified else ' OTP READY'),{'success':True,'data':data}))
 if api=='razorpay-webhook':entries=[('PROCESSED',{'received':True,'message':'Processed'}),('DUPLICATE ALREADY PROCESSED',{'received':True,'message':'Already processed'})]
 if api=='manage-subscription':
  entries=[('ACTIVATE_FREE',{'success':True,'data':{**rpcfields('activate_free_plan'),'success':True,'alreadyActive':False,'planCode':'FREE','status':'active','action':'ACTIVATE_FREE'}}),('CANCEL',{'success':True,'data':{**rpcfields('cancel_my_subscription'),'success':True,'alreadyCancelled':False,'cancelMode':'END_OF_PERIOD','autoRenew':False,'action':'CANCEL'}})]
 if api=='manage-transfer':
  entries=[]
  for action,rpc in [('REQUEST','transfer_request'),('ACCEPT','transfer_accept'),('CANCEL','transfer_cancel')]:
   d=rpcfields(rpc);d['success']=True;d['status']={'REQUEST':'pending','ACCEPT':'completed','CANCEL':'cancelled'}[action];entries.append((action,{'success':True,'data':d}))
  fields='transfer_id transfer_type status from_society from_tower from_flat_number from_society_user to_society to_tower to_flat_number to_society_user remaining_validity_days requested_at expires_at accepted_at cancelled_at completed_at'.split();item={camel(k):scalar(api,camel(k),response=True) for k in fields};entries.append(('LIST',{'success':True,'data':{'success':True,'items':[item],'filter':'all'}}))
 if api=='manage-subscription-payment' and entries:
  entries=[(act,{**copy.deepcopy(entries[0][1]),'data':{**copy.deepcopy(entries[0][1]['data']),'action':act,'billingPeriod':'MONTHLY','paymentPurpose':'renewal' if act=='RENEW' else 'upgrade','testMode':True}}) for act in ['RENEW','UPGRADE']]
 if api=='get-subscription-info':
  plan={'planId':UUID,'planCode':'PREMIUM','planName':'Premium','description':'Example plan','sortOrder':1,'features':{'visitorOtp':True},'prices':[{'planPriceId':UUID,'billingPeriod':'MONTHLY','amount':1500,'currency':'INR','validityMonths':1,'discountPercentage':0}]}
  historyfields='pay_rec_id amount payment_type payment_status payment_method payment_id payment_date created_at receipt_url provider_order_id provider_payment_id payment_purpose captured_at'.split();history={camel(k):scalar(api,camel(k),response=True) for k in historyfields}
  entries=[('plans',{'success':True,'data':[plan]}),('myPlan',{'success':True,'data':{'plan':{'planCode':'PREMIUM','planName':'Premium','status':'active','startDate':STAMP,'endDate':'2026-12-11T10:00:00+05:30','autoRenew':False,'entitlements':{'visitorOtp':True}},'flat':{'society':UUID,'tower':UUID,'block':UUID,'flatNumber':'101'},'paymentCount':1}}),('history',{'success':True,'data':{'items':[history],'pagination':{'total':1,'page':1,'limit':20,'totalPages':1}}})]
 # Consistent deduplication preserves distinct operations and response branches.
 unique=[]
 for label,obj in entries:
  if not any(label==l and obj==v for l,v in unique):unique.append((label,obj))
 return unique

def error_example(api):
 for c in material[api]['responses']:
  obj=c['value']
  if isinstance(obj,dict) and (obj.get('success') is False or obj.get('status')=='FAILURE' or obj.get('errorResponse')):
   obj=copy.deepcopy(obj)
   def fix(x):
    if isinstance(x,dict):
     for k,v in x.items():
      if k=='message':x[k]='Example validation or processing error.'
      elif k=='errorCode' and v in ['Example value','Example text']:x[k]='INVALID_PARAMETERS'
      elif isinstance(v,(dict,list)):fix(v)
    elif isinstance(x,list):
     for v in x:fix(v)
   fix(obj);return obj
 code=(A/'source'/f'{api}.ts').read_text()
 if api=='razorpay-webhook':return {'received':False,'message':'Invalid signature'}
 if 'status: "FAILURE"' in code:
  obj={'status':'FAILURE','errorResponse':{'errorCode':'INVALID_PARAMETERS','message':'Example invalid request.'}}
  if re.search(r'status: "FAILURE",\s*data: null',code):obj={'status':'FAILURE','data':None,'errorResponse':obj['errorResponse']}
  return obj
 if 'errorResponse: null' in code and 'profileUpdate:' in code:return {'profileUpdate':None,'errorResponse':{'errorCode':'BAD_REQUEST','message':'Example invalid request.','timestamp':STAMP}}
 if api=='generate-payment-receipt':return {'success':False,'errorResponse':{'errorCode':'INVALID_STATUS','message':'Receipt is only available for paid payments.','timestamp':STAMP}}
 if 'function buildError(' in code or 'function buildErrorResponse(' in code:
  return {'success':False,'errorResponse':{'errorCode':'BAD_REQUEST','message':'Example invalid request.','timestamp':STAMP}}
 return {'success':False,'error':'ERROR','message':'Example validation error.'}


def fix_request(api,label,obj):
 if not isinstance(obj,dict):return obj
 def fix(x,path=''):
  if isinstance(x,dict):
   if x.get('idProofType') and 'idProofNumber' in x:
    proof=str(x['idProofType']).lower();x['idProofNumber']='234567890123' if 'aadhaar' in proof else 'ABCDE1234F' if 'pan' in proof else 'A1234567' if 'passport' in proof else 'DL0123456789012' if 'driving' in proof else 'ABC1234567'

   for k,v in x.items():
    p=path+'.'+k if path else k
    if k in ['field','by'] and 'sort' in path:
     opts=allowed(api,p);x[k]=opts[0] if opts else 'name' if k=='by' else 'created_at'
    elif k in ['flatTypeId','flatType']:x[k]=UUID if k=='flatTypeId' else '2 BHK'
    elif isinstance(v,(dict,list)):fix(v,p)
  elif isinstance(x,list):
   for v in x:fix(v,path+'[]')
 fix(obj)
 if api=='update-member' and label=='SOCIETY MEMBER':
  d=obj['updatedData']
  for k in ['vendorName','vendorServiceType','vendorRating','vendorId','name','phoneNumber','serviceType','vehicleNumber']:d.pop(k,None)
 if api=='create-marketplace':obj['category']='furniture';obj['priceType']='fixed';obj['price']=100
 if api in ['resident-marketplace-console','resident-marketplace'] and (obj.get('actionType')=='CREATE'):
  obj['category']='furniture';obj['priceType']='fixed';obj['price']=100
 if api in ['crud-notice','get-resident-notices']:
  if isinstance(obj.get('noticeData'),dict):obj['noticeData']['targetAudience']=['both']
 if api=='visitor-pass-operations' and obj.get('operation')=='FETCH_ALL':obj['societyRegistrationNumber']='EXAMPLE-REG-001'
 if api=='get-profile':obj['phoneNumber']='9000000000'
 return obj

all_examples={};unfilled=[]
for api in facts:
 schema=ctx['get_schema'](api);requests=[(label,fix_request(api,label,obj)) for label,obj in full_requests(api)];responses=response_variants(api)
 if api=='staff-complaint-workflow':
  for stage in ['START','END']:
   for verified in [False,True]:
    data={'complaintId':UUID,'stage':stage,'otpVerified':verified,'status':('resolved' if stage=='END' else 'in_progress') if verified else ('in_progress' if stage=='END' else 'assigned'),'nextStep':('COMPLETED' if stage=='END' else 'END_OTP') if verified else 'VERIFY_'+stage,'message':('Work completed successfully.' if stage=='END' else 'Work started successfully.') if verified else stage+' OTP is ready. Ask the resident to share it. It is valid for 10 minutes.'};responses.append((('VERIFY_' if verified else '')+stage,{'success':True,'data':data,'errorResponse':None}))
 if api=='get-societies':responses=[('LIST',{'societies':[{'society_name':'Example Society','registration_number':'EXAMPLE-REG-001','subscription_plan':'premium'}],'pagination':{'total':1,'page':1,'limit':20,'totalPages':1}}),('MY SOCIETIES (authenticated)',{'societies':[{'society_name':'Example Society','registration_number':'EXAMPLE-REG-001','subscription_plan':'premium'}],'pagination':{'total':1,'page':1,'limit':20,'totalPages':1},'user':{'id':UUID,'email':'person@example.com'}}),('SINGLE SOCIETY',{'society':{'society_name':'Example Society','registration_number':'EXAMPLE-REG-001','subscription_plan':'premium'}})]
 # Illustrative empty result for a collection endpoint retains the same wrapper.
 if not responses:raise ValueError('Missing full response example: '+api)
 error=error_example(api)
 reqblocks=[]
 for label,obj in requests:
  if obj is None:reqblocks.append('// '+label+'\n// No JSON request body.')
  else:reqblocks.append('// '+label+' — full example including applicable optional fields\n'+jsonc(api,obj,schema))
 if api=='process-csv-import':reqblocks=['// MULTIPART REQUEST — do not send the following as JSON\nContent-Type: multipart/form-data; boundary=<CLIENT_GENERATED_BOUNDARY>\nfile: @society-import.csv\npage: 1\nlimit: 20\nentityType: society_user // Allowed: society_user, non_society_user\nstatus: success // Allowed: success, failed\nsearchQuery: Example\n\n// CSV contents — society user\nentity_type,name,phone,registration_number,role,unit_flat_number,parking_slot\nsociety_user,Example Resident,9000000000,EXAMPLE-REG-001,resident,101,P-101\n\n// CSV contents — non-society user\nentity_type,name,phone,registration_number,role,service_type\nnon_society_user,Example Vendor,9000000001,EXAMPLE-REG-001,vendor,plumbing']
 if api=='verify-payment':reqblocks.append('// MULTIPART ALTERNATIVE\nsocietyRegistrationNumber: EXAMPLE-REG-001\npaymentId: '+UUID+'\naction: VERIFY // Allowed: VERIFY, REJECT\nrejectionReason: Example rejection reason // For REJECT\nreceiptImage: @receipt.jpg')
 # Typed alternatives are documented explicitly rather than mixing them into one payload.
 if api in ['add-members','update-member','crud-family','resident-profile-console','update-residents-profile']:
  reqblocks.append('// UPDATE / CREATE VALUE SEMANTICS\n// flatTypeId or flatType: use active societyConfiguration.flatTypes values.\n// On UPDATE: omit both fields to preserve, or supply null to clear.\n// Alias values supplied together must refer to the same configured type.\n// parkingSlot / parking_slot are text or null; omit to preserve on update.')
 if api=='get-subscription-info':reqblocks.append('// action query — Allowed: plans, myPlan, history')
 responses=[(label,polish(api,polish(api,polish(api,obj)))) for label,obj in responses]
 responseblocks=[]
 for index,(label,obj) in enumerate(responses,1):
  responseblocks.append('// '+label+' — illustrative success example '+str(index)+'\n'+jsonc(api,obj,response=True))
 responseblocks.append('// ERROR — illustrative validation/processing error; HTTP status is endpoint-specific\n'+jsonc(api,error,response=True))
 if api=='generate-payment-receipt':responseblocks.append('// FILE DOWNLOAD — HTTP 200, not JSON\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="receipt.pdf"\n\n<BINARY_PDF_BYTES>')
 if api=='get-picklists':responseblocks.append('// CACHE MATCH — HTTP 304, no response body\nETag: "example-picklists-v1"\nCache-Control: private, no-cache, must-revalidate\n// Repeat with If-None-Match to revalidate the cached response.')
 requestcell='// JSONC documentation: remove // comments before sending JSON.\n// Example values are illustrative; use real IDs, dates and options for your society.\n\n'+'\n\n'.join(reqblocks)
 responsecell='// Illustrative complete response examples, derived from the current source.\n// Different operations/branches may return different wrappers and fields.\n\n'+'\n\n'.join(responseblocks)
 all_examples[api]={'requests':requests,'responses':responses,'error':error,'requestCell':requestcell,'responseCell':responsecell}
 for label,obj in responses:
  def find(x,path=''):
   if isinstance(x,dict):
    if set(x)=={'id','name'}:unfilled.append((api,label,path))
    for k,v in x.items():find(v,path+'.'+k)
   elif isinstance(x,list):
    for i,v in enumerate(x):find(v,path+'[]')
  find(obj)

(A/'full-examples.json').write_text(json.dumps(all_examples,indent=2,ensure_ascii=False))
(A/'remaining-generic-items.json').write_text(json.dumps(unfilled,indent=2))
print('APIs',len(all_examples),'request variants',sum(len(x['requests']) for x in all_examples.values()),'response variants',sum(len(x['responses']) for x in all_examples.values()))
print('Remaining generic array items:',unfilled)
print('Largest cells',sorted([(max(len(x['requestCell']),len(x['responseCell'])),n) for n,x in all_examples.items()],reverse=True)[:8])

# CSV rows use their actual import schema, including optional columns.
import csv,io
society_columns='entity_type society_id registration_number contact_id user_id name phone email gender occupation id_proof_number id_proof_type whatsapp_phone parking_slot tower_id tower_name block_id block_name role status flat_type_id unit_flat_number user_type user_ownership_type gate_number security_guard_id security_zone shift'.split()
non_columns='entity_type society_id registration_number non_society_user_id name phone email gender role id_proof_type id_proof_number purpose service_type vehicle_number vehicle_type delivery_origin gate_no vendor_id recurring_days hosted_by'.split()
csvblocks=[]
for label,columns in [('society_user',society_columns),('non_society_user',non_columns)]:
 buffer=io.StringIO();writer=csv.writer(buffer,lineterminator='\n');writer.writerow(columns)
 overrides={'entity_type':label,'name':'Example Person','phone':'9000000000','registration_number':'EXAMPLE-REG-001','role':'resident' if label=='society_user' else 'vendor','gender':'male','id_proof_type':'pan','id_proof_number':'ABCDE1234F','status':'true','user_type':'owner','user_ownership_type':'secondary','parking_slot':'P-101','unit_flat_number':'101','recurring_days':'Monday,Wednesday','purpose':'guest','service_type':'plumbing','vehicle_type':'four_wheeler','tower_name':'Tower A','block_name':'Block A','shift':'day_shift','security_zone':'main_entrance_alpha'}
 writer.writerow([overrides.get(k,UUID if k.endswith('_id') or k=='hosted_by' else scalar('process-csv-import',k)) for k in columns])
 csvblocks.append('// CSV '+label+' — all supported columns\n'+buffer.getvalue())
all_examples['process-csv-import']['requestCell']='// MULTIPART REQUEST: send as form-data, not JSON.\nContent-Type: multipart/form-data; boundary=<CLIENT_GENERATED_BOUNDARY>\nfile: @society-import.csv\npage: 1\nlimit: 20\nentityType: society_user // Allowed: society_user, non_society_user\nstatus: success // Allowed: success, failed\nsearchQuery: Example\n// role (society user): admin, resident, security, service_agent\n// role (non-society): vendor, visitor\n// gender: male, female, other\n// status CSV field: true, false, active, inactive\n// user_type: owner, tenant\n// user_ownership_type: primary, secondary\n// Multiple roles/recurring_days: comma-separated inside a quoted CSV field.\n\n'+'\n'.join(csvblocks)

# JSONC is round-tripped through JSON after removing comments without stripping
# https:// inside quoted strings.
def strip_comments(s):
 out=[];instring=False;escaped=False;i=0
 while i<len(s):
  ch=s[i]
  if instring:
   out.append(ch)
   if escaped:escaped=False
   elif ch=='\\':escaped=True
   elif ch=='"':instring=False
   i+=1;continue
  if ch=='"':instring=True;out.append(ch);i+=1;continue
  if ch=='/' and i+1<len(s) and s[i+1]=='/':
   while i<len(s) and s[i]!='\n':i+=1
   continue
  out.append(ch);i+=1
 return ''.join(out)
validated=0
for api,ex in all_examples.items():
 schema=ctx['get_schema'](api)
 for _,obj in ex['requests']:
  if obj is not None:assert json.loads(strip_comments(jsonc(api,obj,schema)))==obj;validated+=1
 for _,obj in ex['responses']:
  assert json.loads(strip_comments(jsonc(api,obj,response=True)))==obj;validated+=1
 assert json.loads(strip_comments(jsonc(api,ex['error'],response=True)))==ex['error'];validated+=1
 for key in ['requestCell','responseCell']:
  assert len(ex[key].encode('utf-16-le'))//2<32767,(api,key,len(ex[key]))
 assert ex['requests'] and ex['responses']
assert not unfilled

ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
changed={};cell_count=0;row_count=0;seen=set();per_sheet=[]
with zipfile.ZipFile(INPUT) as zin:
 originals={name:zin.read(name) for name in zin.namelist()}
 for sheet in range(1,4):
  part=f'xl/worksheets/sheet{sheet}.xml';xml=originals[part].decode('utf-8');tree=ET.fromstring(xml);rows=[]
  for row in tree.findall('m:sheetData/m:row',ns):
   cells={re.match('[A-Z]+',c.get('r')).group(0):''.join(c.find('m:is',ns).itertext()) for c in row.findall('m:c',ns) if c.get('t')=='inlineStr'}
   endpoint=cells.get('I' if sheet==1 else 'G','').strip('/')
   if endpoint not in all_examples:continue
   number=int(row.get('r'));reqcol='M' if sheet==1 else 'K';rescol='T' if sheet==1 else 'R';ex=all_examples[endpoint]
   rows.append(number);seen.add(endpoint);row_count+=1
   for col,key in [(reqcol,'requestCell'),(rescol,'responseCell')]:
    ref=col+str(number);pattern=r'<c\b[^>]*\br="'+ref+r'"[^>]*(?:/>|>.*?</c>)';match=re.search(pattern,xml,re.S);assert match,ref
    old=match.group(0);style=re.search(r'\bs="([^"]+)"',old);style=style.group(1) if style else '46'
    replacement=f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">'+escape(ex[key])+'</t></is></c>'
    xml=xml[:match.start()]+replacement+xml[match.end():];cell_count+=1
  changed[part]=xml.encode('utf-8');ET.fromstring(changed[part]);per_sheet.append(len(rows))
 assert seen==set(facts)
 with zipfile.ZipFile(OUTPUT,'w',compression=zipfile.ZIP_DEFLATED) as zout:
  for info in zin.infolist():zout.writestr(info,changed.get(info.filename,originals[info.filename]))

with zipfile.ZipFile(OUTPUT) as z:
 assert z.testzip() is None
 assert all(z.read(n)==v for n,v in originals.items() if n not in changed)
 # Within the first three sheets only the requested two columns may differ.
 for sheet in range(1,4):
  part=f'xl/worksheets/sheet{sheet}.xml';before=ET.fromstring(originals[part]);after=ET.fromstring(z.read(part));allowedcols=['M','T'] if sheet==1 else ['K','R']
  def index(root):return{c.get('r'):ET.tostring(c) for c in root.findall('m:sheetData/m:row/m:c',ns)}
  old=index(before);new=index(after);assert set(old)==set(new)
  for ref in old:
   if re.match('[A-Z]+',ref).group() not in allowedcols:assert old[ref]==new[ref],ref
report={'file':OUTPUT.name,'functions':len(seen),'rows':row_count,'rowsPerSheet':per_sheet,'requestAndResponseCellsUpdated':cell_count,'requestExamples':sum(len(x['requests']) for x in all_examples.values()),'successResponseExamples':sum(len(x['responses']) for x in all_examples.values()),'errorExamples':len(all_examples),'jsoncRoundTripsValidated':validated,'maxExcelCellCharacters':max(max(len(x['requestCell']),len(x['responseCell'])) for x in all_examples.values()),'onlyRequestedColumnsChanged':True,'otherFourSheetsByteIdentical':True,'notes':['Examples are illustrative and derived from current source and configured picklists, not live mutation responses.','JSONC inline comments list supported enum values comma-separated; remove comments before JSON submission.','GET, multipart, PDF and HTTP 304 are represented with their actual body format, not fake JSON.']}
(A/'full-examples.json').write_text(json.dumps(all_examples,ensure_ascii=False,indent=2))
(A/'full-examples-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
