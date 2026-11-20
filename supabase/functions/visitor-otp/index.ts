import { visitorDateOtp } from "../_shared/visitor-otp-date.ts";
import { hasVisitorName, readVisitorName, findVisitorDraft, canVerifyVisitorOtp, findPendingVisitorForOtp, VisitorDraftError } from "../_shared/visitor-drafts.ts";
// // ============================================
// // visitor-otp - Simple Visitor OTP Flow
// // One reusable OTP draft per visit; completed visits remain separate records.
// // ============================================

// import { requireAuth } from "../_shared/auth.ts";
// import {
//   corsHeaders,
//   errorResponse,
//   successResponse,
// } from "../_shared/response.ts";
// import {
//   generateId,
//   getCurrentTimestamp,
//   logger,
//   sanitizeString,
// } from "../_shared/utils.ts";
// import { Validator } from "../_shared/validation.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================

// interface VisitorOtpRequest {
//   phoneNumber: string;
//   otp?: string;
// }

// interface VisitorOtpResponse {
//   visitorId: string;
//   phoneNumber: string;
//   message: string;
//   otpVerified: boolean;
//   isNewVisitor: boolean;
//   nextStep: "VERIFY_OTP" | "COMPLETED";
// }

// interface VisitorData {
//   non_society_user_id: string;
//   phone_number: string;
//   one_time_password: string | null;
//   visitor_status: string | null;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const supabaseAdmin = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// // ============================================
// // HELPER FUNCTIONS
// // ============================================

// /**
//  * Generate OTP based on today's date (DDMMYY format)
//  * Format: 100926 (10 Sep 2026)
//  */
// function generateDateOtp(): string {
//   const now = new Date();

//   // Get IST time (UTC+5:30)
//   const istDate = new Date(
//     now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
//   );

//   const day = String(istDate.getDate()).padStart(2, "0");
//   const month = String(istDate.getMonth() + 1).padStart(2, "0");
//   const year = String(istDate.getFullYear()).slice(-2);

//   return `${day}${month}${year}`;
// }

// /**
//  * Validate OTP format (6-digit numeric)
//  */
// function validateOtp(otp: string): boolean {
//   return /^[0-9]{6}$/.test(otp);
// }

// /**
//  * Validate phone number
//  */
// function validatePhoneNumber(phone: string): boolean {
//   return /^[0-9]{10}$/.test(phone) || /^[0-9]{10,15}$/.test(phone);
// }

// /**
//  * Create new visitor record for each visit
//  */
// async function createNewVisitor(
//   phoneNumber: string,
// ): Promise<{ visitor: VisitorData | null; error?: string }> {
//   try {
//     const visitorId = generateId();

//     const newVisitorData = {
//       non_society_user_id: visitorId,
//       phone_number: phoneNumber,
//       name: "Unknown Visitor",
//       role: "visitor",
//       visitor_status: "pending",
//       visitor_approval_status: "pending",
//       pre_approved: false,
//       hosted_by: null,
//       society: null,
//       created_at: getCurrentTimestamp(),
//     };

//     const { data: createdVisitor, error: insertError } = await supabaseAdmin
//       .from("SSP_Non_Society_User")
//       .insert(newVisitorData)
//       .select()
//       .single();

//     if (insertError) {
//       return { visitor: null, error: insertError.message };
//     }

//     logger.info({
//       level: "info",
//       action: "create-visitor-otp",
//       message: `New visitor record created for visit`,
//       visitorId: visitorId,
//       phoneNumber: phoneNumber,
//       timestamp: new Date().toISOString(),
//     });

//     return { visitor: createdVisitor as VisitorData };
//   } catch (error: unknown) {
//     const errorMessage = error instanceof Error
//       ? error.message
//       : "Unknown error";
//     return { visitor: null, error: errorMessage };
//   }
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// Deno.serve(
//   requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
//     if (req.method === "OPTIONS") {
//       return new Response("ok", { headers: corsHeaders });
//     }

//     const startTime = Date.now();

//     try {
//       logger.info({
//         level: "info",
//         action: "visitor-otp",
//         userId: authCtx.user.id,
//         message: "Visitor OTP request received",
//         timestamp: new Date().toISOString(),
//       });

//       if (req.method !== "POST") {
//         return errorResponse("Only POST method is allowed.");
//       }

//       const body = await req.json().catch(() => null);
//       if (!body) {
//         return errorResponse("Request body is required.");
//       }

//       const { phoneNumber, otp } = body as VisitorOtpRequest;

//       // Validate required fields
//       const validator = new Validator()
//         .validateRequired(phoneNumber, "phoneNumber");

//       if (!validator.isValid()) {
//         const errors = validator.getErrors();
//         logger.warn({
//           level: "warn",
//           action: "visitor-otp",
//           userId: authCtx.user.id,
//           message: "Validation failed",
//           errors: JSON.stringify(errors),
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Validation failed");
//       }

//       const cleanPhone = sanitizeString(phoneNumber);

//       // Validate phone number
//       if (!validatePhoneNumber(cleanPhone)) {
//         return errorResponse(
//           "Invalid phone number format. Please enter a valid 10-15 digit number.",
//         );
//       }

//       // ============================================
//       // STEP 1: ALWAYS Create New Visitor Record
//       // ============================================
//       const createResult = await createNewVisitor(cleanPhone);

//       if (createResult.error) {
//         logger.error({
//           level: "error",
//           action: "visitor-otp",
//           message: `Visitor creation failed: ${createResult.error}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse(`Failed to create visitor: ${createResult.error}`);
//       }

//       const visitorData = createResult.visitor;

//       if (!visitorData) {
//         return errorResponse("Failed to create visitor record.");
//       }

//       // ============================================
//       // STEP 2: Generate Today's OTP
//       // ============================================
//       const generatedOtp = generateDateOtp();

//       // Store OTP in database
//       const { error: updateError } = await supabaseAdmin
//         .from("SSP_Non_Society_User")
//         .update({
//           one_time_password: generatedOtp,
//         })
//         .eq("non_society_user_id", visitorData.non_society_user_id);

//       if (updateError) {
//         logger.error({
//           level: "error",
//           action: "visitor-otp",
//           message: `Failed to store OTP: ${updateError.message}`,
//           timestamp: new Date().toISOString(),
//         });
//       }

//       // ============================================
//       // STEP 3: Check if OTP is provided for verification
//       // ============================================
//       const cleanOtp = otp ? sanitizeString(otp) : null;

//       // If OTP is NOT provided → Step 1: Generate OTP only
//       if (!cleanOtp) {
//         logger.info({
//           level: "info",
//           action: "visitor-otp",
//           message: "OTP generated for new visitor",
//           phoneNumber: cleanPhone,
//           visitorId: visitorData.non_society_user_id,
//           timestamp: new Date().toISOString(),
//         });

//         return successResponse({
//           visitorId: visitorData.non_society_user_id,
//           phoneNumber: visitorData.phone_number,
//           message: `OTP has been sent. Please verify OTP.`,
//           otpVerified: false,
//           isNewVisitor: true,
//           nextStep: "VERIFY_OTP",
//         });
//       }

//       // ============================================
//       // STEP 4: OTP Provided → Verify OTP
//       // ============================================

//       // Validate OTP format
//       if (!validateOtp(cleanOtp)) {
//         return errorResponse("Invalid OTP format. OTP must be 6 digits.");
//       }

//       // Verify OTP
//       const isOtpValid =
//         String(generatedOtp).trim() === String(cleanOtp).trim();

//       if (!isOtpValid) {
//         logger.warn({
//           level: "warn",
//           action: "visitor-otp",
//           message: "Invalid OTP provided",
//           phoneNumber: cleanPhone,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Invalid OTP provided. Please try again.");
//       }

//       // ============================================
//       // STEP 5: Clear OTP After Verification
//       // ============================================
//       const { data: consumed, error: clearError } = await supabaseAdmin
//         .from("SSP_Non_Society_User")
//         .update({
//           one_time_password: null,
//         })
//         .eq("non_society_user_id", visitorData.non_society_user_id);

//       if (clearError) {
//         logger.error({
//           level: "error",
//           action: "visitor-otp",
//           message: `Failed to clear OTP: ${clearError.message}`,
//           timestamp: new Date().toISOString(),
//         });
//       }

//       // ============================================
//       // STEP 6: Prepare Response
//       // ============================================
//       const response: VisitorOtpResponse = {
//         visitorId: visitorData.non_society_user_id,
//         phoneNumber: visitorData.phone_number,
//         message: "OTP verified successfully.",
//         otpVerified: true,
//         isNewVisitor: true,
//         nextStep: "COMPLETED",
//       };

//       // ============================================
//       // STEP 7: Log Success
//       // ============================================
//       logger.info({
//         level: "info",
//         action: "visitor-otp",
//         userId: authCtx.user.id,
//         visitorId: visitorData.non_society_user_id,
//         phoneNumber: cleanPhone,
//         otpVerified: true,
//         duration: Date.now() - startTime,
//         message: "Visitor OTP verified successfully",
//         timestamp: new Date().toISOString(),
//       });

//       return successResponse(response);
//     } catch (error: unknown) {
//       const errorMessage = error instanceof Error
//         ? error.message
//         : "Unknown error";
//       const errorStack = error instanceof Error ? error.stack : undefined;

//       logger.error({
//         level: "error",
//         action: "visitor-otp",
//         userId: authCtx?.user?.id || "unknown",
//         message: errorMessage,
//         stack: errorStack,
//         timestamp: new Date().toISOString(),
//       });

//       return errorResponse(errorMessage || "Failed to process OTP request.");
//     }
//   }),
// );

// ============================================
// visitor-otp - Simple Visitor OTP Flow
// (Always creates new visitor for each visit)
// ============================================
// Auth: gatekeeper (security/admin) JWT
// The gatekeeper selects a resident via /search-resident first.
// We verify the TARGET RESIDENT's plan includes VISITOR_OTP —
// the gatekeeper's own plan is irrelevant.
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import {
  generateId,
  getCurrentTimestamp,
  logger,
  sanitizeString,
} from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface VisitorOtpRequest {
  phoneNumber: string;
  visitorName?: string;
  name?: string;
  otp?: string;
  visitorId?: string;
  /** The resident (SSP_Society_User.user_id) the visitor is visiting. */
  societyUserId: string;
}

interface VisitorOtpResponse {
  visitorId: string;
  name: string | null;
  visitorName: string | null;
  phoneNumber: string;
  message: string;
  otpVerified: boolean;
  isNewVisitor: boolean;
  nextStep: "VERIFY_OTP" | "COMPLETED";
  requiresVisitorDetails?: boolean;
}

interface VisitorData {
  non_society_user_id: string;
  name: string;
  phone_number: string;
  one_time_password: string | null;
  visitor_status: string | null;
}

interface TargetResident {
  userId: string;
  society: string;
  tower: string | null;
  block: string | null;
  flatNumber: string;
}

// ============================================
// CONSTANTS
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate OTP based on today's date (DDMMYY format)
 * Format: 100926 (10 Sep 2026)
 */
function generateDateOtp(): string {
  return visitorDateOtp();
}

/**
 * Validate OTP format (6-digit numeric)
 */
function validateOtp(otp: string): boolean {
  return /^[0-9]{6}$/.test(otp);
}

/**
 * Validate phone number
 */
function validatePhoneNumber(phone: string): boolean {
  return /^[0-9]{10}$/.test(phone) || /^[0-9]{10,15}$/.test(phone);
}

/**
 * Look up the target resident and confirm their flat has VISITOR_OTP.
 * Returns the resident's flat context on success.
 * Returns a 402 Response when the resident's plan lacks the feature.
 * Returns a 404 Response when the resident is not found.
 */
async function resolveTargetResident(
  societyUserId: string,
): Promise<
  | { ok: true; resident: TargetResident }
  | { ok: false; response: Response }
> {
  // ─────────────────────────────────────────────
  // 1. Load the resident's flat context
  // ─────────────────────────────────────────────
  const { data: resident, error: resErr } = await supabaseAdmin
    .from("SSP_Society_User")
    .select("user_id, society, tower, block, unit_flat_number, deleted_at")
    .eq("user_id", societyUserId)
    .maybeSingle();

  if (resErr) {
    logger.error({
      level: "error",
      action: "visitor-otp",
      message: `Resident lookup failed: ${resErr.message}`,
      societyUserId,
      timestamp: new Date().toISOString(),
    });
    return {
      ok: false,
      response: errorResponse("Failed to load target resident.", 500),
    };
  }

  if (!resident || resident.deleted_at) {
    return {
      ok: false,
      response: errorResponse("Target resident not found.", 404),
    };
  }

  if (!resident.society || !resident.unit_flat_number) {
    return {
      ok: false,
      response: errorResponse(
        "Target resident's flat is not configured.",
        400,
      ),
    };
  }

  // ─────────────────────────────────────────────
  // 2. Load entitlements for that flat
  // ─────────────────────────────────────────────
  const { data: entitlements, error: entErr } = await supabaseAdmin.rpc(
    "get_entitlements",
    {
      p_society: resident.society,
      p_tower: resident.tower,
      p_block: resident.block,
      p_flat: resident.unit_flat_number,
    },
  );

  if (entErr) {
    logger.error({
      level: "error",
      action: "visitor-otp",
      message: `Entitlement lookup failed: ${entErr.message}`,
      societyUserId,
      timestamp: new Date().toISOString(),
    });
    return {
      ok: false,
      response: errorResponse("Failed to check resident's plan.", 500),
    };
  }

  const hasOtp = entitlements?.VISITOR_OTP === true;

  if (!hasOtp) {
    // ─────────────────────────────────────────────
    // Resolve plan code for a helpful error message
    // ─────────────────────────────────────────────
    const { data: planCode } = await supabaseAdmin.rpc(
      "get_current_plan_code",
      {
        p_society: resident.society,
        p_tower: resident.tower,
        p_block: resident.block,
        p_flat: resident.unit_flat_number,
      },
    );

    const residentPlan = (planCode as string) ?? "FREE";

    logger.warn({
      level: "warn",
      action: "visitor-otp",
      message: `Resident's plan lacks VISITOR_OTP`,
      societyUserId,
      residentPlan,
      timestamp: new Date().toISOString(),
    });

    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          success: false,
          error: "FEATURE_NOT_AVAILABLE_FOR_RESIDENT",
          message:
            `The selected resident's plan does not include Visitor OTP. Their plan: ${residentPlan}.`,
          requiredFeature: "VISITOR_OTP",
          residentPlan,
        }),
        {
          status: 402,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      ),
    };
  }

  return {
    ok: true,
    resident: {
      userId: resident.user_id,
      society: resident.society,
      tower: resident.tower,
      block: resident.block,
      flatNumber: resident.unit_flat_number,
    },
  };
}

/**
 * Create new visitor record for each visit.
 * The visitor is attached to the target resident's flat.
 */
async function createNewVisitor(
  phoneNumber: string,
  target: TargetResident,
  visitorName: string | null,
): Promise<{ visitor: VisitorData | null; error?: string }> {
  try {
    const visitorId = generateId();

    const newVisitorData = {
      non_society_user_id: visitorId,
      phone_number: phoneNumber,
      name: visitorName ?? "Unknown Visitor",
      role: "visitor",
      visitor_status: "otp_pending",
      check_in: null,
      check_out: null,
      visitor_approval_status: null,
      is_otp_verified: false,
      pre_approved: false,
      hosted_by: target.userId,
      society: target.society,
      created_at: getCurrentTimestamp(),
    };

    const { data: createdVisitor, error: insertError } = await supabaseAdmin
      .from("SSP_Non_Society_User")
      .insert(newVisitorData)
      .select()
      .single();

    if (insertError) {
      return { visitor: null, error: insertError.message };
    }

    logger.info({
      level: "info",
      action: "create-visitor-otp",
      message: `New visitor record created for visit`,
      visitorId: visitorId,
      phoneNumber: phoneNumber,
      targetResidentId: target.userId,
      timestamp: new Date().toISOString(),
    });

    return { visitor: createdVisitor as VisitorData };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return { visitor: null, error: errorMessage };
  }
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
  requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      logger.info({
        level: "info",
        action: "visitor-otp",
        userId: authCtx.user.id,
        message: "Visitor OTP request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.");
      }

      const { phoneNumber, otp, societyUserId } = body as VisitorOtpRequest;

      // ─────────────────────────────────────────────
      // Validate required fields
      // ─────────────────────────────────────────────
      const validator = new Validator()
        .validateRequired(phoneNumber, "phoneNumber")
        .validateRequired(societyUserId, "societyUserId");

      if (!validator.isValid()) {
        const errors = validator.getErrors();
        logger.warn({
          level: "warn",
          action: "visitor-otp",
          userId: authCtx.user.id,
          message: "Validation failed",
          errors: JSON.stringify(errors),
          timestamp: new Date().toISOString(),
        });
        return errorResponse(
          "Validation failed: phoneNumber and societyUserId are required.",
        );
      }

      const visitorName = readVisitorName(body);
      const cleanPhone = sanitizeString(phoneNumber);
      const cleanSocietyUserId = sanitizeString(societyUserId);

      // Validate phone number
      if (!validatePhoneNumber(cleanPhone)) {
        return errorResponse(
          "Invalid phone number format. Please enter a valid 10-15 digit number.",
        );
      }

      // ═════════════════════════════════════════════
      // FEATURE GATE — check the TARGET RESIDENT's plan
      // ═════════════════════════════════════════════
      const targetResult = await resolveTargetResident(cleanSocietyUserId);

      if (!targetResult.ok) {
        return targetResult.response;
      }

      const target = targetResult.resident;

      const cleanOtp = otp ? sanitizeString(otp) : null;
      if (cleanOtp && !validateOtp(cleanOtp)) return errorResponse("Invalid OTP format. OTP must be 6 digits.");
      const suppliedVisitorId = (body as VisitorOtpRequest).visitorId?.trim();
      let draft;
      try {
        draft = await findVisitorDraft(supabaseAdmin, target.userId, target.society, cleanPhone, suppliedVisitorId);
      } catch (error) {
        // Start a fresh, uniquely indexed draft rather than guessing which historical
        // duplicate a new OTP request belongs to. Verification still requires certainty.
        if (!(error instanceof VisitorDraftError) || error.status !== 409 || suppliedVisitorId) throw error;
        draft = null;
      }
      if (!draft && !suppliedVisitorId) draft = await findPendingVisitorForOtp(supabaseAdmin, target.userId, target.society, cleanPhone);
      if (draft && !canVerifyVisitorOtp(draft)) return errorResponse("This visitor has already been submitted. Start a new visit without visitorId.", 409);
      if (!draft && cleanOtp) return errorResponse("No active OTP request found. Request an OTP first.", 404);
      if (!draft) {
        const created = await createNewVisitor(cleanPhone, target, visitorName);
        if (created.error) {
          // Another request may have reserved the same draft concurrently.
          draft = await findVisitorDraft(supabaseAdmin, target.userId, target.society, cleanPhone);
          if (!draft) return errorResponse(`Failed to create visitor: ${created.error}`);
        } else draft = created.visitor;
      }
      if (!draft) return errorResponse("Failed to create visitor record.");
      if (visitorName && draft.name !== visitorName) {
        if (hasVisitorName(draft.name)) {
          return errorResponse("Visitor name does not match this visit.", 409);
        }
        let nameUpdate = supabaseAdmin.from("SSP_Non_Society_User")
          .update({ name: visitorName }).eq("non_society_user_id", draft.non_society_user_id)
          .eq("hosted_by", target.userId).eq("society", target.society);
        nameUpdate = draft.name == null ? nameUpdate.is("name", null) : nameUpdate.eq("name", draft.name);
        const { data: savedVisitor, error: nameError } = await nameUpdate.select("*").maybeSingle();
        if (nameError) return errorResponse(`Failed to save visitor name: ${nameError.message}`, 500);
        if (!savedVisitor) return errorResponse("Visitor changed. Refresh and retry.", 409);
        draft = savedVisitor;
      }
      const visitorData = draft as VisitorData;
      if (!cleanOtp) {
        const { error: updateError } = await supabaseAdmin.from("SSP_Non_Society_User")
          .update({ one_time_password: generateDateOtp() })
          .eq("non_society_user_id", visitorData.non_society_user_id)
          .eq("hosted_by", target.userId);
        if (updateError) return errorResponse(`Failed to store OTP: ${updateError.message}`);
      }

      // If OTP is NOT provided → Step 1: Generate OTP only
      if (!cleanOtp) {
        logger.info({
          level: "info",
          action: "visitor-otp",
          message: "OTP generated for new visitor",
          phoneNumber: cleanPhone,
          visitorId: visitorData.non_society_user_id,
          timestamp: new Date().toISOString(),
        });

        return successResponse({
          visitorId: visitorData.non_society_user_id,
          phoneNumber: visitorData.phone_number,
          name: hasVisitorName(visitorData.name) ? visitorData.name : null,
          visitorName: hasVisitorName(visitorData.name) ? visitorData.name : null,
          message: `OTP has been sent. Please verify OTP.`,
          otpVerified: false,
          isNewVisitor: true,
          nextStep: "VERIFY_OTP",
          requiresVisitorDetails: !hasVisitorName(visitorData.name),
        });
      }

      // ============================================
      // STEP 4: OTP Provided → Verify OTP
      // ============================================

      // Validate OTP format
      if (!validateOtp(cleanOtp)) {
        return errorResponse("Invalid OTP format. OTP must be 6 digits.");
      }

      // Verify OTP
      const isOtpValid =
        !!visitorData.one_time_password && String(visitorData.one_time_password).trim() === String(cleanOtp).trim() && cleanOtp === generateDateOtp();

      if (!isOtpValid) {
        logger.warn({
          level: "warn",
          action: "visitor-otp",
          message: "Invalid OTP provided",
          phoneNumber: cleanPhone,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Invalid OTP provided. Please try again.");
      }

      // ============================================
      // STEP 5: Clear OTP After Verification
      // ============================================
      const { data: consumed, error: clearError } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .update({
          one_time_password: null,
          is_otp_verified: true,
          // Unnamed OTP drafts wait for the details form before requesting resident approval.
          ...(visitorData.visitor_status === "otp_pending" && hasVisitorName(visitorData.name) ? {
            visitor_status: "Pending", visitor_approval_status: "pending",
          } : {}),
        })
        .eq("non_society_user_id", visitorData.non_society_user_id)
        .eq("hosted_by", target.userId)
        .eq("one_time_password", cleanOtp)
        .select("non_society_user_id");

      if (clearError) {
        return errorResponse(`Failed to verify OTP: ${clearError.message}`, 500);
      }
      if (!consumed?.length) return errorResponse("OTP has already been used or the request changed. Request a new OTP.", 409);

      // ============================================
      // STEP 6: Prepare Response
      // ============================================
      const response: VisitorOtpResponse = {
        visitorId: visitorData.non_society_user_id,
        phoneNumber: visitorData.phone_number,
        name: hasVisitorName(visitorData.name) ? visitorData.name : null,
        visitorName: hasVisitorName(visitorData.name) ? visitorData.name : null,
        message: "OTP verified successfully.",
        otpVerified: true,
        isNewVisitor: true,
        nextStep: "COMPLETED",
        requiresVisitorDetails: !hasVisitorName(visitorData.name),
      };

      // ============================================
      // STEP 7: Log Success
      // ============================================
      logger.info({
        level: "info",
        action: "visitor-otp",
        userId: authCtx.user.id,
        visitorId: visitorData.non_society_user_id,
        phoneNumber: cleanPhone,
        targetResidentId: target.userId,
        otpVerified: true,
        duration: Date.now() - startTime,
        message: "Visitor OTP verified successfully",
        timestamp: new Date().toISOString(),
      });

      return successResponse(response);
    } catch (error: unknown) {
      if (error instanceof VisitorDraftError) return errorResponse(error.message, error.status);
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error({
        level: "error",
        action: "visitor-otp",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString(),
      });

      return errorResponse(errorMessage || "Failed to process OTP request.");
    }
  }),
);
