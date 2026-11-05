import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  try {
    const bodyText = await req.text();
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400);
    }
    const requestObj = JSON.parse(bodyText);
    const { societyRegistrationNumber, residentId } = requestObj;
    if (!societyRegistrationNumber || !residentId) {
      return buildErrorResponse('BAD_REQUEST', 'Society Registration Number and residentId are mandatory fields.', 400);
    }
    const cleanResidentId = residentId.trim();
    //==========================================================
    // Fetch Facility Bookings
    //==========================================================
    const { data: bookingsList, error: dbErr } = await supabase.from('SSP_Facility_Booking').select(`
        name,
        booking_status,
        booking_start_date,
        booking_end_date,
        payment_status,
        capacity,
        purpose_of_visit,
        facility,
        SSP_Facility!facility(
          id,
          name
        )
      `).eq('requested_by', cleanResidentId);
    if (dbErr) {
      return buildErrorResponse('DATABASE_ERROR', `Failed to retrieve records: ${dbErr.message}`, 500);
    }
    //==========================================================
    // Collect Facility IDs
    //==========================================================
    const facilityIds = (bookingsList || []).map((bk)=>bk.facility).filter(Boolean);
    //==========================================================
    // Payment Map
    //==========================================================
    const paymentMap = new Map();
    if (facilityIds.length > 0) {
      const { data: payments, error: payErr } = await supabase.from('SSP_Payment').select(`
          pay_rec_id,
          facility,
          payment_method,
          payment_status
        `).eq('society_user', cleanResidentId).in('facility', facilityIds).order('created_at', {
        ascending: false
      });
      if (payErr) {
        console.error(payErr);
      }
      if (payments) {
        payments.forEach((pay)=>{
          if (pay.facility && !paymentMap.has(pay.facility)) {
            paymentMap.set(pay.facility, {
              payRecId: pay.pay_rec_id,
              paymentMethod: pay.payment_method ?? null,
              paymentStatus: pay.payment_status ?? null
            });
          }
        });
      }
    }
    //==========================================================
    // Final Response
    //==========================================================
    const formattedFacilities = (bookingsList || []).map((bk)=>({
        facilityName: bk.SSP_Facility?.name ?? null,
        bookingStatus: bk.booking_status ?? null,
        startDateTime: bk.booking_start_date ?? null,
        endDateTime: bk.booking_end_date ?? null,
        paymentStatus: paymentMap.get(bk.facility) ? paymentMap.get(bk.facility)?.paymentStatus : bk.payment_status === "approved" || bk.payment_status === "rejected" ? bk.payment_status : null,
        paymentMethod: paymentMap.get(bk.facility)?.paymentMethod ?? null,
        capacity: bk.capacity ? parseFloat(bk.capacity) : null,
        purpose: bk.purpose_of_visit ?? null,
        facilityBookingId: bk.name ?? null,
        payRecId: paymentMap.get(bk.facility)?.payRecId ?? null
      }));
    return new Response(JSON.stringify({
      facilities: formattedFacilities,
      errorResponse: null
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return buildErrorResponse("DATABASE_ERROR", `Failed to retrieve records: ${error.message}`, 500);
  }
});
function buildErrorResponse(code, message, statusCode) {
  return new Response(JSON.stringify({
    facilities: [],
    errorResponse: {
      errorCode: code,
      message: message,
      timestamp: new Date().toISOString()
    }
  }), {
    status: statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
