import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  try {
    // 1. Dual-Mode Input Parsing (Supports JSON OR FormData)
    const contentType = req.headers.get("content-type") || "";
    let societyRegistrationNumber, paymentId, action, rejectionReason, file;
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      societyRegistrationNumber = formData.get('societyRegistrationNumber')?.toString();
      paymentId = formData.get('paymentId')?.toString();
      action = formData.get('action')?.toString();
      rejectionReason = formData.get('rejectionReason')?.toString();
      file = formData.get('receiptImage');
    } else {
      const body = await req.json();
      societyRegistrationNumber = body.societyRegistrationNumber;
      paymentId = body.paymentId;
      action = body.action;
      rejectionReason = body.rejectionReason;
    }
    if (!societyRegistrationNumber?.trim() || !paymentId?.trim() || !action?.trim()) {
      return buildErrorResponse('BAD_REQUEST', 'Missing mandatory fields.', 400);
    }
    const cleanRegNum = societyRegistrationNumber.trim();
    const cleanPaymentId = paymentId.trim();
    // 2. Fetch Society Context
    const { data: societyRecord, error: societyError } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', cleanRegNum).maybeSingle();
    if (societyError) throw new Error(`Society lookup failed: ${societyError.message}`);
    if (!societyRecord) return buildErrorResponse('NOT_FOUND', 'Society not found.', 404);
    // 3. Query targeted SSP_Payment record
    let query = supabase.from('SSP_Payment').select(`pay_rec_id, payment_id, society_user:SSP_Society_User!inner(society)`).eq('society_user.society', societyRecord.society_id);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(cleanPaymentId)) {
      query = query.eq('pay_rec_id', cleanPaymentId);
    } else {
      query = query.eq('payment_id', cleanPaymentId);
    }
    const { data: targetPayment, error: findError } = await query.maybeSingle();
    if (findError) throw new Error(`Database lookup failed: ${findError.message}`);
    if (!targetPayment) return buildErrorResponse('NOT_FOUND', 'Payment record not found.', 404);
    // 4. Upload Logic matching your dashboard folder structure
    let imageUrl = null;
    if (file) {
      const fileExt = file.name.split('.').pop();
      // Dynamically matches: societyRegistrationNumber/Financial/timestamp_paymentId.ext
      const filePath = `${cleanRegNum}/Financial/${Date.now()}_${targetPayment.payment_id || targetPayment.pay_rec_id}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('society-documents').upload(filePath, file);
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      imageUrl = filePath;
    }
    // 5. Update Mutation & Clickable URL Assembly
    const updateData = {};
    if (action.toUpperCase() === 'VERIFY') {
      updateData.payment_status = 'Paid';
      updateData.rejection_reason = null;
    } else if (action.toUpperCase() === 'REJECT') {
      updateData.payment_status = 'Rejected';
      updateData.rejection_reason = rejectionReason?.trim() || null;
    }
    let returnUrl = null;
    if (imageUrl) {
      updateData.receipt_url = imageUrl;
      // This builds the absolute public link that lets you download/view directly
      returnUrl = `${supabaseUrl}/storage/v1/object/public/society-documents/${imageUrl}`;
    }
    const { error: updateError } = await supabase.from('SSP_Payment').update(updateData).eq('pay_rec_id', targetPayment.pay_rec_id);
    if (updateError) throw new Error(`Update transaction failed: ${updateError.message}`);
    // ---------------------------------------------------------------------
    // If payment is VERIFIED and belongs to a Facility Booking,
    // create the actual booking now.
    // ---------------------------------------------------------------------
    if (action.toUpperCase() === "VERIFY") {
      // Fetch pending booking request
      const { data: bookingRequest, error: requestError } = await supabase.from("SSP_Facility_Booking_Request").select("*").eq("payment", targetPayment.pay_rec_id).maybeSingle();
      if (requestError) {
        throw new Error(`Booking request lookup failed: ${requestError.message}`);
      }
      if (bookingRequest) {
        // ----------------------------------------------------------
        // Check overlap again
        // ----------------------------------------------------------
        const { data: existingBookings, error: overlapError } = await supabase.from("SSP_Facility_Booking").select("name").eq("facility", bookingRequest.facility).in("approval_status", [
          "approved",
          "pending",
          "requested"
        ]).lt("booking_start_date", bookingRequest.booking_end_date).gt("booking_end_date", bookingRequest.booking_start_date).limit(1);
        if (overlapError) {
          throw new Error(overlapError.message);
        }
        // ----------------------------------------------------------
        // Someone else already booked after paying first
        // ----------------------------------------------------------
        if (existingBookings && existingBookings.length > 0) {
          await supabase.from("SSP_Facility_Booking_Request").update({
            status: "FAILED_SLOT_ALREADY_BOOKED"
          }).eq("request_id", bookingRequest.request_id);
          return buildErrorResponse("SLOT_ALREADY_BOOKED", "Payment has been verified but another resident already booked this slot. Please refund this payment.", 409);
        }
        // ----------------------------------------------------------
        // Create actual booking
        // ----------------------------------------------------------
        const { error: bookingError } = await supabase.from("SSP_Facility_Booking").insert({
          requested_by: bookingRequest.requested_by,
          facility: bookingRequest.facility,
          payment: bookingRequest.payment,
          booking_start_date: bookingRequest.booking_start_date,
          booking_end_date: bookingRequest.booking_end_date,
          purpose_of_visit: bookingRequest.purpose_of_visit,
          is_all_day: bookingRequest.is_all_day,
          booking_status: "requested",
          approval_status: "pending"
        });
        if (bookingError) {
          throw new Error(`Booking creation failed: ${bookingError.message}`);
        }
        // ----------------------------------------------------------
        // Mark booking request completed
        // ----------------------------------------------------------
        const { error: requestUpdateError } = await supabase.from("SSP_Facility_Booking_Request").update({
          status: "BOOKED"
        }).eq("request_id", bookingRequest.request_id);
        if (requestUpdateError) {
          throw new Error(requestUpdateError.message);
        }
      }
    }
    return new Response(JSON.stringify({
      success: true,
      paymentStatus: updateData.payment_status,
      message: action.toUpperCase() === "VERIFY" ? "Payment verified successfully. Facility booking has been created." : "Payment rejected successfully.",
      receipt_url: returnUrl
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return buildErrorResponse('SERVER_ERROR', error.message, 500);
  }
});
function buildErrorResponse(code, message, statusCode) {
  return new Response(JSON.stringify({
    errorResponse: {
      errorCode: code,
      message
    }
  }), {
    status: statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
