// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'POST, OPTIONS'
// };
// serve(async (req)=>{
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', {
//       headers: corsHeaders
//     });
//   }
//   const startTime = Date.now();
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return buildError('BAD_REQUEST', 'Request body is empty.', 400, startTime);
//     }
//     const { societyRegistrationNumber, searchText } = JSON.parse(bodyText);
//     if (!societyRegistrationNumber) {
//       return buildError('BAD_REQUEST', 'societyRegistrationNumber is mandatory.', 400, startTime);
//     }
//     const regNum = String(societyRegistrationNumber).trim();
//     const searchString = searchText ? String(searchText).trim() : null;
//     // ================= STEP 1: FETCH HIRED SERVANTS =================
//     const { data: societyServants, error: servantErr } = await supabase.from('SSP_Society_Servant').select(`
//         hired,
//         SSP_Servant!inner ( servant_name, phone_number, servant_id ),
//         SSP_Society_User!inner (
//           unit_flat_number,
//           SSP_Block!left ( block_name ),
//           SSP_Tower!left ( name ),
//           SSP_Contact!left ( name ),
//           SSP_Society!inner ( registration_number )
//         )
//       `).eq('SSP_Society_User.SSP_Society.registration_number', regNum).eq('hired', true);
//     if (servantErr) throw servantErr;
//     const hiredServantMap = new Map();
//     if (societyServants) {
//       for (const ss of societyServants){
//         const servantObj = Array.isArray(ss.SSP_Servant) ? ss.SSP_Servant[0] : ss.SSP_Servant;
//         const sUserObj = Array.isArray(ss.SSP_Society_User) ? ss.SSP_Society_User[0] : ss.SSP_Society_User;
//         if (servantObj?.phone_number) {
//           const servantName = servantObj.servant_name ?? '';
//           const flatNum = sUserObj?.unit_flat_number ?? '';
//           if (!searchString || servantName.toLowerCase().includes(searchString.toLowerCase()) || flatNum.toLowerCase().includes(searchString.toLowerCase())) {
//             hiredServantMap.set(servantObj.phone_number, ss);
//           }
//         }
//       }
//     }
//     // ================= STEP 2: FETCH VISITOR LOGS =================
//     const { data: visitorRecords, error: visitorErr } = await supabase.from('SSP_Non_Society_User').select(`
//         non_society_user_id, name, phone_number, check_in, check_out, role,
//         purpose, visitor_status, gate_no, delivery_origin, vehicle_type, vehicle_number,
//         Hosted_by:SSP_Society_User!hosted_by!inner (
//           unit_flat_number,
//           SSP_Block!left ( block_name ),
//           SSP_Tower!left ( name ),
//           SSP_Contact!left ( name ),
//           SSP_Society!inner ( registration_number )
//         )
//       `).eq('Hosted_by.SSP_Society.registration_number', regNum).order('check_in', {
//       ascending: false
//     });
//     if (visitorErr) throw visitorErr;
//     // ================= STEP 3: VISITOR IMAGE MAP LOGIC =================
//     const imageMap = new Map();
//     const visitorIds = visitorRecords?.map((v)=>v.non_society_user_id) || [];
//     if (visitorIds.length > 0) {
//       const { data: docs, error: docErr } = await supabase.from('SSP_Document').select('s3_path, non_society_user').in('non_society_user', visitorIds);
//       if (docErr) throw docErr;
//       if (docs) {
//         for (const doc of docs){
//           if (doc.s3_path && doc.non_society_user && !imageMap.has(doc.non_society_user)) {
//             let finalUrl = doc.s3_path;
//             // If path contains Supabase bucket structure, parse it into a direct native public URL
//             if (doc.s3_path.includes('/storage/v1/object/public/')) {
//               const parts = doc.s3_path.split('/storage/v1/object/public/society-documents/');
//               if (parts.length > 1) {
//                 const storageKey = parts[1];
//                 const { data } = supabase.storage.from('society-documents').getPublicUrl(storageKey);
//                 if (data?.publicUrl) {
//                   finalUrl = data.publicUrl;
//                 }
//               }
//             }
//             imageMap.set(doc.non_society_user, finalUrl);
//           }
//         }
//       }
//     }
//     // ================= STEP 4: PROCESSING & MERGING DATA =================
//     const visitorsList = [];
//     let totalVisitedToday = 0;
//     let currentlyInside = 0;
//     let currentlyOutside = 0;
//     const todayStr = new Date().toISOString().split('T')[0];
//     const servantsWithLogs = new Set();
//     if (visitorRecords) {
//       for (const v of visitorRecords){
//         const hostObj = Array.isArray(v.Hosted_by) ? v.Hosted_by[0] : v.Hosted_by;
//         if (searchString) {
//           const nameText = (v.name ?? '').toLowerCase();
//           const flatText = (hostObj?.unit_flat_number ?? '').toLowerCase();
//           const target = searchString.toLowerCase();
//           if (!nameText.includes(target) && !flatText.includes(target)) {
//             continue;
//           }
//         }
//         const blockObj = Array.isArray(hostObj?.SSP_Block) ? hostObj?.SSP_Block[0] : hostObj?.SSP_Block;
//         const towerObj = Array.isArray(hostObj?.SSP_Tower) ? hostObj?.SSP_Tower[0] : hostObj?.SSP_Tower;
//         const contactObj = Array.isArray(hostObj?.SSP_Contact) ? hostObj?.SSP_Contact[0] : hostObj?.SSP_Contact;
//         const normalizedRole = Array.isArray(v.role) ? v.role[0] : v.role;
//         visitorsList.push({
//           visitorName: v.name ?? 'NA',
//           phone: v.phone_number ?? 'NA',
//           clockIn: v.check_in ?? null,
//           clockOut: v.check_out ?? null,
//           purpose: v.purpose ?? 'NA',
//           status: v.visitor_status ?? 'NA',
//           gateNumber: v.gate_no ?? 'NA',
//           deliveryOrigin: v.delivery_origin ?? 'NA',
//           vehicleType: v.vehicle_type ?? 'NA',
//           vehicleNumber: v.vehicle_number ?? 'NA',
//           role: normalizedRole ?? 'NA',
//           visitorImageUrl: imageMap.get(v.non_society_user_id) ?? null,
//           hostName: contactObj?.name ?? 'NA',
//           hostFlat: hostObj?.unit_flat_number ?? 'NA',
//           hostTower: towerObj?.name ?? 'NA',
//           hostBlock: blockObj?.block_name ?? 'NA'
//         });
//         if (v.check_in && v.check_in.startsWith(todayStr)) {
//           totalVisitedToday++;
//         }
//         if (v.visitor_status === 'Inside') {
//           currentlyInside++;
//         } else if (v.visitor_status === 'Outside' || v.visitor_status === 'Completed') {
//           currentlyOutside++;
//         }
//         if (normalizedRole === 'Servant' && v.phone_number) {
//           servantsWithLogs.add(v.phone_number);
//         }
//       }
//     }
//     // Merge in hired servants without logs
//     for (const [phone, ss] of hiredServantMap.entries()){
//       if (!servantsWithLogs.has(phone)) {
//         const servantObj = Array.isArray(ss.SSP_Servant) ? ss.SSP_Servant[0] : ss.SSP_Servant;
//         const sUserObj = Array.isArray(ss.SSP_Society_User) ? ss.SSP_Society_User[0] : ss.SSP_Society_User;
//         const blockObj = Array.isArray(sUserObj?.SSP_Block) ? sUserObj?.SSP_Block[0] : sUserObj?.SSP_Block;
//         const towerObj = Array.isArray(sUserObj?.SSP_Tower) ? sUserObj?.SSP_Tower[0] : sUserObj?.SSP_Tower;
//         const contactObj = Array.isArray(sUserObj?.SSP_Contact) ? sUserObj?.SSP_Contact[0] : sUserObj?.SSP_Contact;
//         visitorsList.push({
//           visitorName: servantObj?.servant_name ?? 'NA',
//           phone: phone,
//           clockIn: null,
//           clockOut: null,
//           purpose: 'Daily Help / Servant',
//           status: 'Outside',
//           gateNumber: 'NA',
//           deliveryOrigin: 'NA',
//           vehicleType: 'NA',
//           vehicleNumber: 'NA',
//           role: 'Servant',
//           visitorImageUrl: null,
//           hostName: contactObj?.name ?? 'NA',
//           hostFlat: sUserObj?.unit_flat_number ?? 'NA',
//           hostTower: towerObj?.name ?? 'NA',
//           hostBlock: blockObj?.block_name ?? 'NA'
//         });
//         currentlyOutside++;
//       }
//     }
//     console.log(`Successfully compiled visitor ledger matrix in ${Date.now() - startTime}ms`);
//     return new Response(JSON.stringify({
//       visitors: visitorsList,
//       totalVisitedToday,
//       currentlyInside,
//       currentlyOutside,
//       errorResponse: null
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (error) {
//     return buildError('SERVER_ERROR', `Database Execution Failure: ${error.message || 'Fatal unexpected exception.'}`, 500, startTime);
//   }
// });
// function buildError(code, msg, status, start) {
//   console.error(`Get Visitors operation failed -> [${code}]: ${msg}`);
//   return new Response(JSON.stringify({
//     visitors: [],
//     totalVisitedToday: 0,
//     currentlyInside: 0,
//     currentlyOutside: 0,
//     errorResponse: {
//       errorCode: code,
//       message: msg,
//       timestamp: new Date().toISOString()
//     }
//   }), {
//     status,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }


// // ============================================
// // get-visitors - Get Visitors with Filters, Search & Pagination
// // ============================================

// import { requireAuth } from "../_shared/auth.ts";
// import {
//   corsHeaders,
//   errorResponse,
//   successResponse,
// } from "../_shared/response.ts";
// import { logger, sanitizeString } from "../_shared/utils.ts";
// import { Validator } from "../_shared/validation.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================

// interface GetVisitorsRequest {
//   societyRegistrationNumber: string;
//   approvalStatus?: string; // ✅ New: Pending, Approved, Rejected, Checked-In, Checked-Out, all
//   status?: string; // Inside, Outside, all
//   role?: string | string[];
//   hostedBy?: string;
//   tower?: string;
//   block?: string;
//   flatNumber?: string;
//   isRecurring?: boolean;
//   filterOption?: string;
//   fromDate?: string;
//   toDate?: string;
//   search?: string;
//   page?: number;
//   limit?: number;
// }

// interface VisitorResponse {
//   visitorId: string;
//   name: string;
//   phoneNumber: string;
//   email: string | null;
//   gender: string | null;
//   role: string | null;
//   purpose: string | null;
//   status: string | null; // visitor_status
//   approvalStatus: string | null; // visitor_approval_status
//   hostedBy: {
//     residentId: string;
//     name: string;
//     phone: string;
//     flatNumber: string;
//     blockName: string | null;
//     towerName: string | null;
//   } | null;
//   checkIn: string | null;
//   checkOut: string | null;
//   isRecurring: boolean | null;
//   recurringDays: string[] | null;
//   vehicleNumber: string | null;
//   vehicleType: string | null;
//   gateNo: string | null;
//   deliveryOrigin: string | null;
//   idProofType: string | null;
//   idProofNumber: string | null;
//   imageUrl: string | null;
//   createdAt: string;
// }

// interface RawVisitor {
//   non_society_user_id: string;
//   name: string | null;
//   phone_number: string | null;
//   email: string | null;
//   gender: string | null;
//   role: string | null;
//   purpose: string | null;
//   visitor_status: string | null;
//   visitor_approval_status: string | null;
//   check_in: string | null;
//   check_out: string | null;
//   is_recurring: boolean | null;
//   recurring_days: string[] | null;
//   vehicle_number: string | null;
//   vehicle_type: string | null;
//   gate_no: string | null;
//   delivery_origin: string | null;
//   id_proof_type: string | null;
//   id_proof_number: string | null;
//   created_at: string;
//   hosted_by_data: {
//     user_id: string;
//     unit_flat_number: string | null;
//     block: { block_name: string }[] | null;
//     tower: { name: string }[] | null;
//     contact: { name: string; phone: string }[] | null;
//   }[] | null;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const BUCKET_NAME = "society-documents";
// const MAX_LIMIT = 100;
// const DEFAULT_LIMIT = 20;

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
//  * Create signed URL for document
//  */
// async function createSignedUrl(rawPath: string | null): Promise<string | null> {
//   if (!rawPath) return null;

//   let storageKey = rawPath.trim();
//   const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;

//   if (storageKey.includes(marker)) {
//     storageKey = storageKey.split(marker)[1];
//   } else if (storageKey.includes(".amazonaws.com/")) {
//     storageKey = storageKey.split(".amazonaws.com/")[1];
//   }

//   storageKey = storageKey.trim();

//   const { data, error } = await supabaseAdmin.storage
//     .from(BUCKET_NAME)
//     .createSignedUrl(storageKey, 900);

//   if (error) {
//     logger.error({
//       level: "error",
//       action: "create-signed-url",
//       message: `Signed URL Error for path [${storageKey}]: ${error.message}`,
//       timestamp: new Date().toISOString(),
//     });
//     return null;
//   }

//   return data?.signedUrl ?? null;
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
//  * Normalize role filter to array
//  */
// function normalizeRoleFilter(
//   role: string | string[] | undefined,
// ): string[] | null {
//   if (!role) return null;

//   const roles = Array.isArray(role) ? role : [role];
//   const filtered = roles.filter((r) => r.trim() !== "");

//   if (filtered.length === 0) return null;
//   if (filtered.some((r) => r.toLowerCase() === "all")) {
//     return null;
//   }

//   return filtered.map((r) => r.trim());
// }

// /**
//  * Apply search filter to visitors
//  */
// function applySearchFilter(
//   visitors: VisitorResponse[],
//   searchTerm: string,
// ): VisitorResponse[] {
//   if (!searchTerm) return visitors;

//   const term = searchTerm.toLowerCase().trim();
//   return visitors.filter((v) =>
//     v.name.toLowerCase().includes(term) ||
//     v.phoneNumber.includes(term) ||
//     (v.email?.toLowerCase().includes(term) ?? false) ||
//     (v.vehicleNumber?.toLowerCase().includes(term) ?? false) ||
//     (v.purpose?.toLowerCase().includes(term) ?? false) ||
//     (v.hostedBy?.name.toLowerCase().includes(term) ?? false) ||
//     (v.hostedBy?.flatNumber.toLowerCase().includes(term) ?? false) ||
//     (v.hostedBy?.blockName?.toLowerCase().includes(term) ?? false) ||
//     (v.hostedBy?.towerName?.toLowerCase().includes(term) ?? false)
//   );
// }

// /**
//  * Apply filters to visitors
//  */
// function applyFilters(
//   visitors: VisitorResponse[],
//   filters: {
//     approvalStatus?: string;
//     status?: string;
//     role?: string | string[];
//     hostedBy?: string;
//     tower?: string;
//     block?: string;
//     flatNumber?: string;
//     isRecurring?: boolean;
//   },
// ): VisitorResponse[] {
//   let filtered = [...visitors];

//   // ✅ Approval Status filter
//   if (
//     filters.approvalStatus && filters.approvalStatus.toLowerCase() !== "all"
//   ) {
//     filtered = filtered.filter((v) =>
//       v.approvalStatus?.toLowerCase() === filters.approvalStatus!.toLowerCase()
//     );
//   }

//   // Status filter (visitor_status)
//   if (filters.status && filters.status.toLowerCase() !== "all") {
//     filtered = filtered.filter((v) =>
//       v.status?.toLowerCase() === filters.status!.toLowerCase()
//     );
//   }

//   // Role filter (multi-select)
//   if (filters.role) {
//     const roles = Array.isArray(filters.role) ? filters.role : [filters.role];
//     const hasAll = roles.some((r) => r.toLowerCase() === "all");

//     if (!hasAll && roles.length > 0) {
//       const lowerRoles = roles.map((r) => r.toLowerCase());
//       filtered = filtered.filter((v) =>
//         v.role && lowerRoles.includes(v.role.toLowerCase())
//       );
//     }
//   }

//   // Hosted by filter
//   if (filters.hostedBy) {
//     filtered = filtered.filter((v) =>
//       v.hostedBy?.residentId === filters.hostedBy
//     );
//   }

//   // Tower filter
//   if (filters.tower && filters.tower.toLowerCase() !== "all") {
//     filtered = filtered.filter((v) =>
//       v.hostedBy?.towerName?.toLowerCase() === filters.tower!.toLowerCase()
//     );
//   }

//   // Block filter
//   if (filters.block && filters.block.toLowerCase() !== "all") {
//     filtered = filtered.filter((v) =>
//       v.hostedBy?.blockName?.toLowerCase() === filters.block!.toLowerCase()
//     );
//   }

//   // Flat number filter
//   if (filters.flatNumber && filters.flatNumber.toLowerCase() !== "all") {
//     filtered = filtered.filter((v) =>
//       v.hostedBy?.flatNumber.toLowerCase() === filters.flatNumber!.toLowerCase()
//     );
//   }

//   // Recurring filter
//   if (filters.isRecurring !== undefined) {
//     filtered = filtered.filter((v) => v.isRecurring === filters.isRecurring);
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
//  * Normalize visitor data
//  */
// function normalizeVisitorData(
//   rawVisitor: RawVisitor,
//   imageUrl: string | null,
// ): VisitorResponse {
//   const hostedByData = firstOrNull(rawVisitor.hosted_by_data);
//   const contact = firstOrNull(hostedByData?.contact);
//   const block = firstOrNull(hostedByData?.block);
//   const tower = firstOrNull(hostedByData?.tower);

//   return {
//     visitorId: rawVisitor.non_society_user_id,
//     name: rawVisitor.name || "N/A",
//     phoneNumber: rawVisitor.phone_number || "N/A",
//     email: rawVisitor.email || null,
//     gender: rawVisitor.gender || null,
//     role: rawVisitor.role || null,
//     purpose: rawVisitor.purpose || null,
//     status: rawVisitor.visitor_status || null,
//     approvalStatus: rawVisitor.visitor_approval_status || null,
//     hostedBy: hostedByData
//       ? {
//         residentId: hostedByData.user_id,
//         name: contact?.name || "Unknown",
//         phone: contact?.phone || "",
//         flatNumber: hostedByData.unit_flat_number || "N/A",
//         blockName: block?.block_name || null,
//         towerName: tower?.name || null,
//       }
//       : null,
//     checkIn: rawVisitor.check_in || null,
//     checkOut: rawVisitor.check_out || null,
//     isRecurring: rawVisitor.is_recurring || null,
//     recurringDays: rawVisitor.recurring_days || null,
//     vehicleNumber: rawVisitor.vehicle_number || null,
//     vehicleType: rawVisitor.vehicle_type || null,
//     gateNo: rawVisitor.gate_no || null,
//     deliveryOrigin: rawVisitor.delivery_origin || null,
//     idProofType: rawVisitor.id_proof_type || null,
//     idProofNumber: rawVisitor.id_proof_number || null,
//     imageUrl: imageUrl,
//     createdAt: rawVisitor.created_at || new Date().toISOString(),
//   };
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
//         action: "get-visitors",
//         userId: authCtx.user.id,
//         message: "Get visitors request received",
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
//         approvalStatus,
//         status,
//         role,
//         hostedBy,
//         tower,
//         block,
//         flatNumber,
//         isRecurring,
//         filterOption,
//         fromDate,
//         toDate,
//         search,
//         page,
//         limit,
//       } = body as GetVisitorsRequest;

//       const validator = new Validator()
//         .validateRequired(
//           societyRegistrationNumber,
//           "societyRegistrationNumber",
//         );

//       if (!validator.isValid()) {
//         const errors = validator.getErrors();
//         logger.warn({
//           level: "warn",
//           action: "get-visitors",
//           userId: authCtx.user.id,
//           message: "Validation failed",
//           errors: JSON.stringify(errors),
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Validation failed");
//       }

//       const regNum = sanitizeString(societyRegistrationNumber);
//       const pageNum = Number(page) || 1;
//       const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);

//       // ============================================
//       // STEP 1: Get Society
//       // ============================================
//       const { data: society, error: socErr } = await supabaseAdmin
//         .from("SSP_Society")
//         .select("society_id, registration_number, society_name")
//         .eq("registration_number", regNum)
//         .maybeSingle();

//       if (socErr) {
//         logger.error({
//           level: "error",
//           action: "get-visitors",
//           message: `Society lookup failed: ${socErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse(`Failed to fetch society data: ${socErr.message}`);
//       }

//       if (!society) {
//         return errorResponse(
//           "Society not found for provided registration number.",
//         );
//       }

//       // ============================================
//       // STEP 2: Build Query for Visitors
//       // ============================================
//       let query = supabaseAdmin
//         .from("SSP_Non_Society_User")
//         .select(`
//           non_society_user_id,
//           name,
//           phone_number,
//           email,
//           gender,
//           role,
//           purpose,
//           visitor_status,
//           visitor_approval_status,
//           check_in,
//           check_out,
//           is_recurring,
//           recurring_days,
//           vehicle_number,
//           vehicle_type,
//           gate_no,
//           delivery_origin,
//           id_proof_type,
//           id_proof_number,
//           created_at,
//           hosted_by_data:SSP_Society_User!hosted_by (
//             user_id,
//             unit_flat_number,
//             block:SSP_Block!left (
//               block_name
//             ),
//             tower:SSP_Tower!left (
//               name
//             ),
//             contact:contact (
//               name,
//               phone
//             )
//           )
//         `)
//         .eq("society", society.society_id)
//         .eq("role", "visitor");

//       // ✅ Apply approval status filter (visitor_approval_status)
//       if (
//         approvalStatus && approvalStatus.trim() !== "" &&
//         approvalStatus.toLowerCase() !== "all"
//       ) {
//         query = query.eq("visitor_approval_status", approvalStatus.trim());
//       }

//       // Apply status filter (visitor_status)
//       if (status && status.trim() !== "" && status.toLowerCase() !== "all") {
//         query = query.eq("visitor_status", status.trim());
//       }

//       // Apply hosted by filter (resident)
//       if (hostedBy && hostedBy.trim() !== "") {
//         query = query.eq("hosted_by", hostedBy.trim());
//       }

//       // Apply recurring filter
//       if (isRecurring !== undefined) {
//         query = query.eq("is_recurring", isRecurring);
//       }

//       // Apply date filter (on check_in)
//       const dateBounds = calculateDateBounds(
//         filterOption || null,
//         fromDate,
//         toDate,
//       );
//       if (dateBounds) {
//         query = query
//           .gte("check_in", dateBounds.startISO)
//           .lt("check_in", dateBounds.endISO);
//       }

//       // Apply search (database level)
//       if (search && search.trim() !== "") {
//         const term = search.trim();
//         query = query.or(
//           `name.ilike.%${term}%,` +
//             `phone_number.ilike.%${term}%,` +
//             `email.ilike.%${term}%,` +
//             `vehicle_number.ilike.%${term}%,` +
//             `purpose.ilike.%${term}%`,
//         );
//       }

//       // Execute query
//       const { data: visitors, error: fetchErr } = await query
//         .order("check_in", { ascending: false });

//       if (fetchErr) {
//         logger.error({
//           level: "error",
//           action: "get-visitors",
//           message: `Fetch error: ${fetchErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse(`Failed to fetch visitors: ${fetchErr.message}`);
//       }

//       const rawVisitors = (visitors || []) as RawVisitor[];

//       // ============================================
//       // STEP 3: Fetch Images for Visitors
//       // ============================================
//       const visitorIds = rawVisitors.map((v: RawVisitor) =>
//         v.non_society_user_id
//       );
//       const imageMap = new Map<string, string>();

//       if (visitorIds.length > 0) {
//         const { data: documents } = await supabaseAdmin
//           .from("SSP_Document")
//           .select("non_society_user, s3_path")
//           .in("non_society_user", visitorIds)
//           .eq("society", society.society_id)
//           .not("s3_path", "is", null);

//         if (documents) {
//           for (const doc of documents) {
//             if (doc.non_society_user && doc.s3_path) {
//               if (!imageMap.has(doc.non_society_user)) {
//                 const signedUrl = await createSignedUrl(doc.s3_path);
//                 if (signedUrl) {
//                   imageMap.set(doc.non_society_user, signedUrl);
//                 }
//               }
//             }
//           }
//         }
//       }

//       // ============================================
//       // STEP 4: Format Visitors
//       // ============================================
//       const formattedVisitors: VisitorResponse[] = rawVisitors.map(
//         (v: RawVisitor) => {
//           const imageUrl = imageMap.get(v.non_society_user_id) || null;
//           return normalizeVisitorData(v, imageUrl);
//         },
//       );

//       // ============================================
//       // STEP 5: Apply Additional Filters (Client-side)
//       // ============================================
//       let filteredVisitors = formattedVisitors;

//       if (search) {
//         filteredVisitors = applySearchFilter(filteredVisitors, search);
//       }

//       filteredVisitors = applyFilters(filteredVisitors, {
//         approvalStatus: approvalStatus || "all",
//         status: status || "all",
//         role: role || "all",
//         hostedBy: hostedBy,
//         tower: tower,
//         block: block,
//         flatNumber: flatNumber,
//         isRecurring: isRecurring,
//       });

//       // ============================================
//       // STEP 6: Apply Pagination
//       // ============================================
//       const { items, total } = applyPagination(
//         filteredVisitors,
//         pageNum,
//         limitNum,
//       );

//       // ============================================
//       // STEP 7: Calculate Stats
//       // ============================================
//       const todayStr = new Date().toISOString().split("T")[0];
//       let totalVisitedToday = 0;
//       let currentlyInside = 0;
//       let currentlyOutside = 0;

//       for (const v of filteredVisitors) {
//         if (v.checkIn && v.checkIn.startsWith(todayStr)) {
//           totalVisitedToday++;
//         }
//         if (v.status === "inside" || v.status === "checked_in") {
//           currentlyInside++;
//         } else if (
//           v.status === "outside" || v.status === "checked_out" ||
//           v.status === "completed"
//         ) {
//           currentlyOutside++;
//         }
//       }

//       // ============================================
//       // STEP 8: Prepare Response
//       // ============================================
//       const response = {
//         total: total,
//         page: pageNum,
//         limit: limitNum,
//         totalPages: Math.ceil(total / limitNum),
//         visitors: items,
//         stats: {
//           totalVisitedToday,
//           currentlyInside,
//           currentlyOutside,
//         },
//         filters: {
//           approvalStatus: approvalStatus || null,
//           status: status || null,
//           role: role || null,
//           hostedBy: hostedBy || null,
//           tower: tower || null,
//           block: block || null,
//           flatNumber: flatNumber || null,
//           isRecurring: isRecurring !== undefined ? isRecurring : null,
//           filterOption: filterOption || null,
//           fromDate: fromDate || null,
//           toDate: toDate || null,
//         },
//         search: search || null,
//       };

//       logger.info({
//         level: "info",
//         action: "get-visitors",
//         userId: authCtx.user.id,
//         visitorsFound: total,
//         returned: items.length,
//         duration: Date.now() - startTime,
//         message: "Visitors fetched successfully",
//         timestamp: new Date().toISOString(),
//       });

//       return successResponse(response);
//     } catch (error: unknown) {
//       const errorMessage = error instanceof Error
//         ? error.message
//         : "Unknown error";

//       logger.error({
//         level: "error",
//         action: "get-visitors",
//         userId: authCtx?.user?.id || "unknown",
//         message: errorMessage,
//         stack: error instanceof Error ? error.stack : undefined,
//         timestamp: new Date().toISOString(),
//       });

//       return errorResponse(errorMessage || "Failed to fetch visitors.");
//     }
//   }),
// );



// ============================================
// get-visitors - Get Visitors with Filters, Search & Pagination (Optimized)
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
// TYPES
// ============================================

interface GetVisitorsRequest {
  societyRegistrationNumber: string;
  approvalStatus?: string;
  status?: string;
  role?: string | string[];
  hostedBy?: string;
  tower?: string;
  block?: string;
  flatNumber?: string;
  isRecurring?: boolean;
  filterOption?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface VisitorResponse {
  visitorId: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  gender: string | null;
  role: string | null;
  purpose: string | null;
  status: string | null;
  approvalStatus: string | null;
  hostedBy: {
    residentId: string;
    name: string;
    phone: string;
    flatNumber: string;
    blockName: string | null;
    towerName: string | null;
  } | null;
  checkIn: string | null;
  checkOut: string | null;
  isRecurring: boolean | null;
  recurringDays: string[] | null;
  vehicleNumber: string | null;
  vehicleType: string | null;
  gateNo: string | null;
  deliveryOrigin: string | null;
  idProofType: string | null;
  idProofNumber: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface RawVisitor {
  non_society_user_id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
  gender: string | null;
  role: string | null;
  purpose: string | null;
  visitor_status: string | null;
  visitor_approval_status: string | null;
  check_in: string | null;
  check_out: string | null;
  is_recurring: boolean | null;
  recurring_days: string[] | null;
  vehicle_number: string | null;
  vehicle_type: string | null;
  gate_no: string | null;
  delivery_origin: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  created_at: string;
  hosted_by_data: {
    user_id: string;
    unit_flat_number: string | null;
    block: { block_name: string }[] | null;
    tower: { name: string }[] | null;
    contact: { name: string; phone: string }[] | null;
  }[] | null;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const SIGNED_URL_EXPIRY = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// In-memory signed URL cache (per isolate)
const urlCache = new Map<string, { url: string; expiresAt: number }>();

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

// Cached IST parts formatter for date-bound calculations
const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
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

function calculateDateBounds(
  filter: string | null,
  fromStr?: string,
  toStr?: string,
): { startISO: string; endISO: string } | null {
  if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
    return null;
  }

  const now = new Date();
  const parts = IST_PARTS_FORMATTER.formatToParts(now);
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
 * Batch sign storage keys with bounded concurrency + in-memory cache.
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

function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
  return arr;
}

function normalizeRoleFilter(
  role: string | string[] | undefined,
): string[] | null {
  if (!role) return null;
  const roles = Array.isArray(role) ? role : [role];
  const filtered = roles.filter((r) => r.trim() !== "");
  if (filtered.length === 0) return null;
  if (filtered.some((r) => r.toLowerCase() === "all")) return null;
  return filtered.map((r) => r.trim());
}

function applySearchFilter(
  visitors: VisitorResponse[],
  searchTerm: string,
): VisitorResponse[] {
  if (!searchTerm) return visitors;
  const term = searchTerm.toLowerCase().trim();
  return visitors.filter((v) =>
    v.name.toLowerCase().includes(term) ||
    v.phoneNumber.includes(term) ||
    (v.email?.toLowerCase().includes(term) ?? false) ||
    (v.vehicleNumber?.toLowerCase().includes(term) ?? false) ||
    (v.purpose?.toLowerCase().includes(term) ?? false) ||
    (v.hostedBy?.name.toLowerCase().includes(term) ?? false) ||
    (v.hostedBy?.flatNumber.toLowerCase().includes(term) ?? false) ||
    (v.hostedBy?.blockName?.toLowerCase().includes(term) ?? false) ||
    (v.hostedBy?.towerName?.toLowerCase().includes(term) ?? false)
  );
}

function applyFilters(
  visitors: VisitorResponse[],
  filters: {
    approvalStatus?: string;
    status?: string;
    role?: string | string[];
    hostedBy?: string;
    tower?: string;
    block?: string;
    flatNumber?: string;
    isRecurring?: boolean;
  },
): VisitorResponse[] {
  let filtered = visitors;

  if (filters.approvalStatus && filters.approvalStatus.toLowerCase() !== "all") {
    const target = filters.approvalStatus.toLowerCase();
    filtered = filtered.filter(
      (v) => v.approvalStatus?.toLowerCase() === target,
    );
  }

  if (filters.status && filters.status.toLowerCase() !== "all") {
    const target = filters.status.toLowerCase();
    filtered = filtered.filter((v) => v.status?.toLowerCase() === target);
  }

  if (filters.role) {
    const roles = Array.isArray(filters.role) ? filters.role : [filters.role];
    const hasAll = roles.some((r) => r.toLowerCase() === "all");
    if (!hasAll && roles.length > 0) {
      const lowerRoles = roles.map((r) => r.toLowerCase());
      filtered = filtered.filter(
        (v) => v.role && lowerRoles.includes(v.role.toLowerCase()),
      );
    }
  }

  if (filters.hostedBy) {
    filtered = filtered.filter((v) => v.hostedBy?.residentId === filters.hostedBy);
  }

  if (filters.tower && filters.tower.toLowerCase() !== "all") {
    const target = filters.tower.toLowerCase();
    filtered = filtered.filter(
      (v) => v.hostedBy?.towerName?.toLowerCase() === target,
    );
  }

  if (filters.block && filters.block.toLowerCase() !== "all") {
    const target = filters.block.toLowerCase();
    filtered = filtered.filter(
      (v) => v.hostedBy?.blockName?.toLowerCase() === target,
    );
  }

  if (filters.flatNumber && filters.flatNumber.toLowerCase() !== "all") {
    const target = filters.flatNumber.toLowerCase();
    filtered = filtered.filter(
      (v) => v.hostedBy?.flatNumber.toLowerCase() === target,
    );
  }

  if (filters.isRecurring !== undefined) {
    filtered = filtered.filter((v) => v.isRecurring === filters.isRecurring);
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

function normalizeVisitorData(
  rawVisitor: RawVisitor,
  imageUrl: string | null,
): VisitorResponse {
  const hostedByData = firstOrNull(rawVisitor.hosted_by_data);
  const contact = firstOrNull(hostedByData?.contact);
  const block = firstOrNull(hostedByData?.block);
  const tower = firstOrNull(hostedByData?.tower);

  return {
    visitorId: rawVisitor.non_society_user_id,
    name: rawVisitor.name || "N/A",
    phoneNumber: rawVisitor.phone_number || "N/A",
    email: rawVisitor.email || null,
    gender: rawVisitor.gender || null,
    role: rawVisitor.role || null,
    purpose: rawVisitor.purpose || null,
    status: rawVisitor.visitor_status || null,
    approvalStatus: rawVisitor.visitor_approval_status || null,
    hostedBy: hostedByData
      ? {
          residentId: hostedByData.user_id,
          name: contact?.name || "Unknown",
          phone: contact?.phone || "",
          flatNumber: hostedByData.unit_flat_number || "N/A",
          blockName: block?.block_name || null,
          towerName: tower?.name || null,
        }
      : null,
    checkIn: rawVisitor.check_in || null,
    checkOut: rawVisitor.check_out || null,
    isRecurring: rawVisitor.is_recurring || null,
    recurringDays: rawVisitor.recurring_days || null,
    vehicleNumber: rawVisitor.vehicle_number || null,
    vehicleType: rawVisitor.vehicle_type || null,
    gateNo: rawVisitor.gate_no || null,
    deliveryOrigin: rawVisitor.delivery_origin || null,
    idProofType: rawVisitor.id_proof_type || null,
    idProofNumber: rawVisitor.id_proof_number || null,
    imageUrl,
    createdAt: rawVisitor.created_at || new Date().toISOString(),
  };
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
        action: "get-visitors",
        userId: authCtx.user.id,
        message: "Get visitors request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("Request body is required.");

      const {
        societyRegistrationNumber,
        approvalStatus,
        status,
        role,
        hostedBy,
        tower,
        block,
        flatNumber,
        isRecurring,
        filterOption,
        fromDate,
        toDate,
        search,
        page,
        limit,
      } = body as GetVisitorsRequest;

      const validator = new Validator().validateRequired(
        societyRegistrationNumber,
        "societyRegistrationNumber",
      );

      if (!validator.isValid()) {
        logger.warn({
          level: "warn",
          action: "get-visitors",
          userId: authCtx.user.id,
          message: "Validation failed",
          errors: JSON.stringify(validator.getErrors()),
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Validation failed");
      }

      const regNum = sanitizeString(societyRegistrationNumber);
      const pageNum = Number(page) || 1;
      const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);

      // --------------------------------------------------
      // STEP 1: Society
      // --------------------------------------------------
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number, society_name")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          action: "get-visitors",
          message: `Society lookup failed: ${socErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse(`Failed to fetch society data: ${socErr.message}`);
      }

      if (!society) {
        return errorResponse("Society not found for provided registration number.");
      }

      // --------------------------------------------------
      // STEP 2: Build visitor query
      // --------------------------------------------------
      let query = supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(`
          non_society_user_id,
          name,
          phone_number,
          email,
          gender,
          role,
          purpose,
          visitor_status,
          visitor_approval_status,
          check_in,
          check_out,
          is_recurring,
          recurring_days,
          vehicle_number,
          vehicle_type,
          gate_no,
          delivery_origin,
          id_proof_type,
          id_proof_number,
          created_at,
          hosted_by_data:SSP_Society_User!hosted_by (
            user_id,
            unit_flat_number,
            block:SSP_Block!left (
              block_name
            ),
            tower:SSP_Tower!left (
              name
            ),
            contact:contact (
              name,
              phone
            )
          )
        `)
        .eq("society", society.society_id)
        .eq("role", "visitor");

      if (
        approvalStatus && approvalStatus.trim() !== "" &&
        approvalStatus.toLowerCase() !== "all"
      ) {
        query = query.eq("visitor_approval_status", approvalStatus.trim());
      }

      if (status && status.trim() !== "" && status.toLowerCase() !== "all") {
        query = query.eq("visitor_status", status.trim());
      }

      if (hostedBy && hostedBy.trim() !== "") {
        query = query.eq("hosted_by", hostedBy.trim());
      }

      if (isRecurring !== undefined) {
        query = query.eq("is_recurring", isRecurring);
      }

      const dateBounds = calculateDateBounds(
        filterOption || null,
        fromDate,
        toDate,
      );
      if (dateBounds) {
        query = query
          .gte("check_in", dateBounds.startISO)
          .lt("check_in", dateBounds.endISO);
      }

      if (search && search.trim() !== "") {
        const term = search.trim();
        query = query.or(
          `name.ilike.%${term}%,` +
            `phone_number.ilike.%${term}%,` +
            `email.ilike.%${term}%,` +
            `vehicle_number.ilike.%${term}%,` +
            `purpose.ilike.%${term}%`,
        );
      }

      const { data: visitors, error: fetchErr } = await query.order("check_in", {
        ascending: false,
      });

      if (fetchErr) {
        logger.error({
          level: "error",
          action: "get-visitors",
          message: `Fetch error: ${fetchErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse(`Failed to fetch visitors: ${fetchErr.message}`);
      }

      const rawVisitors = (visitors || []) as RawVisitor[];

      // --------------------------------------------------
      // STEP 3 (BATCHED): Fetch all documents + sign all URLs
      // --------------------------------------------------
      const visitorIds = rawVisitors.map((v) => v.non_society_user_id);
      const imagePathMap = new Map<string, string>(); // visitor_id → raw s3_path

      if (visitorIds.length > 0) {
        const { data: documents } = await supabaseAdmin
          .from("SSP_Document")
          .select("non_society_user, s3_path")
          .in("non_society_user", visitorIds)
          .eq("society", society.society_id)
          .not("s3_path", "is", null);

        for (const doc of (documents ?? []) as {
          non_society_user: string;
          s3_path: string;
        }[]) {
          if (doc.non_society_user && doc.s3_path) {
            // Keep the FIRST doc per visitor (matches original behavior)
            if (!imagePathMap.has(doc.non_society_user)) {
              imagePathMap.set(doc.non_society_user, doc.s3_path);
            }
          }
        }
      }

      // Sign all paths in one batched pass
      const allPaths = Array.from(imagePathMap.values());
      const signedUrlMap = await batchSignUrls(allPaths);

      // Build final visitor_id → signed_url map
      const imageMap = new Map<string, string>();
      for (const [visitorId, rawPath] of imagePathMap.entries()) {
        const url = signedUrlMap.get(rawPath);
        if (url) imageMap.set(visitorId, url);
      }

      // --------------------------------------------------
      // STEP 4: Format (no I/O)
      // --------------------------------------------------
      const formattedVisitors: VisitorResponse[] = rawVisitors.map((v) => {
        const imageUrl = imageMap.get(v.non_society_user_id) || null;
        return normalizeVisitorData(v, imageUrl);
      });

      // --------------------------------------------------
      // STEP 5: Client-side filters (unchanged)
      // --------------------------------------------------
      let filteredVisitors = formattedVisitors;

      if (search) {
        filteredVisitors = applySearchFilter(filteredVisitors, search);
      }

      filteredVisitors = applyFilters(filteredVisitors, {
        approvalStatus: approvalStatus || "all",
        status: status || "all",
        role: role || "all",
        hostedBy,
        tower,
        block,
        flatNumber,
        isRecurring,
      });

      // --------------------------------------------------
      // STEP 6: Pagination
      // --------------------------------------------------
      const { items, total } = applyPagination(
        filteredVisitors,
        pageNum,
        limitNum,
      );

      // --------------------------------------------------
      // STEP 7: Stats
      // --------------------------------------------------
      const todayStr = new Date().toISOString().split("T")[0];
      let totalVisitedToday = 0;
      let currentlyInside = 0;
      let currentlyOutside = 0;

      for (const v of filteredVisitors) {
        if (v.checkIn && v.checkIn.startsWith(todayStr)) totalVisitedToday++;
        if (v.status === "inside" || v.status === "checked_in") {
          currentlyInside++;
        } else if (
          v.status === "outside" || v.status === "checked_out" ||
          v.status === "completed"
        ) {
          currentlyOutside++;
        }
      }

      // --------------------------------------------------
      // STEP 8: Response
      // --------------------------------------------------
      const response = {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        visitors: items,
        stats: {
          totalVisitedToday,
          currentlyInside,
          currentlyOutside,
        },
        filters: {
          approvalStatus: approvalStatus || null,
          status: status || null,
          role: role || null,
          hostedBy: hostedBy || null,
          tower: tower || null,
          block: block || null,
          flatNumber: flatNumber || null,
          isRecurring: isRecurring !== undefined ? isRecurring : null,
          filterOption: filterOption || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
        },
        search: search || null,
      };

      logger.info({
        level: "info",
        action: "get-visitors",
        userId: authCtx.user.id,
        visitorsFound: total,
        returned: items.length,
        duration: Date.now() - startTime,
        message: "Visitors fetched successfully",
        timestamp: new Date().toISOString(),
      });

      return successResponse(response);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logger.error({
        level: "error",
        action: "get-visitors",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });

      return errorResponse(errorMessage || "Failed to fetch visitors.");
    }
  }),
);