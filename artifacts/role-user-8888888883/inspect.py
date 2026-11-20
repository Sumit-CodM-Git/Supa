import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
queries={
'columns':"SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('SSP_Contact','SSP_Society_User','SSP_Non_Society_User','SSP_Society_Staff') ORDER BY table_name,ordinal_position",
'constraints':"SELECT conrelid::regclass::text AS table_name,conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('public.\"SSP_Contact\"'::regclass,'public.\"SSP_Society_User\"'::regclass,'public.\"SSP_Non_Society_User\"'::regclass) OR (contype='f' AND confrelid IN ('public.\"SSP_Contact\"'::regclass,'public.\"SSP_Society_User\"'::regclass,'public.\"SSP_Non_Society_User\"'::regclass))",
'contacts':'''SELECT contact_id,name,phone FROM public."SSP_Contact" WHERE regexp_replace(phone::text,'[^0-9]','','g') IN ('8888888883','918888888883')''',
'society_users':'''SELECT u.user_id,u.contact,u.role,u.society,u.unit_flat_number,u.deleted_at FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact WHERE regexp_replace(c.phone::text,'[^0-9]','','g') IN ('8888888883','918888888883')''',
'non_society_users':'''SELECT non_society_user_id,name,phone_number,role,society FROM public."SSP_Non_Society_User" WHERE regexp_replace(phone_number::text,'[^0-9]','','g') IN ('8888888883','918888888883')''',
'society':'''SELECT society_id,registration_number FROM public."SSP_Society" WHERE registration_number='GZB-1234-ab' ''',
'auth':'''SELECT id,phone FROM auth.users WHERE regexp_replace(phone::text,'[^0-9]','','g') IN ('8888888883','918888888883')'''
}
report={k:api.db(q) for k,q in queries.items()};Path('artifacts/role-user-8888888883/inspection.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
