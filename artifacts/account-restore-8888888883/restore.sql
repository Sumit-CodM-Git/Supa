BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='25s';
DO $$
DECLARE target public."SSP_Society_User"%ROWTYPE;
BEGIN
 SELECT u.* INTO STRICT target
 FROM public."SSP_Society_User" u
 JOIN public."SSP_Contact" c ON c.contact_id=u.contact
 JOIN public."SSP_Society" s ON s.society_id=u.society
 WHERE u.user_id='120138e3-20d8-4e65-9196-c9e7062c8faa'
   AND c.phone='8888888883' AND s.registration_number='GZB-1234-ab'
 FOR UPDATE OF u;
 ASSERT 'admin'=ANY(target.role), 'Target must be the identified admin account';
 ASSERT target.status=true, 'Unexpected inactive account state';
 ASSERT target.deleted_at='2026-11-17T08:24:57.012Z'::timestamptz, 'Deletion state changed; do not overwrite';
 UPDATE public."SSP_Society_User" SET deleted_at=NULL WHERE user_id=target.user_id;
 ASSERT FOUND, 'Account was not restored';
END;
$$;
COMMIT;
SELECT user_id,role,status,deleted_at FROM public."SSP_Society_User"
WHERE user_id='120138e3-20d8-4e65-9196-c9e7062c8faa';
