// supabase/functions/upgrade-subscription/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import {
    ApiError,
    badRequest,
    notFound,
    serverError,
} from "../_shared/errors.ts";
import {
    isValidBillingPeriod,
    serviceClient,
} from "../_shared/subscription-utils.ts";
import { logger } from "../_shared/logger.ts";
import { withRateLimit } from "../_shared/rate-limit.ts";
import { createOrder, getKeyId, isTestMode } from "../_shared/razorpay.ts";

interface RequestBody {
    newPlanCode: string;
    billingPeriod: string;
}

serve(requireAuth(
    withRateLimit(
        (userId: string) => `upgrade-subscription:${userId}`,
        10,
        3600,
    )(async (req, ctx) => {
        if (req.method !== "POST") {
            return errorResponse("Method not allowed", 405);
        }

        try {
            const body = await req.json() as RequestBody;
            const newPlanCode = (body.newPlanCode ?? "").trim().toUpperCase();
            const billingPeriod = (body.billingPeriod ?? "").trim()
                .toUpperCase();

            if (!newPlanCode) throw badRequest("newPlanCode is required");
            if (newPlanCode === "FREE") {
                throw badRequest(
                    "Use cancel-subscription to downgrade to FREE.",
                );
            }
            if (!isValidBillingPeriod(billingPeriod)) {
                throw badRequest(
                    "Invalid billingPeriod. Must be one of: MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY, THREE_YEAR",
                );
            }

            const supabase = serviceClient();

            // ─────────────────────────────────────────────
            // 1. Resolve caller's flat
            // ─────────────────────────────────────────────
            const { data: userRec, error: userErr } = await supabase
                .from("SSP_Society_User")
                .select("society, tower, block, unit_flat_number")
                .eq("user_id", ctx.user.id)
                .maybeSingle();

            if (userErr) throw serverError(userErr.message);
            if (!userRec?.society || !userRec?.unit_flat_number) {
                throw badRequest(
                    "Your flat is not configured. Contact your society admin.",
                );
            }

            const { society, tower, block, unit_flat_number: flatNumber } =
                userRec;

            // ─────────────────────────────────────────────
            // 2. Find current subscription (any active status)
            //    Handles null tower/block correctly via JS match
            // ─────────────────────────────────────────────
            const { data: candidates, error: subErr } = await supabase
                .from("SSP_Subscription")
                .select(`
                    subscription_id, plan_id, plan_price_id,
                    society, tower, block, flat_number,
                    owner_society_user, status, start_date, end_date
                `)
                .eq("society", society)
                .eq("flat_number", flatNumber)
                .in("status", ["active", "trial"])
                .order("created_at", { ascending: false })
                .limit(10);

            if (subErr) throw serverError(subErr.message);

            const currentSub = (candidates ?? []).find((s) => {
                const towerMatch = (s.tower ?? null) === (tower ?? null);
                const blockMatch = (s.block ?? null) === (block ?? null);
                return towerMatch && blockMatch;
            });

            if (!currentSub) {
                throw notFound(
                    "No active subscription to upgrade. Use create-razorpay-order for a new subscription.",
                );
            }

            if (currentSub.owner_society_user !== ctx.user.id) {
                throw badRequest("Only the subscription owner can upgrade.");
            }

            // ─────────────────────────────────────────────
            // 3. Load current plan (for tier comparison)
            // ─────────────────────────────────────────────
            const { data: currentPlan, error: cpErr } = await supabase
                .from("SSP_Subscription_Plan")
                .select("plan_id, plan_code, plan_name, sort_order")
                .eq("plan_id", currentSub.plan_id)
                .maybeSingle();

            if (cpErr) throw serverError(cpErr.message);
            if (!currentPlan) throw serverError("Current plan not found");

            // ─────────────────────────────────────────────
            // 4. Load target plan
            // ─────────────────────────────────────────────
            const { data: targetPlan, error: tpErr } = await supabase
                .from("SSP_Subscription_Plan")
                .select("plan_id, plan_code, plan_name, sort_order")
                .eq("plan_code", newPlanCode)
                .eq("is_active", true)
                .maybeSingle();

            if (tpErr) throw serverError(tpErr.message);
            if (!targetPlan) throw notFound(`Plan '${newPlanCode}' not found`);

            // Same plan → reject
            if (targetPlan.plan_id === currentPlan.plan_id) {
                throw badRequest(
                    `You are already on ${targetPlan.plan_name}. Use renew-subscription to extend.`,
                );
            }

            // Enforce higher tier only
            if (targetPlan.sort_order <= currentPlan.sort_order) {
                throw badRequest(
                    `Cannot upgrade from ${currentPlan.plan_name} to ${targetPlan.plan_name}. ` +
                        `Higher tier required. To downgrade, cancel and re-subscribe.`,
                );
            }

            // ─────────────────────────────────────────────
            // 5. Load price for target plan + billing period
            // ─────────────────────────────────────────────
            const { data: priceRec, error: priceErr } = await supabase
                .from("SSP_Subscription_Plan_Price")
                .select("plan_price_id, amount, currency, validity_months")
                .eq("plan_id", targetPlan.plan_id)
                .eq("billing_period", billingPeriod)
                .eq("is_active", true)
                .maybeSingle();

            if (priceErr) throw serverError(priceErr.message);
            if (!priceRec) {
                throw notFound(
                    `Price not configured for ${targetPlan.plan_code} ${billingPeriod}`,
                );
            }

            const amountRupees = Number(priceRec.amount);
            if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
                throw badRequest("This plan's price is not configured yet.");
            }
            const amountPaise = Math.round(amountRupees * 100);

            // ─────────────────────────────────────────────
            // 6. Create Razorpay order (purpose = UPGRADE)
            // ─────────────────────────────────────────────
            const receipt = `upgrade_${
                ctx.user.id.replace(/-/g, "").slice(0, 10)
            }_${Date.now()}`;

            const order = await createOrder({
                amount: amountPaise,
                currency: priceRec.currency || "INR",
                receipt,
                notes: {
                    user_id: ctx.user.id,
                    society: society,
                    tower: tower ?? "",
                    block: block ?? "",
                    flat_number: flatNumber,
                    plan_code: targetPlan.plan_code,
                    plan_id: targetPlan.plan_id,
                    plan_price_id: priceRec.plan_price_id,
                    billing_period: billingPeriod,
                    validity_months: String(priceRec.validity_months),
                    payment_purpose: "UPGRADE",
                    renewing_subscription_id: currentSub.subscription_id,
                    upgrading_from_plan_code: currentPlan.plan_code,
                },
            });

            // ─────────────────────────────────────────────
            // 7. Audit log
            // ─────────────────────────────────────────────
            await supabase.from("SSP_Payment_Event").insert({
                provider: "razorpay",
                provider_event_id: `UPGRADE_ORDER_${order.id}`,
                event_type: "ORDER_CREATED",
                payload: order,
                processing_status: "PROCESSED",
                processed_at: new Date().toISOString(),
            });

            logger.info({
                action: "upgrade-subscription",
                userId: ctx.user.id,
                message:
                    `Upgrade order ${order.id}: ${currentPlan.plan_code} → ${targetPlan.plan_code}`,
            });

            // ─────────────────────────────────────────────
            // 8. Return
            // ─────────────────────────────────────────────
            return successResponse({
                orderId: order.id,
                amount: amountPaise,
                currency: priceRec.currency || "INR",
                keyId: getKeyId(),
                planCode: targetPlan.plan_code,
                planName: targetPlan.plan_name,
                billingPeriod: billingPeriod,
                validityMonths: priceRec.validity_months,
                paymentPurpose: "UPGRADE",
                currentSubscriptionId: currentSub.subscription_id,
                upgradingFromPlanCode: currentPlan.plan_code,
                upgradingFromPlanName: currentPlan.plan_name,
                testMode: isTestMode(),
            });
        } catch (err) {
            if (err instanceof ApiError) return err.toResponse();
            logger.error({
                action: "upgrade-subscription",
                userId: ctx.user.id,
                message: err instanceof Error ? err.message : "Unknown",
            });
            return errorResponse(
                err instanceof Error ? err.message : "Unknown",
                500,
            );
        }
    }),
));
