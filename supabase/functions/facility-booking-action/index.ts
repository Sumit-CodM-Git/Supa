import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const baseLogger = createLogger("facility-booking-action");

const logger = {
  info: (data: Record<string, unknown>) =>
    baseLogger.info({
      level: "info",
      timestamp: new Date().toISOString(),
      ...data,
    }),
  warn: (data: Record<string, unknown>) =>
    baseLogger.warn({
      level: "warn",
      timestamp: new Date().toISOString(),
      ...data,
    }),
  error: (data: Record<string, unknown>) =>
    baseLogger.error({
      level: "error",
      timestamp: new Date().toISOString(),
      ...data,
    }),
};

// ============================================
// TYPES & INTERFACES
// ============================================
interface ActionRequest {
  societyRegistrationNumber?: string;
  bookingId: string;
  action: string;
  reasonForRejecting?: string;
}

interface AuthContext {
  user: {
    id: string;
    email?: string;
  };
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

// ============================================
// MAIN HANDLER
// ============================================
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(
  requireAuth(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx = (req as AuthenticatedRequest).authContext;
    const startTime = Date.now();

    try {
      logger.info({
        action: "facility_booking_action_start",
        userId: authCtx?.user?.id ?? "unknown",
        method: req.method,
        message: "Facility booking action execution started",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => "");
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      const body: ActionRequest = JSON.parse(bodyText);
      const { societyRegistrationNumber, bookingId, action, reasonForRejecting } = body;

      if (!bookingId || !action || String(bookingId).trim() === "" || String(action).trim() === "") {
        return errorResponse("Booking ID and Action are mandatory.", 400);
      }

      const targetBookingNum = String(bookingId).trim();
      const targetAction = String(action).trim().toLowerCase();
      const regNum = societyRegistrationNumber ? String(societyRegistrationNumber).trim() : "";

      // 1. Determine target state & validate reason
      let nextStatusValue = "";
      let rejectionReasonValue: string | null = null;

      if (targetAction === "approved" || targetAction === "approve") {
        nextStatusValue = "Approved";
      } else if (targetAction === "reject" || targetAction === "rejected") {
        if (!reasonForRejecting || String(reasonForRejecting).trim() === "") {
          return errorResponse("reasonForRejecting is required when rejecting a booking.", 400);
        }
        nextStatusValue = "Rejected";
        rejectionReasonValue = String(reasonForRejecting).trim();
      } else {
        return errorResponse('Invalid action. Use "approve" or "reject".', 400);
      }

      // 2. Fetch target booking with relation validation
      const { data: bookings, error: findErr } = await supabase
        .from("SSP_Facility_Booking")
        .select(`
          name,
          approval_status,
          booking_status,
          SSP_Society_User!inner (
            SSP_Society!inner ( registration_number )
          )
        `)
        .eq("name", targetBookingNum);

      if (findErr) throw findErr;

      if (!bookings || bookings.length === 0) {
        return errorResponse("Booking record not found.", 404);
      }

      // Validate registration number match if supplied
      const matchingBooking = bookings.find((b: any) => {
        if (!regNum) return true;
        const userSoc = Array.isArray(b.SSP_Society_User) ? b.SSP_Society_User[0] : b.SSP_Society_User;
        const society = Array.isArray(userSoc?.SSP_Society) ? userSoc?.SSP_Society[0] : userSoc?.SSP_Society;
        return society?.registration_number === regNum;
      });

      if (!matchingBooking) {
        return errorResponse("Booking record not found for the specified society.", 404);
      }

      // 3. Update status and rejection reason
      const { error: updateErr } = await supabase
        .from("SSP_Facility_Booking")
        .update({
          approval_status: nextStatusValue,
          booking_status: nextStatusValue,
          rejection_reason: rejectionReasonValue,
        })
        .eq("name", matchingBooking.name);

      if (updateErr) throw updateErr;

      logger.info({
        action: "facility_booking_action_success",
        bookingId: targetBookingNum,
        newStatus: nextStatusValue,
        duration: Date.now() - startTime,
        message: "Booking status updated successfully",
      });

      return successResponse({
        facilityBookingAction: { updated: true },
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "facility_booking_action_error",
        error: err.message,
        stack: err.stack,
        duration: Date.now() - startTime,
        message: "Facility booking action execution failed",
      });

      return errorResponse(
        err.message || "Failed to process facility booking action.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null
      );
    }
  })
);