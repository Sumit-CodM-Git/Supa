import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const baseLogger = createLogger("facility-booking-admin");

const logger = {
  info: (data: Record<string, unknown>) =>
    baseLogger.info({ level: "info", timestamp: new Date().toISOString(), ...data }),
  warn: (data: Record<string, unknown>) =>
    baseLogger.warn({ level: "warn", timestamp: new Date().toISOString(), ...data }),
  error: (data: Record<string, unknown>) =>
    baseLogger.error({ level: "error", timestamp: new Date().toISOString(), ...data }),
};

const ENFORCE_STAFF_ROLE =
  (Deno.env.get("ENFORCE_STAFF_ROLE") ?? "true").toLowerCase() === "true";

const STAFF_ROLES = [
  "society_admin",
  "admin",
  "facility_manager",
  "facility_admin",
  "committee",
  "committee_member",
  "secretary",
  "manager",
];

// ============================================
// TYPES
// ============================================
type ActionType = "VERIFY_PAYMENT" | "UPDATE_STATUS";

interface MergedRequest {
  actionType: ActionType;
  societyRegistrationNumber: string;
  payId?: string;
  approvalStatus?: string;
  rejectionReason?: string;
  bookingId?: string;
  action?: string;
  reasonForRejecting?: string;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

// ============================================
// INITIALIZATION
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================
function isStaffRole(role: unknown): boolean {
  if (!role) return false;
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((r) => {
    if (typeof r !== "string") return false;
    return STAFF_ROLES.includes(r.toLowerCase().trim());
  });
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request, authCtxFromParam?: AuthContext) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx =
      authCtxFromParam ??
      (req as AuthenticatedRequest).authContext;

    if (!authCtx?.user?.id) {
      return errorResponse("Authentication context missing.", 401);
    }

    const userId = authCtx.user.id;
    const startTime = Date.now();

    try {
      logger.info({
        action: "facility_booking_admin_start",
        userId,
        method: req.method,
        message: "Facility booking admin request received",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => "");
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      let body: MergedRequest;
      try {
        body = JSON.parse(bodyText) as MergedRequest;
      } catch {
        return errorResponse("Invalid JSON in request body.", 400);
      }

      const { actionType, societyRegistrationNumber } = body;

      if (!actionType || String(actionType).trim() === "") {
        return errorResponse("actionType is mandatory.", 400);
      }
      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanAction = String(actionType).trim().toUpperCase() as ActionType;
      const ALLOWED: ActionType[] = ["VERIFY_PAYMENT", "UPDATE_STATUS"];
      if (!ALLOWED.includes(cleanAction)) {
        return errorResponse(
          `Invalid actionType: ${actionType}. Allowed: ${ALLOWED.join(", ")}.`,
          400,
        );
      }

      const regNum = String(societyRegistrationNumber).trim();

      // ---- Resolve society (case-insensitive) ----
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number")
        .ilike("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        logger.error({
          action: "facility_booking_admin_society_lookup_error",
          error: socErr.message,
        });
        return errorResponse("Failed to fetch society data.", 500);
      }
      if (!society) {
        return errorResponse("Target society context not registered.", 404);
      }

      // ---- Society membership + role gate ----
      const { data: membership } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, role")
        .eq("user_id", userId)
        .eq("society", society.society_id)
        .maybeSingle();

      if (!membership) {
        logger.warn({
          action: "facility_booking_admin_membership_denied",
          userId,
          societyId: society.society_id,
        });
        return errorResponse("You are not a member of this society.", 403);
      }

      if (ENFORCE_STAFF_ROLE && !isStaffRole(membership.role)) {
        logger.warn({
          action: "facility_booking_admin_role_denied",
          userId,
          societyId: society.society_id,
          roles: JSON.stringify(membership.role),
        });
        return errorResponse(
          "You don't have permission to manage facility bookings.",
          403,
        );
      }

      // =====================================================================
      // ACTION 1: VERIFY_PAYMENT
      //  • Approve → inserts booking as Pending (admin must then UPDATE_STATUS)
      //  • Reject  → persists reason + audit fields on the request row
      // =====================================================================
      if (cleanAction === "VERIFY_PAYMENT") {
        const { payId, approvalStatus, rejectionReason } = body;

        if (!payId || !approvalStatus) {
          return errorResponse(
            "Missing mandatory fields: payId or approvalStatus.",
            400,
          );
        }

        const trimmedPayId = String(payId).trim();
        const normalizedStatus = String(approvalStatus).trim().toLowerCase();

        let targetDbPaymentStatus = "";
        let isApproved = false;

        if (normalizedStatus === "approved") {
          targetDbPaymentStatus = "paid";
          isApproved = true;
        } else if (normalizedStatus === "cancelled" || normalizedStatus === "rejected") {
          targetDbPaymentStatus = "rejected";
          isApproved = false;
        } else {
          return errorResponse(
            "Invalid approvalStatus value provided. Expected 'approved', 'cancelled', or 'rejected'.",
            400,
          );
        }

        // ---- Locate target payment (UUID or human-readable) ----
        let paymentQuery = supabaseAdmin
          .from("SSP_Payment")
          .select("pay_rec_id, payment_id, payment_status, facility, society_user, amount");

        paymentQuery = isUuid(trimmedPayId)
          ? paymentQuery.eq("pay_rec_id", trimmedPayId)
          : paymentQuery.eq("payment_id", trimmedPayId);

        const { data: targetPayment, error: payFetchErr } = await paymentQuery.maybeSingle();

        if (payFetchErr) {
          logger.error({
            action: "facility_booking_admin_payment_lookup_error",
            error: payFetchErr.message,
          });
          throw new Error(`Failed to locate target payment: ${payFetchErr.message}`);
        }
        if (!targetPayment) {
          return errorResponse(`No target payment record found matching ID '${trimmedPayId}'.`, 404);
        }

        // ---- Payment ownership: must belong to a user of this society ----
        const { data: paymentOwner } = await supabaseAdmin
          .from("SSP_Society_User")
          .select("user_id, society")
          .eq("user_id", targetPayment.society_user ?? "")
          .eq("society", society.society_id)
          .maybeSingle();

        if (!paymentOwner) {
          return errorResponse(
            "Payment record does not belong to a member of this society.",
            403,
          );
        }

        // ---- Idempotency: already in target state ----
        if (targetPayment.payment_status === targetDbPaymentStatus) {
          logger.warn({
            action: "facility_booking_admin_verify_noop",
            payRecId: targetPayment.pay_rec_id,
            currentStatus: targetPayment.payment_status,
            message: "Payment already in target state; returning idempotent success",
          });

          return successResponse({
            payRecId: targetPayment.pay_rec_id,
            bookingId: null,
            paymentStatus: targetPayment.payment_status,
            status: isApproved ? "ALREADY_APPROVED" : "ALREADY_REJECTED",
            isUpdatedSuccessfully: false,
            rejection: null,
          });
        }

        // ---- Locate linked booking request ----
        const { data: bookingRequest, error: reqFetchErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .select(`
            request_id, requested_by, facility, payment,
            booking_start_date, booking_end_date, purpose_of_visit, is_all_day
          `)
          .eq("payment", targetPayment.pay_rec_id)
          .maybeSingle();

        if (reqFetchErr) {
          throw new Error(`Failed checking booking request: ${reqFetchErr.message}`);
        }
        if (!bookingRequest) {
          return errorResponse(
            "No facility booking request linked to this payment record.",
            404,
          );
        }

        const previousPaymentStatus = targetPayment.payment_status;

        // ---- Update payment status ----
        const { error: payUpdateErr } = await supabaseAdmin
          .from("SSP_Payment")
          .update({
            payment_status: targetDbPaymentStatus,
            payment_date: isApproved ? new Date().toISOString() : null,
          })
          .eq("pay_rec_id", targetPayment.pay_rec_id);

        if (payUpdateErr) {
          throw new Error(`Failed to update payment record status: ${payUpdateErr.message}`);
        }

        let confirmedBookingId: string | null = null;
        let rejectionInfo: {
          requestId: string;
          reason: string | null;
          rejectedBy: string;
          rejectedAt: string;
        } | null = null;

        // ---- Approval path: insert booking (Pending) + delete request (with rollback) ----
        if (isApproved) {
          let insertedBookingName: string | null = null;

          try {
            // FIX SSP-0011: Set status to Approved so resident can use it immediately
            const { data: confirmedBooking, error: bookingInsertErr } = await supabaseAdmin
              .from("SSP_Facility_Booking")
              .insert({
                requested_by: bookingRequest.requested_by,
                facility: bookingRequest.facility,
                payment: bookingRequest.payment,
                booking_start_date: bookingRequest.booking_start_date,
                booking_end_date: bookingRequest.booking_end_date,
                purpose_of_visit: bookingRequest.purpose_of_visit?.trim() ?? null,
                is_all_day: bookingRequest.is_all_day ?? false,
                approval_status: "approved",
                booking_status: "approved",
                payment_status: "paid",
              })
              .select("name")
              .single();

            if (bookingInsertErr || !confirmedBooking) {
              throw new Error(
                `Failed creating finalized booking record: ${bookingInsertErr?.message}`,
              );
            }
            insertedBookingName = confirmedBooking.name;

            const { error: deleteReqErr } = await supabaseAdmin
              .from("SSP_Facility_Booking_Request")
              .delete()
              .eq("request_id", bookingRequest.request_id);

            if (deleteReqErr) {
              throw new Error(
                `Booking record created, but failed removing request record: ${deleteReqErr.message}`,
              );
            }
            confirmedBookingId = insertedBookingName;
          } catch (err) {
            // ---- Compensating rollback ----
            if (insertedBookingName) {
              await supabaseAdmin
                .from("SSP_Facility_Booking")
                .delete()
                .eq("name", insertedBookingName);
            }
            await supabaseAdmin
              .from("SSP_Payment")
              .update({
                payment_status: previousPaymentStatus,
                payment_date: null,
              })
              .eq("pay_rec_id", targetPayment.pay_rec_id);

            logger.error({
              action: "facility_booking_admin_verify_rollback",
              error: err instanceof Error ? err.message : "unknown",
              payRecId: targetPayment.pay_rec_id,
              message: "Rolled back payment + booking after downstream failure",
            });
            throw err;
          }
        } else {
          // ---- Rejection path: mark request status + persist reason + audit fields ----
          const targetReqStatus =
            normalizedStatus === "cancelled" ? "CANCELLED" : "REJECTED";

          const cleanedReason = rejectionReason ? String(rejectionReason).trim() : "";
          const rejectedAtIso = new Date().toISOString();

          // Try to persist reason + audit fields. If columns don't exist,
          // degrade to just updating status.
          const fullUpdatePayload: Record<string, unknown> = {
            status: targetReqStatus,
            rejected_by: userId,
            rejected_at: rejectedAtIso,
          };
          if (cleanedReason) fullUpdatePayload.rejection_reason = cleanedReason;

          const { error: reqUpdateErr } = await supabaseAdmin
            .from("SSP_Facility_Booking_Request")
            .update(fullUpdatePayload)
            .eq("request_id", bookingRequest.request_id);

          if (reqUpdateErr) {
            // Fallback: retry with minimal payload (only status)
            const { error: retryErr } = await supabaseAdmin
              .from("SSP_Facility_Booking_Request")
              .update({ status: targetReqStatus })
              .eq("request_id", bookingRequest.request_id);

            if (retryErr) {
              throw new Error(
                `Failed updating booking request status: ${retryErr.message}`,
              );
            }
            logger.warn({
              action: "facility_booking_admin_audit_columns_missing",
              message:
                "rejection_reason / rejected_by / rejected_at missing on request table; status updated without audit fields",
              originalError: reqUpdateErr.message,
            });
          }

          rejectionInfo = {
            requestId: bookingRequest.request_id,
            reason: cleanedReason || null,
            rejectedBy: userId,
            rejectedAt: rejectedAtIso,
          };
        }

        logger.info({
          action: "facility_booking_admin_verify_success",
          payRecId: targetPayment.pay_rec_id,
          bookingId: confirmedBookingId,
          paymentStatus: targetDbPaymentStatus,
          actionTaken: isApproved ? "MOVED_TO_FACILITY_BOOKING" : "REQUEST_REJECTED",
          actorId: userId,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          payRecId: targetPayment.pay_rec_id,
          bookingId: confirmedBookingId,
          paymentStatus: targetDbPaymentStatus,
          status: isApproved
            ? "PAYMENT_VERIFIED_BOOKING_APPROVED"
            : "REJECTED",
          isUpdatedSuccessfully: true,
          rejection: rejectionInfo,
        });
      }

      // =====================================================================
      // ACTION 2: UPDATE_STATUS
      //  • Post-verification admin approval / rejection on a confirmed booking
      // =====================================================================
      if (cleanAction === "UPDATE_STATUS") {
        const { bookingId, action, reasonForRejecting } = body;

        if (!bookingId || !action) {
          return errorResponse("Booking ID and Action are mandatory.", 400);
        }

        const targetBookingNum = String(bookingId).trim();
        const targetAction = String(action).trim().toLowerCase();

        let nextStatusValue = "";
        let rejectionReasonValue: string | null = null;

        if (targetAction === "approved" || targetAction === "approve") {
          nextStatusValue = "Approved";
        } else if (targetAction === "reject" || targetAction === "rejected") {
          if (!reasonForRejecting || String(reasonForRejecting).trim() === "") {
            return errorResponse(
              "reasonForRejecting is required when rejecting a booking.",
              400,
            );
          }
          nextStatusValue = "Rejected";
          rejectionReasonValue = String(reasonForRejecting).trim();
        } else {
          return errorResponse('Invalid action. Use "approve" or "reject".', 400);
        }

        // ---- Fetch booking with society-scoped relation validation ----
        const { data: bookings, error: findErr } = await supabaseAdmin
          .from("SSP_Facility_Booking")
          .select(`
            name,
            approval_status,
            booking_status,
            SSP_Society_User!inner (
              SSP_Society!inner ( registration_number )
            )
          `)
          .eq("name", targetBookingNum)
          .eq(
            "SSP_Society_User.SSP_Society.registration_number",
            society.registration_number,
          );

        if (findErr) {
          logger.error({
            action: "facility_booking_admin_booking_lookup_error",
            error: findErr.message,
          });
          throw findErr;
        }

        if (!bookings || bookings.length === 0) {
          return errorResponse(
            "Booking record not found for the specified society.",
            404,
          );
        }

        const targetBooking = bookings[0];

        // ---- Idempotency: already in target state ----
        if (
          targetBooking.approval_status === nextStatusValue &&
          targetBooking.booking_status === nextStatusValue
        ) {
          logger.warn({
            action: "facility_booking_admin_update_noop",
            bookingId: targetBookingNum,
            currentStatus: targetBooking.approval_status,
            message: "Booking already in target state; returning idempotent success",
          });

          return successResponse({
            facilityBookingAction: {
              updated: false,
              bookingId: targetBookingNum,
              approvalStatus: targetBooking.approval_status,
              bookingStatus: targetBooking.booking_status,
              rejectionReason: targetBooking.approval_status === "Rejected"
                ? rejectionReasonValue
                : null,
            },
          });
        }

        // ---- Perform update ----
        const updatePayload: Record<string, unknown> = {
          approval_status: nextStatusValue,
          booking_status: nextStatusValue,
          rejection_reason: rejectionReasonValue,
        };

        const { error: updateErr } = await supabaseAdmin
          .from("SSP_Facility_Booking")
          .update(updatePayload)
          .eq("name", targetBookingNum);

        if (updateErr) {
          logger.error({
            action: "facility_booking_admin_update_error",
            error: updateErr.message,
          });
          throw updateErr;
        }

        logger.info({
          action: "facility_booking_admin_update_success",
          bookingId: targetBookingNum,
          newStatus: nextStatusValue,
          actorId: userId,
          duration: Date.now() - startTime,
          message: "Booking status updated successfully",
        });

        return successResponse({
          facilityBookingAction: {
            updated: true,
            bookingId: targetBookingNum,
            approvalStatus: nextStatusValue,
            bookingStatus: nextStatusValue,
            rejectionReason: rejectionReasonValue,
          },
        });
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "facility_booking_admin_error",
        error: err.message,
        stack: err.stack,
        duration: Date.now() - startTime,
        message: "Facility booking admin request failed",
      });

      return errorResponse(
        err.message || "Failed to process facility booking admin request.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);