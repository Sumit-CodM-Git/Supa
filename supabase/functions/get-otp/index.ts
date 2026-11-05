// import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
// };
// Deno.serve(async (req)=>{
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', {
//       headers: corsHeaders
//     });
//   }
//   try {
//     const body = await req.json().catch(()=>null);
//     if (!body?.phoneNumber || !body?.registrationNumber) {
//       return createErrorResponse('BAD_REQUEST', 'Missing phoneNumber or registrationNumber', 400);
//     }
//     const phoneNumber = String(body.phoneNumber).trim();
//     const registrationNumber = String(body.registrationNumber).trim();
//     const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
//     // Generate OTP based on current timestamp layout (DDMMYY format)
//     const now = new Date();
//     const otpString = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
//     console.log('Generated OTP String:', otpString);
//     // ================= STEP 1: CHECK SSP_SOCIETY_USER =================
//     const { data: sUsers, error: sError } = await supabaseAdmin.from('SSP_Society_User') //subscription_plan
//     .select(`
//         user_id,
//         role,
//         society:SSP_Society (

//           registration_number
//         ),
//         contact:SSP_Contact (
//           phone
//         )
//       `);
//     if (sError) return createErrorResponse('QUERY_ERROR', sError.message, 400);
//     const sUser = sUsers?.find((u)=>String(u.contact?.phone).trim() === phoneNumber && String(u.society?.registration_number).trim() === registrationNumber);
//     if (sUser) {
//       // Role validation for Society Users
//       /* const roles = sUser.role || []
//       if (roles.includes('Service Agent') ){//&& sUser.society?.subscription_plan !== 'Premium') {
//         return createErrorResponse(
//           'PLAN_RESTRICTION',
//           'Service Agent access requires Premium plan.',
//           403
//         )
//       }*/ // Update string field for standard user profile
//       const { error: updateError } = await supabaseAdmin.from('SSP_Society_User').update({
//         one_time_password_otp: otpString
//       }).eq('user_id', sUser.user_id);
//       if (updateError) return createErrorResponse('UPDATE_ERROR', updateError.message, 400);
//       return createSuccessResponse(otpString);
//     }
//     // ================= STEP 2: FALLBACK TO SSP_NON_SOCIETY_USER =================
//     console.log('User not found in SSP_Society_User. Checking SSP_Non_Society_User...');
//     const { data: nsUsers, error: nsError } = await supabaseAdmin.from('SSP_Non_Society_User').select(`
//         non_society_user_id,
//         phone_number,
//         society:SSP_Society (
//           registration_number
//         )
//       `);
//     if (nsError) return createErrorResponse('QUERY_ERROR', nsError.message, 400);
//     const nsUser = nsUsers?.find((nu)=>String(nu.phone_number).trim() === phoneNumber && String(nu.society?.registration_number).trim() === registrationNumber);
//     if (!nsUser) {
//       return createErrorResponse('NOT_FOUND', 'No user or guest found matching this phone number and registration number.', 404);
//     }
//     // FIXED: Directly saving otpString as raw text now that the DB schemas match
//     const { error: nsUpdateError } = await supabaseAdmin.from('SSP_Non_Society_User').update({
//       one_time_password: otpString
//     }).eq('non_society_user_id', nsUser.non_society_user_id);
//     if (nsUpdateError) return createErrorResponse('UPDATE_ERROR', nsUpdateError.message, 400);
//     return createSuccessResponse(otpString);
//   } catch (err) {
//     console.error(err);
//     return createErrorResponse('SERVER_ERROR', err instanceof Error ? err.message : 'Unknown server error', 500);
//   }
// });
// function createSuccessResponse(otp) {
//   return new Response(JSON.stringify({
//     otp,
//     errorResponse: null
//   }), {
//     status: 200,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }
// function createErrorResponse(code, message, status) {
//   return new Response(JSON.stringify({
//     otp: null,
//     errorResponse: {
//       errorCode: code,
//       message,
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
// get-otp - Generate OTP for Society Users & Vendors
// ============================================

import { optionalAuth } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/response.ts";
import { extractRelation, parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// Define request type
interface GetOTPRequest {
  phoneNumber: string;
  registrationNumber: string;
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function generateOTP(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

function createOTPErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return new Response(
    JSON.stringify({
      otp: null,
      errorResponse: {
        errorCode: code,
        message,
        timestamp: new Date().toISOString(),
      },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

Deno.serve(
  optionalAuth(async (req: Request, _authCtx: any) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return createOTPErrorResponse(
          "METHOD_NOT_ALLOWED",
          "Only POST method is allowed.",
          405,
        );
      }

      const body = await parseRequestBody<GetOTPRequest>(req);
      if (!body) {
        return createOTPErrorResponse(
          "BAD_REQUEST",
          "Request body is required.",
          400,
        );
      }

      const phoneNumber = body.phoneNumber?.toString().trim();
      const registrationNumber = body.registrationNumber?.toString().trim();

      if (!phoneNumber || !registrationNumber) {
        return createOTPErrorResponse(
          "BAD_REQUEST",
          "phoneNumber and registrationNumber are required.",
          400,
        );
      }

      const otpString = generateOTP();
      console.log(`Generated OTP: ${otpString} for phone: ${phoneNumber}`);

      // ============================================
      // STEP 1: Check SSP_Society_User (Residents, Admin, Security, Service Agent)
      // ============================================
      const { data: sUsers, error: sError } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
          user_id,
          role,
          society:SSP_Society (registration_number),
          contact:SSP_Contact (phone)
        `);

      if (sError) {
        return createOTPErrorResponse("QUERY_ERROR", sError.message, 400);
      }

      const sUser = sUsers?.find((u: any) => {
        const contact = extractRelation<{ phone: string }>(u.contact);
        const society = extractRelation<{ registration_number: string }>(
          u.society,
        );
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
          return createOTPErrorResponse(
            "UPDATE_ERROR",
            updateError.message,
            400,
          );
        }

        return new Response(
          JSON.stringify({
            otp: otpString,
            errorResponse: null,
            userType: "society_user",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ============================================
      // STEP 2: Check SSP_Non_Society_User - ONLY VENDORS
      // ============================================
      console.log("🔍 Checking vendors...");

      const { data: vendors, error: vError } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(`
          non_society_user_id,
          phone_number,
          role,
          society:SSP_Society (registration_number)
        `)
        .eq("role", "Vendor"); // ✅ Only fetch vendors

      if (vError) {
        return createOTPErrorResponse("QUERY_ERROR", vError.message, 400);
      }

      const vendor = vendors?.find((v: any) => {
        const society = extractRelation<{ registration_number: string }>(
          v.society,
        );
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
          return createOTPErrorResponse(
            "UPDATE_ERROR",
            updateError.message,
            400,
          );
        }

        return new Response(
          JSON.stringify({
            otp: otpString,
            errorResponse: null,
            userType: "vendor", // ✅ Specific vendor type
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ============================================
      // STEP 3: No user found
      // ============================================
      return createOTPErrorResponse(
        "NOT_FOUND",
        "No user or vendor found matching this phone number and registration number.",
        404,
      );
    } catch (err: any) {
      console.error("Unhandled error:", err);
      return createOTPErrorResponse(
        "SERVER_ERROR",
        err.message || "Internal server error",
        500,
      );
    }
  }),
);
