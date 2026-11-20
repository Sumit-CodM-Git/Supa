BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='25s';
ALTER TABLE public."SSP_Notification" DISABLE TRIGGER "SSP_Notification";
DO $$
DECLARE plan text; host public."SSP_Society_User"%ROWTYPE; visit public."SSP_Non_Society_User"%ROWTYPE; n int;
BEGIN
 FOREACH plan IN ARRAY ARRAY['FREE','PREMIUM'] LOOP
  SELECT u.* INTO host FROM public."SSP_Society_User" u
  WHERE u.deleted_at IS NULL AND u.society IS NOT NULL
   AND public.get_current_plan_code(u.society,u.tower,u.block,u.unit_flat_number)=plan
   AND NOT EXISTS(SELECT 1 FROM public."SSP_User_Availability" a WHERE a.user_id=u.user_id AND a.status='away') LIMIT 1;
  ASSERT FOUND,'No available live resident for '||plan;
  INSERT INTO public."SSP_Non_Society_User"(name,phone_number,role,visitor_status,visitor_approval_status,hosted_by,society,pre_approved,is_otp_verified)
  VALUES('TEST_OTP_PLAN_ROLLBACK','000000009917','visitor','Pending','pending',host.user_id,host.society,false,false) RETURNING * INTO visit;
  ASSERT public.visitor_phone_requirement_satisfied(visit)=(plan<>'PREMIUM'),'Incorrect phone requirement for '||plan;
  SELECT count(*) INTO n FROM public."SSP_Notification" WHERE reference_id=visit.non_society_user_id AND recipient_type::text='Resident';
  ASSERT n=CASE WHEN plan='PREMIUM' THEN 0 ELSE 1 END,'Incorrect initial resident notification count for '||plan;
  IF plan='FREE' THEN
   ASSERT EXISTS(SELECT 1 FROM public."SSP_Notification" WHERE reference_id=visit.non_society_user_id
    AND recipient_id=host.user_id AND recipient_type::text='Resident'
    AND extra_data->>'phoneNumber'=visit.phone_number), 'Visitor phone missing from resident notification';
  END IF;
  ASSERT visit.is_otp_verified=false,'Bypass must not forge verification';
  UPDATE public."SSP_Non_Society_User" SET is_otp_verified=true WHERE non_society_user_id=visit.non_society_user_id;
  SELECT count(*) INTO n FROM public."SSP_Notification" WHERE reference_id=visit.non_society_user_id AND recipient_type::text='Resident';
  ASSERT n=1,'Verified visitor must have exactly one resident notification for '||plan;
  UPDATE public."SSP_Non_Society_User" SET purpose='retry' WHERE non_society_user_id=visit.non_society_user_id;
  SELECT count(*) INTO n FROM public."SSP_Notification" WHERE reference_id=visit.non_society_user_id AND recipient_type::text='Resident';
  ASSERT n=1,'Retry duplicated notification for '||plan;
  UPDATE public."SSP_Non_Society_User" SET phone_number='000000009918' WHERE non_society_user_id=visit.non_society_user_id RETURNING * INTO visit;
  ASSERT visit.is_otp_verified=false,'Phone change must reset verification';
  ASSERT public.visitor_phone_requirement_satisfied(visit)=(plan<>'PREMIUM'),'Incorrect phone reset requirement';
 END LOOP;
END $$;
ROLLBACK;
SELECT true AS passed,'Non-Premium resident notification contains visitor phoneNumber; existing OTP rule checks passed' AS checks, true AS fixtures_rolled_back;
