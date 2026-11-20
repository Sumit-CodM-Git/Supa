// ============================================================
// supabase/functions/_shared/subscription-utils.ts
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ─────────────────────────────────────────────
// Single client — service role
// ─────────────────────────────────────────────
export function serviceClient() {
    return createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
}

// ─────────────────────────────────────────────
// Flat context helper
// ─────────────────────────────────────────────
export interface FlatContext {
    society: string;
    tower: string | null;
    block: string | null;
    flatNumber: string;
}

export async function getFlatForUser(
    supabase: ReturnType<typeof serviceClient>,
    userId: string,
): Promise<FlatContext | null> {
    const { data } = await supabase
        .from("SSP_Society_User")
        .select("society, tower, block, unit_flat_number")
        .eq("user_id", userId)
        .maybeSingle();

    if (!data?.society || !data?.unit_flat_number) return null;

    return {
        society: data.society,
        tower: data.tower,
        block: data.block,
        flatNumber: data.unit_flat_number,
    };
}

/**
 * Resolve an order's block from the current flat profile only when the order
 * omitted it and the remaining location fields still identify that same flat.
 * Razorpay order notes are immutable, while a resident's block may be filled
 * in or corrected between order creation and payment capture.
 */
export async function resolveBlockForOrder(
    supabase: ReturnType<typeof serviceClient>,
    userId: string,
    orderScope: {
        society: string;
        tower: string | null;
        block: string | null;
        flatNumber: string;
    },
): Promise<string | null> {
    if (orderScope.block?.trim()) return orderScope.block.trim();

    const flat = await getFlatForUser(supabase, userId);
    if (!flat?.block) return null;

    const sameFlat = flat.society === orderScope.society &&
        (flat.tower ?? null) === (orderScope.tower ?? null) &&
        flat.flatNumber.trim().toUpperCase() ===
            orderScope.flatNumber.trim().toUpperCase();

    return sameFlat ? flat.block : null;
}

// ─────────────────────────────────────────────
// Billing helpers
// ─────────────────────────────────────────────
export const VALID_BILLING_PERIODS = [
    "MONTHLY",
    "QUARTERLY",
    "HALF_YEARLY",
    "YEARLY",
    "THREE_YEAR",
] as const;

export type BillingPeriod = typeof VALID_BILLING_PERIODS[number];

export function isValidBillingPeriod(value: string): value is BillingPeriod {
    return (VALID_BILLING_PERIODS as readonly string[]).includes(value);
}

export function rupeesToPaise(rupees: number): number {
    return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
    return paise / 100;
}
