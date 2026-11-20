BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='25s';
DO $$
DECLARE
    sample public."SSP_Contact"%ROWTYPE;
    clone public."SSP_Contact"%ROWTYPE;
    blocked boolean := false;
    error_message text;
BEGIN
    SELECT * INTO STRICT sample FROM public."SSP_Contact"
    WHERE phone IS NOT NULL AND btrim(phone) <> '' AND society IS NOT NULL LIMIT 1;
    clone := sample;
    clone.contact_id := gen_random_uuid();
    BEGIN
        INSERT INTO public."SSP_Contact" SELECT (clone).*;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
        ASSERT error_message = 'Contact record already present, use a different phone.', 'Unexpected duplicate failure';
        blocked := true;
    END;
    ASSERT blocked, 'Duplicate new contact must be blocked';

    LOOP
        clone.phone := '999' || lpad(floor(random()*1000000000)::text,9,'0');
        EXIT WHEN NOT EXISTS(SELECT 1 FROM public."SSP_Contact" c WHERE c.society=clone.society AND btrim(c.phone)=clone.phone);
    END LOOP;
    clone.contact_id := gen_random_uuid();
    INSERT INTO public."SSP_Contact" SELECT (clone).*;
    UPDATE public."SSP_Contact" SET phone=sample.phone WHERE contact_id=clone.contact_id;
    ASSERT FOUND, 'Existing contact phone update must be allowed';
    ASSERT (SELECT phone=sample.phone FROM public."SSP_Contact" WHERE contact_id=clone.contact_id), 'Phone update did not persist within transaction';
END;
$$;
SELECT 'passed' AS result, 'Duplicate INSERT blocked; unique INSERT and duplicate-phone UPDATE allowed. Test records rolled back.' AS verification;
ROLLBACK;
