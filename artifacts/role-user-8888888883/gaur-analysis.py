exec(open('artifacts/role-user-8888888883/analyze-details.py').read().split("q='''")[0])
q='''SELECT jsonb_build_object(
'society',(SELECT to_jsonb(s) FROM public."SSP_Society" s WHERE society_id='74628c82-7e11-4f5a-952a-d062193b3fb9'),
'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type)) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('SSP_Tower','SSP_Block','SSP_Flat_Type')),
'blocks',(SELECT jsonb_agg(to_jsonb(b)) FROM public."SSP_Block" b WHERE society='74628c82-7e11-4f5a-952a-d062193b3fb9'),
'flat_contexts',(SELECT jsonb_agg(x) FROM (SELECT tower,block,unit_flat_number,flat_type_id,count(*) AS residents FROM public."SSP_Society_User" WHERE society='74628c82-7e11-4f5a-952a-d062193b3fb9' AND deleted_at IS NULL AND unit_flat_number IS NOT NULL GROUP BY tower,block,unit_flat_number,flat_type_id ORDER BY unit_flat_number LIMIT 30) x)
) AS analysis'''
r=api.db(q)[0]['analysis'];Path('artifacts/role-user-8888888883/gaur-analysis.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
