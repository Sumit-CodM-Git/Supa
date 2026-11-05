// // deno-lint-ignore-file no-import-prefix
// // ============================================
// // crud-staff - Society Staff CRUD
// // ============================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================

// type EmergencyCategory =
//   | "stuck_in_lift"
//   | "medical_emergency"
//   | "gas_fire"
//   | "theft_other";

// interface CrudStaffRequest {
//   societyRegistrationNumber: string;
//   adminId: string;
//   action: "VIEW" | "CREATE" | "UPDATE" | "DELETE";

//   search?: string;
//   filters?: {
//     role?: string | string[];
//     availabilityStatus?: string | string[];
//     isEmergencyContact?: boolean | string;
//     emergencyCategory?: string | string[];
//     shiftTiming?: string | string[];
//   };
//   sort?: {
//     field?: string;
//     order?: "asc" | "desc";
//   };
//   page?: number;
//   limit?: number;

//   staffId?: string;
//   payload?: {
//     name?: string;
//     phone?: string;
//     alternatePhone?: string | null;
//     role?: string;
//     isEmergencyContact?: boolean;
//     shiftTiming?: string | null;
//     availabilityStatus?: string | null;
//     idProofType?: string | null;
//     idProofNumber?: string | null;
//     address?: string | null;
//     emergencyCategory?: string | null;
//     fcmToken?: string | null;
//   };
// }

// interface StaffRow {
//   staff_id: string;
//   created_at: string;
//   society_id: string;
//   staff_name: string;
//   phone_number: string;
//   alternate_phone: string | null;
//   staff_role: string;
//   is_emergency_contact: boolean | null;
//   shift_timing: string | null;
//   availability_status: string | null;
//   id_proof_type: string | null;
//   id_proof_number: string | null;
//   address: string | null;
//   emergency_category: string | null;
//   fcm_token: string | null;
// }

// interface FormattedStaff {
//   staffId: string;
//   name: string;
//   phone: string;
//   alternatePhone: string | null;
//   role: string;
//   isEmergencyContact: boolean;
//   shiftTiming: string | null;
//   availabilityStatus: string;
//   idProofType: string | null;
//   idProofNumber: string | null;
//   address: string | null;
//   emergencyCategory: string | null;
//   fcmToken: string | null;
//   createdAt: string;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers":
//     "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "POST, OPTIONS",
// };

// const DEFAULT_LIMIT = 20;
// const MAX_LIMIT = 100;
// const VALID_ACTIONS = ["VIEW", "CREATE", "UPDATE", "DELETE"] as const;
// const VALID_SORT_FIELDS = [
//   "staff_name",
//   "created_at",
//   "staff_role",
//   "availability_status",
//   "is_emergency_contact",
// ] as const;

// const VALID_EMERGENCY_CATEGORIES: readonly EmergencyCategory[] = [
//   "stuck_in_lift",
//   "medical_emergency",
//   "gas_fire",
//   "theft_other",
// ] as const;

// const ADMIN_ROLE = "admin";
// const STAFF_SELECT_FIELDS =
//   "staff_id,created_at,society_id,staff_name,phone_number,alternate_phone,staff_role,is_emergency_contact,shift_timing,availability_status,id_proof_type,id_proof_number,address,emergency_category,fcm_token";

// const supabase = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// // ============================================
// // HELPERS
// // ============================================

// function respond(data: unknown, status = 200): Response {
//   return new Response(
//     JSON.stringify({ status: "SUCCESS", data }),
//     {
//       status,
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//     },
//   );
// }

// function fail(message: string, status = 400, code = "ERROR"): Response {
//   return new Response(
//     JSON.stringify({
//       status: "FAILURE",
//       errorResponse: { errorCode: code, message },
//     }),
//     {
//       status,
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//     },
//   );
// }

// function normalizeArray(input: string | string[] | undefined): string[] | null {
//   if (!input) return null;
//   if (Array.isArray(input)) {
//     const cleaned = input.filter((x) => x && String(x).trim() !== "");
//     return cleaned.length > 0 ? cleaned : null;
//   }
//   const trimmed = String(input).trim();
//   if (!trimmed) return null;
//   if (trimmed.includes(",")) {
//     const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
//     return parts.length > 0 ? parts : null;
//   }
//   return [trimmed];
// }

// function normalizeBoolean(
//   value: boolean | string | undefined | null,
// ): boolean | null {
//   if (value === undefined || value === null) return null;
//   if (typeof value === "boolean") return value;
//   if (typeof value === "string") {
//     const lower = value.toLowerCase().trim();
//     if (lower === "true" || lower === "1") return true;
//     if (lower === "false" || lower === "0") return false;
//   }
//   return null;
// }

// function validateEmergencyCategory(
//   value: unknown,
// ): { ok: true; value: EmergencyCategory | null } | { ok: false } {
//   if (value === undefined || value === null || value === "") {
//     return { ok: true, value: null };
//   }
//   const str = String(value).trim();
//   if (VALID_EMERGENCY_CATEGORIES.includes(str as EmergencyCategory)) {
//     return { ok: true, value: str as EmergencyCategory };
//   }
//   return { ok: false };
// }

// function formatStaff(row: StaffRow): FormattedStaff {
//   return {
//     staffId: row.staff_id,
//     name: row.staff_name,
//     phone: row.phone_number,
//     alternatePhone: row.alternate_phone,
//     role: row.staff_role,
//     isEmergencyContact: row.is_emergency_contact ?? false,
//     shiftTiming: row.shift_timing,
//     availabilityStatus: row.availability_status ?? "available",
//     idProofType: row.id_proof_type,
//     idProofNumber: row.id_proof_number,
//     address: row.address,
//     emergencyCategory: row.emergency_category,
//     fcmToken: row.fcm_token,
//     createdAt: row.created_at,
//   };
// }

// function isValidUUID(value: string): boolean {
//   return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
//     .test(value);
// }

// function isValidPhone(phone: string): boolean {
//   return /^\d{10,15}$/.test(phone);
// }

// function cleanPhone(p: unknown): string {
//   return String(p ?? "").trim().replace(/\D/g, "");
// }

// // ============================================
// // AUTH
// // ============================================

// async function authorizeAdmin(
//   societyRegistrationNumber: string,
//   adminId: string,
// ): Promise<
//   { ok: true; societyId: string } | { ok: false; response: Response }
// > {
//   const cleanRegNum = String(societyRegistrationNumber).trim();
//   const cleanAdminId = String(adminId).trim();

//   if (!isValidUUID(cleanAdminId)) {
//     return {
//       ok: false,
//       response: fail(
//         "adminId must be a valid UUID.",
//         400,
//         "INVALID_PARAMETERS",
//       ),
//     };
//   }

//   const { data: society, error: societyErr } = await supabase
//     .from("SSP_Society")
//     .select("society_id")
//     .eq("registration_number", cleanRegNum)
//     .maybeSingle();

//   if (societyErr) {
//     return {
//       ok: false,
//       response: fail(societyErr.message, 500, "DATABASE_ERROR"),
//     };
//   }
//   if (!society) {
//     return {
//       ok: false,
//       response: fail("Society not found.", 404, "NOT_FOUND"),
//     };
//   }

//   const { data: admin, error: adminErr } = await supabase
//     .from("SSP_Society_User")
//     .select("user_id, role")
//     .eq("user_id", cleanAdminId)
//     .eq("society", society.society_id)
//     .contains("role", [ADMIN_ROLE])
//     .maybeSingle();

//   if (adminErr) {
//     return {
//       ok: false,
//       response: fail(adminErr.message, 500, "DATABASE_ERROR"),
//     };
//   }

//   if (!admin) {
//     return {
//       ok: false,
//       response: fail("Unauthorized Admin Access.", 403, "UNAUTHORIZED"),
//     };
//   }

//   return { ok: true, societyId: society.society_id };
// }

// // ============================================
// // ACTION HANDLERS
// // ============================================

// async function handleView(
//   req: CrudStaffRequest,
//   societyId: string,
// ): Promise<Response> {
//   const page = Math.max(1, Number(req.page) || 1);
//   const limit = Math.min(
//     MAX_LIMIT,
//     Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
//   );
//   const offset = (page - 1) * limit;

//   let query = supabase
//     .from("SSP_Society_Staff")
//     .select(STAFF_SELECT_FIELDS, { count: "exact" })
//     .eq("society_id", societyId);

//   if (req.search && req.search.trim() !== "") {
//     const term = req.search.trim();
//     query = query.or(
//       `staff_name.ilike.%${term}%,phone_number.ilike.%${term}%`,
//     );
//   }

//   if (req.filters) {
//     const roles = normalizeArray(req.filters.role);
//     if (roles && roles.length > 0) {
//       query = query.in("staff_role", roles);
//     }

//     const statuses = normalizeArray(req.filters.availabilityStatus);
//     if (statuses && statuses.length > 0) {
//       query = query.in("availability_status", statuses);
//     }

//     const shifts = normalizeArray(req.filters.shiftTiming);
//     if (shifts && shifts.length > 0) {
//       query = query.in("shift_timing", shifts);
//     }

//     const categories = normalizeArray(req.filters.emergencyCategory);
//     if (categories && categories.length > 0) {
//       const invalidCategories = categories.filter(
//         (c) => !VALID_EMERGENCY_CATEGORIES.includes(c as EmergencyCategory),
//       );
//       if (invalidCategories.length > 0) {
//         return fail(
//           `Invalid emergencyCategory value(s): ${
//             invalidCategories.join(", ")
//           }. Valid values: ${VALID_EMERGENCY_CATEGORIES.join(", ")}`,
//           400,
//           "INVALID_PARAMETERS",
//         );
//       }
//       query = query.in("emergency_category", categories);
//     }

//     const emergencyFilter = normalizeBoolean(req.filters.isEmergencyContact);
//     if (emergencyFilter !== null) {
//       query = query.eq("is_emergency_contact", emergencyFilter);
//     }
//   }

//   const requestedSortField = req.sort?.field || "created_at";
//   const sortField = VALID_SORT_FIELDS.includes(
//       requestedSortField as typeof VALID_SORT_FIELDS[number],
//     )
//     ? requestedSortField
//     : "created_at";
//   const ascending = req.sort?.order === "asc";
//   query = query.order(sortField, { ascending });

//   query = query.range(offset, offset + limit - 1);

//   const { data, error, count } = await query;

//   if (error) {
//     return fail(error.message, 500, "DATABASE_ERROR");
//   }

//   const staff = ((data || []) as StaffRow[]).map(formatStaff);
//   const total = count ?? 0;
//   const totalPages = Math.ceil(total / limit);

//   return respond({
//     staff,
//     pagination: {
//       total,
//       page,
//       limit,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPrevPage: page > 1,
//     },
//     filters: {
//       role: req.filters?.role ?? null,
//       availabilityStatus: req.filters?.availabilityStatus ?? null,
//       isEmergencyContact: req.filters?.isEmergencyContact ?? null,
//       emergencyCategory: req.filters?.emergencyCategory ?? null,
//       shiftTiming: req.filters?.shiftTiming ?? null,
//     },
//     search: req.search ?? null,
//     sort: { field: sortField, order: ascending ? "asc" : "desc" },
//   });
// }

// async function handleCreate(
//   req: CrudStaffRequest,
//   societyId: string,
// ): Promise<Response> {
//   const p = req.payload;
//   if (!p) {
//     return fail("payload is required.", 400, "MISSING_PARAMETERS");
//   }

//   if (!p.name || String(p.name).trim() === "") {
//     return fail("payload.name is required.", 400, "MISSING_PARAMETERS");
//   }
//   if (!p.phone || String(p.phone).trim() === "") {
//     return fail("payload.phone is required.", 400, "MISSING_PARAMETERS");
//   }
//   if (!p.role || String(p.role).trim() === "") {
//     return fail("payload.role is required.", 400, "MISSING_PARAMETERS");
//   }

//   const phone = cleanPhone(p.phone);
//   if (!isValidPhone(phone)) {
//     return fail("phone must be 10-15 digits.", 400, "INVALID_PARAMETERS");
//   }

//   const alternatePhone = p.alternatePhone ? cleanPhone(p.alternatePhone) : null;
//   if (alternatePhone && !isValidPhone(alternatePhone)) {
//     return fail(
//       "alternatePhone must be 10-15 digits.",
//       400,
//       "INVALID_PARAMETERS",
//     );
//   }

//   const categoryResult = validateEmergencyCategory(p.emergencyCategory);
//   if (!categoryResult.ok) {
//     return fail(
//       `emergencyCategory must be one of: ${
//         VALID_EMERGENCY_CATEGORIES.join(", ")
//       }`,
//       400,
//       "INVALID_PARAMETERS",
//     );
//   }

//   const { data: existing } = await supabase
//     .from("SSP_Society_Staff")
//     .select("staff_id")
//     .eq("society_id", societyId)
//     .eq("phone_number", phone)
//     .maybeSingle();

//   if (existing) {
//     return fail(
//       "A staff member with this phone number already exists.",
//       409,
//       "ALREADY_EXISTS",
//     );
//   }

//   const insertPayload: Record<string, unknown> = {
//     society_id: societyId,
//     staff_name: String(p.name).trim(),
//     phone_number: phone,
//     staff_role: String(p.role).trim(),
//   };

//   if (alternatePhone) insertPayload.alternate_phone = alternatePhone;
//   if (p.isEmergencyContact !== undefined) {
//     insertPayload.is_emergency_contact = Boolean(p.isEmergencyContact);
//   }
//   if (p.shiftTiming !== undefined) {
//     insertPayload.shift_timing = p.shiftTiming
//       ? String(p.shiftTiming).trim()
//       : null;
//   }
//   if (p.availabilityStatus !== undefined) {
//     insertPayload.availability_status = p.availabilityStatus
//       ? String(p.availabilityStatus).trim()
//       : "available";
//   }
//   if (p.idProofType !== undefined) {
//     insertPayload.id_proof_type = p.idProofType
//       ? String(p.idProofType).trim()
//       : null;
//   }
//   if (p.idProofNumber !== undefined) {
//     insertPayload.id_proof_number = p.idProofNumber
//       ? String(p.idProofNumber).trim()
//       : null;
//   }
//   if (p.address !== undefined) {
//     insertPayload.address = p.address ? String(p.address).trim() : null;
//   }

//   if (categoryResult.value) {
//     const isEmergency = insertPayload.is_emergency_contact === true;
//     if (isEmergency) {
//       insertPayload.emergency_category = categoryResult.value;
//     }
//   }

//   if (p.fcmToken !== undefined) {
//     insertPayload.fcm_token = p.fcmToken ? String(p.fcmToken).trim() : null;
//   }

//   const { data, error } = await supabase
//     .from("SSP_Society_Staff")
//     .insert(insertPayload)
//     .select("staff_id,staff_name,phone_number,staff_role,created_at")
//     .single();

//   if (error) {
//     return fail(error.message, 500, "DATABASE_ERROR");
//   }

//   return respond(
//     {
//       staffId: (data as { staff_id: string }).staff_id,
//       name: (data as { staff_name: string }).staff_name,
//       phone: (data as { phone_number: string }).phone_number,
//       role: (data as { staff_role: string }).staff_role,
//       createdAt: (data as { created_at: string }).created_at,
//       message: "Staff created successfully.",
//     },
//     201,
//   );
// }

// async function handleUpdate(
//   req: CrudStaffRequest,
//   societyId: string,
// ): Promise<Response> {
//   if (!req.staffId || String(req.staffId).trim() === "") {
//     return fail("staffId is required for UPDATE.", 400, "MISSING_PARAMETERS");
//   }
//   if (!isValidUUID(String(req.staffId).trim())) {
//     return fail("staffId must be a valid UUID.", 400, "INVALID_PARAMETERS");
//   }
//   if (!req.payload || Object.keys(req.payload).length === 0) {
//     return fail("payload cannot be empty.", 400, "MISSING_PARAMETERS");
//   }

//   const updatePayload: Record<string, unknown> = {};
//   const updatedFields: string[] = [];

//   if (req.payload.name !== undefined) {
//     updatePayload.staff_name = String(req.payload.name).trim();
//     updatedFields.push("name");
//   }
//   if (req.payload.phone !== undefined) {
//     const phone = cleanPhone(req.payload.phone);
//     if (!isValidPhone(phone)) {
//       return fail("phone must be 10-15 digits.", 400, "INVALID_PARAMETERS");
//     }
//     updatePayload.phone_number = phone;
//     updatedFields.push("phone");
//   }
//   if (req.payload.alternatePhone !== undefined) {
//     if (req.payload.alternatePhone) {
//       const alt = cleanPhone(req.payload.alternatePhone);
//       if (!isValidPhone(alt)) {
//         return fail(
//           "alternatePhone must be 10-15 digits.",
//           400,
//           "INVALID_PARAMETERS",
//         );
//       }
//       updatePayload.alternate_phone = alt;
//     } else {
//       updatePayload.alternate_phone = null;
//     }
//     updatedFields.push("alternatePhone");
//   }
//   if (req.payload.role !== undefined) {
//     updatePayload.staff_role = String(req.payload.role).trim();
//     updatedFields.push("role");
//   }
//   if (req.payload.isEmergencyContact !== undefined) {
//     updatePayload.is_emergency_contact = Boolean(
//       req.payload.isEmergencyContact,
//     );
//     updatedFields.push("isEmergencyContact");
//   }
//   if (req.payload.shiftTiming !== undefined) {
//     updatePayload.shift_timing = req.payload.shiftTiming
//       ? String(req.payload.shiftTiming).trim()
//       : null;
//     updatedFields.push("shiftTiming");
//   }
//   if (req.payload.availabilityStatus !== undefined) {
//     updatePayload.availability_status = req.payload.availabilityStatus
//       ? String(req.payload.availabilityStatus).trim()
//       : null;
//     updatedFields.push("availabilityStatus");
//   }
//   if (req.payload.idProofType !== undefined) {
//     updatePayload.id_proof_type = req.payload.idProofType
//       ? String(req.payload.idProofType).trim()
//       : null;
//     updatedFields.push("idProofType");
//   }
//   if (req.payload.idProofNumber !== undefined) {
//     updatePayload.id_proof_number = req.payload.idProofNumber
//       ? String(req.payload.idProofNumber).trim()
//       : null;
//     updatedFields.push("idProofNumber");
//   }
//   if (req.payload.address !== undefined) {
//     updatePayload.address = req.payload.address
//       ? String(req.payload.address).trim()
//       : null;
//     updatedFields.push("address");
//   }
//   if (req.payload.emergencyCategory !== undefined) {
//     const cat = validateEmergencyCategory(req.payload.emergencyCategory);
//     if (!cat.ok) {
//       return fail(
//         `emergencyCategory must be one of: ${
//           VALID_EMERGENCY_CATEGORIES.join(", ")
//         }`,
//         400,
//         "INVALID_PARAMETERS",
//       );
//     }
//     updatePayload.emergency_category = cat.value;
//     updatedFields.push("emergencyCategory");
//   }
//   if (req.payload.fcmToken !== undefined) {
//     updatePayload.fcm_token = req.payload.fcmToken
//       ? String(req.payload.fcmToken).trim()
//       : null;
//     updatedFields.push("fcmToken");
//   }

//   if (Object.keys(updatePayload).length === 0) {
//     return fail("No valid fields to update.", 400, "MISSING_PARAMETERS");
//   }

//   const { data, error } = await supabase
//     .from("SSP_Society_Staff")
//     .update(updatePayload as never)
//     .eq("staff_id", String(req.staffId).trim())
//     .eq("society_id", societyId)
//     .select("staff_id")
//     .maybeSingle();

//   if (error) {
//     return fail(error.message, 500, "DATABASE_ERROR");
//   }
//   if (!data) {
//     return fail("Staff not found in this society.", 404, "NOT_FOUND");
//   }

//   return respond({
//     staffId: req.staffId,
//     updatedFields,
//     message: "Staff updated successfully.",
//   });
// }

// async function handleDelete(
//   req: CrudStaffRequest,
//   societyId: string,
// ): Promise<Response> {
//   if (!req.staffId || String(req.staffId).trim() === "") {
//     return fail("staffId is required for DELETE.", 400, "MISSING_PARAMETERS");
//   }
//   if (!isValidUUID(String(req.staffId).trim())) {
//     return fail("staffId must be a valid UUID.", 400, "INVALID_PARAMETERS");
//   }

//   const { error, count } = await supabase
//     .from("SSP_Society_Staff")
//     .delete({ count: "exact" })
//     .eq("staff_id", String(req.staffId).trim())
//     .eq("society_id", societyId);

//   if (error) {
//     return fail(error.message, 500, "DATABASE_ERROR");
//   }
//   if (!count || count === 0) {
//     return fail("Staff not found in this society.", 404, "NOT_FOUND");
//   }

//   return respond({
//     staffId: req.staffId,
//     message: "Staff deleted successfully.",
//   });
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// serve(async (req: Request) => {
//   if (req.method === "OPTIONS") {
//     return new Response("ok", { headers: corsHeaders });
//   }

//   if (req.method !== "POST") {
//     return fail("Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
//   }

//   try {
//     const body = (await req.json().catch(() => null)) as
//       | CrudStaffRequest
//       | null;
//     if (!body) {
//       return fail("Request body is required.", 400, "BAD_REQUEST");
//     }

//     const { societyRegistrationNumber, adminId, action } = body;

//     if (!societyRegistrationNumber || !adminId || !action) {
//       return fail(
//         "societyRegistrationNumber, adminId, and action are required.",
//         400,
//         "MISSING_PARAMETERS",
//       );
//     }

//     const actionUpper = String(action).toUpperCase();
//     if (!VALID_ACTIONS.includes(actionUpper as typeof VALID_ACTIONS[number])) {
//       return fail(
//         `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
//         400,
//         "INVALID_ACTION",
//       );
//     }

//     const auth = await authorizeAdmin(societyRegistrationNumber, adminId);
//     if (!auth.ok) return auth.response;

//     switch (actionUpper) {
//       case "VIEW":
//         return await handleView(body, auth.societyId);
//       case "CREATE":
//         return await handleCreate(body, auth.societyId);
//       case "UPDATE":
//         return await handleUpdate(body, auth.societyId);
//       case "DELETE":
//         return await handleDelete(body, auth.societyId);
//       default:
//         return fail("Unhandled action.", 400, "INVALID_ACTION");
//     }
//   } catch (err) {
//     const msg = err instanceof Error ? err.message : "Unknown error";
//     console.error("❌ crud-staff error:", msg);
//     return fail(msg, 500, "SERVER_ERROR");
//   }
// });

// deno-lint-ignore-file no-import-prefix
// ============================================
// crud-staff - Society Staff CRUD
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

type EmergencyCategory =
  | "stuck_in_lift"
  | "medical_emergency"
  | "gas_fire"
  | "theft_other";

interface CrudStaffRequest {
  societyRegistrationNumber: string;
  adminId: string;
  action: "VIEW" | "CREATE" | "UPDATE" | "DELETE";

  search?: string;
  filters?: {
    role?: string | string[];
    availabilityStatus?: string | string[];
    isEmergencyContact?: boolean | string;
    emergencyCategory?: string | string[];
    shiftTiming?: string | string[];
  };
  sort?: {
    field?: string;
    order?: "asc" | "desc";
  };
  page?: number;
  limit?: number;

  staffId?: string;
  payload?: {
    name?: string;
    phone?: string;
    alternatePhone?: string | null;
    role?: string;
    isEmergencyContact?: boolean;
    shiftTiming?: string | null;
    availabilityStatus?: string | null;
    idProofType?: string | null;
    idProofNumber?: string | null;
    address?: string | null;
    emergencyCategory?: string | null;
  };
}

interface StaffRow {
  staff_id: string;
  created_at: string;
  society_id: string;
  staff_name: string;
  phone_number: string;
  alternate_phone: string | null;
  staff_role: string;
  is_emergency_contact: boolean | null;
  shift_timing: string | null;
  availability_status: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  address: string | null;
  emergency_category: string | null;
}

interface FormattedStaff {
  staffId: string;
  name: string;
  phone: string;
  alternatePhone: string | null;
  role: string;
  isEmergencyContact: boolean;
  shiftTiming: string | null;
  availabilityStatus: string;
  idProofType: string | null;
  idProofNumber: string | null;
  address: string | null;
  emergencyCategory: string | null;
  createdAt: string;
}

// ============================================
// CONSTANTS
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_ACTIONS = ["VIEW", "CREATE", "UPDATE", "DELETE"] as const;
const VALID_SORT_FIELDS = [
  "staff_name",
  "created_at",
  "staff_role",
  "availability_status",
  "is_emergency_contact",
] as const;

const VALID_EMERGENCY_CATEGORIES: readonly EmergencyCategory[] = [
  "stuck_in_lift",
  "medical_emergency",
  "gas_fire",
  "theft_other",
] as const;

const ADMIN_ROLE = "admin";
const STAFF_SELECT_FIELDS =
  "staff_id,created_at,society_id,staff_name,phone_number,alternate_phone,staff_role,is_emergency_contact,shift_timing,availability_status,id_proof_type,id_proof_number,address,emergency_category";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================

function respond(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ status: "SUCCESS", data }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function fail(message: string, status = 400, code = "ERROR"): Response {
  return new Response(
    JSON.stringify({
      status: "FAILURE",
      errorResponse: { errorCode: code, message },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function normalizeArray(input: string | string[] | undefined): string[] | null {
  if (!input) return null;
  if (Array.isArray(input)) {
    const cleaned = input.filter((x) => x && String(x).trim() !== "");
    return cleaned.length > 0 ? cleaned : null;
  }
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  return [trimmed];
}

function normalizeBoolean(
  value: boolean | string | undefined | null,
): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return null;
}

function validateEmergencyCategory(
  value: unknown,
): { ok: true; value: EmergencyCategory | null } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const str = String(value).trim();
  if (VALID_EMERGENCY_CATEGORIES.includes(str as EmergencyCategory)) {
    return { ok: true, value: str as EmergencyCategory };
  }
  return { ok: false };
}

function formatStaff(row: StaffRow): FormattedStaff {
  return {
    staffId: row.staff_id,
    name: row.staff_name,
    phone: row.phone_number,
    alternatePhone: row.alternate_phone,
    role: row.staff_role,
    isEmergencyContact: row.is_emergency_contact ?? false,
    shiftTiming: row.shift_timing,
    availabilityStatus: row.availability_status ?? "available",
    idProofType: row.id_proof_type,
    idProofNumber: row.id_proof_number,
    address: row.address,
    emergencyCategory: row.emergency_category,
    createdAt: row.created_at,
  };
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(value);
}

function isValidPhone(phone: string): boolean {
  return /^\d{10,15}$/.test(phone);
}

function cleanPhone(p: unknown): string {
  return String(p ?? "").trim().replace(/\D/g, "");
}

// ============================================
// AUTH
// ============================================

async function authorizeAdmin(
  societyRegistrationNumber: string,
  adminId: string,
): Promise<
  { ok: true; societyId: string } | { ok: false; response: Response }
> {
  const cleanRegNum = String(societyRegistrationNumber).trim();
  const cleanAdminId = String(adminId).trim();

  if (!isValidUUID(cleanAdminId)) {
    return {
      ok: false,
      response: fail(
        "adminId must be a valid UUID.",
        400,
        "INVALID_PARAMETERS",
      ),
    };
  }

  const { data: society, error: societyErr } = await supabase
    .from("SSP_Society")
    .select("society_id")
    .eq("registration_number", cleanRegNum)
    .maybeSingle();

  if (societyErr) {
    return {
      ok: false,
      response: fail(societyErr.message, 500, "DATABASE_ERROR"),
    };
  }
  if (!society) {
    return {
      ok: false,
      response: fail("Society not found.", 404, "NOT_FOUND"),
    };
  }

  const { data: admin, error: adminErr } = await supabase
    .from("SSP_Society_User")
    .select("user_id, role")
    .eq("user_id", cleanAdminId)
    .eq("society", society.society_id)
    .contains("role", [ADMIN_ROLE])
    .maybeSingle();

  if (adminErr) {
    return {
      ok: false,
      response: fail(adminErr.message, 500, "DATABASE_ERROR"),
    };
  }

  if (!admin) {
    return {
      ok: false,
      response: fail("Unauthorized Admin Access.", 403, "UNAUTHORIZED"),
    };
  }

  return { ok: true, societyId: society.society_id };
}

// ============================================
// ACTION HANDLERS
// ============================================

async function handleView(
  req: CrudStaffRequest,
  societyId: string,
): Promise<Response> {
  const page = Math.max(1, Number(req.page) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  let query = supabase
    .from("SSP_Society_Staff")
    .select(STAFF_SELECT_FIELDS, { count: "exact" })
    .eq("society_id", societyId);

  if (req.search && req.search.trim() !== "") {
    const term = req.search.trim();
    query = query.or(
      `staff_name.ilike.%${term}%,phone_number.ilike.%${term}%`,
    );
  }

  if (req.filters) {
    const roles = normalizeArray(req.filters.role);
    if (roles && roles.length > 0) {
      query = query.in("staff_role", roles);
    }

    const statuses = normalizeArray(req.filters.availabilityStatus);
    if (statuses && statuses.length > 0) {
      query = query.in("availability_status", statuses);
    }

    const shifts = normalizeArray(req.filters.shiftTiming);
    if (shifts && shifts.length > 0) {
      query = query.in("shift_timing", shifts);
    }

    const categories = normalizeArray(req.filters.emergencyCategory);
    if (categories && categories.length > 0) {
      const invalidCategories = categories.filter(
        (c) => !VALID_EMERGENCY_CATEGORIES.includes(c as EmergencyCategory),
      );
      if (invalidCategories.length > 0) {
        return fail(
          `Invalid emergencyCategory value(s): ${
            invalidCategories.join(", ")
          }. Valid values: ${VALID_EMERGENCY_CATEGORIES.join(", ")}`,
          400,
          "INVALID_PARAMETERS",
        );
      }
      query = query.in("emergency_category", categories);
    }

    const emergencyFilter = normalizeBoolean(req.filters.isEmergencyContact);
    if (emergencyFilter !== null) {
      query = query.eq("is_emergency_contact", emergencyFilter);
    }
  }

  const requestedSortField = req.sort?.field || "created_at";
  const sortField = VALID_SORT_FIELDS.includes(
      requestedSortField as typeof VALID_SORT_FIELDS[number],
    )
    ? requestedSortField
    : "created_at";
  const ascending = req.sort?.order === "asc";
  query = query.order(sortField, { ascending });

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  const staff = ((data || []) as StaffRow[]).map(formatStaff);
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return respond({
    staff,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      role: req.filters?.role ?? null,
      availabilityStatus: req.filters?.availabilityStatus ?? null,
      isEmergencyContact: req.filters?.isEmergencyContact ?? null,
      emergencyCategory: req.filters?.emergencyCategory ?? null,
      shiftTiming: req.filters?.shiftTiming ?? null,
    },
    search: req.search ?? null,
    sort: { field: sortField, order: ascending ? "asc" : "desc" },
  });
}

async function handleCreate(
  req: CrudStaffRequest,
  societyId: string,
): Promise<Response> {
  const p = req.payload;
  if (!p) {
    return fail("payload is required.", 400, "MISSING_PARAMETERS");
  }

  if (!p.name || String(p.name).trim() === "") {
    return fail("payload.name is required.", 400, "MISSING_PARAMETERS");
  }
  if (!p.phone || String(p.phone).trim() === "") {
    return fail("payload.phone is required.", 400, "MISSING_PARAMETERS");
  }
  if (!p.role || String(p.role).trim() === "") {
    return fail("payload.role is required.", 400, "MISSING_PARAMETERS");
  }

  const phone = cleanPhone(p.phone);
  if (!isValidPhone(phone)) {
    return fail("phone must be 10-15 digits.", 400, "INVALID_PARAMETERS");
  }

  const alternatePhone = p.alternatePhone ? cleanPhone(p.alternatePhone) : null;
  if (alternatePhone && !isValidPhone(alternatePhone)) {
    return fail(
      "alternatePhone must be 10-15 digits.",
      400,
      "INVALID_PARAMETERS",
    );
  }

  const categoryResult = validateEmergencyCategory(p.emergencyCategory);
  if (!categoryResult.ok) {
    return fail(
      `emergencyCategory must be one of: ${
        VALID_EMERGENCY_CATEGORIES.join(", ")
      }`,
      400,
      "INVALID_PARAMETERS",
    );
  }

  const { data: existing } = await supabase
    .from("SSP_Society_Staff")
    .select("staff_id")
    .eq("society_id", societyId)
    .eq("phone_number", phone)
    .maybeSingle();

  if (existing) {
    return fail(
      "A staff member with this phone number already exists.",
      409,
      "ALREADY_EXISTS",
    );
  }

  const insertPayload: Record<string, unknown> = {
    society_id: societyId,
    staff_name: String(p.name).trim(),
    phone_number: phone,
    staff_role: String(p.role).trim(),
  };

  if (alternatePhone) insertPayload.alternate_phone = alternatePhone;
  if (p.isEmergencyContact !== undefined) {
    insertPayload.is_emergency_contact = Boolean(p.isEmergencyContact);
  }
  if (p.shiftTiming !== undefined) {
    insertPayload.shift_timing = p.shiftTiming
      ? String(p.shiftTiming).trim()
      : null;
  }
  if (p.availabilityStatus !== undefined) {
    insertPayload.availability_status = p.availabilityStatus
      ? String(p.availabilityStatus).trim()
      : "available";
  }
  if (p.idProofType !== undefined) {
    insertPayload.id_proof_type = p.idProofType
      ? String(p.idProofType).trim()
      : null;
  }
  if (p.idProofNumber !== undefined) {
    insertPayload.id_proof_number = p.idProofNumber
      ? String(p.idProofNumber).trim()
      : null;
  }
  if (p.address !== undefined) {
    insertPayload.address = p.address ? String(p.address).trim() : null;
  }

  if (categoryResult.value) {
    const isEmergency = insertPayload.is_emergency_contact === true;
    if (isEmergency) {
      insertPayload.emergency_category = categoryResult.value;
    }
  }

  const { data, error } = await supabase
    .from("SSP_Society_Staff")
    .insert(insertPayload)
    .select("staff_id,staff_name,phone_number,staff_role,created_at")
    .single();

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  return respond(
    {
      staffId: (data as { staff_id: string }).staff_id,
      name: (data as { staff_name: string }).staff_name,
      phone: (data as { phone_number: string }).phone_number,
      role: (data as { staff_role: string }).staff_role,
      createdAt: (data as { created_at: string }).created_at,
      message: "Staff created successfully.",
    },
    201,
  );
}

async function handleUpdate(
  req: CrudStaffRequest,
  societyId: string,
): Promise<Response> {
  if (!req.staffId || String(req.staffId).trim() === "") {
    return fail("staffId is required for UPDATE.", 400, "MISSING_PARAMETERS");
  }
  if (!isValidUUID(String(req.staffId).trim())) {
    return fail("staffId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }
  if (!req.payload || Object.keys(req.payload).length === 0) {
    return fail("payload cannot be empty.", 400, "MISSING_PARAMETERS");
  }

  const updatePayload: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  if (req.payload.name !== undefined) {
    updatePayload.staff_name = String(req.payload.name).trim();
    updatedFields.push("name");
  }
  if (req.payload.phone !== undefined) {
    const phone = cleanPhone(req.payload.phone);
    if (!isValidPhone(phone)) {
      return fail("phone must be 10-15 digits.", 400, "INVALID_PARAMETERS");
    }
    updatePayload.phone_number = phone;
    updatedFields.push("phone");
  }
  if (req.payload.alternatePhone !== undefined) {
    if (req.payload.alternatePhone) {
      const alt = cleanPhone(req.payload.alternatePhone);
      if (!isValidPhone(alt)) {
        return fail(
          "alternatePhone must be 10-15 digits.",
          400,
          "INVALID_PARAMETERS",
        );
      }
      updatePayload.alternate_phone = alt;
    } else {
      updatePayload.alternate_phone = null;
    }
    updatedFields.push("alternatePhone");
  }
  if (req.payload.role !== undefined) {
    updatePayload.staff_role = String(req.payload.role).trim();
    updatedFields.push("role");
  }
  if (req.payload.isEmergencyContact !== undefined) {
    updatePayload.is_emergency_contact = Boolean(
      req.payload.isEmergencyContact,
    );
    updatedFields.push("isEmergencyContact");
  }
  if (req.payload.shiftTiming !== undefined) {
    updatePayload.shift_timing = req.payload.shiftTiming
      ? String(req.payload.shiftTiming).trim()
      : null;
    updatedFields.push("shiftTiming");
  }
  if (req.payload.availabilityStatus !== undefined) {
    updatePayload.availability_status = req.payload.availabilityStatus
      ? String(req.payload.availabilityStatus).trim()
      : null;
    updatedFields.push("availabilityStatus");
  }
  if (req.payload.idProofType !== undefined) {
    updatePayload.id_proof_type = req.payload.idProofType
      ? String(req.payload.idProofType).trim()
      : null;
    updatedFields.push("idProofType");
  }
  if (req.payload.idProofNumber !== undefined) {
    updatePayload.id_proof_number = req.payload.idProofNumber
      ? String(req.payload.idProofNumber).trim()
      : null;
    updatedFields.push("idProofNumber");
  }
  if (req.payload.address !== undefined) {
    updatePayload.address = req.payload.address
      ? String(req.payload.address).trim()
      : null;
    updatedFields.push("address");
  }
  if (req.payload.emergencyCategory !== undefined) {
    const cat = validateEmergencyCategory(req.payload.emergencyCategory);
    if (!cat.ok) {
      return fail(
        `emergencyCategory must be one of: ${
          VALID_EMERGENCY_CATEGORIES.join(", ")
        }`,
        400,
        "INVALID_PARAMETERS",
      );
    }
    updatePayload.emergency_category = cat.value;
    updatedFields.push("emergencyCategory");
  }

  if (Object.keys(updatePayload).length === 0) {
    return fail("No valid fields to update.", 400, "MISSING_PARAMETERS");
  }

  const { data, error } = await supabase
    .from("SSP_Society_Staff")
    .update(updatePayload as never)
    .eq("staff_id", String(req.staffId).trim())
    .eq("society_id", societyId)
    .select("staff_id")
    .maybeSingle();

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!data) {
    return fail("Staff not found in this society.", 404, "NOT_FOUND");
  }

  return respond({
    staffId: req.staffId,
    updatedFields,
    message: "Staff updated successfully.",
  });
}

async function handleDelete(
  req: CrudStaffRequest,
  societyId: string,
): Promise<Response> {
  if (!req.staffId || String(req.staffId).trim() === "") {
    return fail("staffId is required for DELETE.", 400, "MISSING_PARAMETERS");
  }
  if (!isValidUUID(String(req.staffId).trim())) {
    return fail("staffId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }

  const { error, count } = await supabase
    .from("SSP_Society_Staff")
    .delete({ count: "exact" })
    .eq("staff_id", String(req.staffId).trim())
    .eq("society_id", societyId);

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!count || count === 0) {
    return fail("Staff not found in this society.", 404, "NOT_FOUND");
  }

  return respond({
    staffId: req.staffId,
    message: "Staff deleted successfully.",
  });
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | CrudStaffRequest
      | null;
    if (!body) {
      return fail("Request body is required.", 400, "BAD_REQUEST");
    }

    const { societyRegistrationNumber, adminId, action } = body;

    if (!societyRegistrationNumber || !adminId || !action) {
      return fail(
        "societyRegistrationNumber, adminId, and action are required.",
        400,
        "MISSING_PARAMETERS",
      );
    }

    const actionUpper = String(action).toUpperCase();
    if (!VALID_ACTIONS.includes(actionUpper as typeof VALID_ACTIONS[number])) {
      return fail(
        `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
        400,
        "INVALID_ACTION",
      );
    }

    const auth = await authorizeAdmin(societyRegistrationNumber, adminId);
    if (!auth.ok) return auth.response;

    switch (actionUpper) {
      case "VIEW":
        return await handleView(body, auth.societyId);
      case "CREATE":
        return await handleCreate(body, auth.societyId);
      case "UPDATE":
        return await handleUpdate(body, auth.societyId);
      case "DELETE":
        return await handleDelete(body, auth.societyId);
      default:
        return fail("Unhandled action.", 400, "INVALID_ACTION");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ crud-staff error:", msg);
    return fail(msg, 500, "SERVER_ERROR");
  }
});
