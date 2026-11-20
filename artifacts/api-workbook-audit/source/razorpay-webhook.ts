import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { fetchOrder, verifyWebhookSignature } from "../_shared/razorpay.ts";
import { logger } from "../_shared/logger.ts";
interface RazorpayWebhookEvent {
    entity: string;
    account_id: string;
    event: string;
    contains: string[];
    payload: Record<string, {
        entity: Record<string, unknown>;
    }>;
    created_at: number;
    id?: string;
}
function serviceClient() {
    return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}
serve(async (req) => {
    const reply = (message: string, status = 200) => new Response(JSON.stringify({ received: status === 200, message }), { status, headers: { "Content-Type": "application/json" } });
    if (req.method !== "POST")
        return reply("Only POST is allowed", 405);
    try {
        const rawBody = await req.text();
        const signature = req.headers.get("x-razorpay-signature") ?? "";
        if (!signature)
            return reply("Missing signature", 401);
        if (!await verifyWebhookSignature({ rawBody, signature })) {
            return reply("Invalid signature", 401);
        }
        let event: RazorpayWebhookEvent;
        try {
            event = JSON.parse(rawBody);
        }
        catch {
            return reply("Invalid JSON", 400);
        }
        const eventType = event?.event;
        if (typeof eventType !== "string" || !eventType)
            return reply("Missing event type", 400);
        const entityId = event.payload?.payment?.entity?.id ?? event.payload?.refund?.entity?.id;
        const providerEventId = req.headers.get("x-razorpay-event-id")?.trim() ||
            event.id || (entityId ? `${eventType}:${entityId}` : null);
        if (!providerEventId)
            return reply("Missing event ID", 400);
        const supabase = serviceClient();
        const now = new Date().toISOString();
        const { data: inserted, error: insertErr } = await supabase
            .from("SSP_Payment_Event")
            .insert({ provider: "razorpay", provider_event_id: providerEventId,
            event_type: eventType, payload: event, processing_status: "pending", updated_at: now })
            .select("payment_event_id").single();
        let eventRowId = inserted?.payment_event_id;
        let progress: Record<string, any> = {};
        if (insertErr) {
            if (insertErr.code !== "23505")
                throw insertErr;
            const { data: existing, error: lookupErr } = await supabase
                .from("SSP_Payment_Event")
                .select("payment_event_id, processing_status, updated_at, payload")
                .eq("provider", "razorpay").eq("provider_event_id", providerEventId).maybeSingle();
            if (lookupErr)
                throw lookupErr;
            if (!existing)
                return reply("Event lookup failed; retry", 503);
            if (String(existing.processing_status).toLowerCase() === "processed")
                return reply("Already processed");
            const stale = Date.now() - new Date(existing.updated_at ?? now).getTime() > 10 * 60 * 1000;
            if (String(existing.processing_status).toLowerCase() !== "failed" && !stale) {
                return reply("Event processing in progress; retry", 503);
            }
            const { data: claimed, error: claimErr } = await supabase
                .from("SSP_Payment_Event")
                .update({ processing_status: "pending", error_message: null, updated_at: now })
                .eq("payment_event_id", existing.payment_event_id)
                .eq("processing_status", existing.processing_status)
                .eq("updated_at", existing.updated_at)
                .select("payment_event_id").maybeSingle();
            if (claimErr)
                throw claimErr;
            if (!claimed)
                return reply("Event processing in progress; retry", 503);
            eventRowId = claimed.payment_event_id;
            progress = existing.payload?._webhook_progress ?? {};
        }
        if (!eventRowId)
            throw new Error("Failed to log event");
        const saveProgress = async () => {
            const { error } = await supabase.from("SSP_Payment_Event")
                .update({ payload: { ...event, _webhook_progress: progress }, updated_at: new Date().toISOString() })
                .eq("payment_event_id", eventRowId);
            if (error)
                throw error;
        };
        try {
            switch (eventType) {
                case "payment.captured":
                    await handlePaymentCaptured(supabase, event.payload.payment.entity, progress, saveProgress);
                    break;
                case "payment.failed":
                    await handlePaymentFailed(supabase, event.payload.payment.entity);
                    break;
                case "refund.processed":
                    await handleRefundProcessed(supabase, event.payload.refund.entity);
                    break;
                case "refund.failed":
                    await handleRefundFailed(supabase, event.payload.refund.entity);
                    break;
                default:
                    logger.info({ action: "razorpay-webhook", message: `Unhandled event type: ${eventType}` });
            }
            const { error } = await supabase.from("SSP_Payment_Event")
                .update({ processing_status: "processed", processed_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() })
                .eq("payment_event_id", eventRowId);
            if (error)
                throw error;
            return reply("Event received");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String((error as any)?.message ?? "Processing failed");
            await supabase.from("SSP_Payment_Event")
                .update({ processing_status: "failed", error_message: message, updated_at: new Date().toISOString() })
                .eq("payment_event_id", eventRowId);
            logger.error({ action: "razorpay-webhook", message });
            return reply("Processing failed; retry", 500);
        }
    }
    catch (error) {
        logger.error({ action: "razorpay-webhook", message: String((error as any)?.message ?? error) });
        return reply("Processing failed; retry", 500);
    }
});
async function handlePaymentCaptured(supabase: ReturnType<typeof serviceClient>, payment: Record<string, unknown>, progress: Record<string, any>, saveProgress: () => Promise<void>) {
    const paymentId = payment.id as string;
    const orderId = payment.order_id as string;
    if (!paymentId || !orderId) {
        logger.warn({
            action: "razorpay-webhook",
            message: "payment.captured: missing paymentId or orderId",
        });
        return;
    }
    const { data: existing, error: existingErr } = await supabase
        .from("SSP_Subscription_Payment")
        .select("subscription_id")
        .eq("provider", "razorpay")
        .eq("provider_payment_id", paymentId)
        .maybeSingle();
    if (existingErr)
        throw existingErr;
    if (existing) {
        logger.info({
            action: "razorpay-webhook",
            message: `payment.captured: already linked (${paymentId})`,
        });
        return;
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
    if (!society || !flatNumber || !planCode || !ownerUserId) {
        throw new Error("payment.captured: order notes missing required fields");
    }
    const { data: planRec } = await supabase
        .from("SSP_Subscription_Plan")
        .select("plan_id")
        .eq("plan_code", planCode)
        .maybeSingle();
    if (!planRec)
        throw new Error(`Plan '${planCode}' not found`);
    let paymentRec = progress.paymentRecordId ? { pay_rec_id: progress.paymentRecordId } : null;
    if (!paymentRec) {
        const { data: createdPayment, error: paymentErr } = await supabase
            .from("SSP_Payment")
            .insert({
            amount: (payment.amount as number) / 100,
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
                source: "webhook",
                payment_purpose: paymentPurpose,
            }),
        })
            .select("pay_rec_id")
            .single();
        if (paymentErr) {
            throw new Error(`Failed to create payment: ${paymentErr.message}`);
        }
        paymentRec = createdPayment;
        progress.paymentRecordId = paymentRec.pay_rec_id;
        await saveProgress();
    }
    let subscriptionId: string;
    if (progress.subscriptionId) {
        subscriptionId = progress.subscriptionId;
    }
    else if (paymentPurpose === "renewal" && renewingSubId) {
        const { data: existing } = await supabase
            .from("SSP_Subscription")
            .select("start_date, end_date")
            .eq("subscription_id", renewingSubId)
            .single();
        if (!existing)
            throw new Error("Renewal target subscription not found");
        const now = new Date();
        const existingEnd = existing.end_date ? new Date(existing.end_date) : null;
        const baseDate = existingEnd && existingEnd > now ? existingEnd : now;
        const newEnd = progress.targetEndDate ? new Date(progress.targetEndDate) : new Date(baseDate);
        if (!progress.targetEndDate) {
            newEnd.setMonth(newEnd.getMonth() + validityMonths);
            progress.targetEndDate = newEnd.toISOString();
            await saveProgress();
        }
        const { error: writeError1 } = await supabase
            .from("SSP_Subscription")
            .update({
            status: "active",
            end_date: newEnd.toISOString(),
            plan_price_id: planPriceId,
            updated_at: now.toISOString(),
        })
            .eq("subscription_id", renewingSubId);
        if (writeError1)
            throw writeError1;
        subscriptionId = renewingSubId;
    }
    else if (paymentPurpose === "upgrade" && renewingSubId) {
        const now = new Date();
        const newEnd = new Date(now);
        newEnd.setMonth(newEnd.getMonth() + validityMonths);
        const { error: writeError2 } = await supabase
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
        if (writeError2)
            throw writeError2;
        subscriptionId = renewingSubId;
    }
    else {
        const now = new Date();
        const newEnd = new Date(now);
        newEnd.setMonth(newEnd.getMonth() + validityMonths);
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
            start_date: now.toISOString(),
            end_date: newEnd.toISOString(),
            auto_renew: false,
            payment_provider: "razorpay",
        })
            .select("subscription_id")
            .single();
        if (subErr) {
            throw new Error(`Failed to create subscription: ${subErr.message}`);
        }
        subscriptionId = subRec.subscription_id;
    }
    progress.subscriptionId = subscriptionId;
    await saveProgress();
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
        if (linkErr.code === "23505") {
            logger.info({
                action: "razorpay-webhook",
                message: `Link already exists for payment ${paymentId}`,
            });
            return;
        }
        throw new Error(`Failed to link payment: ${linkErr.message}`);
    }
    logger.info({
        action: "razorpay-webhook",
        message: `payment.captured: activated subscription ${subscriptionId}`,
    });
}
async function handlePaymentFailed(supabase: ReturnType<typeof serviceClient>, payment: Record<string, unknown>) {
    logger.warn({
        action: "razorpay-webhook",
        message: `payment.failed: ${payment.id}, reason: ${payment.error_description ?? "no reason provided"}`,
        paymentId: payment.id as string,
        orderId: (payment.order_id as string) ?? "",
        amount: (payment.amount as number) ?? 0,
        currency: (payment.currency as string) ?? "",
        errorCode: (payment.error_code as string) ?? "",
        errorDescription: (payment.error_description as string) ?? "",
        errorSource: (payment.error_source as string) ?? "",
        errorStep: (payment.error_step as string) ?? "",
        errorReason: (payment.error_reason as string) ?? "",
        email: (payment.email as string) ?? "",
        contact: (payment.contact as string) ?? "",
    });
}
async function handleRefundProcessed(supabase: ReturnType<typeof serviceClient>, refund: Record<string, unknown>) {
    const paymentId = refund.payment_id as string;
    const razorpayRefundId = refund.id as string;
    const refundAmount = (refund.amount as number) / 100;
    if (!paymentId) {
        logger.warn({
            action: "razorpay-webhook",
            message: "refund.processed: missing payment_id",
        });
        return;
    }
    const { data: link, error: linkLookupError } = await supabase
        .from("SSP_Subscription_Payment")
        .select("subscription_id, subscription_payment_id")
        .eq("provider", "razorpay")
        .eq("provider_payment_id", paymentId)
        .maybeSingle();
    if (linkLookupError)
        throw linkLookupError;
    if (!link) {
        logger.warn({
            action: "razorpay-webhook",
            message: `refund.processed: no subscription link for payment ${paymentId}`,
        });
        throw new Error("Refund payment link not available yet");
    }
    const { data: refundRow } = await supabase
        .from("SSP_Refund")
        .select("refund_id, status")
        .eq("subscription_id", link.subscription_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (refundRow) {
        if (refundRow.status !== "processed") {
            const { error: writeError3 } = await supabase
                .from("SSP_Refund")
                .update({
                status: "processed",
                provider_refund_id: razorpayRefundId,
                approved_amount: refundAmount,
                processed_at: new Date().toISOString(),
                razorpay_response: refund,
            })
                .eq("refund_id", refundRow.refund_id);
            if (writeError3)
                throw writeError3;
        }
    }
    const { data: sub } = await supabase
        .from("SSP_Subscription")
        .select("subscription_id, status, cancelled_at")
        .eq("subscription_id", link.subscription_id)
        .single();
    if (sub && sub.status !== "cancelled") {
        const { error: writeError4 } = await supabase
            .from("SSP_Subscription")
            .update({
            status: "cancelled",
            cancelled_at: sub.cancelled_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
            .eq("subscription_id", link.subscription_id);
        if (writeError4)
            throw writeError4;
        logger.info({
            action: "razorpay-webhook",
            message: `refund.processed: cancelled subscription ${link.subscription_id}`,
        });
    }
}
async function handleRefundFailed(supabase: ReturnType<typeof serviceClient>, refund: Record<string, unknown>) {
    const paymentId = refund.payment_id as string;
    logger.warn({
        action: "razorpay-webhook",
        message: `refund.failed for payment ${paymentId}`,
    });
    if (!paymentId)
        return;
    const { data: link, error: linkLookupError } = await supabase
        .from("SSP_Subscription_Payment")
        .select("subscription_id")
        .eq("provider", "razorpay")
        .eq("provider_payment_id", paymentId)
        .maybeSingle();
    if (linkLookupError)
        throw linkLookupError;
    if (!link)
        throw new Error("Refund payment link not available yet");
    const { error: writeError5 } = await supabase
        .from("SSP_Refund")
        .update({ status: "failed" })
        .eq("subscription_id", link.subscription_id)
        .neq("status", "processed");
    if (writeError5)
        throw writeError5;
}
