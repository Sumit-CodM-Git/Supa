BEGIN;

-- Supersedes 20261117120000: only non-pre-approved walk-in visitors may omit phone/OTP.
-- Stored verification is never forged; pre-approved and arrival/check-in/out rules are restored.
CREATE OR REPLACE FUNCTION public.visitor_phone_requirement_satisfied(p_visitor public."SSP_Non_Society_User")
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE resident public."SSP_Society_User"%ROWTYPE; plan_code text;
BEGIN
  IF coalesce(p_visitor.is_otp_verified,false) THEN RETURN true; END IF;
  IF coalesce(p_visitor.pre_approved,false) THEN RETURN false; END IF;
  SELECT * INTO resident FROM public."SSP_Society_User" WHERE user_id=p_visitor.hosted_by;
  IF NOT FOUND OR resident.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF resident.society IS DISTINCT FROM p_visitor.society THEN RETURN false; END IF;
  plan_code:=public.get_current_plan_code(resident.society,resident.tower,resident.block,resident.unit_flat_number);
  RETURN upper(coalesce(plan_code,'FREE')) <> 'PREMIUM' OR coalesce(p_visitor.is_otp_verified,false);
END;
$$;

CREATE OR REPLACE FUNCTION public.visitor_ready_for_resident_approval(p_visitor public."SSP_Non_Society_User")
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.visitor_phone_requirement_satisfied(p_visitor)
    AND lower(coalesce(p_visitor.role,''))='visitor'
    AND p_visitor.hosted_by IS NOT NULL
    AND NOT coalesce(p_visitor.pre_approved,false)
    AND lower(trim(coalesce(p_visitor.name,''))) NOT IN ('','unknown','unknown visitor','unknown user')
    AND lower(coalesce(p_visitor.visitor_status,''))='pending'
    AND lower(coalesce(p_visitor.visitor_approval_status,'pending'))='pending';
$$;


CREATE OR REPLACE FUNCTION public.trg_non_society_user_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE v_was_ready boolean:=false;
BEGIN
  IF lower(coalesce(NEW.role,'')) <> 'visitor' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    v_was_ready:=public.visitor_ready_for_resident_approval(OLD);
    -- Resident decisions still notify security using the existing behavior.
    PERFORM public.fn_visitor_approval_status(NEW,OLD);
  END IF;

  -- Only walk-in approval requests gain the non-Premium exception.
  IF public.visitor_ready_for_resident_approval(NEW) AND NOT v_was_ready THEN
    PERFORM public.fn_notify_resident(NEW,NULL);
  END IF;
  -- Restore the pre-existing rules for pre-approved arrival and check-in/out notifications.
  IF coalesce(NEW.is_otp_verified,false) THEN
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
$$;


CREATE OR REPLACE FUNCTION public.block_unverified_visitor_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_visitor public."SSP_Non_Society_User"%ROWTYPE;
BEGIN
  IF NEW.reference_table='SSP_Non_Society_User' AND NEW.recipient_type::text='Resident' THEN
    SELECT * INTO v_visitor
    FROM public."SSP_Non_Society_User" WHERE non_society_user_id=NEW.reference_id AND lower(role)='visitor';
    IF FOUND AND (NOT public.visitor_phone_requirement_satisfied(v_visitor) OR
      (NOT coalesce(v_visitor.is_otp_verified,false) AND
       NEW.notification_type::text IS DISTINCT FROM 'VISITOR_APPROVAL_REQUEST')) THEN RETURN NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
