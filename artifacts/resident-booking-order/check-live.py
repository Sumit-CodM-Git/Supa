import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('api',Path('supabase/tests/live-visitor-name-check.py'))
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
rows=api.db('''SELECT r.requested_by AS resident_id,s.registration_number FROM public."SSP_Facility_Booking_Request" r JOIN public."SSP_Society_User" u ON u.user_id=r.requested_by JOIN public."SSP_Society" s ON s.society_id=u.society WHERE lower(trim(r.status))='cancelled' ORDER BY r.created_at DESC LIMIT 1''')
assert rows,'No resident found'
row=rows[0]
status,body=api.post('get-my-facility-bookings',{'societyRegistrationNumber':row['registration_number'],'residentId':row['resident_id']},record=False)
assert status==200,(status,body)
items=body['facilities']
from datetime import datetime
last=None
for item in items:
 date=item.get('createdAt')
 current=datetime.fromisoformat(date.replace('Z','+00:00')).timestamp() if date else float('-inf')
 assert last is None or last>=current, 'Response is out of order'
 last=current
report={'endpoint':'get-my-facility-bookings','http_status':status,'count':len(items),'descending_created_at':True,'first_items':[{k:i.get(k) for k in ['facilityBookingId','facilityName','createdAt','bookingStatus']} for i in items[:5]]}
Path('artifacts/resident-booking-order/live-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
