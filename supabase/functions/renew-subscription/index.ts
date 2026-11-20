// supabase/functions/renew-subscription/index.ts
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
    billingPeriod: string;
}

serve(requireAuth(
    withRateLimit(
        (userId: string) => `renew-subscription:${userId}`,
        10,
        3600,
    )(async (req, ctx) => {
        if (req.method !== "POST") {
            return errorResponse("Method not allowed", 405);
        }

        try {
            const body = await req.json() as RequestBody;
            const billingPeriod = (body.billingPeriod ?? "").trim()
                .toUpperCase();

            if (!billingPeriod) throw badRequest("billingPeriod is required");
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
            // 2. Find the current subscription (any status in allowed set)
            //    Allowed: active, expired (within 30 day grace)
            //    Blocked: cancelled, refunded, transferred
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
                .in("status", ["active", "expired"])
                .order("created_at", { ascending: false })
                .limit(10);

            if (subErr) throw serverError(subErr.message);

            // Match tower/block in JS (handles null correctly for societies without tower/block)
            const currentSub = (candidates ?? []).find((s) => {
                const towerMatch = (s.tower ?? null) === (tower ?? null);
                const blockMatch = (s.block ?? null) === (block ?? null);
                return towerMatch && blockMatch;
            });

            if (!currentSub) {
                throw notFound(
                    "No renewable subscription found. Use create-razorpay-order for a new subscription.",
                );
            }

            // ─────────────────────────────────────────────
            // 3. Enforce grace period for expired
            // ─────────────────────────────────────────────
            if (currentSub.status === "expired") {
                // Check how long ago it expired. If > 30 days, force fresh.
                const end = currentSub.end_date
                    ? new Date(currentSub.end_date)
                    : null;
                if (end) {
                    const daysSinceExpiry = (Date.now() - end.getTime()) /
                        (1000 * 60 * 60 * 24);
                    if (daysSinceExpiry > 30) {
                        throw badRequest(
                            "Your subscription expired more than 30 days ago. Please start a new subscription instead.",
                        );
                    }
                }
            }

            // ─────────────────────────────────────────────
            // 4. Only the owner can renew
            // ─────────────────────────────────────────────
            if (currentSub.owner_society_user !== ctx.user.id) {
                throw badRequest("Only the subscription owner can renew.");
            }

            // ─────────────────────────────────────────────
            // 5. Load plan + price
            // ─────────────────────────────────────────────
            const { data: planRec, error: planErr } = await supabase
                .from("SSP_Subscription_Plan")
                .select("plan_id, plan_code, plan_name")
                .eq("plan_id", currentSub.plan_id)
                .eq("is_active", true)
                .maybeSingle();

            if (planErr) throw serverError(planErr.message);
            if (!planRec) {
                throw notFound("Current plan is not available for renewal");
            }
            if (planRec.plan_code === "FREE") {
                throw badRequest("FREE plan does not require renewal.");
            }

            const { data: priceRec, error: priceErr } = await supabase
                .from("SSP_Subscription_Plan_Price")
                .select("plan_price_id, amount, currency, validity_months")
                .eq("plan_id", planRec.plan_id)
                .eq("billing_period", billingPeriod)
                .eq("is_active", true)
                .maybeSingle();

            if (priceErr) throw serverError(priceErr.message);
            if (!priceRec) {
                throw notFound(
                    `Price not configured for ${planRec.plan_code} ${billingPeriod}`,
                );
            }

            const amountRupees = Number(priceRec.amount);
            if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
                throw badRequest("This plan's price is not configured yet.");
            }
            const amountPaise = Math.round(amountRupees * 100);

            // ─────────────────────────────────────────────
            // 6. Create Razorpay order (with RENEWAL purpose)
            // ─────────────────────────────────────────────
            const receipt = `renew_${
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
                    plan_code: planRec.plan_code,
                    plan_id: planRec.plan_id,
                    plan_price_id: priceRec.plan_price_id,
                    billing_period: billingPeriod,
                    validity_months: String(priceRec.validity_months),
                    payment_purpose: "RENEWAL",
                    renewing_subscription_id: currentSub.subscription_id,
                },
            });

            // ─────────────────────────────────────────────
            // 7. Audit log
            // ─────────────────────────────────────────────
            await supabase.from("SSP_Payment_Event").insert({
                provider: "razorpay",
                provider_event_id: `RENEWAL_ORDER_${order.id}`,
                event_type: "ORDER_CREATED",
                payload: order,
                processing_status: "PROCESSED",
                processed_at: new Date().toISOString(),
            });

            logger.info({
                action: "renew-subscription",
                userId: ctx.user.id,
                message:
                    `Renewal order ${order.id} created for sub ${currentSub.subscription_id}`,
            });

            // ─────────────────────────────────────────────
            // 8. Return
            // ─────────────────────────────────────────────
            return successResponse({
                orderId: order.id,
                amount: amountPaise,
                currency: priceRec.currency || "INR",
                keyId: getKeyId(),
                planCode: planRec.plan_code,
                planName: planRec.plan_name,
                billingPeriod: billingPeriod,
                validityMonths: priceRec.validity_months,
                paymentPurpose: "RENEWAL",
                currentSubscriptionId: currentSub.subscription_id,
                currentEndDate: currentSub.end_date,
                testMode: isTestMode(),
            });
        } catch (err) {
            if (err instanceof ApiError) return err.toResponse();
            logger.error({
                action: "renew-subscription",
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
