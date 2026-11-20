import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path('supabase/tests/live-visitor-name-check.py'));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
request='6747f7aa-3ccb-465f-ab22-35713acfecc7';resident='3096f2ea-dba7-46fa-9b56-00add869b034';payment='4d710885-31de-499c-a480-90739d50c226'
rows=api.db(f'''SELECT to_jsonb(r) AS request,to_jsonb(p) AS payment FROM public."SSP_Facility_Booking_Request" r JOIN public."SSP_Payment" p ON p.pay_rec_id=r.payment WHERE r.request_id='{request}' AND r.requested_by='{resident}' AND r.payment='{payment}' AND lower(trim(r.status))='waiting_payment' AND lower(trim(p.payment_status))='unpaid' ''')
if not rows:raise RuntimeError('Original cancelled booking changed; no repair performed')
Path('artifacts/facility-cancel-dispatch/latest-cancelled-booking-backup.json').write_text(json.dumps(rows,indent=2)+'\n')
result=api.db(f"SELECT public.cancel_resident_facility_booking('{request}','{resident}',true) AS removed")
assert result[0]['removed']
state=api.db(f'''SELECT (SELECT count(*) FROM public."SSP_Facility_Booking_Request" WHERE request_id='{request}') AS request_count,(SELECT count(*) FROM public."SSP_Facility_Booking" WHERE payment='{payment}') AS booking_count,(SELECT payment_status FROM public."SSP_Payment" WHERE pay_rec_id='{payment}') AS payment_status''')[0]
assert state=={'request_count':0,'booking_count':0,'payment_status':'cancelled'},state
Path('artifacts/facility-cancel-dispatch/latest-repair-result.json').write_text(json.dumps({'request_id':request,**state},indent=2)+'\n');print(json.dumps(state))
