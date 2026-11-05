// supabase/functions/_shared/entitlements.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export interface FeatureCheckResult {
    allowed: boolean;
    currentPlan: string;
    requiredFeature: string;
    reason?: string;
}

function serviceClient() {
    return createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
}

export async function checkFeature(
    userId: string,
    featureCode: string,
): Promise<FeatureCheckResult> {
    const supabase = serviceClient();

    const { data: userRec, error: userErr } = await supabase
        .from("SSP_Society_User")
        .select("society, tower, block, unit_flat_number")
        .eq("user_id", userId)
        .maybeSingle();

    if (userErr || !userRec?.society || !userRec?.unit_flat_number) {
        return {
            allowed: false,
            currentPlan: "UNKNOWN",
            requiredFeature: featureCode,
            reason: userErr
                ? `Failed to resolve user: ${userErr.message}`
                : "Your flat is not configured.",
        };
    }

    const { data: entitlements, error: entitleErr } = await supabase.rpc(
        "get_entitlements",
        {
            p_society: userRec.society,
            p_tower: userRec.tower,
            p_block: userRec.block,
            p_flat: userRec.unit_flat_number,
        },
    );

    if (entitleErr) {
        return {
            allowed: false,
            currentPlan: "UNKNOWN",
            requiredFeature: featureCode,
            reason: `Failed to load entitlements: ${entitleErr.message}`,
        };
    }

    const { data: planCode } = await supabase.rpc("get_current_plan_code", {
        p_society: userRec.society,
        p_tower: userRec.tower,
        p_block: userRec.block,
        p_flat: userRec.unit_flat_number,
    });

    const allowed = entitlements?.[featureCode] === true;

    return {
        allowed,
        currentPlan: (planCode as string) ?? "FREE",
        requiredFeature: featureCode,
        reason: allowed
            ? undefined
            : `${featureCode} is not available in your current plan.`,
    };
}

export async function requireFeature(
    userId: string,
    featureCode: string,
): Promise<Response | null> {
    const result = await checkFeature(userId, featureCode);
    if (result.allowed) return null;

    return new Response(
        JSON.stringify({
            success: false,
            error: "FEATURE_NOT_AVAILABLE",
            message:
                `This feature requires an upgrade. Current plan: ${result.currentPlan}.`,
            requiredFeature: result.requiredFeature,
            currentPlan: result.currentPlan,
            upgradeRequired: true,
        }),
        {
            status: 402,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        },
    );
}
