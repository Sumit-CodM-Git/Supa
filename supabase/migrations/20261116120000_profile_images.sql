BEGIN;

-- Separate storage and metadata keep existing document/photo queries unchanged.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('profile-images','profile-images',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='profile-images' AND public=false
    AND file_size_limit=5242880 AND allowed_mime_types @> ARRAY['image/jpeg','image/png','image/webp']
    AND allowed_mime_types <@ ARRAY['image/jpeg','image/png','image/webp']) THEN
    RAISE EXCEPTION 'Existing profile-images bucket configuration differs; review before applying';
  END IF;
END $$;

CREATE TABLE public."SSP_Profile_Image" (
  owner_type text NOT NULL CHECK(owner_type IN ('society_user','non_society_user','servant','society_staff')),
  owner_id uuid NOT NULL,
  society uuid NOT NULL REFERENCES public."SSP_Society"(society_id) ON DELETE CASCADE,
  society_user uuid GENERATED ALWAYS AS (CASE WHEN owner_type='society_user' THEN owner_id END) STORED
    REFERENCES public."SSP_Society_User"(user_id) ON DELETE CASCADE,
  non_society_user uuid GENERATED ALWAYS AS (CASE WHEN owner_type='non_society_user' THEN owner_id END) STORED
    REFERENCES public."SSP_Non_Society_User"(non_society_user_id) ON DELETE CASCADE,
  servant uuid GENERATED ALWAYS AS (CASE WHEN owner_type='servant' THEN owner_id END) STORED
    REFERENCES public."SSP_Servant"(servant_id) ON DELETE CASCADE,
  society_staff uuid GENERATED ALWAYS AS (CASE WHEN owner_type='society_staff' THEN owner_id END) STORED
    REFERENCES public."SSP_Society_Staff"(staff_id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  file_type text NOT NULL CHECK(file_type IN ('image/jpeg','image/png','image/webp')),
  file_size bigint NOT NULL CHECK(file_size BETWEEN 1 AND 5242880),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_type,owner_id),
  CHECK(starts_with(object_key,society::text||'/'||owner_type||'/'||owner_id::text||'/'))
);
CREATE INDEX ssp_profile_image_society ON public."SSP_Profile_Image"(society);
ALTER TABLE public."SSP_Profile_Image" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SSP_Profile_Image" FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public."SSP_Profile_Image" TO service_role;

CREATE FUNCTION public.validate_profile_image_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected_society uuid;
BEGIN
  CASE NEW.owner_type
    WHEN 'society_user' THEN SELECT society INTO expected_society FROM public."SSP_Society_User" WHERE user_id=NEW.owner_id;
    WHEN 'non_society_user' THEN SELECT society INTO expected_society FROM public."SSP_Non_Society_User" WHERE non_society_user_id=NEW.owner_id;
    WHEN 'servant' THEN SELECT society INTO expected_society FROM public."SSP_Servant" WHERE servant_id=NEW.owner_id;
    WHEN 'society_staff' THEN SELECT society_id INTO expected_society FROM public."SSP_Society_Staff" WHERE staff_id=NEW.owner_id;
    ELSE RAISE EXCEPTION 'Unknown profile owner type';
  END CASE;
  IF expected_society IS NULL OR expected_society<>NEW.society THEN
    RAISE EXCEPTION 'Profile owner does not belong to the specified society';
  END IF;
  NEW.updated_at:=now();
  IF TG_OP='UPDATE' THEN NEW.created_at:=OLD.created_at; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_profile_image_owner BEFORE INSERT OR UPDATE ON public."SSP_Profile_Image"
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_image_owner();

-- Only signed operations issued by the backend may access this private bucket.
-- The condition is true for every other bucket, preserving their existing policies.
CREATE POLICY profile_images_backend_only ON storage.objects AS RESTRICTIVE
FOR ALL TO anon,authenticated
USING(bucket_id<>'profile-images') WITH CHECK(bucket_id<>'profile-images');

COMMIT;
