/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req: Request) => {
  // Handle Preflight CORS Requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Initial Request Body Structural Validations
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const requestObj = JSON.parse(bodyText)
    const { societyRegistrationNumber, residentId } = requestObj

    // Mandatory Parameters Validation
    if (!societyRegistrationNumber?.trim() || !residentId?.trim()) {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber and residentId are mandatory.', 400)
    }

    const cleanRegNo = societyRegistrationNumber.trim()
    const cleanResidentId = residentId.trim()

    // 2. Locate Society Profile via unique registration number
    const { data: societyContext, error: socError } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', cleanRegNo)
      .maybeSingle()

    if (socError) throw new Error(`SSP_Society verification step failed: ${socError.message}`)
    if (!societyContext) {
      return buildErrorResponse('NOT_FOUND', 'Resident not found.', 404)
    }

    // 3. Identify the Resident (Society User) using the fallback matrix
    let userQuery = supabase
      .from('SSP_Society_User')
      .select(`
        user_id,
        contact:SSP_Contact!inner(contact_id, name)
      `)
      .eq('society', societyContext.society_id)

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidRegex.test(cleanResidentId)) {
      userQuery = userQuery.or(`user_id.eq.${cleanResidentId},contact.eq.${cleanResidentId}`)
    } else {
      userQuery = userQuery.ilike('contact.name', `%${cleanResidentId}%`)
    }

    const { data: userRecords, error: userError } = await userQuery

    if (userError) throw new Error(`Resident processing query failed: ${userError.message}`)
    if (!userRecords || userRecords.length === 0) {
      return buildErrorResponse('NOT_FOUND', 'Resident not found.', 404)
    }

    const targetUserId = userRecords[0].user_id

    // 4. Fetch Payments Ledger with related Facility info
    const { data: pendingList, error: paymentError } = await supabase
      .from('SSP_Payment')
      .select(`
        pay_rec_id,
        amount,
        due_date,
        month_period,
        payment_id,
        payment_status,
        payment_type,
        facility:SSP_Facility(id)
      `)
      .eq('society_user', targetUserId)
      .order('due_date', { ascending: true })

    if (paymentError) throw new Error(`Payments index collection failed: ${paymentError.message}`)

    const rawPayments = pendingList ?? []

    // 5. Calculate Total Dues & Total Paid with sanitized status check
    const totalDues = rawPayments.reduce((acc: number, p: any) => {
      const status = (p.payment_status ?? '').trim().toLowerCase()
      if (['pending', 'due', 'unpaid', 'overdue'].includes(status)) {
        return acc + Number(p.amount ?? 0)
      }
      return acc
    }, 0)

    const totalPaidAmount = rawPayments.reduce((acc: number, p: any) => {
      const status = (p.payment_status ?? '').trim().toLowerCase()
      if (['paid', 'completed', 'success'].includes(status)) {
        return acc + Number(p.amount ?? 0)
      }
      return acc
    }, 0)

    // 6. Map result list to align with DTO Response contracts
    const mappedPayments = rawPayments.map((p: any) => {
      const descriptionText = (p.payment_type === 'Facility Booking' && p.facility)
        ? `Booking for Facility Context ID: ${p.facility.id}`
        : (p.payment_type ?? '').trim()

      return {
        paymentRecordName: (p.payment_id ?? 'N/A').trim(),
        amount: p.amount ?? 0,
        dueDate: p.due_date ?? '',
        monthPeriod: (p.month_period ?? '').trim(),
        customPaymentId: (p.pay_rec_id ?? '').trim(),
        status: (p.payment_status ?? '').trim(),
        type: (p.payment_type ?? '').trim(),
        description: descriptionText
      }
    })

    // 7. Return standard structured payload with totals included
    return new Response(
      JSON.stringify({
        totalDues: totalDues,
        totalPaidAmount: totalPaidAmount,
        payments: mappedPayments,
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse(
      'SERVER_ERROR',
      error.message || 'Fatal execution runtime context interruption.',
      500
    )
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      totalDues: 0,
      totalPaidAmount: 0,
      payments: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString()
      }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/
import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const {
        societyRegistrationNumber,
        status,
        paymentType,
        search,
        page = 1,
        limit = 10,
      } = body;

      // 1. Mandatory Input Validation
      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanRegNo = String(societyRegistrationNumber).trim();
      const pageNum = Math.max(1, parseInt(String(page)) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));
      const offset = (pageNum - 1) * limitNum;

      // 2. Resolve Target Society
      const { data: societyContext, error: socError } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", cleanRegNo)
        .maybeSingle();

      if (socError) throw new Error(`SSP_Society verification failed: ${socError.message}`);
      if (!societyContext) {
        return errorResponse("Society not found.", 404);
      }

      // 3. Authenticate & Resolve Resident Context
      const { data: resident, error: residentError } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", authCtx.user.id)
        .eq("society", societyContext.society_id)
        .maybeSingle();

      if (residentError) throw new Error(`Resident lookup failed: ${residentError.message}`);
      if (!resident) {
        return errorResponse("Authenticated user is not an active resident of this society.", 403);
      }

      const targetUserId = resident.user_id;

      // 4. Calculate Global Totals (All ledger records for this resident)
      const { data: allLedger, error: ledgerErr } = await supabaseAdmin
        .from("SSP_Payment")
        .select("amount, payment_status")
        .eq("society_user", targetUserId);

      if (ledgerErr) throw ledgerErr;

      const rawLedger = allLedger ?? [];
      const totalDues = rawLedger.reduce((acc: number, p: any) => {
        const st = (p.payment_status ?? "").trim().toLowerCase();
        if (["pending", "due", "unpaid", "overdue"].includes(st)) {
          return acc + Number(p.amount ?? 0);
        }
        return acc;
      }, 0);

      const totalPaidAmount = rawLedger.reduce((acc: number, p: any) => {
        const st = (p.payment_status ?? "").trim().toLowerCase();
        if (["paid", "completed", "success"].includes(st)) {
          return acc + Number(p.amount ?? 0);
        }
        return acc;
      }, 0);

      // 5. Build Filtered Query
      let countQuery = supabaseAdmin
        .from("SSP_Payment")
        .select("pay_rec_id", { count: "exact", head: true })
        .eq("society_user", targetUserId);

      let dataQuery = supabaseAdmin
        .from("SSP_Payment")
        .select(`
          pay_rec_id,
          amount,
          due_date,
          month_period,
          payment_id,
          payment_status,
          payment_type,
          facility:SSP_Facility(id)
        `)
        .eq("society_user", targetUserId);

      // Apply Filters
      if (status && String(status).trim() !== "") {
        const cleanStatus = String(status).trim();
        countQuery = countQuery.ilike("payment_status", cleanStatus);
        dataQuery = dataQuery.ilike("payment_status", cleanStatus);
      }

      if (paymentType && String(paymentType).trim() !== "") {
        const cleanType = String(paymentType).trim();
        countQuery = countQuery.ilike("payment_type", cleanType);
        dataQuery = dataQuery.ilike("payment_type", cleanType);
      }

     if (search && String(search).trim() !== "") {
  const searchTerm = `%${String(search).trim()}%`;
  
  // Searches across payment_id, payment_type, month_period, and payment_status
  const searchFilter = `payment_id.ilike.${searchTerm},payment_type.ilike.${searchTerm},month_period.ilike.${searchTerm},payment_status.ilike.${searchTerm}`;
  
  countQuery = countQuery.or(searchFilter);
  dataQuery = dataQuery.or(searchFilter);
}

      // Execute Count
      const { count: filteredTotal, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      // Fetch Paginated Results
      const { data: pendingList, error: paymentError } = await dataQuery
        .order("due_date", { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (paymentError) throw new Error(`Payments query failed: ${paymentError.message}`);

      const rawPayments = pendingList ?? [];

      // 6. Map DTO Response
      const mappedPayments = rawPayments.map((p: any) => {
        const descriptionText =
          p.payment_type === "Facility Booking" && p.facility
            ? `Booking for Facility Context ID: ${p.facility.id}`
            : (p.payment_type ?? "").trim();

        return {
          customPaymentId: (p.pay_rec_id ?? "").trim(),
          paymentRecordName: (p.payment_id ?? "N/A").trim(),
          amount: p.amount ? Number(p.amount) : 0,
          dueDate: p.due_date ?? "",
          monthPeriod: (p.month_period ?? "").trim(),
          status: (p.payment_status ?? "").trim(),
          type: (p.payment_type ?? "").trim(),
          description: descriptionText,
        };
      });

      // 7. Success Response
      return successResponse({
        totalDues,
        totalPaidAmount,
        pagination: {
          totalCount: filteredTotal || 0,
          currentPage: pageNum,
          limit: limitNum,
          totalPages: Math.ceil((filteredTotal || 0) / limitNum),
        },
        payments: mappedPayments,
      });

    } catch (error: any) {
      console.error("❌ view-resident-payments error:", error);
      return errorResponse(
        error.message || "Unable to process payment ledger request.",
        500
      );
    }
  }),
);