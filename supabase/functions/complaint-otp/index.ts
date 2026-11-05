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
        callerPhone: (user as { phone?: string | null }).phone ?? null,
        select:
          "complaint_id, status, assigned_agent, non_society_user, " +
          "start_otp, start_otp_verified_at, end_otp, end_otp_verified_at",
      });

      if (!resolved.ok) {
        return errorResponse(resolved.message, resolved.code);
      }

      const c = resolved.complaint as {
        complaint_id: string;
        status: string | null;
        start_otp: string | null;
        start_otp_verified_at: string | null;
        end_otp: string | null;
        end_otp_verified_at: string | null;
      };

      logger.info({
        level: "info",
        action: "complaint-otp",
        userId: user.id,
        complaintId: cid,
        role: resolved.role,
        message: "Authorized",
        timestamp: new Date().toISOString(),
      });

      const cleanOtp = otp ? sanitizeString(otp) : null;
      const isVerify = cleanOtp !== null;

      // ---------- REQUEST ----------
      if (!isVerify) {
        if (stg === OTP_STAGE.START) {
          if (c.status !== COMPLAINT_STATUS.ASSIGNED) {
            return errorResponse(
              "Start OTP is only valid when the complaint is assigned.",
            );
          }
          if (c.start_otp_verified_at) {
            return errorResponse("Start OTP already verified.");
          }
        } else {
          if (c.status !== COMPLAINT_STATUS.IN_PROGRESS) {
            return errorResponse(
              "End OTP is only valid after work has started.",
            );
          }
          if (c.end_otp_verified_at) {
            return errorResponse("End OTP already verified.");
          }
        }

        const generated = generateDateOtp();
        const patch = stg === OTP_STAGE.START
          ? { start_otp: generated }
          : { end_otp: generated };

        const { error: upErr } = await supabaseAdmin
          .from("SSP_Complaint")
          .update(patch)
          .eq("complaint_id", cid);

        if (upErr) return errorResponse("Failed to store OTP.", 500);

        logger.info({
          level: "info",
          action: "complaint-otp",
          userId: user.id,
          complaintId: cid,
          stage: stg,
          role: resolved.role,
          message: "OTP generated",
          timestamp: new Date().toISOString(),
        });

        return successResponse({
          complaintId: cid,
          stage: stg,
          message: `${stg} OTP is ready. Ask the resident to share it.`,
          otpVerified: false,
          nextStep: "VERIFY_OTP",
        });
      }

      // ---------- VERIFY ----------
      if (!isValidOtp(cleanOtp)) {
        return errorResponse("Invalid OTP format. OTP must be 6 digits.");
      }

      let expected: string | null;
      if (stg === OTP_STAGE.START) {
        if (c.status !== COMPLAINT_STATUS.ASSIGNED) {
          return errorResponse("Invalid state for START OTP.");
        }
        if (!c.start_otp) return errorResponse("Request START OTP first.");
        if (c.start_otp_verified_at) {
          return errorResponse("START OTP already verified.");
        }
        expected = c.start_otp;
      } else {
        if (c.status !== COMPLAINT_STATUS.IN_PROGRESS) {
          return errorResponse("Work has not started yet.");
        }
        if (!c.end_otp) return errorResponse("Request END OTP first.");
        if (c.end_otp_verified_at) {
          return errorResponse("END OTP already verified.");
        }
        expected = c.end_otp;
      }

      if (String(expected).trim() !== cleanOtp.trim()) {
        logger.warn({
          level: "warn",
          action: "complaint-otp",
          userId: user.id,
          complaintId: cid,
          stage: stg,
          role: resolved.role,
          message: "Invalid OTP",
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Invalid OTP. Please try again.");
      }

      const now = getCurrentTimestamp();
      const patch = stg === OTP_STAGE.START
        ? {
          status: COMPLAINT_STATUS.IN_PROGRESS,
          start_otp_verified_at: now,
        }
        : {
          status: COMPLAINT_STATUS.RESOLVED,
          end_otp_verified_at: now,
          completion_date_time: now,
        };

      const guardStatus = stg === OTP_STAGE.START
        ? COMPLAINT_STATUS.ASSIGNED
        : COMPLAINT_STATUS.IN_PROGRESS;
      const guardCol = stg === OTP_STAGE.START
        ? "start_otp_verified_at"
        : "end_otp_verified_at";

      // Compare-and-swap: only flips if state hasn't changed since read.
      const { data: updated, error: upErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .update(patch)
        .eq("complaint_id", cid)
        .eq("status", guardStatus)
        .is(guardCol, null)
        .select("complaint_id, status")
        .maybeSingle();

      if (upErr) return errorResponse("Failed to update complaint.", 500);
      if (!updated) {
        return errorResponse(
          "OTP already verified or state changed. Please refresh.",
          409,
        );
      }

      logger.info({
        level: "info",
        action: "complaint-otp",
        userId: user.id,
        complaintId: cid,
        stage: stg,
        role: resolved.role,
        otpVerified: true,
        newStatus: patch.status,
        duration: Date.now() - t0,
        message: "OTP verified successfully",
        timestamp: new Date().toISOString(),
      });

      return successResponse({
        complaintId: cid,
        stage: stg,
        message: stg === OTP_STAGE.START
          ? "Work started successfully."
          : "Work completed successfully.",
        otpVerified: true,
        status: patch.status,
        nextStep: stg === OTP_STAGE.START ? "REQUEST_END_OTP" : "COMPLETED",
      });
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