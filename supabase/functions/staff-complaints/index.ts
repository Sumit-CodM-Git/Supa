// // ============================================
// // staff-complaints - Unified API for Staff (Optimized)
// // ============================================

// import { requireAuth } from "../_shared/auth.ts";
// import {
//   corsHeaders,
//   errorResponse,
//   successResponse,
// } from "../_shared/response.ts";
// import { logger, sanitizeString } from "../_shared/utils.ts";
// import { Validator } from "../_shared/validation.ts";
// import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES (unchanged)
// // ============================================

// type StaffType = "SERVICE_AGENT" | "VENDOR";
// type ActionType = "FETCH" | "UPDATE" | "UPDATE_AVAILABILITY";

// interface StaffComplaintsRequest {
//   societyRegistrationNumber: string;
//   staffType: StaffType;
//   staffId: string;
//   actionType: ActionType;
//   status?: string;
//   complaintType?: string;
//   priority?: string;
//   search?: string;
//   filterOption?: string;
//   fromDate?: string;
//   toDate?: string;
//   complaintId?: string;
//   newStatus?: string;
//   agentAvailabilityStatus?: string;
//   page?: number;
//   limit?: number;
// }

// interface StaffValidationResult {
//   staffId: string;
//   staffType: StaffType;
//   name: string;
//   phone: string;
//   rating: string | null;
//   role: string;
//   societyId: string;
// }

// interface ResidentDetails {
//   name: string;
//   phone: string;
//   unitFlatNumber: string | null;
//   blockName: string | null;
//   towerName: string | null;
// }

// interface ComplaintImages {
//   residentUploaded: string[];
//   before: string[];
//   after: string[];
// }

// interface ComplaintResponse {
//   complaintId: string;
//   title: string;
//   description: string;
//   status: string;
//   complaintType: string;
//   priority: string;
//   createdAt: string;
//   assignedDateTime: string | null;
//   completionDateTime: string | null;
//   residentDetails: ResidentDetails;
//   images: ComplaintImages;
// }

// interface PaginatedResponse {
//   complaints: ComplaintResponse[];
//   pagination: { total: number; page: number; limit: number; totalPages: number };
//   filters: {
//     status: string | null;
//     complaintType: string | null;
//     priority: string | null;
//     filterOption: string | null;
//     fromDate: string | null;
//     toDate: string | null;
//   };
//   search: string | null;
// }

// interface RawSocietyUserData {
//   user_id: string;
//   unit_flat_number: string | null;
//   block: { block_name: string }[] | null;
//   tower: { name: string }[] | null;
//   contact: { name: string; phone: string }[] | null;
// }

// interface RawComplaint {
//   complaint_id: string;
//   name: string;
//   description: string;
//   status: string;
//   complaint_type: string;
//   priority: string;
//   created_at: string;
//   assigned_date_time: string | null;
//   completion_date_time: string | null;
//   assigned_agent: string | null;
//   non_society_user: string | null;
//   society_user_data: RawSocietyUserData[] | null;
// }

// interface RawDocument {
//   complaint: string;
//   document_type: string;
//   s3_path: string;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const BUCKET_NAME = "society-documents";
// const MAX_LIMIT = 100;
// const DEFAULT_LIMIT = 20;
// const SIGNED_URL_EXPIRY = 900;
// const SIGNED_URL_CONCURRENCY = 50;
// const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;
// const MAX_IMAGES_PER_TYPE = 5;

// const supabaseAdmin = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// // In-memory signed URL cache (per isolate)
// const urlCache = new Map<string, { url: string; expiresAt: number }>();

// // Cached Intl formatters (module scope)
// const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
//   timeZone: "Asia/Kolkata",
//   year: "numeric",
//   month: "2-digit",
//   day: "2-digit",
//   hour: "2-digit",
//   minute: "2-digit",
//   second: "2-digit",
//   hour12: true,
// });

// const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
//   timeZone: "Asia/Kolkata",
//   year: "numeric",
//   month: "numeric",
//   day: "numeric",
//   weekday: "short",
// });

// const IST_ISO_FORMATTER = new Intl.DateTimeFormat("en-CA", {
//   timeZone: "Asia/Kolkata",
//   year: "numeric",
//   month: "2-digit",
//   day: "2-digit",
//   hour: "2-digit",
//   minute: "2-digit",
//   second: "2-digit",
//   hour12: false,
// });

// // ============================================
// // HELPERS
// // ============================================

// function formatToIST(dateValue: string | Date | null): string | null {
//   if (!dateValue) return null;
//   const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
//   if (isNaN(date.getTime())) return null;
//   return IST_FORMATTER.format(date);
// }

// function getISTISOString(): string {
//   const parts = IST_ISO_FORMATTER.formatToParts(new Date());
//   const map = new Map(parts.map((p) => [p.type, p.value]));
//   return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${
//     map.get("hour")
//   }:${map.get("minute")}:${map.get("second")}+05:30`;
// }

// function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
//   if (!arr) return null;
//   if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
//   return arr;
// }

// function calculateDateBounds(
//   filter: string | null,
//   fromStr?: string,
//   toStr?: string,
// ): { startISO: string; endISO: string } | null {
//   if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
//     return null;
//   }

//   const parts = IST_PARTS_FORMATTER.formatToParts(new Date());
//   const pMap = new Map(parts.map((p) => [p.type, p.value]));

//   const year = parseInt(pMap.get("year")!);
//   const month = parseInt(pMap.get("month")!) - 1;
//   const day = parseInt(pMap.get("day")!);
//   const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
//     pMap.get("weekday")!,
//   );

//   let startDay = day;
//   let endDay = day + 1;
//   let startMonth = month;
//   let endMonth = month;
//   const startYear = year;
//   const endYear = year;

//   switch (filter.toLowerCase()) {
//     case "today":
//       break;
//     case "yesterday":
//       startDay = day - 1;
//       endDay = day;
//       break;
//     case "thisweek":
//       startDay = day - dayOfWeek;
//       endDay = startDay + 7;
//       break;
//     case "lastweek":
//       startDay = day - dayOfWeek - 7;
//       endDay = startDay + 7;
//       break;
//     case "thismonth":
//       startDay = 1;
//       endMonth = month + 1;
//       endDay = 1;
//       break;
//     case "lastmonth":
//       startMonth = month - 1;
//       startDay = 1;
//       endMonth = month;
//       endDay = 1;
//       break;
//     case "custom": {
//       if (!fromStr || !toStr) return null;
//       const customStart = new Date(`${fromStr}T00:00:00+05:30`);
//       const customEnd = new Date(`${toStr}T00:00:00+05:30`);
//       customEnd.setDate(customEnd.getDate() + 1);
//       return {
//         startISO: customStart.toISOString(),
//         endISO: customEnd.toISOString(),
//       };
//     }
//     default:
//       return null;
//   }

//   const startObj = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0));
//   const endObj = new Date(Date.UTC(endYear, endMonth, endDay, 0, 0, 0));
//   startObj.setMinutes(startObj.getMinutes() - 330);
//   endObj.setMinutes(endObj.getMinutes() - 330);

//   return {
//     startISO: startObj.toISOString(),
//     endISO: endObj.toISOString(),
//   };
// }

// function extractStorageKey(path: string): string {
//   let key = path.trim();
//   const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
//   const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
//   if (key.includes(publicMarker)) return key.split(publicMarker)[1];
//   if (key.includes(signedMarker)) return key.split(signedMarker)[1];
//   if (key.includes(".amazonaws.com/")) return key.split(".amazonaws.com/")[1];
//   return key;
// }

// /**
//  * Batched signed-URL generation with bounded concurrency + in-memory cache.
//  * Returns map of original_path → signed_url.
//  */
// async function batchSignUrls(paths: string[]): Promise<Map<string, string>> {
//   const result = new Map<string, string>();
//   if (paths.length === 0) return result;

//   const unique = Array.from(new Set(paths.filter(Boolean)));
//   if (unique.length === 0) return result;

//   const now = Date.now();
//   const toSign: string[] = [];

//   for (const p of unique) {
//     const cached = urlCache.get(p);
//     if (cached && cached.expiresAt > now + SIGNED_URL_SAFETY_MARGIN_MS) {
//       result.set(p, cached.url);
//     } else {
//       toSign.push(p);
//     }
//   }

//   for (let i = 0; i < toSign.length; i += SIGNED_URL_CONCURRENCY) {
//     const chunk = toSign.slice(i, i + SIGNED_URL_CONCURRENCY);
//     const signed = await Promise.all(
//       chunk.map(async (originalPath) => {
//         const key = extractStorageKey(originalPath);
//         try {
//           const { data, error } = await supabaseAdmin.storage
//             .from(BUCKET_NAME)
//             .createSignedUrl(key, SIGNED_URL_EXPIRY);
//           if (error || !data?.signedUrl) return [originalPath, null] as const;
//           return [originalPath, data.signedUrl] as const;
//         } catch {
//           return [originalPath, null] as const;
//         }
//       }),
//     );
//     const expiresAt = Date.now() + SIGNED_URL_EXPIRY * 1000;
//     for (const [orig, url] of signed) {
//       if (url) {
//         result.set(orig, url);
//         urlCache.set(orig, { url, expiresAt });
//       }
//     }
//   }

//   return result;
// }

// function sortComplaintsByStatus(
//   complaints: ComplaintResponse[],
// ): ComplaintResponse[] {
//   const statusPriority: { [key: string]: number } = {
//     "in_progress": 0,
//     "assigned": 1,
//     "resolved": 2,
//   };
//   return [...complaints].sort((a, b) => {
//     const pa = statusPriority[a.status.toLowerCase()] ?? 99;
//     const pb = statusPriority[b.status.toLowerCase()] ?? 99;
//     return pa - pb;
//   });
// }

// function applySearchFilter(
//   complaints: ComplaintResponse[],
//   searchTerm: string,
// ): ComplaintResponse[] {
//   if (!searchTerm) return complaints;
//   const term = searchTerm.toLowerCase().trim();
//   return complaints.filter((c) =>
//     c.title.toLowerCase().includes(term) ||
//     c.description.toLowerCase().includes(term) ||
//     c.complaintId.toLowerCase().includes(term) ||
//     c.residentDetails.name.toLowerCase().includes(term) ||
//     (c.residentDetails.unitFlatNumber?.toLowerCase().includes(term) ?? false) ||
//     c.complaintType.toLowerCase().includes(term) ||
//     c.priority.toLowerCase().includes(term)
//   );
// }

// async function validateStaff(
//   staffType: StaffType,
//   staffId: string,
//   societyId: string,
// ): Promise<{ data: StaffValidationResult | null; error?: string }> {
//   try {
//     if (staffType === "SERVICE_AGENT") {
//       const { data: agent, error } = await supabaseAdmin
//         .from("SSP_Society_User")
//         .select(`
//           user_id,
//           role,
//           service_agent_rating,
//           contact:contact (name, phone)
//         `)
//         .eq("user_id", staffId)
//         .eq("society", societyId)
//         .maybeSingle();

//       if (error) return { data: null, error: error.message };
//       if (!agent) return { data: null, error: "Service Agent not found in this society" };

//       const roles = Array.isArray(agent.role)
//         ? agent.role
//         : (agent.role ? [agent.role] : []);
//       if (!roles.includes("service_agent")) {
//         return { data: null, error: "User is not a Service Agent" };
//       }

//       const contact = firstOrNull(agent.contact);
//       return {
//         data: {
//           staffId: agent.user_id,
//           staffType: "SERVICE_AGENT",
//           name: contact?.name || "Unknown",
//           phone: contact?.phone || "",
//           rating: agent.service_agent_rating
//             ? Number(agent.service_agent_rating).toFixed(2)
//             : null,
//           role: "service_agent",
//           societyId,
//         },
//       };
//     }

//     const { data: vendor, error } = await supabaseAdmin
//       .from("SSP_Non_Society_User")
//       .select(`non_society_user_id, name, role, phone_number, vendor_rating`)
//       .eq("non_society_user_id", staffId)
//       .eq("society", societyId)
//       .eq("role", "vendor")
//       .maybeSingle();

//     if (error) return { data: null, error: error.message };
//     if (!vendor) return { data: null, error: "Vendor not found in this society" };

//     return {
//       data: {
//         staffId: vendor.non_society_user_id,
//         staffType: "VENDOR",
//         name: vendor.name || "Unknown Vendor",
//         phone: vendor.phone_number || "",
//         rating: vendor.vendor_rating || null,
//         role: "vendor",
//         societyId,
//       },
//     };
//   } catch (error: unknown) {
//     const errorMessage = error instanceof Error ? error.message : "Unknown error";
//     return { data: null, error: errorMessage };
//   }
// }

// function applyPagination<T>(
//   data: T[],
//   page: number,
//   limit: number,
// ): { items: T[]; total: number } {
//   const total = data.length;
//   const start = (page - 1) * limit;
//   return { items: data.slice(start, start + limit), total };
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// Deno.serve(
//   requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
//     if (req.method === "OPTIONS") {
//       return new Response("ok", { headers: corsHeaders });
//     }

//     const startTime = Date.now();

//     try {
//       logger.info({
//         level: "info",
//         action: "staff-complaints",
//         userId: authCtx.user.id,
//         message: "Staff complaints request received",
//         timestamp: new Date().toISOString(),
//       });

//       if (req.method !== "POST") {
//         return errorResponse("Only POST method is allowed.");
//       }

//       const body = await req.json().catch(() => null);
//       if (!body) return errorResponse("Request body is required.");

//       const {
//         societyRegistrationNumber,
//         staffType,
//         staffId,
//         actionType,
//         status,
//         complaintType,
//         priority,
//         search,
//         filterOption,
//         fromDate,
//         toDate,
//         complaintId,
//         newStatus,
//         agentAvailabilityStatus,
//         page,
//         limit,
//       } = body as StaffComplaintsRequest;

//       const validator = new Validator()
//         .validateRequired(societyRegistrationNumber, "societyRegistrationNumber")
//         .validateRequired(staffType, "staffType")
//         .validateRequired(staffId, "staffId")
//         .validateRequired(actionType, "actionType");

//       if (actionType === "UPDATE") {
//         validator
//           .validateRequired(complaintId, "complaintId")
//           .validateRequired(newStatus, "newStatus");
//       }

//       if (
//         filterOption && filterOption.toLowerCase() === "custom" &&
//         (!fromDate || !toDate)
//       ) {
//         return errorResponse("fromDate and toDate are required for Custom filter.");
//       }

//       if (!validator.isValid()) {
//         logger.warn({
//           level: "warn",
//           action: "staff-complaints",
//           userId: authCtx.user.id,
//           message: "Validation failed",
//           errors: JSON.stringify(validator.getErrors()),
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Validation failed");
//       }

//       const regNum = sanitizeString(societyRegistrationNumber);
//       const cleanStaffId = sanitizeString(staffId);
//       const cleanActionType = sanitizeString(actionType);

//       // ------- Society -------
//       const { data: society, error: socErr } = await supabaseAdmin
//         .from("SSP_Society")
//         .select("society_id, registration_number, society_name")
//         .eq("registration_number", regNum)
//         .maybeSingle();

//       if (socErr) {
//         logger.error({
//           level: "error",
//           action: "staff-complaints",
//           message: `Society lookup failed: ${socErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Failed to fetch society data.");
//       }
//       if (!society) {
//         return errorResponse("Society not found for provided registration number.");
//       }

//       // ------- Validate staff -------
//       const staffResult = await validateStaff(
//         staffType,
//         cleanStaffId,
//         society.society_id,
//       );

//       if (staffResult.error || !staffResult.data) {
//         logger.warn({
//           level: "warn",
//           action: "staff-complaints",
//           userId: authCtx.user.id,
//           message: `Staff validation failed: ${staffResult.error}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse(staffResult.error || "Staff validation failed.");
//       }

//       const staff = staffResult.data;
//       const staffIdValue = staff.staffId;

//       // ------- Availability update -------
//       if (staffType === "SERVICE_AGENT" && agentAvailabilityStatus) {
//         const { error: updateErr } = await supabaseAdmin
//           .from("SSP_Society_User")
//           .update({ agent_availability_status: agentAvailabilityStatus.trim() })
//           .eq("user_id", staffIdValue);

//         if (updateErr) {
//           logger.error({
//             level: "error",
//             action: "staff-complaints",
//             message: `Availability update failed: ${updateErr.message}`,
//             timestamp: new Date().toISOString(),
//           });
//           return errorResponse("Failed to update availability status.");
//         }
//       }

//       // ------- UPDATE action -------
//       if (cleanActionType === "UPDATE") {
//         const cleanComplaintId = sanitizeString(complaintId!);
//         const cleanNewStatus = sanitizeString(newStatus!);

//         const { data: complaintCheck, error: checkErr } = await supabaseAdmin
//           .from("SSP_Complaint")
//           .select("complaint_id, assigned_agent, non_society_user")
//           .eq("complaint_id", cleanComplaintId)
//           .maybeSingle();

//         if (checkErr) return errorResponse("Failed to verify complaint ownership.");
//         if (!complaintCheck) return errorResponse("Complaint not found.");

//         const isAssignedToStaff =
//           (staffType === "SERVICE_AGENT" &&
//             complaintCheck.assigned_agent === staffIdValue) ||
//           (staffType === "VENDOR" &&
//             complaintCheck.non_society_user === staffIdValue);

//         if (!isAssignedToStaff) {
//           return errorResponse("You are not authorized to update this complaint.");
//         }

//         const updatePayload: {
//           status: string;
//           completion_date_time: string | null;
//         } = {
//           status: cleanNewStatus,
//           completion_date_time: null,
//         };

//         if (cleanNewStatus.toLowerCase() === "resolved") {
//           updatePayload.completion_date_time = getISTISOString();
//         }

//         const { error: updateErr } = await supabaseAdmin
//           .from("SSP_Complaint")
//           .update(updatePayload)
//           .eq("complaint_id", cleanComplaintId);

//         if (updateErr) {
//           logger.error({
//             level: "error",
//             action: "staff-complaints",
//             message: `Status update failed: ${updateErr.message}`,
//             timestamp: new Date().toISOString(),
//           });
//           return errorResponse("Failed to update complaint status.");
//         }

//         return successResponse({
//           statusUpdated: true,
//           newStatus: cleanNewStatus,
//           message: `Complaint status updated to "${cleanNewStatus}"`,
//           staff: {
//             id: staff.staffId,
//             name: staff.name,
//             role: staff.role,
//             rating: staff.rating,
//           },
//         });
//       }

//       // ------- FETCH complaints -------
//       const pageNum = Number(page) || 1;
//       const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);

//       let query = supabaseAdmin
//         .from("SSP_Complaint")
//         .select(`
//           complaint_id,
//           name,
//           description,
//           status,
//           complaint_type,
//           priority,
//           created_at,
//           assigned_date_time,
//           completion_date_time,
//           assigned_agent,
//           non_society_user,
//           society_user_data:SSP_Society_User!society_user (
//             user_id,
//             unit_flat_number,
//             block:SSP_Block!left (block_name),
//             tower:SSP_Tower!left (name),
//             contact:contact (name, phone)
//           )
//         `);

//       if (staffType === "SERVICE_AGENT") {
//         query = query.eq("assigned_agent", staffIdValue);
//       } else {
//         query = query.eq("non_society_user", staffIdValue);
//       }

//       if (status && status.trim() !== "" && status.toLowerCase() !== "all") {
//         query = query.eq("status", status.trim());
//       }

//       if (
//         complaintType && complaintType.trim() !== "" &&
//         complaintType.toLowerCase() !== "all"
//       ) {
//         query = query.eq("complaint_type", complaintType.trim());
//       }

//       if (priority && priority.trim() !== "" && priority.toLowerCase() !== "all") {
//         query = query.eq("priority", priority.trim());
//       }

//       const dateBounds = calculateDateBounds(
//         filterOption || null,
//         fromDate,
//         toDate,
//       );
//       if (dateBounds) {
//         query = query
//           .gte("assigned_date_time", dateBounds.startISO)
//           .lt("assigned_date_time", dateBounds.endISO);
//       }

//       const { data: complaints, error: fetchErr } = await query.order(
//         "assigned_date_time",
//         { ascending: false },
//       );

//       if (fetchErr) {
//         logger.error({
//           level: "error",
//           action: "staff-complaints",
//           message: `Fetch failed: ${fetchErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Failed to fetch complaints.");
//       }

//       const rawComplaints = (complaints || []) as unknown as RawComplaint[];

//       // ------- BATCH: fetch all documents -------
//       const complaintIds = rawComplaints.map((c) => c.complaint_id);
//       const imageMap = new Map<string, {
//         residentUploaded: string[];
//         before: string[];
//         after: string[];
//       }>();

//       if (complaintIds.length > 0) {
//         const { data: documents } = await supabaseAdmin
//           .from("SSP_Document")
//           .select("complaint, document_type, s3_path")
//           .in("complaint", complaintIds);

//         for (const doc of (documents ?? []) as RawDocument[]) {
//           if (!doc.complaint) continue;
//           if (!imageMap.has(doc.complaint)) {
//             imageMap.set(doc.complaint, {
//               residentUploaded: [],
//               before: [],
//               after: [],
//             });
//           }
//           const images = imageMap.get(doc.complaint)!;
//           const docType = (doc.document_type ?? "").trim().toLowerCase();

//           if (
//             docType === "complaint_attachment" ||
//             docType === "facility_attachment"
//           ) {
//             if (images.residentUploaded.length < MAX_IMAGES_PER_TYPE) {
//               images.residentUploaded.push(doc.s3_path);
//             }
//           } else if (
//             docType === "before_complaint_image" ||
//             docType === "before_image"
//           ) {
//             if (images.before.length < MAX_IMAGES_PER_TYPE) {
//               images.before.push(doc.s3_path);
//             }
//           } else if (
//             docType === "after_complaint_image" ||
//             docType === "after_image"
//           ) {
//             if (images.after.length < MAX_IMAGES_PER_TYPE) {
//               images.after.push(doc.s3_path);
//             }
//           }
//         }
//       }

//       // ------- BATCH: sign all URLs in one pass -------
//       const allPaths: string[] = [];
//       for (const imgs of imageMap.values()) {
//         allPaths.push(...imgs.residentUploaded, ...imgs.before, ...imgs.after);
//       }
//       const signedUrlMap = await batchSignUrls(allPaths);

//       // ------- Assemble (no I/O) -------
//       const formattedComplaints: ComplaintResponse[] = rawComplaints.map(
//         (comp) => {
//           const residentData = firstOrNull(comp.society_user_data);
//           const contact = firstOrNull(residentData?.contact);
//           const block = firstOrNull(residentData?.block);
//           const tower = firstOrNull(residentData?.tower);

//           const rawImages = imageMap.get(comp.complaint_id) ?? {
//             residentUploaded: [],
//             before: [],
//             after: [],
//           };

//           const mapSigned = (paths: string[]): string[] => {
//             const urls: string[] = [];
//             for (const p of paths) {
//               const u = signedUrlMap.get(p);
//               if (u) urls.push(u);
//             }
//             return urls;
//           };

//           return {
//             complaintId: comp.complaint_id,
//             title: comp.name || "Untitled",
//             description: comp.description || "",
//             status: comp.status || "assigned",
//             complaintType: comp.complaint_type || "general",
//             priority: comp.priority || "medium",
//             createdAt: comp.created_at || new Date().toISOString(),
//             assignedDateTime: formatToIST(comp.assigned_date_time),
//             completionDateTime: formatToIST(comp.completion_date_time),
//             residentDetails: {
//               name: contact?.name || "Unknown",
//               phone: contact?.phone || "",
//               unitFlatNumber: residentData?.unit_flat_number || null,
//               blockName: block?.block_name || null,
//               towerName: tower?.name || null,
//             },
//             images: {
//               residentUploaded: mapSigned(rawImages.residentUploaded),
//               before: mapSigned(rawImages.before),
//               after: mapSigned(rawImages.after),
//             },
//           };
//         },
//       );

//       // ------- Search -------
//       let filteredComplaints = formattedComplaints;
//       if (search) {
//         filteredComplaints = applySearchFilter(filteredComplaints, search);
//       }

//       // ------- Sort -------
//       const sortedComplaints = sortComplaintsByStatus(filteredComplaints);

//       // ------- Pagination -------
//       const { items, total } = applyPagination(
//         sortedComplaints,
//         pageNum,
//         limitNum,
//       );

//       // ------- Response -------
//       const response: PaginatedResponse = {
//         complaints: items,
//         pagination: {
//           total,
//           page: pageNum,
//           limit: limitNum,
//           totalPages: Math.ceil(total / limitNum),
//         },
//         filters: {
//           status: status || null,
//           complaintType: complaintType || null,
//           priority: priority || null,
//           filterOption: filterOption || null,
//           fromDate: fromDate || null,
//           toDate: toDate || null,
//         },
//         search: search || null,
//       };

//       logger.info({
//         level: "info",
//         action: "staff-complaints",
//         userId: authCtx.user.id,
//         staffId: staffIdValue,
//         staffType: staff.staffType,
//         complaintsFound: total,
//         returned: items.length,
//         duration: Date.now() - startTime,
//         message: "Complaints fetched successfully",
//         timestamp: new Date().toISOString(),
//       });

//       return successResponse({
//         staff: {
//           id: staff.staffId,
//           name: staff.name,
//           role: staff.role,
//           phone: staff.phone,
//           rating: staff.rating,
//         },
//         ...response,
//       });
//     } catch (error: unknown) {
//       const errorMessage = error instanceof Error ? error.message : "Unknown error";
//       const errorStack = error instanceof Error ? error.stack : undefined;

//       logger.error({
//         level: "error",
//         action: "staff-complaints",
//         userId: authCtx?.user?.id || "unknown",
//         message: errorMessage,
//         stack: errorStack,
//         timestamp: new Date().toISOString(),
//       });

//       return errorResponse(errorMessage || "Failed to process request.");
//     }
//   }),
// );

// ============================================
// staff-complaints - Unified API for Staff (Optimized)
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// ============================================
// TYPES (unchanged)
// ============================================

type StaffType = "SERVICE_AGENT" | "VENDOR";
type ActionType = "FETCH" | "UPDATE" | "UPDATE_AVAILABILITY";

interface StaffComplaintsRequest {
  societyRegistrationNumber: string;
  staffType: StaffType;
  staffId: string;
  actionType: ActionType;
  status?: string;
  complaintType?: string;
  priority?: string;
  search?: string;
  filterOption?: string;
  fromDate?: string;
  toDate?: string;
  complaintId?: string;
  newStatus?: string;
  agentAvailabilityStatus?: string;
  page?: number;
  limit?: number;
}

interface StaffValidationResult {
  staffId: string;
  staffType: StaffType;
  name: string;
  phone: string;
  rating: string | null;
  role: string;
  societyId: string;
}

interface ResidentDetails {
  name: string;
  phone: string;
  unitFlatNumber: string | null;
  blockName: string | null;
  towerName: string | null;
}

interface ComplaintImages {
  residentUploaded: string[];
  before: string[];
  after: string[];
}

interface ComplaintResponse {
  complaintId: string;
  title: string;
  description: string;
  status: string;
  complaintType: string;
  priority: string;
  createdAt: string;
  assignedDateTime: string | null;
  completionDateTime: string | null;
  residentDetails: ResidentDetails;
  images: ComplaintImages;
}

interface PaginatedResponse {
  complaints: ComplaintResponse[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  filters: {
    status: string | null;
    complaintType: string | null;
    priority: string | null;
    filterOption: string | null;
    fromDate: string | null;
    toDate: string | null;
  };
  search: string | null;
}

interface RawSocietyUserData {
  user_id: string;
  unit_flat_number: string | null;
  block: { block_name: string }[] | null;
  tower: { name: string }[] | null;
  contact: { name: string; phone: string }[] | null;
}

interface RawComplaint {
  complaint_id: string;
  name: string;
  description: string;
  status: string;
  complaint_type: string;
  priority: string;
  created_at: string;
  assigned_date_time: string | null;
  completion_date_time: string | null;
  start_otp_verified_at: string | null; // ✅ NEW
  assigned_agent: string | null;
  non_society_user: string | null;
  society_user_data: RawSocietyUserData[] | null;
}

interface RawDocument {
  complaint: string;
  document_type: string;
  s3_path: string;
}

// ✅ NEW: internal sort keys — never serialized to client
type SortKeys = {
  assignedDT: number;
  completionDT: number;
  startOtpVerifiedAt: number;
};

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const SIGNED_URL_EXPIRY = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;
const MAX_IMAGES_PER_TYPE = 5;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// In-memory signed URL cache (per isolate)
const urlCache = new Map<string, { url: string; expiresAt: number }>();

// Cached Intl formatters (module scope)
const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

const IST_ISO_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// ============================================
// HELPERS
// ============================================

function formatToIST(dateValue: string | Date | null): string | null {
  if (!dateValue) return null;
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (isNaN(date.getTime())) return null;
  return IST_FORMATTER.format(date);
}

function getISTISOString(): string {
  const parts = IST_ISO_FORMATTER.formatToParts(new Date());
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${
    map.get("hour")
  }:${map.get("minute")}:${map.get("second")}+05:30`;
}

function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
  return arr;
}

function calculateDateBounds(
  filter: string | null,
  fromStr?: string,
  toStr?: string,
): { startISO: string; endISO: string } | null {
  if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
    return null;
  }

  const parts = IST_PARTS_FORMATTER.formatToParts(new Date());
  const pMap = new Map(parts.map((p) => [p.type, p.value]));

  const year = parseInt(pMap.get("year")!);
  const month = parseInt(pMap.get("month")!) - 1;
  const day = parseInt(pMap.get("day")!);
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    pMap.get("weekday")!,
  );

  let startDay = day;
  let endDay = day + 1;
  let startMonth = month;
  let endMonth = month;
  const startYear = year;
  const endYear = year;

  switch (filter.toLowerCase()) {
    case "today":
      break;
    case "yesterday":
      startDay = day - 1;
      endDay = day;
      break;
    case "thisweek":
      startDay = day - dayOfWeek;
      endDay = startDay + 7;
      break;
    case "lastweek":
      startDay = day - dayOfWeek - 7;
      endDay = startDay + 7;
      break;
    case "thismonth":
      startDay = 1;
      endMonth = month + 1;
      endDay = 1;
      break;
    case "lastmonth":
      startMonth = month - 1;
      startDay = 1;
      endMonth = month;
      endDay = 1;
      break;
    case "custom": {
      if (!fromStr || !toStr) return null;
      const customStart = new Date(`${fromStr}T00:00:00+05:30`);
      const customEnd = new Date(`${toStr}T00:00:00+05:30`);
      customEnd.setDate(customEnd.getDate() + 1);
      return {
        startISO: customStart.toISOString(),
        endISO: customEnd.toISOString(),
      };
    }
    default:
      return null;
  }

  const startObj = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0));
  const endObj = new Date(Date.UTC(endYear, endMonth, endDay, 0, 0, 0));
  startObj.setMinutes(startObj.getMinutes() - 330);
  endObj.setMinutes(endObj.getMinutes() - 330);

  return {
    startISO: startObj.toISOString(),
    endISO: endObj.toISOString(),
  };
}

function extractStorageKey(path: string): string {
  let key = path.trim();
  const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
  const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
  if (key.includes(publicMarker)) return key.split(publicMarker)[1];
  if (key.includes(signedMarker)) return key.split(signedMarker)[1];
  if (key.includes(".amazonaws.com/")) return key.split(".amazonaws.com/")[1];
  return key;
}

/**
 * Batched signed-URL generation with bounded concurrency + in-memory cache.
 * Returns map of original_path → signed_url.
 */
async function batchSignUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return result;

  const now = Date.now();
  const toSign: string[] = [];

  for (const p of unique) {
    const cached = urlCache.get(p);
    if (cached && cached.expiresAt > now + SIGNED_URL_SAFETY_MARGIN_MS) {
      result.set(p, cached.url);
    } else {
      toSign.push(p);
    }
  }

  for (let i = 0; i < toSign.length; i += SIGNED_URL_CONCURRENCY) {
    const chunk = toSign.slice(i, i + SIGNED_URL_CONCURRENCY);
    const signed = await Promise.all(
      chunk.map(async (originalPath) => {
        const key = extractStorageKey(originalPath);
        try {
          const { data, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(key, SIGNED_URL_EXPIRY);
          if (error || !data?.signedUrl) return [originalPath, null] as const;
          return [originalPath, data.signedUrl] as const;
        } catch {
          return [originalPath, null] as const;
        }
      }),
    );
    const expiresAt = Date.now() + SIGNED_URL_EXPIRY * 1000;
    for (const [orig, url] of signed) {
      if (url) {
        result.set(orig, url);
        urlCache.set(orig, { url, expiresAt });
      }
    }
  }

  return result;
}

/**
 * ✅ UPDATED: Sort by status group (in_progress → assigned → resolved),
 * then DESC within each group by the field that matters for that status:
 *   - in_progress  → start_otp_verified_at
 *   - assigned     → assigned_date_time
 *   - resolved     → completion_date_time
 * Falls back to created_at DESC then complaintId for stable/deterministic order.
 */
function sortComplaintsByStatus(
  complaints: ComplaintResponse[],
  sortKeys: Map<string, SortKeys>,
): ComplaintResponse[] {
  const statusPriority: { [key: string]: number } = {
    "in_progress": 0,
    "assigned": 1,
    "resolved": 2,
  };

  const ts = (v: number | undefined | null): number =>
    Number.isFinite(v as number) && (v as number) > 0 ? (v as number) : 0;

  return [...complaints].sort((a, b) => {
    const pa = statusPriority[a.status.toLowerCase()] ?? 99;
    const pb = statusPriority[b.status.toLowerCase()] ?? 99;
    if (pa !== pb) return pa - pb;

    // Same status group → DESC by the field that matters for that status
    const ka = sortKeys.get(a.complaintId);
    const kb = sortKeys.get(b.complaintId);
    const status = a.status.toLowerCase();

    let va = 0;
    let vb = 0;

    if (status === "resolved") {
      va = ts(ka?.completionDT);
      vb = ts(kb?.completionDT);
    } else if (status === "in_progress") {
      va = ts(ka?.startOtpVerifiedAt);
      vb = ts(kb?.startOtpVerifiedAt);
    } else {
      // assigned (and any unknown status fallback)
      va = ts(ka?.assignedDT);
      vb = ts(kb?.assignedDT);
    }

    // DESC
    if (vb !== va) return vb - va;

    // Fallback tiebreaker: created_at DESC
    const ca = Date.parse(a.createdAt) || 0;
    const cb = Date.parse(b.createdAt) || 0;
    if (cb !== ca) return cb - ca;

    // Last resort: complaintId for stable ordering
    return a.complaintId.localeCompare(b.complaintId);
  });
}

function applySearchFilter(
  complaints: ComplaintResponse[],
  searchTerm: string,
): ComplaintResponse[] {
  if (!searchTerm) return complaints;
  const term = searchTerm.toLowerCase().trim();
  return complaints.filter((c) =>
    c.title.toLowerCase().includes(term) ||
    c.description.toLowerCase().includes(term) ||
    c.complaintId.toLowerCase().includes(term) ||
    c.residentDetails.name.toLowerCase().includes(term) ||
    (c.residentDetails.unitFlatNumber?.toLowerCase().includes(term) ?? false) ||
    c.complaintType.toLowerCase().includes(term) ||
    c.priority.toLowerCase().includes(term)
  );
}

async function validateStaff(
  staffType: StaffType,
  staffId: string,
  societyId: string,
): Promise<{ data: StaffValidationResult | null; error?: string }> {
  try {
    if (staffType === "SERVICE_AGENT") {
      const { data: agent, error } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
          user_id,
          role,
          service_agent_rating,
          contact:contact (name, phone)
        `)
        .eq("user_id", staffId)
        .eq("society", societyId)
        .maybeSingle();

      if (error) return { data: null, error: error.message };
      if (!agent) {
        return { data: null, error: "Service Agent not found in this society" };
      }

      const roles = Array.isArray(agent.role)
        ? agent.role
        : (agent.role ? [agent.role] : []);
      if (!roles.includes("service_agent")) {
        return { data: null, error: "User is not a Service Agent" };
      }

      const contact = firstOrNull(agent.contact);
      return {
        data: {
          staffId: agent.user_id,
          staffType: "SERVICE_AGENT",
          name: contact?.name || "Unknown",
          phone: contact?.phone || "",
          rating: agent.service_agent_rating
            ? Number(agent.service_agent_rating).toFixed(2)
            : null,
          role: "service_agent",
          societyId,
        },
      };
    }

    const { data: vendor, error } = await supabaseAdmin
      .from("SSP_Non_Society_User")
      .select(`non_society_user_id, name, role, phone_number, vendor_rating`)
      .eq("non_society_user_id", staffId)
      .eq("society", societyId)
      .eq("role", "vendor")
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!vendor) {
      return { data: null, error: "Vendor not found in this society" };
    }

    return {
      data: {
        staffId: vendor.non_society_user_id,
        staffType: "VENDOR",
        name: vendor.name || "Unknown Vendor",
        phone: vendor.phone_number || "",
        rating: vendor.vendor_rating || null,
        role: "vendor",
        societyId,
      },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return { data: null, error: errorMessage };
  }
}

function applyPagination<T>(
  data: T[],
  page: number,
  limit: number,
): { items: T[]; total: number } {
  const total = data.length;
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total };
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
        action: "staff-complaints",
        userId: authCtx.user.id,
        message: "Staff complaints request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("Request body is required.");

      const {
        societyRegistrationNumber,
        staffType,
        staffId,
        actionType,
        status,
        complaintType,
        priority,
        search,
        filterOption,
        fromDate,
        toDate,
        complaintId,
        newStatus,
        agentAvailabilityStatus,
        page,
        limit,
      } = body as StaffComplaintsRequest;

      const validator = new Validator()
        .validateRequired(
          societyRegistrationNumber,
          "societyRegistrationNumber",
        )
        .validateRequired(staffType, "staffType")
        .validateRequired(staffId, "staffId")
        .validateRequired(actionType, "actionType");

      if (actionType === "UPDATE") {
        validator
          .validateRequired(complaintId, "complaintId")
          .validateRequired(newStatus, "newStatus");
      }

      if (
        filterOption && filterOption.toLowerCase() === "custom" &&
        (!fromDate || !toDate)
      ) {
        return errorResponse(
          "fromDate and toDate are required for Custom filter.",
        );
      }

      if (!validator.isValid()) {
        logger.warn({
          level: "warn",
          action: "staff-complaints",
          userId: authCtx.user.id,
          message: "Validation failed",
          errors: JSON.stringify(validator.getErrors()),
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Validation failed");
      }

      const regNum = sanitizeString(societyRegistrationNumber);
      const cleanStaffId = sanitizeString(staffId);
      const cleanActionType = sanitizeString(actionType);

      // ------- Society -------
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number, society_name")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          action: "staff-complaints",
          message: `Society lookup failed: ${socErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to fetch society data.");
      }
      if (!society) {
        return errorResponse(
          "Society not found for provided registration number.",
        );
      }

      // ------- Validate staff -------
      const staffResult = await validateStaff(
        staffType,
        cleanStaffId,
        society.society_id,
      );

      if (staffResult.error || !staffResult.data) {
        logger.warn({
          level: "warn",
          action: "staff-complaints",
          userId: authCtx.user.id,
          message: `Staff validation failed: ${staffResult.error}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse(staffResult.error || "Staff validation failed.");
      }

      const staff = staffResult.data;
      const staffIdValue = staff.staffId;

      // ------- Availability update -------
      if (staffType === "SERVICE_AGENT" && agentAvailabilityStatus) {
        const { error: updateErr } = await supabaseAdmin
          .from("SSP_Society_User")
          .update({ agent_availability_status: agentAvailabilityStatus.trim() })
          .eq("user_id", staffIdValue);

        if (updateErr) {
          logger.error({
            level: "error",
            action: "staff-complaints",
            message: `Availability update failed: ${updateErr.message}`,
            timestamp: new Date().toISOString(),
          });
          return errorResponse("Failed to update availability status.");
        }
      }

      // ------- UPDATE action -------
      if (cleanActionType === "UPDATE") {
        const cleanComplaintId = sanitizeString(complaintId!);
        const cleanNewStatus = sanitizeString(newStatus!);

        const { data: complaintCheck, error: checkErr } = await supabaseAdmin
          .from("SSP_Complaint")
          .select("complaint_id, assigned_agent, non_society_user")
          .eq("complaint_id", cleanComplaintId)
          .maybeSingle();

        if (checkErr) {
          return errorResponse("Failed to verify complaint ownership.");
        }
        if (!complaintCheck) return errorResponse("Complaint not found.");

        const isAssignedToStaff = (staffType === "SERVICE_AGENT" &&
          complaintCheck.assigned_agent === staffIdValue) ||
          (staffType === "VENDOR" &&
            complaintCheck.non_society_user === staffIdValue);

        if (!isAssignedToStaff) {
          return errorResponse(
            "You are not authorized to update this complaint.",
          );
        }

        const updatePayload: {
          status: string;
          completion_date_time: string | null;
        } = {
          status: cleanNewStatus,
          completion_date_time: null,
        };

        if (cleanNewStatus.toLowerCase() === "resolved") {
          updatePayload.completion_date_time = getISTISOString();
        }

        const { error: updateErr } = await supabaseAdmin
          .from("SSP_Complaint")
          .update(updatePayload)
          .eq("complaint_id", cleanComplaintId);

        if (updateErr) {
          logger.error({
            level: "error",
            action: "staff-complaints",
            message: `Status update failed: ${updateErr.message}`,
            timestamp: new Date().toISOString(),
          });
          return errorResponse("Failed to update complaint status.");
        }

        return successResponse({
          statusUpdated: true,
          newStatus: cleanNewStatus,
          message: `Complaint status updated to "${cleanNewStatus}"`,
          staff: {
            id: staff.staffId,
            name: staff.name,
            role: staff.role,
            rating: staff.rating,
          },
        });
      }

      // ------- FETCH complaints -------
      const pageNum = Number(page) || 1;
      const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);

      let query = supabaseAdmin
        .from("SSP_Complaint")
        .select(`
          complaint_id,
          name,
          description,
          status,
          complaint_type,
          priority,
          created_at,
          assigned_date_time,
          completion_date_time,
          start_otp_verified_at,
          assigned_agent,
          non_society_user,
          society_user_data:SSP_Society_User!society_user (
            user_id,
            unit_flat_number,
            block:SSP_Block!left (block_name),
            tower:SSP_Tower!left (name),
            contact:contact (name, phone)
          )
        `);

      if (staffType === "SERVICE_AGENT") {
        query = query.eq("assigned_agent", staffIdValue);
      } else {
        query = query.eq("non_society_user", staffIdValue);
      }

      if (status && status.trim() !== "" && status.trim().toLowerCase() !== "all") {
        query = query.ilike("status", status.trim());
      }

      if (
        complaintType && complaintType.trim() !== "" &&
        complaintType.toLowerCase() !== "all"
      ) {
        query = query.eq("complaint_type", complaintType.trim());
      }

      if (
        priority && priority.trim() !== "" && priority.toLowerCase() !== "all"
      ) {
        query = query.eq("priority", priority.trim());
      }

      const dateBounds = calculateDateBounds(
        filterOption || null,
        fromDate,
        toDate,
      );
      if (dateBounds) {
        query = query
          .gte("assigned_date_time", dateBounds.startISO)
          .lt("assigned_date_time", dateBounds.endISO);
      }

      const isResolvedFilter = status?.trim().toLowerCase() === "resolved";
      const { data: complaints, error: fetchErr } = await query
        .order(
          isResolvedFilter ? "completion_date_time" : "assigned_date_time",
          { ascending: false, nullsFirst: false },
        )
        .order("created_at", { ascending: false })
        .order("complaint_id", { ascending: true });

      if (fetchErr) {
        logger.error({
          level: "error",
          action: "staff-complaints",
          message: `Fetch failed: ${fetchErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to fetch complaints.");
      }

      const rawComplaints = (complaints || []) as unknown as RawComplaint[];

      // ------- BATCH: fetch all documents -------
      const complaintIds = rawComplaints.map((c) => c.complaint_id);
      const imageMap = new Map<string, {
        residentUploaded: string[];
        before: string[];
        after: string[];
      }>();

      if (complaintIds.length > 0) {
        const { data: documents } = await supabaseAdmin
          .from("SSP_Document")
          .select("complaint, document_type, s3_path")
          .in("complaint", complaintIds);

        for (const doc of (documents ?? []) as RawDocument[]) {
          if (!doc.complaint) continue;
          if (!imageMap.has(doc.complaint)) {
            imageMap.set(doc.complaint, {
              residentUploaded: [],
              before: [],
              after: [],
            });
          }
          const images = imageMap.get(doc.complaint)!;
          const docType = (doc.document_type ?? "").trim().toLowerCase();

          if (
            docType === "complaint_attachment" ||
            docType === "facility_attachment"
          ) {
            if (images.residentUploaded.length < MAX_IMAGES_PER_TYPE) {
              images.residentUploaded.push(doc.s3_path);
            }
          } else if (
            docType === "before_complaint_image" ||
            docType === "before_image"
          ) {
            if (images.before.length < MAX_IMAGES_PER_TYPE) {
              images.before.push(doc.s3_path);
            }
          } else if (
            docType === "after_complaint_image" ||
            docType === "after_image"
          ) {
            if (images.after.length < MAX_IMAGES_PER_TYPE) {
              images.after.push(doc.s3_path);
            }
          }
        }
      }

      // ------- BATCH: sign all URLs in one pass -------
      const allPaths: string[] = [];
      for (const imgs of imageMap.values()) {
        allPaths.push(...imgs.residentUploaded, ...imgs.before, ...imgs.after);
      }
      const signedUrlMap = await batchSignUrls(allPaths);

      // ------- Assemble (no I/O) -------
      const formattedComplaints: ComplaintResponse[] = rawComplaints.map(
        (comp) => {
          const residentData = firstOrNull(comp.society_user_data);
          const contact = firstOrNull(residentData?.contact);
          const block = firstOrNull(residentData?.block);
          const tower = firstOrNull(residentData?.tower);

          const rawImages = imageMap.get(comp.complaint_id) ?? {
            residentUploaded: [],
            before: [],
            after: [],
          };

          const mapSigned = (paths: string[]): string[] => {
            const urls: string[] = [];
            for (const p of paths) {
              const u = signedUrlMap.get(p);
              if (u) urls.push(u);
            }
            return urls;
          };

          return {
            complaintId: comp.complaint_id,
            title: comp.name || "Untitled",
            description: comp.description || "",
            status: comp.status || "assigned",
            complaintType: comp.complaint_type || "general",
            priority: comp.priority || "medium",
            createdAt: comp.created_at || new Date().toISOString(),
            assignedDateTime: formatToIST(comp.assigned_date_time),
            completionDateTime: formatToIST(comp.completion_date_time),
            residentDetails: {
              name: contact?.name || "Unknown",
              phone: contact?.phone || "",
              unitFlatNumber: residentData?.unit_flat_number || null,
              blockName: block?.block_name || null,
              towerName: tower?.name || null,
            },
            images: {
              residentUploaded: mapSigned(rawImages.residentUploaded),
              before: mapSigned(rawImages.before),
              after: mapSigned(rawImages.after),
            },
          };
        },
      );

      // ✅ NEW: Build internal sort keys (never included in the response)
      const sortKeys = new Map<string, SortKeys>();
      for (const comp of rawComplaints) {
        sortKeys.set(comp.complaint_id, {
          assignedDT: comp.assigned_date_time
            ? new Date(comp.assigned_date_time).getTime()
            : 0,
          completionDT: comp.completion_date_time
            ? new Date(comp.completion_date_time).getTime()
            : 0,
          startOtpVerifiedAt: comp.start_otp_verified_at
            ? new Date(comp.start_otp_verified_at).getTime()
            : 0,
        });
      }

      // ------- Search -------
      let filteredComplaints = formattedComplaints;
      if (search) {
        filteredComplaints = applySearchFilter(filteredComplaints, search);
      }

      // ------- Sort -------
      // The resolved query is already ordered by completion_date_time DESC.
      // Preserve that order through search and pagination instead of re-sorting
      // the database timestamps in JavaScript.
      const sortedComplaints = isResolvedFilter
        ? filteredComplaints
        : sortComplaintsByStatus(filteredComplaints, sortKeys);

      // ------- Pagination -------
      const { items, total } = applyPagination(
        sortedComplaints,
        pageNum,
        limitNum,
      );

      // ------- Response -------
      const response: PaginatedResponse = {
        complaints: items,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
        filters: {
          status: status || null,
          complaintType: complaintType || null,
          priority: priority || null,
          filterOption: filterOption || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
        },
        search: search || null,
      };

      logger.info({
        level: "info",
        action: "staff-complaints",
        userId: authCtx.user.id,
        staffId: staffIdValue,
        staffType: staff.staffType,
        complaintsFound: total,
        returned: items.length,
        duration: Date.now() - startTime,
        message: "Complaints fetched successfully",
        timestamp: new Date().toISOString(),
      });

      return successResponse({
        staff: {
          id: staff.staffId,
          name: staff.name,
          role: staff.role,
          phone: staff.phone,
          rating: staff.rating,
        },
        ...response,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error({
        level: "error",
        action: "staff-complaints",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString(),
      });

      return errorResponse(errorMessage || "Failed to process request.");
    }
  }),
);
