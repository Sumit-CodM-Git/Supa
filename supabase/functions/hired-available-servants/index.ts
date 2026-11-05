// // ============================================
// // manage-servant-hire - Hire/Layoff Servant with Role Support
// // ============================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================

// interface ManageServantHireRequest {
//     societyRegistrationNumber: string;
//     residentId: string;
//     servantId: string;
//     action: "hire" | "layoff";
//     roles?: string | string[];
//     isRecurring?: boolean;
//     recurringDays?: string[];
// }

// interface HireData {
//     servantId: string;
//     servantName: string;
//     residentId: string;
//     hiredRoles: string[];
//     allRoles: string[];
//     isRecurring: boolean | null;
//     recurringDays: string[] | null;
//     hired: boolean;
// }

// interface HireResponse {
//     status: "SUCCESS" | "FAILURE";
//     message: string;
//     operation: "hire" | "layoff" | "none";
//     data: HireData | null;
//     errorResponse: {
//         errorCode: string;
//         message: string;
//         timestamp: string;
//     } | null;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const corsHeaders = {
//     "Access-Control-Allow-Origin": "*",
//     "Access-Control-Allow-Headers":
//         "authorization, x-client-info, apikey, content-type",
//     "Access-Control-Allow-Methods": "POST, OPTIONS",
// };

// const supabaseAdmin = createClient(
//     Deno.env.get("SUPABASE_URL") ?? "",
//     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// // ============================================
// // HELPER FUNCTIONS
// // ============================================

// /**
//  * Validate UUID format
//  */
// function isValidUUID(uuid: string): boolean {
//     const uuidRegex =
//         /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     return uuidRegex.test(uuid);
// }

// /**
//  * Normalize roles to array
//  */
// function normalizeRoles(roles: string | string[] | undefined): string[] {
//     if (!roles) return [];

//     if (Array.isArray(roles)) {
//         return roles.filter((r) => r && r.trim() !== "");
//     }

//     if (typeof roles === "string") {
//         return roles.split(/[;,]/).map((r) => r.trim()).filter((r) => r !== "");
//     }

//     return [];
// }

// /**
//  * Normalize recurring days to array
//  */
// function normalizeRecurringDays(
//     recurringDays: string | string[] | undefined,
// ): string[] {
//     if (!recurringDays) return [];

//     if (Array.isArray(recurringDays)) {
//         return recurringDays.filter((day) => day && day.trim() !== "");
//     }

//     if (typeof recurringDays === "string") {
//         return recurringDays.split(/[;,]/).map((day) => day.trim()).filter(
//             (day) => day !== "",
//         );
//     }

//     return [];
// }

// /**
//  * Parse array field from string or JSON
//  */
// function parseArrayField(
//     value: string | string[] | null | undefined,
// ): string[] {
//     if (!value) return [];

//     if (Array.isArray(value)) {
//         return value.filter((item) => item && item.trim() !== "");
//     }

//     if (typeof value === "string") {
//         try {
//             if (value.startsWith("[") && value.endsWith("]")) {
//                 const parsed = JSON.parse(value);
//                 if (Array.isArray(parsed)) {
//                     return parsed.filter((item) => item && item.trim() !== "");
//                 }
//             }
//             return value.split(/[;,]/).map((item) => item.trim()).filter(
//                 (item) => item !== "",
//             );
//         } catch {
//             return value.split(/[;,]/).map((item) => item.trim()).filter(
//                 (item) => item !== "",
//             );
//         }
//     }

//     return [];
// }

// /**
//  * Get resident by ID or contact
//  */
// async function getResident(societyId: string, residentId: string) {
//     let query = supabaseAdmin
//         .from("SSP_Society_User")
//         .select("user_id, role, unit_flat_number")
//         .eq("society", societyId);

//     if (isValidUUID(residentId)) {
//         query = query.eq("user_id", residentId);
//     } else {
//         query = query.or(
//             `contact.eq.${residentId},unit_flat_number.eq.${residentId}`,
//         );
//     }

//     const { data, error } = await query.maybeSingle();
//     return { data, error };
// }

// /**
//  * Get servant by ID or ID proof number
//  */
// async function getServant(societyId: string, servantId: string) {
//     let query = supabaseAdmin
//         .from("SSP_Servant")
//         .select("servant_id, servant_name, phone_number, role")
//         .eq("society", societyId);

//     if (isValidUUID(servantId)) {
//         query = query.eq("servant_id", servantId);
//     } else {
//         query = query.eq("id_proof_number", servantId);
//     }

//     const { data, error } = await query.maybeSingle();
//     return { data, error };
// }

// /**
//  * Check existing relationship between resident and servant
//  */
// async function getExistingRelationship(residentId: string, servantId: string) {
//     const { data, error } = await supabaseAdmin
//         .from("SSP_Society_Servant")
//         .select(
//             "society_servant_id, hired, is_recurring, recurring_days, hired_roles",
//         )
//         .eq("society_user", residentId)
//         .eq("servant_id", servantId)
//         .maybeSingle();

//     return { data, error };
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// serve(async (req: Request) => {
//     // Handle CORS preflight
//     if (req.method === "OPTIONS") {
//         return new Response("ok", { headers: corsHeaders });
//     }

//     try {
//         // Only allow POST method
//         if (req.method !== "POST") {
//             return buildErrorResponse(
//                 "METHOD_NOT_ALLOWED",
//                 "Only POST method is allowed.",
//                 405,
//             );
//         }

//         // Parse request body
//         const bodyText = await req.text();
//         if (!bodyText || bodyText.trim() === "") {
//             return buildErrorResponse(
//                 "BAD_REQUEST",
//                 "Request body is empty.",
//                 400,
//             );
//         }

//         const requestData: ManageServantHireRequest = JSON.parse(bodyText);

//         console.log(
//             "📥 Request received:",
//             JSON.stringify(requestData, null, 2),
//         );

//         // Validate required fields
//         if (
//             !requestData.societyRegistrationNumber ||
//             requestData.societyRegistrationNumber.trim() === ""
//         ) {
//             return buildErrorResponse(
//                 "MISSING_PARAMETERS",
//                 "societyRegistrationNumber is required.",
//                 400,
//             );
//         }

//         if (!requestData.residentId || requestData.residentId.trim() === "") {
//             return buildErrorResponse(
//                 "MISSING_PARAMETERS",
//                 "residentId is required.",
//                 400,
//             );
//         }

//         if (!requestData.servantId || requestData.servantId.trim() === "") {
//             return buildErrorResponse(
//                 "MISSING_PARAMETERS",
//                 "servantId is required.",
//                 400,
//             );
//         }

//         if (
//             !requestData.action ||
//             !["hire", "layoff"].includes(requestData.action)
//         ) {
//             return buildErrorResponse(
//                 "MISSING_PARAMETERS",
//                 'action must be either "hire" or "layoff".',
//                 400,
//             );
//         }

//         const cleanRegNo = requestData.societyRegistrationNumber.trim();
//         const cleanResidentId = requestData.residentId.trim();
//         const cleanServantId = requestData.servantId.trim();
//         const action = requestData.action;
//         const rolesToHire = normalizeRoles(requestData.roles);

//         // ============================================
//         // STEP 1: Verify Society
//         // ============================================
//         console.log(`🔍 Verifying society: ${cleanRegNo}`);

//         const { data: society, error: societyError } = await supabaseAdmin
//             .from("SSP_Society")
//             .select("society_id, registration_number, society_name")
//             .eq("registration_number", cleanRegNo)
//             .maybeSingle();

//         if (societyError) {
//             console.error("❌ Society verification error:", societyError);
//             return buildErrorResponse(
//                 "DATABASE_ERROR",
//                 `Society verification failed: ${societyError.message}`,
//                 500,
//             );
//         }

//         if (!society) {
//             return buildErrorResponse(
//                 "NOT_FOUND",
//                 `Society not found with registration number: ${cleanRegNo}`,
//                 404,
//             );
//         }

//         console.log(
//             `✅ Society found: ${society.society_name} (${society.society_id})`,
//         );

//         // ============================================
//         // STEP 2: Verify Resident
//         // ============================================
//         console.log(`🔍 Verifying resident: ${cleanResidentId}`);

//         const { data: resident, error: residentError } = await getResident(
//             society.society_id,
//             cleanResidentId,
//         );

//         if (residentError) {
//             console.error("❌ Resident verification error:", residentError);
//             return buildErrorResponse(
//                 "DATABASE_ERROR",
//                 `Resident verification failed: ${residentError.message}`,
//                 500,
//             );
//         }

//         if (!resident) {
//             return buildErrorResponse(
//                 "NOT_FOUND",
//                 `Resident not found with ID: ${cleanResidentId}`,
//                 404,
//             );
//         }

//         // Verify resident has 'Resident' role
//         const roles = Array.isArray(resident.role)
//             ? resident.role
//             : [resident.role];
//         if (!roles.some((r) => r?.toLowerCase() === "resident")) {
//             return buildErrorResponse(
//                 "UNAUTHORIZED",
//                 "User is not a resident.",
//                 403,
//             );
//         }

//         console.log(`✅ Resident found: ${resident.user_id}`);

//         // ============================================
//         // STEP 3: Verify Servant and Get All Roles
//         // ============================================
//         console.log(`🔍 Verifying servant: ${cleanServantId}`);

//         const { data: servant, error: servantError } = await getServant(
//             society.society_id,
//             cleanServantId,
//         );

//         if (servantError) {
//             console.error("❌ Servant verification error:", servantError);
//             return buildErrorResponse(
//                 "DATABASE_ERROR",
//                 `Servant verification failed: ${servantError.message}`,
//                 500,
//             );
//         }

//         if (!servant) {
//             return buildErrorResponse(
//                 "NOT_FOUND",
//                 `Servant not found with ID: ${cleanServantId}`,
//                 404,
//             );
//         }

//         // Get servant's all roles
//         const allServantRoles = parseArrayField(servant.role);
//         console.log(`✅ Servant found: ${servant.servant_name}`);
//         console.log(`📋 All servant roles: ${allServantRoles.join(", ")}`);

//         // ============================================
//         // STEP 4: Check Existing Relationship
//         // ============================================
//         console.log(`🔍 Checking existing relationship`);

//         const { data: existingJunction, error: junctionError } =
//             await getExistingRelationship(
//                 resident.user_id,
//                 servant.servant_id,
//             );

//         if (junctionError) {
//             console.error("❌ Junction check error:", junctionError);
//             return buildErrorResponse(
//                 "DATABASE_ERROR",
//                 `Failed to check existing relationship: ${junctionError.message}`,
//                 500,
//             );
//         }

//         // Get existing hired roles
//         const existingHiredRoles = parseArrayField(
//             existingJunction?.hired_roles,
//         );
//         console.log(
//             `📋 Existing hired roles: ${existingHiredRoles.join(", ")}`,
//         );

//         // ============================================
//         // STEP 5: Perform Action
//         // ============================================
//         let operationMessage = "";
//         const isRecurring = requestData.isRecurring || false;
//         const recurringDays = normalizeRecurringDays(requestData.recurringDays);

//         let updatedHiredRoles: string[] = [];

//         if (action === "hire") {
//             // Validate roles
//             if (rolesToHire.length === 0) {
//                 return buildErrorResponse(
//                     "MISSING_PARAMETERS",
//                     "At least one role must be specified for hiring.",
//                     400,
//                 );
//             }

//             // Validate requested roles are valid for this servant
//             const invalidRoles = rolesToHire.filter(
//                 (r) => !allServantRoles.includes(r),
//             );
//             if (invalidRoles.length > 0) {
//                 return buildErrorResponse(
//                     "INVALID_ROLES",
//                     `Invalid roles for this servant: ${
//                         invalidRoles.join(", ")
//                     }. Available roles: ${allServantRoles.join(", ")}`,
//                     400,
//                 );
//             }

//             // Validate recurring days if isRecurring is true
//             if (isRecurring && recurringDays.length === 0) {
//                 return buildErrorResponse(
//                     "MISSING_PARAMETERS",
//                     "recurringDays is required when isRecurring is true.",
//                     400,
//                 );
//             }

//             // Check if roles are already hired
//             const alreadyHiredRoles = rolesToHire.filter((r) =>
//                 existingHiredRoles.includes(r)
//             );
//             if (alreadyHiredRoles.length > 0) {
//                 return buildErrorResponse(
//                     "ALREADY_EXISTS",
//                     `Roles already hired: ${alreadyHiredRoles.join(", ")}`,
//                     400,
//                 );
//             }

//             // Add new roles to existing hired roles
//             updatedHiredRoles = [...existingHiredRoles, ...rolesToHire];

//             if (!existingJunction) {
//                 // Create new relationship
//                 console.log(`📝 Creating new hire relationship`);

//                 const { error: insertError } = await supabaseAdmin
//                     .from("SSP_Society_Servant")
//                     .insert({
//                         society_user: resident.user_id,
//                         servant_id: servant.servant_id,
//                         hired: true,
//                         hired_roles: updatedHiredRoles,
//                         is_recurring: isRecurring,
//                         recurring_days: recurringDays.length > 0
//                             ? recurringDays
//                             : null,
//                     });

//                 if (insertError) {
//                     console.error("❌ Insert error:", insertError);
//                     return buildErrorResponse(
//                         "DATABASE_ERROR",
//                         `Failed to hire servant: ${insertError.message}`,
//                         500,
//                     );
//                 }

//                 operationMessage =
//                     `Servant '${servant.servant_name}' hired for roles: ${
//                         rolesToHire.join(", ")
//                     }`;
//                 console.log(`✅ ${operationMessage}`);
//             } else {
//                 // Update existing relationship
//                 console.log(`📝 Updating existing relationship`);

//                 const { error: updateError } = await supabaseAdmin
//                     .from("SSP_Society_Servant")
//                     .update({
//                         hired: true,
//                         hired_roles: updatedHiredRoles,
//                         is_recurring: isRecurring,
//                         recurring_days: recurringDays.length > 0
//                             ? recurringDays
//                             : null,
//                     })
//                     .eq(
//                         "society_servant_id",
//                         existingJunction.society_servant_id,
//                     );

//                 if (updateError) {
//                     console.error("❌ Update error:", updateError);
//                     return buildErrorResponse(
//                         "DATABASE_ERROR",
//                         `Failed to update servant: ${updateError.message}`,
//                         500,
//                     );
//                 }

//                 operationMessage =
//                     `Servant '${servant.servant_name}' hired for roles: ${
//                         rolesToHire.join(", ")
//                     }`;
//                 console.log(`✅ ${operationMessage}`);
//             }

//             // Build final data
//             const finalData: HireData = {
//                 servantId: servant.servant_id,
//                 servantName: servant.servant_name,
//                 residentId: resident.user_id,
//                 hiredRoles: updatedHiredRoles,
//                 allRoles: allServantRoles,
//                 isRecurring: isRecurring,
//                 recurringDays: recurringDays.length > 0 ? recurringDays : null,
//                 hired: true,
//             };

//             // Return Response
//             const response: HireResponse = {
//                 status: "SUCCESS",
//                 message: operationMessage,
//                 operation: action,
//                 data: finalData,
//                 errorResponse: null,
//             };

//             return new Response(JSON.stringify(response), {
//                 status: 200,
//                 headers: { ...corsHeaders, "Content-Type": "application/json" },
//             });
//         } else if (action === "layoff") {
//             if (!existingJunction) {
//                 return buildErrorResponse(
//                     "NOT_FOUND",
//                     `Servant '${servant.servant_name}' is not hired.`,
//                     404,
//                 );
//             }

//             // If no specific roles provided, layoff all
//             const rolesToLayoff = rolesToHire.length > 0
//                 ? rolesToHire
//                 : existingHiredRoles;

//             // Check if roles are actually hired
//             const notHiredRoles = rolesToLayoff.filter((r) =>
//                 !existingHiredRoles.includes(r)
//             );
//             if (notHiredRoles.length > 0) {
//                 return buildErrorResponse(
//                     "NOT_FOUND",
//                     `Roles not hired: ${
//                         notHiredRoles.join(", ")
//                     }. Hired roles: ${existingHiredRoles.join(", ")}`,
//                     404,
//                 );
//             }

//             // Remove layoff roles from hired roles
//             updatedHiredRoles = existingHiredRoles.filter((r) =>
//                 !rolesToLayoff.includes(r)
//             );

//             if (updatedHiredRoles.length === 0) {
//                 // No roles left, delete the relationship
//                 console.log(`📝 Deleting relationship (no roles left)`);

//                 const { error: deleteError } = await supabaseAdmin
//                     .from("SSP_Society_Servant")
//                     .delete()
//                     .eq(
//                         "society_servant_id",
//                         existingJunction.society_servant_id,
//                     );

//                 if (deleteError) {
//                     console.error("❌ Delete error:", deleteError);
//                     return buildErrorResponse(
//                         "DATABASE_ERROR",
//                         `Failed to layoff servant: ${deleteError.message}`,
//                         500,
//                     );
//                 }

//                 const layedOffRoles = rolesToLayoff.join(", ");
//                 operationMessage =
//                     `Servant '${servant.servant_name}' laid off for all roles: ${layedOffRoles}`;
//                 console.log(`✅ ${operationMessage}`);

//                 const finalData: HireData = {
//                     servantId: servant.servant_id,
//                     servantName: servant.servant_name,
//                     residentId: resident.user_id,
//                     hiredRoles: [],
//                     allRoles: allServantRoles,
//                     isRecurring: null,
//                     recurringDays: null,
//                     hired: false,
//                 };

//                 const response: HireResponse = {
//                     status: "SUCCESS",
//                     message: operationMessage,
//                     operation: action,
//                     data: finalData,
//                     errorResponse: null,
//                 };

//                 return new Response(JSON.stringify(response), {
//                     status: 200,
//                     headers: {
//                         ...corsHeaders,
//                         "Content-Type": "application/json",
//                     },
//                 });
//             } else {
//                 // Update with remaining roles
//                 console.log(`📝 Updating relationship (remaining roles)`);

//                 const { error: updateError } = await supabaseAdmin
//                     .from("SSP_Society_Servant")
//                     .update({
//                         hired_roles: updatedHiredRoles,
//                         is_recurring: existingJunction.is_recurring || false,
//                         recurring_days: existingJunction.recurring_days || null,
//                     })
//                     .eq(
//                         "society_servant_id",
//                         existingJunction.society_servant_id,
//                     );

//                 if (updateError) {
//                     console.error("❌ Update error:", updateError);
//                     return buildErrorResponse(
//                         "DATABASE_ERROR",
//                         `Failed to update servant: ${updateError.message}`,
//                         500,
//                     );
//                 }

//                 const layedOffRoles = rolesToLayoff.join(", ");
//                 operationMessage =
//                     `Servant '${servant.servant_name}' laid off for roles: ${layedOffRoles}. Remaining roles: ${
//                         updatedHiredRoles.join(", ")
//                     }`;
//                 console.log(`✅ ${operationMessage}`);

//                 const finalData: HireData = {
//                     servantId: servant.servant_id,
//                     servantName: servant.servant_name,
//                     residentId: resident.user_id,
//                     hiredRoles: updatedHiredRoles,
//                     allRoles: allServantRoles,
//                     isRecurring: existingJunction.is_recurring || false,
//                     recurringDays: existingJunction.recurring_days || null,
//                     hired: true,
//                 };

//                 const response: HireResponse = {
//                     status: "SUCCESS",
//                     message: operationMessage,
//                     operation: action,
//                     data: finalData,
//                     errorResponse: null,
//                 };

//                 return new Response(JSON.stringify(response), {
//                     status: 200,
//                     headers: {
//                         ...corsHeaders,
//                         "Content-Type": "application/json",
//                     },
//                 });
//             }
//         }

//         // Fallback response
//         return buildErrorResponse(
//             "SERVER_ERROR",
//             "Unknown action performed.",
//             500,
//         );
//     } catch (error) {
//         console.error("❌ Server error:", error);
//         return buildErrorResponse(
//             "SERVER_ERROR",
//             error instanceof Error ? error.message : "Internal server error",
//             500,
//         );
//     }
// });

// // ============================================
// // ERROR RESPONSE BUILDER
// // ============================================

// function buildErrorResponse(
//     code: string,
//     message: string,
//     statusCode: number,
// ): Response {
//     const response: HireResponse = {
//         status: "FAILURE",
//         message: message,
//         operation: "none",
//         data: null,
//         errorResponse: {
//             errorCode: code,
//             message: message,
//             timestamp: new Date().toISOString(),
//         },
//     };

//     return new Response(JSON.stringify(response), {
//         status: statusCode,
//         headers: { ...corsHeaders, "Content-Type": "application/json" },
//     });
// }

// ============================================
// hired-available-servants - Get Servants with Role-Specific Hire Status
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface HiredAvailableServantsRequest {
    residentId: string;
    societyRegistrationNumber: string;
    search?: string;
    role?: string | string[];
    recurringDays?: string | string[];
    shiftTiming?: string | string[];
    filterOption?:
        | "all"
        | "hired"
        | "available"
        | "today"
        | "thisweek"
        | "lastweek"
        | "thismonth"
        | "lastmonth"
        | "custom";
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
}

interface RoleStatus {
    role: string;
    isHired: boolean;
}

interface HireStatus {
    isHired: boolean;
    hiredRoles: string[];
    allRoles: string[];
    roleStatus: RoleStatus[];
    isRecurring: boolean | null;
    recurringDays: string[] | null;
    hiredAt: string | null;
}

interface FormattedServant {
    servantId: string;
    name: string;
    flatNumber: string;
    address: string | null;
    dob: string | null;
    gender: string | null;
    idProofType: string | null;
    idProofNumber: string | null;
    phone: string | null;
    roles: string[];
    shiftTimings: string[];
    workingHours: string | null;
    isRecurring: boolean;
    recurringDays: string[];
    scheduledArrival: string | null;
    scheduledDeparture: string | null;
    currentStatus: "Inside" | "Outside";
    imageUrl: string | null;
    createdAt: string;
    hireStatus: HireStatus;
}

interface HiredAvailableServantsResponse {
    status: "SUCCESS" | "FAILURE";
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hired: {
        count: number;
        servants: FormattedServant[];
    };
    available: {
        count: number;
        servants: FormattedServant[];
    };
    filters: {
        role: string | string[] | null;
        recurringDays: string | string[] | null;
        shiftTiming: string | string[] | null;
        filterOption: string | null;
        fromDate: string | null;
        toDate: string | null;
    };
    search: string | null;
    errorResponse: {
        errorCode: string;
        message: string;
        timestamp: string;
    } | null;
}

// Supabase query result types
interface ServantQueryResult {
    servant_id: string;
    servant_name: string;
    phone_number: string | null;
    address: string | null;
    role: string | string[] | null;
    shift_timing: string | string[] | null;
    gender: string | null;
    status: string | null;
    date_of_birth: string | null;
    id_proof_type: string | null;
    id_proof_number: string | null;
    is_recurring: boolean | null;
    scheduled_arrival: string | null;
    scheduled_departure: string | null;
    created_at: string;
}

interface BlockResult {
    block_name: string;
}

interface ResidentInfoResult {
    user_id: string;
    unit_flat_number: string;
    block: BlockResult | BlockResult[] | null;
}

interface HireJunctionResult {
    servant_id: string;
    hired_roles: string[] | null;
    is_recurring: boolean | null;
    recurring_days: string[] | null;
    created_at: string;
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SIGNED_URL_EXPIRY = 900; // 15 minutes
const BUCKET_NAME = "society-documents";

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

    if (cleanStr.includes("-") || cleanStr.includes("T")) {
        const d = new Date(cleanStr.replace(" ", "T"));
        if (!isNaN(d.getTime())) {
            return d.getHours() * 60 + d.getMinutes();
        }
    }

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
    if (dbStatus && dbStatus.trim() !== "") {
        const statusLower = dbStatus.trim().toLowerCase();
        const insideKeywords = ["inside", "in", "mark in", "marked in"];
        const outsideKeywords = ["outside", "out", "mark out", "marked out"];

        if (insideKeywords.includes(statusLower)) return "Inside";
        if (outsideKeywords.includes(statusLower)) return "Outside";
    }

    const startMins = parseTimeToMinutes(arrival);
    const endMins = parseTimeToMinutes(departure);

    if (startMins === null || endMins === null) {
        return "Outside";
    }

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

    if (startMins <= endMins) {
        return (currentMins >= startMins && currentMins <= endMins)
            ? "Inside"
            : "Outside";
    } else {
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
            if (value.startsWith("[") && value.endsWith("]")) {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.filter((item) => item && item.trim() !== "");
                }
            }
            return value.split(/[;,]/).map((item) => item.trim()).filter(
                (item) => item !== "",
            );
        } catch {
            return value.split(/[;,]/).map((item) => item.trim()).filter(
                (item) => item !== "",
            );
        }
    }

    return [];
}

/**
 * Normalize array filter to array
 */
function normalizeArrayFilter(
    value: string | string[] | undefined,
): string[] | null {
    if (!value) return null;

    if (Array.isArray(value)) {
        const filtered = value.filter((item) =>
            item && typeof item === "string" && item.trim() !== ""
        );
        if (filtered.length === 0) return null;
        if (filtered.some((item) => item.toLowerCase() === "all")) {
            return null;
        }
        return filtered.map((item) => item.trim());
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (trimmed.toLowerCase() === "all") return null;
        return [trimmed];
    }

    return null;
}

/**
 * Create signed URL for document
 */
async function createSignedUrl(rawPath: string | null): Promise<string | null> {
    if (!rawPath) return null;

    let storageKey = rawPath.trim();
    const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;

    if (storageKey.includes(marker)) {
        storageKey = storageKey.split(marker)[1];
    } else if (storageKey.includes(".amazonaws.com/")) {
        storageKey = storageKey.split(".amazonaws.com/")[1];
    }

    storageKey = storageKey.trim();

    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storageKey, SIGNED_URL_EXPIRY);

    if (error) {
        console.error(
            `Signed URL Error for path [${storageKey}]:`,
            error.message,
        );
        return null;
    }

    return data?.signedUrl ?? null;
}

/**
 * Generate signed URL for servant image
 */
async function getServantImageUrl(servantId: string): Promise<string | null> {
    try {
        const { data: docData, error: docError } = await supabaseAdmin
            .from("SSP_Document")
            .select("s3_path")
            .eq("servant", servantId)
            .ilike("document_type", "Servant Image")
            .order("uploaded_on", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (docError || !docData?.s3_path) {
            return null;
        }

        return await createSignedUrl(docData.s3_path);
    } catch (error) {
        console.error(`Error getting image for servant ${servantId}:`, error);
        return null;
    }
}

/**
 * Process a single servant record with role-specific hire status
 */
async function processServantRecord(
    servant: ServantQueryResult,
    hireStatusMap: Map<
        string,
        {
            hiredRoles: string[];
            isRecurring: boolean;
            recurringDays: string[];
            hiredAt: string;
        }
    >,
    residentFlatInfo: { unit_flat_number: string; block_name: string } | null,
): Promise<FormattedServant | null> {
    if (!servant) return null;

    // Get flat details
    const flatNum = residentFlatInfo?.unit_flat_number ?? "N/A";
    const blockName = residentFlatInfo?.block_name ?? "";
    const fullFlatAddress = blockName ? `${blockName} - ${flatNum}` : flatNum;

    // Parse arrays
    const allRolesArray = parseArrayField(servant.role);
    const shiftsArray = parseArrayField(servant.shift_timing);

    // Get image URL
    const imageUrl = await getServantImageUrl(servant.servant_id);

    // Calculate working hours and status
    const workingHours = calculateWorkingHours(
        servant.scheduled_arrival,
        servant.scheduled_departure,
    );
    const currentStatus = determineCurrentStatus(
        servant.status,
        servant.scheduled_arrival,
        servant.scheduled_departure,
    );

    // Get hire info
    const hireInfo = hireStatusMap.get(servant.servant_id);
    const hiredRoles = hireInfo?.hiredRoles || [];
    const isHired = hiredRoles.length > 0;

    // Build role status for each role
    const roleStatus: RoleStatus[] = allRolesArray.map((role) => ({
        role: role,
        isHired: hiredRoles.includes(role),
    }));

    // Safely get recurring days
    let recurringDays: string[] | null = null;
    if (
        hireInfo && hireInfo.recurringDays && hireInfo.recurringDays.length > 0
    ) {
        recurringDays = hireInfo.recurringDays;
    }

    const hireStatus: HireStatus = {
        isHired: isHired,
        hiredRoles: hiredRoles,
        allRoles: allRolesArray,
        roleStatus: roleStatus,
        isRecurring: hireInfo?.isRecurring || null,
        recurringDays: recurringDays,
        hiredAt: hireInfo?.hiredAt || null,
    };

    return {
        servantId: servant.servant_id,
        name: servant.servant_name || "Unknown",
        flatNumber: fullFlatAddress,
        address: servant.address || null,
        dob: servant.date_of_birth || null,
        gender: servant.gender || null,
        idProofType: servant.id_proof_type || null,
        idProofNumber: servant.id_proof_number || null,
        phone: servant.phone_number || null,
        roles: allRolesArray,
        shiftTimings: shiftsArray,
        workingHours,
        isRecurring: servant.is_recurring || false,
        recurringDays: [], // This is from SSP_Servant, not used for display
        scheduledArrival: servant.scheduled_arrival || null,
        scheduledDeparture: servant.scheduled_departure || null,
        currentStatus,
        imageUrl,
        createdAt: servant.created_at || new Date().toISOString(),
        hireStatus,
    };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        if (req.method !== "POST") {
            return buildErrorResponse(
                "METHOD_NOT_ALLOWED",
                "Only POST method is allowed.",
                405,
            );
        }

        const bodyText = await req.text();
        if (!bodyText || bodyText.trim() === "") {
            return buildErrorResponse(
                "BAD_REQUEST",
                "Request body is empty.",
                400,
            );
        }

        const requestData: HiredAvailableServantsRequest = JSON.parse(bodyText);

        console.log(
            "📥 Request received:",
            JSON.stringify(requestData, null, 2),
        );

        if (!requestData.residentId || requestData.residentId.trim() === "") {
            return buildErrorResponse(
                "MISSING_PARAMETERS",
                "residentId is required.",
                400,
            );
        }

        if (
            !requestData.societyRegistrationNumber ||
            requestData.societyRegistrationNumber.trim() === ""
        ) {
            return buildErrorResponse(
                "MISSING_PARAMETERS",
                "societyRegistrationNumber is required.",
                400,
            );
        }

        if (requestData.filterOption === "custom") {
            if (!requestData.fromDate || !requestData.toDate) {
                return buildErrorResponse(
                    "MISSING_PARAMETERS",
                    "fromDate and toDate are required for custom date filter.",
                    400,
                );
            }
        }

        const page = Math.max(1, requestData.page || 1);
        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, requestData.limit || DEFAULT_LIMIT),
        );
        const offset = (page - 1) * limit;

        const roleFilter = normalizeArrayFilter(requestData.role);
        const recurringDaysFilter = normalizeArrayFilter(
            requestData.recurringDays,
        );
        const shiftTimingFilter = normalizeArrayFilter(requestData.shiftTiming);

        // ============================================
        // STEP 1: Get Society
        // ============================================
        const { data: society, error: societyError } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id, registration_number, society_name")
            .eq("registration_number", requestData.societyRegistrationNumber)
            .maybeSingle();

        if (societyError) {
            console.error("❌ Society error:", societyError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                societyError.message,
                500,
            );
        }

        if (!society) {
            return buildErrorResponse(
                "NOT_FOUND",
                `Society not found: ${requestData.societyRegistrationNumber}`,
                404,
            );
        }

        // ============================================
        // STEP 2: Get Resident's Flat Info
        // ============================================
        const { data: residentInfo, error: residentError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
        user_id,
        unit_flat_number,
        block:SSP_Block!left (
          block_name
        )
      `)
            .eq("user_id", requestData.residentId)
            .eq("society", society.society_id)
            .maybeSingle();

        if (residentError) {
            console.error("❌ Resident error:", residentError);
        }

        const residentData = residentInfo as ResidentInfoResult | null;
        const flatInfo = residentData
            ? {
                unit_flat_number: residentData.unit_flat_number || "N/A",
                block_name: Array.isArray(residentData.block)
                    ? (residentData.block[0] as BlockResult)?.block_name || ""
                    : (residentData.block as BlockResult)?.block_name || "",
            }
            : null;

        // ============================================
        // STEP 3: Get Resident's Hired Servants with Roles
        // ============================================
        console.log("🔍 Getting hire status for resident...");

        const { data: hiredJunctions, error: hiredError } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .select(
                "servant_id, hired_roles, is_recurring, recurring_days, created_at",
            )
            .eq("society_user", requestData.residentId)
            .eq("hired", true);

        if (hiredError) {
            console.error("❌ Error fetching hire status:", hiredError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                hiredError.message,
                500,
            );
        }

        const hireStatusMap = new Map<
            string,
            {
                hiredRoles: string[];
                isRecurring: boolean;
                recurringDays: string[];
                hiredAt: string;
            }
        >();
        for (const junction of (hiredJunctions || []) as HireJunctionResult[]) {
            const hiredRoles = parseArrayField(junction.hired_roles);
            hireStatusMap.set(junction.servant_id, {
                hiredRoles: hiredRoles,
                isRecurring: junction.is_recurring || false,
                recurringDays: junction.recurring_days || [],
                hiredAt: junction.created_at,
            });
        }

        console.log(`✅ Found ${hireStatusMap.size} hired servants`);

        // ============================================
        // STEP 4: Get ALL Servants from SSP_Servant
        // ============================================
        console.log("🔍 Fetching all servants from society...");

        let servantQuery = supabaseAdmin
            .from("SSP_Servant")
            .select(`
        servant_id,
        servant_name,
        phone_number,
        address,
        role,
        shift_timing,
        gender,
        status,
        date_of_birth,
        id_proof_type,
        id_proof_number,
        is_recurring,
        scheduled_arrival,
        scheduled_departure,
        created_at
      `)
            .eq("society", society.society_id);

        // Apply search filter
        if (requestData.search && requestData.search.trim() !== "") {
            const term = requestData.search.trim();
            servantQuery = servantQuery.or(
                `servant_name.ilike.%${term}%,` +
                    `phone_number.ilike.%${term}%,` +
                    `address.ilike.%${term}%`,
            );
        }

        // Apply role filter
        if (roleFilter && roleFilter.length > 0) {
            const roleArray = roleFilter.map((r) => `"${r}"`).join(",");
            servantQuery = servantQuery.filter("role", "cs", `{${roleArray}}`);
        }

        // Apply shift timing filter
        if (shiftTimingFilter && shiftTimingFilter.length > 0) {
            const shiftArray = shiftTimingFilter.map((s) => `"${s}"`).join(",");
            servantQuery = servantQuery.filter(
                "shift_timing",
                "cs",
                `{${shiftArray}}`,
            );
        }

        // Note: recurring_days filter is applied on SSP_Society_Servant,
        // but we're querying SSP_Servant. We'll filter after fetching.

        // Apply date filters (only for 'all' and date options)
        if (
            requestData.filterOption !== "hired" &&
            requestData.filterOption !== "available"
        ) {
            const now = new Date();
            let startDate: Date | null = null;
            let endDate: Date | null = null;

            switch (requestData.filterOption) {
                case "today": {
                    startDate = new Date(now);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(now);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "thisweek": {
                    const dayOfWeek = now.getDay();
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - dayOfWeek);
                    startDate.setHours(0, 0, 0, 0);
                    break;
                }
                case "lastweek": {
                    const dayOfWeek = now.getDay();
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - dayOfWeek - 7);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 7);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "thismonth": {
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    startDate.setHours(0, 0, 0, 0);
                    break;
                }
                case "lastmonth": {
                    startDate = new Date(
                        now.getFullYear(),
                        now.getMonth() - 1,
                        1,
                    );
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "custom": {
                    if (requestData.fromDate && requestData.toDate) {
                        startDate = new Date(requestData.fromDate);
                        startDate.setHours(0, 0, 0, 0);
                        endDate = new Date(requestData.toDate);
                        endDate.setHours(23, 59, 59, 999);
                    }
                    break;
                }
            }

            if (startDate) {
                servantQuery = servantQuery.gte(
                    "created_at",
                    startDate.toISOString(),
                );
            }
            if (endDate) {
                servantQuery = servantQuery.lte(
                    "created_at",
                    endDate.toISOString(),
                );
            }
        }

        // Execute query with pagination
        const { data: allServants, error: servantsError, count } =
            await servantQuery
                .order("created_at", { ascending: true })
                .range(offset, offset + limit - 1);

        if (servantsError) {
            console.error("❌ Servants error:", servantsError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                servantsError.message,
                500,
            );
        }

        console.log(`📊 Found ${count || 0} total servants`);

        if (!allServants || allServants.length === 0) {
            return buildEmptyResponse(requestData);
        }

        // ============================================
        // STEP 5: Process Servants
        // ============================================
        const servantsDetailsMapped = await Promise.all(
            (allServants as ServantQueryResult[]).map((servant) =>
                processServantRecord(servant, hireStatusMap, flatInfo)
            ),
        );

        const finalServants = servantsDetailsMapped.filter(
            (s): s is FormattedServant => s !== null,
        );

        // ============================================
        // STEP 6: Apply recurring_days filter (client-side)
        // ============================================
        let filteredServants = finalServants;

        // Filter by recurring days if provided
        if (recurringDaysFilter && recurringDaysFilter.length > 0) {
            filteredServants = filteredServants.filter((servant) => {
                // Get recurring days from hire info
                const hireInfo = hireStatusMap.get(servant.servantId);
                const servantRecurringDays = hireInfo?.recurringDays || [];
                // Check if any of the filter days match
                return recurringDaysFilter.some((day) =>
                    servantRecurringDays.includes(day)
                );
            });
        }

        // Apply hired/available filter
        if (requestData.filterOption === "hired") {
            filteredServants = filteredServants.filter((s) =>
                s.hireStatus.isHired === true
            );
        } else if (requestData.filterOption === "available") {
            filteredServants = filteredServants.filter((s) =>
                s.hireStatus.isHired === false
            );
        }

        // ============================================
        // STEP 7: Split into Hired and Available
        // ============================================
        const hiredServants = filteredServants.filter((s) =>
            s.hireStatus.isHired
        );
        const availableServants = filteredServants.filter((s) =>
            !s.hireStatus.isHired
        );

        // Build response
        const totalPages = count ? Math.ceil(count / limit) : 0;

        const response = {
            status: "SUCCESS" as const,
            total: filteredServants.length,
            page: page,
            limit: limit,
            totalPages: totalPages,
            hired: {
                count: hiredServants.length,
                servants: hiredServants,
            },
            available: {
                count: availableServants.length,
                servants: availableServants,
            },
            filters: {
                role: requestData.role || null,
                recurringDays: requestData.recurringDays || null,
                shiftTiming: requestData.shiftTiming || null,
                filterOption: requestData.filterOption || null,
                fromDate: requestData.fromDate || null,
                toDate: requestData.toDate || null,
            },
            search: requestData.search || null,
            errorResponse: null,
        };

        console.log(
            `✅ Returning ${filteredServants.length} servants (${hiredServants.length} hired, ${availableServants.length} available)`,
        );

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("❌ Server error:", error);
        return buildErrorResponse(
            "SERVER_ERROR",
            error instanceof Error ? error.message : "Internal server error",
            500,
        );
    }
});

// ============================================
// EMPTY RESPONSE BUILDER
// ============================================

function buildEmptyResponse(
    requestData: HiredAvailableServantsRequest,
): Response {
    const response = {
        status: "SUCCESS" as const,
        total: 0,
        page: requestData.page || 1,
        limit: requestData.limit || DEFAULT_LIMIT,
        totalPages: 0,
        hired: {
            count: 0,
            servants: [],
        },
        available: {
            count: 0,
            servants: [],
        },
        filters: {
            role: requestData.role || null,
            recurringDays: requestData.recurringDays || null,
            shiftTiming: requestData.shiftTiming || null,
            filterOption: requestData.filterOption || null,
            fromDate: requestData.fromDate || null,
            toDate: requestData.toDate || null,
        },
        search: requestData.search || null,
        errorResponse: null,
    };

    return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// ============================================
// ERROR RESPONSE BUILDER
// ============================================

function buildErrorResponse(
    code: string,
    message: string,
    statusCode: number,
): Response {
    const response = {
        status: "FAILURE" as const,
        total: 0,
        page: 1,
        limit: 0,
        totalPages: 0,
        hired: {
            count: 0,
            servants: [],
        },
        available: {
            count: 0,
            servants: [],
        },
        filters: {
            role: null,
            recurringDays: null,
            shiftTiming: null,
            filterOption: null,
            fromDate: null,
            toDate: null,
        },
        search: null,
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
