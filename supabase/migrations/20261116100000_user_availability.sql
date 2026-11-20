BEGIN;

CREATE TABLE public."SSP_User_Availability" (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','away')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."SSP_User_Availability" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SSP_User_Availability" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public."SSP_User_Availability" TO service_role;

CREATE FUNCTION public.apply_user_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'away' THEN
    UPDATE public."SSP_Notification"
      SET delivery_status = 'failed',
          extra_data = coalesce(extra_data,'{}'::jsonb) || '{"suppressedReason":"user_away"}'::jsonb
      WHERE recipient_id = NEW.user_id AND delivery_status::text = 'pending';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER apply_user_availability BEFORE INSERT OR UPDATE ON public."SSP_User_Availability"
FOR EACH ROW EXECUTE FUNCTION public.apply_user_availability();

CREATE FUNCTION public.suppress_away_user_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.delivery_status::text = 'pending' AND EXISTS (
    SELECT 1 FROM public."SSP_User_Availability" a
    WHERE a.user_id = NEW.recipient_id AND a.status = 'away'
  ) THEN
    NEW.delivery_status := 'failed';
    NEW.extra_data := coalesce(NEW.extra_data,'{}'::jsonb) || '{"suppressedReason":"user_away"}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER suppress_away_user_notifications BEFORE INSERT OR UPDATE OF delivery_status
ON public."SSP_Notification" FOR EACH ROW EXECUTE FUNCTION public.suppress_away_user_notifications();

COMMIT;
