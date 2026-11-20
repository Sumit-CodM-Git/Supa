exec(open('artifacts/role-user-8888888883/inspect.py').read().split('queries={')[0])
x=json.loads(Path('artifacts/role-user-8888888883/inspection.json').read_text());ids=[r['user_id'] for r in x['society_users']]+[r['contact_id'] for r in x['contacts']]
cols=api.db("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('uuid','text','character varying')")
parts=[]
for c in cols:
 if c['data_type']!='uuid' and not any(k in c['column_name'] for k in ['user','owner','recipient','sender','contact','created_by','uploaded_by']):continue
 q='SELECT '+"'"+c['table_name']+"' AS table_name,'"+c['column_name']+"' AS column_name,count(*) AS count FROM public.\""+c['table_name']+'" WHERE "'+c['column_name']+'"::text IN ('+','.join("'"+i+"'" for i in ids)+') HAVING count(*)>0';parts.append(q)
report={'dependencies':api.db(' UNION ALL '.join(parts)), 'auth':api.db("SELECT id,email,raw_user_meta_data->>'user_id' AS linked_user FROM auth.users WHERE email='8888888883@temp.user' OR raw_user_meta_data->>'user_id' IN ("+','.join("'"+i+"'" for i in ids)+")"),'staff':api.db('''SELECT staff_id,staff_name,phone_number FROM public."SSP_Society_Staff" WHERE phone_number='8888888883' '''),'triggers':api.db("SELECT event_object_table,trigger_name,event_manipulation,action_statement FROM information_schema.triggers WHERE event_object_table IN ('SSP_Contact','SSP_Society_User','SSP_Non_Society_User')"),'picklists':api.db('''SELECT * FROM public."SSP_Picklist_Config" WHERE field_name IN ('role','user_ownership_type','agent_availability_status','security_guard_status')''')}
Path('artifacts/role-user-8888888883/dependencies.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
