import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path('supabase/tests/live-visitor-name-check.py'));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
request='56259ad0-a80f-4585-8f2c-ae32b9a5a77a';resident='3096f2ea-dba7-46fa-9b56-00add869b034';payment='49e33251-070e-43ca-a237-a0c6aca92b89'
rows=api.db(f'''SELECT to_jsonb(r) AS request,to_jsonb(p) AS payment FROM public."SSP_Facility_Booking_Request" r JOIN public."SSP_Payment" p ON p.pay_rec_id=r.payment WHERE r.request_id='{request}' AND r.requested_by='{resident}' AND r.payment='{payment}' AND lower(trim(r.status))='waiting_payment' AND lower(trim(p.payment_status))='unpaid' AND p.receipt_url IS NULL AND NOT EXISTS(SELECT 1 FROM public."SSP_Document" d WHERE d.payment=p.pay_rec_id)''')
if not rows:raise RuntimeError('Booking changed; no repair performed')
Path('artifacts/facility-cancellation-latest/backup.json').write_text(json.dumps(rows,indent=2))
result=api.db(f"SELECT public.cancel_resident_facility_booking('{request}','{resident}',true) AS removed")
assert result[0]['removed']
state=api.db(f'''SELECT (SELECT count(*) FROM public."SSP_Facility_Booking_Request" WHERE request_id='{request}') AS request_count,(SELECT count(*) FROM public."SSP_Facility_Booking" WHERE payment='{payment}') AS booking_count,(SELECT count(*) FROM public."SSP_Payment" WHERE pay_rec_id='{payment}') AS payment_count''')[0]
assert all(v==0 for v in state.values()),state
Path('artifacts/facility-cancellation-latest/repair-result.json').write_text(json.dumps(state,indent=2));print(json.dumps(state))
