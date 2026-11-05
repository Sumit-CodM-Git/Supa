// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'POST, OPTIONS'
// };
// const BUCKET_NAME = 'society-documents';
// const MAX_IMAGES_LIMIT = 4;
// serve(async (req)=>{
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', {
//       headers: corsHeaders
//     });
//   }
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400);
//     }
//     const requestObj = JSON.parse(bodyText);
//     const { operation, societyRegistrationNumber, complaintId, documentType, files, isUploaded, documentId } = requestObj;
//     if (!operation) {
//       return buildErrorResponse('BAD_REQUEST', 'Operation is mandatory.', 400);
//     }
//     const normalizedOp = operation.toUpperCase().trim();
//     const responsePayload = {
//       uploaded: null,
//       uploadUrls: null,
//       documentIds: null,
//       document: null,
//       errorResponse: null
//     };
//     // Validate matching context for operations requiring a complaint profile
//     let complaintEntry = null;
//     if (complaintId) {
//       const { data: compData, error: compErr } = await supabase.from('SSP_Complaint').select('complaint_id').eq('complaint_id', complaintId.trim()).maybeSingle();
//       if (compErr || !compData) {
//         return buildErrorResponse('NOT_FOUND', 'Complaint profile record match not found.', 404);
//       }
//       complaintEntry = compData;
//     }
//     // -------------------------------------------------------------------------
//     // OPERATION: UPLOAD (Supports Array of up to 4 files)
//     // -------------------------------------------------------------------------
//     if (normalizedOp === 'UPLOAD') {
//       if (!societyRegistrationNumber || !documentType || !complaintId || !Array.isArray(files) || files.length === 0) {
//         return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber, documentType, complaintId, and a valid files array are required.', 400);
//       }
//       if (files.length > MAX_IMAGES_LIMIT) {
//         return buildErrorResponse('BAD_REQUEST', `You can upload a maximum of ${MAX_IMAGES_LIMIT} images at a time.`, 400);
//       }
//       // Step A: Requesting Presigned Links Array (isUploaded === false)
//       if (isUploaded === false || isUploaded === "false") {
//         const uploadUrlsList = [];
//         const prefix = documentType === 'Before Complaint Image' ? 'before_' : 'after_';
//         const compIdClean = complaintId.trim().replace(/\s+/g, '_');
//         for(let i = 0; i < files.length; i++){
//           const file = files[i];
//           if (!file.fileName || !file.fileType) {
//             return buildErrorResponse('BAD_REQUEST', `File at index ${i} is missing fileName or fileType.`, 400);
//           }
//           const cleanFileName = file.fileName.replace(/\s+/g, '_');
//           const uniqueFileName = `${Date.now()}_${i}_${cleanFileName}`;
//           const calculatedKey = `${societyRegistrationNumber.trim()}/complaints/${compIdClean}/${prefix}${uniqueFileName}`;
//           const { data: uploadUrlData, error: uploadUrlErr } = await supabase.storage.from(BUCKET_NAME).createSignedUploadUrl(calculatedKey, {
//             upsert: true
//           });
//           if (uploadUrlErr || !uploadUrlData) {
//             return buildErrorResponse('STORAGE_ERROR', `Failed generating secure link for ${file.fileName}: ${uploadUrlErr?.message}`, 500);
//           }
//           uploadUrlsList.push({
//             fileName: file.fileName,
//             fileUrl: uploadUrlData.signedUrl,
//             objectKey: calculatedKey
//           });
//         }
//         responsePayload.uploadUrls = uploadUrlsList;
//         responsePayload.uploaded = false;
//         return buildSuccessResponse(responsePayload);
//       } else {
//         const { data: society, error: socErr } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', societyRegistrationNumber.trim()).maybeSingle();
//         if (socErr || !society) {
//           return buildErrorResponse('NOT_FOUND', 'Society entity path link validation missing.', 404);
//         }
//         const insertedDocumentIds = [];
//         for(let i = 0; i < files.length; i++){
//           const file = files[i];
//           if (!file.objectKey || !file.fileName || !file.fileType) {
//             return buildErrorResponse('BAD_REQUEST', `File at index ${i} is missing objectKey, fileName, or fileType.`, 400);
//           }
//           const { data: urlInfo } = supabase.storage.from(BUCKET_NAME).getPublicUrl(file.objectKey);
//           const { data: newDoc, error: insertErr } = await supabase.from('SSP_Document').insert({
//             name: file.fileName,
//             file_name: file.fileName,
//             file_type: file.fileType,
//             file_size: file.fileSize ? parseFloat(file.fileSize) : null,
//             document_type: documentType,
//             s3_path: urlInfo.publicUrl,
//             society: society.society_id,
//             complaint: complaintEntry?.complaint_id,
//             uploaded_on: new Date().toISOString()
//           }).select('document_id').single();
//           if (insertErr || !newDoc) {
//             return buildErrorResponse('DATABASE_ERROR', `Metadata pipeline insert fault for ${file.fileName}: ${insertErr?.message}`, 500);
//           }
//           insertedDocumentIds.push(newDoc.document_id);
//         }
//         responsePayload.documentIds = insertedDocumentIds;
//         responsePayload.uploaded = true;
//         return buildSuccessResponse(responsePayload);
//       }
//     } else if (normalizedOp === 'FETCH') {
//       if (!documentId || !complaintId) {
//         return buildErrorResponse('BAD_REQUEST', 'complaintId and documentId are required.', 400);
//       }
//       const { data: doc, error: fetchErr } = await supabase.from('SSP_Document').select('document_id, name, s3_path').eq('document_id', documentId).eq('complaint', complaintEntry?.complaint_id).maybeSingle();
//       if (fetchErr || !doc || !doc.s3_path) {
//         return buildErrorResponse('NOT_FOUND', 'Image not found.', 404);
//       }
//       let viewUrl = '';
//       const computedKey = extractStorageKey(doc.s3_path);
//       if (computedKey) {
//         const { data: signedData } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(computedKey, 900);
//         if (signedData) viewUrl = signedData.signedUrl;
//       }
//       responsePayload.document = {
//         documentId: doc.document_id,
//         documentName: doc.name,
//         fileUrl: viewUrl
//       };
//       return buildSuccessResponse(responsePayload);
//     }
//     return buildErrorResponse('BAD_REQUEST', 'Invalid operation.', 400);
//   } catch (error) {
//     return buildErrorResponse('SERVER_ERROR', `System processing runtime engine exception: ${error.message}`, 500);
//   }
// });
// function extractStorageKey(fullUrl) {
//   if (!fullUrl) return null;
//   if (fullUrl.includes(`/${BUCKET_NAME}/`)) {
//     return fullUrl.split(`/${BUCKET_NAME}/`)[1].trim();
//   }
//   if (fullUrl.includes('.amazonaws.com/')) {
//     return fullUrl.split('.amazonaws.com/')[1].trim();
//   }
//   return fullUrl.trim();
// }
// function buildSuccessResponse(payload) {
//   return new Response(JSON.stringify(payload), {
//     status: 200,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }
// function buildErrorResponse(code, message, statusCode) {
//   return new Response(JSON.stringify({
//     uploaded: null,
//     uploadUrls: null,
//     documentIds: null,
//     document: null,
//     errorResponse: {
//       errorCode: code,
//       message: message,
//       timestamp: new Date().toISOString()
//     }
//   }), {
//     status: statusCode,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }

// ============================================
// complaint-images - Manage Complaint Images (Before & After for Staff)
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import {
  generateId,
  getCurrentTimestamp,
  logger,
  sanitizeString,
} from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

type ImageOperation = "UPLOAD" | "FETCH" | "DELETE";
type ImageType = "BEFORE" | "AFTER";

interface FileInput {
  fileName: string;
  fileType: string;
  fileSize?: number | string;
  objectKey?: string;
}

interface ComplaintImagesRequest {
  operation: ImageOperation;
  societyRegistrationNumber?: string;
  complaintId?: string;
  documentType?: ImageType;
  files?: FileInput[];
  isUploaded?: boolean | string;
  documentId?: string;
}

interface UploadUrlResponse {
  fileName: string;
  fileUrl: string;
  objectKey: string;
}

interface DocumentResponse {
  documentId: string;
  documentName: string;
  fileUrl: string;
  fileType: string | null;
  fileSize: number | null;
  uploadedAt: string;
}

interface ComplaintImagesResponse {
  uploaded: boolean | null;
  uploadUrls: UploadUrlResponse[] | null;
  documentIds: string[] | null;
  document: DocumentResponse | null;
  deleted?: boolean;
  message?: string;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_IMAGES_LIMIT = 5;
const SIGNED_URL_EXPIRY = 900; // 15 minutes

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extract storage key from full URL
 */
function extractStorageKey(fullUrl: string): string | null {
  if (!fullUrl) return null;

  const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;
  if (fullUrl.includes(marker)) {
    return fullUrl.split(marker)[1].trim();
  }

  if (fullUrl.includes(".amazonaws.com/")) {
    const parts = fullUrl.split(".amazonaws.com/");
    if (parts.length > 1) {
      const pathParts = parts[1].split("/");
      if (pathParts[0] === BUCKET_NAME) {
        return pathParts.slice(1).join("/");
      }
      return pathParts.join("/");
    }
  }

  return fullUrl.trim();
}

/**
 * Validate document type (only BEFORE and AFTER)
 */
function validateDocumentType(documentType: string): documentType is ImageType {
  const validTypes: ImageType[] = ["BEFORE", "AFTER"];
  return validTypes.includes(documentType as ImageType);
}

/**
 * Get document type prefix for storage
 */
function getDocumentTypePrefix(documentType: ImageType): string {
  const prefixes: Record<ImageType, string> = {
    BEFORE: "before_",
    AFTER: "after_",
  };
  return prefixes[documentType] || "image_";
}

/**
 * Get document type display name
 */
function getDocumentTypeDisplay(documentType: ImageType): string {
  const display: Record<ImageType, string> = {
    BEFORE: "Before Image",
    AFTER: "After Image",
  };
  return display[documentType] || documentType;
}

/**
 * Validate staff authorization for upload
 */
async function validateStaffAuthorization(
  complaintId: string,
  staffId: string,
  staffType: "SERVICE_AGENT" | "VENDOR",
): Promise<{ authorized: boolean; message?: string }> {
  try {
    const { data: complaint, error } = await supabaseAdmin
      .from("SSP_Complaint")
      .select("assigned_agent, non_society_user")
      .eq("complaint_id", complaintId)
      .maybeSingle();

    if (error) {
      return { authorized: false, message: error.message };
    }

    if (!complaint) {
      return { authorized: false, message: "Complaint not found" };
    }

    if (staffType === "SERVICE_AGENT") {
      if (complaint.assigned_agent !== staffId) {
        return {
          authorized: false,
          message: "You are not assigned to this complaint",
        };
      }
    } else if (staffType === "VENDOR") {
      if (complaint.non_society_user !== staffId) {
        return {
          authorized: false,
          message: "You are not assigned to this complaint",
        };
      }
    }

    return { authorized: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return { authorized: false, message: errorMessage };
  }
}

/**
 * Get staff type from user
 */
async function getStaffType(
  userId: string,
): Promise<"SERVICE_AGENT" | "VENDOR" | null> {
  // Check if Service Agent
  const { data: userRole, error: roleErr } = await supabaseAdmin
    .from("SSP_Society_User")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!roleErr && userRole) {
    const roles = userRole.role || [];
    if (roles.includes("service_agent")) {
      return "SERVICE_AGENT";
    }
  }

  // Check if Vendor
  const { data: vendorData } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .select("non_society_user_id")
    .eq("non_society_user_id", userId)
    .maybeSingle();

  if (vendorData) {
    return "VENDOR";
  }

  return null;
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
  requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      logger.info({
        level: "info",
        action: "complaint-images",
        userId: authCtx.user.id,
        message: "Complaint images request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.");
      }

      const {
        operation,
        societyRegistrationNumber,
        complaintId,
        documentType,
        files,
        isUploaded,
        documentId,
      } = body as ComplaintImagesRequest;

      // Validate required fields
      const validator = new Validator()
        .validateRequired(operation, "operation");

      if (!validator.isValid()) {
        const errors = validator.getErrors();
        logger.warn({
          level: "warn",
          action: "complaint-images",
          userId: authCtx.user.id,
          message: "Validation failed",
          errors: JSON.stringify(errors),
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Validation failed");
      }

      const cleanOperation = sanitizeString(operation).toUpperCase();

      // ============================================
      // OPERATION: UPLOAD
      // ============================================
      if (cleanOperation === "UPLOAD") {
        const uploadValidator = new Validator()
          .validateRequired(
            societyRegistrationNumber,
            "societyRegistrationNumber",
          )
          .validateRequired(documentType, "documentType")
          .validateRequired(complaintId, "complaintId");

        if (!Array.isArray(files) || files.length === 0) {
          return errorResponse("files array is required and cannot be empty.");
        }

        if (files.length > MAX_IMAGES_LIMIT) {
          return errorResponse(
            `Maximum ${MAX_IMAGES_LIMIT} images allowed. You provided ${files.length}.`,
          );
        }

        if (!uploadValidator.isValid()) {
          const uploadErrors = uploadValidator.getErrors();
          logger.warn({
            level: "warn",
            action: "complaint-images",
            userId: authCtx.user.id,
            message: "Upload validation failed",
            errors: JSON.stringify(uploadErrors),
            timestamp: new Date().toISOString(),
          });
          return errorResponse("Validation failed");
        }

        const cleanRegNo = sanitizeString(societyRegistrationNumber!);
        const cleanComplaintId = sanitizeString(complaintId!);
        const cleanDocumentType = sanitizeString(documentType!);

        // Validate document type (only BEFORE and AFTER)
        if (!validateDocumentType(cleanDocumentType)) {
          return errorResponse(
            `Invalid documentType. Allowed values: BEFORE, AFTER`,
          );
        }

        const documentTypeValue = cleanDocumentType as ImageType;

        // Verify complaint exists
        const { data: complaint, error: compErr } = await supabaseAdmin
          .from("SSP_Complaint")
          .select("complaint_id")
          .eq("complaint_id", cleanComplaintId)
          .maybeSingle();

        if (compErr || !complaint) {
          return errorResponse("Complaint not found.");
        }

        // Verify society exists
        const { data: society, error: socErr } = await supabaseAdmin
          .from("SSP_Society")
          .select("society_id")
          .eq("registration_number", cleanRegNo)
          .maybeSingle();

        if (socErr || !society) {
          return errorResponse("Society not found.");
        }

        // Check if user is authorized (Service Agent or Vendor only)
        const staffType = await getStaffType(authCtx.user.id);

        if (!staffType) {
          return errorResponse(
            "Only Service Agents or Vendors can upload BEFORE/AFTER images.",
          );
        }

        // Verify staff is assigned to this complaint
        const authCheck = await validateStaffAuthorization(
          cleanComplaintId,
          authCtx.user.id,
          staffType,
        );

        if (!authCheck.authorized) {
          return errorResponse(
            authCheck.message ||
              "You are not authorized to upload images for this complaint.",
          );
        }

        // Step A: Generate Presigned URLs (isUploaded === false or not provided)
        const isUploadedValue = isUploaded === true || isUploaded === "true";

        if (!isUploadedValue) {
          const uploadUrlsList: UploadUrlResponse[] = [];
          const prefix = getDocumentTypePrefix(documentTypeValue);
          const compIdClean = cleanComplaintId.replace(/\s+/g, "_");

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.fileName || !file.fileType) {
              return errorResponse(
                `File at index ${i} is missing fileName or fileType.`,
              );
            }

            const cleanFileName = file.fileName.replace(/\s+/g, "_");
            const uniqueFileName = `${Date.now()}_${i}_${cleanFileName}`;
            const objectKey =
              `${cleanRegNo}/complaints/${compIdClean}/${prefix}${uniqueFileName}`;

            const { data: uploadData, error: uploadErr } = await supabaseAdmin
              .storage
              .from(BUCKET_NAME)
              .createSignedUploadUrl(objectKey, { upsert: true });

            if (uploadErr || !uploadData) {
              logger.error({
                level: "error",
                action: "complaint-images-upload",
                message:
                  `Failed generating upload URL for ${file.fileName}: ${uploadErr?.message}`,
                timestamp: new Date().toISOString(),
              });
              return errorResponse(
                `Failed to generate upload URL for ${file.fileName}`,
              );
            }

            uploadUrlsList.push({
              fileName: file.fileName,
              fileUrl: uploadData.signedUrl,
              objectKey: objectKey,
            });
          }

          logger.info({
            level: "info",
            action: "complaint-images",
            userId: authCtx.user.id,
            complaintId: cleanComplaintId,
            documentType: documentTypeValue,
            filesCount: files.length,
            message: "Upload URLs generated successfully",
            timestamp: new Date().toISOString(),
          });

          const response: ComplaintImagesResponse = {
            uploaded: false,
            uploadUrls: uploadUrlsList,
            documentIds: null,
            document: null,
          };

          return successResponse(response);
        }

        // Step B: Confirm Upload & Create Document Records (isUploaded === true)
        const insertedDocumentIds: string[] = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file.objectKey || !file.fileName || !file.fileType) {
            return errorResponse(
              `File at index ${i} is missing objectKey, fileName, or fileType.`,
            );
          }

          // Get public URL for the uploaded file
          const { data: urlInfo } = supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(file.objectKey);

          // Create document record
          const documentData = {
            document_id: generateId(),
            name: file.fileName,
            file_name: file.fileName,
            file_type: file.fileType,
            file_size: file.fileSize ? parseFloat(String(file.fileSize)) : null,
            document_type: getDocumentTypeDisplay(documentTypeValue),
            s3_path: urlInfo.publicUrl,
            society: society.society_id,
            complaint: cleanComplaintId,
            uploaded_on: getCurrentTimestamp(),
            created_at: getCurrentTimestamp(),
          };

          const { data: newDoc, error: insertErr } = await supabaseAdmin
            .from("SSP_Document")
            .insert(documentData)
            .select("document_id")
            .single();

          if (insertErr || !newDoc) {
            logger.error({
              level: "error",
              action: "complaint-images-insert",
              message:
                `Failed to create document record for ${file.fileName}: ${insertErr?.message}`,
              timestamp: new Date().toISOString(),
            });
            return errorResponse(
              `Failed to save document record for ${file.fileName}`,
            );
          }

          insertedDocumentIds.push(newDoc.document_id);
        }

        logger.info({
          level: "info",
          action: "complaint-images",
          userId: authCtx.user.id,
          complaintId: cleanComplaintId,
          documentType: documentTypeValue,
          filesCount: files.length,
          documentIds: insertedDocumentIds,
          message: "Documents created successfully",
          timestamp: new Date().toISOString(),
        });

        const response: ComplaintImagesResponse = {
          uploaded: true,
          uploadUrls: null,
          documentIds: insertedDocumentIds,
          document: null,
        };

        return successResponse(response);
      }

      // ============================================
      // OPERATION: FETCH
      // ============================================
      if (cleanOperation === "FETCH") {
        const fetchValidator = new Validator()
          .validateRequired(complaintId, "complaintId")
          .validateRequired(documentId, "documentId");

        if (!fetchValidator.isValid()) {
          const fetchErrors = fetchValidator.getErrors();
          logger.warn({
            level: "warn",
            action: "complaint-images",
            userId: authCtx.user.id,
            message: "Fetch validation failed",
            errors: JSON.stringify(fetchErrors),
            timestamp: new Date().toISOString(),
          });
          return errorResponse("Validation failed");
        }

        const cleanComplaintId = sanitizeString(complaintId!);
        const cleanDocumentId = sanitizeString(documentId!);

        // Verify complaint exists
        const { data: complaint, error: compErr } = await supabaseAdmin
          .from("SSP_Complaint")
          .select("complaint_id")
          .eq("complaint_id", cleanComplaintId)
          .maybeSingle();

        if (compErr || !complaint) {
          return errorResponse("Complaint not found.");
        }

        // Fetch document
        const { data: doc, error: fetchErr } = await supabaseAdmin
          .from("SSP_Document")
          .select(
            "document_id, name, s3_path, file_type, file_size, uploaded_on",
          )
          .eq("document_id", cleanDocumentId)
          .eq("complaint", cleanComplaintId)
          .maybeSingle();

        if (fetchErr || !doc) {
          return errorResponse("Document not found.");
        }

        // Generate signed URL
        let viewUrl = "";
        const computedKey = extractStorageKey(doc.s3_path);
        if (computedKey) {
          const { data: signedData } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(computedKey, SIGNED_URL_EXPIRY);

          if (signedData) {
            viewUrl = signedData.signedUrl;
          }
        }

        const response: ComplaintImagesResponse = {
          uploaded: null,
          uploadUrls: null,
          documentIds: null,
          document: {
            documentId: doc.document_id,
            documentName: doc.name || "Untitled",
            fileUrl: viewUrl,
            fileType: doc.file_type || null,
            fileSize: doc.file_size || null,
            uploadedAt: doc.uploaded_on || new Date().toISOString(),
          },
        };

        return successResponse(response);
      }

      // ============================================
      // OPERATION: DELETE
      // ============================================
      if (cleanOperation === "DELETE") {
        const deleteValidator = new Validator()
          .validateRequired(complaintId, "complaintId")
          .validateRequired(documentId, "documentId");

        if (!deleteValidator.isValid()) {
          const deleteErrors = deleteValidator.getErrors();
          logger.warn({
            level: "warn",
            action: "complaint-images",
            userId: authCtx.user.id,
            message: "Delete validation failed",
            errors: JSON.stringify(deleteErrors),
            timestamp: new Date().toISOString(),
          });
          return errorResponse("Validation failed");
        }

        const cleanComplaintId = sanitizeString(complaintId!);
        const cleanDocumentId = sanitizeString(documentId!);

        // Verify complaint exists
        const { data: complaint, error: compErr } = await supabaseAdmin
          .from("SSP_Complaint")
          .select("complaint_id")
          .eq("complaint_id", cleanComplaintId)
          .maybeSingle();

        if (compErr || !complaint) {
          return errorResponse("Complaint not found.");
        }

        // Fetch document to get storage path
        const { data: doc, error: fetchErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id, s3_path")
          .eq("document_id", cleanDocumentId)
          .eq("complaint", cleanComplaintId)
          .maybeSingle();

        if (fetchErr || !doc) {
          return errorResponse("Document not found.");
        }

        // Delete from storage
        const storageKey = extractStorageKey(doc.s3_path);
        if (storageKey) {
          const { error: storageErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .remove([storageKey]);

          if (storageErr) {
            logger.warn({
              level: "warn",
              action: "complaint-images-delete",
              message: `Failed to delete from storage: ${storageErr.message}`,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // Delete from database
        const { error: deleteErr } = await supabaseAdmin
          .from("SSP_Document")
          .delete()
          .eq("document_id", cleanDocumentId);

        if (deleteErr) {
          return errorResponse("Failed to delete document.");
        }

        logger.info({
          level: "info",
          action: "complaint-images",
          userId: authCtx.user.id,
          complaintId: cleanComplaintId,
          documentId: cleanDocumentId,
          message: "Document deleted successfully",
          timestamp: new Date().toISOString(),
        });

        const response: ComplaintImagesResponse = {
          uploaded: null,
          uploadUrls: null,
          documentIds: null,
          document: null,
          deleted: true,
          message: "Document deleted successfully",
        };

        return successResponse(response);
      }

      return errorResponse(
        `Invalid operation: ${operation}. Allowed: UPLOAD, FETCH, DELETE`,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error({
        level: "error",
        action: "complaint-images",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString(),
      });

      return errorResponse(errorMessage || "Failed to process image request.");
    }
  }),
);
