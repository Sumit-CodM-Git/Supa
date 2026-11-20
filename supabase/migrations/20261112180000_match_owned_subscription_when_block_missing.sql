UPDATE public."SSP_Subscription" s
SET block = u.block
FROM public."SSP_Society_User" u
WHERE s.owner_society_user = u.user_id
  AND s.society = u.society
  AND s.tower IS NOT DISTINCT FROM u.tower
  AND upper(trim(s.flat_number)) = upper(trim(u.unit_flat_number))
  AND s.block IS NULL
  AND u.block IS NOT NULL
  AND s.status IN ('trial', 'active')
  AND (s.end_date IS NULL OR s.end_date > NOW());

CREATE OR REPLACE FUNCTION public.get_my_subscription_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_user RECORD;
    v_plan JSONB;
    v_payment_count INT;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    SELECT society, tower, block, unit_flat_number
    INTO v_user
    FROM "SSP_Society_User"
    WHERE user_id = p_user_id
    LIMIT 1;

    DECLARE
        v_sub RECORD;
        v_entitlements JSONB;
    BEGIN
        SELECT s.*, p.plan_code, p.plan_name
        INTO v_sub
        FROM "SSP_Subscription" s
        JOIN "SSP_Subscription_Plan" p ON p.plan_id = s.plan_id
        WHERE s.society = v_user.society
          AND COALESCE(s.tower::text, '∅') = COALESCE(v_user.tower::text, '∅')
          AND (
              COALESCE(s.block::text, '∅') = COALESCE(v_user.block::text, '∅')
              OR (s.owner_society_user = p_user_id AND s.block IS NULL)
          )
          AND upper(trim(s.flat_number)) = upper(trim(v_user.unit_flat_number))
          AND s.status IN ('trial', 'active')
          AND (s.end_date IS NULL OR s.end_date > NOW())
        ORDER BY s.created_at DESC
        LIMIT 1;

        SELECT jsonb_object_agg(f.feature_code, pf.enabled)
        INTO v_entitlements
        FROM "SSP_Plan_Feature" pf
        JOIN "SSP_Feature" f ON f.feature_id = pf.feature_id
        JOIN "SSP_Subscription_Plan" p ON p.plan_id = pf.plan_id
        WHERE p.plan_code = COALESCE(v_sub.plan_code, 'FREE')
          AND f.is_active = TRUE;

        v_plan := jsonb_build_object(
            'plan_code', COALESCE(v_sub.plan_code, 'FREE'),
            'plan_name', COALESCE(v_sub.plan_name, 'Free'),
            'status', COALESCE(v_sub.status, 'active'),
            'start_date', v_sub.start_date,
            'end_date', v_sub.end_date,
            'auto_renew', COALESCE(v_sub.auto_renew, FALSE),
            'entitlements', COALESCE(v_entitlements, '{}'::jsonb)
        );
    END;

    SELECT COUNT(*) INTO v_payment_count
    FROM "SSP_Payment"
    WHERE society_user = p_user_id;

    RETURN jsonb_build_object(
        'plan', v_plan,
        'flat', jsonb_build_object(
            'society', v_user.society,
            'tower', v_user.tower,
            'block', v_user.block,
            'flat_number', v_user.unit_flat_number
        ),
        'payment_count', v_payment_count
    );
END;
$function$;
