/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface FacilityData {
  id: string | null;
  societyRegistrationNumber: string | null;
  name: string | null;
  type: string | null;
  description: string | null;
  rules: string;
  bookingMode: string | null;
  closedDays: string;
  basePrice: number | null;
  securityDeposit: number;
    extraCharges: number | null;
  openingTime: string | null;
  closingTime: string | null;
  isChargeable: boolean;
  onMaintenance: boolean;
  maintenanceStart :string | null;
  maintenanceEnd : string | null;
  maintenanceReason :string | null;
}

serve(async (req: Request) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Validate Payload Body
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildError('BAD_REQUEST', 'Request body is empty.', 400, startTime)
    }

    const { societyRegistrationNumber } = JSON.parse(bodyText)

    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildError('BAD_REQUEST', 'Society Registration Number is mandatory.', 400, startTime)
    }

    const regNum = String(societyRegistrationNumber).trim()

    // 2. Query Facility Records
    const { data: records, error: dbErr } = await supabase
      .from('SSP_Facility')
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
      .eq('SSP_Society.registration_number', regNum)

    if (dbErr) throw dbErr

    // 3. Map Results to Wrapper Format
    const facilitiesList: FacilityData[] = []

    if (records) {
      for (const record of records) {
        // Handle relations safely in case of array returns
        const societyObj = Array.isArray(record.SSP_Society) ? record.SSP_Society[0] : record.SSP_Society

        // Mimic Apex String.valueOf().substring(0,5) logic for times
        const formatTime = (timeStr: string | null) => {
          if (!timeStr) return null;
          // E.g., "10:30:00" -> "10:30"
          return timeStr.substring(0, 5);
        }

facilitiesList.push({
  id: record.id ?? null,
  societyRegistrationNumber: societyObj?.registration_number ?? null,
  name: record.name ?? null,
  type: record.facility_type ?? null,
  description: record.description ?? null,
  rules: record.rules ?? "No Rules",
  bookingMode: record.booking_mode ?? null,
  closedDays: record.closed_days ?? "Nil",
  basePrice: record.base_price ? Number(record.base_price) : null,
  securityDeposit: record.security_deposit
    ? Number(record.security_deposit)
    : 0,
     extraCharges: record.extra_charges
    ? Number(record.extra_charges)
    : null,
  openingTime: formatTime(record.opening_time),
  closingTime: formatTime(record.closing_time),
  isChargeable: record.is_chargeable ?? false,

  onMaintenance: record.on_maintenance ?? false,
  maintenanceStart: record.maintenance_start ?? null,
  maintenanceEnd: record.maintenance_end ?? null,
  maintenanceReason: record.maintenance_reason ?? null
})
      }
    }

    console.log(`Successfully fetched ${facilitiesList.length} facilities in ${Date.now() - startTime}ms`)
    return new Response(
      JSON.stringify({ facilities: facilitiesList, errorResponse: null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildError(
      'SERVER_ERROR',
      `Database Execution Failure: ${error.message || 'Fatal error processing facility queries.'}`,
      500,
      startTime
    )
  }
})

// --- ERROR WRAPPER ---
function buildError(code: string, msg: string, status: number, start: number) {
  console.error(`Get Facilities Failure -> [${code}]: ${msg}`)
  return new Response(
    JSON.stringify({
      facilities: [],
      errorResponse: { errorCode: code, message: msg, timestamp: new Date().toISOString() }
    }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/
import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import { createClient } from "@supabase/supabase-js";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const logger = createLogger("get-facilities-details");

// ============================================
// TYPES & INTERFACES
// ============================================
// REMOVED: Local AuthContext interface declaration to avoid conflict with auth.ts

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

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse Postgres array format ({val1,val2}) or return array/string as-is
 */
function parseArrayField(
  value: string | string[] | null | undefined,
): string | string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const content = trimmed.slice(1, -1);
      if (content === "") return [];
      return content.split(",").map((s) => s.trim());
    }
    return trimmed;
  }
  return null;
}

/**
 * Format PostgreSQL Time string (e.g. "10:30:00" -> "10:30")
 */
function formatTime(timeStr: string | null): string | null {
  if (!timeStr) return null;
  return timeStr.substring(0, 5);
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: AuthContext) => {
    // Handle CORS preflight
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

      // Allow POST method
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      // Parse payload
      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const { societyRegistrationNumber } = body;

      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("Society Registration Number is mandatory.", 400);
      }

      const regNum = String(societyRegistrationNumber).trim();

      // 1. Fetch facility records
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

      if (dbErr) throw dbErr;

      const facilityRecords = (records ?? []) as unknown as FacilityRecord[];

      // 2. Fetch associated facility images from SSP_Document
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

      // 3. Map facilities response
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

    } catch (error: unknown) {
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

      return errorResponse(
        err.message || "Failed to process facility retrieval operation.",
        500,
        isDev ? err.stack : null
      );
    }
  })
);