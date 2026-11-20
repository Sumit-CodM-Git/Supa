// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'DELETE, POST, OPTIONS'
// };
// serve(async (req)=>{
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', {
//       headers: corsHeaders
//     });
//   }
//   const startTime = Date.now();
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return buildError('BAD_REQUEST', 'Request body is empty.', 400, startTime);
//     }
//     const { memberId } = JSON.parse(bodyText);
//     if (!memberId) {
//       return buildError('BAD_REQUEST', 'memberId is mandatory.', 400, startTime);
//     }
//     const targetMemberId = String(memberId).trim();
//     // 1. Fetch matching user record
//     const { data: record, error: fetchErr } = await supabase.from('SSP_Society_User').select('user_id, role').eq('user_id', targetMemberId).maybeSingle();
//     if (fetchErr) throw fetchErr;
//     if (!record) {
//       return buildError('NOT_FOUND', 'Member record not found.', 404, startTime);
//     }
//     const structuralRoleString = Array.isArray(record.role) ? record.role.join(', ') : record.role ?? 'NA';
//     // ================= STEP 2: CASCADE CLEANUP (PREVENT FK VIOLATIONS) =================
//     // Delete any dependent child records in SSP_Alert that reference this user's ID
//     const { error: alertCleanErr } = await supabase.from('SSP_Alert').delete().eq('society_user', record.user_id) // Match the exact FK column name in SSP_Alert
//     ;
//     if (alertCleanErr) throw alertCleanErr;
//     // ================= STEP 3: PERFORM MEMBER DELETION =================
//     const { error: deleteErr } = await supabase.from('SSP_Society_User').delete().eq('user_id', record.user_id);
//     if (deleteErr) throw deleteErr;
//     // 4. Construct flawless response
//     const successResponse = {
//       deleteMember: {
//         deletedData: {
//           memberId: record.user_id,
//           memberType: structuralRoleString,
//           status: 'Successfully Deleted'
//         }
//       },
//       errorResponse: null
//     };
//     console.log(`Executed secure delete pipeline for member ${record.user_id} in ${Date.now() - startTime}ms`);
//     return new Response(JSON.stringify(successResponse), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (error) {
//     return buildError('SERVER_ERROR', error.message || 'Fatal delete exception.', 500, startTime);
//   }
// });
// function buildError(code, msg, status, start) {
//   return new Response(JSON.stringify({
//     deleteMember: null,
//     errorResponse: {
//       errorCode: code,
//       message: msg,
//       timestamp: new Date().toISOString()
//     }
//   }), {
//     status,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }

// ============================================
// delete-members - Delete Members (Residents, Admin, Security, Service Agent, Vendor)
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================
interface DeleteMemberRequest {
  memberId: string;
  memberType?: string; // Optional: "society" or "vendor" - auto-detected if not provided
}

interface DeleteMemberResponse {
  memberId: string;
  memberType: string;
  status: string;
  table: string;
}

// ============================================
// HELPER: Build Error Response
// ============================================
function buildDeleteErrorResponse(
  code: string,
  message: string,
  status: number,
  startTime: number,
): Response {
  console.error(`❌ [${code}] ${message} (${Date.now() - startTime}ms)`);
  return new Response(
    JSON.stringify({
      success: false,
      error: code,
      message: message,
      deleteMember: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString(),
      },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

// ============================================
// HELPER: Delete Society User (Resident, Admin, Security, Service Agent)
// ============================================
async function deleteSocietyUser(
  supabaseAdmin: any,
  memberId: string,
): Promise<{ success: boolean; role: string }> {
  // Fetch user record
  const { data: record, error: fetchErr } = await supabaseAdmin
    .from("SSP_Society_User")
    .select("user_id, role, contact")
    .eq("user_id", memberId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed to fetch member: ${fetchErr.message}`);
  }

  if (!record) {
    throw new Error("Member not found");
  }

  const roleString = Array.isArray(record.role)
    ? record.role.join(", ")
    : record.role || "NA";

  // Check if user has dependent records
  const tablesToCheck = [
    { table: "SSP_Complaint", column: "society_user" },
    { table: "SSP_Facility_Booking", column: "requested_by" },
    { table: "SSP_Alert", column: "society_user" },
    { table: "SSP_Notice", column: "created_by" },
  ];

  for (const { table, column } of tablesToCheck) {
    const { data: dependentRecords, error: checkError } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq(column, memberId)
      .limit(1);

    if (checkError) {
      console.warn(`⚠️ Failed to check dependencies in ${table}:`, checkError);
      continue;
    }

    if (dependentRecords && dependentRecords.length > 0) {
      // Delete dependent records
      const { error: deleteDependencyError } = await supabaseAdmin
        .from(table)
        .delete()
        .eq(column, memberId);

      if (deleteDependencyError) {
        console.warn(
          `⚠️ Failed to delete dependencies in ${table}:`,
          deleteDependencyError,
        );
      }
    }
  }

  // Get contact_id before deleting the user
  const contactId = record.contact;

  // Delete the society user
  const { error: deleteErr } = await supabaseAdmin
    .from("SSP_Society_User")
    .delete()
    .eq("user_id", memberId);

  if (deleteErr) {
    throw new Error(`Failed to delete member: ${deleteErr.message}`);
  }

  // Optionally delete the contact if not linked to any other user
  if (contactId) {
    const { data: otherUsers, error: checkContactError } = await supabaseAdmin
      .from("SSP_Society_User")
      .select("user_id")
      .eq("contact", contactId)
      .limit(1);

    if (!checkContactError && (!otherUsers || otherUsers.length === 0)) {
      // Check if contact is used by vendor
      const { data: vendorUsers, error: vendorCheckError } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select("non_society_user_id")
        .eq("contact", contactId)
        .limit(1);

      if (!vendorCheckError && (!vendorUsers || vendorUsers.length === 0)) {
        // No other users reference this contact, safe to delete
        const { error: deleteContactErr } = await supabaseAdmin
          .from("SSP_Contact")
          .delete()
          .eq("contact_id", contactId);

        if (deleteContactErr) {
          console.warn(
            `⚠️ Failed to delete contact: ${deleteContactErr.message}`,
          );
        }
      }
    }
  }

  return {
    success: true,
    role: roleString,
  };
}

// ============================================
// HELPER: Delete Vendor User (Non-Society User)
// ============================================
async function deleteVendorUser(
  supabaseAdmin: any,
  memberId: string,
): Promise<{ success: boolean; role: string; vendorId: string }> {
  // Fetch vendor record
  const { data: record, error: fetchErr } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .select("non_society_user_id, role, vendor_id")
    .eq("non_society_user_id", memberId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed to fetch vendor: ${fetchErr.message}`);
  }

  if (!record) {
    throw new Error("Vendor not found");
  }

  const vendorId = record.vendor_id || "NA";

  // Delete the vendor
  const { error: deleteErr } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .delete()
    .eq("non_society_user_id", memberId);

  if (deleteErr) {
    throw new Error(`Failed to delete vendor: ${deleteErr.message}`);
  }

  return {
    success: true,
    role: record.role || "Vendor",
    vendorId: vendorId,
  };
}

// ============================================
// HELPER: Determine Member Type
// ============================================
async function determineMemberType(
  supabaseAdmin: any,
  memberId: string,
): Promise<
  { type: "society" | "vendor" | "not_found"; role?: string; vendorId?: string }
> {
  // Check in SSP_Society_User
  const { data: societyRecord, error: societyError } = await supabaseAdmin
    .from("SSP_Society_User")
    .select("user_id, role")
    .eq("user_id", memberId)
    .maybeSingle();

  if (!societyError && societyRecord) {
    const roleString = Array.isArray(societyRecord.role)
      ? societyRecord.role.join(", ")
      : societyRecord.role || "NA";
    return { type: "society", role: roleString };
  }

  // Check in SSP_Non_Society_User (vendors)
  const { data: vendorRecord, error: vendorError } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .select("non_society_user_id, role, vendor_id")
    .eq("non_society_user_id", memberId)
    .maybeSingle();

  if (!vendorError && vendorRecord) {
    return {
      type: "vendor",
      role: vendorRecord.role || "Vendor",
      vendorId: vendorRecord.vendor_id || "NA",
    };
  }

  return { type: "not_found" };
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      console.log("🗑️ delete-members called");
      console.log(`👤 Authenticated user: ${authCtx.user.id}`);

      // Allow POST and DELETE methods
      if (req.method !== "POST" && req.method !== "DELETE") {
        return errorResponse("Only POST or DELETE methods are allowed.", 405);
      }

      // Parse request body
      const body = await parseRequestBody<DeleteMemberRequest>(req);
      if (!body) {
        return buildDeleteErrorResponse(
          "BAD_REQUEST",
          "Request body is required.",
          400,
          startTime,
        );
      }

      const { memberId, memberType } = body;

      if (!memberId) {
        return buildDeleteErrorResponse(
          "BAD_REQUEST",
          "memberId is mandatory.",
          400,
          startTime,
        );
      }

      const targetMemberId = String(memberId).trim();

      // ============================================
      // STEP 1: Determine member type if not provided
      // ============================================
      let typeInfo = await determineMemberType(supabaseAdmin, targetMemberId);

      if (typeInfo.type === "not_found") {
        return buildDeleteErrorResponse(
          "NOT_FOUND",
          "Member not found.",
          404,
          startTime,
        );
      }

      // Override with provided memberType if given
      let targetType = typeInfo.type;
      if (memberType) {
        const providedType = memberType.toLowerCase();
        if (providedType === "society" || providedType === "vendor") {
          targetType = providedType as "society" | "vendor";
        } else {
          return buildDeleteErrorResponse(
            "BAD_REQUEST",
            "Invalid memberType. Must be 'society' or 'vendor'.",
            400,
            startTime,
          );
        }
      }

      console.log(`🔍 Found member: type=${targetType}, role=${typeInfo.role}`);

      // ============================================
      // STEP 2: Delete based on type
      // ============================================
      let result: { success: boolean; role: string; vendorId?: string };

      if (targetType === "vendor") {
        result = await deleteVendorUser(supabaseAdmin, targetMemberId);
      } else {
        result = await deleteSocietyUser(supabaseAdmin, targetMemberId);
      }

      // ============================================
      // STEP 3: Response
      // ============================================
      console.log(
        `✅ Member deleted: ${targetMemberId} in ${Date.now() - startTime}ms`,
      );

      const response: any = {
        memberId: targetMemberId,
        memberType: result.role,
        status: "Successfully Deleted",
        table: targetType === "vendor"
          ? "SSP_Non_Society_User"
          : "SSP_Society_User",
      };

      // Add vendorId if available
      if (result.vendorId) {
        response.vendorId = result.vendorId;
      }

      return successResponse({
        deletedMember: response,
      });
    } catch (error: any) {
      console.error("❌ delete-members error:", error);
      return buildDeleteErrorResponse(
        "SERVER_ERROR",
        error.message || "Failed to delete member",
        500,
        startTime,
      );
    }
  }),
);
