/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildResponse(null, 'BAD_REQUEST', 'Request body is empty.', 400)
    }

    const requestObj = JSON.parse(bodyText)
    const { societyRegistrationNumber, payId, approvalStatus } = requestObj

    // 1. Mandatory Input Validations
    if (!societyRegistrationNumber || !payId || !approvalStatus) {
      return buildResponse(null, 'BAD_REQUEST', 'Missing mandatory fields: societyRegistrationNumber, payId, or approvalStatus.', 400)
    }

    const trimmedPayId = payId.trim()
    const normalizedStatus = approvalStatus.trim().toLowerCase()

    // 2. Map Salesforce/Postman incoming actions to your DB picklist values
    let targetDbStatus = ''
    if (normalizedStatus === 'approved') {
      targetDbStatus = 'Paid'
    } else if (normalizedStatus === 'cancelled' || normalizedStatus === 'rejected') {
      targetDbStatus = 'Rejected'
    } else {
      return buildResponse(null, 'BAD_REQUEST', `Invalid approvalStatus values provided. Expected 'approved' or 'cancelled'.`, 400)
    }

    // 3. Verify Society context exists
    const { data: society, error: societyErr } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', societyRegistrationNumber.trim())
      .maybeSingle()

    if (societyErr || !society) {
      return buildResponse(null, 'NOT_FOUND', 'Target society background context not registered.', 404)
    }

    // 4. Check if identifier is a structural UUID string
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedPayId)

    // 5. Execute Database UPDATE operation
    let query = supabase.from('SSP_Payment').update({ 
      payment_status: targetDbStatus,
      payment_date: targetDbStatus === 'Paid' ? new Date().toISOString() : null 
    })

    if (isUuid) {
      query = query.eq('pay_rec_id', trimmedPayId)
    } else {
      query = query.eq('payment_id', trimmedPayId)
    }

    const { data: updatedData, error: updateErr } = await query.select('pay_rec_id, payment_status').maybeSingle()

    if (updateErr) {
      throw new Error(`Database transaction rejected: ${updateErr.message}`)
    }

    if (!updatedData) {
      return buildResponse(null, 'NOT_FOUND', `No target payment record found matching ID '${trimmedPayId}'.`, 404)
    }

    // 6. Return standard structured successful transformation response
    return buildResponse({
      payRecId: updatedData.pay_rec_id,
      currentStatus: updatedData.payment_status,
      isUpdatedSuccessfully: true
    }, null, null, 200)

  } catch (error: any) {
    return buildResponse(null, 'SERVER_ERROR', `System update processing failure: ${error.message}`, 500)
  }
})

function buildResponse(payload: any, errCode: string | null, errMsg: string | null, statusCode: number) {
  return new Response(
    JSON.stringify({
      actionResult: payload,
      errorResponse: errCode ? {
        errorCode: errCode,
        message: errMsg,
        timestamp: new Date().toISOString()
      } : null
    }),
    {
      status: statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
}*/
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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
const baseLogger = createLogger("verify-booking-facility");

const logger = {
  info: (data: Record<string, unknown>) =>
    baseLogger.info({
      level: "info",
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
interface VerifyBookingPayload {
  societyRegistrationNumber: string;
  payId: string;
  approvalStatus: string;
  rejectionReason?: string;
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
// INITIALIZATION
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx = (req as AuthenticatedRequest).authContext;
    const startTime = Date.now();

    try {
      logger.info({
        action: "verify_booking_facility_start",
        userId: authCtx?.user?.id ?? "unknown",
        method: req.method,
        message: "Booking verification process initialized",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => null);
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      const requestObj: VerifyBookingPayload = JSON.parse(bodyText);
      const { societyRegistrationNumber, payId, approvalStatus, rejectionReason } = requestObj;

      // 1. Mandatory Input Validations
      if (!societyRegistrationNumber || !payId || !approvalStatus) {
        return errorResponse(
          "Missing mandatory fields: societyRegistrationNumber, payId, or approvalStatus.",
          400
        );
      }

      const trimmedPayId = payId.trim();
      const normalizedStatus = approvalStatus.trim().toLowerCase();

      let targetDbPaymentStatus = "";
      let isApproved = false;

      if (normalizedStatus === "approved") {
        targetDbPaymentStatus = "Paid";
        isApproved = true;
      } else if (normalizedStatus === "cancelled" || normalizedStatus === "rejected") {
        targetDbPaymentStatus = "Rejected";
        isApproved = false;
      } else {
        return errorResponse(
          "Invalid approvalStatus value provided. Expected 'approved', 'cancelled', or 'rejected'.",
          400
        );
      }

      // 2. Verify Society Context
      const { data: society, error: societyErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", societyRegistrationNumber.trim())
        .maybeSingle();

      if (societyErr || !society) {
        return errorResponse("Target society context not registered.", 404);
      }

      // 3. Locate Target Payment Record
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedPayId);

      let paymentQuery = supabaseAdmin
        .from("SSP_Payment")
        .select("pay_rec_id, payment_id, facility, society_user, amount");

      if (isUuid) {
        paymentQuery = paymentQuery.eq("pay_rec_id", trimmedPayId);
      } else {
        paymentQuery = paymentQuery.eq("payment_id", trimmedPayId);
      }

      const { data: targetPayment, error: payFetchErr } = await paymentQuery.maybeSingle();

      if (payFetchErr) {
        throw new Error(`Failed to locate target payment: ${payFetchErr.message}`);
      }

      if (!targetPayment) {
        return errorResponse(`No target payment record found matching ID '${trimmedPayId}'.`, 404);
      }

      // 4. Update Payment Record Status
      const { data: updatedPayment, error: payUpdateErr } = await supabaseAdmin
        .from("SSP_Payment")
        .update({
          payment_status: targetDbPaymentStatus,
          payment_date: isApproved ? new Date().toISOString() : null,
        })
        .eq("pay_rec_id", targetPayment.pay_rec_id)
        .select("pay_rec_id, payment_status")
        .single();

      if (payUpdateErr || !updatedPayment) {
        throw new Error(`Failed to update payment record status: ${payUpdateErr?.message}`);
      }

      // 5. Fetch Associated Facility Booking Request
      const { data: bookingRequest, error: reqFetchErr } = await supabaseAdmin
        .from("SSP_Facility_Booking_Request")
        .select(`
          request_id,
          requested_by,
          facility,
          payment,
          booking_start_date,
          booking_end_date,
          purpose_of_visit,
          is_all_day
        `)
        .eq("payment", targetPayment.pay_rec_id)
        .maybeSingle();

      if (reqFetchErr) {
        throw new Error(`Failed checking booking request: ${reqFetchErr.message}`);
      }

      if (!bookingRequest) {
        return errorResponse("No facility booking request linked to this payment record.", 404);
      }

      let confirmedBookingId: string | null = null;

      // 6. Execute Record Migration on Approval
      if (isApproved) {
        // Step A: Insert record into SSP_Facility_Booking
        const { data: confirmedBooking, error: bookingInsertErr } = await supabaseAdmin
          .from("SSP_Facility_Booking")
          .insert({
            requested_by: bookingRequest.requested_by,
            facility: bookingRequest.facility,
            payment: bookingRequest.payment,
            booking_start_date: bookingRequest.booking_start_date,
            booking_end_date: bookingRequest.booking_end_date,
            purpose_of_visit: bookingRequest.purpose_of_visit,
            is_all_day: bookingRequest.is_all_day ?? false,
            approval_status: "Approved",
            booking_status: "Approved",
            payment_status: "Paid",
          })
          .select("name")
          .single();

        if (bookingInsertErr || !confirmedBooking) {
          throw new Error(`Failed creating finalized booking record: ${bookingInsertErr?.message}`);
        }

        confirmedBookingId = confirmedBooking.name;

        // Step B: Move completed: Delete record from SSP_Facility_Booking_Request
        const { error: deleteReqErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .delete()
          .eq("request_id", bookingRequest.request_id);

        if (deleteReqErr) {
          throw new Error(`Booking record created, but failed removing request record: ${deleteReqErr.message}`);
        }
      } else {
        // Case Rejected/Cancelled: Update request status or attach rejection reason
        const targetReqStatus = normalizedStatus === "cancelled" ? "CANCELLED" : "REJECTED";

        const { error: reqUpdateErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .update({ status: targetReqStatus })
          .eq("request_id", bookingRequest.request_id);

        if (reqUpdateErr) {
          throw new Error(`Failed updating booking request status: ${reqUpdateErr.message}`);
        }
      }

      logger.info({
        action: "verify_booking_facility_success",
        payRecId: updatedPayment.pay_rec_id,
        bookingId: confirmedBookingId,
        paymentStatus: updatedPayment.payment_status,
        actionTaken: isApproved ? "MOVED_TO_FACILITY_BOOKING" : "REQUEST_REJECTED",
        durationMs: Date.now() - startTime,
      });

      return successResponse({
        payRecId: updatedPayment.pay_rec_id,
        bookingId: confirmedBookingId,
        paymentStatus: updatedPayment.payment_status,
        status: isApproved ? "APPROVED_AND_MOVED" : "REJECTED",
        isUpdatedSuccessfully: true,
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "verify_booking_facility_error",
        error: err.message,
        durationMs: Date.now() - startTime,
      });

      return errorResponse(
        err.message || "Failed to verify facility booking.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null
      );
    }
  })
);