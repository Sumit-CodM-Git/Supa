-- All tower/block changes and resulting totals are rolled back.
BEGIN;
DO $$
DECLARE
  v_society uuid;
  v_tower uuid;
  v_second uuid;
  v_block uuid;
  v_baseline numeric;
  v_total numeric;
BEGIN
  SELECT society_id,total_unit INTO v_society,v_baseline FROM public."SSP_Society"
    WHERE registration_number='GZB-1234-ab' FOR NO KEY UPDATE;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Test society missing'; END IF;
  INSERT INTO public."SSP_Tower" (society,name,active,floors,flats_per_floor)
    VALUES (v_society,'TOTAL_TEST_A',true,3,4) RETURNING tower_id INTO v_tower;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline+12 THEN RAISE EXCEPTION 'CREATE must add tower capacity'; END IF;

  UPDATE public."SSP_Tower" SET floors=4 WHERE tower_id=v_tower;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline+16 THEN RAISE EXCEPTION 'Floor update must recalculate'; END IF;
  UPDATE public."SSP_Tower" SET flats_per_floor=5 WHERE tower_id=v_tower;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline+20 THEN RAISE EXCEPTION 'Flats-per-floor update must recalculate'; END IF;

  UPDATE public."SSP_Tower" SET active=false WHERE tower_id=v_tower;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline THEN RAISE EXCEPTION 'Inactive tower must be excluded'; END IF;
  UPDATE public."SSP_Tower" SET active=true,floors=NULL WHERE tower_id=v_tower;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline THEN RAISE EXCEPTION 'Missing dimensions must count as zero'; END IF;
  UPDATE public."SSP_Tower" SET floors=4,flats_per_floor=5 WHERE tower_id=v_tower;

  INSERT INTO public."SSP_Tower" (society,name,active,floors,flats_per_floor)
    VALUES (v_society,'TOTAL_TEST_B',true,2,6) RETURNING tower_id INTO v_second;
  INSERT INTO public."SSP_Block" (society,block_name,active) VALUES(v_society,'TOTAL_TEST_BLOCK',true) RETURNING block_id INTO v_block;
  UPDATE public."SSP_Tower" SET block=v_block WHERE tower_id=v_tower;
  UPDATE public."SSP_Block" SET tower=v_tower,block_name='TOTAL_TEST_BLOCK_UPDATED',active=false WHERE block_id=v_block;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline+32 THEN RAISE EXCEPTION 'Block grouping must not duplicate or alter capacity'; END IF;
  UPDATE public."SSP_Tower" SET block=NULL WHERE tower_id=v_tower;
  DELETE FROM public."SSP_Block" WHERE block_id=v_block;
  DELETE FROM public."SSP_Tower" WHERE tower_id=v_tower;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline+12 THEN RAISE EXCEPTION 'Tower DELETE must subtract capacity'; END IF;
  DELETE FROM public."SSP_Tower" WHERE tower_id=v_second;
  SELECT total_unit INTO v_total FROM public."SSP_Society" WHERE society_id=v_society;
  IF v_total<>v_baseline THEN RAISE EXCEPTION 'Total must return to baseline'; END IF;
END;
$$;
ROLLBACK;
