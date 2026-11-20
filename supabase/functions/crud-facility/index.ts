// import { createClient, SupabaseClient } from "@supabase/supabase-js";
// import { requireAuth } from "../_shared/auth.ts";
// import {
//   corsHeaders,
//   errorResponse,
//   successResponse,
// } from "../_shared/response.ts";
// import { createLogger } from "../_shared/logger.ts";

// // ============================================
// // CONSTANTS & LOGGER
// // ============================================
// const BUCKET_NAME = "society-documents";
// const baseLogger = createLogger("crud-facility");

// // Safe logger wrapper to comply with strict LogData interface
// const logger = {
//   info: (data: Record<string, unknown>) =>
//     baseLogger.info({
//       level: "info",
//       timestamp: new Date().toISOString(),
//       ...data,
//     }),
//   warn: (data: Record<string, unknown>) =>
//     baseLogger.warn({
//       level: "warn",
//       timestamp: new Date().toISOString(),
//       ...data,
//     }),
//   error: (data: Record<string, unknown>) =>
//     baseLogger.error({
//       level: "error",
//       timestamp: new Date().toISOString(),
//       ...data,
//     }),
// };

// // ============================================
// // TYPES & INTERFACES
// // ============================================
// interface FacilityPayload {
//   name?: string;
//   type?: string;
//   description?: string;
//   rules?: string | string[] | null;
//   bookingMode?: string;
//   closedDays?: string | string[] | null;
//   basePrice?: number | null;
//   securityDeposit?: number | null;
//   openingTime?: string | null;
//   closingTime?: string | null;
//   isChargeable?: boolean | null;
//   extraCharges?: number | null;
//   onMaintenance?: boolean;
//   maintenanceStart?: string | null;
//   maintenanceEnd?: string | null;
//   maintenanceReason?: string | null;
//   fileName?: string;
//   fileType?: string;
//   fileSize?: number;
//   deleteImage?: boolean;
// }

// interface CreateFacilityRequest {
//   registrationNumber: string;
//   adminPhone: string;
//   action: "CREATE" | "UPDATE" | "DELETE";
//   id?: string;
//   payload?: FacilityPayload;
// }

// interface FacilityResponse {
//   id: string;
//   societyRegistrationNumber: string;
//   name: string | null;
//   type: string | null;
//   description: string | null;
//   rules: string | null;
//   bookingMode: string | null;
//   closedDays: string | null;
//   basePrice: number | null;
//   securityDeposit: number | null;
//   openingTime: string | null;
//   closingTime: string | null;
//   isChargeable: boolean | null;
//   extraCharges: number | null;
//   onMaintenance: boolean;
//   maintenanceStart: string | null;
//   maintenanceEnd: string | null;
//   maintenanceReason: string | null;
//   imageUrl: string | null;
// }

// interface AuthContext {
//   user: {
//     id: string;
//     email?: string;
//   };
// }

// interface AuthenticatedRequest extends Request {
//   authContext?: AuthContext;
// }

// interface DBContact {
//   phone: string | null;
// }

// interface DBSocietyUser {
//   role: string | string[] | null;
//   SSP_Contact: DBContact | DBContact[] | null;
// }

// interface DBFacility {
//   id: string;
//   name: string | null;
//   facility_type: string | null;
//   description: string | null;
//   rules: string | null;
//   booking_mode: string | null;
//   closed_days: string | null;
//   base_price: number | null;
//   security_deposit: number | null;
//   opening_time: string | null;
//   closing_time: string | null;
//   is_chargeable: boolean | null;
//   extra_charges: number | null;
//   on_maintenance: boolean | null;
//   maintenance_start: string | null;
//   maintenance_end: string | null;
//   maintenance_reason: string | null;
// }

// interface DBDocument {
//   document_id: string;
//   file_name: string | null;
//   facility: string | null;
//   s3_path: string | null;
// }

// // ============================================
// // HELPER FUNCTIONS
// // ============================================

// function toTextValue(value: string | string[] | null | undefined): string | null {
//   if (value === undefined || value === null) return null;
//   if (Array.isArray(value)) {
//     if (value.length === 0) return null;
//     return value.join(", ");
//   }
//   return String(value).trim() || null;
// }

// function cleanPhoneString(phone: string): string {
//   return String(phone || "").replace(/\D/g, "");
// }

// function isAdmin(role: unknown): boolean {
//   const roles = Array.isArray(role)
//     ? role.map((r) => String(r).toLowerCase())
//     : String(role || "")
//         .toLowerCase()
//         .replace(/[{}"]/g, "")
//         .split(",")
//         .filter(Boolean);
//   return roles.includes("admin");
// }

// // ============================================
// // STORAGE HELPERS
// // ============================================

// async function deleteFacilityImage(
//   supabase: SupabaseClient,
//   facilityId: string
// ): Promise<void> {
//   try {
//     logger.info({
//       action: "delete_facility_image",
//       facilityId,
//       message: "Deleting facility images",
//     });

//     const { data: existingDocs, error: fetchErr } = await supabase
//       .from("SSP_Document")
//       .select("document_id, file_name")
//       .eq("facility", facilityId);

//     if (fetchErr) {
//       logger.error({
//         action: "delete_facility_image",
//         facilityId,
//         error: fetchErr.message,
//         message: "Failed to fetch existing documents",
//       });
//       throw fetchErr;
//     }

//     const docs = (existingDocs as DBDocument[]) || [];

//     if (docs.length > 0) {
//       for (const doc of docs) {
//         if (doc.file_name) {
//           const { error: storageErr } = await supabase.storage
//             .from(BUCKET_NAME)
//             .remove([doc.file_name]);

//           if (storageErr) {
//             logger.warn({
//               action: "delete_facility_image",
//               facilityId,
//               fileName: doc.file_name,
//               error: storageErr.message,
//               message: "Failed to delete from storage",
//             });
//           }
//         }

//         const { error: deleteErr } = await supabase
//           .from("SSP_Document")
//           .delete()
//           .eq("document_id", doc.document_id);

//         if (deleteErr) {
//           logger.error({
//             action: "delete_facility_image",
//             facilityId,
//             documentId: doc.document_id,
//             error: deleteErr.message,
//             message: "Failed to delete document record",
//           });
//           throw deleteErr;
//         }
//       }
//     }

//     logger.info({
//       action: "delete_facility_image",
//       facilityId,
//       message: "Facility images deleted successfully",
//       count: docs.length,
//     });
//   } catch (error: unknown) {
//     const err = error as Error;
//     logger.error({
//       action: "delete_facility_image",
//       facilityId,
//       error: err.message,
//       message: "Error deleting facility images",
//     });
//     throw error;
//   }
// }

// async function createFacilityImageSignedUrl(
//   supabase: SupabaseClient,
//   facilityId: string,
//   societyId: string,
//   regNum: string,
//   fileName: string,
//   fileType: string,
//   fileSize?: number
// ): Promise<{ uploadUrl: string; documentId: string }> {
//   try {
//     logger.info({
//       action: "create_upload_url",
//       facilityId,
//       fileName,
//       message: "Creating signed upload URL",
//     });

//     await deleteFacilityImage(supabase, facilityId);

//     const cleanFileName = fileName.replace(/\s+/g, "_");
//     const objectKey = `${regNum}/facilities/${facilityId}/${Date.now()}_${cleanFileName}`;

//     const { data: uploadUrlData, error: storageErr } = await supabase.storage
//       .from(BUCKET_NAME)
//       .createSignedUploadUrl(objectKey);

//     if (storageErr || !uploadUrlData?.signedUrl) {
//       logger.error({
//         action: "create_upload_url",
//         facilityId,
//         error: storageErr?.message || "No signed URL returned",
//         message: "Failed to create signed URL",
//       });
//       throw new Error(
//         `Signed URL Creation Failed: ${storageErr?.message || "Internal error"}`
//       );
//     }

//     const { data: urlInfo } = supabase.storage
//       .from(BUCKET_NAME)
//       .getPublicUrl(objectKey);

//     const { data: doc, error: docErr } = await supabase
//       .from("SSP_Document")
//       .insert({
//         name: fileName,
//         file_name: objectKey,
//         file_type: fileType,
//         file_size: fileSize ? parseFloat(String(fileSize)) : null,
//         document_type: "Facility Attachment",
//         s3_path: urlInfo.publicUrl,
//         society: societyId,
//         facility: facilityId,
//         uploaded_on: new Date().toISOString(),
//       })
//       .select("document_id")
//       .single();

//     if (docErr || !doc) {
//       logger.error({
//         action: "create_upload_url",
//         facilityId,
//         error: docErr?.message,
//         message: "Failed to register document",
//       });
//       throw new Error(
//         `SSP_Document Registration Failed: ${docErr?.message || "DB failure"}`
//       );
//     }

//     logger.info({
//       action: "create_upload_url",
//       facilityId,
//       documentId: doc.document_id,
//       message: "Upload URL created successfully",
//     });

//     return {
//       uploadUrl: uploadUrlData.signedUrl,
//       documentId: doc.document_id,
//     };
//   } catch (error: unknown) {
//     const err = error as Error;
//     logger.error({
//       action: "create_upload_url",
//       facilityId,
//       error: err.message,
//       message: "Failed to create upload URL",
//     });
//     throw error;
//   }
// }

// // ============================================
// // AUTH AUTHORIZATION HELPER
// // ============================================

// async function authorizeAdmin(
//   supabase: SupabaseClient,
//   registrationNumber: string,
//   adminPhone: string
// ): Promise<{ societyId: string; societyName: string } | null> {
//   try {
//     const cleanRegNum = String(registrationNumber).trim();
//     const targetPhone = cleanPhoneString(adminPhone);

//     const { data: society, error: socErr } = await supabase
//       .from("SSP_Society")
//       .select("society_id, society_name, registration_number")
//       .eq("registration_number", cleanRegNum)
//       .maybeSingle();

//     if (socErr || !society) {
//       logger.warn({
//         action: "authorize_admin",
//         registrationNumber: cleanRegNum,
//         message: "Society not found",
//         error: socErr?.message,
//       });
//       return null;
//     }

//     const { data: admins, error: adminErr } = await supabase
//       .from("SSP_Society_User")
//       .select("role, SSP_Contact!contact (phone)")
//       .eq("society", society.society_id);

//     if (adminErr) {
//       logger.error({
//         action: "authorize_admin",
//         societyId: society.society_id,
//         error: adminErr.message,
//         message: "Failed to fetch admins",
//       });
//       return null;
//     }

//     const adminList = (admins as unknown as DBSocietyUser[]) || [];

//     const isAuthorized = adminList.some((user) => {
//       if (!isAdmin(user.role)) return false;

//       const contact = Array.isArray(user.SSP_Contact)
//         ? user.SSP_Contact[0]
//         : user.SSP_Contact;

//       const dbPhone = contact?.phone
//         ? cleanPhoneString(String(contact.phone))
//         : "";
//       return (
//         dbPhone !== "" &&
//         (targetPhone.includes(dbPhone) || dbPhone.includes(targetPhone))
//       );
//     });

//     if (!isAuthorized) {
//       logger.warn({
//         action: "authorize_admin",
//         societyId: society.society_id,
//         adminPhone: targetPhone,
//         message: "Unauthorized admin access",
//       });
//       return null;
//     }

//     logger.info({
//       action: "authorize_admin",
//       societyId: society.society_id,
//       message: "Admin authorized successfully",
//     });

//     return {
//       societyId: society.society_id,
//       societyName: society.society_name || "NA",
//     };
//   } catch (error: unknown) {
//     const err = error as Error;
//     logger.error({
//       action: "authorize_admin",
//       registrationNumber,
//       error: err.message,
//       message: "Authorization error",
//     });
//     return null;
//   }
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// const supabaseAdmin: SupabaseClient = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// );

// Deno.serve(
//   requireAuth(async (req: Request) => {
//     if (req.method === "OPTIONS") {
//       return new Response("ok", { headers: corsHeaders });
//     }

//     const authCtx = (req as AuthenticatedRequest).authContext;
//     const startTime = Date.now();

//     try {
//       logger.info({
//         action: "crud_facility_start",
//         userId: authCtx?.user?.id ?? "unknown",
//         method: req.method,
//         message: "Facility CRUD operation started",
//       });

//       if (req.method !== "POST") {
//         return errorResponse("Only POST method is allowed.", 405);
//       }

//       const body = await req.json().catch(() => null);
//       if (!body) {
//         return errorResponse("Request body is required.", 400);
//       }

//       const {
//         registrationNumber,
//         adminPhone,
//         action,
//         id,
//         payload,
//       }: CreateFacilityRequest = body;

//       if (!registrationNumber || !adminPhone || !action) {
//         return errorResponse(
//           "Missing required parameters: registrationNumber, adminPhone, action are mandatory.",
//           400
//         );
//       }

//       const validActions = ["CREATE", "UPDATE", "DELETE"];
//       const act = String(action).toUpperCase() as
//         | "CREATE"
//         | "UPDATE"
//         | "DELETE";
//       if (!validActions.includes(act)) {
//         return errorResponse(
//           `Invalid action. Must be one of: ${validActions.join(", ")}`,
//           400
//         );
//       }

//       if ((act === "UPDATE" || act === "DELETE") && !id) {
//         return errorResponse(
//           `ID parameter is required for ${act} operation.`,
//           400
//         );
//       }

//       const authResult = await authorizeAdmin(
//         supabaseAdmin,
//         registrationNumber,
//         adminPhone
//       );

//       if (!authResult) {
//         return errorResponse("Unauthorized Admin Access.", 403);
//       }

//       const { societyId } = authResult;
//       let dbFacilities: DBFacility[] = [];
//       let uploadUrl: string | null = null;
//       let documentId: string | null = null;

//       // ============================================
//       // EXECUTE OPERATION
//       // ============================================
//       if (act === "CREATE") {
//         logger.info({
//           action: "facility_create",
//           societyId,
//           message: "Creating new facility",
//         });

//         const insertPayload: Record<string, unknown> = {
//           society: societyId,
//           name: payload?.name ?? null,
//           facility_type: payload?.type ?? null,
//           description: payload?.description ?? null,
//           rules: toTextValue(payload?.rules),
//           booking_mode: payload?.bookingMode ?? null,
//           closed_days: toTextValue(payload?.closedDays),
//           base_price: payload?.basePrice ?? null,
//           security_deposit: payload?.securityDeposit ?? null,
//           opening_time: payload?.openingTime ?? null,
//           closing_time: payload?.closingTime ?? null,
//           is_chargeable: payload?.isChargeable ?? null,
//           extra_charges: payload?.extraCharges ?? null,
//           on_maintenance: payload?.onMaintenance ?? false,
//           maintenance_start: payload?.maintenanceStart ?? null,
//           maintenance_end: payload?.maintenanceEnd ?? null,
//           maintenance_reason: payload?.maintenanceReason ?? null,
//         };

//         const { data, error } = await supabaseAdmin
//           .from("SSP_Facility")
//           .insert(insertPayload)
//           .select();

//         if (error) throw error;
//         dbFacilities = (data as DBFacility[]) || [];

//         const createdFacility = dbFacilities[0];
//         logger.info({
//           action: "facility_create",
//           facilityId: createdFacility.id,
//           message: "Facility created successfully",
//         });

//         if (payload?.fileName && payload?.fileType) {
//           const uploadDetails = await createFacilityImageSignedUrl(
//             supabaseAdmin,
//             createdFacility.id,
//             societyId,
//             String(registrationNumber).trim(),
//             payload.fileName,
//             payload.fileType,
//             payload.fileSize
//           );
//           uploadUrl = uploadDetails.uploadUrl;
//           documentId = uploadDetails.documentId;
//         }
//       } else if (act === "UPDATE") {
//         logger.info({
//           action: "facility_update",
//           facilityId: id,
//           societyId,
//           message: "Updating facility",
//         });

//         const updatePayload: Record<string, unknown> = {};
//         if (payload?.name !== undefined) updatePayload.name = payload.name;
//         if (payload?.type !== undefined)
//           updatePayload.facility_type = payload.type;
//         if (payload?.description !== undefined)
//           updatePayload.description = payload.description;
//         if (payload?.rules !== undefined)
//           updatePayload.rules = toTextValue(payload.rules);
//         if (payload?.bookingMode !== undefined)
//           updatePayload.booking_mode = payload.bookingMode;
//         if (payload?.closedDays !== undefined)
//           updatePayload.closed_days = toTextValue(payload.closedDays);
//         if (payload?.basePrice !== undefined)
//           updatePayload.base_price = payload.basePrice;
//         if (payload?.securityDeposit !== undefined)
//           updatePayload.security_deposit = payload.securityDeposit;
//         if (payload?.openingTime !== undefined)
//           updatePayload.opening_time = payload.openingTime;
//         if (payload?.closingTime !== undefined)
//           updatePayload.closing_time = payload.closingTime;
//         if (payload?.isChargeable !== undefined)
//           updatePayload.is_chargeable = payload.isChargeable;
//         if (payload?.extraCharges !== undefined)
//           updatePayload.extra_charges = payload.extraCharges;
//         if (payload?.onMaintenance !== undefined)
//           updatePayload.on_maintenance = payload.onMaintenance;
//         if (payload?.maintenanceStart !== undefined)
//           updatePayload.maintenance_start = payload.maintenanceStart;
//         if (payload?.maintenanceEnd !== undefined)
//           updatePayload.maintenance_end = payload.maintenanceEnd;
//         if (payload?.maintenanceReason !== undefined)
//           updatePayload.maintenance_reason = payload.maintenanceReason;

//         if (Object.keys(updatePayload).length > 0) {
//           const { data, error } = await supabaseAdmin
//             .from("SSP_Facility")
//             .update(updatePayload)
//             .eq("id", id)
//             .eq("society", societyId)
//             .select();

//           if (error) throw error;
//           dbFacilities = (data as DBFacility[]) || [];
//         } else {
//           const { data, error } = await supabaseAdmin
//             .from("SSP_Facility")
//             .select("*")
//             .eq("id", id)
//             .eq("society", societyId);

//           if (error) throw error;
//           dbFacilities = (data as DBFacility[]) || [];
//         }

//         if (dbFacilities.length === 0) {
//           return errorResponse("Facility not found or access denied.", 404);
//         }

//         logger.info({
//           action: "facility_update",
//           facilityId: id,
//           message: "Facility updated successfully",
//         });

//         if (payload?.deleteImage) {
//           await deleteFacilityImage(supabaseAdmin, id!);
//         }

//         if (payload?.fileName && payload?.fileType) {
//           const uploadDetails = await createFacilityImageSignedUrl(
//             supabaseAdmin,
//             id!,
//             societyId,
//             String(registrationNumber).trim(),
//             payload.fileName,
//             payload.fileType,
//             payload.fileSize
//           );
//           uploadUrl = uploadDetails.uploadUrl;
//           documentId = uploadDetails.documentId;
//         }
//       } else if (act === "DELETE") {
//         logger.info({
//           action: "facility_delete",
//           facilityId: id,
//           societyId,
//           message: "Deleting facility",
//         });

//         await deleteFacilityImage(supabaseAdmin, id!);

//         const { data, error } = await supabaseAdmin
//           .from("SSP_Facility")
//           .delete()
//           .eq("id", id)
//           .eq("society", societyId)
//           .select();

//         if (error) throw error;
//         dbFacilities = (data as DBFacility[]) || [];

//         if (dbFacilities.length === 0) {
//           return errorResponse("Facility not found or access denied.", 404);
//         }

//         logger.info({
//           action: "facility_delete",
//           facilityId: id,
//           message: "Facility deleted successfully",
//         });

//         return successResponse({
//           message: "Facility and associated documents deleted successfully.",
//           deleted: true,
//         });
//       }

//       // Fetch images for response
//       const facilityIds = dbFacilities.map((f) => f.id);
//       let docMap = new Map<string, string>();

//       if (facilityIds.length > 0) {
//         const { data: docRecords } = await supabaseAdmin
//           .from("SSP_Document")
//           .select("facility, s3_path")
//           .in("facility", facilityIds);

//         const docs = (docRecords as DBDocument[]) || [];
//         docMap = new Map(
//           docs
//             .filter((d) => d.facility && d.s3_path)
//             .map((d) => [d.facility as string, d.s3_path as string])
//         );
//       }

//       // Build response payload
//       const responseData: FacilityResponse[] = dbFacilities.map((facility) => ({
//         id: facility.id,
//         societyRegistrationNumber: String(registrationNumber).trim(),
//         name: facility.name,
//         type: facility.facility_type,
//         description: facility.description,
//         rules: facility.rules,
//         bookingMode: facility.booking_mode,
//         closedDays: facility.closed_days,
//         basePrice: facility.base_price,
//         securityDeposit: facility.security_deposit,
//         openingTime: facility.opening_time,
//         closingTime: facility.closing_time,
//         isChargeable: facility.is_chargeable,
//         extraCharges: facility.extra_charges,
//         onMaintenance: facility.on_maintenance || false,
//         maintenanceStart: facility.maintenance_start,
//         maintenanceEnd: facility.maintenance_end,
//         maintenanceReason: facility.maintenance_reason,
//         imageUrl: docMap.get(facility.id) ?? null,
//       }));

//       const responsePayload: Record<string, unknown> = {
//         data: responseData,
//         operation: act,
//       };

//       if (uploadUrl) responsePayload.uploadUrl = uploadUrl;
//       if (documentId) responsePayload.documentId = documentId;

//       logger.info({
//         action: "crud_facility_end",
//         operation: act,
//         count: responseData.length,
//         duration: Date.now() - startTime,
//         message: "Facility CRUD operation completed successfully",
//       });

//       return successResponse(responsePayload);
//     } catch (error: unknown) {
//       const err = error as Error;
//       logger.error({
//         action: "crud_facility_error",
//         error: err.message,
//         stack: err.stack,
//         message: "Facility CRUD operation failed",
//         duration: Date.now() - startTime,
//       });

//       return errorResponse(
//         err.message || "Failed to process facility operation.",
//         400,
//         Deno.env.get("DENO_ENV") === "development" ? err.stack : null
//       );
//     }
//   })
// );

import { createClient, SupabaseClient } from "@supabase/supabase-js";
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
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_SORT_FIELDS = ["name", "created_at", "facility_type"] as const;

const baseLogger = createLogger("crud-facility");

const logger = {
  info: (data: Record<string, unknown>) =>
    baseLogger.info({
      level: "info",
      timestamp: new Date().toISOString(),
      ...data,
    }),
  warn: (data: Record<string, unknown>) =>
    baseLogger.warn({
      level: "warn",
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
interface FacilityPayload {
  name?: string;
  type?: string;
  description?: string;
  rules?: string | string[] | null;
  bookingMode?: string;
  closedDays?: string | string[] | null;
  basePrice?: number | null;
  //securityDeposit?: number | null;
  openingTime?: string | null;
  closingTime?: string | null;
  isChargeable?: boolean | null;
 // extraCharges?: number | null;
  onMaintenance?: boolean;
  maintenanceStart?: string | null;
  maintenanceEnd?: string | null;
  maintenanceReason?: string | null;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  deleteImage?: boolean;
}

interface CreateFacilityRequest {
  registrationNumber: string;
  adminPhone: string;
  action: "VIEW" | "CREATE" | "UPDATE" | "DELETE";
  id?: string;
  payload?: FacilityPayload;

  // ── VIEW options ──
  search?: string;
  filters?: {
    facilityType?: string | string[];
    bookingMode?: string | string[];
    isChargeable?: boolean | string;
    onMaintenance?: boolean | string;
  };
  sort?: {
    field?: string;
    order?: "asc" | "desc";
  };
  page?: number;
  limit?: number;
}

interface FacilityResponse {
  id: string;
  societyRegistrationNumber: string;
  name: string | null;
  type: string | null;
  description: string | null;
  rules: string | null;
  bookingMode: string | null;
  closedDays: string | null;
  basePrice: number | null;
  //securityDeposit: number | null;
  openingTime: string | null;
  closingTime: string | null;
  isChargeable: boolean | null;
 // extraCharges: number | null;
  onMaintenance: boolean;
  maintenanceStart: string | null;
  maintenanceEnd: string | null;
  maintenanceReason: string | null;
  imageUrl: string | null;
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

interface DBContact {
  phone: string | null;
}

interface DBSocietyUser {
  role: string | string[] | null;
  SSP_Contact: DBContact | DBContact[] | null;
}

interface DBFacility {
  id: string;
  name: string | null;
  facility_type: string | null;
  description: string | null;
  rules: string | null;
  booking_mode: string | null;
  closed_days: string | null;
  base_price: number | null;
 // security_deposit: number | null;
  opening_time: string | null;
  closing_time: string | null;
  is_chargeable: boolean | null;
 // extra_charges: number | null;
  on_maintenance: boolean | null;
  maintenance_start: string | null;
  maintenance_end: string | null;
  maintenance_reason: string | null;
}

interface DBDocument {
  document_id: string;
  file_name: string | null;
  facility: string | null;
  s3_path: string | null;
}

// ============================================
// PICKLIST NORMALIZER
// ============================================

type PicklistMap = Map<string, Set<string>>;

function normalizeKey(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadPicklists(
  supabase: SupabaseClient,
  keys: string[],
): Promise<PicklistMap> {
  const map: PicklistMap = new Map();
  for (const k of keys) map.set(k, new Set());

  if (keys.length === 0) return map;

  const tables = new Set<string>();
  for (const k of keys) {
    const [t] = k.split(".");
    tables.add(t);
  }

  const { data, error } = await supabase
    .from("SSP_Picklist_Config")
    .select("table_name, field_name, value")
    .eq("is_active", true)
    .eq("language", "en")
    .in("table_name", Array.from(tables));

  if (error) {
    logger.error({
      action: "load_picklists",
      error: error.message,
      message: "Failed to load picklists",
    });
    return map;
  }

  const normLookup: Map<string, Map<string, string>> = new Map();
  for (const row of data ?? []) {
    const key = `${row.table_name}.${row.field_name}`;
    if (!normLookup.has(key)) normLookup.set(key, new Map());
    normLookup.get(key)!.set(normalizeKey(row.value), row.value);
    map.get(key)?.add(row.value);
  }

  (map as any).__norm = normLookup;
  return map;
}

function resolvePicklistValue(
  map: PicklistMap,
  table: string,
  field: string,
  input: unknown,
  fallbackIfInvalid: string | null = null,
): string | null {
  if (input === null || input === undefined) return fallbackIfInvalid;
  const raw = String(input).trim();
  if (raw === "") return fallbackIfInvalid;

  const key = `${table}.${field}`;
  const values = map.get(key);
  const normLookup: Map<string, string> | undefined = (map as any).__norm?.get(
    key,
  );

  if (!values || values.size === 0) {
    return raw;
  }

  if (values.has(raw)) return raw;

  if (normLookup) {
    const canon = normLookup.get(normalizeKey(raw));
    if (canon) return canon;
  }

  logger.warn({
    action: "resolve_picklist_value",
    table,
    field,
    input: raw,
    message: `Value "${raw}" not in picklist for ${key}. Storing NULL.`,
  });
  return fallbackIfInvalid;
}

const PICKLIST_KEYS = [
  "SSP_Facility.facility_type",
  "SSP_Facility.booking_mode",
  "SSP_Facility.closed_days",
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function toTextValue(
  value: string | string[] | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.join(", ");
  }
  return String(value).trim() || null;
}

function cleanPhoneString(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

function isAdmin(role: unknown): boolean {
  const roles = Array.isArray(role)
    ? role.map((r) => String(r).toLowerCase())
    : String(role || "")
      .toLowerCase()
      .replace(/[{}"]/g, "")
      .split(",")
      .filter(Boolean);
  return roles.includes("admin");
}

// ============================================
// STORAGE HELPERS
// ============================================

async function deleteFacilityImage(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<void> {
  try {
    logger.info({
      action: "delete_facility_image",
      facilityId,
      message: "Deleting facility images",
    });

    const { data: existingDocs, error: fetchErr } = await supabase
      .from("SSP_Document")
      .select("document_id, file_name")
      .eq("facility", facilityId);

    if (fetchErr) {
      logger.error({
        action: "delete_facility_image",
        facilityId,
        error: fetchErr.message,
        message: "Failed to fetch existing documents",
      });
      throw fetchErr;
    }

    const docs = (existingDocs as DBDocument[]) || [];

    if (docs.length > 0) {
      for (const doc of docs) {
        if (doc.file_name) {
          const { error: storageErr } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([doc.file_name]);

          if (storageErr) {
            logger.warn({
              action: "delete_facility_image",
              facilityId,
              fileName: doc.file_name,
              error: storageErr.message,
              message: "Failed to delete from storage",
            });
          }
        }

        const { error: deleteErr } = await supabase
          .from("SSP_Document")
          .delete()
          .eq("document_id", doc.document_id);

        if (deleteErr) {
          logger.error({
            action: "delete_facility_image",
            facilityId,
            documentId: doc.document_id,
            error: deleteErr.message,
            message: "Failed to delete document record",
          });
          throw deleteErr;
        }
      }
    }

    logger.info({
      action: "delete_facility_image",
      facilityId,
      message: "Facility images deleted successfully",
      count: docs.length,
    });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({
      action: "delete_facility_image",
      facilityId,
      error: err.message,
      message: "Error deleting facility images",
    });
    throw error;
  }
}

async function createFacilityImageSignedUrl(
  supabase: SupabaseClient,
  facilityId: string,
  societyId: string,
  regNum: string,
  fileName: string,
  fileType: string,
  fileSize?: number,
): Promise<{ uploadUrl: string; documentId: string }> {
  try {
    logger.info({
      action: "create_upload_url",
      facilityId,
      fileName,
      message: "Creating signed upload URL",
    });

    await deleteFacilityImage(supabase, facilityId);

    const cleanFileName = fileName.replace(/\s+/g, "_");
    const objectKey =
      `${regNum}/facilities/${facilityId}/${Date.now()}_${cleanFileName}`;

    const { data: uploadUrlData, error: storageErr } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(objectKey);

    if (storageErr || !uploadUrlData?.signedUrl) {
      logger.error({
        action: "create_upload_url",
        facilityId,
        error: storageErr?.message || "No signed URL returned",
        message: "Failed to create signed URL",
      });
      throw new Error(
        `Signed URL Creation Failed: ${
          storageErr?.message || "Internal error"
        }`,
      );
    }

    const { data: urlInfo } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(objectKey);

    const { data: doc, error: docErr } = await supabase
      .from("SSP_Document")
      .insert({
        name: fileName,
        file_name: objectKey,
        file_type: fileType,
        file_size: fileSize ? parseFloat(String(fileSize)) : null,
        // ✅ FIXED: was "Facility Attachment" — must match picklist value
        document_type: "facility_attachment",
        s3_path: urlInfo.publicUrl,
        society: societyId,
        facility: facilityId,
        uploaded_on: new Date().toISOString(),
      })
      .select("document_id")
      .single();

    if (docErr || !doc) {
      logger.error({
        action: "create_upload_url",
        facilityId,
        error: docErr?.message,
        message: "Failed to register document",
      });
      throw new Error(
        `SSP_Document Registration Failed: ${docErr?.message || "DB failure"}`,
      );
    }

    logger.info({
      action: "create_upload_url",
      facilityId,
      documentId: doc.document_id,
      message: "Upload URL created successfully",
    });

    return {
      uploadUrl: uploadUrlData.signedUrl,
      documentId: doc.document_id,
    };
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({
      action: "create_upload_url",
      facilityId,
      error: err.message,
      message: "Failed to create upload URL",
    });
    throw error;
  }
}

// ============================================
// AUTH AUTHORIZATION HELPER
// ============================================

async function authorizeAdmin(
  supabase: SupabaseClient,
  registrationNumber: string,
  adminPhone: string,
): Promise<{ societyId: string; societyName: string } | null> {
  try {
    const cleanRegNum = String(registrationNumber).trim();
    const targetPhone = cleanPhoneString(adminPhone);

    const { data: society, error: socErr } = await supabase
      .from("SSP_Society")
      .select("society_id, society_name, registration_number")
      .eq("registration_number", cleanRegNum)
      .maybeSingle();

    if (socErr || !society) {
      logger.warn({
        action: "authorize_admin",
        registrationNumber: cleanRegNum,
        message: "Society not found",
        error: socErr?.message,
      });
      return null;
    }

    const { data: admins, error: adminErr } = await supabase
      .from("SSP_Society_User")
      .select("role, SSP_Contact!contact (phone)")
      .eq("society", society.society_id);

    if (adminErr) {
      logger.error({
        action: "authorize_admin",
        societyId: society.society_id,
        error: adminErr.message,
        message: "Failed to fetch admins",
      });
      return null;
    }

    const adminList = (admins as unknown as DBSocietyUser[]) || [];

    const isAuthorized = adminList.some((user) => {
      if (!isAdmin(user.role)) return false;

      const contact = Array.isArray(user.SSP_Contact)
        ? user.SSP_Contact[0]
        : user.SSP_Contact;

      const dbPhone = contact?.phone
        ? cleanPhoneString(String(contact.phone))
        : "";
      return (
        dbPhone !== "" &&
        (targetPhone.includes(dbPhone) || dbPhone.includes(targetPhone))
      );
    });

    if (!isAuthorized) {
      logger.warn({
        action: "authorize_admin",
        societyId: society.society_id,
        adminPhone: targetPhone,
        message: "Unauthorized admin access",
      });
      return null;
    }

    logger.info({
      action: "authorize_admin",
      societyId: society.society_id,
      message: "Admin authorized successfully",
    });

    return {
      societyId: society.society_id,
      societyName: society.society_name || "NA",
    };
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({
      action: "authorize_admin",
      registrationNumber,
      error: err.message,
      message: "Authorization error",
    });
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx = (req as AuthenticatedRequest).authContext;
    const startTime = Date.now();

    try {
      logger.info({
        action: "crud_facility_start",
        userId: authCtx?.user?.id ?? "unknown",
        method: req.method,
        message: "Facility CRUD operation started",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const {
        registrationNumber,
        adminPhone,
        action,
        id,
        payload,
        // ── VIEW options ──
        search,
        filters,
        sort,
        page,
        limit,
      }: CreateFacilityRequest = body;

      if (!registrationNumber || !adminPhone || !action) {
        return errorResponse(
          "Missing required parameters: registrationNumber, adminPhone, action are mandatory.",
          400,
        );
      }

      const validActions = ["VIEW", "CREATE", "UPDATE", "DELETE"];
      const act = String(action).toUpperCase() as
        | "VIEW"
        | "CREATE"
        | "UPDATE"
        | "DELETE";
      if (!validActions.includes(act)) {
        return errorResponse(
          `Invalid action. Must be one of: ${validActions.join(", ")}`,
          400,
        );
      }

      if ((act === "UPDATE" || act === "DELETE") && !id) {
        return errorResponse(
          `ID parameter is required for ${act} operation.`,
          400,
        );
      }

      const authResult = await authorizeAdmin(
        supabaseAdmin,
        registrationNumber,
        adminPhone,
      );

      if (!authResult) {
        return errorResponse("Unauthorized Admin Access.", 403);
      }

      const { societyId } = authResult;

      // ✅ Load picklists once for this request
      const picklists = await loadPicklists(supabaseAdmin, PICKLIST_KEYS);

      let dbFacilities: DBFacility[] = [];
      let uploadUrl: string | null = null;
      let documentId: string | null = null;
      let viewPagination:
        | { page: number; limit: number; total: number }
        | null = null;

      // ============================================
      // EXECUTE OPERATION
      // ============================================
      if (act === "VIEW") {
        logger.info({
          action: "facility_view",
          societyId,
          facilityId: id ?? null,
          message: "Fetching facilities",
        });

        if (id) {
          // ── Single facility by ID ──
          const { data, error } = await supabaseAdmin
            .from("SSP_Facility")
            .select("*")
            .eq("id", id)
            .eq("society", societyId)
            .maybeSingle();

          if (error) throw error;
          if (!data) {
            return errorResponse("Facility not found.", 404);
          }

          dbFacilities = [data as DBFacility];
        } else {
          // ── List all with pagination + filters ──
          const pageNum = Math.max(1, Number(page) || 1);
          const limitNum = Math.min(
            MAX_LIMIT,
            Math.max(1, Number(limit) || DEFAULT_LIMIT),
          );
          const offset = (pageNum - 1) * limitNum;

          let query = supabaseAdmin
            .from("SSP_Facility")
            .select("*", { count: "exact" })
            .eq("society", societyId);

          // Search across name + description
          if (search && String(search).trim() !== "") {
            const term = escapeLikePattern(String(search).trim());
            query = query.or(
              `name.ilike.%${term}%,description.ilike.%${term}%`,
            );
          }

          // Filters
          if (filters?.facilityType) {
            const types = Array.isArray(filters.facilityType)
              ? filters.facilityType
              : [filters.facilityType];
            const clean = types.map((t) => String(t).trim()).filter(Boolean);
            if (clean.length > 0) {
              query = query.in("facility_type", clean);
            }
          }

          if (filters?.bookingMode) {
            const modes = Array.isArray(filters.bookingMode)
              ? filters.bookingMode
              : [filters.bookingMode];
            const clean = modes.map((m) => String(m).trim()).filter(Boolean);
            if (clean.length > 0) {
              query = query.in("booking_mode", clean);
            }
          }

          if (filters?.isChargeable !== undefined) {
            const isChargeable =
              typeof filters.isChargeable === "boolean"
                ? filters.isChargeable
                : String(filters.isChargeable).toLowerCase() === "true";
            query = query.eq("is_chargeable", isChargeable);
          }

          if (filters?.onMaintenance !== undefined) {
            const onMaintenance =
              typeof filters.onMaintenance === "boolean"
                ? filters.onMaintenance
                : String(filters.onMaintenance).toLowerCase() === "true";
            query = query.eq("on_maintenance", onMaintenance);
          }

          // Sort
          const requestedSortField = sort?.field || "name";
          const sortField = (VALID_SORT_FIELDS as readonly string[]).includes(
              requestedSortField,
            )
            ? requestedSortField
            : "name";
          const ascending = sort?.order === "asc";
          query = query.order(sortField, { ascending });

          // Paginate
          query = query.range(offset, offset + limitNum - 1);

          const { data, error, count } = await query;
          if (error) throw error;

          dbFacilities = (data as DBFacility[]) || [];

          viewPagination = {
            page: pageNum,
            limit: limitNum,
            total: count ?? 0,
          };
        }

        // Fall through to the shared response builder below —
        // it already fetches image URLs via `docMap` and formats
        // each row into `FacilityResponse`.
      } else if (act === "CREATE") {
        logger.info({
          action: "facility_create",
          societyId,
          message: "Creating new facility",
        });

        // ✅ Normalize picklist-backed fields
        const normFacilityType = resolvePicklistValue(
          picklists,
          "SSP_Facility",
          "facility_type",
          payload?.type,
        );
        const normBookingMode = resolvePicklistValue(
          picklists,
          "SSP_Facility",
          "booking_mode",
          payload?.bookingMode,
        );

        // closed_days is a comma-joined string in this table — normalize each element
        let normClosedDays: string | null = null;
        const closedDaysRaw = toTextValue(payload?.closedDays);
        if (closedDaysRaw) {
          const parts = closedDaysRaw.split(",").map((s) => s.trim()).filter(
            Boolean,
          );
          const normalized = parts
            .map((p) =>
              resolvePicklistValue(picklists, "SSP_Facility", "closed_days", p)
            )
            .filter((v): v is string => v !== null);
          normClosedDays = normalized.length > 0 ? normalized.join(", ") : null;
        }

        const insertPayload: Record<string, unknown> = {
          society: societyId,
          name: payload?.name ?? null,
          facility_type: normFacilityType,
          description: payload?.description ?? null,
          rules: toTextValue(payload?.rules),
          booking_mode: normBookingMode,
          closed_days: normClosedDays,
          base_price: payload?.basePrice ?? null,
         // security_deposit: payload?.securityDeposit ?? null,
          opening_time: payload?.openingTime ?? null,
          closing_time: payload?.closingTime ?? null,
          is_chargeable: payload?.isChargeable ?? null,
         // extra_charges: payload?.extraCharges ?? null,
          on_maintenance: payload?.onMaintenance ?? false,
          maintenance_start: payload?.maintenanceStart ?? null,
          maintenance_end: payload?.maintenanceEnd ?? null,
          maintenance_reason: payload?.maintenanceReason ?? null,
        };

        const { data, error } = await supabaseAdmin
          .from("SSP_Facility")
          .insert(insertPayload)
          .select();

        if (error) throw error;
        dbFacilities = (data as DBFacility[]) || [];

        const createdFacility = dbFacilities[0];
        logger.info({
          action: "facility_create",
          facilityId: createdFacility.id,
          message: "Facility created successfully",
        });

        if (payload?.fileName && payload?.fileType) {
          const uploadDetails = await createFacilityImageSignedUrl(
            supabaseAdmin,
            createdFacility.id,
            societyId,
            String(registrationNumber).trim(),
            payload.fileName,
            payload.fileType,
            payload.fileSize,
          );
          uploadUrl = uploadDetails.uploadUrl;
          documentId = uploadDetails.documentId;
        }
      } else if (act === "UPDATE") {
        logger.info({
          action: "facility_update",
          facilityId: id,
          societyId,
          message: "Updating facility",
        });

        const updatePayload: Record<string, unknown> = {};

        if (payload?.name !== undefined) updatePayload.name = payload.name;

        if (payload?.type !== undefined) {
          updatePayload.facility_type = resolvePicklistValue(
            picklists,
            "SSP_Facility",
            "facility_type",
            payload.type,
          );
        }

        if (payload?.description !== undefined) {
          updatePayload.description = payload.description;
        }

        if (payload?.rules !== undefined) {
          updatePayload.rules = toTextValue(payload.rules);
        }

        if (payload?.bookingMode !== undefined) {
          updatePayload.booking_mode = resolvePicklistValue(
            picklists,
            "SSP_Facility",
            "booking_mode",
            payload.bookingMode,
          );
        }

        if (payload?.closedDays !== undefined) {
          const raw = toTextValue(payload.closedDays);
          if (raw) {
            const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
            const normalized = parts
              .map((p) =>
                resolvePicklistValue(
                  picklists,
                  "SSP_Facility",
                  "closed_days",
                  p,
                )
              )
              .filter((v): v is string => v !== null);
            updatePayload.closed_days = normalized.length > 0
              ? normalized.join(", ")
              : null;
          } else {
            updatePayload.closed_days = null;
          }
        }

        if (payload?.basePrice !== undefined) {
          updatePayload.base_price = payload.basePrice;
        }
       /*  if (payload?.securityDeposit !== undefined) {
          updatePayload.security_deposit = payload.securityDeposit;
        } */
        if (payload?.openingTime !== undefined) {
          updatePayload.opening_time = payload.openingTime;
        }
        if (payload?.closingTime !== undefined) {
          updatePayload.closing_time = payload.closingTime;
        }
        if (payload?.isChargeable !== undefined) {
          updatePayload.is_chargeable = payload.isChargeable;
        }
        /* if (payload?.extraCharges !== undefined) {
          updatePayload.extra_charges = payload.extraCharges;
        } */
        if (payload?.onMaintenance !== undefined) {
          updatePayload.on_maintenance = payload.onMaintenance;
        }
        if (payload?.maintenanceStart !== undefined) {
          updatePayload.maintenance_start = payload.maintenanceStart;
        }
        if (payload?.maintenanceEnd !== undefined) {
          updatePayload.maintenance_end = payload.maintenanceEnd;
        }
        if (payload?.maintenanceReason !== undefined) {
          updatePayload.maintenance_reason = payload.maintenanceReason;
        }

        if (Object.keys(updatePayload).length > 0) {
          const { data, error } = await supabaseAdmin
            .from("SSP_Facility")
            .update(updatePayload)
            .eq("id", id)
            .eq("society", societyId)
            .select();

          if (error) throw error;
          dbFacilities = (data as DBFacility[]) || [];
        } else {
          const { data, error } = await supabaseAdmin
            .from("SSP_Facility")
            .select("*")
            .eq("id", id)
            .eq("society", societyId);

          if (error) throw error;
          dbFacilities = (data as DBFacility[]) || [];
        }

        if (dbFacilities.length === 0) {
          return errorResponse("Facility not found or access denied.", 404);
        }

        logger.info({
          action: "facility_update",
          facilityId: id,
          message: "Facility updated successfully",
        });

        if (payload?.deleteImage) {
          await deleteFacilityImage(supabaseAdmin, id!);
        }

        if (payload?.fileName && payload?.fileType) {
          const uploadDetails = await createFacilityImageSignedUrl(
            supabaseAdmin,
            id!,
            societyId,
            String(registrationNumber).trim(),
            payload.fileName,
            payload.fileType,
            payload.fileSize,
          );
          uploadUrl = uploadDetails.uploadUrl;
          documentId = uploadDetails.documentId;
        }
      } else if (act === "DELETE") {
        logger.info({
          action: "facility_delete",
          facilityId: id,
          societyId,
          message: "Deleting facility",
        });

        await deleteFacilityImage(supabaseAdmin, id!);

        const { data, error } = await supabaseAdmin
          .from("SSP_Facility")
          .delete()
          .eq("id", id)
          .eq("society", societyId)
          .select();

        if (error) throw error;
        dbFacilities = (data as DBFacility[]) || [];

        if (dbFacilities.length === 0) {
          return errorResponse("Facility not found or access denied.", 404);
        }

        logger.info({
          action: "facility_delete",
          facilityId: id,
          message: "Facility deleted successfully",
        });

        return successResponse({
          message: "Facility and associated documents deleted successfully.",
          deleted: true,
        });
      }

      // Fetch images for response
      const facilityIds = dbFacilities.map((f) => f.id);
      let docMap = new Map<string, string>();

      if (facilityIds.length > 0) {
        const { data: docRecords } = await supabaseAdmin
          .from("SSP_Document")
          .select("facility, s3_path")
          .in("facility", facilityIds);

        const docs = (docRecords as DBDocument[]) || [];
        docMap = new Map(
          docs
            .filter((d) => d.facility && d.s3_path)
            .map((d) => [d.facility as string, d.s3_path as string]),
        );
      }

      // Build response payload
      const responseData: FacilityResponse[] = dbFacilities.map((facility) => ({
        id: facility.id,
        societyRegistrationNumber: String(registrationNumber).trim(),
        name: facility.name,
        type: facility.facility_type,
        description: facility.description,
        rules: facility.rules,
        bookingMode: facility.booking_mode,
        closedDays: facility.closed_days,
        basePrice: facility.base_price,
        //securityDeposit: facility.security_deposit,
        openingTime: facility.opening_time,
        closingTime: facility.closing_time,
        isChargeable: facility.is_chargeable,
        //extraCharges: facility.extra_charges,
        onMaintenance: facility.on_maintenance || false,
        maintenanceStart: facility.maintenance_start,
        maintenanceEnd: facility.maintenance_end,
        maintenanceReason: facility.maintenance_reason,
        imageUrl: docMap.get(facility.id) ?? null,
      }));

      const responsePayload: Record<string, unknown> = {
        data: responseData,
        operation: act,
      };

      if (uploadUrl) responsePayload.uploadUrl = uploadUrl;
      if (documentId) responsePayload.documentId = documentId;

      // Add pagination info for VIEW without id
      if (viewPagination) {
        responsePayload.pagination = {
          total: viewPagination.total,
          page: viewPagination.page,
          limit: viewPagination.limit,
          totalPages: Math.ceil(
            viewPagination.total / viewPagination.limit,
          ),
          hasNextPage:
            viewPagination.page * viewPagination.limit <
            viewPagination.total,
          hasPrevPage: viewPagination.page > 1,
        };
      }

      logger.info({
        action: "crud_facility_end",
        operation: act,
        count: responseData.length,
        duration: Date.now() - startTime,
        message: "Facility CRUD operation completed successfully",
      });

      return successResponse(responsePayload);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "crud_facility_error",
        error: err.message,
        stack: err.stack,
        message: "Facility CRUD operation failed",
        duration: Date.now() - startTime,
      });

      return errorResponse(
        err.message || "Failed to process facility operation.",
        400,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);