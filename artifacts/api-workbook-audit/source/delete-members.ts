import { residentFlatTypeFields } from "../_shared/resident-flat-type.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
interface DeleteMemberRequest {
    memberId: string;
    memberType?: string;
}
interface DeleteMemberResponse {
    memberId: string;
    memberType: string;
    status: string;
    table: string;
}
function buildDeleteErrorResponse(code: string, message: string, status: number, startTime: number): Response {
    console.error(`❌ [${code}] ${message} (${Date.now() - startTime}ms)`);
    return new Response(JSON.stringify({
        success: false,
        error: code,
        message: message,
        deleteMember: null,
        errorResponse: {
            errorCode: code,
            message: message,
            timestamp: new Date().toISOString(),
        },
    }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
async function deleteSocietyUser(supabaseAdmin: any, memberId: string): Promise<{
    success: boolean;
    role: string;
}> {
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
    if (!record.deleted_at) {
        const { data: saved, error: deleteErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .update({ deleted_at: new Date().toISOString(), status: false, one_time_password_otp: null })
            .eq("user_id", memberId)
            .is("deleted_at", null)
            .select("user_id")
            .maybeSingle();
        if (deleteErr)
            throw new Error(`Failed to delete member: ${deleteErr.message}`);
        if (!saved) {
            const { data: latest, error } = await supabaseAdmin.from("SSP_Society_User")
                .select("deleted_at").eq("user_id", memberId).maybeSingle();
            if (error || !latest?.deleted_at)
                throw new Error("Member changed. Please refresh and retry.");
        }
    }
    return {
        success: true,
        role: roleString,
    };
}
async function deleteVendorUser(supabaseAdmin: any, memberId: string): Promise<{
    success: boolean;
    role: string;
    vendorId: string;
}> {
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
async function determineMemberType(supabaseAdmin: any, memberId: string): Promise<{
    type: "society" | "vendor" | "not_found";
    role?: string;
    vendorId?: string;
}> {
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
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const startTime = Date.now();
    try {
        console.log("🗑️ delete-members called");
        console.log(`👤 Authenticated user: ${authCtx.user.id}`);
        if (req.method !== "POST" && req.method !== "DELETE") {
            return errorResponse("Only POST or DELETE methods are allowed.", 405);
        }
        const body = await parseRequestBody<DeleteMemberRequest>(req);
        if (!body) {
            return buildDeleteErrorResponse("BAD_REQUEST", "Request body is required.", 400, startTime);
        }
        const { memberId, memberType } = body;
        if (!memberId) {
            return buildDeleteErrorResponse("BAD_REQUEST", "memberId is mandatory.", 400, startTime);
        }
        const targetMemberId = String(memberId).trim();
        let typeInfo = await determineMemberType(supabaseAdmin, targetMemberId);
        if (typeInfo.type === "not_found") {
            return buildDeleteErrorResponse("NOT_FOUND", "Member not found.", 404, startTime);
        }
        let targetType = typeInfo.type;
        if (memberType) {
            const providedType = memberType.toLowerCase();
            if (providedType === "society" || providedType === "vendor") {
                targetType = providedType as "society" | "vendor";
            }
            else {
                return buildDeleteErrorResponse("BAD_REQUEST", "Invalid memberType. Must be 'society' or 'vendor'.", 400, startTime);
            }
        }
        console.log(`🔍 Found member: type=${targetType}, role=${typeInfo.role}`);
        const { data: caller, error: callerError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("society, role, deleted_at")
            .eq("user_id", authCtx.user.id)
            .maybeSingle();
        if (callerError)
            throw new Error("Failed to verify admin access.");
        if (!caller || caller.deleted_at || !Array.isArray(caller.role) || !caller.role.includes("admin")) {
            return buildDeleteErrorResponse("FORBIDDEN", "Only a society admin can delete members.", 403, startTime);
        }
        if (targetType !== typeInfo.type) {
            return buildDeleteErrorResponse("BAD_REQUEST", "memberType does not match the member record.", 400, startTime);
        }
        const { data: target, error: targetError } = await supabaseAdmin
            .from(targetType === "vendor" ? "SSP_Non_Society_User" : "SSP_Society_User")
            .select(targetType === "vendor" ? "society" : "society,flat_type_id,flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type)")
            .eq(targetType === "vendor" ? "non_society_user_id" : "user_id", targetMemberId)
            .maybeSingle();
        if (targetError)
            throw new Error("Failed to verify member society.");
        if (!target || target.society !== caller.society) {
            return buildDeleteErrorResponse("FORBIDDEN", "Member does not belong to your society.", 403, startTime);
        }
        let result: {
            success: boolean;
            role: string;
            vendorId?: string;
        };
        if (targetType === "vendor") {
            result = await deleteVendorUser(supabaseAdmin, targetMemberId);
        }
        else {
            result = await deleteSocietyUser(supabaseAdmin, targetMemberId);
        }
        console.log(`✅ Member deleted: ${targetMemberId} in ${Date.now() - startTime}ms`);
        const response: any = {
            memberId: targetMemberId,
            memberType: result.role,
            status: "Successfully Deleted",
            table: targetType === "vendor"
                ? "SSP_Non_Society_User"
                : "SSP_Society_User",
        };
        if (result.vendorId) {
            response.vendorId = result.vendorId;
        }
        return successResponse({
            deletedMember: { ...response, ...(targetType === "vendor" ? {} : residentFlatTypeFields(target)) },
        });
    }
    catch (error: any) {
        console.error("❌ delete-members error:", error);
        return buildDeleteErrorResponse("SERVER_ERROR", error.message || "Failed to delete member", 500, startTime);
    }
}));
