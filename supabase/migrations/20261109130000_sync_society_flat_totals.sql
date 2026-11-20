-- One source of truth: society capacity is the sum of active tower capacities.
CREATE OR REPLACE FUNCTION public.recalculate_society_total_units(p_society uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric;
BEGIN
  IF p_society IS NULL THEN RETURN; END IF;
  -- Serialize recalculations without conflicting with foreign-key key-share locks.
  PERFORM 1 FROM public."SSP_Society" WHERE society_id=p_society FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum(coalesce(floors,0)::numeric * coalesce(flats_per_floor,0)::numeric),0)
    INTO v_total FROM public."SSP_Tower" WHERE society=p_society AND active=true;
  UPDATE public."SSP_Society" SET total_unit=v_total
    WHERE society_id=p_society AND total_unit IS DISTINCT FROM v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.recalculate_society_total_units(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_society_total_units(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_society_total_units_from_towers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old uuid;
  v_new uuid;
  v_society uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old:=OLD.society; END IF;
  IF TG_OP <> 'DELETE' THEN v_new:=NEW.society; END IF;
  FOR v_society IN SELECT DISTINCT value FROM unnest(ARRAY[v_old,v_new]) AS ids(value)
      WHERE value IS NOT NULL ORDER BY value LOOP
    PERFORM public.recalculate_society_total_units(v_society);
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS sync_society_total_units_from_towers ON public."SSP_Tower";
CREATE TRIGGER sync_society_total_units_from_towers
AFTER INSERT OR DELETE OR UPDATE OF floors,flats_per_floor,active,society
ON public."SSP_Tower" FOR EACH ROW
EXECUTE FUNCTION public.sync_society_total_units_from_towers();

-- Reconcile existing societies that have configured towers. Unconfigured societies stay untouched.
DO $$ DECLARE v_society uuid;
BEGIN
  FOR v_society IN SELECT DISTINCT society FROM public."SSP_Tower" WHERE society IS NOT NULL ORDER BY society LOOP
    PERFORM public.recalculate_society_total_units(v_society);
  END LOOP;
END; $$;
