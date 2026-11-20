-- No push is sent: disable only the delivery webhook within this transaction.
-- ROLLBACK restores the webhook and removes all fixtures and notifications.
BEGIN;
ALTER TABLE public."SSP_Notification" DISABLE TRIGGER "SSP_Notification";
DO $$
DECLARE
  v_host uuid;
  v_society uuid;
  v_otp_first uuid;
  v_named_first uuid;
  v_unverified uuid;
  v_preapproved uuid;
  v_count integer;
  v_verified boolean;
BEGIN
  SELECT user_id,society INTO v_host,v_society FROM public."SSP_Society_User" WHERE society IS NOT NULL LIMIT 1;
  INSERT INTO public."SSP_Non_Society_User"
    (hosted_by,society,name,phone_number,role,visitor_status,pre_approved,is_otp_verified)
    VALUES(v_host,v_society,'Unknown Visitor','000000000021','visitor','otp_pending',false,false)
    RETURNING non_society_user_id INTO v_otp_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_otp_first;
  IF v_count<>0 THEN RAISE EXCEPTION 'Unverified draft must not notify'; END IF;
  UPDATE public."SSP_Non_Society_User" SET is_otp_verified=true,visitor_status='Pending',visitor_approval_status='pending' WHERE non_society_user_id=v_otp_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_otp_first AND recipient_type::text='Resident';
  IF v_count<>0 THEN RAISE EXCEPTION 'Unnamed verified visitor must wait for details'; END IF;
  UPDATE public."SSP_Non_Society_User" SET name='TEST_OTP_FIRST' WHERE non_society_user_id=v_otp_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification"
    WHERE reference_id=v_otp_first AND message='TEST_OTP_FIRST is waiting for your approval.'
      AND action_data->>'visitorName'='TEST_OTP_FIRST' AND extra_data->>'visitorName'='TEST_OTP_FIRST';
  IF v_count<>1 THEN RAISE EXCEPTION 'Named verified visitor must notify with its real name'; END IF;
  UPDATE public."SSP_Non_Society_User" SET name='TEST_CORRECTED_NAME' WHERE non_society_user_id=v_otp_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification"
    WHERE reference_id=v_otp_first AND message='TEST_CORRECTED_NAME is waiting for your approval.'
      AND action_data->>'visitorName'='TEST_CORRECTED_NAME' AND extra_data->>'visitorName'='TEST_CORRECTED_NAME';
  IF v_count<>1 THEN RAISE EXCEPTION 'Existing notification must refresh when name changes'; END IF;
  UPDATE public."SSP_Non_Society_User" SET purpose='Changed details' WHERE non_society_user_id=v_otp_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_otp_first AND recipient_type::text='Resident';
  IF v_count<>1 THEN RAISE EXCEPTION 'Ordinary updates must not repeat notification'; END IF;
  UPDATE public."SSP_Non_Society_User" SET phone_number='000000000022' WHERE non_society_user_id=v_otp_first;
  SELECT is_otp_verified INTO v_verified FROM public."SSP_Non_Society_User" WHERE non_society_user_id=v_otp_first;
  IF v_verified IS DISTINCT FROM false THEN RAISE EXCEPTION 'Phone change must reset verification'; END IF;

  INSERT INTO public."SSP_Non_Society_User"
    (hosted_by,society,name,phone_number,role,visitor_status,visitor_approval_status,pre_approved,is_otp_verified)
    VALUES(v_host,v_society,'TEST_NAMED_FIRST','000000000023','visitor','Pending','pending',false,false)
    RETURNING non_society_user_id INTO v_named_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_named_first;
  IF v_count<>0 THEN RAISE EXCEPTION 'Named unverified visitor must not notify'; END IF;
  UPDATE public."SSP_Non_Society_User" SET one_time_password='000000' WHERE non_society_user_id=v_named_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_named_first;
  IF v_count<>0 THEN RAISE EXCEPTION 'OTP generation must not notify'; END IF;
  UPDATE public."SSP_Non_Society_User" SET one_time_password=NULL,is_otp_verified=true WHERE non_society_user_id=v_named_first;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_named_first AND recipient_type::text='Resident';
  IF v_count<>1 THEN RAISE EXCEPTION 'Verification must release the named visitor notification'; END IF;

  INSERT INTO public."SSP_Non_Society_User"
    (hosted_by,society,name,role,visitor_status,pre_approved,is_otp_verified)
    VALUES(v_host,v_society,'TEST_UNVERIFIED','visitor','Pending',false,false)
    RETURNING non_society_user_id INTO v_unverified;
  UPDATE public."SSP_Non_Society_User" SET visitor_status='Inside',check_in=now() WHERE non_society_user_id=v_unverified;
  UPDATE public."SSP_Non_Society_User" SET visitor_status='Outside',check_out=now() WHERE non_society_user_id=v_unverified;
  INSERT INTO public."SSP_Notification" (title,message,notification_type,recipient_type,recipient_id,reference_table,reference_id)
    VALUES('Test','Test','VISITOR_APPROVAL_REQUEST','Resident',v_host,'SSP_Non_Society_User',v_unverified);
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_unverified;
  IF v_count<>0 THEN RAISE EXCEPTION 'Unverified visitor notifications must be blocked for all writers'; END IF;

  INSERT INTO public."SSP_Non_Society_User"
    (hosted_by,society,name,role,visitor_status,visitor_approval_status,pre_approved,is_otp_verified,approver)
    VALUES(v_host,v_society,'TEST_PREAPPROVED','visitor','expected','approved',true,false,v_host)
    RETURNING non_society_user_id INTO v_preapproved;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_preapproved;
  IF v_count<>0 THEN RAISE EXCEPTION 'Preapproved visitor must verify before arrival notification'; END IF;
  UPDATE public."SSP_Non_Society_User" SET is_otp_verified=true WHERE non_society_user_id=v_preapproved;
  SELECT count(*) INTO v_count FROM public."SSP_Notification" WHERE reference_id=v_preapproved AND notification_type::text='VISITOR_ARRIVED';
  IF v_count<>1 THEN RAISE EXCEPTION 'Verified preapproved arrival must notify once'; END IF;
END;
$$;
ROLLBACK;
