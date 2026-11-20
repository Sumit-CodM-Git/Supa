// deno-lint-ignore-file no-import-prefix
// ============================================
// get-society-settings - Settings Page Loader
// ============================================
// Returns EVERYTHING needed to render the settings page in one call:
//   • Society profile (name, address, plan, parking, amenities)
//   • towers, blocks, staff, flatTypes, facilities
//
// Read-only. Edits go through crud-tower / crud-block / crud-society / etc.
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface GetSocietySettingsRequest {
    societyRegistrationNumber: string;
    adminId: string;
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
}

interface TowerRow {
    tower_id: string;
    created_at: string;
    active: boolean;
    society: string | null;
    name: string | null;
    floors: number | null;
    flats_per_floor: number | null;
}

interface BlockRow {
    block_id: string;
    created_at: string;
    active: boolean | null;
    society: string | null;
    tower: string | null;
    block_name: string | null;
}

interface StaffRow {
    staff_id: string;
    created_at: string;
    society_id: string;
    staff_name: string;
    phone_number: string;
    alternate_phone: string | null;
    staff_role: string;
    is_emergency_contact: boolean | null;
    shift_timing: string | null;
    availability_status: string | null;
    id_proof_type: string | null;
    id_proof_number: string | null;
    address: string | null;
    emergency_category: string | null;
    //fcm_token: string | null;
}

interface FlatTypeRow {
    flat_type_id: string;
    created_at: string;
    flat_type: string | null;
    maintenance_charges: number | null;
    society: string | null;
}

interface FacilityRow {
    id: string;
    name: string | null;
    society: string | null;
    facility_type?: string | null;
    is_chargeable?: boolean | null;
    on_maintenance?: boolean | null;
    opening_time?: string | null;
    closing_time?: string | null;
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

// ✅ Capital "admin" — matches DB
const ADMIN_ROLE = "admin";

// Cap staff to protect against huge societies
const MAX_STAFF = 500;

const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================

function successResponse(data: unknown): Response {
    return new Response(
        JSON.stringify({ status: "SUCCESS", data }),
        {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

function failResponse(message: string, status = 400, code = "ERROR"): Response {
    return new Response(
        JSON.stringify({
            status: "FAILURE",
            data: null,
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

// Normalize response items to camelCase
function formatTower(row: TowerRow) {
    return {
        towerId: row.tower_id,
        name: row.name,
        society: row.society,
        active: row.active,
        floors: row.floors ?? 0,
        flatsPerFloor: row.flats_per_floor ?? 0,
        createdAt: row.created_at,
    };
}

function formatBlock(row: BlockRow) {
    return {
        blockId: row.block_id,
        blockName: row.block_name,
        society: row.society,
        tower: row.tower,
        active: row.active ?? true,
        createdAt: row.created_at,
    };
}

function formatStaff(row: StaffRow) {
    return {
        staffId: row.staff_id,
        name: row.staff_name,
        phone: row.phone_number,
        alternatePhone: row.alternate_phone,
        role: row.staff_role,
        isEmergencyContact: row.is_emergency_contact ?? false,
        shiftTiming: row.shift_timing,
        availabilityStatus: row.availability_status ?? "Available",
        idProofType: row.id_proof_type,
        idProofNumber: row.id_proof_number,
        address: row.address,
        emergencyCategory: row.emergency_category,
       // fcmToken: row.fcm_token,
        createdAt: row.created_at,
    };
}

function formatFlatType(row: FlatTypeRow) {
    return {
        flatTypeId: row.flat_type_id,
        flatType: row.flat_type,
        maintenanceCharges: Number(row.maintenance_charges ?? 0),
        society: row.society,
        createdAt: row.created_at,
    };
}

function formatFacility(row: FacilityRow) {
    return {
        facilityId: row.id,
        name: row.name,
        society: row.society,
        facilityType: row.facility_type ?? null,
        isChargeable: row.is_chargeable ?? false,
        onMaintenance: row.on_maintenance ?? false,
        openingTime: row.opening_time ?? null,
        closingTime: row.closing_time ?? null,
    };
}

// ============================================
// AUTH
// ============================================

async function authorizeAdmin(
    societyRegistrationNumber: string,
    adminId: string,
): Promise<
    | { ok: true; societyId: string; society: SocietyRow }
    | { ok: false; response: Response }
> {
    const cleanRegNum = String(societyRegistrationNumber).trim();
    const cleanAdminId = String(adminId).trim();

    if (!isValidUUID(cleanAdminId)) {
        return {
            ok: false,
            response: failResponse(
                "adminId must be a valid UUID.",
                400,
                "INVALID_PARAMETERS",
            ),
        };
    }

    const { data: society, error: societyErr } = await supabase
        .from("SSP_Society")
        .select(
            "society_id,society_name,registration_number,subscription_plan," +
                "address_line1,address_line2,city,state,postal_code," +
                "phone_number,email,total_unit,open_parking,covered_parking," +
                "parking_slot,amenities,active",
        )
        .eq("registration_number", cleanRegNum)
        .maybeSingle();

    if (societyErr) {
        return {
            ok: false,
            response: failResponse(societyErr.message, 500, "DATABASE_ERROR"),
        };
    }

    if (!society || typeof society !== "object" || !("society_id" in society)) {
        return {
            ok: false,
            response: failResponse("Society not found.", 404, "NOT_FOUND"),
        };
    }

    const societyTyped = society as SocietyRow;

    if (societyTyped.active === false) {
        return {
            ok: false,
            response: failResponse(
                "Society is inactive.",
                403,
                "SOCIETY_INACTIVE",
            ),
        };
    }

    const { data: admin, error: adminErr } = await supabase
        .from("SSP_Society_User")
        .select("user_id, role")
        .eq("user_id", cleanAdminId)
        .eq("society", societyTyped.society_id)
        .contains("role", [ADMIN_ROLE])
        .maybeSingle();

    if (adminErr) {
        return {
            ok: false,
            response: failResponse(adminErr.message, 500, "DATABASE_ERROR"),
        };
    }

    if (!admin) {
        return {
            ok: false,
            response: failResponse(
                "Unauthorized. Admin access required for this society.",
                403,
                "UNAUTHORIZED",
            ),
        };
    }

    return {
        ok: true,
        societyId: societyTyped.society_id,
        society: societyTyped,
    };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return failResponse(
            "Only POST method is allowed.",
            405,
            "METHOD_NOT_ALLOWED",
        );
    }

    const startTime = Date.now();

    try {
        const body = (await req.json().catch(() => null)) as
            | GetSocietySettingsRequest
            | null;

        if (!body) {
            return failResponse(
                "Request body is required.",
                400,
                "BAD_REQUEST",
            );
        }

        const { societyRegistrationNumber, adminId } = body;

        if (
            !societyRegistrationNumber ||
            String(societyRegistrationNumber).trim() === ""
        ) {
            return failResponse(
                "societyRegistrationNumber is required.",
                400,
                "MISSING_PARAMETERS",
            );
        }
        if (!adminId || String(adminId).trim() === "") {
            return failResponse(
                "adminId is required.",
                400,
                "MISSING_PARAMETERS",
            );
        }

        // ── Auth ──
        const auth = await authorizeAdmin(
            String(societyRegistrationNumber),
            String(adminId),
        );
        if (!auth.ok) return auth.response;

        const { societyId, society } = auth;

        // ── Parallel fetch ──
        const [towersRes, blocksRes, facilitiesRes, staffRes, flatTypesRes] =
            await Promise.all([
                supabase
                    .from("SSP_Tower")
                    .select(
                        "tower_id,created_at,active,society,name,floors,flats_per_floor",
                    )
                    .eq("society", societyId)
                    .eq("active", true)
                    .order("name", { ascending: true }),

                supabase
                    .from("SSP_Block")
                    .select(
                        "block_id,created_at,active,society,tower,block_name",
                    )
                    .eq("society", societyId)
                    .eq("active", true)
                    .order("block_name", { ascending: true }),

                supabase
                    .from("SSP_Facility")
                    .select(
                        "id,name,society,facility_type,is_chargeable,on_maintenance,opening_time,closing_time",
                    )
                    .eq("society", societyId),

                supabase
                    .from("SSP_Society_Staff")
                    .select(
                        "staff_id,created_at,society_id,staff_name,phone_number," +
                            "alternate_phone,staff_role,is_emergency_contact," +
                            "shift_timing,availability_status,id_proof_type," +
                            "id_proof_number,address,emergency_category"//,fcm_token
                    )
                    .eq("society_id", societyId)
                    .order("staff_name", { ascending: true })
                    .limit(MAX_STAFF),

                supabase
                    .from("SSP_Flat_Type")
                    .select(
                        "flat_type_id,created_at,flat_type,maintenance_charges,society",
                    )
                    .eq("society", societyId),
            ]);

        // Fail fast
        if (towersRes.error) throw towersRes.error;
        if (blocksRes.error) throw blocksRes.error;
        if (facilitiesRes.error) throw facilitiesRes.error;
        if (staffRes.error) throw staffRes.error;
        if (flatTypesRes.error) throw flatTypesRes.error;

        const facilities = (facilitiesRes.data ?? []) as FacilityRow[];

        // ✅ Current amenities — straight from SSP_Society.amenities
        const societyAmenities = Array.isArray(society.amenities)
            ? society.amenities
            : [];

        // ── Build response ──
        const response = {
            society: {
                societyId: society.society_id,
                societyName: society.society_name ?? "Unnamed Society",
                registrationNumber: society.registration_number,
                subscriptionPlan: society.subscription_plan,
                address: formatAddress(society),
                phoneNumber: society.phone_number,
                email: society.email,
                totalUnits: Number(society.total_unit ?? 0),
                openParkingCount: Number(society.open_parking ?? 0),
                coveredParkingCount: Number(society.covered_parking ?? 0),
                totalParkingSlot: society.parking_slot ?? "0",
                currentAmenities: societyAmenities,
            },
            towers: (towersRes.data ?? []).map((r) =>
                formatTower(r as TowerRow)
            ),
            blocks: (blocksRes.data ?? []).map((r) =>
                formatBlock(r as BlockRow)
            ),
            staff: (staffRes.data ?? []).map((r) => formatStaff(r as StaffRow)),
            flatTypes: (flatTypesRes.data ?? []).map((r) =>
                formatFlatType(r as FlatTypeRow)
            ),
            facilities: facilities.map(formatFacility),
        };

        console.log(
            `✅ get-society-settings: society=${societyId}, ` +
                `${response.towers.length} towers, ${response.blocks.length} blocks, ` +
                `${response.staff.length} staff, ${response.flatTypes.length} flatTypes, ` +
                `${facilities.length} facilities, ${Date.now() - startTime}ms`,
        );

        return successResponse(response);
    } catch (err: unknown) {
        // 🔍 Reveal the real error
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

        return failResponse(msg, 500, "SERVER_ERROR");
    }
});