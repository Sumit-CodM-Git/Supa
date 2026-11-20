BEGIN ISOLATION LEVEL SERIALIZABLE;
DO $$
DECLARE society_id uuid; contact_id uuid; society_user_id uuid; vendor_id uuid;
BEGIN
 SELECT s.society_id INTO STRICT society_id FROM public."SSP_Society" s WHERE registration_number='GZB-1234-ab';
 -- Fail instead of deleting any identity added since inspection.
 IF (SELECT count(*) FROM public."SSP_Contact" c WHERE regexp_replace(c.phone::text,'[^0-9]','','g') IN ('8888888883','918888888883'))<>1
 OR NOT EXISTS(SELECT 1 FROM public."SSP_Contact" c WHERE c.contact_id='5b9035c7-9ad1-47c6-92c1-3fd13d83f9ba' AND c.phone='8888888883')
 OR (SELECT count(*) FROM public."SSP_Society_User" u WHERE u.contact='5b9035c7-9ad1-47c6-92c1-3fd13d83f9ba')<>1
 OR NOT EXISTS(SELECT 1 FROM public."SSP_Society_User" u WHERE u.user_id='ac4e1eed-29db-4651-ad1c-8a7c50cddf8c' AND u.contact='5b9035c7-9ad1-47c6-92c1-3fd13d83f9ba' AND u.society=society_id)
 OR EXISTS(SELECT 1 FROM public."SSP_Non_Society_User" n WHERE regexp_replace(n.phone_number::text,'[^0-9]','','g') IN ('8888888883','918888888883')) THEN
  RAISE EXCEPTION 'Phone records changed since inspection; replacement cancelled';
 END IF;
 DELETE FROM public."SSP_Society_User" WHERE user_id='ac4e1eed-29db-4651-ad1c-8a7c50cddf8c';
 DELETE FROM public."SSP_Contact" WHERE "SSP_Contact".contact_id='5b9035c7-9ad1-47c6-92c1-3fd13d83f9ba';
 INSERT INTO public."SSP_Contact"(name,phone,society) VALUES('yoBro','8888888883',society_id) RETURNING "SSP_Contact".contact_id INTO contact_id;
 INSERT INTO public."SSP_Society_User"(contact,society,role,status,security_guard_id,security_guard_status,agent_availability_status)
 VALUES(contact_id,society_id,ARRAY['admin','resident','service_agent','security'],true,'yoBro','on_duty','available') RETURNING user_id INTO society_user_id;
 INSERT INTO public."SSP_Non_Society_User"(name,phone_number,role,society,vendor_id,hosted_by,check_in,pre_approved,is_otp_verified)
 VALUES('yoBro','8888888883','vendor',society_id,'V-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),NULL,NULL,false,false)
 RETURNING non_society_user_id INTO vendor_id;
 IF NOT EXISTS(SELECT 1 FROM public."SSP_Society_User" u WHERE u.user_id=society_user_id AND cardinality(u.role)=4 AND u.status=true) THEN
 RAISE EXCEPTION 'Created account verification failed'; END IF;
END $$;
COMMIT;
SELECT u.user_id,c.contact_id,c.name,c.phone,u.role,u.status,u.security_guard_id,u.security_guard_status,u.agent_availability_status,s.registration_number
FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Society" s ON s.society_id=u.society WHERE c.phone='8888888883';
