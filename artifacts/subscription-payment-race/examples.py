import json
UUID='00000000-0000-4000-8000-000000000001'
STAMP='2026-11-17T08:55:28Z'
def jsonc(obj):
    lines=json.dumps(obj,indent=2).splitlines()
    for i,line in enumerate(lines):
        if '"paymentPurpose":' in line: lines[i]+=' // new, renewal, upgrade'
        if '"planCode":' in line: lines[i]+=' // Actual plan_code from SSP_Subscription_Plan configuration'
        if '"event":' in line: lines[i]+=' // payment.captured, payment.failed, refund.processed, refund.failed; other provider event types are acknowledged'
    return '\n'.join(lines)
HEADER='JSONC illustrative examples. Remove // comments before sending JSON. Replace identifiers with actual user/provider values.\n\n'
verify_req=HEADER+jsonc({'razorpay_order_id':'order_example','razorpay_payment_id':'pay_example','razorpay_signature':'<HMAC_SHA256_ORDER_ID_PIPE_PAYMENT_ID>'})
common={'success':True,'subscriptionId':UUID,'planCode':'PREMIUM','startDate':STAMP,'endDate':'2026-12-17T08:55:28Z'}
verify_resp=HEADER+'NEW / RENEWAL / UPGRADE — HTTP 200 (paymentPurpose identifies the operation):\n'+jsonc({'success':True,'data':{**common,'paymentPurpose':'new'}})+'\n\nALREADY PROCESSED — HTTP 200 (including a callback completed by the webhook):\n'+jsonc({'success':True,'data':{**common,'alreadyProcessed':True}})+'\n\nINVALID SIGNATURE — HTTP 400:\n'+jsonc({'success':False,'error':'BAD_REQUEST','message':'Invalid payment signature','details':None,'errorResponse':{'errorCode':'BAD_REQUEST','message':'Invalid payment signature','timestamp':STAMP}})+'\n\nProvider/RPC failures retain the generic errorResponse helper wrapper: '+json.dumps({'success':False,'error':'ERROR','message':'<failure details>'})
requests=[]
for event_type in ['payment.captured','payment.failed','refund.processed','refund.failed','order.paid']:
    if event_type.startswith('refund.'):
        entity={'id':'rfnd_example','entity':'refund','payment_id':'pay_example','amount':19900,'currency':'INR','status':event_type.split('.')[1]}
        payload={'refund':{'entity':entity}};contains=['refund']
    else:
        entity={'id':'pay_example','entity':'payment','amount':19900,'currency':'INR','status':'failed' if event_type=='payment.failed' else 'captured','order_id':'order_example','captured':event_type!='payment.failed','email':'resident@example.com','contact':'9000000000','notes':{'user_id':UUID,'flat_number':'101'},'error_code':'BAD_REQUEST_ERROR' if event_type=='payment.failed' else None,'error_description':'Illustrative failure' if event_type=='payment.failed' else None,'error_source':'customer' if event_type=='payment.failed' else None,'error_step':'payment_authentication' if event_type=='payment.failed' else None,'error_reason':'payment_failed' if event_type=='payment.failed' else None,'created_at':1794905728}
        payload={'payment':{'entity':entity}};contains=['payment']
        if event_type=='order.paid':
            contains.append('order');payload['order']={'entity':{'id':'order_example','entity':'order','amount':19900,'amount_paid':19900,'amount_due':0,'currency':'INR','status':'paid','attempts':1,'notes':{'plan_code':'PREMIUM'},'created_at':1794905700}}
    body={'entity':'event','account_id':'acc_example','event':event_type,'contains':contains,'payload':payload,'created_at':1794905728}
    requests.append(event_type.upper()+'\n'+jsonc(body))
webhook_req=HEADER+'Send the exact provider JSON bytes signed by x-razorpay-signature. Provider event ID comes from x-razorpay-event-id, event.id, or event type plus entity ID.\n\n'+'\n\n'.join(requests)
webhook_resp=HEADER+'\n\n'.join(label+'\n'+jsonc({'received':status==200,'message':message}) for label,status,message in [('PROCESSED — HTTP 200',200,'Event received'),('REPLAY — HTTP 200',200,'Already processed'),('BUSY EVENT — HTTP 503; provider should retry',503,'Event processing in progress; retry'),('INVALID SIGNATURE — HTTP 401',401,'Invalid signature'),('INVALID JSON — HTTP 400',400,'Invalid JSON'),('PROCESSING FAILURE — HTTP 500; provider should retry',500,'Processing failed; retry')])
EXAMPLES={'verify-razorpay-payment':{'request':verify_req,'response':verify_resp},'razorpay-webhook':{'request':webhook_req,'response':webhook_resp}}
