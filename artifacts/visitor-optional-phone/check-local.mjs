process.on('uncaughtException',e=>{console.error('SQL test failed:',e.message,e.where??'');process.exit(1);});
import {PGlite} from '/private/tmp/ssp-availability-sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync,writeFileSync} from 'node:fs';
const db=new PGlite();
await db.exec(`
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE public."SSP_Subscription_Plan"(plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_code text UNIQUE);
CREATE TABLE public."SSP_Feature"(feature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),feature_code text UNIQUE,feature_name text,description text,is_active boolean DEFAULT true);
CREATE TABLE public."SSP_Plan_Feature"(plan_feature_id uuid DEFAULT gen_random_uuid(),plan_id uuid,feature_id uuid,enabled boolean,UNIQUE(plan_id,feature_id));
CREATE TABLE public."SSP_Society_User"(user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),society uuid,tower uuid,block uuid,unit_flat_number text,deleted_at timestamptz);
CREATE TABLE public."SSP_Non_Society_User"(non_society_user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,phone_number text,role text,visitor_status text,visitor_approval_status text,is_otp_verified boolean DEFAULT false,pre_approved boolean DEFAULT false,hosted_by uuid,society uuid,approver uuid,purpose text,check_in timestamptz,check_out timestamptz,one_time_password text);
CREATE TABLE public."SSP_Notification"(notification_id uuid DEFAULT gen_random_uuid(),title text,message text,notification_type text,recipient_id uuid,recipient_type text,reference_id uuid,reference_table text,extra_data jsonb,action_data jsonb,dedup_key text UNIQUE,delivery_status text DEFAULT 'pending');
INSERT INTO public."SSP_Subscription_Plan"(plan_code) VALUES('FREE'),('STARTER'),('GROWTH'),('PREMIUM');
INSERT INTO public."SSP_Feature"(feature_code) VALUES('VISITOR_APPROVAL'),('VISITOR_OTP');
INSERT INTO public."SSP_Plan_Feature"(plan_id,feature_id,enabled) SELECT p.plan_id,f.feature_id,true FROM public."SSP_Subscription_Plan" p CROSS JOIN public."SSP_Feature" f WHERE f.feature_code='VISITOR_APPROVAL' OR p.plan_code='PREMIUM';
CREATE FUNCTION public.get_entitlements(p_society uuid,p_tower uuid,p_block uuid,p_flat text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_object_agg(f.feature_code,pf.enabled),'{}'::jsonb) FROM public."SSP_Plan_Feature" pf JOIN public."SSP_Subscription_Plan" p ON p.plan_id=pf.plan_id JOIN public."SSP_Feature" f ON f.feature_id=pf.feature_id WHERE p.plan_code=p_flat AND f.is_active;
$$;
CREATE FUNCTION public.create_notification(p_title text,p_message text,p_notification_type text,p_recipient_id uuid,p_recipient_type text,p_sender_id uuid,p_sender_type text,p_reference_table text,p_reference_id uuid,p_society_id uuid,p_navigation_screen text,p_priority text,p_dedup_key text,p_action_data jsonb,p_extra_data jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid;
BEGIN
 INSERT INTO public."SSP_Notification"(title,message,notification_type,recipient_id,recipient_type,reference_table,reference_id,dedup_key,action_data,extra_data)
 VALUES(p_title,p_message,p_notification_type,p_recipient_id,p_recipient_type,p_reference_table,p_reference_id,p_dedup_key,p_action_data,p_extra_data)
 ON CONFLICT(dedup_key) DO NOTHING RETURNING notification_id INTO result;
 RETURN result;
END;$$;
`);
await db.exec(`CREATE FUNCTION public.get_current_plan_code(p_society uuid,p_tower uuid,p_block uuid,p_flat text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE WHEN EXISTS(SELECT 1 FROM public."SSP_Subscription_Plan" WHERE plan_code=p_flat) THEN p_flat ELSE 'FREE' END $$;`);
for(const name of ['fn_visitor_approval_status','fn_preapproved_visitor_arrived','fn_visitor_checked_in','fn_visitor_checked_out'])await db.exec(`CREATE FUNCTION public.${name}(a public."SSP_Non_Society_User",b public."SSP_Non_Society_User") RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;`);
await db.exec(readFileSync('supabase/migrations/20261109150000_gate_visitor_notifications_on_otp.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261110120000_visitor_approval_notification_names.sql','utf8'));
await db.exec('CREATE TRIGGER trg_non_society_user_notifications AFTER INSERT OR UPDATE ON public."SSP_Non_Society_User" FOR EACH ROW EXECUTE FUNCTION public.trg_non_society_user_notifications();');
await db.exec(readFileSync('supabase/migrations/20261116100000_user_availability.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261117160000_optional_phone_nonpremium_walkins.sql','utf8'));
await db.exec(`DO $$
DECLARE plan text;uid uuid;vid uuid;vcount int;vverified boolean;
BEGIN
 FOREACH plan IN ARRAY ARRAY['FREE','STARTER','GROWTH','PREMIUM','NO_SUBSCRIPTION','EXPIRED_PREMIUM','NO_FLAT'] LOOP
  INSERT INTO public."SSP_Society_User"(society,unit_flat_number) VALUES(gen_random_uuid(),CASE WHEN plan='NO_FLAT' THEN NULL ELSE plan END) RETURNING user_id INTO uid;
  INSERT INTO public."SSP_Non_Society_User"(name,phone_number,role,visitor_status,visitor_approval_status,hosted_by,society)
  VALUES('Visitor '||plan,CASE WHEN plan='PREMIUM' THEN '7007990011' ELSE NULL END,'visitor','Pending','pending',uid,(SELECT society FROM public."SSP_Society_User" WHERE user_id=uid)) RETURNING non_society_user_id INTO vid;
  SELECT count(*) INTO vcount FROM public."SSP_Notification" WHERE reference_id=vid;
  ASSERT vcount=CASE WHEN plan='PREMIUM' THEN 0 ELSE 1 END,'Wrong unverified notification count for '||plan;
  SELECT is_otp_verified INTO vverified FROM public."SSP_Non_Society_User" WHERE non_society_user_id=vid;
  ASSERT vverified=false,'Non-OTP plans must not forge verification';
  UPDATE public."SSP_Non_Society_User" SET is_otp_verified=true WHERE non_society_user_id=vid;
  SELECT count(*) INTO vcount FROM public."SSP_Notification" WHERE reference_id=vid;
  ASSERT vcount=1,'Wrong verified notification count for '||plan;
  UPDATE public."SSP_Non_Society_User" SET purpose='retry' WHERE non_society_user_id=vid;
  SELECT count(*) INTO vcount FROM public."SSP_Notification" WHERE reference_id=vid;
  ASSERT vcount=1,'Duplicate notification for '||plan;
  UPDATE public."SSP_Non_Society_User" SET phone_number='7007990022' WHERE non_society_user_id=vid;
  INSERT INTO public."SSP_Notification"(notification_type,recipient_id,recipient_type,reference_id,reference_table)
  VALUES('VISITOR_APPROVAL_REQUEST',uid,'Resident',vid,'SSP_Non_Society_User');
  SELECT count(*) INTO vcount FROM public."SSP_Notification" WHERE reference_id=vid;
  ASSERT vcount=CASE WHEN plan='PREMIUM' THEN 1 ELSE 2 END,'Direct writer bypass for '||plan;
 END LOOP;
 -- Non-Premium pre-approved visitors keep the original OTP requirement.
 SELECT user_id,society INTO uid,vid FROM public."SSP_Society_User" WHERE unit_flat_number='FREE';
 ASSERT NOT public.visitor_phone_requirement_satisfied(jsonb_populate_record(NULL::public."SSP_Non_Society_User",
  jsonb_build_object('hosted_by',uid,'society',vid,'pre_approved',true,'is_otp_verified',false))), 'Pre-approved visitor must retain OTP';
 -- Away must still suppress Starter visitor notifications even though no OTP is required.
 SELECT user_id INTO uid FROM public."SSP_Society_User" WHERE unit_flat_number='STARTER';
 INSERT INTO public."SSP_User_Availability"(user_id,status) VALUES(uid,'away');
 INSERT INTO public."SSP_Non_Society_User"(name,phone_number,role,visitor_status,visitor_approval_status,hosted_by,society)
 VALUES('Away Visitor','7007990033','visitor','Pending','pending',uid,(SELECT society FROM public."SSP_Society_User" WHERE user_id=uid)) RETURNING non_society_user_id INTO vid;
 ASSERT (SELECT delivery_status='failed' AND extra_data->>'suppressedReason'='user_away' FROM public."SSP_Notification" WHERE reference_id=vid),'Away must override visitor entitlement';
END $$;`);
const {rows}=await db.query(`SELECT p.plan_code,f.feature_code,pf.enabled FROM public."SSP_Plan_Feature" pf JOIN public."SSP_Subscription_Plan" p ON p.plan_id=pf.plan_id JOIN public."SSP_Feature" f ON f.feature_id=pf.feature_id ORDER BY p.plan_code,f.feature_code`);
writeFileSync('artifacts/visitor-optional-phone/database-test.json',JSON.stringify({passed:true,engine:'local PostgreSQL/PGlite',productionChanged:false,matrix:rows},null,2));
console.log('Local optional-phone database matrix passed: all four plans, creation, verified transition, no duplicate notifications, direct-writer gating, phone reset, and away override.');
await db.close();
