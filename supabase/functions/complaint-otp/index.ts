import { runComplaintOtpCycle, type ComplaintOtpState } from "../_shared/complaint-otp-cycle.ts";
// supabase/functions/complaint-otp/index.ts

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import {
  getCurrentTimestamp,
  logger,
  sanitizeString,
} from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  COMPLAINT_STATUS,
  OTP_STAGE,
  resolveComplaintAssignee,
  type OtpStage,
} from "../_shared/staff.ts";

// ---------- Types ----------

interface ComplaintOtpRequest {
  complaintId: string;
  stage: OtpStage;
  otp?: string;
}

// ---------- Constants ----------

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ---------- Helpers ----------

function generateDateOtp(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dd = String(ist.getDate()).padStart(2, "0");
  const mm = String(ist.getMonth() + 1).padStart(2, "0");
  const yy = String(ist.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

const isValidOtp = (s: string) => /^[0-9]{6}$/.test(s);
const isStage = (s: string): s is OtpStage =>
  s === OTP_STAGE.START || s === OTP_STAGE.END;

// ---------- Handler ----------

Deno.serve(
  requireAuth(async (req, { user }) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return errorResponse("Only POST method is allowed.");
    }

    const t0 = Date.now();
    try {
      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("Request body is required.");

      const { complaintId, stage, otp } = body as ComplaintOtpRequest;

      const v = new Validator()
        .validateRequired(complaintId, "complaintId")
        .validateRequired(stage, "stage");
      if (!v.isValid()) return errorResponse("Validation failed");

      const cid = sanitizeString(complaintId);
      const stg = sanitizeString(stage).toUpperCase();
      if (!isStage(stg)) {
        return errorResponse("Invalid stage. Must be START or END.");
      }

      // ---------- Authorization (agent OR vendor) ----------
      const resolved = await resolveComplaintAssignee({
        complaintId: cid,
        callerAuthId: user.id,
        callerAuthUserId: user.authId,
        callerPhone: (user as { phone?: string | null }).phone ?? null,
        select:
          "complaint_id, status, assigned_agent, non_society_user, " +
          "start_otp, start_otp_generated_at, start_otp_verified_at, end_otp, end_otp_generated_at, end_otp_verified_at",
      });

      if (!resolved.ok) {
        return errorResponse(resolved.message, resolved.code);
      }

      const c = resolved.complaint as unknown as ComplaintOtpState;

      logger.info({
        level: "info",
        action: "complaint-otp",
        userId: user.id,
        complaintId: cid,
        role: resolved.role,
        message: "Authorized",
        timestamp: new Date().toISOString(),
      });

      const result = await runComplaintOtpCycle(
        supabaseAdmin, c, stg, otp === undefined ? undefined : String(otp).trim(), generateDateOtp(),
      );
      return result.data ? successResponse(result.data) : errorResponse(result.message!, result.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error({
        level: "error",
        action: "complaint-otp",
        userId: user?.id ?? "unknown",
        message: msg,
        stack: err instanceof Error ? err.stack : undefined,
        timestamp: new Date().toISOString(),
      });
      return errorResponse(msg || "Failed to process OTP request.");
    }
  }),
);
