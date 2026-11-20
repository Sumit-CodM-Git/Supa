-- Execute after the migration inside a transaction, then ROLLBACK.
-- No webhook or push work from this test may be committed.
DO $test$
DECLARE
  sample public."SSP_Notification"%ROWTYPE;
  v_user uuid;
  n1 uuid := gen_random_uuid();
  n2 uuid := gen_random_uuid();
  n3 uuid := gen_random_uuid();
  saved public."SSP_Notification"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT sample FROM public."SSP_Notification" WHERE recipient_id IS NOT NULL LIMIT 1;
  v_user := sample.recipient_id;
  INSERT INTO public."SSP_User_Availability"(user_id,status) VALUES(v_user,'away');
  INSERT INTO public."SSP_Notification"
  SELECT (jsonb_populate_record(NULL::public."SSP_Notification", to_jsonb(sample) || jsonb_build_object(
    'notification_id',n1,'delivery_status','pending','dedup_key',NULL,
    'reference_table','Availability_Diagnostic','reference_id',n1,'extra_data','{}'::jsonb))).*;
  SELECT * INTO STRICT saved FROM public."SSP_Notification" WHERE notification_id=n1;
  ASSERT saved.delivery_status::text='failed' AND saved.extra_data->>'suppressedReason'='user_away', 'Away notification was not suppressed';

  UPDATE public."SSP_User_Availability" SET status='inactive' WHERE user_id=v_user;
  INSERT INTO public."SSP_Notification"
  SELECT (jsonb_populate_record(NULL::public."SSP_Notification", to_jsonb(sample) || jsonb_build_object(
    'notification_id',n2,'delivery_status','pending','dedup_key',NULL,
    'reference_table','Availability_Diagnostic','reference_id',n2,'extra_data','{}'::jsonb))).*;
  ASSERT (SELECT delivery_status::text='pending' FROM public."SSP_Notification" WHERE notification_id=n2), 'Inactive must allow notifications';

  UPDATE public."SSP_User_Availability" SET status='away' WHERE user_id=v_user;
  ASSERT (SELECT delivery_status::text='failed' FROM public."SSP_Notification" WHERE notification_id=n2), 'Away must suppress pending work';
  UPDATE public."SSP_Notification" SET delivery_status='pending' WHERE notification_id=n2;
  ASSERT (SELECT delivery_status::text='failed' FROM public."SSP_Notification" WHERE notification_id=n2), 'Retry must not bypass away';

  UPDATE public."SSP_User_Availability" SET status='active' WHERE user_id=v_user;
  ASSERT (SELECT delivery_status::text='failed' FROM public."SSP_Notification" WHERE notification_id=n1), 'Reactivation must not replay suppressed work';
  INSERT INTO public."SSP_Notification"
  SELECT (jsonb_populate_record(NULL::public."SSP_Notification", to_jsonb(sample) || jsonb_build_object(
    'notification_id',n3,'delivery_status','pending','dedup_key',NULL,
    'reference_table','Availability_Diagnostic','reference_id',n3,'extra_data','{}'::jsonb))).*;
  ASSERT (SELECT delivery_status::text='pending' FROM public."SSP_Notification" WHERE notification_id=n3), 'Active must allow notifications';
  ASSERT NOT has_table_privilege('authenticated','public."SSP_User_Availability"','UPDATE'), 'Clients must not edit other users';
  ASSERT NOT has_table_privilege('anon','public."SSP_User_Availability"','SELECT'), 'Anonymous status access must be blocked';
  BEGIN
    INSERT INTO public."SSP_User_Availability"(user_id,status) VALUES(gen_random_uuid(),'invalid');
    RAISE EXCEPTION 'Invalid availability was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;
