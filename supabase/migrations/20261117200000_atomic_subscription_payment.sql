-- Both verified client callbacks and signed webhooks finalize in this transaction.
CREATE OR REPLACE FUNCTION public.finalize_razorpay_subscription_payment(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment_id text := p_input->>'paymentId';
    v_order_id text := p_input->>'orderId';
    v_owner uuid := (p_input->>'ownerUserId')::uuid;
    v_society uuid := (p_input->>'society')::uuid;
    v_tower uuid := nullif(p_input->>'tower','')::uuid;
    v_block uuid := nullif(p_input->>'block','')::uuid;
    v_flat text := p_input->>'flatNumber';
    v_plan_code text := p_input->>'planCode';
    v_price uuid := nullif(p_input->>'planPriceId','')::uuid;
    v_months int := (p_input->>'validityMonths')::int;
    v_amount numeric := (p_input->>'amountPaise')::numeric / 100;
    v_purpose text := lower(coalesce(p_input->>'paymentPurpose','new'));
    v_target uuid := nullif(p_input->>'targetSubscriptionId','')::uuid;
    v_recovery uuid := nullif(p_input->>'recoverySubscriptionId','')::uuid;
    v_plan uuid;
    v_current_plan text;
    v_sub public."SSP_Subscription"%ROWTYPE;
    v_link public."SSP_Subscription_Payment"%ROWTYPE;
    v_pay public."SSP_Payment"%ROWTYPE;
    v_now timestamptz := clock_timestamp();
    v_end timestamptz;
    v_replay boolean := false;
BEGIN
    IF coalesce(v_payment_id,'')='' OR coalesce(v_order_id,'')='' OR v_owner IS NULL
       OR v_society IS NULL OR coalesce(btrim(v_flat),'')='' THEN
        RAISE EXCEPTION 'Missing payment or subscription scope';
    END IF;
    -- Same-payment callbacks wait, then re-read the committed link. Flat locking
    -- also serializes distinct payments for one flat before applying any dates.
    PERFORM pg_advisory_xact_lock(hashtextextended('ssp-payment:'||v_payment_id,0));
    PERFORM pg_advisory_xact_lock(hashtextextended('ssp-flat:'||v_society::text||':'||
        coalesce(v_tower::text,'∅')||':'||coalesce(v_block::text,'∅')||':'||upper(btrim(v_flat)),0));

    SELECT * INTO v_link FROM public."SSP_Subscription_Payment"
    WHERE provider='razorpay' AND provider_payment_id=v_payment_id;
    IF FOUND THEN
        SELECT * INTO STRICT v_sub FROM public."SSP_Subscription" WHERE subscription_id=v_link.subscription_id;
        SELECT * INTO STRICT v_pay FROM public."SSP_Payment" WHERE pay_rec_id=v_link.payment;
        IF v_pay.society_user IS DISTINCT FROM v_owner OR v_link.provider_order_id<>v_order_id THEN
            RAISE EXCEPTION 'This payment does not belong to this user/order';
        END IF;
        v_purpose := v_link.payment_purpose;
        v_replay := true;
    ELSE
        IF v_months IS NULL OR v_months<=0 OR v_amount IS NULL OR v_amount<=0
           OR v_purpose NOT IN ('new','renewal','upgrade') THEN
            RAISE EXCEPTION 'Invalid subscription payment details';
        END IF;
        SELECT plan_id INTO v_plan FROM public."SSP_Subscription_Plan" WHERE plan_code=v_plan_code;
        IF v_plan IS NULL OR v_plan_code='FREE' THEN RAISE EXCEPTION 'Paid plan not found'; END IF;

        IF v_purpose IN ('renewal','upgrade') OR v_recovery IS NOT NULL THEN
            SELECT * INTO v_sub FROM public."SSP_Subscription"
            WHERE subscription_id=coalesce(v_recovery,v_target) FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Target subscription not found'; END IF;
            IF v_sub.owner_society_user IS DISTINCT FROM v_owner OR v_sub.society<>v_society
               OR v_sub.tower IS DISTINCT FROM v_tower OR v_sub.block IS DISTINCT FROM v_block
               OR upper(btrim(v_sub.flat_number))<>upper(btrim(v_flat)) THEN
                RAISE EXCEPTION 'Target subscription does not belong to this user/flat';
            END IF;
        ELSE
            SELECT * INTO v_sub FROM public."SSP_Subscription"
            WHERE society=v_society AND tower IS NOT DISTINCT FROM v_tower
              AND block IS NOT DISTINCT FROM v_block AND upper(btrim(flat_number))=upper(btrim(v_flat))
              AND status IN ('active','trial') FOR UPDATE;
            IF FOUND THEN
                SELECT plan_code INTO v_current_plan FROM public."SSP_Subscription_Plan" WHERE plan_id=v_sub.plan_id;
                IF v_current_plan='FREE' AND v_sub.owner_society_user=v_owner THEN
                    -- Support already-created orders with immutable NEW notes.
                    v_purpose := 'upgrade';
                ELSE
                    RAISE EXCEPTION 'This flat already has an active paid subscription.';
                END IF;
            END IF;
        END IF;

        -- Reuse an orphan left by the old non-transactional implementation.
        SELECT * INTO v_pay FROM public."SSP_Payment"
        WHERE payment_id=v_payment_id AND payment_type='subscription'
        ORDER BY created_at LIMIT 1 FOR UPDATE;
        IF FOUND THEN
            IF v_pay.society_user IS DISTINCT FROM v_owner OR v_pay.amount IS DISTINCT FROM v_amount THEN
                RAISE EXCEPTION 'Existing payment does not match captured payment';
            END IF;
        ELSE
            INSERT INTO public."SSP_Payment"(amount,payment_status,payment_type,payment_method,
                payment_id,transaction_id,society_user,payment_date,receipt_information)
            VALUES(v_amount,'paid','subscription','razorpay',v_payment_id,v_payment_id,v_owner,v_now,
                jsonb_build_object('order_id',v_order_id,'payment_id',v_payment_id,
                    'plan_code',v_plan_code,'billing_period',p_input->>'billingPeriod','payment_purpose',v_purpose)::text)
            RETURNING * INTO v_pay;
        END IF;

        IF v_recovery IS NOT NULL THEN
            -- Old webhook progress already committed this mutation; link it once.
            NULL;
        ELSIF v_purpose='renewal' THEN
            IF v_sub.plan_id<>v_plan THEN RAISE EXCEPTION 'Renewal plan does not match subscription'; END IF;
            v_end := coalesce(nullif(p_input->>'recoveryEndDate','')::timestamptz,
                greatest(coalesce(v_sub.end_date,v_now),v_now)+make_interval(months=>v_months));
            UPDATE public."SSP_Subscription" SET status='active',end_date=v_end,
                plan_price_id=v_price,updated_at=v_now WHERE subscription_id=v_sub.subscription_id RETURNING * INTO v_sub;
        ELSIF v_purpose='upgrade' THEN
            UPDATE public."SSP_Subscription" SET plan_id=v_plan,plan_price_id=v_price,status='active',
                start_date=v_now,end_date=v_now+make_interval(months=>v_months),auto_renew=false,
                payment_provider='razorpay',updated_at=v_now
            WHERE subscription_id=v_sub.subscription_id RETURNING * INTO v_sub;
        ELSE
            INSERT INTO public."SSP_Subscription"(society,tower,block,flat_number,owner_society_user,
                plan_id,plan_price_id,status,start_date,end_date,auto_renew,payment_provider)
            VALUES(v_society,v_tower,v_block,v_flat,v_owner,v_plan,v_price,'active',v_now,
                v_now+make_interval(months=>v_months),false,'razorpay') RETURNING * INTO v_sub;
        END IF;

        INSERT INTO public."SSP_Subscription_Payment"(subscription_id,payment,provider,provider_order_id,
            provider_payment_id,provider_signature_verified,payment_purpose,captured_at)
        VALUES(v_sub.subscription_id,v_pay.pay_rec_id,'razorpay',v_order_id,v_payment_id,true,v_purpose,v_now);
    END IF;
    SELECT plan_code INTO v_plan_code FROM public."SSP_Subscription_Plan" WHERE plan_id=v_sub.plan_id;
    RETURN jsonb_build_object('subscriptionId',v_sub.subscription_id,'planCode',v_plan_code,
        'startDate',v_sub.start_date,'endDate',v_sub.end_date,'paymentPurpose',v_purpose,
        'alreadyProcessed',v_replay,'paymentRecordId',v_pay.pay_rec_id);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_razorpay_subscription_payment(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_razorpay_subscription_payment(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
