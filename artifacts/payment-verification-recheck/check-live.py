from pathlib import Path
import importlib.util,json
spec=importlib.util.spec_from_file_location('api','supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
# Credentials, stored signature and tokens are kept in memory and never printed.
rows=api.db('''SELECT l.request_body,c.phone,s.registration_number,u.user_id
FROM public."SSP_Log_Table" l
JOIN public."SSP_Subscription_Payment" sp ON sp.provider_payment_id=l.request_body->>'razorpay_payment_id'
JOIN public."SSP_Subscription" subscription ON subscription.subscription_id=sp.subscription_id
JOIN public."SSP_Society_User" u ON u.user_id=subscription.owner_society_user
JOIN public."SSP_Contact" c ON c.contact_id=u.contact
JOIN public."SSP_Society" s ON s.society_id=u.society
WHERE l.function_name='verify-razorpay-payment'
 AND l.request_body->>'razorpay_payment_id'='pay_U1BPOsa4tkmIef'
 AND u.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 1;''')
assert len(rows)==1,'Original active payer and callback not found'
a=rows[0];payload=a['request_body'];assert all(payload.get(k) for k in ['razorpay_order_id','razorpay_payment_id','razorpay_signature'])
def snapshot():
 return api.db('''SELECT jsonb_build_object('payment_rows',(SELECT count(*) FROM public."SSP_Payment" WHERE payment_id='pay_U1BPOsa4tkmIef'),'link_rows',(SELECT count(*) FROM public."SSP_Subscription_Payment" WHERE provider='razorpay' AND provider_payment_id='pay_U1BPOsa4tkmIef'),'subscription',(SELECT to_jsonb(s) FROM public."SSP_Subscription" s WHERE subscription_id='1fea95a9-5e66-4d77-8458-a2064822cbdb')) AS snapshot;''')[0]['snapshot']
before=snapshot()
cred={'phoneNumber':str(a['phone']),'registrationNumber':a['registration_number']}
status,otp=api.post('get-otp',cred,record=False);assert status==200 and otp.get('otp'),'Payer OTP request failed'
status,login=api.post('verify-otp',{**cred,'otp':otp['otp']},record=False);assert status==200 and login.get('token'),'Payer authentication failed'
results=[]
for attempt in [1,2]:
 status,result=api.post('verify-razorpay-payment',payload,login['token'],record=False)
 data=result.get('data',{})
 results.append({'attempt':attempt,'http_status':status,'success':result.get('success'),'alreadyProcessed':data.get('alreadyProcessed'),'subscriptionId':data.get('subscriptionId'),'planCode':data.get('planCode'),'message':result.get('message')})
 assert status==200 and data.get('alreadyProcessed') is True,'HTTP callback replay failed'
after=snapshot();assert before==after,'Callback replay must not change payment rows or subscription'
report={'date':'2026-11-17','endpoint':'verify-razorpay-payment','checks':results,'payment_rows_and_subscription_unchanged':True,'new_checkout_or_charge':False}
Path('artifacts/payment-verification-recheck/live-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
