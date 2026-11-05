// supabase/functions/request-refund/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import {
    ApiError,
    badRequest,
    notFound,
    serverError,
} from "../_shared/errors.ts";
import { serviceClient } from "../_shared/subscription-utils.ts";
import { logger } from "../_shared/logger.ts";
import { withRateLimit } from "../_shared/rate-limit.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";

function toCamel<T = unknown>(input: unknown): T {
    if (input === null || input === undefined) return input as T;
    if (Array.isArray(input)) {
        return input.map((item) => toCamel(item)) as unknown as T;
    }
    if (typeof input === "object" && !(input instanceof Date)) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
            const camelKey = k.replace(
                /_([a-z0-9])/g,
                (_, c: string) => c.toUpperCase(),
            );
            out[camelKey] = toCamel(v);
        }
        return out as T;
    }
    return input as T;
}

function razorpayAuth(): string {
    const id = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
    const secret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
    return "Basic " + btoa(`${id}:${secret}`);
}

interface RequestBody {
    action: "PREVIEW" | "REQUEST";
    reason?: string;
}

interface RefundCalculation {
    eligible: boolean;
    refundAmount: number;
    paymentAmount: number;
    currency: string;
    policy: "FULL_REFUND" | "PRORATED";
    reasonRequired: boolean;
    hoursSincePayment: number;
    totalDays: number;
    remainingDays: number;
    subscriptionId: string;
    paymentId: string;
    razorpayPaymentId: string;
    message: string;
}

serve(requireAuth(
    withRateLimit(
        (userId: string) => `request-refund:${userId}`,
        5,
        60,
    )(async (req, ctx) => {
        if (req.method !== "POST") {
            return errorResponse("Method not allowed", 405);
        }

        try {
            const body = await req.json() as RequestBody;
            const action = (body.action ?? "PREVIEW").toUpperCase();

            if (!["PREVIEW", "REQUEST"].includes(action)) {
                throw badRequest("action must be PREVIEW or REQUEST");
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
                throw badRequest("Your flat is not configured.");
            }

            const { society, tower, block, unit_flat_number: flatNumber } =
                userRec;

            // ─────────────────────────────────────────────
            // 2. Find current active subscription
            // ─────────────────────────────────────────────
            const { data: candidates } = await supabase
                .from("SSP_Subscription")
                .select(`
                    subscription_id, plan_id, society, tower, block, flat_number,
                    owner_society_user, status, start_date, end_date
                `)
                .eq("society", society)
                .eq("flat_number", flatNumber)
                .in("status", ["active", "trial"])
                .order("created_at", { ascending: false })
                .limit(10);

            const currentSub = (candidates ?? []).find((s) => {
                const t = (s.tower ?? null) === (tower ?? null);
                const b = (s.block ?? null) === (block ?? null);
                return t && b;
            });

            if (!currentSub) {
                throw notFound("No active subscription to refund.");
            }

            if (currentSub.owner_society_user !== ctx.user.id) {
                throw badRequest(
                    "Only the subscription owner can request a refund.",
                );
            }

            // ─────────────────────────────────────────────
            // 3. Find the latest SUBSCRIPTION payment for this subscription
            // ─────────────────────────────────────────────
            const { data: subPayment, error: spErr } = await supabase
                .from("SSP_Subscription_Payment")
                .select(`
                    subscription_payment_id,
                    payment,
                    provider_payment_id,
                    captured_at,
                    payment_purpose,
                    payment:SSP_Payment!inner(
                        pay_rec_id, amount, payment_status, payment_date,
                        payment_type, payment_method, society_user
                    )
                `)
                .eq("subscription_id", currentSub.subscription_id)
                .eq("provider", "razorpay")
                .not("provider_payment_id", "is", null)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (spErr) throw serverError(spErr.message);
            if (!subPayment?.payment) {
                throw notFound("No payment found for this subscription.");
            }

            const payment = subPayment.payment as unknown as {
                pay_rec_id: string;
                amount: number;
                payment_status: string;
                payment_date: string | null;
                payment_type: string;
                payment_method: string;
                society_user: string;
            };

            // ─────────────────────────────────────────────
            // 4. Idempotency — already refunded?
            // ─────────────────────────────────────────────
            const { data: existingRefund } = await supabase
                .from("SSP_Refund")
                .select(
                    "refund_id, provider_refund_id, status, requested_amount, processed_at",
                )
                .eq("payment", payment.pay_rec_id)
                .in("status", ["processing", "processed"])
                .maybeSingle();

            if (existingRefund) {
                return successResponse({
                    success: true,
                    alreadyRefunded: true,
                    refundId: existingRefund.refund_id,
                    razorpayRefundId: existingRefund.provider_refund_id,
                    refundAmount: existingRefund.requested_amount,
                    status: existingRefund.status,
                    processedAt: existingRefund.processed_at,
                });
            }

            // ─────────────────────────────────────────────
            // 5. Calculate refund amount
            // ─────────────────────────────────────────────
            const paymentDate = payment.payment_date
                ? new Date(payment.payment_date)
                : new Date(subPayment.captured_at ?? new Date().toISOString());

            const now = new Date();
            const hoursSincePayment = (now.getTime() - paymentDate.getTime()) /
                (1000 * 60 * 60);

            const startDate = new Date(currentSub.start_date);
            const endDate = currentSub.end_date
                ? new Date(currentSub.end_date)
                : null;

            if (!endDate) {
                throw badRequest(
                    "Your subscription has no end date. Cannot compute refund.",
                );
            }

            const totalDays = Math.max(
                Math.floor(
                    (endDate.getTime() - startDate.getTime()) /
                        (1000 * 60 * 60 * 24),
                ),
                1,
            );
            const remainingDays = Math.max(
                Math.floor(
                    (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
                ),
                0,
            );

            const paymentAmount = Number(payment.amount);

            let refundAmount: number;
            let policy: "FULL_REFUND" | "PRORATED";
            let reasonRequired: boolean;

            if (hoursSincePayment < 24) {
                // Full refund
                refundAmount = Math.floor(paymentAmount);
                policy = "FULL_REFUND";
                reasonRequired = false;
            } else {
                // Prorated
                if (remainingDays <= 0) {
                    throw badRequest(
                        "Your subscription has no remaining days to refund.",
                    );
                }
                refundAmount = Math.floor(
                    (remainingDays / totalDays) * paymentAmount,
                );
                if (refundAmount <= 0) {
                    throw badRequest(
                        "Refund amount is too small. No refund available.",
                    );
                }
                policy = "PRORATED";
                reasonRequired = true;
            }

            const calculation: RefundCalculation = {
                eligible: true,
                refundAmount,
                paymentAmount,
                currency: "INR",
                policy,
                reasonRequired,
                hoursSincePayment: Math.floor(hoursSincePayment),
                totalDays,
                remainingDays,
                subscriptionId: currentSub.subscription_id,
                paymentId: payment.pay_rec_id,
                razorpayPaymentId: subPayment.provider_payment_id!,
                message: policy === "FULL_REFUND"
                    ? "You are within 24 hours of payment. Full refund available."
                    : `Refund is prorated. You will lose access immediately.`,
            };

            // ─────────────────────────────────────────────
            // 6. PREVIEW — return calculation, no side effects
            // ─────────────────────────────────────────────
            if (action === "PREVIEW") {
                return successResponse(calculation);
            }

            // ─────────────────────────────────────────────
            // 7. REQUEST — execute refund
            // ─────────────────────────────────────────────

            // Reason required for prorated refunds
            const reason = (body.reason ?? "").trim();
            if (reasonRequired && reason.length < 10) {
                throw badRequest(
                    "A reason of at least 10 characters is required for prorated refunds.",
                );
            }

            // Insert refund row with status=requested
            const { data: refundRow, error: refundErr } = await supabase
                .from("SSP_Refund")
                .insert({
                    payment: payment.pay_rec_id,
                    subscription_id: currentSub.subscription_id,
                    requested_by: ctx.user.id,
                    requested_amount: refundAmount,
                    reason: reason || "Full refund within 24 hours",
                    status: "requested",
                    refund_policy: policy,
                    calculation_details: calculation as unknown as Record<
                        string,
                        unknown
                    >,
                })
                .select("refund_id")
                .single();

            if (refundErr) {
                throw serverError(
                    `Failed to create refund record: ${refundErr.message}`,
                );
            }

            // Call Razorpay refund API
            const refundAmountPaise = refundAmount * 100;

            const razorpayRes = await fetch(
                `${RAZORPAY_API}/payments/${subPayment.provider_payment_id}/refund`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": razorpayAuth(),
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        amount: refundAmountPaise,
                        speed: "normal",
                        notes: {
                            subscription_id: currentSub.subscription_id,
                            user_id: ctx.user.id,
                            policy,
                            reason: reason.slice(0, 200),
                        },
                    }),
                },
            );

            const rzpData = await razorpayRes.json();

            if (!razorpayRes.ok) {
                // Mark refund as failed
                await supabase
                    .from("SSP_Refund")
                    .update({
                        status: "failed",
                        razorpay_response: rzpData,
                    })
                    .eq("refund_id", refundRow.refund_id);

                logger.error({
                    action: "request-refund",
                    userId: ctx.user.id,
                    message: `Razorpay refund failed: ${
                        JSON.stringify(rzpData)
                    }`,
                });

                throw serverError(
                    `Refund failed at Razorpay: ${
                        rzpData?.error?.description ?? "Unknown error"
                    }`,
                );
            }

            const razorpayRefundId = rzpData.id as string;

            // ─────────────────────────────────────────────
            // 8. Success — update refund + cancel subscription
            // ─────────────────────────────────────────────

            // Update refund row
            await supabase
                .from("SSP_Refund")
                .update({
                    provider_refund_id: razorpayRefundId,
                    approved_amount: refundAmount,
                    status: "processed",
                    processed_at: new Date().toISOString(),
                    razorpay_response: rzpData,
                })
                .eq("refund_id", refundRow.refund_id);

            // Cancel the subscription (immediate — user loses access)
            await supabase
                .from("SSP_Subscription")
                .update({
                    status: "cancelled",
                    auto_renew: false,
                    cancel_reason: `Refund requested: ${
                        reason || "Within 24h"
                    }`,
                    cancelled_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("subscription_id", currentSub.subscription_id);

            // Audit log
            await supabase.from("SSP_Payment_Event").insert({
                provider: "razorpay",
                provider_event_id: `REFUND_INITIATED_${razorpayRefundId}`,
                event_type: "REFUND_INITIATED",
                payload: { refund: rzpData, calculation },
                processing_status: "PROCESSED",
                processed_at: new Date().toISOString(),
            });

            logger.info({
                action: "request-refund",
                userId: ctx.user.id,
                message:
                    `Refund ${razorpayRefundId} processed for sub ${currentSub.subscription_id}`,
            });

            // ─────────────────────────────────────────────
            // 9. Return
            // ─────────────────────────────────────────────
            return successResponse({
                success: true,
                refundId: refundRow.refund_id,
                razorpayRefundId,
                refundAmount,
                currency: "INR",
                policy,
                status: "processed",
                subscriptionId: currentSub.subscription_id,
                cancelledAt: new Date().toISOString(),
                estimatedCreditDays: "5-7 business days",
            });
        } catch (err) {
            if (err instanceof ApiError) return err.toResponse();
            logger.error({
                action: "request-refund",
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
