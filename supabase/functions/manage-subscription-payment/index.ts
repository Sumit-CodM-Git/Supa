// supabase/functions/manage-subscription-payment/index.ts
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
    action: "RENEW" | "UPGRADE";
    billingPeriod: string;
    newPlanCode?: string; // required for UPGRADE
}

serve(requireAuth(
    withRateLimit(
        (userId: string) => `manage-sub-payment:${userId}`,
        10,
        3600,
    )(async (req, ctx) => {
        if (req.method !== "POST") {
            return errorResponse("Method not allowed", 405);
        }

        try {
            const body = await req.json() as RequestBody;
            if (!body.action) throw badRequest("action is required");
            const action = body.action.toUpperCase();
            if (!["RENEW", "UPGRADE"].includes(action)) {
                throw badRequest(
                    `Unknown action '${body.action}'. Valid: RENEW, UPGRADE`,
                );
            }

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
            // 2. Find current subscription
            // ─────────────────────────────────────────────
            const { data: candidates } = await supabase
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

            const currentSub = (candidates ?? []).find((s) => {
                const tMatch = (s.tower ?? null) === (tower ?? null);
                const bMatch = (s.block ?? null) === (block ?? null);
                return tMatch && bMatch;
            });

            if (!currentSub) {
                throw notFound(
                    "No renewable subscription found. Use create-razorpay-order for a new subscription.",
                );
            }

            if (currentSub.owner_society_user !== ctx.user.id) {
                throw badRequest(
                    "Only the subscription owner can perform this action.",
                );
            }

            // ─────────────────────────────────────────────
            // 3. Action-specific validation + prep
            // ─────────────────────────────────────────────
            let paymentPurpose: string;
            let targetPlanId: string;
            let targetPlanCode: string;
            let targetPlanName: string;

            if (action === "RENEW") {
                // ─────────────────────────────────────────────
                // RENEW
                // ─────────────────────────────────────────────

                // Grace period check for expired
                if (currentSub.status === "expired") {
                    const end = currentSub.end_date
                        ? new Date(currentSub.end_date)
                        : null;
                    if (end) {
                        const daysSinceExpiry = (Date.now() - end.getTime()) /
                            (1000 * 60 * 60 * 24);
                        if (daysSinceExpiry > 30) {
                            throw badRequest(
                                "Your subscription expired more than 30 days ago. Please start a new subscription.",
                            );
                        }
                    }
                }

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

                targetPlanId = planRec.plan_id;
                targetPlanCode = planRec.plan_code;
                targetPlanName = planRec.plan_name;
                paymentPurpose = "RENEWAL";
            } else {
                // ─────────────────────────────────────────────
                // UPGRADE
                // ─────────────────────────────────────────────
                const newPlanCode = (body.newPlanCode ?? "").trim()
                    .toUpperCase();
                if (!newPlanCode) {
                    throw badRequest("newPlanCode is required for UPGRADE");
                }
                if (newPlanCode === "FREE") {
                    throw badRequest(
                        "Use cancel-subscription to downgrade to FREE.",
                    );
                }

                const { data: currentPlan } = await supabase
                    .from("SSP_Subscription_Plan")
                    .select("plan_id, plan_code, plan_name, sort_order")
                    .eq("plan_id", currentSub.plan_id)
                    .maybeSingle();

                if (!currentPlan) throw serverError("Current plan not found");

                const { data: targetPlan } = await supabase
                    .from("SSP_Subscription_Plan")
                    .select("plan_id, plan_code, plan_name, sort_order")
                    .eq("plan_code", newPlanCode)
                    .eq("is_active", true)
                    .maybeSingle();

                if (!targetPlan) {
                    throw notFound(`Plan '${newPlanCode}' not found`);
                }

                if (targetPlan.plan_id === currentPlan.plan_id) {
                    throw badRequest(
                        `You are already on ${targetPlan.plan_name}. Use RENEW to extend.`,
                    );
                }

                if (targetPlan.sort_order <= currentPlan.sort_order) {
                    throw badRequest(
                        `Cannot upgrade from ${currentPlan.plan_name} to ${targetPlan.plan_name}. Higher tier required.`,
                    );
                }

                targetPlanId = targetPlan.plan_id;
                targetPlanCode = targetPlan.plan_code;
                targetPlanName = targetPlan.plan_name;
                paymentPurpose = "UPGRADE";
            }

            // ─────────────────────────────────────────────
            // 4. Load price
            // ─────────────────────────────────────────────
            const { data: priceRec, error: priceErr } = await supabase
                .from("SSP_Subscription_Plan_Price")
                .select("plan_price_id, amount, currency, validity_months")
                .eq("plan_id", targetPlanId)
                .eq("billing_period", billingPeriod)
                .eq("is_active", true)
                .maybeSingle();

            if (priceErr) throw serverError(priceErr.message);
            if (!priceRec) {
                throw notFound(
                    `Price not configured for ${targetPlanCode} ${billingPeriod}`,
                );
            }

            const amountRupees = Number(priceRec.amount);
            if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
                throw badRequest("This plan's price is not configured yet.");
            }
            const amountPaise = Math.round(amountRupees * 100);

            // ─────────────────────────────────────────────
            // 5. Create Razorpay order
            // ─────────────────────────────────────────────
            const prefix = action === "RENEW" ? "renew" : "upgrade";
            const receipt = `${prefix}_${
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
                    plan_code: targetPlanCode,
                    plan_id: targetPlanId,
                    plan_price_id: priceRec.plan_price_id,
                    billing_period: billingPeriod,
                    validity_months: String(priceRec.validity_months),
                    payment_purpose: paymentPurpose,
                    renewing_subscription_id: currentSub.subscription_id,
                },
            });

            // ─────────────────────────────────────────────
            // 6. Audit log
            // ─────────────────────────────────────────────
            await supabase.from("SSP_Payment_Event").insert({
                provider: "razorpay",
                provider_event_id: `${prefix.toLowerCase()}_order_${order.id}`,
                event_type: "order_created",
                payload: order,
                processing_status: "processed",
                processed_at: new Date().toISOString(),
            });

            logger.info({
                action: "manage-subscription-payment",
                userId: ctx.user.id,
                message: `${action} order ${order.id} created`,
            });

            // ─────────────────────────────────────────────
            // 7. Return
            // ─────────────────────────────────────────────
            return successResponse({
                action,
                orderId: order.id,
                amount: amountPaise,
                currency: priceRec.currency || "INR",
                keyId: getKeyId(),
                planCode: targetPlanCode,
                planName: targetPlanName,
                billingPeriod,
                validityMonths: priceRec.validity_months,
                paymentPurpose,
                currentSubscriptionId: currentSub.subscription_id,
                currentEndDate: currentSub.end_date,
                testMode: isTestMode(),
            });
        } catch (err) {
            if (err instanceof ApiError) return err.toResponse();
            logger.error({
                action: "manage-subscription-payment",
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
