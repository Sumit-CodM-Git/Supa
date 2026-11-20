import { loadResidentFacilityBookings, formatResidentFacilityBooking } from "../_shared/resident-facility-bookings.ts";
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
    const { data: resident, error: residentError } = await supabase
      .from('SSP_Society_User')
      .select('user_id, society:SSP_Society!inner(registration_number)')
      .eq('user_id', cleanResidentId)
      .ilike('society.registration_number', String(societyRegistrationNumber).trim())
      .maybeSingle();
    if (residentError) throw residentError;
    if (!resident) return buildErrorResponse('NOT_FOUND', 'Resident not found in this society.', 404);

    const bookingsList = await loadResidentFacilityBookings(supabase, cleanResidentId);
    const formattedFacilities = bookingsList.map(formatResidentFacilityBooking);
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
    return buildErrorResponse("DATABASE_ERROR", `Failed to retrieve records: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
});
function buildErrorResponse(code: string, message: string, statusCode: number) {
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
