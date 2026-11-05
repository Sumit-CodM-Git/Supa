/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const BUCKET_NAME = 'society-documents'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const requestObj = JSON.parse(bodyText)
    const {
      societyRegistrationNumber,
      residentId,     // Corresponds to the string name inside SSP_Contact
      paymentId,      // Corresponds to the text string inside payment_id column
      fileName,
      fileType,
      fileSize
    } = requestObj

    if (!societyRegistrationNumber) {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber is mandatory', 400)
    }

    // 1. Resolve Society Context
    const { data: societyContext, error: socErr } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', String(societyRegistrationNumber).trim())
      .maybeSingle()

    if (!societyContext || socErr) {
      return buildErrorResponse('NOT_FOUND', 'Target society environment reference not found.', 404)
    }
    const societyId = societyContext.society_id

// 2. Validate Resident Access via direct primary user_id UUID matching
const { data: residentRecord, error: resErr } = await supabase
  .from('SSP_Society_User')
  .select('user_id')
  .eq('society', societyId)
  .eq('user_id', residentId) // Changed from contact.name to user_id matching
  .maybeSingle()

if (!residentRecord || resErr) {
  return buildErrorResponse('NOT_FOUND', 'Resident records match not found within society.', 404)
}

    // 3. Verify target payment item record via text field payment_id matching
    const { data: currentPayment, error: payErr } = await supabase
      .from('SSP_Payment') 
      .select('pay_rec_id, payment_status')
      .eq('payment_id', paymentId) // Filters on tracking invoice string name (e.g. INV-2026-0089)
      .maybeSingle()

    if (!currentPayment || payErr) {
      return buildErrorResponse('NOT_FOUND', 'Target payment record profile instance not found.', 404)
    }

    // 4. State transition verification
    const statusVal = currentPayment.payment_status ? String(currentPayment.payment_status).trim().toUpperCase() : ''
    const paymentRecordUuid = currentPayment.pay_rec_id

    if (statusVal === 'UNPAID' || statusVal === 'REJECTED' || statusVal === '') {
      const { error: updateErr } = await supabase
        .from('SSP_Payment')
        .update({ payment_status: 'UNDER REVIEW' })
        .eq('pay_rec_id', paymentRecordUuid)

      if (updateErr) throw updateErr
    }

    let uploadPresignedUrl = null
    let documentUuid = null

    // 5. Handle File Upload Metadata Preparation if data exists
    if (fileName && fileName.trim() !== '' && fileType) {
      const cleanFileName = String(fileName).trim().replace(/\s+/g, '_')
      const uniqueFileName = `${Date.now()}_${cleanFileName}`
      
      const targetObjectKey = `${societyRegistrationNumber}/Financial/${uniqueFileName}`

      // Create pre-signed upload URL from Supabase Storage
      const { data: uploadPayload, error: storageLinkErr } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUploadUrl(targetObjectKey)

      if (storageLinkErr) throw storageLinkErr
      uploadPresignedUrl = uploadPayload?.signedUrl

      const fullS3Path = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${targetObjectKey}`

      // Save document link metadata to database (uses internal UUID key reference)
      const { data: newDoc, error: docInsertErr } = await supabase
        .from('SSP_Document')
        .insert({
          name: fileName,
          document_type: 'Financial',
          s3_path: fullS3Path,
          payment: paymentRecordUuid, // references your internal primary key pay_rec_id
          society: societyId
        })
        .select('document_id')
        .single()

      if (docInsertErr) throw docInsertErr
      documentUuid = newDoc.document_id
    }

    // 6. Return Structured Success Signature Object
    return new Response(
      JSON.stringify({
        paymentSubmission: { submitted: true },
        errorResponse: null,
        uploadUrl: uploadPresignedUrl,
        documentId: documentUuid
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', error.message || 'Fatal payment orchestration fault exception thread.', 500)
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      paymentSubmission: null,
      uploadUrl: null,
      documentId: null,
      errorResponse: { errorCode: code, message: message, timestamp: new Date().toISOString() }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/

import { createClient } from "npm:@supabase/supabase-js@^2.48.0";
import { Validator } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
import {
  getEnv,
  parseRequestBody,
  sanitizeString,
  logger,
  ApiError,
  handleError,
} from "../_shared/utils.ts";

const BUCKET_NAME = "society-documents";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const action = "POST /make-resident-payment";

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

    // 2. PARSE REQUEST BODY
    const body = await parseRequestBody(req);
    if (!body) {
      throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
    }

    // 3. INPUT VALIDATION
    const validator = new Validator();
    validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");
    validator.validateRequired(body.residentId, "residentId");
    validator.validateRequired(body.paymentId, "paymentId");

    if (!validator.isValid()) {
      throw new ApiError(
        "BAD_REQUEST",
        "societyRegistrationNumber, residentId, and paymentId are mandatory.",
        422,
        validator.getErrors()
      );
    }

    const cleanRegNo = sanitizeString(String(body.societyRegistrationNumber));
    const cleanResidentId = sanitizeString(String(body.residentId));
    const cleanPaymentId = sanitizeString(String(body.paymentId));
    const fileName = body.fileName ? sanitizeString(String(body.fileName)) : null;
    const fileType = body.fileType ? sanitizeString(String(body.fileType)) : null;
    const statusFilter = body.status ? sanitizeString(String(body.status)) : null;

    // 4. PAGINATION & SEARCH PARAMS
    const url = new URL(req.url);
    const pageStr = url.searchParams.get("page") || "1";
    const limitStr = url.searchParams.get("limit") || "10";
    const pagination = sanitizePagination(pageStr, limitStr);
    const offset = (pagination.page - 1) * pagination.limit;

    logger.info({ message: `Starting execution for ${action}` });

    // 5. STEP A: RESOLVE SOCIETY CONTEXT
    const { data: societyContext, error: socError } = await supabase
      .from("SSP_Society")
      .select("society_id, society_name, city, state, postal_code")
      .eq("registration_number", cleanRegNo)
      .maybeSingle();

    if (socError) {
      throw new ApiError("SERVER_ERROR", `Society lookup failed: ${socError.message}`, 500);
    }
    if (!societyContext) {
      throw new ApiError("NOT_FOUND", "Target society environment reference not found.", 404);
    }

    const societyId = societyContext.society_id;

    // 6. STEP B: VALIDATE RESIDENT ACCESS
    const { data: residentRecord, error: resError } = await supabase
      .from("SSP_Society_User")
      .select("user_id")
      .eq("society", societyId)
      .eq("user_id", cleanResidentId)
      .maybeSingle();

    if (resError) {
      throw new ApiError("SERVER_ERROR", `Resident verification failed: ${resError.message}`, 500);
    }
    if (!residentRecord) {
      throw new ApiError("NOT_FOUND", "Resident records match not found within society.", 404);
    }

    // 7. STEP C: VERIFY TARGET PAYMENT ITEM RECORD (WITH OPTIONAL FILTER & PAGINATION)
    let paymentQuery = supabase
      .from("SSP_Payment")
      .select("pay_rec_id, payment_id, payment_status, amount", { count: "exact" })
      .eq("payment_id", cleanPaymentId);

   if (statusFilter) {
  paymentQuery = paymentQuery.ilike("payment_status", statusFilter);
}

    paymentQuery = paymentQuery.range(offset, offset + pagination.limit - 1);

    const { data: paymentRecords, count: totalRecords, error: payError } = await paymentQuery;

    if (payError) {
      throw new ApiError("SERVER_ERROR", `Target payment query failed: ${payError.message}`, 500);
    }
    if (!paymentRecords || paymentRecords.length === 0) {
      throw new ApiError("NOT_FOUND", "Target payment record profile instance not found.", 404);
    }

    const currentPayment = paymentRecords[0];

    // 8. STATE TRANSITION VERIFICATION
    const statusVal = currentPayment.payment_status
      ? String(currentPayment.payment_status).trim().toUpperCase()
      : "";
    const paymentRecordUuid = currentPayment.pay_rec_id;

    const needsUnderReview =
      statusVal === "UNPAID" || statusVal === "REJECTED" || statusVal === "";

    if (needsUnderReview) {
      const { error: updateErr } = await supabase
        .from("SSP_Payment")
        .update({ payment_status: "UNDER REVIEW" })
        .eq("pay_rec_id", paymentRecordUuid);

      if (updateErr) {
        throw new ApiError("SERVER_ERROR", `Payment status update failed: ${updateErr.message}`, 500);
      }
    }

    // 9. FILE UPLOAD METADATA PREPARATION
    let uploadPresignedUrl: string | null = null;
    let documentUuid: string | null = null;

    if (fileName && fileType) {
      const cleanFileName = fileName.replace(/\s+/g, "_");
      const uniqueFileName = `${Date.now()}_${cleanFileName}`;
      const targetObjectKey = `${cleanRegNo}/Financial/${uniqueFileName}`;

      const { data: uploadPayload, error: storageLinkErr } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUploadUrl(targetObjectKey);

      if (storageLinkErr) {
        throw new ApiError(
          "SERVER_ERROR",
          `Storage URL generation failed: ${storageLinkErr.message}`,
          500
        );
      }

      uploadPresignedUrl = uploadPayload?.signedUrl ?? null;
      const fullS3Path = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${targetObjectKey}`;

      const { data: newDoc, error: docInsertErr } = await supabase
        .from("SSP_Document")
        .insert({
          name: fileName,
          document_type: "Financial",
          s3_path: fullS3Path,
          payment: paymentRecordUuid,
          society: societyId,
        })
        .select("document_id")
        .single();

      if (docInsertErr) {
        throw new ApiError(
          "SERVER_ERROR",
          `Document record creation failed: ${docInsertErr.message}`,
          500
        );
      }

      documentUuid = newDoc.document_id;
    }

    // 10. CONSTRUCT RESPONSE PAYLOAD
    const responsePayload = {
      paymentSubmission: {
        submitted: true,
        paymentRecordId: paymentRecordUuid,
        status: needsUnderReview ? "UNDER REVIEW" : statusVal,
      },
      uploadUrl: uploadPresignedUrl,
      documentId: documentUuid,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        retrievedRecords: paymentRecords.length,
        totalRecords: totalRecords ?? paymentRecords.length,
      },
      errorResponse: null,
    };

    logger.info({ message: `Successfully completed ${action}` });

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error({ message: `Error executing ${action}`, details: String(err) });
    return handleError(err);
  }
});