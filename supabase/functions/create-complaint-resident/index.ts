// ============================================
// create-complaint - Create New Complaint
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
  parseRequestBody,
  sanitizeString,
} from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface CreateComplaintRequest {
  societyRegistrationNumber: string;
  residentId: string;
  title: string;
  description: string;
  type?: string;
  priority?: string;
  images?: Array<{
    fileName: string;
    fileType: string;
    fileSize?: number | string;
  }>;
  fileName?: string;
  fileType?: string;
  fileSize?: number | string;
}

interface ComplaintResponse {
  complaintId: string;
  title: string;
  message: string;
  createdAt: string;
  residentDetails: {
    residentId: string;
    name: string;
  };
  images?: string[];
  documents?: Array<{
    documentId: string;
    uploadUrl: string | null;
    filePath: string;
    fileName: string;
  }>;
}

interface DocumentResponse {
  documentId: string;
  uploadUrl: string | null;
  filePath: string;
  fileName: string;
}

interface ContactInfo {
  contact_id: string;
  name: string;
  phone: string;
  email: string;
}

interface SocietyUser {
  user_id: string;
  contact: ContactInfo;
  unit_flat_number?: string | null;
  tower?: string | null;
  block?: string | null;
}

interface ComplaintRecord {
  complaint_id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  complaint_type: string;
  created_at: string;
  society_user: string;
}

interface ValidationError {
  field: string;
  message: string;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_IMAGES = 5;
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extract first item from array or return null
 */
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) {
    return arr.length > 0 ? arr[0] : null;
  }
  return arr;
}

/**
 * Find resident user by ID with complete details
 */
async function findResidentUser(
  residentId: string,
  societyId: string,
): Promise<{ data: SocietyUser | null; error?: string }> {
  try {
    const { data: userData, error: userError } = await supabaseAdmin
      .from("SSP_Society_User")
      .select(`
        user_id,
        unit_flat_number,
        tower,
        block,
        society,
        contact:SSP_Contact!inner(
          contact_id,
          name,
          phone,
          email
        )
      `)
      .eq("user_id", residentId)
      .eq("society", societyId)
      .maybeSingle();

    if (userError) {
      logger.error({
        level: "error",
        action: "find-resident-user",
        message: `User query error: ${userError.message}`,
        timestamp: new Date().toISOString(),
      });
      return { data: null, error: userError.message };
    }

    if (!userData) {
      return { data: null, error: "NOT_FOUND" };
    }

    // Handle the nested contact structure using firstOrNull
    const contactData = firstOrNull(userData.contact);

    if (!contactData) {
      return { data: null, error: "Contact not found" };
    }

    return {
      data: {
        user_id: userData.user_id,
        contact: {
          contact_id: contactData.contact_id,
          name: contactData.name,
          phone: contactData.phone,
          email: contactData.email || "",
        },
        unit_flat_number: userData.unit_flat_number || null,
        tower: userData.tower || null,
        block: userData.block || null,
      },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    logger.error({
      level: "error",
      action: "find-resident-user",
      message: `Exception: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });
    return { data: null, error: errorMessage };
  }
}

/**
 * Create complaint record in database
 */
async function createComplaintRecord(params: {
  societyUserId: string;
  title: string;
  description: string;
  type: string;
  priority: string;
}): Promise<{ data?: ComplaintRecord; error?: string }> {
  try {
    const complaintId = generateId();
    const now = getCurrentTimestamp();

    const complaintData = {
      complaint_id: complaintId,
      name: params.title,
      description: params.description,
      complaint_type: params.type,
      priority: params.priority,
      status: "pending",
      society_user: params.societyUserId,
      created_at: now,
      assigned_date_time: null,
      assigned_agent: null,
      assigned_by: null,
      non_society_user: null,
      completion_date_time: null,
    };

    const { data: complaint, error } = await supabaseAdmin
      .from("SSP_Complaint")
      .insert(complaintData)
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }

    return { data: complaint as ComplaintRecord };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return { error: errorMessage };
  }
}

/**
 * Handle document upload and create document record
 */
async function handleDocumentUpload(params: {
  fileName: string;
  fileType: string;
  fileSize?: number | string;
  societyId: string;
  societyUserId: string;
  complaintId: string;
  registrationNumber: string;
  index: number;
}): Promise<DocumentResponse | null> {
  try {
    const {
      fileName,
      fileType,
      fileSize,
      societyId,
      societyUserId,
      complaintId,
      registrationNumber,
      index,
    } = params;

    const cleanFileName = fileName.replace(/\s+/g, "_");
    const uniqueFileName = `${Date.now()}_${index}_${cleanFileName}`;
    const objectKey =
      `${registrationNumber}/complaints/${complaintId}/${uniqueFileName}`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin
      .storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(objectKey, { upsert: true });

    if (uploadError) {
      logger.error({
        level: "error",
        action: "create-complaint-upload",
        message:
          `Upload URL generation failed for ${fileName}: ${uploadError.message}`,
        complaintId: complaintId,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    const documentData = {
      document_id: generateId(),
      name: fileName,
      file_name: objectKey,
      file_type: fileType,
      file_size: fileSize ? parseFloat(String(fileSize)) : null,
      document_type: "complaint_attachment",
      s3_path: objectKey,
      society: societyId,
      society_user: societyUserId,
      complaint: complaintId,
      uploaded_on: getCurrentTimestamp(),
      created_at: getCurrentTimestamp(),
    };

    const { data: doc, error: docError } = await supabaseAdmin
      .from("SSP_Document")
      .insert(documentData)
      .select("document_id")
      .single();

    if (docError) {
      logger.error({
        level: "error",
        action: "create-complaint-document",
        message: `Document record creation failed: ${docError.message}`,
        complaintId: complaintId,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    return {
      documentId: doc.document_id,
      uploadUrl: uploadData.signedUrl,
      filePath: objectKey,
      fileName: fileName,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    logger.error({
      level: "error",
      action: "create-complaint-upload",
      message: errorMessage,
      timestamp: new Date().toISOString(),
    });
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
  requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      logger.info({
        level: "info",
        action: "create-complaint",
        userId: authCtx.user.id,
        message: "Create complaint request received",
        timestamp: new Date().toISOString(),
      });

      // 1. Method Validation
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      // 2. Parse Request Body
      const body = await parseRequestBody<CreateComplaintRequest>(req);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const {
        societyRegistrationNumber,
        residentId,
        title,
        description,
        type,
        priority,
        images = [],
        fileName,
        fileType,
        fileSize,
      } = body;

      // 3. Validate Required Fields
      const validator = new Validator()
        .validateRequired(
          societyRegistrationNumber,
          "societyRegistrationNumber",
        )
        .validateRequired(residentId, "residentId")
        .validateRequired(title, "title")
        .validateRequired(description, "description");

      if (!validator.isValid()) {
        const errors = validator.getErrors() as ValidationError[];
        logger.warn({
          level: "warn",
          action: "create-complaint",
          userId: authCtx.user.id,
          message: "Validation failed",
          errors: JSON.stringify(errors),
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Validation failed", 400);
      }

      // 4. Validate Image Count
      const allImages = [...images];

      if (fileName && fileType) {
        allImages.push({
          fileName,
          fileType,
          fileSize: fileSize !== undefined && fileSize !== null
            ? fileSize
            : undefined,
        });
      }

      if (allImages.length > MAX_IMAGES) {
        return errorResponse(
          `Maximum ${MAX_IMAGES} images allowed. You provided ${allImages.length}.`,
          400,
        );
      }

      const cleanRegNo = sanitizeString(societyRegistrationNumber);
      const cleanResidentId = sanitizeString(residentId);
      const cleanTitle = sanitizeString(title);
      const cleanDescription = sanitizeString(description);
      const cleanType = sanitizeString(type || "general");
      const cleanPriority = sanitizeString(priority || "medium");

      // 5. Get Society
      const { data: society, error: socError } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", cleanRegNo)
        .maybeSingle();

      if (socError) {
        logger.error({
          level: "error",
          action: "create-complaint",
          message: `Society lookup failed: ${socError.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Society verification failed.", 500);
      }

      if (!society) {
        return errorResponse(
          "Society not found with the given registration number.",
          404,
        );
      }

      // 6. Find Resident User with Complete Details
      const userResult = await findResidentUser(
        cleanResidentId,
        society.society_id,
      );

      if (userResult.error) {
        if (userResult.error === "NOT_FOUND") {
          return errorResponse("Resident not found in the society.", 404);
        }
        logger.error({
          level: "error",
          action: "create-complaint",
          message: `Resident lookup failed: ${userResult.error}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Resident lookup failed.", 500);
      }

      const targetUser = userResult.data as SocietyUser;

      // 7. Create Complaint
      const complaintResult = await createComplaintRecord({
        societyUserId: targetUser.user_id,
        title: cleanTitle,
        description: cleanDescription,
        type: cleanType,
        priority: cleanPriority,
      });

      if (complaintResult.error) {
        return errorResponse(complaintResult.error, 500);
      }

      const complaint = complaintResult.data as ComplaintRecord;

      // 8. Handle Multiple Document Uploads
      const uploadResponses: DocumentResponse[] = [];

      if (allImages.length > 0) {
        for (const [index, image] of allImages.entries()) {
          if (!image.fileName || !image.fileType) continue;

          const docResponse = await handleDocumentUpload({
            fileName: image.fileName,
            fileType: image.fileType,
            fileSize: image.fileSize,
            societyId: society.society_id,
            societyUserId: targetUser.user_id,
            complaintId: complaint.complaint_id,
            registrationNumber: cleanRegNo,
            index: index,
          });

          if (docResponse) {
            uploadResponses.push(docResponse);
          }
        }
      }

      // 9. Prepare Minimal Response
      const response: ComplaintResponse = {
        complaintId: complaint.complaint_id,
        title: complaint.name,
        message: "Complaint created successfully",
        createdAt: complaint.created_at,
        residentDetails: {
          residentId: targetUser.user_id,
          name: targetUser.contact.name,
        },
        images: uploadResponses.map((doc) => doc.filePath),
        documents: uploadResponses.length > 0 ? uploadResponses : undefined,
      };

      // 10. Log Success
      logger.info({
        level: "info",
        action: "create-complaint",
        userId: authCtx.user.id,
        complaintId: complaint.complaint_id,
        hasDocument: uploadResponses.length > 0 ? "yes" : "no",
        documentCount: uploadResponses.length,
        duration: Date.now() - startTime,
        message: "Complaint created successfully",
        timestamp: new Date().toISOString(),
      });

      return successResponse(response, 201);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error({
        level: "error",
        action: "create-complaint",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString(),
      });
      return errorResponse(
        "Failed to create complaint. Please try again.",
        500,
      );
    }
  }),
);
