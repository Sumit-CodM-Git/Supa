import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
c={'phoneNumber':'8888888883','registrationNumber':'GZB-1234-ab'}
s,o=api.post('get-otp',c,record=False);assert s==200
s,l=api.post('verify-otp',{**c,'otp':o['otp']},record=False);assert s==200
s,r=api.post('get-profile',{**c,'role':'resident'},l['token'],record=False);assert s==200,(s,r.get('message'))
Path('artifacts/role-user-8888888883/gaur-profile-response.json').write_text(json.dumps({'http_status':s,'response':r},indent=2));print(json.dumps({'http_status':s,'response':r},indent=2))
