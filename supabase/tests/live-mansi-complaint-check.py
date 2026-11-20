"""Live Mansi assignment/OTP diagnosis. OTPs/tokens stay in memory; fixtures are removed."""
import importlib.util,json,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path(__file__).with_name('live-visitor-name-check.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
member='cd9b8169-943c-4145-a7a3-58f582c50734';vendor='5939229d-f58c-4f74-ad54-66647382fd8a';society='74628c82-7e11-4f5a-952a-d062193b3fb9';reg='GZB-1234-ab'
owner=str(uuid.uuid4());fixtures=[(role,endpoint,str(uuid.uuid4())) for role in ['SERVICE_AGENT','VENDOR'] for endpoint in ['staff-complaint-workflow','complaint-otp']];checks=[];owner_created=False
out=Path('artifacts/complaint-otp/mansi-live-results.json');out.parent.mkdir(parents=True,exist_ok=True)
def check(endpoint,payload,token):
 status,body=a.post(endpoint,payload,token,record=False)
 record={'endpoint':endpoint,'action':payload.get('action',payload.get('stage')),'httpStatus':status,'complaintId':payload.get('complaintId')}
 if status!=200:record['error']=body.get('message') or (body.get('errorResponse') or {}).get('message')
 checks.append(record);print(json.dumps(record),flush=True)
 return status,body
try:
 actor=a.db('SELECT c.phone FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '+f"WHERE u.user_id='{member}';")[0]
 credentials={'phoneNumber':str(actor['phone']),'registrationNumber':reg}
 status,otp=a.post('get-otp',credentials,record=False);assert status==200,'Login OTP request failed'
 status,auth=a.post('verify-otp',{**credentials,'otp':otp['otp']},record=False);assert status==200,'Login verification failed'
 token=auth['token'];assert auth['user']['id']==member
 print('Authenticated Mansi; roles: '+','.join(auth['user']['roles']),flush=True)
 for role,staff in [('SERVICE_AGENT',member),('VENDOR',vendor)]:
  status,body=check('staff-complaints',{'societyRegistrationNumber':reg,'staffType':role,'staffId':staff,'actionType':'FETCH','status':'assigned','limit':100},token)
  if status==200:print(json.dumps({'role':role,'assignedCount':body['data']['statusCounts']['assigned'],'listed':len(body['data']['complaints'])}),flush=True)
 a.db(f'''INSERT INTO public."SSP_Society_User" (user_id,role,status) VALUES ('{owner}',ARRAY['resident'],true) RETURNING user_id;''');owner_created=True
 # With no society on this isolated owner, fixture creation cannot notify real society admins.
 for role,endpoint,cid in fixtures:
  column='assigned_agent' if role=='SERVICE_AGENT' else 'non_society_user'
  staff=member if role=='SERVICE_AGENT' else vendor
  a.db(f'''INSERT INTO public."SSP_Complaint" (complaint_id,name,status,society_user,complaint_type,priority,{column},assigned_date_time) VALUES ('{cid}','Codex Mansi isolated OTP test {cid}','assigned','{owner}','general','medium','{staff}',(now() AT TIME ZONE 'Asia/Kolkata')) RETURNING complaint_id;''')
 a.db(f'''UPDATE public."SSP_Society_User" SET society='{society}' WHERE user_id='{owner}' RETURNING user_id;''')
 for role,endpoint,cid in fixtures:
  staff=member if role=='SERVICE_AGENT' else vendor
  status,body=check('staff-complaints',{'societyRegistrationNumber':reg,'staffType':role,'staffId':staff,'actionType':'FETCH','complaintId':cid},token)
  assert status==200 and any(c['complaintId']==cid for c in body['data']['complaints']),'Assigned fixture not visible'
  def request(stage,otp=None):
   payload={'complaintId':cid}
   if endpoint=='complaint-otp':payload['stage']=stage
   else:payload['action']=(('VERIFY_'+stage) if otp is not None else (stage+'_OTP'))
   if otp is not None:payload['otp']=otp
   return check(endpoint,payload,token)
  status,_=request('START')
  if status!=200:continue
  start=a.db(f'''SELECT start_otp AS value FROM public."SSP_Complaint" WHERE complaint_id='{cid}';''')[0]['value']
  status,_=request('START',start)
  if status!=200:continue
  status,_=request('END')
  if status!=200:continue
  end=a.db(f'''SELECT end_otp AS value FROM public."SSP_Complaint" WHERE complaint_id='{cid}';''')[0]['value']
  status,_=request('END',end)
  if status==200:
   state=a.db(f'''SELECT status FROM public."SSP_Complaint" WHERE complaint_id='{cid}';''')[0]
   assert state['status']=='resolved';print(role+' '+endpoint+' resolved isolated complaint',flush=True)
finally:
 if owner_created:
  ids=','.join("'"+cid+"'" for _,_,cid in fixtures)
  a.db(f'''DELETE FROM public."SSP_Notification" WHERE reference_table='SSP_Complaint' AND reference_id IN ({ids}); DELETE FROM public."SSP_Complaint" WHERE complaint_id IN ({ids}) AND society_user='{owner}'; DELETE FROM public."SSP_Society_User" WHERE user_id='{owner}'; SELECT count(*) AS remaining FROM public."SSP_Complaint" WHERE complaint_id IN ({ids});''')
  print('Isolated complaint/resident/notification fixtures removed.',flush=True)
 out.write_text(json.dumps(checks,indent=2))
assert all(c['httpStatus']==200 for c in checks),'One or more live API checks failed; see sanitized report.'
