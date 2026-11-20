import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import { createClient } from "@supabase/supabase-js";
const logger = createLogger("get-facilities-details");
interface FacilityResponse {
    id: string;
    societyRegistrationNumber: string;
    name: string | null;
    type: string | null;
    description: string | null;
    rules: string | string[] | null;
    bookingMode: string | null;
    closedDays: string | string[] | null;
    basePrice: number | null;
    securityDeposit: number | null;
    openingTime: string | null;
    closingTime: string | null;
    isChargeable: boolean | null;
    extraCharges: Record<string, unknown> | null;
    onMaintenance: boolean;
    maintenanceStart: string | null;
    maintenanceEnd: string | null;
    maintenanceReason: string | null;
    imageUrl: string | null;
}
interface DocumentRecord {
    facility: string;
    s3_path: string;
}
interface SocietyJoinRecord {
    registration_number: string;
}
interface FacilityRecord {
    id: string;
    name: string | null;
    facility_type: string | null;
    description: string | null;
    rules: string | string[] | null;
    booking_mode: string | null;
    opening_time: string | null;
    closing_time: string | null;
    closed_days: string | string[] | null;
    is_chargeable: boolean | null;
    base_price: number | null;
    security_deposit: number | null;
    extra_charges: Record<string, unknown> | null;
    on_maintenance: boolean | null;
    maintenance_start: string | null;
    maintenance_end: string | null;
    maintenance_reason: string | null;
    SSP_Society: SocietyJoinRecord | SocietyJoinRecord[];
}
function parseArrayField(value: string | string[] | null | undefined): string | string[] | null {
    if (!value)
        return null;
    if (Array.isArray(value))
        return value;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            const content = trimmed.slice(1, -1);
            if (content === "")
                return [];
            return content.split(",").map((s) => s.trim());
        }
        return trimmed;
    }
    return null;
}
function formatTime(timeStr: string | null): string | null {
    if (!timeStr)
        return null;
    return timeStr.substring(0, 5);
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: AuthContext) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const startTime = Date.now();
    try {
        logger.info({
            level: "info",
            timestamp: new Date().toISOString(),
            action: "get_facilities_start",
            userId: authCtx.user.id,
            method: req.method,
            message: "Get facilities details requested",
        });
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }
        const body = await req.json().catch(() => null);
        if (!body) {
            return errorResponse("Request body is required.", 400);
        }
        const { societyRegistrationNumber } = body;
        if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
            return errorResponse("Society Registration Number is mandatory.", 400);
        }
        const regNum = String(societyRegistrationNumber).trim();
        const { data: records, error: dbErr } = await supabaseAdmin
            .from("SSP_Facility")
            .select(`
          id,
          name,
          facility_type,
          description,
          rules,
          booking_mode,
          opening_time,
          closing_time,
          closed_days,
          is_chargeable,
          base_price,
          security_deposit,
          extra_charges,
          on_maintenance,
          maintenance_start,
          maintenance_end,
          maintenance_reason,
          SSP_Society!inner ( registration_number )
        `)
            .eq("SSP_Society.registration_number", regNum);
        if (dbErr)
            throw dbErr;
        const facilityRecords = (records ?? []) as unknown as FacilityRecord[];
        const facilityIds = facilityRecords.map((f) => f.id);
        let docMap = new Map<string, string>();
        if (facilityIds.length > 0) {
            const { data: docRecords } = await supabaseAdmin
                .from("SSP_Document")
                .select("facility, s3_path")
                .in("facility", facilityIds);
            const typedDocs = (docRecords ?? []) as DocumentRecord[];
            docMap = new Map(typedDocs.map((d) => [d.facility, d.s3_path]));
        }
        const facilitiesList: FacilityResponse[] = facilityRecords.map((facility) => {
            const societyObj = Array.isArray(facility.SSP_Society)
                ? facility.SSP_Society[0]
                : facility.SSP_Society;
            return {
                id: facility.id,
                societyRegistrationNumber: societyObj?.registration_number ?? regNum,
                name: facility.name ?? null,
                type: facility.facility_type ?? null,
                description: facility.description ?? null,
                rules: parseArrayField(facility.rules),
                bookingMode: facility.booking_mode ?? null,
                closedDays: parseArrayField(facility.closed_days),
                basePrice: facility.base_price ? Number(facility.base_price) : null,
                securityDeposit: facility.security_deposit ? Number(facility.security_deposit) : null,
                openingTime: formatTime(facility.opening_time),
                closingTime: formatTime(facility.closing_time),
                isChargeable: facility.is_chargeable ?? false,
                extraCharges: facility.extra_charges ?? null,
                onMaintenance: facility.on_maintenance ?? false,
                maintenanceStart: facility.maintenance_start ?? null,
                maintenanceEnd: facility.maintenance_end ?? null,
                maintenanceReason: facility.maintenance_reason ?? null,
                imageUrl: docMap.get(facility.id) ?? null,
            };
        });
        logger.info({
            level: "info",
            timestamp: new Date().toISOString(),
            action: "get_facilities_end",
            count: facilitiesList.length,
            duration: Date.now() - startTime,
            message: "Facilities fetched successfully",
        });
        return successResponse({ facilities: facilitiesList });
    }
    catch (error: unknown) {
        const err = error as Error;
        logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "get_facilities_error",
            error: err.message,
            stack: err.stack,
            message: "Failed to fetch facility details",
            duration: Date.now() - startTime,
        });
        const isDev = Deno.env.get("DENO_ENV") === "development";
        return errorResponse(err.message || "Failed to process facility retrieval operation.", 500, isDev ? err.stack : null);
    }
}));
