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
    // 1. Initial Request Body Structural Validations
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const { societyRegistrationNumber, paymentStatus, searchText } = JSON.parse(bodyText)

    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber is mandatory.', 400)
    }

    const cleanRegNum = String(societyRegistrationNumber).trim()

    // 2. Fetch the Target Society ID Identifier
    const { data: societyRecord, error: societyError } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', cleanRegNum)
      .maybeSingle()

    if (societyError) throw new Error(`SSP_Society lookup failure: ${societyError.message}`)
    if (!societyRecord) {
      return buildErrorResponse('NOT_FOUND', 'No society registration found matching the identifier provided.', 404)
    }

    // 3. Build Dynamic Relational Query Matrix targeting SSP_Payment
    let query = supabase
      .from('SSP_Payment')
      .select(`
  *,
  receipt_url,
  society_user:SSP_Society_User!inner(
    unit_flat_number,
    society,
    contact:SSP_Contact(
      name
    )
  )
`)
      .eq('society_user.society', societyRecord.society_id)
      .ilike('payment_type', '%maintenance%') // <-- ONLY FETCH MAINTENANCE PAYMENTS

    // Dynamic Payment Status Strategy Mapping (Case-Insensitive)
    if (paymentStatus && String(paymentStatus).trim().toUpperCase() !== "ALL") {
      const normalizedStatus = String(paymentStatus).trim().toUpperCase()
      query = query.ilike("payment_status", normalizedStatus)
    }

    // Dynamic Text Search Filter Matrix across Table Keys
    if (searchText && String(searchText).trim() !== '') {
      const term = String(searchText).trim()
      query = query.or(`payment_id.ilike.%${term}%,society_user.unit_flat_number.ilike.%${term}%`)
    }

    // Apply Sorting Order and Caps Pagination Limit 
    query = query.order('created_at', { ascending: false }).limit(500)

    const { data: paymentRecords, error: paymentError } = await query
    if (paymentError) throw new Error(`SSP_Payment processing lookup failed: ${paymentError.message}`)

    // If no records found, return empty payload response container early
    if (!paymentRecords || paymentRecords.length === 0) {
      return new Response(
        JSON.stringify({ payments: { payments: [] }, errorResponse: null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Structure Output back to uniform wrapper definitions
    const paymentDetailsPayload = paymentRecords.map((p: any) => {
      const userContext = p.society_user
      const contactContext = userContext?.contact

      // Construct public image URL ONLY for Maintenance payments
      let clickableImageUrl = 'N/A'
      const isMaintenance = p.payment_type && String(p.payment_type).toLowerCase().includes('maintenance')

      if (isMaintenance && p.receipt_url && p.receipt_url.trim() !== '') {
        clickableImageUrl = p.receipt_url.startsWith('http') 
          ? p.receipt_url 
          : `${supabaseUrl}/storage/v1/object/public/society-documents/${p.receipt_url}`
      }

      return {
        paymentName: p.payment_id ?? 'N/A', 
        amount: p.amount != null ? String(p.amount) : '0',
        dueDate: p.due_date ? String(p.due_date) : null,
        monthPeriod: p.month_period ?? 'N/A',
        paymentDate: p.payment_date ? String(p.payment_date) : null,
        paymentID: p.payment_id ?? 'N/A',
        paymentMethod: p.payment_method ?? 'N/A',
        paymentStatus: p.payment_status ?? 'N/A',
        paymentType: p.payment_type ?? 'N/A',
        receiptInfo: p.receipt_information ?? 'N/A',
        transactionID: p.transaction_id ?? 'N/A',
        residentName: contactContext?.name ?? 'N/A', 
        flatNumber: userContext?.unit_flat_number ?? 'N/A',
        imageUrl: clickableImageUrl,
          rejectionReason: p.rejection_reason ?? null

      }
    })

    return new Response(
      JSON.stringify({
        payments: {
          payments: paymentDetailsPayload
        },
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse(
      'SERVER_ERROR',
      `Data Query Pipeline Failure: ${error.message || 'Fatal crash execution processing fetch payment workflow.'}`,
      500
    )
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
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
import { createClient } from "npm:@supabase/supabase-js@2";
import { Validator } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
// import {
//   getEnv,
//   parseRequestBody,
//   sanitizeString,
//   logger,
//   ApiError,
//   handleError,
// } from "../_shared/utils.ts";
import {
  getEnv,
  parseRequestBody,
  sanitizeString,
  logger,
} from "../_shared/utils.ts";
import { ApiError, handleError } from "../_shared/errors.ts";

interface GetPaymentsPayload {
  societyRegistrationNumber?: string;
  paymentStatus?: string;
  paymentType?: string;
  searchText?: string;
}

interface PaymentRecord {
  payment_id: string;
  amount: number | string | null;
  due_date: string | null;
  month_period: string | null;
  payment_date: string | null;
  payment_method: string | null;
  payment_status: string | null;
  payment_type: string | null;
  receipt_information: string | null;
  receipt_url: string | null;
  transaction_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  society_user?: {
    unit_flat_number: string | null;
    society: string;
    contact?: {
      name: string | null;
    };
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const action = "POST /get-payments-list";

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. AUTHENTICATION
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      throw new ApiError("UNAUTHORIZED", "Invalid or expired session token", 401);
    }

    // 2. PARSE BODY
    const body = await parseRequestBody(req);
    if (!body) {
      throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
    }

    // 3. INPUT VALIDATION
    const validator = new Validator();
    validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");

    if (!validator.isValid()) {
      throw new ApiError("BAD_REQUEST", "Invalid input parameters", 422, validator.getErrors());
    }

    // 4. PAGINATION & QUERY PARAMETERS SETUP
    const url = new URL(req.url);
    const pageStr = url.searchParams.get("page") || "1";
    const limitStr = url.searchParams.get("limit") || "10";

    const { page, limit } = sanitizePagination(pageStr, limitStr);
    const offset = (page - 1) * limit;

    const cleanRegNum = sanitizeString(String(body.societyRegistrationNumber));
    const paymentStatus = body.paymentStatus ? sanitizeString(String(body.paymentStatus)) : null;
    const paymentType = body.paymentType ? sanitizeString(String(body.paymentType)) : null;
    const searchText = body.searchText ? sanitizeString(String(body.searchText)) : null;

    logger.info({ message: `Starting execution for ${action}` });

    // 5. FETCH TARGET SOCIETY ID
    const { data: societyRecord, error: societyError } = await supabase
      .from("SSP_Society")
      .select("society_id")
      .eq("registration_number", cleanRegNum)
      .maybeSingle();

    if (societyError) throw new ApiError("SERVER_ERROR", `SSP_Society lookup failure: ${societyError.message}`, 500);
    if (!societyRecord) {
      throw new ApiError("NOT_FOUND", "No society registration found matching the identifier provided.", 404);
    }

    // 6. DYNAMIC QUERY CONSTRUCTION
    let query = supabase
      .from("SSP_Payment")
      .select(
        `
        *,
        receipt_url,
        society_user:SSP_Society_User!inner(
          unit_flat_number,
          society,
          contact:SSP_Contact(
            name
          )
        )
      `,
        { count: "exact" }
      )
      .eq("society_user.society", societyRecord.society_id);

    // Filter by Payment Status
       // Filter by Payment Status (Exact match, case-insensitive)
    if (paymentStatus && paymentStatus.toUpperCase() !== "ALL") {
      query = query.ilike("payment_status", paymentStatus);
    }

    // Filter by Payment Type (Exact match, case-insensitive)
    if (paymentType && paymentType.toUpperCase() !== "ALL") {
      query = query.ilike("payment_type", paymentType);
    }

    // ============================================
// Search Filter
// Matches:
// 1. Flat number
// 2. Resident name
// 3. Payment ID
// ============================================

if (searchText && searchText.trim() !== "") {
  const cleanSearch = searchText.trim();

  // Find society users matching flat number or resident name
  const { data: matchedUsers, error: matchedUsersError } = await supabase
    .from("SSP_Society_User")
    .select(`
      user_id,
      unit_flat_number,
      contact:SSP_Contact(
        name
      )
    `)
    .eq("society", societyRecord.society_id);

  if (matchedUsersError) {
    throw new ApiError(
      "SERVER_ERROR",
      `Society user search failed: ${matchedUsersError.message}`,
      500,
    );
  }

  // Filter flat number / resident name in TypeScript
  const searchLower = cleanSearch.toLowerCase();

  const matchedUserIds = (matchedUsers || [])
    .filter((user) => {
      const flatNumber = String(user.unit_flat_number ?? "").toLowerCase();
      const residentName = String(user.contact?.name ?? "").toLowerCase();

      return (
        flatNumber.includes(searchLower) ||
        residentName.includes(searchLower)
      );
    })
    .map((user) => user.user_id)
    .filter(Boolean);

  // Search payment ID as well
  const { data: matchedPayments, error: matchedPaymentsError } =
    await supabase
      .from("SSP_Payment")
      .select("payment_id")
      .ilike("payment_id", `%${cleanSearch}%`);

  if (matchedPaymentsError) {
    throw new ApiError(
      "SERVER_ERROR",
      `Payment search failed: ${matchedPaymentsError.message}`,
      500,
    );
  }

  const matchedPaymentIds = (matchedPayments || [])
    .map((p) => p.payment_id)
    .filter(Boolean);

  // Apply search conditions
  if (matchedUserIds.length > 0 && matchedPaymentIds.length > 0) {
    query = query.or(
      `society_user.in.(${matchedUserIds.join(",")}),payment_id.in.(${matchedPaymentIds.join(",")})`,
    );
  } else if (matchedUserIds.length > 0) {
    query = query.in("society_user", matchedUserIds);
  } else if (matchedPaymentIds.length > 0) {
    query = query.in("payment_id", matchedPaymentIds);
  } else {
    // Force no results
    query = query.eq("payment_id", "__NO_MATCH__");
  }
}
    // Apply Sorting & Pagination Range
    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data: paymentRecords, count: totalCount, error: paymentError } = await query;
    if (paymentError) throw new ApiError("SERVER_ERROR", `SSP_Payment processing lookup failed: ${paymentError.message}`, 500);

    // 7. FORMAT OUTPUT PAYLOAD
    const formattedRecords = (paymentRecords as unknown as PaymentRecord[] || []).map((p) => {
      const userContext = p.society_user;
      const contactContext = userContext?.contact;

      /* let clickableImageUrl = "N/A";

      if (p.receipt_url && p.receipt_url.trim() !== "") {
        clickableImageUrl = p.receipt_url.startsWith("http")
          ? p.receipt_url
          : `\({supabaseUrl}/storage/v1/object/public/society-documents/\){p.receipt_url}`;
      } */
           let clickableImageUrl = "N/A";

      if (p.receipt_url && p.receipt_url.trim() !== "") {
        const cleanPath = p.receipt_url.trim();
        
        if (cleanPath.startsWith("http")) {
          // It's already a full URL (like your first record)
          clickableImageUrl = cleanPath;
        } else {
          // It's just a filename, build the full path.
          // Based on your screenshot, the path is always /GZB-1234-ab/financial/
          // We strip any leading slashes from the db value just in case.
          const finalPath = cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath;
          
          // We construct: <supabase_url>/storage/v1/object/public/society-documents/GZB-1234-ab/financial/<filename>
          clickableImageUrl = `${supabaseUrl}/storage/v1/object/public/society-documents/GZB-1234-ab/financial/${finalPath}`;
        }
      }

      return {
        paymentName: p.payment_id ?? "N/A",
        amount: p.amount != null ? String(p.amount) : "0",
        dueDate: p.due_date ? String(p.due_date) : null,
        monthPeriod: p.month_period ?? "N/A",
        paymentDate: p.payment_date ? String(p.payment_date) : null,
        paymentID: p.payment_id ?? "N/A",
        paymentMethod: p.payment_method ?? "N/A",
        paymentStatus: p.payment_status ?? "N/A",
        paymentType: p.payment_type ?? "N/A",
        receiptInfo: p.receipt_information ?? "N/A",
        transactionID: p.transaction_id ?? "N/A",
        residentName: contactContext?.name ?? "N/A",
        flatNumber: userContext?.unit_flat_number ?? "N/A",
        imageUrl: clickableImageUrl,
        rejectionReason: p.rejection_reason ?? null,
      };
    });

    logger.info({ message: `Successfully completed ${action}` });

    return new Response(
      JSON.stringify({
        payments: {
          payments: formattedRecords,
          pagination: {
            page,
            limit,
            totalRecords: totalCount ?? 0,
            totalPages: totalCount ? Math.ceil(totalCount / limit) : 0,
          },
        },
        errorResponse: null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    logger.error({ message: `Error executing ${action}`, details: String(err) });
    return handleError(err);
  }
});