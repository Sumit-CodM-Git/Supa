import { optionalAuth } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/response.ts";
import { extractRelation, parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
interface GetOTPRequest {
    phoneNumber: string;
    registrationNumber: string;
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
function generateOTP(): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = String(now.getFullYear()).slice(-2);
    return `${day}${month}${year}`;
}
function createOTPErrorResponse(code: string, message: string, status: number): Response {
    return new Response(JSON.stringify({
        otp: null,
        errorResponse: {
            errorCode: code,
            message,
            timestamp: new Date().toISOString(),
        },
    }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
Deno.serve(optionalAuth(async (req: Request, _authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        if (req.method !== "POST") {
            return createOTPErrorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed.", 405);
        }
        const body = await parseRequestBody<GetOTPRequest>(req);
        if (!body) {
            return createOTPErrorResponse("BAD_REQUEST", "Request body is required.", 400);
        }
        const phoneNumber = body.phoneNumber?.toString().trim();
        const registrationNumber = body.registrationNumber?.toString().trim();
        if (!phoneNumber || !registrationNumber) {
            return createOTPErrorResponse("BAD_REQUEST", "phoneNumber and registrationNumber are required.", 400);
        }
        const otpString = generateOTP();
        console.log(`Generated OTP: ${otpString} for phone: ${phoneNumber}`);
        const { data: sUsers, error: sError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
          user_id,
          role,
          society:SSP_Society (registration_number),
          contact:SSP_Contact (parking_slot, phone)
        `)
            .is("deleted_at", null);
        if (sError) {
            return createOTPErrorResponse("QUERY_ERROR", sError.message, 400);
        }
        const sUser = sUsers?.find((u: any) => {
            const contact = extractRelation<{
                phone: string;
            }>(u.contact);
            const society = extractRelation<{
                registration_number: string;
            }>(u.society);
            const dbPhone = String(contact?.phone ?? "").trim();
            const dbReg = String(society?.registration_number ?? "").trim();
            return dbPhone === phoneNumber && dbReg === registrationNumber;
        });
        if (sUser) {
            console.log(`✅ Society user found: ${sUser.user_id}`);
            const { error: updateError } = await supabaseAdmin
                .from("SSP_Society_User")
                .update({ one_time_password_otp: otpString })
                .eq("user_id", sUser.user_id);
            if (updateError) {
                return createOTPErrorResponse("UPDATE_ERROR", updateError.message, 400);
            }
            return new Response(JSON.stringify({
                otp: otpString,
                errorResponse: null,
                userType: "society_user",
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        console.log("🔍 Checking vendors...");
        const { data: vendors, error: vError } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .select(`
          non_society_user_id,
          phone_number,
          role,
          society:SSP_Society (registration_number)
        `)
            .ilike("role", "vendor");
        if (vError) {
            return createOTPErrorResponse("QUERY_ERROR", vError.message, 400);
        }
        const vendor = vendors?.find((v: any) => {
            const society = extractRelation<{
                registration_number: string;
            }>(v.society);
            const dbPhone = String(v.phone_number ?? "").trim();
            const dbReg = String(society?.registration_number ?? "").trim();
            return dbPhone === phoneNumber && dbReg === registrationNumber;
        });
        if (vendor) {
            console.log(`✅ Vendor found: ${vendor.non_society_user_id}`);
            const { error: updateError } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .update({ one_time_password: otpString })
                .eq("non_society_user_id", vendor.non_society_user_id);
            if (updateError) {
                return createOTPErrorResponse("UPDATE_ERROR", updateError.message, 400);
            }
            return new Response(JSON.stringify({
                otp: otpString,
                errorResponse: null,
                userType: "vendor",
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        return createOTPErrorResponse("NOT_FOUND", "No user or vendor found matching this phone number and registration number.", 404);
    }
    catch (err: any) {
        console.error("Unhandled error:", err);
        return createOTPErrorResponse("SERVER_ERROR", err.message || "Internal server error", 500);
    }
}));
