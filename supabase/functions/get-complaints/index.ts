// // ============================================
// // get-complaints - Get Complaints with Filters, Search & Pagination
// // ============================================

// import { requireAuth } from "../_shared/auth.ts";
// import {
//   corsHeaders,
//   errorResponse,
//   successResponse,
// } from "../_shared/response.ts";
// import { logger, sanitizeString } from "../_shared/utils.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================

// interface GetComplaintsRequest {
//   societyRegistrationNumber: string;
//   status?: string;
//   priority?: string;
//   type?: string;
//   filterOption?: string;
//   fromDate?: string;
//   toDate?: string;
//   search?: string;
//   page?: number;
//   limit?: number;
// }

// interface ComplaintResponse {
//   complaintId: string;
//   title: string;
//   description: string;
//   status: string;
//   priority: string;
//   type: string;
//   createdAt: string;
//   assignedDateTime: string | null;
//   completionDateTime: string | null;
//   residentDetails: {
//     residentId: string;
//     name: string;
//     phone: string;
//     email: string;
//     unitFlatNumber: string | null;
//     blockName: string | null;
//     towerName: string | null;
//   };
//   assignedAgent: {
//     agentId: string | null;
//     name: string | null;
//   };
//   assignedVendor: {
//     vendorId: string | null;
//     name: string | null;
//   };
//   images: {
//     residentUploaded: string[] | null;
//     before: string[] | null;
//     after: string[] | null;
//   };
// }

// interface DocumentImage {
//   complaint: string;
//   document_type: string;
//   s3_path: string;
// }

// interface ContactInfo {
//   contact_id: string;
//   name: string;
//   phone: string;
//   email: string;
// }

// interface SocietyUserData {
//   user_id: string;
//   unit_flat_number: string | null;
//   tower: string | null;
//   block: string | null;
//   society: string;
//   contact: ContactInfo | ContactInfo[] | null;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const BUCKET_NAME = "society-documents";
// const MAX_IMAGES_PER_TYPE = 5;
// const supabaseAdmin = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// // ============================================
// // HELPER FUNCTIONS
// // ============================================

// /**
//  * Format date to IST
//  */
// function formatToIST(dateValue: string | Date | null): string | null {
//   if (!dateValue) return null;
//   const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
//   if (isNaN(date.getTime())) return null;

//   return date.toLocaleString("en-IN", {
//     timeZone: "Asia/Kolkata",
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//     hour12: true,
//   });
// }

// /**
//  * Calculate date bounds for filtering
//  */
// function calculateDateBounds(
//   filter: string | null,
//   fromStr?: string,
//   toStr?: string,
// ): { startISO: string; endISO: string } | null {
//   if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
//     return null;
//   }

//   const now = new Date();
//   const formatter = new Intl.DateTimeFormat("en-US", {
//     timeZone: "Asia/Kolkata",
//     year: "numeric",
//     month: "numeric",
//     day: "numeric",
//     weekday: "short",
//   });

//   const parts = formatter.formatToParts(now);
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
//     case "lastmonth": {
//       startMonth = month - 1;
//       startDay = 1;
//       endMonth = month;
//       endDay = 1;
//       break;
//     }
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

// /**
//  * Create signed URLs for multiple documents
//  */
// async function createSignedUrls(
//   paths: string[] | null,
// ): Promise<string[] | null> {
//   if (!paths || paths.length === 0) return null;

//   const signedUrls: string[] = [];

//   for (const path of paths) {
//     if (!path) continue;

//     let storageKey = path.trim();
//     const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;

//     if (storageKey.includes(marker)) {
//       storageKey = storageKey.split(marker)[1];
//     } else if (storageKey.includes(".amazonaws.com/")) {
//       storageKey = storageKey.split(".amazonaws.com/")[1];
//     }

//     storageKey = storageKey.trim();

//     const { data, error } = await supabaseAdmin.storage
//       .from(BUCKET_NAME)
//       .createSignedUrl(storageKey, 900);

//     if (error) {
//       logger.error({
//         level: "error",
//         action: "create-signed-url",
//         message: `Signed URL Error for path [${storageKey}]: ${error.message}`,
//         timestamp: new Date().toISOString(),
//       });
//       continue;
//     }

//     if (data?.signedUrl) {
//       signedUrls.push(data.signedUrl);
//     }
//   }

//   return signedUrls.length > 0 ? signedUrls : null;
// }

// /**
//  * Apply search filter to complaints
//  */
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
//     c.residentDetails.phone.includes(term) ||
//     c.residentDetails.email.toLowerCase().includes(term) ||
//     (c.residentDetails.unitFlatNumber?.toLowerCase().includes(term) ?? false) ||
//     (c.residentDetails.blockName?.toLowerCase().includes(term) ?? false) ||
//     (c.residentDetails.towerName?.toLowerCase().includes(term) ?? false) ||
//     c.type.toLowerCase().includes(term) ||
//     c.status.toLowerCase().includes(term) ||
//     c.priority.toLowerCase().includes(term)
//   );
// }

// /**
//  * Apply filters to complaints
//  */
// function applyFilters(
//   complaints: ComplaintResponse[],
//   filters: {
//     status?: string;
//     priority?: string;
//     type?: string;
//   },
// ): ComplaintResponse[] {
//   let filtered = [...complaints];

//   if (filters.status && filters.status.toLowerCase() !== "all") {
//     filtered = filtered.filter((c) =>
//       c.status.toLowerCase() === filters.status!.toLowerCase()
//     );
//   }

//   if (filters.priority && filters.priority.toLowerCase() !== "all") {
//     filtered = filtered.filter((c) =>
//       c.priority.toLowerCase() === filters.priority!.toLowerCase()
//     );
//   }

//   if (filters.type && filters.type.toLowerCase() !== "all") {
//     filtered = filtered.filter((c) =>
//       c.type.toLowerCase() === filters.type!.toLowerCase()
//     );
//   }

//   return filtered;
// }

// /**
//  * Apply pagination to data
//  */
// function applyPagination<T>(
//   data: T[],
//   page: number,
//   limit: number,
// ): { items: T[]; total: number } {
//   const total = data.length;
//   const start = (page - 1) * limit;
//   const end = start + limit;
//   const items = data.slice(start, end);
//   return { items, total };
// }

// /**
//  * Extract first item from array or return null
//  */
// function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
//   if (!arr) return null;
//   if (Array.isArray(arr)) {
//     return arr.length > 0 ? arr[0] : null;
//   }
//   return arr;
// }

// /**
//  * Extract contact info from user data
//  */
// function extractContact(
//   contact: ContactInfo | ContactInfo[] | null | undefined,
// ): ContactInfo | null {
//   if (!contact) return null;
//   if (Array.isArray(contact)) {
//     return contact.length > 0 ? contact[0] : null;
//   }
//   return contact;
// }

// /**
//  * Find resident user by ID with complete details
//  */
// async function findResidentUser(
//   residentId: string,
//   societyId: string,
// ): Promise<{ data: SocietyUserData | null; error?: string }> {
//   try {
//     const { data: userData, error: userError } = await supabaseAdmin
//       .from("SSP_Society_User")
//       .select(`
//         user_id,
//         unit_flat_number,
//         tower,
//         block,
//         society,
//         contact:SSP_Contact!inner(
//           contact_id,
//           name,
//           phone,
//           email
//         )
//       `)
//       .eq("user_id", residentId)
//       .eq("society", societyId)
//       .maybeSingle();

//     if (userError) {
//       return { data: null, error: userError.message };
//     }

//     if (!userData) {
//       return { data: null, error: "NOT_FOUND" };
//     }

//     // Extract contact using the helper function
//     const contactData = extractContact(userData.contact);

//     if (!contactData) {
//       return { data: null, error: "Contact not found" };
//     }

//     return {
//       data: {
//         user_id: userData.user_id,
//         unit_flat_number: userData.unit_flat_number || null,
//         tower: userData.tower || null,
//         block: userData.block || null,
//         society: userData.society,
//         contact: {
//           contact_id: contactData.contact_id,
//           name: contactData.name,
//           phone: contactData.phone,
//           email: contactData.email || "",
//         },
//       },
//     };
//   } catch (error: unknown) {
//     const errorMessage = error instanceof Error
//       ? error.message
//       : "Unknown error";
//     return { data: null, error: errorMessage };
//   }
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// Deno.serve(
//   requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
//     if (req.method === "OPTIONS") {
//       return new Response("ok", { headers: corsHeaders });
//     }

//     try {
//       logger.info({
//         level: "info",
//         action: "get-complaints",
//         userId: authCtx.user.id,
//         message: "Get complaints request received",
//         timestamp: new Date().toISOString(),
//       });

//       if (req.method !== "POST") {
//         return errorResponse("Only POST method is allowed.");
//       }

//       const body = await req.json().catch(() => null);
//       if (!body) {
//         return errorResponse("Request body is required.");
//       }

//       const {
//         societyRegistrationNumber,
//         status,
//         priority,
//         type,
//         filterOption,
//         fromDate,
//         toDate,
//         search,
//         page,
//         limit,
//       } = body as GetComplaintsRequest;

//       if (!societyRegistrationNumber) {
//         return errorResponse("societyRegistrationNumber is mandatory.");
//       }

//       const regNum = sanitizeString(societyRegistrationNumber);
//       const rawFilter = filterOption ? sanitizeString(filterOption) : null;

//       if (
//         rawFilter && rawFilter.toLowerCase() === "custom" &&
//         (!fromDate || !toDate)
//       ) {
//         return errorResponse(
//           "fromDate and toDate are required for Custom filter.",
//         );
//       }

//       const pageNum = Number(page) || 1;
//       const limitNum = Math.min(Number(limit) || 20, 100);

//       // ============================================
//       // STEP 1: Get Society
//       // ============================================
//       const { data: society, error: socErr } = await supabaseAdmin
//         .from("SSP_Society")
//         .select("society_id, registration_number, society_name")
//         .eq("registration_number", regNum)
//         .maybeSingle();

//       if (socErr) {
//         return errorResponse("Failed to fetch society data.");
//       }

//       if (!society) {
//         return errorResponse(
//           "Society not found for provided registration number.",
//         );
//       }

//       // ============================================
//       // STEP 2: Get all complaints for this society
//       // ============================================
//       let query = supabaseAdmin
//         .from("SSP_Complaint")
//         .select(`
//           complaint_id,
//           name,
//           complaint_type,
//           description,
//           status,
//           priority,
//           assigned_date_time,
//           completion_date_time,
//           created_at,
//           society_user,
//           assigned_agent,
//           non_society_user,
//           assigned_by
//         `);

//       // First get all user IDs for this society using a subquery
//       const { data: societyUsers, error: usersErr } = await supabaseAdmin
//         .from("SSP_Society_User")
//         .select("user_id")
//         .eq("society", society.society_id);

//       if (usersErr) {
//         return errorResponse("Failed to fetch society users.");
//       }

//       if (!societyUsers || societyUsers.length === 0) {
//         return successResponse({
//           total: 0,
//           page: pageNum,
//           limit: limitNum,
//           totalPages: 0,
//           complaints: [],
//           filters: {
//             status: status || null,
//             priority: priority || null,
//             type: type || null,
//             filterOption: filterOption || null,
//             fromDate: fromDate || null,
//             toDate: toDate || null,
//           },
//           search: search || null,
//         });
//       }

//       const userIds = societyUsers.map((u: { user_id: string }) => u.user_id);
//       query = query.in("society_user", userIds);

//       // Apply filters
//       if (status && status.trim() !== "" && status.toLowerCase() !== "all") {
//         query = query.eq("status", status.trim());
//       }

//       const dateBounds = calculateDateBounds(rawFilter, fromDate, toDate);
//       if (dateBounds) {
//         query = query
//           .gte("created_at", dateBounds.startISO)
//           .lt("created_at", dateBounds.endISO);
//       }

//       if (
//         priority && priority.trim() !== "" && priority.toLowerCase() !== "all"
//       ) {
//         query = query.eq("priority", priority.trim());
//       }

//       if (type && type.trim() !== "" && type.toLowerCase() !== "all") {
//         query = query.eq("complaint_type", type.trim());
//       }

//       // Execute query
//       const { data: complaints, error: fetchErr } = await query
//         .order("created_at", { ascending: false });

//       if (fetchErr) {
//         return errorResponse("Failed to fetch complaints.");
//       }

//       const rawComplaints = complaints || [];

//       // ============================================
//       // STEP 3: Fetch Images (Multiple per type)
//       // ============================================
//       const complaintIds = rawComplaints.map((c: { complaint_id: string }) =>
//         c.complaint_id
//       );
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

//         (documents as DocumentImage[] | null)?.forEach((doc) => {
//           if (!doc.complaint) return;

//           if (!imageMap.has(doc.complaint)) {
//             imageMap.set(doc.complaint, {
//               residentUploaded: [],
//               before: [],
//               after: [],
//             });
//           }

//           const images = imageMap.get(doc.complaint)!;
//           // ✅ FIXED: compare lowercase values (DB stores snake_case)
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
//         });
//       }

//       // ============================================
//       // STEP 4: Format Complaints with Resident Details
//       // ============================================
//       const formattedComplaints: ComplaintResponse[] = [];

//       for (const comp of rawComplaints) {
//         // Get resident details
//         const userResult = await findResidentUser(
//           comp.society_user,
//           society.society_id,
//         );

//         let residentDetails = {
//           residentId: "",
//           name: "Unknown",
//           phone: "",
//           email: "",
//           unitFlatNumber: null as string | null,
//           blockName: null as string | null,
//           towerName: null as string | null,
//         };

//         if (userResult.data && !userResult.error) {
//           const user = userResult.data;
//           // Extract contact using the helper function
//           const contact = extractContact(user.contact);

//           residentDetails = {
//             residentId: user.user_id || "",
//             name: contact?.name || "Unknown",
//             phone: contact?.phone || "",
//             email: contact?.email || "",
//             unitFlatNumber: user.unit_flat_number || null,
//             blockName: user.block || null,
//             towerName: user.tower || null,
//           };
//         }

//         // Get agent details
//         let agentName: string | null = null;
//         if (comp.assigned_agent) {
//           const agentResult = await findResidentUser(
//             comp.assigned_agent,
//             society.society_id,
//           );
//           if (agentResult.data && !agentResult.error) {
//             const contact = extractContact(agentResult.data.contact);
//             agentName = contact?.name || null;
//           }
//         }

//         // Get vendor details
//         let vendorName: string | null = null;
//         if (comp.non_society_user) {
//           const { data: vendorData } = await supabaseAdmin
//             .from("SSP_Non_Society_User")
//             .select("name")
//             .eq("non_society_user_id", comp.non_society_user)
//             .maybeSingle();
//           if (vendorData) {
//             vendorName = vendorData.name;
//           }
//         }

//         // Get images with signed URLs
//         const rawImages = imageMap.get(comp.complaint_id);
//         const residentUploadedImages = await createSignedUrls(
//           rawImages?.residentUploaded ?? null,
//         );
//         const beforeImages = await createSignedUrls(
//           rawImages?.before ?? null,
//         );
//         const afterImages = await createSignedUrls(
//           rawImages?.after ?? null,
//         );

//         formattedComplaints.push({
//           complaintId: comp.complaint_id,
//           title: comp.name || "Untitled",
//           description: comp.description || "",
//           status: comp.status || "pending",
//           priority: comp.priority || "medium",
//           type: comp.complaint_type || "general",
//           createdAt: comp.created_at || new Date().toISOString(),
//           assignedDateTime: formatToIST(comp.assigned_date_time),
//           completionDateTime: formatToIST(comp.completion_date_time),
//           residentDetails: residentDetails,
//           assignedAgent: {
//             agentId: comp.assigned_agent || null,
//             name: agentName,
//           },
//           assignedVendor: {
//             vendorId: comp.non_society_user || null,
//             name: vendorName,
//           },
//           images: {
//             residentUploaded: residentUploadedImages,
//             before: beforeImages,
//             after: afterImages,
//           },
//         });
//       }

//       // ============================================
//       // STEP 5: Apply Search, Filters & Pagination
//       // ============================================
//       let filteredComplaints = formattedComplaints;
//       if (search) {
//         filteredComplaints = applySearchFilter(filteredComplaints, search);
//       }

//       filteredComplaints = applyFilters(filteredComplaints, {
//         status: status || "all",
//         priority: priority || "all",
//         type: type || "all",
//       });

//       const { items, total } = applyPagination(
//         filteredComplaints,
//         pageNum,
//         limitNum,
//       );

//       // ============================================
//       // STEP 6: Return Response
//       // ============================================
//       return successResponse({
//         total: total,
//         page: pageNum,
//         limit: limitNum,
//         totalPages: Math.ceil(total / limitNum),
//         complaints: items,
//         filters: {
//           status: status || null,
//           priority: priority || null,
//           type: type || null,
//           filterOption: filterOption || null,
//           fromDate: fromDate || null,
//           toDate: toDate || null,
//         },
//         search: search || null,
//       });
//     } catch (error: unknown) {
//       const errorMessage = error instanceof Error
//         ? error.message
//         : "Unknown error";

//       logger.error({
//         level: "error",
//         action: "get-complaints",
//         userId: authCtx?.user?.id || "unknown",
//         message: errorMessage,
//         stack: error instanceof Error ? error.stack : undefined,
//         timestamp: new Date().toISOString(),
//       });

//       return errorResponse(errorMessage || "Failed to fetch complaints.");
//     }
//   }),
// );




// ============================================
// get-complaints - Get Complaints (Production Optimized)
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface GetComplaintsRequest {
  societyRegistrationNumber: string;
  status?: string;
  priority?: string;
  type?: string;
  filterOption?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface ComplaintResponse {
  complaintId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  type: string;
  createdAt: string;
  assignedDateTime: string | null;
  completionDateTime: string | null;
  residentDetails: {
    residentId: string;
    name: string;
    phone: string;
    email: string;
    unitFlatNumber: string | null;
    blockName: string | null;
    towerName: string | null;
  };
  assignedAgent: { agentId: string | null; name: string | null };
  assignedVendor: { vendorId: string | null; name: string | null };
  images: {
    residentUploaded: string[] | null;
    before: string[] | null;
    after: string[] | null;
  };
}

interface DocumentImage {
  complaint: string;
  document_type: string;
  s3_path: string;
}

interface ContactInfo {
  contact_id: string;
  name: string;
  phone: string;
  email: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_IMAGES_PER_TYPE = 5;
const SIGNED_URL_TTL = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// Cached IST formatter (reused across requests in the same isolate)
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

// In-memory signed URL cache (per isolate, cleared on cold start)
const urlCache = new Map<string, { url: string; expiresAt: number }>();

// ============================================
// HELPERS
// ============================================

function formatToIST(dateValue: string | Date | null): string | null {
  if (!dateValue) return null;
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (isNaN(date.getTime())) return null;
  return IST_FORMATTER.format(date);
}

function calculateDateBounds(
  filter: string | null,
  fromStr?: string,
  toStr?: string,
): { startISO: string; endISO: string } | null {
  if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
    return null;
  }

  const now = new Date();
  const parts = IST_FORMATTER.formatToParts(now);
  const pMap = new Map(parts.map((p) => [p.type, p.value]));

  // Recalculate weekday separately (IST_FORMATTER doesn't include weekday)
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  });
  const weekday = weekdayFormatter.format(now);

  const year = parseInt(pMap.get("year")!);
  const month = parseInt(pMap.get("month")!) - 1;
  const day = parseInt(pMap.get("day")!);
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);

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

  return { startISO: startObj.toISOString(), endISO: endObj.toISOString() };
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
    c.residentDetails.phone.includes(term) ||
    c.residentDetails.email.toLowerCase().includes(term) ||
    (c.residentDetails.unitFlatNumber?.toLowerCase().includes(term) ?? false) ||
    (c.residentDetails.blockName?.toLowerCase().includes(term) ?? false) ||
    (c.residentDetails.towerName?.toLowerCase().includes(term) ?? false) ||
    c.type.toLowerCase().includes(term) ||
    c.status.toLowerCase().includes(term) ||
    c.priority.toLowerCase().includes(term)
  );
}

function applyFilters(
  complaints: ComplaintResponse[],
  filters: { status?: string; priority?: string; type?: string },
): ComplaintResponse[] {
  let filtered = complaints;
  const s = filters.status?.toLowerCase();
  const p = filters.priority?.toLowerCase();
  const t = filters.type?.toLowerCase();

  if (s && s !== "all") {
    filtered = filtered.filter((c) => c.status.toLowerCase() === s);
  }
  if (p && p !== "all") {
    filtered = filtered.filter((c) => c.priority.toLowerCase() === p);
  }
  if (t && t !== "all") {
    filtered = filtered.filter((c) => c.type.toLowerCase() === t);
  }
  return filtered;
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
// BATCH HELPERS
// ============================================

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
 * Sign many storage keys in parallel with bounded concurrency + in-memory cache.
 * Returns a map of original_path → signed_url.
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
            .createSignedUrl(key, SIGNED_URL_TTL);
          if (error || !data?.signedUrl) return [originalPath, null] as const;
          return [originalPath, data.signedUrl] as const;
        } catch {
          return [originalPath, null] as const;
        }
      }),
    );
    const expiresAt = Date.now() + SIGNED_URL_TTL * 1000;
    for (const [orig, url] of signed) {
      if (url) {
        result.set(orig, url);
        urlCache.set(orig, { url, expiresAt });
      }
    }
  }

  return result;
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
  requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const t0 = Date.now();
    try {
      logger.info({
        level: "info",
        action: "get-complaints",
        userId: authCtx.user.id,
        message: "Get complaints request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("Request body is required.");

      const {
        societyRegistrationNumber,
        status,
        priority,
        type,
        filterOption,
        fromDate,
        toDate,
        search,
        page,
        limit,
      } = body as GetComplaintsRequest;

      if (!societyRegistrationNumber) {
        return errorResponse("societyRegistrationNumber is mandatory.");
      }

      const regNum = sanitizeString(societyRegistrationNumber);
      const rawFilter = filterOption ? sanitizeString(filterOption) : null;

      if (
        rawFilter && rawFilter.toLowerCase() === "custom" &&
        (!fromDate || !toDate)
      ) {
        return errorResponse("fromDate and toDate are required for Custom filter.");
      }

      const pageNum = Number(page) || 1;
      const limitNum = Math.min(Number(limit) || 20, 100);

      // --------------------------------------------------
      // STEP 1 + 2 in parallel: society lookup + users lookup
      // --------------------------------------------------
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number, society_name")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr) return errorResponse("Failed to fetch society data.");
      if (!society) {
        return errorResponse("Society not found for provided registration number.");
      }

      const { data: societyUsers, error: usersErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("society", society.society_id);

      if (usersErr) return errorResponse("Failed to fetch society users.");

      if (!societyUsers || societyUsers.length === 0) {
        return successResponse({
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0,
          complaints: [],
          filters: {
            status: status || null,
            priority: priority || null,
            type: type || null,
            filterOption: filterOption || null,
            fromDate: fromDate || null,
            toDate: toDate || null,
          },
          search: search || null,
        });
      }

      const userIds = societyUsers.map((u: { user_id: string }) => u.user_id);

      // --------------------------------------------------
      // STEP 3: Complaints (single query with filters)
      // --------------------------------------------------
      let query = supabaseAdmin
        .from("SSP_Complaint")
        .select(`
          complaint_id,
          name,
          complaint_type,
          description,
          status,
          priority,
          assigned_date_time,
          completion_date_time,
          created_at,
          society_user,
          assigned_agent,
          non_society_user,
          assigned_by
        `)
        .in("society_user", userIds);

      if (status && status.trim() !== "" && status.toLowerCase() !== "all") {
        query = query.eq("status", status.trim());
      }

      const dateBounds = calculateDateBounds(rawFilter, fromDate, toDate);
      if (dateBounds) {
        query = query
          .gte("created_at", dateBounds.startISO)
          .lt("created_at", dateBounds.endISO);
      }

      if (priority && priority.trim() !== "" && priority.toLowerCase() !== "all") {
        query = query.eq("priority", priority.trim());
      }

      if (type && type.trim() !== "" && type.toLowerCase() !== "all") {
        query = query.eq("complaint_type", type.trim());
      }

      const { data: complaints, error: fetchErr } = await query.order(
        "created_at",
        { ascending: false },
      );

      if (fetchErr) return errorResponse("Failed to fetch complaints.");

      const rawComplaints = complaints || [];
      if (rawComplaints.length === 0) {
        return successResponse({
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0,
          complaints: [],
          filters: {
            status: status || null,
            priority: priority || null,
            type: type || null,
            filterOption: filterOption || null,
            fromDate: fromDate || null,
            toDate: toDate || null,
          },
          search: search || null,
        });
      }

      const complaintIds = rawComplaints.map((c: { complaint_id: string }) =>
        c.complaint_id
      );

      // --------------------------------------------------
      // STEP 4: Batch DB queries in parallel
      // --------------------------------------------------
      const residentIds = Array.from(
        new Set(
          rawComplaints
            .map((c: { society_user: string }) => c.society_user)
            .filter(Boolean),
        ),
      );
      const agentIds = Array.from(
        new Set(
          rawComplaints
            .map((c: { assigned_agent: string | null }) => c.assigned_agent)
            .filter(Boolean) as string[],
        ),
      );
      const vendorIds = Array.from(
        new Set(
          rawComplaints
            .map((c: { non_society_user: string | null }) => c.non_society_user)
            .filter(Boolean) as string[],
        ),
      );
      const allUserIds = Array.from(new Set([...residentIds, ...agentIds]));

      const [usersRes, vendorsRes, docsRes] = await Promise.all([
        allUserIds.length > 0
          ? supabaseAdmin
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
              .in("user_id", allUserIds)
          : Promise.resolve({ data: [], error: null } as const),

        vendorIds.length > 0
          ? supabaseAdmin
              .from("SSP_Non_Society_User")
              .select("non_society_user_id, name")
              .in("non_society_user_id", vendorIds)
          : Promise.resolve({ data: [], error: null } as const),

        complaintIds.length > 0
          ? supabaseAdmin
              .from("SSP_Document")
              .select("complaint, document_type, s3_path")
              .in("complaint", complaintIds)
          : Promise.resolve({ data: [], error: null } as const),
      ]);

      type UserRow = {
        user_id: string;
        unit_flat_number: string | null;
        tower: string | null;
        block: string | null;
        society: string;
        contact: ContactInfo | ContactInfo[] | null;
      };

      const userMap = new Map<string, UserRow>();
      for (const u of (usersRes.data ?? []) as UserRow[]) {
        userMap.set(u.user_id, u);
      }

      const vendorMap = new Map<string, string>();
      for (const v of (vendorsRes.data ?? []) as {
        non_society_user_id: string;
        name: string;
      }[]) {
        vendorMap.set(v.non_society_user_id, v.name);
      }

      // --------------------------------------------------
      // STEP 5: Group documents by complaint
      // --------------------------------------------------
      const imageMap = new Map<string, {
        residentUploaded: string[];
        before: string[];
        after: string[];
      }>();

      for (const doc of (docsRes.data ?? []) as DocumentImage[]) {
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

      // --------------------------------------------------
      // STEP 6: Batch sign URLs (with cache)
      // --------------------------------------------------
      const allPaths: string[] = [];
      for (const imgs of imageMap.values()) {
        allPaths.push(...imgs.residentUploaded, ...imgs.before, ...imgs.after);
      }
      const signedUrlMap = await batchSignUrls(allPaths);

      // --------------------------------------------------
      // STEP 7: Assemble (no I/O)
      // --------------------------------------------------
      const formattedComplaints: ComplaintResponse[] = rawComplaints.map(
        (comp: {
          complaint_id: string;
          name: string | null;
          complaint_type: string | null;
          description: string | null;
          status: string | null;
          priority: string | null;
          assigned_date_time: string | null;
          completion_date_time: string | null;
          created_at: string | null;
          society_user: string;
          assigned_agent: string | null;
          non_society_user: string | null;
          assigned_by: string | null;
        }) => {
          const residentUser = userMap.get(comp.society_user);
          const residentContact = residentUser
            ? Array.isArray(residentUser.contact)
              ? residentUser.contact[0] ?? null
              : residentUser.contact
            : null;

          const residentDetails = {
            residentId: residentUser?.user_id || "",
            name: residentContact?.name || "Unknown",
            phone: residentContact?.phone || "",
            email: residentContact?.email || "",
            unitFlatNumber: residentUser?.unit_flat_number || null,
            blockName: residentUser?.block || null,
            towerName: residentUser?.tower || null,
          };

          let agentName: string | null = null;
          if (comp.assigned_agent) {
            const agentUser = userMap.get(comp.assigned_agent);
            if (agentUser) {
              const c = Array.isArray(agentUser.contact)
                ? agentUser.contact[0] ?? null
                : agentUser.contact;
              agentName = c?.name || null;
            }
          }

          const vendorName = comp.non_society_user
            ? vendorMap.get(comp.non_society_user) ?? null
            : null;

          const rawImages = imageMap.get(comp.complaint_id);
          const mapSigned = (paths: string[] | undefined): string[] | null => {
            if (!paths || paths.length === 0) return null;
            const urls = paths
              .map((p) => signedUrlMap.get(p))
              .filter((u): u is string => Boolean(u));
            return urls.length > 0 ? urls : null;
          };

          return {
            complaintId: comp.complaint_id,
            title: comp.name || "Untitled",
            description: comp.description || "",
            status: (comp.status || "pending").replace(/^./, (ch) =>
              ch.toUpperCase()),
            priority: (comp.priority || "medium").replace(/^./, (ch) =>
              ch.toUpperCase()),
            type: (comp.complaint_type || "general").replace(/^./, (ch) =>
              ch.toUpperCase()),
            createdAt: comp.created_at || new Date().toISOString(),
            assignedDateTime: formatToIST(comp.assigned_date_time),
            completionDateTime: formatToIST(comp.completion_date_time),
            residentDetails,
            assignedAgent: {
              agentId: comp.assigned_agent || null,
              name: agentName,
            },
            assignedVendor: {
              vendorId: comp.non_society_user || null,
              name: vendorName,
            },
            images: {
              residentUploaded: mapSigned(rawImages?.residentUploaded),
              before: mapSigned(rawImages?.before),
              after: mapSigned(rawImages?.after),
            },
          };
        },
      );

      // --------------------------------------------------
      // STEP 8: Search, filter, paginate
      // --------------------------------------------------
      let filteredComplaints = formattedComplaints;
      if (search) filteredComplaints = applySearchFilter(filteredComplaints, search);
      filteredComplaints = applyFilters(filteredComplaints, {
        status: status || "all",
        priority: priority || "all",
        type: type || "all",
      });

      const { items, total } = applyPagination(
        filteredComplaints,
        pageNum,
        limitNum,
      );

      logger.info({
        level: "info",
        action: "get-complaints",
        message: "Completed",
        duration_ms: Date.now() - t0,
        total_complaints: total,
        timestamp: new Date().toISOString(),
      });

      return successResponse({
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        complaints: items,
        filters: {
          status: status || null,
          priority: priority || null,
          type: type || null,
          filterOption: filterOption || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
        },
        search: search || null,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";
      logger.error({
        level: "error",
        action: "get-complaints",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        duration_ms: Date.now() - t0,
        timestamp: new Date().toISOString(),
      });
      return errorResponse(errorMessage || "Failed to fetch complaints.");
    }
  }),
);