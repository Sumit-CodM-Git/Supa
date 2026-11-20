BEGIN;
-- Restore notification functions captured before today's visitor plan changes.
CREATE OR REPLACE FUNCTION public.block_unverified_visitor_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_verified boolean;
BEGIN
  IF NEW.reference_table='SSP_Non_Society_User' AND NEW.recipient_type::text='Resident' THEN
    SELECT coalesce(is_otp_verified,false) INTO v_verified
    FROM public."SSP_Non_Society_User" WHERE non_society_user_id=NEW.reference_id AND lower(role)='visitor';
    IF FOUND AND NOT v_verified THEN RETURN NULL; END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_non_society_user_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_was_ready boolean:=false;
BEGIN
  IF lower(coalesce(NEW.role,'')) <> 'visitor' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    v_was_ready:=public.visitor_ready_for_resident_approval(OLD);
    -- Resident decisions still notify security using the existing behavior.
    PERFORM public.fn_visitor_approval_status(NEW,OLD);
  END IF;

  IF coalesce(NEW.is_otp_verified,false) THEN
    IF public.visitor_ready_for_resident_approval(NEW) AND NOT v_was_ready THEN
      -- Existing helper is insert-oriented; invoke it once when the visit becomes ready.
      PERFORM public.fn_notify_resident(NEW,NULL);
    END IF;
    IF TG_OP='INSERT' THEN
      IF coalesce(NEW.pre_approved,false) AND NEW.approver IS NOT NULL THEN
        PERFORM public.fn_preapproved_visitor_arrived(NEW,NULL);
      END IF;
    ELSE
      IF coalesce(NEW.pre_approved,false) AND coalesce(OLD.pre_approved,false)
         AND NEW.approver IS NOT NULL
         AND (NOT coalesce(OLD.is_otp_verified,false) OR OLD.approver IS NULL) THEN
        PERFORM public.fn_preapproved_visitor_arrived(NEW,NULL);
      END IF;
      PERFORM public.fn_visitor_checked_in(NEW,OLD);
      PERFORM public.fn_visitor_checked_out(NEW,OLD);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_non_society_user_notifications(): %',SQLERRM;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.visitor_ready_for_resident_approval(p_visitor "SSP_Non_Society_User")
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(p_visitor.is_otp_verified,false)
    AND lower(coalesce(p_visitor.role,''))='visitor'
    AND p_visitor.hosted_by IS NOT NULL
    AND NOT coalesce(p_visitor.pre_approved,false)
    AND trim(coalesce(p_visitor.phone_number,''))<>''
    AND lower(trim(coalesce(p_visitor.name,''))) NOT IN ('','unknown','unknown visitor','unknown user')
    AND lower(coalesce(p_visitor.visitor_status,''))='pending'
    AND lower(coalesce(p_visitor.visitor_approval_status,'pending'))='pending';
$function$
;
DROP FUNCTION IF EXISTS public.visitor_phone_requirement_satisfied(public."SSP_Non_Society_User");
DELETE FROM public."SSP_Plan_Feature" WHERE feature_id IN (SELECT feature_id FROM public."SSP_Feature" WHERE feature_code IN ('VISITOR_APPROVAL','VISITOR_OTP','VISITOR_TAB','VISITOR_DASHBOARD_CARD')) AND plan_id IN (SELECT plan_id FROM public."SSP_Subscription_Plan" WHERE plan_code IN ('FREE','STARTER','GROWTH','PREMIUM'));
INSERT INTO public."SSP_Plan_Feature" SELECT * FROM jsonb_populate_record(NULL::public."SSP_Plan_Feature", $snapshot${"config": null, "created_at": "2026-09-21T12:11:02.602145+00:00", "enabled": true, "feature_id": "2f95e035-17c7-42dd-a5a8-73768e352d23", "plan_feature_id": "38b0acc2-b13a-4ec5-a18e-1edf1b38e71a", "plan_id": "0e389567-e2c5-4cf8-bb64-c0687341e438", "updated_at": "2026-09-21T12:11:02.602145+00:00"}$snapshot$::jsonb);
INSERT INTO public."SSP_Plan_Feature" SELECT * FROM jsonb_populate_record(NULL::public."SSP_Plan_Feature", $snapshot${"config": null, "created_at": "2026-09-21T12:11:02.602145+00:00", "enabled": true, "feature_id": "2f95e035-17c7-42dd-a5a8-73768e352d23", "plan_feature_id": "b6d9d4d2-bbbd-447c-a017-a9c4a5a578d7", "plan_id": "4e7fdbd1-1e7c-4d85-8e6a-9d1a16052bda", "updated_at": "2026-09-21T12:11:02.602145+00:00"}$snapshot$::jsonb);
INSERT INTO public."SSP_Plan_Feature" SELECT * FROM jsonb_populate_record(NULL::public."SSP_Plan_Feature", $snapshot${"config": null, "created_at": "2026-09-21T12:11:02.602145+00:00", "enabled": true, "feature_id": "2f95e035-17c7-42dd-a5a8-73768e352d23", "plan_feature_id": "dd234848-a9e0-4cbb-b3c1-4ea1006d136a", "plan_id": "967ee460-3f63-4a5e-bb35-41cbc76de649", "updated_at": "2026-09-21T12:11:02.602145+00:00"}$snapshot$::jsonb);
INSERT INTO public."SSP_Plan_Feature" SELECT * FROM jsonb_populate_record(NULL::public."SSP_Plan_Feature", $snapshot${"config": null, "created_at": "2026-09-21T12:11:02.602145+00:00", "enabled": true, "feature_id": "2f95e035-17c7-42dd-a5a8-73768e352d23", "plan_feature_id": "3c081d65-d7a6-4f09-a700-1d195cebf819", "plan_id": "ffa95c99-b1a2-46f7-bab5-c7a28b402bcf", "updated_at": "2026-09-21T12:11:02.602145+00:00"}$snapshot$::jsonb);
INSERT INTO public."SSP_Plan_Feature" SELECT * FROM jsonb_populate_record(NULL::public."SSP_Plan_Feature", $snapshot${"config": null, "created_at": "2026-09-21T12:11:02.602145+00:00", "enabled": true, "feature_id": "d00eea98-072c-42c5-95eb-836e54bea2d1", "plan_feature_id": "84cce50b-e607-4cfd-9f6c-141b82228148", "plan_id": "ffa95c99-b1a2-46f7-bab5-c7a28b402bcf", "updated_at": "2026-09-21T12:11:02.602145+00:00"}$snapshot$::jsonb);
DELETE FROM public."SSP_Feature" WHERE feature_code IN ('VISITOR_TAB','VISITOR_DASHBOARD_CARD') AND NOT EXISTS (SELECT 1 FROM public."SSP_Plan_Feature" pf WHERE pf.feature_id="SSP_Feature".feature_id);
COMMIT;
