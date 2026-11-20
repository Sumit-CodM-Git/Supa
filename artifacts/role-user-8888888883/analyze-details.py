import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
q='''SELECT jsonb_build_object(
 'contact',(SELECT to_jsonb(c) FROM public."SSP_Contact" c WHERE contact_id='9c1e7831-4f7a-4fca-8408-093274f75be7'),
 'account',(SELECT to_jsonb(u)-'one_time_password_otp' FROM public."SSP_Society_User" u WHERE user_id='120138e3-20d8-4e65-9196-c9e7062c8faa'),
 'vendor',(SELECT to_jsonb(v)-'one_time_password'-'verification_pin' FROM public."SSP_Non_Society_User" v WHERE non_society_user_id='9d748c14-27b9-4bd3-9615-862facb21beb'),
 'picklists',(SELECT jsonb_agg(to_jsonb(p)) FROM public."SSP_Picklist_Config" p WHERE is_active AND table_name IN ('SSP_Contact','SSP_Society_User','SSP_Non_Society_User')),
 'checks',(SELECT jsonb_agg(pg_get_constraintdef(oid)) FROM pg_constraint WHERE contype='c' AND conrelid IN ('public."SSP_Contact"'::regclass,'public."SSP_Society_User"'::regclass,'public."SSP_Non_Society_User"'::regclass))
) AS analysis'''
r=api.db(q)[0]['analysis'];Path('artifacts/role-user-8888888883/details-analysis.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
