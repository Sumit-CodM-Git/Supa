// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "POST, OPTIONS"
// };
// serve(async (req)=>{
//   if (req.method === "OPTIONS") {
//     return new Response("ok", {
//       headers: corsHeaders
//     });
//   }
//   try {
//     const body = await req.json();
//     const userId = body.userId;
//     const role = body.role;
//     const fcmToken = body.fcmToken;
//     //----------------------------------------------------------
//     // Validation
//     //----------------------------------------------------------
//     if (!userId) {
//       throw new Error("userId is required.");
//     }
//     if (!role) {
//       throw new Error("role is required.");
//     }
//     if (!fcmToken) {
//       throw new Error("fcmToken is required.");
//     }
//     if (fcmToken.length < 100) {
//       throw new Error("Invalid FCM token.");
//     }
//     //----------------------------------------------------------
//     // Supabase
//     //----------------------------------------------------------
//     const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
//     //----------------------------------------------------------
//     // Determine Table
//     //----------------------------------------------------------
//     let table = "";
//     switch(role.toUpperCase()){
//       case "RESIDENT":
//       case "ADMIN":
//       case "SECURITY":
//       case "SERVICEAGENT":
//       case "SERVICE_AGENT":
//         table = "SSP_Society_User";
//         break;
//       case "VENDOR":
//         table = "SSP_Non_Society_User";
//         break;
//       default:
//         throw new Error(`Unsupported role: ${role}`);
//     }
//     //----------------------------------------------------------
//     // Verify User Exists
//     //----------------------------------------------------------
//     const idColumn = table === "SSP_Society_User" ? "user_id" : "user_id"; // change if your vendor PK is different
//     const { data: existingUser, error: fetchError } = await supabase.from(table).select(idColumn).eq(idColumn, userId).maybeSingle();
//     if (fetchError) {
//       throw fetchError;
//     }
//     if (!existingUser) {
//       throw new Error(`User not found in ${table}.`);
//     }
//     //----------------------------------------------------------
//     // Update Token
//     //----------------------------------------------------------
//     const { error: updateError } = await supabase.from(table).update({
//       fcm_token: fcmToken
//     }).eq(idColumn, userId);
//     if (updateError) {
//       throw updateError;
//     }
//     console.log(`FCM token updated successfully for ${userId}`);
//     return new Response(JSON.stringify({
//       success: true,
//       message: "FCM token saved successfully."
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         "Content-Type": "application/json"
//       }
//     });
//   } catch (e) {
//     console.error(e);
//     return new Response(JSON.stringify({
//       success: false,
//       error: e.message
//     }), {
//       status: 500,
//       headers: {
//         ...corsHeaders,
//         "Content-Type": "application/json"
//       }
//     });
//   }
// });

// deno-lint-ignore-file no-import-prefix
// ============================================
// save-fcm-token — Register / Remove FCM Device Tokens (JWT auth)
// ============================================
// Auth: requireAuth middleware verifies the caller's JWT.
//       ctx.user.id = SSP_Society_User.user_id (or staff_id, vendor_id)
//
// Body: { action, role?, userType?, fcmToken?, deviceType?, deviceInfo? }
//       userId is NOT in the body — comes from JWT.
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

type Action = "REGISTER" | "REMOVE" | "REMOVE_ALL";
type DeviceType = "ios" | "android" | "web";
type UserType = "society_user" | "staff" | "vendor";

interface Req {
  role?: string;
  fcmToken?: string;
  action?: Action;
  deviceType?: DeviceType;
  userType?: UserType;
  deviceInfo?: { model?: string; osVersion?: string; appVersion?: string };
}

const VALID_ACTIONS = ["REGISTER", "REMOVE", "REMOVE_ALL"] as const;
const VALID_DEVICE_TYPES = ["ios", "android", "web"] as const;
const VALID_USER_TYPES = ["society_user", "staff", "vendor"] as const;
const MIN_TOKEN = 80;
const MAX_TOKEN = 4096;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function normRole(v: string) {
  return String(v).trim().toUpperCase().replace(/[\s-]/g, "_");
}
function validToken(t: string) {
  const s = String(t).trim();
  return s.length >= MIN_TOKEN && s.length <= MAX_TOKEN;
}
function isValidDeviceType(v: unknown): v is DeviceType {
  return typeof v === "string" &&
    (VALID_DEVICE_TYPES as readonly string[]).includes(v.toLowerCase());
}
function isValidUserType(v: unknown): v is UserType {
  return typeof v === "string" &&
    (VALID_USER_TYPES as readonly string[]).includes(v);
}

async function verifyUserExists(userId: string, userType: UserType) {
  if (userType === "staff") {
    const { data } = await supabase.from("SSP_Society_Staff")
      .select("staff_id").eq("staff_id", userId).maybeSingle();
    return !!data;
  }
  if (userType === "vendor") {
    const { data } = await supabase.from("SSP_Non_Society_User")
      .select("user_id").eq("user_id", userId).maybeSingle();
    return !!data;
  }
  const { data } = await supabase.from("SSP_Society_User")
    .select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

async function handleRegister(
  userId: string,
  body: Req,
  userType: UserType,
): Promise<Response> {
  const role = normRole(body.role ?? "");
  const fcmToken = String(body.fcmToken).trim();
  const deviceType = body.deviceType && isValidDeviceType(body.deviceType)
    ? (String(body.deviceType).toLowerCase() as DeviceType)
    : null;
  const now = new Date().toISOString();

  const { data: prev } = await supabase
    .from("SSP_User_Device")
    .select("user_id, user_type")
    .eq("fcm_token", fcmToken)
    .maybeSingle();

  const wasReassigned = !!prev && (
    (prev as { user_id: string }).user_id !== userId ||
    (prev as { user_type: string }).user_type !== userType
  );

  const payload: Record<string, unknown> = {
    user_id: userId,
    user_type: userType,
    fcm_token: fcmToken,
    device_type: deviceType,
    is_active: true,
    updated_at: now,
  };
  if (body.deviceInfo?.model) payload.device_model = body.deviceInfo.model;
  if (body.deviceInfo?.osVersion) {
    payload.os_version = body.deviceInfo.osVersion;
  }
  if (body.deviceInfo?.appVersion) {
    payload.app_version = body.deviceInfo.appVersion;
  }

  const { data, error } = await supabase
    .from("SSP_User_Device")
    .upsert(payload, { onConflict: "fcm_token" })
    .select("id")
    .single();

  if (error) {
    return errorResponse(error.message, 500, { errorCode: "DATABASE_ERROR" });
  }

  return successResponse({
    action: "REGISTER",
    userId,
    userType,
    role,
    deviceId: (data as { id: string }).id,
    isActive: true,
    wasReassigned,
    message: wasReassigned
      ? "FCM token reassigned."
      : "FCM token saved successfully.",
  }, wasReassigned ? 200 : 201);
}

async function handleRemove(userId: string, body: Req): Promise<Response> {
  const fcmToken = String(body.fcmToken).trim();

  const { error, count } = await supabase
    .from("SSP_User_Device")
    .update({ is_active: false, updated_at: new Date().toISOString() }, {
      count: "exact",
    })
    .eq("fcm_token", fcmToken)
    .eq("user_id", userId);

  if (error) {
    return errorResponse(error.message, 500, { errorCode: "DATABASE_ERROR" });
  }

  return successResponse({
    action: "REMOVE",
    userId,
    isActive: false,
    wasAlreadyInactive: count === 0,
    message: count === 0
      ? "Token not found or not owned by user."
      : "FCM token removed successfully.",
  });
}

async function handleRemoveAll(
  userId: string,
  userType: UserType,
): Promise<Response> {
  const now = new Date().toISOString();

  const { count: activeCount, error: countErr } = await supabase
    .from("SSP_User_Device")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("user_type", userType)
    .eq("is_active", true);

  if (countErr) {
    return errorResponse(countErr.message, 500, {
      errorCode: "DATABASE_ERROR",
    });
  }

  if (!activeCount || activeCount === 0) {
    return successResponse({
      action: "REMOVE_ALL",
      userId,
      userType,
      deactivatedCount: 0,
      message: "No active devices found.",
    });
  }

  const { error: updErr } = await supabase
    .from("SSP_User_Device")
    .update({ is_active: false, updated_at: now })
    .eq("user_id", userId)
    .eq("user_type", userType)
    .eq("is_active", true);

  if (updErr) {
    return errorResponse(updErr.message, 500, { errorCode: "DATABASE_ERROR" });
  }

  return successResponse({
    action: "REMOVE_ALL",
    userId,
    userType,
    deactivatedCount: activeCount,
    message: `Deactivated ${activeCount} device(s).`,
  });
}

Deno.serve(
  requireAuth(async (req: Request, authCtx) => {
    if (req.method !== "POST") {
      return errorResponse("Only POST allowed.", 405, {
        errorCode: "METHOD_NOT_ALLOWED",
      });
    }

    const userId = authCtx.user.id; // ← from JWT

    try {
      const body = (await req.json().catch(() => null)) as Req | null;
      if (!body) {
        return errorResponse("Request body required.", 400, {
          errorCode: "BAD_REQUEST",
        });
      }

      const role = body.role ? String(body.role).trim() : "";

      const userType: UserType = body.userType === undefined
        ? "society_user"
        : (isValidUserType(body.userType) ? body.userType : "society_user");

      if (body.userType !== undefined && !isValidUserType(body.userType)) {
        return errorResponse(
          `userType must be one of: ${VALID_USER_TYPES.join(", ")}`,
          400,
          { errorCode: "INVALID_PARAMETERS" },
        );
      }

      if (userType === "society_user" && !role) {
        return errorResponse("role is required for society_user.", 400, {
          errorCode: "MISSING_PARAMETERS",
        });
      }

      const actionUpper = (body.action ? String(body.action) : "REGISTER")
        .toUpperCase() as Action;
      if (!(VALID_ACTIONS as readonly string[]).includes(actionUpper)) {
        return errorResponse(
          `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
          400,
          { errorCode: "INVALID_ACTION" },
        );
      }

      if (actionUpper !== "REMOVE_ALL") {
        if (!body.fcmToken || String(body.fcmToken).trim() === "") {
          return errorResponse("fcmToken is required.", 400, {
            errorCode: "MISSING_PARAMETERS",
          });
        }
        if (!validToken(String(body.fcmToken))) {
          return errorResponse(
            `fcmToken must be ${MIN_TOKEN}-${MAX_TOKEN} chars.`,
            400,
            { errorCode: "INVALID_PARAMETERS" },
          );
        }
      }

      if (
        body.deviceType !== undefined && body.deviceType !== null &&
        String(body.deviceType).trim() !== "" &&
        !isValidDeviceType(body.deviceType)
      ) {
        return errorResponse(
          `deviceType must be one of: ${VALID_DEVICE_TYPES.join(", ")}`,
          400,
          { errorCode: "INVALID_PARAMETERS" },
        );
      }

      // Verify the user exists in the expected table
      const exists = await verifyUserExists(userId, userType);
      if (!exists) {
        return errorResponse(
          `User not found: ${userId} (userType=${userType}).`,
          404,
          { errorCode: "NOT_FOUND" },
        );
      }

      let response: Response;
      switch (actionUpper) {
        case "REGISTER":
          response = await handleRegister(userId, body, userType);
          break;
        case "REMOVE":
          response = await handleRemove(userId, body);
          break;
        case "REMOVE_ALL":
          response = await handleRemoveAll(userId, userType);
          break;
        default:
          return errorResponse("Unhandled action.", 400, {
            errorCode: "INVALID_ACTION",
          });
      }

      console.log(
        `save-fcm-token: action=${actionUpper} userType=${userType} user=${userId}`,
      );
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("save-fcm-token error:", msg);
      return errorResponse(msg, 500, { errorCode: "SERVER_ERROR" });
    }
  }),
);
