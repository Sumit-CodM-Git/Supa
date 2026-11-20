-- Storage deletion is outside the database transaction. Keep failed cleanup
-- durable so a confirmation retry can finish removing the retired objects.
CREATE TABLE public."SSP_Profile_Image_Cleanup" (
  object_key text PRIMARY KEY,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  society uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."SSP_Profile_Image_Cleanup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SSP_Profile_Image_Cleanup" FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON public."SSP_Profile_Image_Cleanup" TO service_role;

CREATE OR REPLACE FUNCTION public.replace_profile_image(p_image jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type text := p_image->>'owner_type';
  v_owner uuid := (p_image->>'owner_id')::uuid;
  v_society uuid := (p_image->>'society')::uuid;
  v_key text := p_image->>'object_key';
  v_previous public."SSP_Profile_Image"%ROWTYPE;
  v_saved public."SSP_Profile_Image"%ROWTYPE;
  v_cleanup jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ssp-profile:'||v_type||':'||v_owner::text,0));
  IF EXISTS(SELECT 1 FROM public."SSP_Profile_Image_Cleanup" WHERE object_key=v_key) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='This image was already replaced. Upload a new image.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='profile-images' AND name=v_key) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Upload the image before confirming.';
  END IF;
  SELECT * INTO v_previous FROM public."SSP_Profile_Image"
    WHERE owner_type=v_type AND owner_id=v_owner FOR UPDATE;
  INSERT INTO public."SSP_Profile_Image"(owner_type,owner_id,society,object_key,file_name,file_type,file_size,uploaded_by)
  VALUES(v_type,v_owner,v_society,v_key,p_image->>'file_name',p_image->>'file_type',
    (p_image->>'file_size')::bigint,(p_image->>'uploaded_by')::uuid)
  ON CONFLICT(owner_type,owner_id) DO UPDATE SET society=EXCLUDED.society,object_key=EXCLUDED.object_key,
    file_name=EXCLUDED.file_name,file_type=EXCLUDED.file_type,file_size=EXCLUDED.file_size,
    uploaded_by=EXCLUDED.uploaded_by
  RETURNING * INTO v_saved;
  IF v_previous.object_key IS NOT NULL AND v_previous.object_key<>v_key THEN
    INSERT INTO public."SSP_Profile_Image_Cleanup"(object_key,owner_type,owner_id,society)
    VALUES(v_previous.object_key,v_previous.owner_type,v_previous.owner_id,v_previous.society)
    ON CONFLICT(object_key) DO NOTHING;
  END IF;
  SELECT coalesce(jsonb_agg(object_key),'[]'::jsonb) INTO v_cleanup
    FROM public."SSP_Profile_Image_Cleanup" WHERE owner_type=v_type AND owner_id=v_owner AND object_key<>v_key;
  RETURN jsonb_build_object('updated_at',v_saved.updated_at,'cleanup_keys',v_cleanup);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_profile_image(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_profile_image(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
