// supabase/functions/create-razorpay-order/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { camelResponse, errorResponse } from "../_shared/response.ts";
import {
    ApiError,
    badRequest,
    notFound,
    serverError,
} from "../_shared/errors.ts";
import {
    getFlatForUser,
    serviceClient,
} from "../_shared/subscription-utils.ts";
import { logger } from "../_shared/logger.ts";
import { createOrder, getKeyId, isTestMode } from "../_shared/razorpay.ts";

interface RequestBody {
    planCode: string;
    billingPeriod: string;
}

serve(requireAuth(async (req, ctx) => {
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    try {
        // ── camelCase input ──
        const body = await req.json() as RequestBody;
        const planCode = (body.planCode ?? "").trim().toUpperCase();
        const billingPeriod = (body.billingPeriod ?? "").trim().toLowerCase();

        if (!planCode) throw badRequest("planCode is required");
        if (!billingPeriod) throw badRequest("billingPeriod is required");
        if (planCode === "FREE") {
            throw badRequest("FREE plan does not require payment");
        }

        // ⭐ Lowercase valid periods (matches DB values)
        const validPeriods = [
            "monthly",
            "quarterly",
            "half_yearly",
            "yearly",
            "three_year",
        ];
        if (!validPeriods.includes(billingPeriod)) {
            throw badRequest(
                `billingPeriod must be one of: ${validPeriods.join(", ")}`,
            );
        }

        const supabase = serviceClient();
        const flat = await getFlatForUser(supabase, ctx.user.id);
        if (!flat) throw badRequest("Your flat is not configured");

        const { data: eligibility } = await supabase.rpc("can_subscribe", {
            p_user_id: ctx.user.id,
            p_society: flat.society,
            p_tower: flat.tower,
            p_block: flat.block,
            p_flat: flat.flatNumber,
        });

        if (!eligibility?.allowed) {
            return errorResponse(eligibility?.reason ?? "Not eligible", 403);
        }

        const { data: planRec } = await supabase
            .from("SSP_Subscription_Plan")
            .select("plan_id, plan_code, plan_name")
            .eq("plan_code", planCode)
            .eq("is_active", true)
            .maybeSingle();

        if (!planRec) throw notFound(`Plan '${planCode}' not found`);

        const { data: priceRec } = await supabase
            .from("SSP_Subscription_Plan_Price")
            .select("plan_price_id, amount, currency, validity_months")
            .eq("plan_id", planRec.plan_id)
            .eq("billing_period", billingPeriod)
            .eq("is_active", true)
            .maybeSingle();

        if (!priceRec) {
            throw notFound(
                `Price for '${planCode} ${billingPeriod}' not configured`,
            );
        }

        const amountRupees = Number(priceRec.amount);
        if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
            throw badRequest("Plan price not configured yet");
        }

        const amountPaise = Math.round(amountRupees * 100);
        const receipt = `sub_${
            ctx.user.id.replace(/-/g, "").slice(0, 10)
        }_${Date.now()}`;

        // ⭐ Razorpay notes: snake_case keys (Razorpay-facing)
        const order = await createOrder({
            amount: amountPaise,
            currency: (priceRec.currency ?? "INR").toUpperCase(),
            receipt,
            notes: {
                user_id: ctx.user.id,
                society: flat.society,
                tower: flat.tower ?? "",
                block: flat.block ?? "",
                flat_number: flat.flatNumber,
                plan_code: planRec.plan_code,
                plan_price_id: priceRec.plan_price_id,
                billing_period: billingPeriod,
                validity_months: String(priceRec.validity_months),
                payment_purpose: "new", // ⭐ add this
            },
        });

        await supabase.from("SSP_Payment_Event").insert({
            provider: "razorpay",
            provider_event_id: `order_created_${order.id}`,
            event_type: "order_created",
            payload: order,
            processing_status: "processed", // ⭐ lowercase (your convention)
            processed_at: new Date().toISOString(),
        });

        logger.info({
            action: "create-razorpay-order",
            userId: ctx.user.id,
            message:
                `Order ${order.id} created for ${planCode} ${billingPeriod}`,
        });

        // ⭐ camelCase response keys
        return camelResponse({
            orderId: order.id,
            amount: amountPaise,
            currency: (priceRec.currency ?? "INR").toUpperCase(),
            keyId: getKeyId(),
            planCode: planRec.plan_code,
            planName: planRec.plan_name,
            billingPeriod: billingPeriod,
            validityMonths: priceRec.validity_months,
            testMode: isTestMode(),
        });
    } catch (err) {
        if (err instanceof ApiError) return err.toResponse();
        logger.error({
            action: "create-razorpay-order",
            userId: ctx.user.id,
            message: err instanceof Error ? err.message : "Unknown",
        });
        return errorResponse(
            err instanceof Error ? err.message : "Unknown",
            500,
        );
    }
}));
