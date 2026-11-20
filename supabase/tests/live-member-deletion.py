"""Delete an isolated member with hosted visitor history; verify lists and login."""
import importlib.util,json,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path(__file__).with_name('live-visitor-name-check.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
member=str(uuid.uuid4());contact=str(uuid.uuid4());visitor=str(uuid.uuid4());society='74628c82-7e11-4f5a-952a-d062193b3fb9'
name='Codex member delete '+member;phone='799'+str(uuid.uuid4().int%10000000).zfill(7);created=False;checks=[]
def call(endpoint,request,expected=200,authenticated=True):
 status,body=a.post(endpoint,request,token if authenticated else None,record=False)
 assert status==expected,(endpoint,status,body)
 checks.append({'endpoint':endpoint,'httpStatus':status,'response':body if endpoint=='delete-members' else {'passed':True}})
 print(endpoint,status,flush=True);return body
try:
 actor=a.db('SELECT c.phone FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '+f"WHERE u.user_id='{a.HOST}';")[0]
 credentials={'phoneNumber':str(actor['phone']),'registrationNumber':'GZB-1234-ab'}
 status,otp=a.post('get-otp',credentials,record=False);assert status==200
 status,auth=a.post('verify-otp',{**credentials,'otp':otp['otp']},record=False);assert status==200
 token=auth['token']
 # One SQL statement makes fixture creation atomic.
 a.db(f'''WITH c AS (INSERT INTO public."SSP_Contact" (contact_id,name,phone) VALUES ('{contact}','{name}','{phone}') RETURNING contact_id), u AS (INSERT INTO public."SSP_Society_User" (user_id,society,contact,role,status) SELECT '{member}','{society}',contact_id,ARRAY['resident'],true FROM c RETURNING user_id) INSERT INTO public."SSP_Non_Society_User" (non_society_user_id,name,role,hosted_by,approver,society) SELECT '{visitor}','Codex deletion visitor','visitor',user_id,user_id,'{society}' FROM u RETURNING non_society_user_id;''');created=True
 listing={'registrationNumber':'GZB-1234-ab','role':'all','search':name,'page':1,'limit':100}
 before=call('get-members',listing)
 assert member in json.dumps(before["data"]["members"]),'Fixture not visible before deletion'
 creds={'phoneNumber':phone,'registrationNumber':'GZB-1234-ab'}
 before_otp=call('get-otp',creds,authenticated=False)['otp']
 call('delete-members',{'memberId':member})
 rows=a.db(f'''SELECT u.deleted_at,u.status,u.one_time_password_otp IS NULL AS otp_cleared,n.hosted_by,n.approver,c.name FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Non_Society_User" n ON n.non_society_user_id='{visitor}' WHERE u.user_id='{member}';''')
 assert rows[0]['deleted_at'] and rows[0]['status'] is False and rows[0]['otp_cleared']
 assert rows[0]['hosted_by']==member and rows[0]['approver']==member and rows[0]['name']==name
 after=call('get-members',listing);assert member not in json.dumps(after["data"]["members"])
 call('delete-members',{'memberId':member})
 call('get-otp',creds,404,False)
 call('verify-otp',{**creds,'otp':before_otp},404,False)
 checks.append({'database':rows,'historyPreserved':True})
finally:
 if created:
  a.db(f'''WITH n AS (DELETE FROM public."SSP_Non_Society_User" WHERE non_society_user_id='{visitor}' RETURNING hosted_by), u AS (DELETE FROM public."SSP_Society_User" WHERE user_id='{member}' AND EXISTS(SELECT 1 FROM n) RETURNING contact) DELETE FROM public."SSP_Contact" WHERE contact_id='{contact}' AND EXISTS(SELECT 1 FROM u) RETURNING contact_id;''')
  print('Test member, contact and visitor cleaned up.',flush=True)
 Path('artifacts/member-deletion').mkdir(parents=True,exist_ok=True)
 Path('artifacts/member-deletion/live-results.json').write_text(json.dumps(checks,indent=2))
