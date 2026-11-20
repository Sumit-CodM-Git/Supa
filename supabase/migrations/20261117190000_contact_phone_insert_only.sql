-- Phone duplication applies to creating contacts, not linking members or updating profiles.
CREATE OR REPLACE FUNCTION public.reject_duplicate_contact_phone_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
        RETURN NEW;
    END IF;
    -- Serialize concurrent inserts for the same society/phone.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        coalesce(NEW.society::text, '<null>') || ':' || btrim(NEW.phone), 0));
    IF EXISTS (
        SELECT 1 FROM public."SSP_Contact" c
        WHERE c.society IS NOT DISTINCT FROM NEW.society
          AND btrim(c.phone) = btrim(NEW.phone)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505',
            MESSAGE = 'Contact record already present, use a different phone.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_duplicate_contact_phone_on_insert ON public."SSP_Contact";
CREATE TRIGGER reject_duplicate_contact_phone_on_insert
BEFORE INSERT ON public."SSP_Contact"
FOR EACH ROW EXECUTE FUNCTION public.reject_duplicate_contact_phone_on_insert();
