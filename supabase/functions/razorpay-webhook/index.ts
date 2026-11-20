// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// serve(async (req) => {
//   try {
//     // 1. Read request payload
//     const body = await req.json();
//     const providerEventId = body.payload?.payment?.entity?.id || req.headers.get("x-razorpay-event-id");

//     // 2. Initialize Supabase Service Role Client
//     const supabaseClient = createClient(
//       Deno.env.get("SUPABASE_URL") ?? "",
//       Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
//     );

//     // 3. Log event into SSP_Payment_Event (Idempotency check handled via provider_event_id UNIQUE constraint)
//     const { data, error } = await supabaseClient
//       .from("SSP_Payment_Event")
//       .insert({
//         provider: "razorpay",
//         provider_event_id: providerEventId,
//         event_type: body.event,
//         payload: body,
//         processing_status: "PENDING"
//       });

//     if (error) {
//       // If error code is duplicate key (23505), return success to avoid retry loops from provider
//       if (error.code === "23505") {
//         return new Response(JSON.stringify({ message: "Event already logged" }), { status: 200 });
//       }
//       throw error;
//     }

//     return new Response(JSON.stringify({ success: true }), {
//       headers: { "Content-Type": "application/json" },
//       status: 200,
//     });
//   } catch (err) {
//     return new Response(JSON.stringify({ error: err.message }), {
//       headers: { "Content-Type": "application/json" },
//       status: 400,
//     });
//   }
// });

// // ============================================================
// // supabase/functions/razorpay-webhook/index.ts
// // ============================================================
// // Backup activation path. Razorpay POSTs async events here.
// //
// // Design:
// //   • Verify webhook signature (RAZORPAY_WEBHOOK_SECRET)
// //   • Idempotency via SSP_Payment_Event.provider_event_id UNIQUE
// //   • Return 200 always (even on error) so Razorpay doesn't retry forever
// //
// // Handled events:
// //   • payment.captured  → activate subscription if not already done
// //   • payment.failed    → mark failed
// //   • refund.processed  → mark subscription REFUNDED
// // ============================================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
// import { fetchOrder, verifyWebhookSignature } from "../_shared/razorpay.ts";
// import { logger } from "../_shared/logger.ts";

// serve(async (req) => {
//   // Always respond 200 to prevent Razorpay retries
//   const ack = (message: string) =>
//     new Response(JSON.stringify({ received: true, message }), {
//       status: 200,
//       headers: { "Content-Type": "application/json" },
//     });

//   try {
//     // ─────────────────────────────────────────────
//     // 1. Read raw body
//     // ─────────────────────────────────────────────
//     const rawBody = await req.text();
//     const signature = req.headers.get("x-razorpay-signature") ?? "";

//     // ─────────────────────────────────────────────
//     // 2. Verify webhook signature
//     // ─────────────────────────────────────────────
//     const signatureOk = await verifyWebhookSignature({ rawBody, signature });
//     if (!signatureOk) {
//       logger.warn({
//         action: "razorpay-webhook",
//         message: "Invalid webhook signature — rejecting",
//       });
//       return ack("Invalid signature");
//     }

//     // ─────────────────────────────────────────────
//     // 3. Parse event
//     // ─────────────────────────────────────────────
//     const event = JSON.parse(rawBody);
//     const eventType = event.event as string;
//     const providerEventId = event.id ?? event.payload?.payment?.entity?.id ??
//       event.payload?.refund?.entity?.id;

//     if (!providerEventId) {
//       logger.warn({ action: "razorpay-webhook", message: "No event ID" });
//       return ack("No event ID");
//     }

//     const supabase = createClient(
//       Deno.env.get("SUPABASE_URL") ?? "",
//       Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
//     );

//     // ─────────────────────────────────────────────
//     // 4. Idempotency — insert event log
//     // ─────────────────────────────────────────────
//     const { data: inserted, error: insertErr } = await supabase
//       .from("SSP_Payment_Event")
//       .insert({
//         provider: "razorpay",
//         provider_event_id: providerEventId,
//         event_type: eventType,
//         payload: event,
//         processing_status: "PENDING",
//       })
//       .select("payment_event_id")
//       .single();

//     if (insertErr) {
//       if (insertErr.code === "23505") {
//         return ack("Already processed");
//       }
//       throw insertErr;
//     }

//     const eventRowId = inserted.payment_event_id;

//     // ─────────────────────────────────────────────
//     // 5. Process by event type
//     // ─────────────────────────────────────────────
//     try {
//       switch (eventType) {
//         case "payment.captured":
//           await handlePaymentCaptured(supabase, event.payload.payment.entity);
//           break;
//         case "payment.failed":
//           await handlePaymentFailed(supabase, event.payload.payment.entity);
//           break;
//         case "refund.processed":
//           await handleRefundProcessed(supabase, event.payload.refund.entity);
//           break;
//         default:
//           logger.info({
//             action: "razorpay-webhook",
//             message: `Unhandled event type: ${eventType}`,
//           });
//       }

//       await supabase
//         .from("SSP_Payment_Event")
//         .update({
//           processing_status: "PROCESSED",
//           processed_at: new Date().toISOString(),
//         })
//         .eq("payment_event_id", eventRowId);
//     } catch (processErr) {
//       const msg = processErr instanceof Error ? processErr.message : "Unknown";

//       await supabase
//         .from("SSP_Payment_Event")
//         .update({
//           processing_status: "FAILED",
//           error_message: msg,
//         })
//         .eq("payment_event_id", eventRowId);

//       logger.error({
//         action: "razorpay-webhook",
//         message: `Processing failed: ${msg}`,
//       });
//     }

//     return ack("Event received");
//   } catch (err) {
//     logger.error({
//       action: "razorpay-webhook",
//       message: err instanceof Error ? err.message : "Unknown error",
//     });
//     return ack("Error logged");
//   }
// });

// // ─────────────────────────────────────────────
// // Handlers
// // ─────────────────────────────────────────────

// async function handlePaymentCaptured(
//   supabase: ReturnType<typeof createClient>,
//   payment: Record<string, unknown>,
// ) {
//   const paymentId = payment.id as string;
//   const orderId = payment.order_id as string;

//   if (!paymentId || !orderId) {
//     logger.warn({
//       action: "razorpay-webhook",
//       message: "payment.captured: missing paymentId or orderId",
//     });
//     return;
//   }

//   // Idempotency — already linked?
//   const { data: existing } = await supabase
//     .from("SSP_Subscription_Payment")
//     .select("subscription_id")
//     .eq("provider", "razorpay")
//     .eq("provider_payment_id", paymentId)
//     .maybeSingle();

//   if (existing) {
//     logger.info({
//       action: "razorpay-webhook",
//       message: `payment.captured: already linked (${paymentId})`,
//     });
//     return;
//   }

//   // Fetch order notes
//   const order = await fetchOrder(orderId);
//   const notes = order.notes ?? {};

//   const ownerUserId = notes.user_id;
//   const society = notes.society;
//   const tower = notes.tower || null;
//   const block = notes.block || null;
//   const flatNumber = notes.flat_number;
//   const planCode = notes.plan_code;
//   const planPriceId = notes.plan_price_id || null;
//   const validityMonths = parseInt(notes.validity_months ?? "1", 10);

//   if (!society || !flatNumber || !planCode || !ownerUserId) {
//     throw new Error("payment.captured: order notes missing required fields");
//   }

//   // Look up plan
//   const { data: planRec } = await supabase
//     .from("SSP_Subscription_Plan")
//     .select("plan_id")
//     .eq("plan_code", planCode)
//     .maybeSingle();

//   if (!planRec) throw new Error(`Plan '${planCode}' not found`);

//   // Insert SSP_Payment
//   const { data: paymentRec, error: paymentErr } = await supabase
//     .from("SSP_Payment")
//     .insert({
//       amount: (payment.amount as number) / 100,
//       payment_status: "paid",
//       payment_type: "subscription",
//       payment_method: "razorpay",
//       payment_id: paymentId,
//       transaction_id: paymentId,
//       society_user: ownerUserId,
//       payment_date: new Date().toISOString(),
//       receipt_information: JSON.stringify({
//         order_id: orderId,
//         payment_id: paymentId,
//         source: "webhook",
//       }),
//     })
//     .select("pay_rec_id")
//     .single();

//   if (paymentErr) {
//     throw new Error(`Failed to create payment: ${paymentErr.message}`);
//   }

//   // Create subscription
//   const startDate = new Date();
//   const endDate = new Date(startDate);
//   endDate.setMonth(endDate.getMonth() + validityMonths);

//   const { data: subRec, error: subErr } = await supabase
//     .from("SSP_Subscription")
//     .insert({
//       society,
//       tower,
//       block,
//       flat_number: flatNumber,
//       owner_society_user: ownerUserId,
//       plan_id: planRec.plan_id,
//       plan_price_id: planPriceId,
//       status: "ACTIVE",
//       start_date: startDate.toISOString(),
//       end_date: endDate.toISOString(),
//       auto_renew: false,
//       payment_provider: "razorpay",
//     })
//     .select("subscription_id")
//     .single();

//   if (subErr) {
//     throw new Error(`Failed to create subscription: ${subErr.message}`);
//   }

//   // Link
//   const { error: linkErr } = await supabase
//     .from("SSP_Subscription_Payment")
//     .insert({
//       subscription_id: subRec.subscription_id,
//       payment: paymentRec.pay_rec_id,
//       provider: "razorpay",
//       provider_order_id: orderId,
//       provider_payment_id: paymentId,
//       provider_signature_verified: true,
//       payment_purpose: "NEW",
//       captured_at: new Date().toISOString(),
//     });

//   if (linkErr) throw new Error(`Failed to link: ${linkErr.message}`);

//   logger.info({
//     action: "razorpay-webhook",
//     message:
//       `payment.captured: activated subscription ${subRec.subscription_id}`,
//   });
// }

// async function handlePaymentFailed(
//   supabase: ReturnType<typeof createClient>,
//   payment: Record<string, unknown>,
// ) {
//   logger.info({
//     action: "razorpay-webhook",
//     message:
//       `payment.failed: ${payment.id}, reason: ${payment.error_description}`,
//   });
// }

// async function handleRefundProcessed(
//   supabase: ReturnType<typeof createClient>,
//   refund: Record<string, unknown>,
// ) {
//   const paymentId = refund.payment_id as string;
//   if (!paymentId) return;

//   // Find the subscription via the payment link
//   const { data: link } = await supabase
//     .from("SSP_Subscription_Payment")
//     .select("subscription_id")
//     .eq("provider", "razorpay")
//     .eq("provider_payment_id", paymentId)
//     .maybeSingle();

//   if (!link) {
//     logger.warn({
//       action: "razorpay-webhook",
//       message:
//         `refund.processed: no subscription found for payment ${paymentId}`,
//     });
//     return;
//   }

//   await supabase
//     .from("SSP_Subscription")
//     .update({ status: "REFUNDED" })
//     .eq("subscription_id", link.subscription_id);

//   logger.info({
//     action: "razorpay-webhook",
//     message:
//       `refund.processed: subscription ${link.subscription_id} marked REFUNDED`,
//   });
// }

// supabase/functions/razorpay-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { fetchOrder, verifyWebhookSignature } from "../_shared/razorpay.ts";
import { logger } from "../_shared/logger.ts";

interface RazorpayWebhookEvent {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: Record<string, { entity: Record<string, unknown> }>;
  created_at: number;
  id?: string;
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

serve(async (req) => {
  // Always 200 — Razorpay retries non-2xx responses
  const ack = (message: string) =>
    new Response(JSON.stringify({ received: true, message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  try {
    // ─────────────────────────────────────────────
    // 1. Read raw body for signature verification
    // ─────────────────────────────────────────────
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") ?? "";

    if (!signature) {
      logger.warn({
        action: "razorpay-webhook",
        message: "Missing signature header",
      });
      return ack("Missing signature");
    }

    // ─────────────────────────────────────────────
    // 2. Verify webhook signature
    // ─────────────────────────────────────────────
    const signatureOk = await verifyWebhookSignature({ rawBody, signature });
    if (!signatureOk) {
      logger.warn({
        action: "razorpay-webhook",
        message: "Invalid webhook signature",
      });
      return ack("Invalid signature");
    }

    // ─────────────────────────────────────────────
    // 3. Parse event
    // ─────────────────────────────────────────────
    const event = JSON.parse(rawBody) as RazorpayWebhookEvent;
    const eventType = event.event;

    // Dedup key: prefer event.id, fall back to payment/refund id
    const providerEventId = event.id ??
      (event.payload?.payment?.entity?.id as string | undefined) ??
      (event.payload?.refund?.entity?.id as string | undefined) ??
      `${eventType}_${event.created_at}`;

    if (!providerEventId) {
      logger.warn({
        action: "razorpay-webhook",
        message: "No provider_event_id in payload",
      });
      return ack("No event ID");
    }

    const supabase = serviceClient();

    // ─────────────────────────────────────────────
    // 4. Idempotency — insert event log
    // ─────────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from("SSP_Payment_Event")
      .insert({
        provider: "razorpay",
        provider_event_id: providerEventId,
        event_type: eventType,
        payload: event,
        processing_status: "pending",
      })
      .select("payment_event_id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        // Duplicate — already processed
        return ack("Already processed");
      }
      throw insertErr;
    }

    const eventRowId = inserted.payment_event_id;

    // ─────────────────────────────────────────────
    // 5. Process by event type
    // ─────────────────────────────────────────────
    try {
      switch (eventType) {
        case "payment.captured":
          await handlePaymentCaptured(supabase, event.payload.payment.entity);
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
          logger.info({
            action: "razorpay-webhook",
            message: `Unhandled event type: ${eventType}`,
          });
      }

      await supabase
        .from("SSP_Payment_Event")
        .update({
          processing_status: "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("payment_event_id", eventRowId);
    } catch (processErr) {
      const msg = processErr instanceof Error ? processErr.message : "Unknown";
      logger.error({
        action: "razorpay-webhook",
        message: `Processing failed: ${msg}`,
      });

      await supabase
        .from("SSP_Payment_Event")
        .update({
          processing_status: "failed",
          error_message: msg,
        })
        .eq("payment_event_id", eventRowId);
    }

    return ack("Event received");
  } catch (err) {
    logger.error({
      action: "razorpay-webhook",
      message: err instanceof Error ? err.message : "Unknown",
    });
    return ack("Error logged");
  }
});

// ─────────────────────────────────────────────
// payment.captured
// ─────────────────────────────────────────────

async function handlePaymentCaptured(
  supabase: ReturnType<typeof serviceClient>,
  payment: Record<string, unknown>,
) {
  const paymentId = payment.id as string;
  const orderId = payment.order_id as string;

  if (!paymentId || !orderId) {
    logger.warn({
      action: "razorpay-webhook",
      message: "payment.captured: missing paymentId or orderId",
    });
    return;
  }

  // ─────────────────────────────────────────────
  // Idempotency — client verify already created it?
  // ─────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("SSP_Subscription_Payment")
    .select("subscription_id")
    .eq("provider", "razorpay")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();

  if (existing) {
    logger.info({
      action: "razorpay-webhook",
      message: `payment.captured: already linked (${paymentId})`,
    });
    return;
  }

  // ─────────────────────────────────────────────
  // Fetch order notes
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // Look up plan
  // ─────────────────────────────────────────────
  const { data: planRec } = await supabase
    .from("SSP_Subscription_Plan")
    .select("plan_id")
    .eq("plan_code", planCode)
    .maybeSingle();

  if (!planRec) throw new Error(`Plan '${planCode}' not found`);

  // ─────────────────────────────────────────────
  // Insert SSP_Payment
  // ─────────────────────────────────────────────
  const { data: paymentRec, error: paymentErr } = await supabase
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

  // ─────────────────────────────────────────────
  // Branch on purpose (mirrors verify-razorpay-payment)
  // ─────────────────────────────────────────────
  let subscriptionId: string;

  if (paymentPurpose === "renewal" && renewingSubId) {
    // Extend existing
    const { data: existing } = await supabase
      .from("SSP_Subscription")
      .select("start_date, end_date")
      .eq("subscription_id", renewingSubId)
      .single();

    if (!existing) throw new Error("Renewal target subscription not found");

    const now = new Date();
    const existingEnd = existing.end_date ? new Date(existing.end_date) : null;
    const baseDate = existingEnd && existingEnd > now ? existingEnd : now;
    const newEnd = new Date(baseDate);
    newEnd.setMonth(newEnd.getMonth() + validityMonths);

    await supabase
      .from("SSP_Subscription")
      .update({
        status: "active",
        end_date: newEnd.toISOString(),
        plan_price_id: planPriceId,
        updated_at: now.toISOString(),
      })
      .eq("subscription_id", renewingSubId);

    subscriptionId = renewingSubId;
  } else if (paymentPurpose === "upgrade" && renewingSubId) {
    // Replace plan
    const now = new Date();
    const newEnd = new Date(now);
    newEnd.setMonth(newEnd.getMonth() + validityMonths);

    await supabase
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

    subscriptionId = renewingSubId;
  } else {
    // NEW subscription
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

  // ─────────────────────────────────────────────
  // Link payment ↔ subscription
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
    // 23505 = unique violation → client verify already linked
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

// ─────────────────────────────────────────────
// payment.failed
// ─────────────────────────────────────────────

async function handlePaymentFailed(
  supabase: ReturnType<typeof serviceClient>,
  payment: Record<string, unknown>,
) {
  logger.warn({
    action: "razorpay-webhook",
    message: `payment.failed: ${payment.id}, reason: ${
      payment.error_description ?? "no reason provided"
    }`,
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

// ─────────────────────────────────────────────
// refund.processed
// ─────────────────────────────────────────────

async function handleRefundProcessed(
  supabase: ReturnType<typeof serviceClient>,
  refund: Record<string, unknown>,
) {
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

  // Find the subscription via the payment link
  const { data: link } = await supabase
    .from("SSP_Subscription_Payment")
    .select("subscription_id, subscription_payment_id")
    .eq("provider", "razorpay")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();

  if (!link) {
    logger.warn({
      action: "razorpay-webhook",
      message:
        `refund.processed: no subscription link for payment ${paymentId}`,
    });
    return;
  }

  // Find the SSP_Refund row for this payment
  const { data: refundRow } = await supabase
    .from("SSP_Refund")
    .select("refund_id, status")
    .eq("subscription_id", link.subscription_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (refundRow) {
    // Update refund to processed (idempotent — only update if not already)
    if (refundRow.status !== "processed") {
      await supabase
        .from("SSP_Refund")
        .update({
          status: "processed",
          provider_refund_id: razorpayRefundId,
          approved_amount: refundAmount,
          processed_at: new Date().toISOString(),
          razorpay_response: refund,
        })
        .eq("refund_id", refundRow.refund_id);
    }
  }

  // Cancel the subscription (idempotent)
  const { data: sub } = await supabase
    .from("SSP_Subscription")
    .select("subscription_id, status, cancelled_at")
    .eq("subscription_id", link.subscription_id)
    .single();

  if (sub && sub.status !== "cancelled") {
    await supabase
      .from("SSP_Subscription")
      .update({
        status: "cancelled",
        cancelled_at: sub.cancelled_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("subscription_id", link.subscription_id);

    logger.info({
      action: "razorpay-webhook",
      message:
        `refund.processed: cancelled subscription ${link.subscription_id}`,
    });
  }
}

// ─────────────────────────────────────────────
// refund.failed
// ─────────────────────────────────────────────

async function handleRefundFailed(
  supabase: ReturnType<typeof serviceClient>,
  refund: Record<string, unknown>,
) {
  const paymentId = refund.payment_id as string;

  logger.warn({
    action: "razorpay-webhook",
    message: `refund.failed for payment ${paymentId}`,
  });

  if (!paymentId) return;

  const { data: link } = await supabase
    .from("SSP_Subscription_Payment")
    .select("subscription_id")
    .eq("provider", "razorpay")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();

  if (!link) return;

  await supabase
    .from("SSP_Refund")
    .update({ status: "failed" })
    .eq("subscription_id", link.subscription_id)
    .neq("status", "processed");
}
