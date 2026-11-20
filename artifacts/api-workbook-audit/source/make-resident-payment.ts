import { createClient } from "npm:@supabase/supabase-js@^2.48.0";
import { Validator } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
import { getEnv, parseRequestBody, sanitizeString, logger, ApiError, handleError, } from "../_shared/utils.ts";
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
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
        }
        const token = authHeader.replace("Bearer ", "");
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authUser) {
            throw new ApiError("UNAUTHORIZED", "Invalid or expired session token", 401);
        }
        const body = await parseRequestBody(req);
        if (!body) {
            throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
        }
        const validator = new Validator();
        validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");
        validator.validateRequired(body.residentId, "residentId");
        validator.validateRequired(body.paymentId, "paymentId");
        if (!validator.isValid()) {
            throw new ApiError("BAD_REQUEST", "societyRegistrationNumber, residentId, and paymentId are mandatory.", 422, validator.getErrors());
        }
        const cleanRegNo = sanitizeString(String(body.societyRegistrationNumber));
        const cleanResidentId = sanitizeString(String(body.residentId));
        const cleanPaymentId = sanitizeString(String(body.paymentId));
        const fileName = body.fileName ? sanitizeString(String(body.fileName)) : null;
        const fileType = body.fileType ? sanitizeString(String(body.fileType)) : null;
        const statusFilter = body.status ? sanitizeString(String(body.status)) : null;
        const url = new URL(req.url);
        const pageStr = url.searchParams.get("page") || "1";
        const limitStr = url.searchParams.get("limit") || "10";
        const pagination = sanitizePagination(pageStr, limitStr);
        const offset = (pagination.page - 1) * pagination.limit;
        logger.info({ message: `Starting execution for ${action}` });
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
        const statusVal = currentPayment.payment_status
            ? String(currentPayment.payment_status).trim().toUpperCase()
            : "";
        const paymentRecordUuid = currentPayment.pay_rec_id;
        const needsUnderReview = statusVal === "UNPAID" || statusVal === "REJECTED" || statusVal === "";
        if (needsUnderReview) {
            const { error: updateErr } = await supabase
                .from("SSP_Payment")
                .update({ payment_status: "UNDER REVIEW" })
                .eq("pay_rec_id", paymentRecordUuid);
            if (updateErr) {
                throw new ApiError("SERVER_ERROR", `Payment status update failed: ${updateErr.message}`, 500);
            }
        }
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
                throw new ApiError("SERVER_ERROR", `Storage URL generation failed: ${storageLinkErr.message}`, 500);
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
                throw new ApiError("SERVER_ERROR", `Document record creation failed: ${docInsertErr.message}`, 500);
            }
            documentUuid = newDoc.document_id;
        }
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
    }
    catch (err) {
        logger.error({ message: `Error executing ${action}`, details: String(err) });
        return handleError(err);
    }
});
