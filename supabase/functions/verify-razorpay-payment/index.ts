// // ============================================================
// // supabase/functions/verify-razorpay-payment/index.ts
// // ============================================================
// // Primary activation path. Called by the mobile app after
// // the Razorpay checkout returns success.
// //
// // Steps:
// //   1. Verify HMAC signature
// //   2. Fetch payment from Razorpay (server-to-server)
// //   3. Confirm capture + amount matches
// //   4. Idempotency check
// //   5. Insert SSP_Payment
// //   6. Insert SSP_Subscription
// //   7. Link via SSP_Subscription_Payment
// //
// // Returns { success, subscription_id, plan_code, start_date, end_date }
// // ============================================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
// import { requireAuth } from "../_shared/auth.ts";
// import { errorResponse, successResponse } from "../_shared/response.ts";
// import {
//     ApiError,
//     badRequest,
//     notFound,
//     serverError,
// } from "../_shared/errors.ts";
// import { logger } from "../_shared/logger.ts";
// import {
//     fetchOrder,
//     fetchPayment,
//     verifyPaymentSignature,
// } from "../_shared/razorpay.ts";

// interface RequestBody {
//     razorpay_order_id: string;
//     razorpay_payment_id: string;
//     razorpay_signature: string;
// }

// serve(requireAuth(async (req, ctx) => {
//     if (req.method !== "POST") return errorResponse("Method not allowed", 405);

//     try {
//         // ─────────────────────────────────────────────
//         // 1. Parse + validate input
//         // ─────────────────────────────────────────────
//         const body = await req.json() as RequestBody;
//         const orderId = body.razorpay_order_id?.trim();
//         const paymentId = body.razorpay_payment_id?.trim();
//         const signature = body.razorpay_signature?.trim();

//         if (!orderId) throw badRequest("razorpay_order_id is required");
//         if (!paymentId) throw badRequest("razorpay_payment_id is required");
//         if (!signature) throw badRequest("razorpay_signature is required");

//         const supabase = createClient(
//             Deno.env.get("SUPABASE_URL") ?? "",
//             Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
//         );

//         // ─────────────────────────────────────────────
//         // 2. Verify HMAC signature
//         // ─────────────────────────────────────────────
//         const signatureOk = await verifyPaymentSignature({
//             orderId,
//             paymentId,
//             signature,
//         });

//         if (!signatureOk) {
//             logger.warn({
//                 action: "verify-razorpay-payment",
//                 userId: ctx.user.id,
//                 message: `Invalid signature for order ${orderId}`,
//             });
//             throw badRequest("Invalid payment signature");
//         }

//         // ─────────────────────────────────────────────
//         // 3. Idempotency — has this payment already been linked?
//         // ─────────────────────────────────────────────
//         const { data: existingLink } = await supabase
//             .from("SSP_Subscription_Payment")
//             .select("subscription_id")
//             .eq("provider", "razorpay")
//             .eq("provider_payment_id", paymentId)
//             .maybeSingle();

//         if (existingLink) {
//             const { data: subRec } = await supabase
//                 .from("SSP_Subscription")
//                 .select("subscription_id, start_date, end_date, plan_id")
//                 .eq("subscription_id", existingLink.subscription_id)
//                 .maybeSingle();

//             const { data: planRec } = await supabase
//                 .from("SSP_Subscription_Plan")
//                 .select("plan_code")
//                 .eq("plan_id", subRec?.plan_id)
//                 .maybeSingle();

//             return successResponse({
//                 success: true,
//                 already_processed: true,
//                 subscription_id: existingLink.subscription_id,
//                 plan_code: planRec?.plan_code,
//                 start_date: subRec?.start_date,
//                 end_date: subRec?.end_date,
//             });
//         }

//         // ─────────────────────────────────────────────
//         // 4. Fetch payment from Razorpay
//         // ─────────────────────────────────────────────
//         const payment = await fetchPayment(paymentId);

//         if (payment.status !== "captured") {
//             throw badRequest(
//                 `Payment not captured (status: ${payment.status})`,
//             );
//         }

//         if (payment.order_id !== orderId) {
//             throw badRequest("Payment does not belong to this order");
//         }

//         // ─────────────────────────────────────────────
//         // 5. Fetch order to read our notes
//         // ─────────────────────────────────────────────
//         const order = await fetchOrder(orderId);
//         const notes = order.notes ?? {};

//         const ownerUserId = notes.user_id;
//         const society = notes.society;
//         const tower = notes.tower || null;
//         const block = notes.block || null;
//         const flatNumber = notes.flat_number;
//         const planCode = notes.plan_code;
//         const planPriceId = notes.plan_price_id || null;
//         const validityMonths = parseInt(notes.validity_months ?? "1", 10);

//         if (!society || !flatNumber || !planCode) {
//             throw serverError("Order notes missing required fields");
//         }

//         // ─────────────────────────────────────────────
//         // 6. Verify caller is the one who created the order
//         // ─────────────────────────────────────────────
//         if (ownerUserId !== ctx.user.id) {
//             throw badRequest("This payment does not belong to you");
//         }

//         // ─────────────────────────────────────────────
//         // 7. Verify amount matches (protection against tampering)
//         // ─────────────────────────────────────────────
//         if (payment.amount !== order.amount) {
//             throw badRequest("Payment amount does not match order amount");
//         }

//         // ─────────────────────────────────────────────
//         // 8. Look up plan
//         // ─────────────────────────────────────────────
//         const { data: planRec } = await supabase
//             .from("SSP_Subscription_Plan")
//             .select("plan_id, plan_code")
//             .eq("plan_code", planCode)
//             .maybeSingle();

//         if (!planRec) throw notFound(`Plan '${planCode}' not found`);

//         // ─────────────────────────────────────────────
//         // 9. Insert SSP_Payment
//         // ─────────────────────────────────────────────
//         const { data: paymentRec, error: paymentErr } = await supabase
//             .from("SSP_Payment")
//             .insert({
//                 amount: payment.amount / 100, // paise → rupees
//                 payment_status: "paid",
//                 payment_type: "subscription",
//                 payment_method: "razorpay",
//                 payment_id: paymentId,
//                 transaction_id: paymentId,
//                 society_user: ownerUserId,
//                 payment_date: new Date().toISOString(),
//                 receipt_information: JSON.stringify({
//                     order_id: orderId,
//                     payment_id: paymentId,
//                     plan_code: planCode,
//                     billing_period: notes.billing_period,
//                 }),
//             })
//             .select("pay_rec_id")
//             .single();

//         if (paymentErr) {
//             throw serverError(
//                 `Failed to create payment record: ${paymentErr.message}`,
//             );
//         }

//         // ─────────────────────────────────────────────
//         // 10. Create subscription
//         // ─────────────────────────────────────────────
//         const startDate = new Date();
//         const endDate = new Date(startDate);
//         endDate.setMonth(endDate.getMonth() + validityMonths);

//         const { data: subRec, error: subErr } = await supabase
//             .from("SSP_Subscription")
//             .insert({
//                 society,
//                 tower,
//                 block,
//                 flat_number: flatNumber,
//                 owner_society_user: ownerUserId,
//                 plan_id: planRec.plan_id,
//                 plan_price_id: planPriceId,
//                 status: "ACTIVE",
//                 start_date: startDate.toISOString(),
//                 end_date: endDate.toISOString(),
//                 auto_renew: false,
//                 payment_provider: "razorpay",
//             })
//             .select("subscription_id")
//             .single();

//         if (subErr) {
//             throw serverError(
//                 `Failed to create subscription: ${subErr.message}`,
//             );
//         }

//         // ─────────────────────────────────────────────
//         // 11. Link subscription ↔ payment
//         // ─────────────────────────────────────────────
//         const { error: linkErr } = await supabase
//             .from("SSP_Subscription_Payment")
//             .insert({
//                 subscription_id: subRec.subscription_id,
//                 payment: paymentRec.pay_rec_id,
//                 provider: "razorpay",
//                 provider_order_id: orderId,
//                 provider_payment_id: paymentId,
//                 provider_signature_verified: true,
//                 payment_purpose: "NEW",
//                 captured_at: new Date().toISOString(),
//             });

//         if (linkErr) {
//             throw serverError(`Failed to link payment: ${linkErr.message}`);
//         }

//         // ─────────────────────────────────────────────
//         // 12. Log event
//         // ─────────────────────────────────────────────
//         await supabase.from("SSP_Payment_Event").insert({
//             provider: "razorpay",
//             provider_event_id: `PAYMENT_VERIFIED_${paymentId}`,
//             event_type: "PAYMENT_VERIFIED",
//             payload: { order_id: orderId, payment_id: paymentId },
//             processing_status: "PROCESSED",
//             processed_at: new Date().toISOString(),
//         });

//         logger.info({
//             action: "verify-razorpay-payment",
//             userId: ctx.user.id,
//             message:
//                 `Subscription ${subRec.subscription_id} activated for ${planCode}`,
//         });

//         return successResponse({
//             success: true,
//             subscription_id: subRec.subscription_id,
//             plan_code: planCode,
//             start_date: startDate.toISOString(),
//             end_date: endDate.toISOString(),
//         });
//     } catch (err) {
//         if (err instanceof ApiError) return err.toResponse();
//         logger.error({
//             action: "verify-razorpay-payment",
//             userId: ctx.user.id,
//             message: err instanceof Error ? err.message : "Unknown error",
//         });
//         return errorResponse(
//             err instanceof Error ? err.message : "Unknown error",
//             500,
//         );
//     }
// }));

// supabase/functions/verify-razorpay-payment/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import {
    ApiError,
    badRequest,
    notFound,
    serverError,
} from "../_shared/errors.ts";
import { logger } from "../_shared/logger.ts";
import {
    fetchOrder,
    fetchPayment,
    verifyPaymentSignature,
} from "../_shared/razorpay.ts";

interface RequestBody {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
}

serve(requireAuth(async (req, ctx) => {
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    try {
        const body = await req.json() as RequestBody;
        const orderId = body.razorpay_order_id?.trim();
        const paymentId = body.razorpay_payment_id?.trim();
        const signature = body.razorpay_signature?.trim();

        if (!orderId) throw badRequest("razorpay_order_id is required");
        if (!paymentId) throw badRequest("razorpay_payment_id is required");
        if (!signature) throw badRequest("razorpay_signature is required");

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );

        // ─────────────────────────────────────────────
        // 1. Verify HMAC signature
        // ─────────────────────────────────────────────
        const signatureOk = await verifyPaymentSignature({
            orderId,
            paymentId,
            signature,
        });

        if (!signatureOk) {
            logger.warn({
                action: "verify-razorpay-payment",
                userId: ctx.user.id,
                message: `Invalid signature for order ${orderId}`,
            });
            throw badRequest("Invalid payment signature");
        }

        // ─────────────────────────────────────────────
        // 2. Idempotency — already processed?
        // ─────────────────────────────────────────────
        const { data: existingLink } = await supabase
            .from("SSP_Subscription_Payment")
            .select("subscription_id")
            .eq("provider", "razorpay")
            .eq("provider_payment_id", paymentId)
            .maybeSingle();

        if (existingLink) {
            const { data: subRec } = await supabase
                .from("SSP_Subscription")
                .select("subscription_id, start_date, end_date, plan_id")
                .eq("subscription_id", existingLink.subscription_id)
                .maybeSingle();

            const { data: planRec } = await supabase
                .from("SSP_Subscription_Plan")
                .select("plan_code")
                .eq("plan_id", subRec?.plan_id)
                .maybeSingle();

            return successResponse({
                success: true,
                alreadyProcessed: true,
                subscriptionId: existingLink.subscription_id,
                planCode: planRec?.plan_code,
                startDate: subRec?.start_date,
                endDate: subRec?.end_date,
            });
        }

        // ─────────────────────────────────────────────
        // 3. Fetch payment + order from Razorpay
        // ─────────────────────────────────────────────
        const payment = await fetchPayment(paymentId);

        if (payment.status !== "captured") {
            throw badRequest(
                `Payment not captured (status: ${payment.status})`,
            );
        }
        if (payment.order_id !== orderId) {
            throw badRequest("Payment does not belong to this order");
        }

        const order = await fetchOrder(orderId);
        const notes = order.notes ?? {};

        const ownerUserId = notes.user_id;
        const society = notes.society;
        const tower = notes.tower || null;
        const block = notes.block || null;
        const flatNumber = notes.flat_number;
        const planCode = notes.plan_code;
        const planPriceId = notes.plan_price_id || null;
        const validityMonths = parseInt(notes.validity_months ?? "1", 10);
        const paymentPurpose = (notes.payment_purpose ?? "new").toLowerCase();
        const renewingSubId = notes.renewing_subscription_id || null;

        if (!society || !flatNumber || !planCode) {
            throw serverError("Order notes missing required fields");
        }
        if (ownerUserId !== ctx.user.id) {
            throw badRequest("This payment does not belong to you");
        }
        if (payment.amount !== order.amount) {
            throw badRequest("Payment amount does not match order amount");
        }

        // ─────────────────────────────────────────────
        // 4. Look up plan
        // ─────────────────────────────────────────────
        const { data: planRec } = await supabase
            .from("SSP_Subscription_Plan")
            .select("plan_id, plan_code")
            .eq("plan_code", planCode)
            .maybeSingle();

        if (!planRec) throw notFound(`Plan '${planCode}' not found`);

        // ─────────────────────────────────────────────
        // 5. Insert SSP_Payment (always)
        // ─────────────────────────────────────────────
        const { data: paymentRec, error: paymentErr } = await supabase
            .from("SSP_Payment")
            .insert({
                amount: payment.amount / 100,
                payment_status: "paid",
                payment_type: "subscription",
                payment_method: "razorpay",
                payment_id: paymentId,
                transaction_id: paymentId,
                society_user: ownerUserId,
                payment_date: new Date().toISOString(),
                receipt_information: JSON.stringify({
                    order_id: orderId,
                    payment_id: paymentId,
                    plan_code: planCode,
                    billing_period: notes.billing_period,
                    payment_purpose: paymentPurpose,
                }),
            })
            .select("pay_rec_id")
            .single();

        if (paymentErr) {
            throw serverError(
                `Failed to create payment record: ${paymentErr.message}`,
            );
        }

        // ─────────────────────────────────────────────
        // 6. Branch on purpose
        // ─────────────────────────────────────────────
        let subscriptionId: string;
        let startDate: string;
        let endDate: string;

        if (paymentPurpose === "renewal") {
            // ─────────────────────────────────────────────
            // RENEWAL — extend existing subscription
            // ─────────────────────────────────────────────
            if (!renewingSubId) {
                throw serverError(
                    "RENEWAL order missing renewing_subscription_id",
                );
            }

            const { data: existing, error: fetchErr } = await supabase
                .from("SSP_Subscription")
                .select("subscription_id, start_date, end_date, status")
                .eq("subscription_id", renewingSubId)
                .single();

            if (fetchErr || !existing) {
                throw serverError("Renewal target subscription not found");
            }

            // Extend from GREATEST(end_date, NOW())
            const now = new Date();
            const existingEnd = existing.end_date
                ? new Date(existing.end_date)
                : null;
            const baseDate = existingEnd && existingEnd > now
                ? existingEnd
                : now;

            const newStart = existing.start_date ?? now.toISOString();
            const newEnd = new Date(baseDate);
            newEnd.setMonth(newEnd.getMonth() + validityMonths);

            const { error: updateErr } = await supabase
                .from("SSP_Subscription")
                .update({
                    status: "active",
                    end_date: newEnd.toISOString(),
                    plan_price_id: planPriceId,
                    updated_at: now.toISOString(),
                })
                .eq("subscription_id", renewingSubId);

            if (updateErr) {
                throw serverError(
                    `Failed to extend subscription: ${updateErr.message}`,
                );
            }

            subscriptionId = renewingSubId;
            startDate = newStart;
            endDate = newEnd.toISOString();
        } else if (paymentPurpose === "upgrade") {
            // ─────────────────────────────────────────────
            // UPGRADE — replace plan on existing subscription
            // ─────────────────────────────────────────────
            if (!renewingSubId) {
                throw serverError(
                    "UPGRADE order missing renewing_subscription_id",
                );
            }

            const { data: existing } = await supabase
                .from("SSP_Subscription")
                .select("subscription_id, start_date")
                .eq("subscription_id", renewingSubId)
                .single();

            const now = new Date();
            const newEnd = new Date(now);
            newEnd.setMonth(newEnd.getMonth() + validityMonths);

            const { error: updateErr } = await supabase
                .from("SSP_Subscription")
                .update({
                    plan_id: planRec.plan_id,
                    plan_price_id: planPriceId,
                    status: "active",
                    start_date: now.toISOString(),
                    end_date: newEnd.toISOString(),
                    auto_renew: false,
                    payment_provider: "razorpay",
                    updated_at: now.toISOString(),
                })
                .eq("subscription_id", renewingSubId);

            if (updateErr) {
                throw serverError(
                    `Failed to upgrade subscription: ${updateErr.message}`,
                );
            }

            subscriptionId = renewingSubId;
            startDate = now.toISOString();
            endDate = newEnd.toISOString();
        } else {
            // ─────────────────────────────────────────────
            // NEW — first-time subscription
            // ─────────────────────────────────────────────
            const startDateObj = new Date();
            const endDateObj = new Date(startDateObj);
            endDateObj.setMonth(endDateObj.getMonth() + validityMonths);

            const { data: subRec, error: subErr } = await supabase
                .from("SSP_Subscription")
                .insert({
                    society,
                    tower,
                    block,
                    flat_number: flatNumber,
                    owner_society_user: ownerUserId,
                    plan_id: planRec.plan_id,
                    plan_price_id: planPriceId,
                    status: "active",
                    start_date: startDateObj.toISOString(),
                    end_date: endDateObj.toISOString(),
                    auto_renew: false,
                    payment_provider: "razorpay",
                })
                .select("subscription_id")
                .single();

            if (subErr) {
                throw serverError(
                    `Failed to create subscription: ${subErr.message}`,
                );
            }

            subscriptionId = subRec.subscription_id;
            startDate = startDateObj.toISOString();
            endDate = endDateObj.toISOString();
        }

        // ─────────────────────────────────────────────
        // 7. Link subscription ↔ payment
        // ─────────────────────────────────────────────
        const { error: linkErr } = await supabase
            .from("SSP_Subscription_Payment")
            .insert({
                subscription_id: subscriptionId,
                payment: paymentRec.pay_rec_id,
                provider: "razorpay",
                provider_order_id: orderId,
                provider_payment_id: paymentId,
                provider_signature_verified: true,
                payment_purpose: paymentPurpose,
                captured_at: new Date().toISOString(),
            });

        if (linkErr) {
            throw serverError(`Failed to link payment: ${linkErr.message}`);
        }

        // ─────────────────────────────────────────────
        // 8. Audit log
        // ─────────────────────────────────────────────
        await supabase.from("SSP_Payment_Event").insert({
            provider: "razorpay",
            provider_event_id: `PAYMENT_VERIFIED_${paymentId}`,
            event_type: "PAYMENT_VERIFIED",
            payload: {
                order_id: orderId,
                payment_id: paymentId,
                purpose: paymentPurpose,
            },
            processing_status: "PROCESSED",
            processed_at: new Date().toISOString(),
        });

        logger.info({
            action: "verify-razorpay-payment",
            userId: ctx.user.id,
            message: `Subscription ${subscriptionId} ${
                paymentPurpose === "renewal"
                    ? "renewed"
                    : paymentPurpose === "upgrade"
                    ? "upgraded"
                    : "activated"
            }`,
        });

        return successResponse({
            success: true,
            subscriptionId,
            planCode,
            startDate,
            endDate,
            paymentPurpose,
        });
    } catch (err) {
        if (err instanceof ApiError) return err.toResponse();
        logger.error({
            action: "verify-razorpay-payment",
            userId: ctx.user.id,
            message: err instanceof Error ? err.message : "Unknown",
        });
        return errorResponse(
            err instanceof Error ? err.message : "Unknown",
            500,
        );
    }
}));
