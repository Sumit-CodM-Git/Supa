"""Verify notification creation inside a rolled-back subtransaction; no push is sent."""
import importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('api',ROOT/'supabase/tests/live-visitor-name-check.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
sql="""
DO $test$
DECLARE v_id uuid:=gen_random_uuid(); v_notifications integer; v_detail text;
BEGIN
  BEGIN
    INSERT INTO public."SSP_Non_Society_User" (non_society_user_id,name,phone_number,role,visitor_status,visitor_approval_status,is_otp_verified,pre_approved,hosted_by,society,approver)
    VALUES(v_id,'Rollback Visitor Diagnostic','7007990001','visitor','Pending','pending',false,false,
      '3096f2ea-dba7-46fa-9b56-00add869b034','74628c82-7e11-4f5a-952a-d062193b3fb9','b5253054-4336-4d5b-bf62-db4d13ae766d');
    UPDATE public."SSP_Non_Society_User" SET is_otp_verified=true WHERE non_society_user_id=v_id;
    SELECT count(*) INTO v_notifications FROM public."SSP_Notification"
      WHERE reference_id=v_id AND notification_type::text='VISITOR_APPROVAL_REQUEST'
      AND recipient_id='3096f2ea-dba7-46fa-9b56-00add869b034';
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Rollback isolated diagnostic',
      DETAIL=json_build_object('notification_count',v_notifications,'test_visitor_id',v_id)::text;
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    GET STACKED DIAGNOSTICS v_detail=PG_EXCEPTION_DETAIL;
    PERFORM set_config('ssp.visitor_diagnostic',v_detail,false);
  END;
END $test$;
SELECT current_setting('ssp.visitor_diagnostic')::jsonb AS notification_test;
"""
rows=api.db(sql)
print(json.dumps(rows,indent=2))
result=rows[0]['notification_test']
if isinstance(result,str):result=json.loads(result)
assert result['notification_count']==1,'Visitor OTP transition failed to create a resident notification'
vid=result['test_visitor_id']
remaining=api.db(f'SELECT (SELECT count(*) FROM public."SSP_Non_Society_User" WHERE non_society_user_id=\'{vid}\') AS visitors,(SELECT count(*) FROM public."SSP_Notification" WHERE reference_id=\'{vid}\') AS notifications;')[0]
assert remaining=={'visitors':0,'notifications':0},remaining
p=ROOT/'artifacts/security-visitor-diagnostic/result.json';report=json.loads(p.read_text());report['rollback_notification_test']=result;report['rollback_cleanup_verified']=remaining;p.write_text(json.dumps(report,indent=2))
print('Verified: OTP transition creates one resident approval notification; test visitor/notification rolled back, no delivery committed.')
