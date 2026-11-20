BEGIN;
DO $$
DECLARE chosen_flat text;affected integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."SSP_Tower" t JOIN public."SSP_Block" b ON b.block_id=t.block WHERE t.tower_id='8c1889b7-d311-4535-b7c2-73ad8dceb3c1' AND t.society='74628c82-7e11-4f5a-952a-d062193b3fb9' AND b.block_id='320c186e-1b99-40a0-9a60-e21ca9e8b5b3' AND t.active AND b.active) THEN RAISE EXCEPTION 'Society configuration changed';END IF;
 SELECT (100+n)::text INTO chosen_flat FROM generate_series(1,6) AS n
 WHERE NOT EXISTS(SELECT 1 FROM public."SSP_Society_User" u WHERE u.society='74628c82-7e11-4f5a-952a-d062193b3fb9' AND u.tower='8c1889b7-d311-4535-b7c2-73ad8dceb3c1' AND upper(trim(u.unit_flat_number))=(100+n)::text)
 AND coalesce(public.get_current_plan_code('74628c82-7e11-4f5a-952a-d062193b3fb9','8c1889b7-d311-4535-b7c2-73ad8dceb3c1','320c186e-1b99-40a0-9a60-e21ca9e8b5b3',(100+n)::text),'FREE')='FREE'
 ORDER BY n LIMIT 1;
 IF chosen_flat IS NULL THEN RAISE EXCEPTION 'No available sample flat in selected floor';END IF;
 UPDATE public."SSP_Society_User" SET tower='8c1889b7-d311-4535-b7c2-73ad8dceb3c1',block='320c186e-1b99-40a0-9a60-e21ca9e8b5b3',unit_flat_number=chosen_flat,flat_type_id='656586be-0f92-4e27-af5f-b86f2ec85704',user_type='owner',user_ownership_type='primary',relationship=NULL,move_in_date='2026-11-01'
 WHERE user_id='120138e3-20d8-4e65-9196-c9e7062c8faa' AND contact='9c1e7831-4f7a-4fca-8408-093274f75be7' AND society='74628c82-7e11-4f5a-952a-d062193b3fb9';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Account changed';END IF;
 UPDATE public."SSP_Contact" SET id_proof_type='driving_license',id_proof_number='DEMO-YOBRO-001',description='Dummy Gaur City profile for UI testing. Residential assignment and ID proof are sample data.' WHERE contact_id='9c1e7831-4f7a-4fca-8408-093274f75be7' AND phone='8888888883';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Contact changed';END IF;
 UPDATE public."SSP_Non_Society_User" SET delivery_origin='Gaur City, Sector 98, City Center, Noida',id_proof_type='driving_license',id_proof_number='DEMO-YOBRO-001' WHERE non_society_user_id='9d748c14-27b9-4bd3-9615-862facb21beb' AND phone_number='8888888883' AND role='vendor';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Vendor changed';END IF;
END $$;
COMMIT;
SELECT c.name,c.phone,u.user_id,u.unit_flat_number AS flat,t.name AS tower,b.block_name AS block,f.flat_type,u.user_type,u.user_ownership_type,u.move_in_date,u.status,c.id_proof_type,c.id_proof_number,s.society_name,s.address_line1,s.address_line2,s.city
FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact JOIN public."SSP_Tower" t ON t.tower_id=u.tower JOIN public."SSP_Block" b ON b.block_id=u.block JOIN public."SSP_Flat_Type" f ON f.flat_type_id=u.flat_type_id JOIN public."SSP_Society" s ON s.society_id=u.society WHERE u.user_id='120138e3-20d8-4e65-9196-c9e7062c8faa';
