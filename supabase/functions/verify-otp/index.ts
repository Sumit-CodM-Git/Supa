// ============================================
// verify-otp - Verify OTP for Society Users & Vendors
// ============================================

import { optionalAuth } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/response.ts";
import { firstOrNull, parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================
interface VerifyOTPRequest {
  phoneNumber: string;
  registrationNumber: string;
  otp: string;
}

interface Contact {
  contact_id: string;
  name: string;
  phone: string;
  email: string;
}

interface Society {
  society_id: string;
  society_name: string;
  registration_number: string;
}

// ============================================
// HELPERS
// ============================================
function buildErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  console.error(`❌ [${code}] ${message}`);
  return new Response(
    JSON.stringify({
      success: false,
      error: code,
      message: message,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

async function generateJwtToken(
  userId: string,
  authUserId: string,
  roles: string[],
): Promise<string | null> {
  try {
    const jwtSecret = Deno.env.get("JWT_SECRET") ||
      Deno.env.get("SUPABASE_JWT_SECRET");

    if (!jwtSecret) {
      console.error("❌ JWT_SECRET not configured!");
      return null;
    }

    const { create, getNumericDate } = await import(
      "https://deno.land/x/djwt@v2.8/mod.ts"
    );

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const token = await create(
      { alg: "HS256", typ: "JWT" },
      {
        aud: "authenticated",
        iss: "supabase",
        sub: authUserId,
        role: "authenticated",
        user_id: userId,
        roles: roles,
        iat: getNumericDate(0),
        exp: getNumericDate(60 * 60 * 24),
      },
      key,
    );

    return token;
  } catch (error) {
    console.error("❌ Error generating JWT:", error);
    return null;
  }
}

// ✅ FIXED: Added `roles` parameter to save into auth metadata
async function getOrCreateAuthUser(
  supabaseAdmin: any,
  userEmail: string,
  userName: string,
  userId: string,
  roles: string[] = [], 
): Promise<any> {
  try {
    const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin
      .listUsers();

    if (listError) {
      console.error("❌ List users error:", listError);
    }

    let authUser = authUsers?.users?.find((u: any) => {
      return u.email === userEmail || u.user_metadata?.user_id === userId;
    });

    if (authUser) {
      console.log(`✅ Auth user found: ${authUser.id}`);

      // ✅ FIXED: Save roles into metadata on update
      await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        user_metadata: {
          ...authUser.user_metadata,
          user_id: userId,
          name: userName,
          roles: roles, 
        },
      });
      console.log(`✅ Auth user metadata updated`);

      return authUser;
    }

    console.log(`📝 Creating new auth user for: ${userEmail}`);

    const tempPassword = Math.random().toString(36).slice(-12) + "A1!";

    // ✅ FIXED: Save roles into metadata on creation
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin
      .createUser({
        email: userEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          user_id: userId,
          name: userName,
          roles: roles, 
        },
      });

    if (createError) {
      console.error("❌ Failed to create auth user:", createError);
      return null;
    }

    console.log(`✅ Auth user created: ${newUser.user.id}`);
    return newUser.user;
  } catch (error) {
    console.error("❌ Error in getOrCreateAuthUser:", error);
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  optionalAuth(async (req: Request, _authCtx: unknown) => {
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

      const body = await parseRequestBody<VerifyOTPRequest>(req);
      if (!body) {
        return buildErrorResponse(
          "BAD_REQUEST",
          "Request body is required.",
          400,
        );
      }

      const { phoneNumber, registrationNumber, otp } = body;

      if (!phoneNumber || !registrationNumber || !otp) {
        return buildErrorResponse(
          "BAD_REQUEST",
          "phoneNumber, registrationNumber, and otp are required.",
          400,
        );
      }

      const searchPhone = String(phoneNumber).trim();
      const searchRegistration = String(registrationNumber).trim();
      const searchOtp = String(otp).trim();

      console.log(`🔍 Verifying OTP for phone: ${searchPhone}`);

      // ============================================
      // STEP 1: Check Society Users (Resident, Admin, etc.)
      // ============================================
      console.log("🔍 Checking society users...");

      const { data: societyUsers, error: userError } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
                    user_id,
                    role,
                    one_time_password_otp,
                    contact:contact (
                        contact_id,
                        name,
                        phone,
                        email
                    ),
                    society:society (
                        society_id,
                        society_name,
                        registration_number
                    )
                `);

      if (userError) {
        console.error("❌ User fetch error:", userError);
        return buildErrorResponse(
          "SERVER_ERROR",
          "Failed to fetch user data.",
          500,
        );
      }

      const matchedUser = societyUsers?.find((u: any) => {
        const contact = firstOrNull<Contact>(u.contact);
        const society = firstOrNull<Society>(u.society);
        const dbPhone = String(contact?.phone ?? "").trim();
        const dbReg = String(society?.registration_number ?? "").trim();
        return dbPhone === searchPhone && dbReg === searchRegistration;
      });

      // ============================================
      // STEP 2: If Society User found, process them
      // ============================================
      if (matchedUser) {
        console.log(`✅ Society user found: ${matchedUser.user_id}`);

        const contact = firstOrNull<Contact>(matchedUser.contact);
        const society = firstOrNull<Society>(matchedUser.society);

        const storedOtp = String(matchedUser.one_time_password_otp ?? "")
          .trim();
        console.log(`📝 Stored OTP: ${storedOtp}, Received: ${searchOtp}`);

        if (!storedOtp || storedOtp !== searchOtp) {
          return buildErrorResponse(
            "UNAUTHORIZED",
            "Invalid OTP. Please try again.",
            401,
          );
        }

        // Invalidate OTP
        await supabaseAdmin
          .from("SSP_Society_User")
          .update({ one_time_password_otp: null })
          .eq("user_id", matchedUser.user_id);

        // FIX: Standardize base roles to lowercase
        let roles = Array.isArray(matchedUser.role)
          ? matchedUser.role.map((r: string) => r.toLowerCase().trim())
          : [String(matchedUser.role).toLowerCase().trim()];

        // FIX: Check if this same user is ALSO a vendor in this society
        const { data: vendorCheck } = await supabaseAdmin
          .from("SSP_Non_Society_User")
          .select("non_society_user_id")
          .eq("society", society?.society_id)
          .ilike("phone_number", `%${searchPhone}%`)
          .ilike("role", "vendor")
          .maybeSingle();

        if (vendorCheck && !roles.includes("vendor")) {
          roles.push("vendor");
        }

        // Get/Create Auth User
        const userEmail = contact?.email || `${contact?.phone}@temp.user`;
        const userName = contact?.name || "User";

        // ✅ FIXED: Pass roles to the auth user creation function
        const authUser = await getOrCreateAuthUser(
          supabaseAdmin,
          userEmail,
          userName,
          matchedUser.user_id,
          roles 
        );

        if (!authUser) {
          return buildErrorResponse(
            "SERVER_ERROR",
            "Unable to authenticate user.",
            500,
          );
        }

        const jwtToken = await generateJwtToken(
          matchedUser.user_id,
          authUser.id,
          roles,
        );

        if (!jwtToken) {
          return buildErrorResponse(
            "SERVER_ERROR",
            "Failed to generate token.",
            500,
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            token: jwtToken,
            user: {
              id: matchedUser.user_id,
              name: userName,
              phone: contact?.phone || "",
              email: userEmail,
              roles: roles,
              userType: "society_user",
              society: {
                id: society?.society_id || null,
                name: society?.society_name || null,
                registrationNumber: society?.registration_number || null,
              },
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ============================================
      // STEP 3: Check Vendors (If not a society user)
      // ============================================
      console.log("🔍 Checking vendors...");

      const { data: vendors, error: vendorError } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(`
                    non_society_user_id,
                    name,
                    phone_number,
                    email,
                    role,
                    one_time_password,
                    vendor_id,
                    society:society (
                        society_id,
                        society_name,
                        registration_number
                    )
                `)
        .eq("role", "Vendor"); // ✅ Only fetch vendors

      if (vendorError) {
        console.error("❌ Vendor fetch error:", vendorError);
        return buildErrorResponse(
          "SERVER_ERROR",
          "Failed to fetch vendor data.",
          500,
        );
      }

      const matchedVendor = vendors?.find((v: any) => {
        const society = firstOrNull<Society>(v.society);
        const dbPhone = String(v.phone_number ?? "").trim();
        const dbReg = String(society?.registration_number ?? "").trim();
        return dbPhone === searchPhone && dbReg === searchRegistration;
      });

      // ============================================
      // STEP 4: If Vendor found, process them
      // ============================================
      if (matchedVendor) {
        console.log(`✅ Vendor found: ${matchedVendor.non_society_user_id}`);

        const society = firstOrNull<Society>(matchedVendor.society);

        const storedOtp = String(matchedVendor.one_time_password ?? "").trim();
        console.log(`📝 Stored OTP: ${storedOtp}, Received: ${searchOtp}`);

        if (!storedOtp || storedOtp !== searchOtp) {
          return buildErrorResponse(
            "UNAUTHORIZED",
            "Invalid OTP. Please try again.",
            401,
          );
        }

        // Invalidate OTP
        await supabaseAdmin
          .from("SSP_Non_Society_User")
          .update({ one_time_password: null })
          .eq("non_society_user_id", matchedVendor.non_society_user_id);

        // Get/Create Auth User for Vendor
        const userEmail = matchedVendor.email ||
          `${matchedVendor.phone_number}@vendor.temp`;
        const userName = matchedVendor.name || "vendor";
        
        const roles = ["vendor"];

        // ✅ FIXED: Pass roles to the auth user creation function
        const authUser = await getOrCreateAuthUser(
          supabaseAdmin,
          userEmail,
          userName,
          matchedVendor.non_society_user_id,
          roles
        );

        if (!authUser) {
          return buildErrorResponse(
            "SERVER_ERROR",
            "Unable to authenticate vendor.",
            500,
          );
        }

        const jwtToken = await generateJwtToken(
          matchedVendor.non_society_user_id,
          authUser.id,
          roles,
        );

        if (!jwtToken) {
          return buildErrorResponse(
            "SERVER_ERROR",
            "Failed to generate token.",
            500,
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            token: jwtToken,
            user: {
              id: matchedVendor.non_society_user_id,
              name: matchedVendor.name,
              phone: matchedVendor.phone_number,
              email: matchedVendor.email,
              roles: roles,
              userType: "vendor",
              vendorId: matchedVendor.vendor_id,
              society: {
                id: society?.society_id || null,
                name: society?.society_name || null,
                registrationNumber: society?.registration_number || null,
              },
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ============================================
      // STEP 5: No user found
      // ============================================
      console.log(`❌ No user or vendor found for phone: ${searchPhone}`);
      return buildErrorResponse(
        "NOT_FOUND",
        "User not found. Please check your credentials.",
        404,
      );
    } catch (error: unknown) {
      const err = error as Error;
      console.error("❌ Verify OTP error:", err);
      return buildErrorResponse(
        "SERVER_ERROR",
        err.message || "Unable to verify OTP at this time.",
        500,
      );
    }
  }),
);