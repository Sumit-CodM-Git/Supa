// deno-lint-ignore-file no-import-prefix
// ============================================
// update-parking-occupancy - Gate Keeper Updates Covered Parking
// ============================================
// A security guard / gate keeper updates the number of occupied
// covered parking slots. The API then recomputes openParking.
//
//   openParking = totalParkingSlot - coveredParking
//
// Auth: memberId (SSP_Society_User.user_id) with role in
//       ["security",  "gate_keeper"]
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface UpdateParkingOccupancyRequest {
    societyRegistrationNumber: string;
    memberId: string;
    coveredParking: number | string;
}

interface SocietyParkingRow {
    society_id: string;
    parking_slot: string | null;
    covered_parking: number | null;
    open_parking: number | null;
}

interface SocietyUserRow {
    user_id: string;
    role: string[] | string | null;
    status: boolean | null;
}

// ============================================
// CONSTANTS
// ============================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Roles allowed to update parking occupancy
const ALLOWED_ROLES = [
    "security",
] as const;

const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================

function respond(data: unknown, status = 200): Response {
    return new Response(
        JSON.stringify({ status: "SUCCESS", data }),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

function fail(message: string, status = 400, code = "ERROR"): Response {
    return new Response(
        JSON.stringify({
            status: "FAILURE",
            errorResponse: { errorCode: code, message },
        }),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

function isValidUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(value);
}

/**
 * Normalize role field — could be array, or Postgres text[] literal string
 * like '["security","resident"]' or '{security,resident}'.
 */
function normalizeRole(value: string[] | string | null | undefined): string[] {
    if (!value) return [];

    if (Array.isArray(value)) {
        return value
            .filter((r): r is string => typeof r === "string")
            .map((r) => r.trim().toLowerCase())
            .filter(Boolean);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        // Postgres array literal: {security,resident} or ["security","resident"]
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return trimmed
                .replace(/^[\[{]/, "")
                .replace(/[\]}]$/, "")
                .split(",")
                .map((r) => r.replace(/["']/g, "").trim().toLowerCase())
                .filter(Boolean);
        }
        return [trimmed.toLowerCase()];
    }

    return [];
}

function parseNonNegativeNumber(
    value: number | string | undefined,
): { ok: true; value: number } | { ok: false } {
    if (value === undefined || value === null || value === "") {
        return { ok: false };
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return { ok: false };
    return { ok: true, value: Math.floor(n) };
}

// ============================================
// AUTH
// ============================================

async function authorizeSecurity(
    societyId: string,
    memberId: string,
): Promise<
    { ok: true; userId: string } | { ok: false; response: Response }
> {
    const cleanMemberId = String(memberId).trim();

    if (!isValidUUID(cleanMemberId)) {
        return {
            ok: false,
            response: fail(
                "memberId must be a valid UUID.",
                400,
                "INVALID_PARAMETERS",
            ),
        };
    }

    const { data: member, error: memberErr } = await supabase
        .from("SSP_Society_User")
        .select("user_id, role, status")
        .eq("user_id", cleanMemberId)
        .eq("society", societyId)
        .maybeSingle();

    if (memberErr) {
        return {
            ok: false,
            response: fail(memberErr.message, 500, "DATABASE_ERROR"),
        };
    }

    if (!member) {
        return {
            ok: false,
            response: fail(
                "Unauthorized. Member does not belong to this society.",
                403,
                "UNAUTHORIZED",
            ),
        };
    }

    const row = member as SocietyUserRow;

    if (row.status === false) {
        return {
            ok: false,
            response: fail(
                "Unauthorized. Member account is inactive.",
                403,
                "UNAUTHORIZED",
            ),
        };
    }

    const roles = normalizeRole(row.role);
    const hasAllowedRole = roles.some((r) =>
        (ALLOWED_ROLES as readonly string[]).includes(r)
    );

    if (!hasAllowedRole) {
        return {
            ok: false,
            response: fail(
                `Unauthorized. Allowed roles: ${ALLOWED_ROLES.join(", ")}.`,
                403,
                "UNAUTHORIZED",
            ),
        };
    }

    return { ok: true, userId: row.user_id };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return fail("Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
    }

    const startTime = Date.now();

    try {
        const body = (await req.json().catch(() => null)) as
            | UpdateParkingOccupancyRequest
            | null;
        if (!body) return fail("Request body is required.", 400, "BAD_REQUEST");

        const { societyRegistrationNumber, memberId, coveredParking } = body;

        // ── Validate required fields ──
        if (
            !societyRegistrationNumber ||
            String(societyRegistrationNumber).trim() === ""
        ) {
            return fail(
                "societyRegistrationNumber is required.",
                400,
                "MISSING_PARAMETERS",
            );
        }
        if (!memberId || String(memberId).trim() === "") {
            return fail("memberId is required.", 400, "MISSING_PARAMETERS");
        }
        if (coveredParking === undefined || coveredParking === null) {
            return fail(
                "coveredParking is required.",
                400,
                "MISSING_PARAMETERS",
            );
        }

        const parsedCovered = parseNonNegativeNumber(coveredParking);
        if (!parsedCovered.ok) {
            return fail(
                "coveredParking must be a non-negative number.",
                400,
                "INVALID_PARAMETERS",
            );
        }

        // ── Resolve society ──
        const { data: society, error: societyErr } = await supabase
            .from("SSP_Society")
            .select("society_id,parking_slot,covered_parking,open_parking")
            .eq("registration_number", String(societyRegistrationNumber).trim())
            .maybeSingle();

        if (societyErr) {
            return fail(societyErr.message, 500, "DATABASE_ERROR");
        }
        if (
            !society ||
            typeof society !== "object" ||
            !("society_id" in society)
        ) {
            return fail("Society not found.", 404, "NOT_FOUND");
        }

        const societyTyped = society as SocietyParkingRow;
        const societyId = societyTyped.society_id;

        // ── Authorize member (must be security/gate keeper) ──
        const auth = await authorizeSecurity(societyId, String(memberId));
        if (!auth.ok) return auth.response;

        // ── Validate: coveredParking ≤ totalParkingSlot ──
        const totalParkingSlot = Number(societyTyped.parking_slot ?? 0);
        const newCovered = parsedCovered.value;

        if (newCovered > totalParkingSlot) {
            return fail(
                `coveredParking (${newCovered}) cannot exceed totalParkingSlot (${totalParkingSlot}).`,
                400,
                "INVALID_PARAMETERS",
            );
        }

        // ── Compute openParking ──
        const newOpen = totalParkingSlot - newCovered;

        // ── Update ──
        const { error: updateErr } = await supabase
            .from("SSP_Society")
            .update({
                covered_parking: newCovered,
                open_parking: newOpen,
            } as never)
            .eq("society_id", societyId);

        if (updateErr) {
            return fail(updateErr.message, 500, "DATABASE_ERROR");
        }

        console.log(
            `✅ update-parking-occupancy: society=${societyId}, ` +
                `member=${auth.userId}, covered=${newCovered}, open=${newOpen}, ` +
                `${Date.now() - startTime}ms`,
        );

        return respond({
            societyId,
            totalParkingSlot,
            coveredParking: newCovered,
            openParking: newOpen,
            message: "Parking occupancy updated successfully.",
        });
    } catch (err: unknown) {
        console.error("❌ FULL ERROR:", err);

        let msg = "Unknown error";
        if (err instanceof Error) {
            msg = err.message;
        } else if (typeof err === "string") {
            msg = err;
        } else if (err && typeof err === "object" && "message" in err) {
            msg = String((err as { message: unknown }).message);
        } else if (err && typeof err === "object") {
            try {
                msg = JSON.stringify(err);
            } catch {
                msg = "Unserializable error";
            }
        }

        console.error("❌ update-parking-occupancy error:", msg);
        return fail(msg, 500, "SERVER_ERROR");
    }
});
