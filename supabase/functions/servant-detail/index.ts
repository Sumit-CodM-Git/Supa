// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'POST, OPTIONS'
// };
// serve(async (req)=>{
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', {
//       headers: corsHeaders
//     });
//   }
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     // 1. Initial Request Body Verification
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400);
//     }
//     const { phoneNumber, servantId } = JSON.parse(bodyText);
//     // 2. Mandatory Variable Validation
//     if (!phoneNumber || String(phoneNumber).trim() === '' || !servantId || String(servantId).trim() === '') {
//       return buildErrorResponse('BAD_REQUEST', 'phoneNumber and servantId are mandatory.', 400);
//     }
//     const cleanPhone = String(phoneNumber).trim();
//     const cleanServantId = String(servantId).trim();
//     // 3. Query record using your exact PostgreSQL table structural definitions
//     const { data: servantRecord, error: dbError } = await supabase.from('SSP_Servant').select('*').eq('servant_id', cleanServantId).eq('phone_number', cleanPhone).maybeSingle();
//     if (dbError) {
//       throw new Error(`Database operation failed: ${dbError.message}`);
//     }
//     // 4. Return 404 error if record matching criteria is missing
//     if (!servantRecord) {
//       return buildErrorResponse('NOT_FOUND', 'Servant record not found for the provided ID and Phone Identifier.', 404);
//     }
//     // 5. Structure payload back to your mobile framework's wrapper expectations
//     return new Response(JSON.stringify({
//       servantDetail: {
//         name: servantRecord.servant_name ?? 'N/A',
//         phoneNumber: servantRecord.phone_number ?? 'N/A',
//         address: servantRecord.address ?? 'N/A',
//         idProofNumber: servantRecord.id_proof_number ?? 'N/A',
//         roles: servantRecord.role ?? 'N/A',
//         shiftTimings: servantRecord.shift_timing ?? 'N/A',
//         gender: servantRecord.gender ?? 'N/A',
//         idProofType: servantRecord.id_proof_type ?? 'N/A',
//         servantAutoID: servantRecord.servant_id ?? 'N/A',
//         dateOfBirth: servantRecord.date_of_birth ? String(servantRecord.date_of_birth) : null
//       },
//       errorResponse: null
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (error) {
//     return buildErrorResponse('SERVER_ERROR', error.message || 'Fatal crash running servant details pipeline.', 500);
//   }
// });
// function buildErrorResponse(code, message, statusCode) {
//   return new Response(JSON.stringify({
//     servantDetail: null,
//     errorResponse: {
//       errorCode: code,
//       message: message,
//       timestamp: new Date().toISOString()
//     }
//   }), {
//     status: statusCode,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }

// ============================================
// servant-detail - Get Servant Details by ID
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface ServantDetailRequest {
  servantId: string;
}

interface ServantRecord {
  servant_id: string;
  servant_name: string;
  phone_number: string;
  address: string | null;
  role: string | string[] | null;
  shift_timing: string | string[] | null;
  gender: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  date_of_birth: string | null;
  status: string | null;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
  is_recurring: boolean | null;
  created_at: string;
  society: string | null;
}

interface ServantDetailResponse {
  name: string;
  phoneNumber: string;
  address: string | null;
  idProofNumber: string | null;
  roles: string[];
  shiftTimings: string[];
  gender: string | null;
  idProofType: string | null;
  servantId: string;
  dateOfBirth: string | null;
  status: string | null;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  isRecurring: boolean | null;
  workingHours: string | null;
  currentStatus: "Inside" | "Outside";
  createdAt: string;
}

interface ApiResponse {
  status: "SUCCESS" | "FAILURE";
  servantDetail: ServantDetailResponse | null;
  errorResponse: {
    errorCode: string;
    message: string;
    timestamp: string;
  } | null;
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

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse time string to minutes since midnight
 */
function parseTimeToMinutes(timeStr: string | null): number | null {
  if (!timeStr || typeof timeStr !== "string") return null;

  const cleanStr = timeStr.trim().toUpperCase();

  // Handle full ISO or SQL timestamp
  if (cleanStr.includes("-") || cleanStr.includes("T")) {
    const d = new Date(cleanStr.replace(" ", "T"));
    if (!isNaN(d.getTime())) {
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  // Handle 12-hour or 24-hour time strings
  const amPmMatch = cleanStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (amPmMatch) {
    let hours = parseInt(amPmMatch[1], 10);
    const minutes = parseInt(amPmMatch[2], 10);
    const modifier = amPmMatch[3];

    if (modifier === "PM" && hours < 12) hours += 12;
    if (modifier === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Calculate working hours between arrival and departure
 */
function calculateWorkingHours(
  arrival: string | null,
  departure: string | null,
): string | null {
  if (!arrival || !departure) return null;

  const start = new Date(arrival.replace(" ", "T"));
  const end = new Date(departure.replace(" ", "T"));

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return null;
  }

  let diffMs = end.getTime() - start.getTime();

  // Handle overnight shifts
  if (diffMs < 0) {
    diffMs += 24 * 60 * 60 * 1000;
  }

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours === 0 && mins === 0) return "0 Mins";
  if (mins === 0) return `${hours} Hours`;
  if (hours === 0) return `${mins} Mins`;
  return `${hours} Hours ${mins} Mins`;
}

/**
 * Determine if servant is currently inside or outside
 */
function determineCurrentStatus(
  dbStatus: string | null,
  arrival: string | null,
  departure: string | null,
): "Inside" | "Outside" {
  // Check database status first
  if (dbStatus && dbStatus.trim() !== "") {
    const statusLower = dbStatus.trim().toLowerCase();
    const insideKeywords = ["inside", "in", "mark in", "marked in"];
    const outsideKeywords = ["outside", "out", "mark out", "marked out"];

    if (insideKeywords.includes(statusLower)) return "Inside";
    if (outsideKeywords.includes(statusLower)) return "Outside";
  }

  // Calculate based on scheduled times
  const startMins = parseTimeToMinutes(arrival);
  const endMins = parseTimeToMinutes(departure);

  if (startMins === null || endMins === null) {
    return "Outside";
  }

  // Get current time in IST
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = istFormatter.formatToParts(now);
  const pMap = new Map(parts.map((p) => [p.type, p.value]));
  const currentMins = parseInt(pMap.get("hour") || "0", 10) * 60 +
    parseInt(pMap.get("minute") || "0", 10);

  // Check if current time falls within shift
  if (startMins <= endMins) {
    return (currentMins >= startMins && currentMins <= endMins)
      ? "Inside"
      : "Outside";
  } else {
    // Overnight shift
    return (currentMins >= startMins || currentMins <= endMins)
      ? "Inside"
      : "Outside";
  }
}

/**
 * Parse array field from string or JSON
 */
function parseArrayField(
  value: string | string[] | null | undefined,
): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter((item) => item && item.trim() !== "");
  }

  if (typeof value === "string") {
    try {
      // Try JSON parse first
      if (value.startsWith("[") && value.endsWith("]")) {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => item && item.trim() !== "");
        }
      }
      // Fallback to semicolon or comma separation
      return value.split(/[;,]/).map((item) => item.trim()).filter((item) =>
        item !== ""
      );
    } catch {
      return value.split(/[;,]/).map((item) => item.trim()).filter((item) =>
        item !== ""
      );
    }
  }

  return [];
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only allow POST method
    if (req.method !== "POST") {
      return buildErrorResponse(
        "METHOD_NOT_ALLOWED",
        "Only POST method is allowed.",
        405,
      );
    }

    // Parse request body
    const bodyText = await req.text();
    if (!bodyText || bodyText.trim() === "") {
      return buildErrorResponse("BAD_REQUEST", "Request body is empty.", 400);
    }

    const requestData: ServantDetailRequest = JSON.parse(bodyText);

    // Validate servantId
    if (!requestData.servantId || requestData.servantId.trim() === "") {
      return buildErrorResponse(
        "MISSING_PARAMETERS",
        "servantId is required.",
        400,
      );
    }

    const cleanServantId = requestData.servantId.trim();

    // Query servant record
    const { data: servantRecord, error: dbError } = await supabaseAdmin
      .from("SSP_Servant")
      .select("*")
      .eq("servant_id", cleanServantId)
      .maybeSingle();

    if (dbError) {
      console.error("Database error:", dbError);
      return buildErrorResponse(
        "DATABASE_ERROR",
        `Database operation failed: ${dbError.message}`,
        500,
      );
    }

    // Check if servant exists
    if (!servantRecord) {
      return buildErrorResponse(
        "NOT_FOUND",
        `Servant record not found for ID: ${cleanServantId}`,
        404,
      );
    }

    // Parse arrays
    const rolesArray = parseArrayField(servantRecord.role);
    const shiftsArray = parseArrayField(servantRecord.shift_timing);

    // Calculate working hours and status
    const workingHours = calculateWorkingHours(
      servantRecord.scheduled_arrival,
      servantRecord.scheduled_departure,
    );
    const currentStatus = determineCurrentStatus(
      servantRecord.status,
      servantRecord.scheduled_arrival,
      servantRecord.scheduled_departure,
    );

    // Build response
    const servantDetail: ServantDetailResponse = {
      name: servantRecord.servant_name || "N/A",
      phoneNumber: servantRecord.phone_number || "N/A",
      address: servantRecord.address || null,
      idProofNumber: servantRecord.id_proof_number || null,
      roles: rolesArray,
      shiftTimings: shiftsArray,
      gender: servantRecord.gender || null,
      idProofType: servantRecord.id_proof_type || null,
      servantId: servantRecord.servant_id,
      dateOfBirth: servantRecord.date_of_birth || null,
      status: servantRecord.status || null,
      scheduledArrival: servantRecord.scheduled_arrival || null,
      scheduledDeparture: servantRecord.scheduled_departure || null,
      isRecurring: servantRecord.is_recurring || null,
      workingHours: workingHours,
      currentStatus: currentStatus,
      createdAt: servantRecord.created_at || new Date().toISOString(),
    };

    const response: ApiResponse = {
      status: "SUCCESS",
      servantDetail: servantDetail,
      errorResponse: null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Server error:", error);
    return buildErrorResponse(
      "SERVER_ERROR",
      error instanceof Error ? error.message : "Internal server error",
      500,
    );
  }
});

// ============================================
// ERROR RESPONSE BUILDER
// ============================================

function buildErrorResponse(
  code: string,
  message: string,
  statusCode: number,
): Response {
  const response: ApiResponse = {
    status: "FAILURE",
    servantDetail: null,
    errorResponse: {
      errorCode: code,
      message: message,
      timestamp: new Date().toISOString(),
    },
  };

  return new Response(JSON.stringify(response), {
    status: statusCode,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
