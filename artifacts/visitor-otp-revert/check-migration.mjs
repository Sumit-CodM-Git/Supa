process.on('uncaughtException',e=>{console.error('SQL test failed:',e.message,e.where??'');process.exit(1);});
import {PGlite} from '/private/tmp/ssp-availability-sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync,writeFileSync} from 'node:fs';
const db=new PGlite();
await db.exec(`
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE public."SSP_Subscription_Plan"(plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_code text UNIQUE);
CREATE TABLE public."SSP_Feature"(feature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),feature_code text UNIQUE,feature_name text,description text,is_active boolean DEFAULT true);
CREATE TABLE public."SSP_Plan_Feature"(plan_feature_id uuid DEFAULT gen_random_uuid(),plan_id uuid,feature_id uuid,enabled boolean,config jsonb,created_at timestamptz,updated_at timestamptz,UNIQUE(plan_id,feature_id));
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

const snapshot=JSON.parse(readFileSync('artifacts/visitor-plan-rules/deployment/before.json','utf8'));
await db.exec('DELETE FROM public."SSP_Plan_Feature"; DELETE FROM public."SSP_Feature"; DELETE FROM public."SSP_Subscription_Plan";');
const ids=[...new Set(snapshot.plan_features.map(x=>x.plan_id))];
for(let i=0;i<ids.length;i++)await db.query('INSERT INTO public."SSP_Subscription_Plan"(plan_id,plan_code) VALUES($1,$2)',[ids[i],['FREE','STARTER','GROWTH','PREMIUM'][i]]);
for(const f of snapshot.features)await db.query('INSERT INTO public."SSP_Feature"(feature_id,feature_code,feature_name,description,is_active) VALUES($1,$2,$3,$4,$5)',[f.feature_id,f.feature_code,f.feature_name,f.description,f.is_active]);
for(const row of snapshot.plan_features)await db.query('INSERT INTO public."SSP_Plan_Feature" SELECT * FROM jsonb_populate_record(NULL::public."SSP_Plan_Feature",$1::jsonb)',[JSON.stringify(row)]);
await db.exec(readFileSync('supabase/migrations/20261116110000_plan_aware_visitors.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261116140000_revert_visitor_plan_rules.sql','utf8'));
const {rows}=await db.query('SELECT * FROM public."SSP_Plan_Feature"');
if(rows.length!==snapshot.plan_features.length)throw Error('Plan rows not restored');
await db.exec(`DO $$ DECLARE uid uuid;vid uuid;n int; BEGIN
 INSERT INTO public."SSP_Society_User"(society,unit_flat_number) VALUES(gen_random_uuid(),'FREE') RETURNING user_id INTO uid;
 INSERT INTO public."SSP_Non_Society_User"(name,phone_number,role,visitor_status,visitor_approval_status,hosted_by) VALUES('Rollback test','7007990011','visitor','Pending','pending',uid) RETURNING non_society_user_id INTO vid;
 ASSERT (SELECT count(*)=0 FROM public."SSP_Notification" WHERE reference_id=vid),'Unverified visitor must not notify';
 UPDATE public."SSP_Non_Society_User" SET is_otp_verified=true WHERE non_society_user_id=vid;
 ASSERT (SELECT count(*)=1 FROM public."SSP_Notification" WHERE reference_id=vid),'Verified visitor should notify once';
 UPDATE public."SSP_Non_Society_User" SET purpose='retry' WHERE non_society_user_id=vid;
 ASSERT (SELECT count(*)=1 FROM public."SSP_Notification" WHERE reference_id=vid),'No duplicate notification';
 END $$;`);
console.log('Rollback migration passed: previous feature rows restored, verified-only notifications and deduplication preserved. Local PostgreSQL; no production writes.');await db.close();
