// deno-lint-ignore-file no-import-prefix
// ============================================
// crud-society - Manage Society-Level Fields
// ============================================
// Actions: VIEW | UPDATE
// Auth: adminId in body
//
// Derived fields (READ ONLY — computed from related data):
//   • currentAmenities → SSP_Facility.name
//   • totalUnits       → Σ (floors × flats_per_floor) across active towers
//   • openParkingCount → totalParkingSlot - coveredParking
//
// Editable fields (admin):
//   • societyName, subscriptionPlan, address*, city, state,
//     postalCode, phoneNumber, email, totalParkingSlot
//
// NOTE: coveredParking is updated by the gate keeper via the
//       separate `update-parking-occupancy` API — NOT here.
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface CrudSocietyRequest {
    societyRegistrationNumber: string;
    adminId: string;
    action: "VIEW" | "UPDATE";
    payload?: {
        societyName?: string;
        subscriptionPlan?: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        phoneNumber?: string;
        email?: string;
        // ✅ Admin-only editable parking field
        totalParkingSlot?: number | string;
        // ⚠️ coveredParking — REMOVED (gate keeper updates via separate API)
        // ⚠️ openParking — auto-computed
        // ⚠️ totalUnits — auto-derived from towers
        // ⚠️ amenities — auto-derived from facilities
    };
}

interface SocietyRow {
    society_id: string;
    society_name: string | null;
    registration_number: string | null;
    subscription_plan: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    phone_number: string | null;
    email: string | null;
    total_unit: number | null;
    open_parking: number | null;
    covered_parking: number | null;
    parking_slot: string | null;
    amenities: string[] | null;
    active: boolean | null;
    updated_at: string | null;
}

interface FacilityNameRow {
    name: string | null;
}

interface TowerCapacityRow {
    floors: number | null;
    flats_per_floor: number | null;
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

const VALID_ACTIONS = ["VIEW", "UPDATE"] as const;
const ADMIN_ROLE = "admin";

const SOCIETY_SELECT_FIELDS =
    "society_id,society_name,registration_number,subscription_plan," +
    "address_line1,address_line2,city,state,postal_code," +
    "phone_number,email,total_unit,open_parking,covered_parking," +
    "parking_slot,amenities,active,updated_at";

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

function formatAddress(s: SocietyRow): string | null {
    const parts = [
        s.address_line1,
        s.address_line2,
        s.city,
        s.state,
        s.postal_code,
    ].filter((p) => p && String(p).trim() !== "");
    return parts.length > 0 ? parts.join(", ") : null;
}

function formatSociety(
    s: SocietyRow,
    currentAmenities: string[],
    totalUnitsFromTowers: number,
) {
    const totalParking = Number(s.parking_slot ?? 0);
    const coveredParking = Number(s.covered_parking ?? 0);
    const openParking = Math.max(0, totalParking - coveredParking);

    return {
        societyId: s.society_id,
        societyName: s.society_name ?? "Unnamed Society",
        registrationNumber: s.registration_number,
        subscriptionPlan: s.subscription_plan,
        address: formatAddress(s),
        phoneNumber: s.phone_number,
        email: s.email,
        lastUpdated: s.updated_at,
        totalUnits: totalUnitsFromTowers,
        openParkingCount: openParking,
        coveredParkingCount: coveredParking,
        totalParkingSlot: s.parking_slot ?? "0",
        currentAmenities,
        active: s.active ?? true,
    };
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
// DERIVED VALUES
// ============================================

async function fetchCurrentAmenities(societyId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from("SSP_Facility")
        .select("name")
        .eq("society", societyId);

    if (error) throw error;

    const names = ((data ?? []) as FacilityNameRow[])
        .map((r) => r.name?.trim())
        .filter((n): n is string => !!n && n.length > 0);

    return Array.from(new Set(names)).sort();
}

async function fetchTotalUnits(societyId: string): Promise<number> {
    const { data, error } = await supabase
        .from("SSP_Tower")
        .select("floors,flats_per_floor")
        .eq("society", societyId)
        .eq("active", true);

    if (error) throw error;

    const rows = (data ?? []) as TowerCapacityRow[];
    return rows.reduce((sum, t) => {
        const floors = Number(t.floors ?? 0);
        const flats = Number(t.flats_per_floor ?? 0);
        return sum + (floors * flats);
    }, 0);
}

// ============================================
// AUTH
// ============================================

async function authorizeAdmin(
    societyRegistrationNumber: string,
    adminId: string,
): Promise<
    { ok: true; societyId: string } | { ok: false; response: Response }
> {
    const cleanRegNum = String(societyRegistrationNumber).trim();
    const cleanAdminId = String(adminId).trim();

    if (!isValidUUID(cleanAdminId)) {
        return {
            ok: false,
            response: fail(
                "adminId must be a valid UUID.",
                400,
                "INVALID_PARAMETERS",
            ),
        };
    }

    const { data: society, error: societyErr } = await supabase
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", cleanRegNum)
        .maybeSingle();

    if (societyErr) {
        return {
            ok: false,
            response: fail(societyErr.message, 500, "DATABASE_ERROR"),
        };
    }
    if (!society) {
        return {
            ok: false,
            response: fail("Society not found.", 404, "NOT_FOUND"),
        };
    }

    const { data: admin, error: adminErr } = await supabase
        .from("SSP_Society_User")
        .select("user_id, role")
        .eq("user_id", cleanAdminId)
        .eq("society", society.society_id)
        .contains("role", [ADMIN_ROLE])
        .maybeSingle();

    if (adminErr) {
        return {
            ok: false,
            response: fail(adminErr.message, 500, "DATABASE_ERROR"),
        };
    }

    if (!admin) {
        return {
            ok: false,
            response: fail("Unauthorized Admin Access.", 403, "UNAUTHORIZED"),
        };
    }

    return { ok: true, societyId: society.society_id };
}

// ============================================
// ACTIONS
// ============================================

async function handleView(societyId: string): Promise<Response> {
    const [societyRes, amenities, totalUnitsFromTowers] = await Promise.all([
        supabase
            .from("SSP_Society")
            .select(SOCIETY_SELECT_FIELDS)
            .eq("society_id", societyId)
            .maybeSingle(),
        fetchCurrentAmenities(societyId),
        fetchTotalUnits(societyId),
    ]);

    if (societyRes.error) {
        return fail(societyRes.error.message, 500, "DATABASE_ERROR");
    }
    if (
        !societyRes.data ||
        typeof societyRes.data !== "object" ||
        !("society_id" in societyRes.data)
    ) {
        return fail("Society not found.", 404, "NOT_FOUND");
    }

    return respond({
        society: formatSociety(
            societyRes.data as SocietyRow,
            amenities,
            totalUnitsFromTowers,
        ),
    });
}

async function handleUpdate(
    req: CrudSocietyRequest,
    societyId: string,
): Promise<Response> {
    const p = req.payload;
    if (!p || Object.keys(p).length === 0) {
        return fail("payload cannot be empty.", 400, "MISSING_PARAMETERS");
    }

    const updatePayload: Record<string, unknown> = {};
    const updatedFields: string[] = [];

    // ── String fields ──
    if (p.societyName !== undefined) {
        const v = String(p.societyName).trim();
        if (v === "") {
            return fail(
                "societyName cannot be empty.",
                400,
                "INVALID_PARAMETERS",
            );
        }
        updatePayload.society_name = v;
        updatedFields.push("societyName");
    }
    if (p.subscriptionPlan !== undefined) {
        updatePayload.subscription_plan = p.subscriptionPlan
            ? String(p.subscriptionPlan).trim()
            : null;
        updatedFields.push("subscriptionPlan");
    }
    if (p.addressLine1 !== undefined) {
        updatePayload.address_line1 = p.addressLine1
            ? String(p.addressLine1).trim()
            : null;
        updatedFields.push("addressLine1");
    }
    if (p.addressLine2 !== undefined) {
        updatePayload.address_line2 = p.addressLine2
            ? String(p.addressLine2).trim()
            : null;
        updatedFields.push("addressLine2");
    }
    if (p.city !== undefined) {
        updatePayload.city = p.city ? String(p.city).trim() : null;
        updatedFields.push("city");
    }
    if (p.state !== undefined) {
        updatePayload.state = p.state ? String(p.state).trim() : null;
        updatedFields.push("state");
    }
    if (p.postalCode !== undefined) {
        updatePayload.postal_code = p.postalCode
            ? String(p.postalCode).trim()
            : null;
        updatedFields.push("postalCode");
    }
    if (p.phoneNumber !== undefined) {
        updatePayload.phone_number = p.phoneNumber
            ? String(p.phoneNumber).trim()
            : null;
        updatedFields.push("phoneNumber");
    }
    if (p.email !== undefined) {
        updatePayload.email = p.email ? String(p.email).trim() : null;
        updatedFields.push("email");
    }

    // ── Parking: admin can only set totalParkingSlot ──
    const hasTotalParkingUpdate = p.totalParkingSlot !== undefined;

    if (hasTotalParkingUpdate) {
        const parsed = parseNonNegativeNumber(p.totalParkingSlot);
        if (!parsed.ok) {
            return fail(
                "totalParkingSlot must be a non-negative number.",
                400,
                "INVALID_PARAMETERS",
            );
        }
        updatePayload.parking_slot = String(parsed.value);
        updatedFields.push("totalParkingSlot");
    }

    // ⚠️ coveredParking NOT accepted — guard updates it separately
    // ⚠️ openParking NOT accepted — auto-computed
    // ⚠️ amenities + totalUnits intentionally NOT accepted

    if (Object.keys(updatePayload).length === 0) {
        return fail("No valid fields to update.", 400, "MISSING_PARAMETERS");
    }

    // ── Validate: current coveredParking must not exceed new total ──
    if (hasTotalParkingUpdate) {
        const { data: current, error: readErr } = await supabase
            .from("SSP_Society")
            .select("covered_parking")
            .eq("society_id", societyId)
            .maybeSingle();

        if (readErr) return fail(readErr.message, 500, "DATABASE_ERROR");
        if (!current || typeof current !== "object") {
            return fail("Society not found.", 404, "NOT_FOUND");
        }

        const currentCovered = Number(
            (current as { covered_parking: number | null }).covered_parking ??
                0,
        );
        const newTotal = Number(p.totalParkingSlot);

        if (currentCovered > newTotal) {
            return fail(
                `Cannot reduce totalParkingSlot to ${newTotal} — ` +
                    `current coveredParking (${currentCovered}) exceeds it. ` +
                    `Ask the gate keeper to release slots first.`,
                400,
                "INVALID_PARAMETERS",
            );
        }

        // ✅ Recompute openParking = new total - current covered
        updatePayload.open_parking = newTotal - currentCovered;
    }

    // ── Apply update ──
    const { data, error } = await supabase
        .from("SSP_Society")
        .update(updatePayload as never)
        .eq("society_id", societyId)
        .select("society_id,updated_at")
        .maybeSingle();

    if (error) return fail(error.message, 500, "DATABASE_ERROR");
    if (!data) return fail("Society not found.", 404, "NOT_FOUND");

    return respond({
        societyId: societyId,
        updatedFields,
        lastUpdated: (data as { updated_at: string }).updated_at,
        message: "Society updated successfully.",
    });
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
            | CrudSocietyRequest
            | null;
        if (!body) return fail("Request body is required.", 400, "BAD_REQUEST");

        const { societyRegistrationNumber, adminId, action } = body;

        if (!societyRegistrationNumber || !adminId || !action) {
            return fail(
                "societyRegistrationNumber, adminId, and action are required.",
                400,
                "MISSING_PARAMETERS",
            );
        }

        const actionUpper = String(action).toUpperCase();
        if (
            !VALID_ACTIONS.includes(actionUpper as typeof VALID_ACTIONS[number])
        ) {
            return fail(
                `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
                400,
                "INVALID_ACTION",
            );
        }

        const auth = await authorizeAdmin(societyRegistrationNumber, adminId);
        if (!auth.ok) return auth.response;

        let response: Response;

        switch (actionUpper) {
            case "VIEW":
                response = await handleView(auth.societyId);
                break;
            case "UPDATE":
                response = await handleUpdate(body, auth.societyId);
                break;
            default:
                return fail("Unhandled action.", 400, "INVALID_ACTION");
        }

        console.log(
            `✅ crud-society: action=${actionUpper}, society=${auth.societyId}, ` +
                `${Date.now() - startTime}ms`,
        );

        return response;
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

        console.error("❌ crud-society error:", msg);
        return fail(msg, 500, "SERVER_ERROR");
    }
});
