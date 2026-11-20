BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='25s';
DO $$
DECLARE
    linked record;
    result jsonb;
    before_payments int;
    after_payments int;
    before_sub jsonb;
    after_sub jsonb;
    tested int := 0;
BEGIN
    ASSERT NOT has_function_privilege('authenticated','public.finalize_razorpay_subscription_payment(jsonb)','EXECUTE'), 'Authenticated clients must not finalize unverified payments';
    ASSERT has_function_privilege('service_role','public.finalize_razorpay_subscription_payment(jsonb)','EXECUTE'), 'Service role must have finalizer access';
    FOR linked IN
        SELECT l.provider_payment_id,l.provider_order_id,p.society_user,s.*
        FROM public."SSP_Subscription_Payment" l
        JOIN public."SSP_Payment" p ON p.pay_rec_id=l.payment
        JOIN public."SSP_Subscription" s ON s.subscription_id=l.subscription_id
        WHERE l.provider='razorpay' AND l.provider_payment_id IN ('pay_U1BT1GKojHqbK2','pay_U1BPOsa4tkmIef')
    LOOP
        SELECT count(*) INTO before_payments FROM public."SSP_Payment" WHERE payment_id=linked.provider_payment_id;
        SELECT to_jsonb(s) INTO before_sub FROM public."SSP_Subscription" s WHERE subscription_id=linked.subscription_id;
        FOR i IN 1..2 LOOP
            result := public.finalize_razorpay_subscription_payment(jsonb_build_object(
                'paymentId',linked.provider_payment_id,'orderId',linked.provider_order_id,
                'ownerUserId',linked.society_user,'society',linked.society,'tower',linked.tower,
                'block',linked.block,'flatNumber',linked.flat_number));
            ASSERT result->>'alreadyProcessed'='true', 'Existing payment must return successful replay';
            ASSERT (result->>'subscriptionId')::uuid=linked.subscription_id, 'Replay must return same subscription';
            ASSERT result->>'planCode'='PREMIUM', 'Affected subscriptions must be premium';
        END LOOP;
        SELECT count(*) INTO after_payments FROM public."SSP_Payment" WHERE payment_id=linked.provider_payment_id;
        SELECT to_jsonb(s) INTO after_sub FROM public."SSP_Subscription" s WHERE subscription_id=linked.subscription_id;
        ASSERT before_payments=after_payments, 'Replay inserted a payment';
        ASSERT before_sub=after_sub, 'Replay changed subscription or validity dates';
        tested := tested+1;
    END LOOP;
    ASSERT tested=2, 'Both affected payments must exist and be verified';
END;
$$;
SELECT 'passed' AS result, 'Both existing captured payments replayed twice without extra payment rows or subscription/date changes. Service-only permissions checked.' AS verification;
ROLLBACK;
