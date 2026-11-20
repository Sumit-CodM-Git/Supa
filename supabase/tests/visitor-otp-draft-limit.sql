BEGIN;
DO $$
DECLARE
  v_host uuid;
  v_society uuid;
  v_draft uuid;
  v_blocked boolean:=false;
BEGIN
  SELECT user_id,society INTO v_host,v_society FROM public."SSP_Society_User" WHERE society IS NOT NULL LIMIT 1;
  INSERT INTO public."SSP_Non_Society_User" (hosted_by,society,name,phone_number,role,visitor_status)
    VALUES(v_host,v_society,'Unknown Visitor','000000000011','visitor','otp_pending') RETURNING non_society_user_id INTO v_draft;
  BEGIN
    INSERT INTO public."SSP_Non_Society_User" (hosted_by,society,name,phone_number,role,visitor_status)
      VALUES(v_host,v_society,'Unknown Visitor','000000000011','visitor','otp_pending');
  EXCEPTION WHEN unique_violation THEN v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Duplicate OTP draft must be rejected'; END IF;
  UPDATE public."SSP_Non_Society_User" SET name='TEST_COMPLETED_VISITOR',visitor_status='Pending' WHERE non_society_user_id=v_draft;
  INSERT INTO public."SSP_Non_Society_User" (hosted_by,society,name,phone_number,role,visitor_status)
    VALUES(v_host,v_society,'Unknown Visitor','000000000011','visitor','otp_pending');
END;
$$;
ROLLBACK;
