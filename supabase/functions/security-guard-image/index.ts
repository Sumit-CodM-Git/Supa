/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const BUCKET_NAME = 'society-documents'

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
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const requestObj = JSON.parse(bodyText)
    const { 
      operation, 
      societyRegistrationNumber, 
      fileName, 
      fileType, 
      fileSize, 
      documentId, 
      visitorId 
    } = requestObj

    if (!operation) {
      return buildErrorResponse('BAD_REQUEST', 'Operation is mandatory.', 400)
    }

    const normalizedOp = operation.toUpperCase().trim()
    const responsePayload: any = { uploaded: null, fileUrl: null, documentId: null, errorResponse: null }

    // -------------------------------------------------------------------------
    // OPERATION: UPLOAD
    // -------------------------------------------------------------------------
    if (normalizedOp === 'UPLOAD') {
      if (!societyRegistrationNumber || !fileName || !fileType || !visitorId) {
        return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber, visitorId, fileName and fileType are required.', 400)
      }

      // Fetch the non-society visitor profile row matching visitorId
const { data: nonSocietyUser, error: nsuErr } = await supabase
  .from('SSP_Non_Society_User')
  .select('non_society_user_id')
  .eq('non_society_user_id', visitorId.trim()) // 👈 Changed from visitor_id to non_society_user_id
  .maybeSingle()

if (nsuErr || !nonSocietyUser) {
  return buildErrorResponse('NOT_FOUND', 'Visitor profile entry not found.', 404)
}

      // Fetch the society metadata profile linking rule context
      const { data: society, error: socErr } = await supabase
        .from('SSP_Society')
        .select('society_id')
        .eq('registration_number', societyRegistrationNumber.trim())
        .maybeSingle()

      if (socErr || !society) {
        return buildErrorResponse('NOT_FOUND', 'Society configuration mismatch.', 404)
      }

      const cleanFileName = fileName.replace(/\s+/g, '_')
      const uniqueFileName = `${Date.now()}_${cleanFileName}`
      
      // Compute S3 path pattern
      const objectKey = `${societyRegistrationNumber.trim()}/securityGuard/${uniqueFileName}`

      // Create presigned destination allocation target via Supabase Storage
      const { data: uploadUrlData, error: uploadUrlErr } = await supabase
        .storage
        .from(BUCKET_NAME)
        .createSignedUploadUrl(objectKey, { upsert: true })

      if (uploadUrlErr || !uploadUrlData) {
        return buildErrorResponse('STORAGE_ERROR', `Failed generating secure link allocation: ${uploadUrlErr?.message}`, 500)
      }

      const { data: urlInfo } = supabase
        .storage
        .from(BUCKET_NAME)
        .getPublicUrl(objectKey)

      // Insert structural tracking record row directly into SSP_Document
const { data: newDoc, error: insertErr } = await supabase
  .from('SSP_Document')
  .insert({
    name: fileName,
    file_name: fileName,
    file_type: fileType,
    file_size: fileSize ? parseFloat(fileSize) : null,
    document_type: 'Security Guard Image',
    s3_path: urlInfo.publicUrl,
    society: society.society_id,
    non_society_user: nonSocietyUser.non_society_user_id, // 👈 Points to the new relation column cleanly
    uploaded_on: new Date().toISOString()
  })
  .select('document_id')
  .single()

      if (insertErr || !newDoc) {
        return buildErrorResponse('DATABASE_ERROR', `Metadata pipeline tracking fault entry sequence: ${insertErr?.message}`, 500)
      }

      responsePayload.uploaded = true
      responsePayload.fileUrl = uploadUrlData.signedUrl
      responsePayload.documentId = newDoc.document_id

      return buildSuccessResponse(responsePayload)
    }

    // -------------------------------------------------------------------------
    // OPERATION: FETCH
    // -------------------------------------------------------------------------
    else if (normalizedOp === 'FETCH') {
      if (!documentId) {
        return buildErrorResponse('BAD_REQUEST', 'documentId is required.', 400)
      }

      const { data: doc, error: fetchErr } = await supabase
        .from('SSP_Document')
        .select('document_id, s3_path')
        .eq('document_id', documentId)
        .maybeSingle()

      if (fetchErr || !doc || !doc.s3_path) {
        return buildErrorResponse('NOT_FOUND', 'Image index profile mismatch.', 404)
      }

      let viewUrl = ''
      const computedKey = extractStorageKey(doc.s3_path)

      if (computedKey) {
        const { data: signedData } = await supabase
          .storage
          .from(BUCKET_NAME)
          .createSignedUrl(computedKey, 900)
        
        if (signedData) viewUrl = signedData.signedUrl
      }

      responsePayload.fileUrl = viewUrl
      return buildSuccessResponse(responsePayload)
    }

    return buildErrorResponse('BAD_REQUEST', 'Invalid operation.', 400)

  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', `System processing runtime engine exception: ${error.message}`, 500)
  }
})

function extractStorageKey(fullUrl: string): string | null {
  if (!fullUrl) return null
  if (fullUrl.includes(`/${BUCKET_NAME}/`)) {
    return fullUrl.split(`/${BUCKET_NAME}/`)[1].trim()
  }
  if (fullUrl.includes('.amazonaws.com/')) {
    return fullUrl.split('.amazonaws.com/')[1].trim()
  }
  return fullUrl.trim()
}

function buildSuccessResponse(payload: any) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      uploaded: null, fileUrl: null, documentId: null,
      errorResponse: { errorCode: code, message: message, timestamp: new Date().toISOString() }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
const BUCKET_NAME = "society-documents";
const baseLogger = createLogger("security-guard-image");

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
interface SecurityGuardImagePayload {
  operation: "UPLOAD" | "FETCH" | "FETCH_ALL";
  societyRegistrationNumber?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: string | number;
  documentId?: string;
  visitorId?: string;
  // Pagination Parameters
  page?: number | string;
  limit?: number | string;
  // Extended Filter Parameters
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
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
        action: "security_guard_image_start",
        userId: authCtx?.user?.id ?? "unknown",
        method: req.method,
        message: "Security guard image process initialized",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => null);
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      const requestObj: SecurityGuardImagePayload = JSON.parse(bodyText);
      const {
        operation,
        societyRegistrationNumber,
        fileName,
        fileType,
        fileSize,
        documentId,
        visitorId,
        page = 1,
        limit = 10,
        searchTerm,
        startDate,
        endDate,
      } = requestObj;

      if (!operation || operation.trim() === "") {
        return errorResponse("Operation parameter is mandatory.", 400);
      }

      const normalizedOp = operation.toUpperCase().trim();

      // =========================================================================
      // OPERATION: UPLOAD
      // =========================================================================
      if (normalizedOp === "UPLOAD") {
        if (!societyRegistrationNumber || !fileName || !fileType || !visitorId) {
          return errorResponse(
            "Missing required fields: societyRegistrationNumber, visitorId, fileName, and fileType are mandatory.",
            400
          );
        }

        const cleanRegNum = societyRegistrationNumber.trim();
        const cleanVisitorId = visitorId.trim();

        // Fetch non-society visitor profile row matching visitorId
        const { data: nonSocietyUser, error: nsuErr } = await supabaseAdmin
          .from("SSP_Non_Society_User")
          .select("non_society_user_id")
          .eq("non_society_user_id", cleanVisitorId)
          .maybeSingle();

        if (nsuErr || !nonSocietyUser) {
          return errorResponse("Visitor profile entry not found.", 404);
        }

        // Fetch society context
        const { data: society, error: socErr } = await supabaseAdmin
          .from("SSP_Society")
          .select("society_id")
          .eq("registration_number", cleanRegNum)
          .maybeSingle();

        if (socErr || !society) {
          return errorResponse("Target society context not found.", 404);
        }

        const cleanFileName = fileName.trim().replace(/\s+/g, "_");
        const uniqueFileName = `${Date.now()}_${cleanFileName}`;

        // Compute Storage Object Key
        const objectKey = `${cleanRegNum}/securityGuard/${uniqueFileName}`;

        // Create Presigned Signed Upload URL
        const { data: uploadUrlData, error: uploadUrlErr } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .createSignedUploadUrl(objectKey, { upsert: true });

        if (uploadUrlErr || !uploadUrlData) {
          return errorResponse(
            `Failed generating upload link: ${uploadUrlErr?.message}`,
            500
          );
        }

        const { data: urlInfo } = supabaseAdmin.storage
          .from(BUCKET_NAME)
          .getPublicUrl(objectKey);

        // Insert Document Tracking Record
        const { data: newDoc, error: insertErr } = await supabaseAdmin
          .from("SSP_Document")
          .insert({
            name: fileName,
            file_name: fileName,
            file_type: fileType,
            file_size: fileSize ? parseFloat(String(fileSize)) : null,
            document_type: "Security Guard Image",
            s3_path: urlInfo.publicUrl,
            society: society.society_id,
            non_society_user: nonSocietyUser.non_society_user_id,
            uploaded_on: new Date().toISOString(),
          })
          .select("document_id")
          .single();

        if (insertErr || !newDoc) {
          return errorResponse(
            `Failed saving document metadata record: ${insertErr?.message}`,
            500
          );
        }

        logger.info({
          action: "upload_security_guard_image_success",
          documentId: newDoc.document_id,
          visitorId: cleanVisitorId,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          uploaded: true,
          fileUrl: uploadUrlData.signedUrl,
          documentId: newDoc.document_id,
        });
      }

      // =========================================================================
      // OPERATION: FETCH (Single Document)
      // =========================================================================
      else if (normalizedOp === "FETCH") {
        if (!documentId) {
          return errorResponse("documentId parameter is required for FETCH operation.", 400);
        }

        const { data: doc, error: fetchErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id, s3_path")
          .eq("document_id", documentId.trim())
          .maybeSingle();

        if (fetchErr || !doc || !doc.s3_path) {
          return errorResponse("Document record or storage reference not found.", 404);
        }

        let viewUrl = "";
        const computedKey = extractStorageKey(doc.s3_path);

        if (computedKey) {
          const { data: signedData } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(computedKey, 900);

          if (signedData) {
            viewUrl = signedData.signedUrl;
          }
        }

        logger.info({
          action: "fetch_security_guard_image_success",
          documentId,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          uploaded: null,
          fileUrl: viewUrl,
          documentId: doc.document_id,
        });
      }

      // =========================================================================
      // OPERATION: FETCH_ALL (List with Pagination & Filters)
      // =========================================================================
      else if (normalizedOp === "FETCH_ALL") {
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
        const offset = (pageNum - 1) * limitNum;

        let query = supabaseAdmin
          .from("SSP_Document")
          .select(
            `
            document_id,
            name,
            file_name,
            file_type,
            file_size,
            document_type,
            s3_path,
            uploaded_on,
            non_society_user
          `,
            { count: "exact" }
          )
          .eq("document_type", "Security Guard Image");

        if (visitorId && visitorId.trim() !== "") {
          query = query.eq("non_society_user", visitorId.trim());
        }

        if (searchTerm && searchTerm.trim() !== "") {
          query = query.or(
            `name.ilike.%${searchTerm.trim()}%,file_name.ilike.%${searchTerm.trim()}%`
          );
        }

        if (startDate) {
          query = query.gte("uploaded_on", new Date(startDate).toISOString());
        }

        if (endDate) {
          query = query.lte("uploaded_on", new Date(endDate).toISOString());
        }

        const { data: documents, count, error: fetchAllErr } = await query
          .order("uploaded_on", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (fetchAllErr) {
          throw new Error(`Failed listing document records: ${fetchAllErr.message}`);
        }

        const totalRecords = count ?? 0;
        const totalPages = Math.ceil(totalRecords / limitNum);

        // Map and sign URLs for documents
        const processedDocuments = await Promise.all(
          (documents || []).map(async (doc: any) => {
            let signedUrl: string | null = null;
            const computedKey = extractStorageKey(doc.s3_path);

            if (computedKey) {
              const { data: signedData } = await supabaseAdmin.storage
                .from(BUCKET_NAME)
                .createSignedUrl(computedKey, 900);

              if (signedData) {
                signedUrl = signedData.signedUrl;
              }
            }

            return {
              documentId: doc.document_id,
              name: doc.name,
              fileName: doc.file_name,
              fileType: doc.file_type,
              fileSize: doc.file_size,
              uploadedOn: doc.uploaded_on,
              visitorId: doc.non_society_user,
              fileUrl: signedUrl,
            };
          })
        );

        logger.info({
          action: "fetch_all_security_guard_images_success",
          count: processedDocuments.length,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          documents: processedDocuments,
          pagination: {
            currentPage: pageNum,
            pageSize: limitNum,
            totalRecords,
            totalPages,
          },
        });
      }

      return errorResponse(
        "Invalid operation specified. Expected 'UPLOAD', 'FETCH', or 'FETCH_ALL'.",
        400
      );
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "security_guard_image_error",
        error: err.message,
        durationMs: Date.now() - startTime,
      });

      return errorResponse(
        err.message || "Security guard image function processing failed.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null
      );
    }
  })
);

// =============================================================================
// STORAGE RESOURCE HELPER UTIL
// =============================================================================
function extractStorageKey(fullUrl: string): string | null {
  if (!fullUrl) return null;
  if (fullUrl.includes(`/${BUCKET_NAME}/`)) {
    return fullUrl.split(`/${BUCKET_NAME}/`)[1].trim();
  }
  if (fullUrl.includes(".amazonaws.com/")) {
    return fullUrl.split(".amazonaws.com/")[1].trim();
  }
  return fullUrl.trim();
}