BEGIN;
DO $$
DECLARE affected integer;
BEGIN
 UPDATE public."SSP_Contact" SET gender='male',occupation='Facility support specialist (demo)',description='Dummy profile for testing admin, resident, service agent, security and vendor screens.',whatsapp_phone='8888888883',vehicle_type='none'
 WHERE contact_id='9c1e7831-4f7a-4fca-8408-093274f75be7' AND phone='8888888883' AND name='yoBro';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Expected contact changed; cancelling';END IF;
 UPDATE public."SSP_Society_User" SET shift='day_shift',security_zone='main_entrance_alpha',service_agent_rating=4.50,service_agent_services='plumbing, electrical'
 WHERE user_id='120138e3-20d8-4e65-9196-c9e7062c8faa' AND contact='9c1e7831-4f7a-4fca-8408-093274f75be7' AND society='74628c82-7e11-4f5a-952a-d062193b3fb9';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Expected account changed; cancelling';END IF;
 UPDATE public."SSP_Non_Society_User" SET gender='male',service_type='plumbing',vendor_rating='4.5',delivery_origin='Demo Service Centre, Ghaziabad'
 WHERE non_society_user_id='9d748c14-27b9-4bd3-9615-862facb21beb' AND phone_number='8888888883' AND role='vendor';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Expected vendor changed; cancelling';END IF;
END $$;
COMMIT;
SELECT c.name,c.phone,c.gender,c.occupation,c.description,c.whatsapp_phone,c.vehicle_type,u.role,u.status,u.shift,u.security_zone,u.security_guard_id,u.service_agent_rating,u.service_agent_services,u.unit_flat_number,v.service_type,v.vendor_rating,v.delivery_origin
FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Non_Society_User" v ON v.non_society_user_id='9d748c14-27b9-4bd3-9615-862facb21beb' WHERE u.user_id='120138e3-20d8-4e65-9196-c9e7062c8faa';
