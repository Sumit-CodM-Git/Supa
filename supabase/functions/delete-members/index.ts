import { residentFlatTypeFields } from "../_shared/resident-flat-type.ts";
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
    .select("user_id, role, contact, deleted_at")
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

  // Preserve linked visitor, complaint, booking and payment history.
  // A physical DELETE cannot safely satisfy all member foreign keys.
  if (!record.deleted_at) {
    const { data: saved, error: deleteErr } = await supabaseAdmin
      .from("SSP_Society_User")
      .update({ deleted_at: new Date().toISOString(), status: false, one_time_password_otp: null })
      .eq("user_id", memberId)
      .is("deleted_at", null)
      .select("user_id")
      .maybeSingle();
    if (deleteErr) throw new Error(`Failed to delete member: ${deleteErr.message}`);
    if (!saved) {
      const {data: latest, error} = await supabaseAdmin.from("SSP_Society_User")
        .select("deleted_at").eq("user_id", memberId).maybeSingle();
      if (error || !latest?.deleted_at) throw new Error("Member changed. Please refresh and retry.");
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

      const {data: caller, error: callerError} = await supabaseAdmin
        .from("SSP_Society_User")
        .select("society, role, deleted_at")
        .eq("user_id", authCtx.user.id)
        .maybeSingle();
      if (callerError) throw new Error("Failed to verify admin access.");
      if (!caller || caller.deleted_at || !Array.isArray(caller.role) || !caller.role.includes("admin")) {
        return buildDeleteErrorResponse("FORBIDDEN", "Only a society admin can delete members.", 403, startTime);
      }
      if (targetType !== typeInfo.type) {
        return buildDeleteErrorResponse("BAD_REQUEST", "memberType does not match the member record.", 400, startTime);
      }
      const {data: target, error: targetError} = await supabaseAdmin
        .from(targetType === "vendor" ? "SSP_Non_Society_User" : "SSP_Society_User")
        .select(targetType === "vendor" ? "society" : "society,flat_type_id,flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type)")
        .eq(targetType === "vendor" ? "non_society_user_id" : "user_id", targetMemberId)
        .maybeSingle();
      if (targetError) throw new Error("Failed to verify member society.");
      if (!target || target.society !== caller.society) {
        return buildDeleteErrorResponse("FORBIDDEN", "Member does not belong to your society.", 403, startTime);
      }

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
        deletedMember: {...response, ...(targetType === "vendor" ? {} : residentFlatTypeFields(target))},
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
