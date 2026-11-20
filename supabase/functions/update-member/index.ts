/* import { requireAuth } from "../_shared/auth.ts";
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
interface UpdateMemberRequest {
  memberId: string;
  updatedData: {
    fullName?: string;
    phone?: string;
    email?: string;
    gender?: string;
    occupation?: string;
    idProofType?: string;
    idProofNumber?: string;
    whatsappPhone?: string;
    emergencyPhone?: string;
    vehicleType?: string;
    vehicleRegistrationNumber?: string;
    blockName?: string;
    towerName?: string;
    unitFlatNumber?: string;
    userType?: string;
    userOwnershipType?: string;
    status?: string | boolean;
    moveInDate?: string;
    moveOutDate?: string;
    shift?: string;
    securityZone?: string;
    securityGuardStatus?: string;
    gateNumber?: string;
    securityGuardId?: string;
    serviceAgentRating?: number;
    agentAvailabilityStatus?: string;
    serviceAgentServices?: string[] | string;
  };
}

// ============================================
// HELPER: Validate UUID format
// ============================================
const isUUID = (str: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(str);
};

// ============================================
// HELPER: Resolve Block ID from Name or UUID
// ============================================
async function resolveBlockId(
  supabaseAdmin: any,
  blockInput: string,
  societyId: string,
): Promise<string | null> {
  if (!blockInput || blockInput.trim() === "") {
    return null;
  }

  const blockVal = blockInput.trim();

  if (isUUID(blockVal)) {
    return blockVal;
  }

  let query = supabaseAdmin
    .from("SSP_Block")
    .select("block_id")
    .ilike("block_name", blockVal);

  if (societyId) {
    query = query.eq("society", societyId);
  }

  const { data: blockMatch, error: blockErr } = await query.maybeSingle();

  if (blockErr) {
    throw new Error(`Failed to resolve block: ${blockErr.message}`);
  }

  if (!blockMatch) {
    throw new Error(`Block '${blockVal}' not found in society.`);
  }

  return blockMatch.block_id;
}

// ============================================
// HELPER: Resolve Tower ID from Name or UUID
// ============================================
async function resolveTowerId(
  supabaseAdmin: any,
  towerInput: string,
  societyId: string,
): Promise<string | null> {
  if (!towerInput || towerInput.trim() === "") {
    return null;
  }

  const towerVal = towerInput.trim();

  if (isUUID(towerVal)) {
    return towerVal;
  }

  let query = supabaseAdmin
    .from("SSP_Tower")
    .select("tower_id")
    .ilike("name", towerVal);

  if (societyId) {
    query = query.eq("society", societyId);
  }

  const { data: towerMatch, error: towerErr } = await query.maybeSingle();

  if (towerErr) {
    throw new Error(`Failed to resolve tower: ${towerErr.message}`);
  }

  if (!towerMatch) {
    throw new Error(`Tower '${towerVal}' not found in society.`);
  }

  return towerMatch.tower_id;
}

// ============================================
// HELPER: Build Error Response
// ============================================
function buildUpdateErrorResponse(
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
      updateMember: null,
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
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      console.log("📝 update-member called");
      console.log(`👤 Authenticated user: ${authCtx.user.id}`);

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await parseRequestBody<UpdateMemberRequest>(req);
      if (!body) {
        return buildUpdateErrorResponse(
          "BAD_REQUEST",
          "Request body is required.",
          400,
          startTime,
        );
      }

      const { memberId, updatedData } = body;

      if (!memberId) {
        return buildUpdateErrorResponse(
          "BAD_REQUEST",
          "memberId is mandatory.",
          400,
          startTime,
        );
      }

      if (!updatedData || Object.keys(updatedData).length === 0) {
        return buildUpdateErrorResponse(
          "BAD_REQUEST",
          "updatedData is mandatory and cannot be empty.",
          400,
          startTime,
        );
      }

      const targetId = String(memberId).trim();

      // ============================================
      // STEP 1: Find Existing Society User Record
      // ============================================
      const { data: memberRecord, error: fetchErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, contact, society")
        .eq("user_id", targetId)
        .maybeSingle();

      if (fetchErr) {
        console.error("❌ Fetch error:", fetchErr);
        throw fetchErr;
      }

      if (!memberRecord) {
        return buildUpdateErrorResponse(
          "NOT_FOUND",
          "Member record not found.",
          404,
          startTime,
        );
      }

      const societyId = memberRecord.society;

      // ============================================
      // STEP 2: Build Society User Update Payload
      // ============================================
      const societyUserUpdatePayload: any = {};

      // --- Block Resolution ---
      if (updatedData.blockName !== undefined) {
        if (!updatedData.blockName || updatedData.blockName.trim() === "") {
          societyUserUpdatePayload.block = null;
        } else {
          try {
            societyUserUpdatePayload.block = await resolveBlockId(
              supabaseAdmin,
              updatedData.blockName,
              societyId,
            );
          } catch (resolveError: any) {
            return buildUpdateErrorResponse(
              "NOT_FOUND",
              resolveError.message,
              404,
              startTime,
            );
          }
        }
      }

      // --- Tower Resolution ---
      if (updatedData.towerName !== undefined) {
        if (!updatedData.towerName || updatedData.towerName.trim() === "") {
          societyUserUpdatePayload.tower = null;
        } else {
          try {
            societyUserUpdatePayload.tower = await resolveTowerId(
              supabaseAdmin,
              updatedData.towerName,
              societyId,
            );
          } catch (resolveError: any) {
            return buildUpdateErrorResponse(
              "NOT_FOUND",
              resolveError.message,
              404,
              startTime,
            );
          }
        }
      }

      // --- Map Basic Fields ---
      const fieldMappings: [string, string][] = [
        ["unitFlatNumber", "unit_flat_number"],
        ["userType", "user_type"],
        ["userOwnershipType", "user_ownership_type"],
        ["moveInDate", "move_in_date"],
        ["moveOutDate", "move_out_date"],
        ["shift", "shift"],
        ["securityZone", "security_zone"],
        ["securityGuardStatus", "security_guard_status"],
        ["gateNumber", "gate_number"],
        ["securityGuardId", "security_guard_id"],
        ["serviceAgentRating", "service_agent_rating"],
        ["agentAvailabilityStatus", "agent_availability_status"],
      ];

      for (const [field, dbField] of fieldMappings) {
        if (updatedData[field] !== undefined) {
          societyUserUpdatePayload[dbField] = updatedData[field] || null;
        }
      }

      // --- Status Mapping - PRESERVE CASE ---
      if (updatedData.status !== undefined) {
        const statusValue = String(updatedData.status).trim();

        // Check if it's a boolean-like value
        if (
          statusValue.toLowerCase() === "true" || updatedData.status === true
        ) {
          societyUserUpdatePayload.status = true;
        } else if (
          statusValue.toLowerCase() === "false" || updatedData.status === false
        ) {
          societyUserUpdatePayload.status = false;
        } else {
          // ✅ PRESERVE THE EXACT CASE for string values
          societyUserUpdatePayload.status = statusValue;
        }
      }

      // --- Service Agent Services ---
      if (updatedData.serviceAgentServices !== undefined) {
        societyUserUpdatePayload.service_agent_services =
          Array.isArray(updatedData.serviceAgentServices)
            ? updatedData.serviceAgentServices.join(", ")
            : updatedData.serviceAgentServices || null;
      }

      // --- Update Society User ---
      if (Object.keys(societyUserUpdatePayload).length > 0) {
        const { error: userUpdateErr } = await supabaseAdmin
          .from("SSP_Society_User")
          .update(societyUserUpdatePayload)
          .eq("user_id", memberRecord.user_id);

        if (userUpdateErr) {
          console.error("❌ User update error:", userUpdateErr);
          throw userUpdateErr;
        }
      }

      // ============================================
      // STEP 3: Update Contact Profile
      // ============================================
      if (memberRecord.contact) {
        const contactUpdatePayload: any = {};

        // ✅ Updated field mappings to match new variable names
        const contactFieldMappings: [string, string][] = [
          ["fullName", "name"], // ✅ Changed from Name to fullName
          ["phone", "phone"],
          ["email", "email"],
          ["gender", "gender"],
          ["occupation", "occupation"],
          ["idProofType", "id_proof_type"],
          ["idProofNumber", "id_proof_number"],
          ["whatsappPhone", "whatsapp_phone"],
          ["emergencyPhone", "emergency_phone"],
          ["vehicleType", "vehicle_type"],
          ["vehicleRegistrationNumber", "vehicle_registration_number"],
        ];

        for (const [field, dbField] of contactFieldMappings) {
          if (updatedData[field] !== undefined) {
            contactUpdatePayload[dbField] = updatedData[field] || null;
          }
        }

        if (Object.keys(contactUpdatePayload).length > 0) {
          const { error: contactUpdateErr } = await supabaseAdmin
            .from("SSP_Contact")
            .update(contactUpdatePayload)
            .eq("contact_id", memberRecord.contact);

          if (contactUpdateErr) {
            console.error("❌ Contact update error:", contactUpdateErr);
            throw contactUpdateErr;
          }
        }
      }

      // ============================================
      // STEP 4: Success Response
      // ============================================
      console.log(
        `✅ Member updated: ${targetId} in ${Date.now() - startTime}ms`,
      );

      return successResponse({
        updatedMember: {
          memberId: targetId,
          updatedData: updatedData,
          status: "Successfully Updated",
        },
      });
    } catch (error: any) {
      console.error("❌ update-member error:", error);
      return buildUpdateErrorResponse(
        "SERVER_ERROR",
        error.message || "Failed to update member",
        500,
        startTime,
      );
    }
  }),
);
 */

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// CONSTANTS — mirror of DB constraints
// ============================================

// chk_user_type: user_type IN ('owner', 'tenant') OR NULL
const ALLOWED_USER_TYPES = ["owner", "tenant"] as const;

// user_ownership_type semantics — verify against DB; uq_one_primary_per_flat
// strongly implies 'primary' / 'secondary'
const ALLOWED_OWNERSHIP_TYPES = ["primary", "secondary"] as const;

// ✅ Added allowed roles to match chk_society_user_role
const ALLOWED_ROLES = ["admin", "resident", "security", "service_agent"] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres error codes
const PG_CHECK_VIOLATION = "23514";
const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION = "23503";
const PG_INVALID_INPUT = "22P02";
const PGRST_MULTIPLE_ROWS = "PGRST116";

// ============================================
// TYPES
// ============================================

interface UpdateMemberRequest {
  memberId: string;
  updatedData: {
    fullName?: string;
    phone?: string;
    email?: string;
    gender?: string;
    occupation?: string;
    idProofType?: string;
    idProofNumber?: string;
    whatsappPhone?: string;
    emergencyPhone?: string;
    vehicleType?: string;
    vehicleRegistrationNumber?: string;
    blockName?: string;
    towerName?: string;
    unitFlatNumber?: string;
    userType?: string;
    userOwnershipType?: string;
    status?: string | boolean;
    moveInDate?: string;
    moveOutDate?: string;
    shift?: string;
    securityZone?: string;
    securityGuardStatus?: string;
    gateNumber?: string;
    securityGuardId?: string;
    serviceAgentRating?: number | string;
    agentAvailabilityStatus?: string;
    serviceAgentServices?: string[] | string;
    // ✅ Added role to allow updating roles safely
    role?: string[] | string;
  };
}

class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ============================================
// HELPERS
// ============================================

const isUUID = (str: string): boolean => UUID_REGEX.test(str);

/**
 * Preserve 0 / false, coerce "" to null, pass through undefined.
 * Fixes `field || null` turning `0` and `false` into `null`.
 */
function coerceOptional(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value as string | number | boolean;
}

/**
 * Case-insensitive match against an allowed set.
 * Returns canonical form, null for empty, undefined for "not provided".
 * Throws ValidationError on mismatch.
 */
function normalizeEnum(
  value: unknown,
  allowed: readonly string[],
  fieldName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  const lower = s.toLowerCase();
  const match = allowed.find((a) => a.toLowerCase() === lower);
  if (!match) {
    throw new ValidationError(
      `Invalid ${fieldName} "${s}". Allowed values: ${allowed.join(", ")}.`,
      fieldName,
    );
  }
  return match;
}

/**
 * Parse status strictly — boolean column requires true/false.
 * Accepts true/false/"true"/"false"/"active"/"inactive".
 * Rejects "deactivated" or anything else that would fail the DB cast.
 */
function parseStatus(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (s === "" || s === "null") return null;
  if (s === "true" || s === "active") return true;
  if (s === "false" || s === "inactive") return false;
  throw new ValidationError(
    `Invalid status "${value}". Use true/false/active/inactive.`,
    "status",
  );
}

/**
 * Detect and repair a swapped userType / userOwnershipType pair.
 * If userType holds an ownership value AND userOwnershipType holds a
 * userType value, they're swapped — log and correct.
 */
function autoFixSwappedTypes(
  userType: unknown,
  ownershipType: unknown,
): { userType: unknown; ownershipType: unknown; swapped: boolean } {
  if (userType === undefined || ownershipType === undefined) {
    return { userType, ownershipType, swapped: false };
  }
  const uType = String(userType ?? "").trim().toLowerCase();
  const uOwn = String(ownershipType ?? "").trim().toLowerCase();
  if (!uType || !uOwn) return { userType, ownershipType, swapped: false };

  const userTypeIsOwnershipValue = ALLOWED_OWNERSHIP_TYPES.map((v) =>
    v.toLowerCase()
  ).includes(uType);
  const ownershipIsUserTypeValue = ALLOWED_USER_TYPES.map((v) =>
    v.toLowerCase()
  ).includes(uOwn);

  if (userTypeIsOwnershipValue && ownershipIsUserTypeValue) {
    console.warn(
      `⚠️ SWAP DETECTED in update-member: userType="${userType}" ` +
        `userOwnershipType="${ownershipType}" — swapping before save. ` +
        `Fix the frontend to send these correctly.`,
    );
    return { userType: ownershipType, ownershipType: userType, swapped: true };
  }
  return { userType, ownershipType, swapped: false };
}

/**
 * Resolve block by UUID or name. Requires societyId — never unscoped.
 */
async function resolveBlockId(
  supabaseAdmin: any,
  blockInput: string,
  societyId: string,
): Promise<string | null> {
  if (!blockInput || blockInput.trim() === "") return null;
  if (!societyId) {
    throw new ValidationError("Society context is required to resolve block.", "blockName");
  }

  const blockVal = blockInput.trim();
  if (isUUID(blockVal)) return blockVal;

  // .limit(1) instead of .maybeSingle() — safe against duplicate names
  const { data: blocks, error: blockErr } = await supabaseAdmin
    .from("SSP_Block")
    .select("block_id")
    .ilike("block_name", blockVal)
    .eq("society", societyId)
    .limit(1);

  if (blockErr) throw new Error(`Failed to resolve block: ${blockErr.message}`);
  const blockMatch = blocks?.[0];
  if (!blockMatch) {
    throw new ValidationError(`Block '${blockVal}' not found in this society.`, "blockName");
  }
  return blockMatch.block_id;
}

async function resolveTowerId(
  supabaseAdmin: any,
  towerInput: string,
  societyId: string,
): Promise<string | null> {
  if (!towerInput || towerInput.trim() === "") return null;
  if (!societyId) {
    throw new ValidationError("Society context is required to resolve tower.", "towerName");
  }

  const towerVal = towerInput.trim();
  if (isUUID(towerVal)) return towerVal;

  const { data: towers, error: towerErr } = await supabaseAdmin
    .from("SSP_Tower")
    .select("tower_id")
    .ilike("name", towerVal)
    .eq("society", societyId)
    .limit(1);

  if (towerErr) throw new Error(`Failed to resolve tower: ${towerErr.message}`);
  const towerMatch = towers?.[0];
  if (!towerMatch) {
    throw new ValidationError(`Tower '${towerVal}' not found in this society.`, "towerName");
  }
  return towerMatch.tower_id;
}

function buildUpdateErrorResponse(
  code: string,
  message: string,
  status: number,
  startTime: number,
  field?: string,
): Response {
  console.error(
    `❌ [${code}] ${message}${field ? ` (field=${field})` : ""} ` +
      `(${Date.now() - startTime}ms)`,
  );
  return new Response(
    JSON.stringify({
      success: false,
      error: code,
      message,
      updateMember: null,
      errorResponse: {
        errorCode: code,
        message,
        field: field ?? null,
        timestamp: new Date().toISOString(),
      },
    }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/**
 * Translate Postgres error codes into user-facing responses.
 * Returns null if the error is not a known/actionable code (re-thrown by caller).
 */
function mapPgError(
  err: any,
): { code: string; status: number; message: string; field?: string } | null {
  if (!err?.code) return null;
  switch (err.code) {
    case PG_CHECK_VIOLATION: {
      const m = /check constraint "([^"]+)"/.exec(String(err.message ?? ""));
      const constraint = m?.[1] ?? "unknown";
      const hints: Record<string, string> = {
        chk_user_type: "userType must be 'owner' or 'tenant'.",
        chk_society_user_role: "role contains an invalid value.",
      };
      return {
        code: "INVALID_PARAMETERS",
        status: 400,
        message: hints[constraint] ??
          `Invalid value for a required field (constraint: ${constraint}).`,
      };
    }
    case PG_UNIQUE_VIOLATION: {
      const m = /constraint "([^"]+)"/.exec(String(err.message ?? ""));
      const constraint = m?.[1] ?? "unique";
      const hints: Record<string, string> = {
        uq_one_primary_per_flat:
          "Another primary owner already exists for this flat.",
        uq_society_user_idempotency: "Duplicate request detected.",
      };
      return {
        code: "CONFLICT",
        status: 409,
        message: hints[constraint] ??
          `Conflict: ${err.details ?? err.message ?? "duplicate or constraint violation"}`,
      };
    }
    case PG_FK_VIOLATION:
      return {
        code: "INVALID_PARAMETERS",
        status: 400,
        message: `Referenced record does not exist: ${err.details ?? err.message}`,
      };
    case PG_INVALID_INPUT:
      return {
        code: "INVALID_PARAMETERS",
        status: 400,
        message: `Invalid input format: ${err.message}`,
      };
    case PGRST_MULTIPLE_ROWS:
      return {
        code: "DATABASE_ERROR",
        status: 500,
        message: "A unique lookup returned more than one row.",
      };
    default:
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
  requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      console.log("📝 update-member called");
      console.log(`👤 Authenticated user: ${authCtx.user.id}`);

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await parseRequestBody<UpdateMemberRequest>(req);
      if (!body) {
        return buildUpdateErrorResponse(
          "BAD_REQUEST",
          "Request body is required.",
          400,
          startTime,
        );
      }

      const { memberId, updatedData } = body;

      // ── 1. Validate memberId is a UUID BEFORE touching the DB ──
      if (!memberId || String(memberId).trim() === "") {
        return buildUpdateErrorResponse(
          "BAD_REQUEST",
          "memberId is mandatory.",
          400,
          startTime,
          "memberId",
        );
      }

      const targetId = String(memberId).trim();

      if (!isUUID(targetId)) {
        console.error(
          `❌ Rejected update: memberId="${targetId}" is not a valid UUID. ` +
            `Frontend must send the user_id (UUID), not a display name.`,
        );
        return buildUpdateErrorResponse(
          "INVALID_PARAMETERS",
          `memberId must be a valid UUID. Received "${targetId}" — ` +
            `likely a display label was sent instead of the member's user_id.`,
          400,
          startTime,
          "memberId",
        );
      }

      if (!updatedData || Object.keys(updatedData).length === 0) {
        return buildUpdateErrorResponse(
          "BAD_REQUEST",
          "updatedData is mandatory and cannot be empty.",
          400,
          startTime,
          "updatedData",
        );
      }

      // ── 2. Auto-correct swapped userType / userOwnershipType ──
      const swapResult = autoFixSwappedTypes(
        updatedData.userType,
        updatedData.userOwnershipType,
      );
      if (swapResult.swapped) {
        updatedData.userType = String(swapResult.userType);
        updatedData.userOwnershipType = String(swapResult.ownershipType);
      }

      // ── 3. Early validation of enum-like fields (fail fast, no DB hit) ──
      try {
        if (updatedData.userType !== undefined) {
          normalizeEnum(updatedData.userType, ALLOWED_USER_TYPES, "userType");
        }
        if (updatedData.userOwnershipType !== undefined) {
          normalizeEnum(
            updatedData.userOwnershipType,
            ALLOWED_OWNERSHIP_TYPES,
            "userOwnershipType",
          );
        }
        if (updatedData.status !== undefined) {
          parseStatus(updatedData.status);
        }
        if (updatedData.serviceAgentRating !== undefined &&
            updatedData.serviceAgentRating !== null &&
            updatedData.serviceAgentRating !== "") {
          const r = Number(updatedData.serviceAgentRating);
          if (!Number.isFinite(r) || r < 0 || r > 5) {
            throw new ValidationError(
              "serviceAgentRating must be between 0 and 5.",
              "serviceAgentRating",
            );
          }
        }
        if (updatedData.role !== undefined) {
          if (!Array.isArray(updatedData.role)) {
            throw new ValidationError("role must be an array of strings.", "role");
          }
          const cleanRoles = updatedData.role.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
          const invalidRoles = cleanRoles.filter((r) => !ALLOWED_ROLES.includes(r as any));
          if (invalidRoles.length > 0) {
            throw new ValidationError(`Invalid roles: ${invalidRoles.join(", ")}`, "role");
          }
        }
      } catch (err: any) {
        if (err instanceof ValidationError) {
          return buildUpdateErrorResponse(
            "INVALID_PARAMETERS",
            err.message,
            400,
            startTime,
            err.field,
          );
        }
        throw err;
      }

      // ── 4. Fetch existing member ──
      const { data: memberRecord, error: fetchErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, contact, society")
        .eq("user_id", targetId)
        .maybeSingle();

      if (fetchErr) {
        const mapped = mapPgError(fetchErr);
        if (mapped) {
          return buildUpdateErrorResponse(
            mapped.code,
            mapped.message,
            mapped.status,
            startTime,
            mapped.field,
          );
        }
        throw fetchErr;
      }

      if (!memberRecord) {
        return buildUpdateErrorResponse(
          "NOT_FOUND",
          "Member record not found.",
          404,
          startTime,
        );
      }

      if (!memberRecord.society) {
        return buildUpdateErrorResponse(
          "INVALID_STATE",
          "Member record is missing society context — cannot update.",
          400,
          startTime,
        );
      }

      const societyId = memberRecord.society as string;

      // ── 5. Build society user update payload ──
      const societyUserUpdatePayload: Record<string, unknown> = {};

      // Block
      if (updatedData.blockName !== undefined) {
        try {
          societyUserUpdatePayload.block = await resolveBlockId(
            supabaseAdmin,
            updatedData.blockName ?? "",
            societyId,
          );
        } catch (err: any) {
          if (err instanceof ValidationError) {
            return buildUpdateErrorResponse(
              "NOT_FOUND",
              err.message,
              404,
              startTime,
              err.field,
            );
          }
          throw err;
        }
      }

      // Tower
      if (updatedData.towerName !== undefined) {
        try {
          societyUserUpdatePayload.tower = await resolveTowerId(
            supabaseAdmin,
            updatedData.towerName ?? "",
            societyId,
          );
        } catch (err: any) {
          if (err instanceof ValidationError) {
            return buildUpdateErrorResponse(
              "NOT_FOUND",
              err.message,
              404,
              startTime,
              err.field,
            );
          }
          throw err;
        }
      }

      // String fields — coerceOptional preserves 0/false, turns "" → null
      const stringFieldMappings: [keyof UpdateMemberRequest["updatedData"], string][] = [
        ["unitFlatNumber", "unit_flat_number"],
        ["moveInDate", "move_in_date"],
        ["moveOutDate", "move_out_date"],
        ["shift", "shift"],
        ["securityZone", "security_zone"],
        ["securityGuardStatus", "security_guard_status"],
        ["gateNumber", "gate_number"],
        ["securityGuardId", "security_guard_id"],
        ["agentAvailabilityStatus", "agent_availability_status"],
      ];

      for (const [field, dbField] of stringFieldMappings) {
        if (updatedData[field] !== undefined) {
          societyUserUpdatePayload[dbField] = coerceOptional(updatedData[field]);
        }
      }

      // Enum fields — normalized + validated
      if (updatedData.userType !== undefined) {
        societyUserUpdatePayload.user_type = normalizeEnum(
          updatedData.userType,
          ALLOWED_USER_TYPES,
          "userType",
        );
      }
      if (updatedData.userOwnershipType !== undefined) {
        societyUserUpdatePayload.user_ownership_type = normalizeEnum(
          updatedData.userOwnershipType,
          ALLOWED_OWNERSHIP_TYPES,
          "userOwnershipType",
        );
      }

      // Status — validated boolean
      if (updatedData.status !== undefined) {
        societyUserUpdatePayload.status = parseStatus(updatedData.status);
      }

      // Numeric — validated
      if (updatedData.serviceAgentRating !== undefined) {
        if (
          updatedData.serviceAgentRating === null ||
          updatedData.serviceAgentRating === ""
        ) {
          societyUserUpdatePayload.service_agent_rating = null;
        } else {
          const r = Number(updatedData.serviceAgentRating);
          societyUserUpdatePayload.service_agent_rating = Number(r.toFixed(2));
        }
      }

      // Service agent services — array join
      if (updatedData.serviceAgentServices !== undefined) {
        societyUserUpdatePayload.service_agent_services =
          Array.isArray(updatedData.serviceAgentServices)
            ? updatedData.serviceAgentServices.join(", ")
            : updatedData.serviceAgentServices || null;
      }

      // ✅ Roles — validated and prepared for update
      if (updatedData.role !== undefined) {
        societyUserUpdatePayload.role = (updatedData.role as string[]).map((r) => String(r).toLowerCase().trim());
      }

      // ── 6. Update society user ──
      if (Object.keys(societyUserUpdatePayload).length > 0) {
        const { error: userUpdateErr } = await supabaseAdmin
          .from("SSP_Society_User")
          .update(societyUserUpdatePayload)
          .eq("user_id", memberRecord.user_id);

        if (userUpdateErr) {
          const mapped = mapPgError(userUpdateErr);
          if (mapped) {
            return buildUpdateErrorResponse(
              mapped.code,
              mapped.message,
              mapped.status,
              startTime,
              mapped.field,
            );
          }
          throw userUpdateErr;
        }
      }

      // ── 7. Update contact ──
      let finalEmail = "";
      let finalName = "";
      if (memberRecord.contact) {
        const contactUpdatePayload: Record<string, unknown> = {};

        const contactFieldMappings: [keyof UpdateMemberRequest["updatedData"], string][] = [
          ["fullName", "name"],
          ["phone", "phone"],
          ["email", "email"],
          ["gender", "gender"],
          ["occupation", "occupation"],
          ["idProofType", "id_proof_type"],
          ["idProofNumber", "id_proof_number"],
          ["whatsappPhone", "whatsapp_phone"],
          ["emergencyPhone", "emergency_phone"],
          ["vehicleType", "vehicle_type"],
          ["vehicleRegistrationNumber", "vehicle_registration_number"],
        ];

        for (const [field, dbField] of contactFieldMappings) {
          if (updatedData[field] !== undefined) {
            contactUpdatePayload[dbField] = coerceOptional(updatedData[field]);
          }
        }

        if (Object.keys(contactUpdatePayload).length > 0) {
          const { data: updatedContact, error: contactUpdateErr } = await supabaseAdmin
            .from("SSP_Contact")
            .update(contactUpdatePayload)
            .eq("contact_id", memberRecord.contact)
            .select("name, email, phone")
            .single();

          if (contactUpdateErr) {
            const mapped = mapPgError(contactUpdateErr);
            if (mapped) {
              return buildUpdateErrorResponse(
                mapped.code,
                mapped.message,
                mapped.status,
                startTime,
                mapped.field,
              );
            }
            throw contactUpdateErr;
          }
          
          if (updatedContact) {
            finalEmail = updatedContact.email || `${updatedContact.phone}@temp.user`;
            finalName = updatedContact.name || "User";
          }
        }
      }

      // ── 8. Sync Auth Metadata (Prevents JWT Refresh Bugs) ──
      try {
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
        const targetAuthUser = authUsers?.users?.find((u: any) => u.user_metadata?.user_id === targetId);

        if (targetAuthUser) {
          const metadataUpdate: Record<string, any> = { ...targetAuthUser.user_metadata };
          let needsUpdate = false;

          if (updatedData.role !== undefined) {
            metadataUpdate.roles = (updatedData.role as string[]).map((r) => String(r).toLowerCase().trim());
            needsUpdate = true;
          }
          if (finalName) {
            metadataUpdate.name = finalName;
            needsUpdate = true;
          }
          
          if (needsUpdate) {
            await supabaseAdmin.auth.admin.updateUserById(targetAuthUser.id, {
              user_metadata: metadataUpdate,
            });
            console.log(`✅ Synced auth metadata for user: ${targetAuthUser.id}`);
          }
        }
      } catch (authSyncErr) {
        console.warn(`⚠️ Failed to sync auth metadata:`, authSyncErr);
        // We don't fail the whole request if auth sync fails, just log it.
      }

      // ── 9. Success ──
      console.log(
        `✅ Member updated: ${targetId} in ${Date.now() - startTime}ms`,
      );

      return successResponse({
        updatedMember: {
          memberId: targetId,
          updatedData,
          status: "Successfully Updated",
        },
      });
    } catch (error: any) {
      // Structured Postgres errors → 4xx
      const mapped = mapPgError(error);
      if (mapped) {
        return buildUpdateErrorResponse(
          mapped.code,
          mapped.message,
          mapped.status,
          startTime,
          mapped.field,
        );
      }

      // Validation errors surfaced from helpers
      if (error instanceof ValidationError) {
        return buildUpdateErrorResponse(
          "INVALID_PARAMETERS",
          error.message,
          400,
          startTime,
          error.field,
        );
      }

      console.error("❌ update-member error:", error);
      return buildUpdateErrorResponse(
        "SERVER_ERROR",
        error.message || "Failed to update member",
        500,
        startTime,
      );
    }
  }),
);