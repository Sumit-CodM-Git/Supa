"""Check live staff status totals against SQL across page sizes and status tabs."""
import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path(__file__).with_name('live-visitor-name-check.py'))
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
actor=api.db('SELECT c.phone FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '+f"WHERE u.user_id='{api.HOST}';")[0]
credentials={'phoneNumber':str(actor['phone']),'registrationNumber':'GZB-1234-ab'}
status,otp=api.post('get-otp',credentials,record=False);assert status==200
status,auth=api.post('verify-otp',{**credentials,'otp':otp['otp']},record=False);assert status==200
token=auth['token']
# Use the busiest real service agent so live tests exercise pagination.
agents=api.db('SELECT u.user_id,COUNT(c.complaint_id) AS total FROM public."SSP_Society_User" u LEFT JOIN public."SSP_Complaint" c ON c.assigned_agent=u.user_id '+"WHERE u.society='74628c82-7e11-4f5a-952a-d062193b3fb9' AND 'service_agent'=ANY(u.role) GROUP BY u.user_id ORDER BY total DESC LIMIT 1;")
assert agents
agent=agents[0]['user_id']
rows=api.db('SELECT status,COUNT(*) AS total FROM public."SSP_Complaint" '+f"WHERE assigned_agent='{agent}' GROUP BY status;")
by_status={r['status']:r['total'] for r in rows}
expected={'assigned':by_status.get('assigned',0),'inProgress':by_status.get('in_progress',0),'resolved':by_status.get('resolved',0)}
report=[]
for options in [{'page':1,'limit':1},{'page':2,'limit':1},{'page':1,'limit':100},{'page':99999,'limit':10},{'status':'resolved','limit':1},{'search':'no-such-complaint-count-check','limit':1}]:
 request={'societyRegistrationNumber':'GZB-1234-ab','staffType':'SERVICE_AGENT','staffId':agent,'actionType':'FETCH',**options}
 status,body=api.post('staff-complaints',request,token,record=False)
 assert status==200,(status,body)
 assert body['data']['statusCounts']==expected,body
 result={'request':request,'httpStatus':status,'statusCounts':body['data']['statusCounts'],'pagination':body['data']['pagination'],'returned':len(body['data']['complaints'])}
 report.append(result);print(json.dumps(result),flush=True)
Path('artifacts/staff-counts').mkdir(parents=True,exist_ok=True)
Path('artifacts/staff-counts/live-results.json').write_text(json.dumps({'databaseCounts':expected,'checks':report},indent=2))
