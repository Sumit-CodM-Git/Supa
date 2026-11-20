ALTER TABLE public."SSP_Non_Society_User" ALTER COLUMN is_otp_verified SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.reset_visitor_phone_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
    NEW.is_otp_verified:=false;
    NEW.one_time_password:=NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reset_visitor_phone_verification ON public."SSP_Non_Society_User";
CREATE TRIGGER reset_visitor_phone_verification BEFORE UPDATE OF phone_number
ON public."SSP_Non_Society_User" FOR EACH ROW EXECUTE FUNCTION public.reset_visitor_phone_verification();

CREATE OR REPLACE FUNCTION public.visitor_ready_for_resident_approval(p_visitor public."SSP_Non_Society_User")
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(p_visitor.is_otp_verified,false)
    AND lower(coalesce(p_visitor.role,''))='visitor'
    AND p_visitor.hosted_by IS NOT NULL
    AND NOT coalesce(p_visitor.pre_approved,false)
    AND lower(trim(coalesce(p_visitor.name,''))) NOT IN ('','unknown','unknown visitor')
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
$$;

-- Guard other notification writers too, before a notification row or delivery webhook exists.
CREATE OR REPLACE FUNCTION public.block_unverified_visitor_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_verified boolean;
BEGIN
  IF NEW.reference_table='SSP_Non_Society_User' AND NEW.recipient_type::text='Resident' THEN
    SELECT coalesce(is_otp_verified,false) INTO v_verified
    FROM public."SSP_Non_Society_User" WHERE non_society_user_id=NEW.reference_id AND lower(role)='visitor';
    IF FOUND AND NOT v_verified THEN RETURN NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS block_unverified_visitor_notifications ON public."SSP_Notification";
CREATE TRIGGER block_unverified_visitor_notifications BEFORE INSERT ON public."SSP_Notification"
FOR EACH ROW EXECUTE FUNCTION public.block_unverified_visitor_notifications();
