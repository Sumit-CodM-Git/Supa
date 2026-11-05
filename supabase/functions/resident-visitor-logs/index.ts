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
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     // 1. Initial Structural Validations
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400);
//     }
//     const requestObj = JSON.parse(bodyText);
//     const { societyRegistrationNumber, societyUserId, filterOption, fromDate, toDate } = requestObj;
//     if (!societyRegistrationNumber?.trim() || !societyUserId?.trim()) {
//       return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber and societyUserId are mandatory.', 400);
//     }
//     const cleanRegNo = societyRegistrationNumber.trim();
//     const cleanResidentId = societyUserId.trim();
//     // 2. Locate Society Profile Context
//     const { data: societyContext, error: socError } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', cleanRegNo).maybeSingle();
//     if (socError) throw new Error(`SSP_Society verification failed: ${socError.message}`);
//     if (!societyContext) {
//       return buildErrorResponse('NOT_FOUND', 'Resident mapping not found.', 404);
//     }
//     // 3. Identify Resident Using the Multi-Step Fallback Matrix
//     let userQuery = supabase.from('SSP_Society_User').select(`
//         user_id,
//         contact:SSP_Contact!inner(contact_id, name)
//       `).eq('society', societyContext.society_id);
//     const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     if (uuidRegex.test(cleanResidentId)) {
//       userQuery = userQuery.or(`user_id.eq.${cleanResidentId},contact.eq.${cleanResidentId}`);
//     } else {
//       userQuery = userQuery.ilike('contact.name', `%${cleanResidentId}%`);
//     }
//     const { data: userRecords, error: userError } = await userQuery;
//     if (userError) throw new Error(`Resident lookup failed: ${userError.message}`);
//     if (!userRecords || userRecords.length === 0) {
//       return buildErrorResponse('NOT_FOUND', 'Resident mapping not found.', 404);
//     }
//     const hostId = userRecords[0].user_id;
//     // 4. Fetch Active Servants Registered to this Society
//     // FIX: Queried 'SSP_Servant' using valid schema columns, replacing the non-existent 'hired' join table
//     const { data: hiredServants, error: servantError } = await supabase.from('SSP_Servant').select('servant_id, phone_number, servant_name').eq('society', societyContext.society_id).eq('status', 'Active') // Fallback lookup condition (assumes active roster tracking)
//     ;
//     if (servantError) throw new Error(`Servants ledger extraction failed: ${servantError.message}`);
//     const hiredServantMap = new Map();
//     const servantPhoneNumbers = [];
//     if (hiredServants && hiredServants.length > 0) {
//       hiredServants.forEach((ss)=>{
//         if (ss.phone_number && ss.phone_number.trim() !== '') {
//           const formattedPhone = ss.phone_number.trim();
//           hiredServantMap.set(formattedPhone, ss);
//           servantPhoneNumbers.push(formattedPhone);
//         }
//       });
//     }
//     // 5. Build Dynamic Logs Filtering Stack against Non-Society Users (Visitors/Servants)
//     let logQuery = supabase.from('SSP_Non_Society_User').select(`
//         non_society_user_id,
//         name,
//         phone_number,
//         visitor_status,
//         purpose,
//         pre_approved,
//         vehicle_number,
//         id_proof_type,
//         gate_no,
//         check_in,
//         check_out,
//         role
//       `).not('check_in', 'is', null);
//     // Build the core compound conditional logic block matching Apex routing parameters
//     let targetAudienceClause = `hosted_by.eq.${hostId}`;
//     if (servantPhoneNumbers.length > 0) {
//       const formattedArrayStr = servantPhoneNumbers.map((p)=>`"${p}"`).join(',');
//       targetAudienceClause = `and(hosted_by.eq.${hostId},role.eq.Visitor),and(phone_number.in.(${formattedArrayStr}),role.eq.Servant)`;
//     } else {
//       logQuery = logQuery.eq('role', 'Visitor');
//     }
//     logQuery = logQuery.or(targetAudienceClause);
//     // Apply Relative Date Window Filtering Contracts
//     if (filterOption && filterOption.trim() !== '') {
//       const option = filterOption.trim().toLowerCase();
//       const now = new Date();
//       let startRangeStr = '';
//       let endRangeStr = '';
//       if (option === 'today') {
//         startRangeStr = `${now.toISOString().split('T')[0]}T00:00:00.000Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr);
//       } else if (option === 'yesterday') {
//         const yesterday = new Date(now);
//         yesterday.setDate(now.getDate() - 1);
//         startRangeStr = `${yesterday.toISOString().split('T')[0]}T00:00:00.000Z`;
//         endRangeStr = `${yesterday.toISOString().split('T')[0]}T23:59:59.999Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr).lte('check_in', endRangeStr);
//       } else if (option === 'thisweek') {
//         const startOfWeek = new Date(now);
//         startOfWeek.setDate(now.getDate() - now.getDay());
//         startRangeStr = `${startOfWeek.toISOString().split('T')[0]}T00:00:00.000Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr);
//       } else if (option === 'lastweek') {
//         const startOfLastWeek = new Date(now);
//         startOfLastWeek.setDate(now.getDate() - now.getDay() - 7);
//         const endOfLastWeek = new Date(startOfLastWeek);
//         endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
//         startRangeStr = `${startOfLastWeek.toISOString().split('T')[0]}T00:00:00.000Z`;
//         endRangeStr = `${endOfLastWeek.toISOString().split('T')[0]}T23:59:59.999Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr).lte('check_in', endRangeStr);
//       } else if (option === 'thismonth') {
//         startRangeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr);
//       } else if (option === 'lastmonth') {
//         const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
//         const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
//         startRangeStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
//         endRangeStr = `${endOfLastMonth.getFullYear()}-${String(endOfLastMonth.getMonth() + 1).padStart(2, '0')}-${String(endOfLastMonth.getDate()).padStart(2, '0')}T23:59:59.999Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr).lte('check_in', endRangeStr);
//       } else if (option === 'custom' && fromDate && toDate) {
//         startRangeStr = `${fromDate}T00:00:00.000Z`;
//         const endDateObj = new Date(toDate);
//         endDateObj.setDate(endDateObj.getDate() + 1);
//         endRangeStr = `${endDateObj.toISOString().split('T')[0]}T00:00:00.000Z`;
//         logQuery = logQuery.gte('check_in', startRangeStr).lt('check_in', endRangeStr);
//       }
//     }
//     logQuery = logQuery.order('check_in', {
//       ascending: false,
//       nullsFirst: false
//     });
//     const { data: visitorList, error: queryError } = await logQuery;
//     if (queryError) throw new Error(`Visitor ledger streaming failed: ${queryError.message}`);
//     // 6. Resolve Document Images with Presigned Access URLs
//     const finalVisitors = visitorList ?? [];
//     const visitorIds = finalVisitors.map((v)=>v.non_society_user_id);
//     const imageMap = new Map();
//     if (visitorIds.length > 0) {
//       const { data: docRecords, error: docError } = await supabase.from('Documents').select('storage_path, non_society_user').in('non_society_user', visitorIds);
//       if (!docError && docRecords) {
//         for (const doc of docRecords){
//           if (doc.storage_path && !imageMap.has(doc.non_society_user)) {
//             // Generate standard secure 15-minute access link via Supabase Storage
//             const { data: presignedUrlObj } = await supabase.storage.from('visitor-images').createSignedUrl(doc.storage_path, 900);
//             if (presignedUrlObj?.signedUrl) {
//               imageMap.set(doc.non_society_user, presignedUrlObj.signedUrl);
//             }
//           }
//         }
//       }
//     }
//     // 7. Map Checked-In Elements and Track Active Logs
//     const responseVisitorsList = [];
//     const servantsWithLogs = new Set();
//     finalVisitors.forEach((v)=>{
//       responseVisitorsList.push({
//         visitorName: v.name ?? '',
//         visitorId: v.non_society_user_id,
//         phoneNumber: v.phone_number ?? '',
//         status: v.visitor_status ?? '',
//         purpose: v.purpose ?? '',
//         preApproved: v.pre_approved ?? false,
//         vehicleNumber: v.vehicle_number ?? '',
//         idProofType: v.id_proof_type ?? '',
//         gateNumber: v.gate_no ?? '',
//         checkInTime: v.check_in,
//         checkOutTime: v.check_out,
//         role: v.role ?? 'Visitor',
//         imageUrl: imageMap.get(v.non_society_user_id) ?? null
//       });
//       if (v.role === 'Servant' && v.phone_number) {
//         servantsWithLogs.add(v.phone_number.trim());
//       }
//     });
//     // 8. Handle Hired Staff Currently Absent (Outside)
//     // FIX: Updated variable keys to match your exact PostgreSQL 'SSP_Servant' schema structures
//     hiredServantMap.forEach((ss, phone)=>{
//       if (!servantsWithLogs.has(phone)) {
//         responseVisitorsList.push({
//           visitorName: ss.servant_name ?? '',
//           visitorId: ss.servant_id ?? 'N/A',
//           phoneNumber: phone,
//           status: 'Outside',
//           role: 'Servant',
//           purpose: 'Hired Servant',
//           preApproved: true,
//           vehicleNumber: '',
//           idProofType: '',
//           gateNumber: '',
//           checkInTime: null,
//           checkOutTime: null,
//           imageUrl: null
//         });
//       }
//     });
//     return new Response(JSON.stringify({
//       visitors: responseVisitorsList,
//       errorResponse: null
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (error) {
//     return buildErrorResponse('SERVER_ERROR', `Visitor Log Pipeline Failure: ${error.message || 'Fatal execution logic breakdown.'}`, 500);
//   }
// });
// function buildErrorResponse(code, message, statusCode) {
//   return new Response(JSON.stringify({
//     visitors: null,
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

// // ============================================
// // resident-log-visitors - Get Visitor Logs for a Resident
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

// interface ResidentLogVisitorsRequest {
//   societyRegistrationNumber: string;
//   residentId: string;
//   role?: string | string[];
//   visitorStatus?: string;
//   filterOption?: string;
//   fromDate?: string;
//   toDate?: string;
//   search?: string;
//   page?: number;
//   limit?: number;
// }

// interface VisitorLogResponse {
//   visitorId: string;
//   name: string;
//   phoneNumber: string;
//   role: string;
//   visitorStatus: string | null;
//   purpose: string | null;
//   preApproved: boolean;
//   vehicleNumber: string | null;
//   idProofType: string | null;
//   gateNumber: string | null;
//   checkInTime: string | null;
//   checkOutTime: string | null;
//   imageUrl: string | null;
//   createdAt: string;
// }

// interface ResidentLogVisitorsResponse {
//   total: number;
//   page: number;
//   limit: number;
//   totalPages: number;
//   visitors: VisitorLogResponse[];
//   filters: {
//     role: string | string[] | null;
//     visitorStatus: string | null;
//     filterOption: string | null;
//     fromDate: string | null;
//     toDate: string | null;
//   };
//   search: string | null;
//   stats: {
//     totalVisitors: number;
//     currentlyInside: number;
//     currentlyOutside: number;
//   };
// }

// interface RawVisitorLog {
//   non_society_user_id: string;
//   name: string | null;
//   phone_number: string | null;
//   visitor_status: string | null;
//   purpose: string | null;
//   pre_approved: boolean | null;
//   vehicle_number: string | null;
//   id_proof_type: string | null;
//   gate_no: string | null;
//   check_in: string | null;
//   check_out: string | null;
//   role: string | null;
//   created_at: string;
// }

// interface RawServant {
//   servant_id: string;
//   phone_number: string | null;
//   servant_name: string | null;
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
//   visitors: VisitorLogResponse[],
//   searchTerm: string,
// ): VisitorLogResponse[] {
//   if (!searchTerm) return visitors;

//   const term = searchTerm.toLowerCase().trim();
//   return visitors.filter((v) =>
//     v.name.toLowerCase().includes(term) ||
//     v.phoneNumber.includes(term) ||
//     (v.purpose?.toLowerCase().includes(term) ?? false) ||
//     (v.vehicleNumber?.toLowerCase().includes(term) ?? false)
//   );
// }

// /**
//  * Apply filters to visitors
//  */
// function applyFilters(
//   visitors: VisitorLogResponse[],
//   filters: {
//     role?: string | string[];
//     visitorStatus?: string;
//   },
// ): VisitorLogResponse[] {
//   let filtered = [...visitors];

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

//   // Visitor Status filter
//   if (filters.visitorStatus && filters.visitorStatus.toLowerCase() !== "all") {
//     filtered = filtered.filter((v) =>
//       v.visitorStatus?.toLowerCase() === filters.visitorStatus!.toLowerCase()
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
//         action: "resident-log-visitors",
//         userId: authCtx.user.id,
//         message: "Resident log visitors request received",
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
//         residentId,
//         role,
//         visitorStatus,
//         filterOption,
//         fromDate,
//         toDate,
//         search,
//         page,
//         limit,
//       } = body as ResidentLogVisitorsRequest;

//       // Validate required fields
//       const validator = new Validator()
//         .validateRequired(
//           societyRegistrationNumber,
//           "societyRegistrationNumber",
//         )
//         .validateRequired(residentId, "residentId");

//       if (!validator.isValid()) {
//         const errors = validator.getErrors();
//         logger.warn({
//           level: "warn",
//           action: "resident-log-visitors",
//           userId: authCtx.user.id,
//           message: "Validation failed",
//           errors: JSON.stringify(errors),
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Validation failed");
//       }

//       const regNum = sanitizeString(societyRegistrationNumber);
//       const cleanResidentId = sanitizeString(residentId);
//       const pageNum = Number(page) || 1;
//       const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
//       const roleFilter = normalizeRoleFilter(role);

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
//           action: "resident-log-visitors",
//           message: `Society lookup failed: ${socErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Failed to fetch society data.");
//       }

//       if (!society) {
//         return errorResponse(
//           "Society not found for provided registration number.",
//         );
//       }

//       // ============================================
//       // STEP 2: Verify Resident
//       // ============================================
//       const { data: hostUser, error: hostErr } = await supabaseAdmin
//         .from("SSP_Society_User")
//         .select("user_id, unit_flat_number")
//         .eq("user_id", cleanResidentId)
//         .eq("society", society.society_id)
//         .maybeSingle();

//       if (hostErr) {
//         logger.error({
//           level: "error",
//           action: "resident-log-visitors",
//           message: `Resident lookup failed: ${hostErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Failed to verify resident.");
//       }

//       if (!hostUser) {
//         return errorResponse("Resident not found in this society.");
//       }

//       logger.info({
//         level: "info",
//         action: "resident-log-visitors",
//         message: "Resident verified",
//         residentId: hostUser.user_id,
//         timestamp: new Date().toISOString(),
//       });

//       // ============================================
//       // STEP 3: Get Active Servants
//       // ============================================
//       const { data: hiredServants, error: servantErr } = await supabaseAdmin
//         .from("SSP_Servant")
//         .select("servant_id, phone_number, servant_name")
//         .eq("society", society.society_id)
//         .eq("status", "active");

//       if (servantErr) {
//         logger.warn({
//           level: "warn",
//           action: "resident-log-visitors",
//           message: `Servant fetch failed: ${servantErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//       }

//       const hiredServantMap = new Map<string, RawServant>();
//       const servantPhoneNumbers: string[] = [];

//       if (hiredServants && hiredServants.length > 0) {
//         for (const servant of hiredServants as RawServant[]) {
//           if (servant.phone_number && servant.phone_number.trim() !== "") {
//             const formattedPhone = servant.phone_number.trim();
//             hiredServantMap.set(formattedPhone, servant);
//             servantPhoneNumbers.push(formattedPhone);
//           }
//         }
//       }

//       logger.info({
//         level: "info",
//         action: "resident-log-visitors",
//         message: `Found ${hiredServantMap.size} active servants`,
//         servantCount: hiredServantMap.size,
//         timestamp: new Date().toISOString(),
//       });

//       // ============================================
//       // STEP 4: Build Query for Visitor Logs
//       // ============================================
//       let query = supabaseAdmin
//         .from("SSP_Non_Society_User")
//         .select(`
//           non_society_user_id,
//           name,
//           phone_number,
//           visitor_status,
//           purpose,
//           pre_approved,
//           vehicle_number,
//           id_proof_type,
//           gate_no,
//           check_in,
//           check_out,
//           role,
//           created_at
//         `)
//         .not("check_in", "is", null);

//       // Build target audience clause
//       let targetAudienceClause = `hosted_by.eq.${hostUser.user_id}`;

//       if (servantPhoneNumbers.length > 0) {
//         const formattedArrayStr = servantPhoneNumbers.map((p) => `"${p}"`).join(
//           ",",
//         );
//         targetAudienceClause =
//           `and(hosted_by.eq.${hostUser.user_id},role.eq.Visitor),` +
//           `and(phone_number.in.(${formattedArrayStr}),role.eq.Servant)`;
//       } else {
//         query = query.eq("role", "visitor");
//       }

//       query = query.or(targetAudienceClause);

//       // Apply role filter (multi-select)
//       if (roleFilter && roleFilter.length > 0) {
//         const roleConditions = roleFilter.map((r) => `role.eq.${r}`).join(",");
//         query = query.or(roleConditions);
//       }

//       // Apply visitor status filter
//       if (
//         visitorStatus && visitorStatus.trim() !== "" &&
//         visitorStatus.toLowerCase() !== "all"
//       ) {
//         query = query.eq("visitor_status", visitorStatus.trim());
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
//             `purpose.ilike.%${term}%,` +
//             `vehicle_number.ilike.%${term}%`,
//         );
//       }

//       // Execute query
//       const { data: visitorLogs, error: fetchErr } = await query
//         .order("check_in", { ascending: false });

//       if (fetchErr) {
//         logger.error({
//           level: "error",
//           action: "resident-log-visitors",
//           message: `Fetch error: ${fetchErr.message}`,
//           timestamp: new Date().toISOString(),
//         });
//         return errorResponse("Failed to fetch visitor logs.");
//       }

//       const rawVisitors = (visitorLogs || []) as RawVisitorLog[];
//       const servantsWithLogs = new Set<string>();

//       // ============================================
//       // STEP 5: Fetch Images for Visitors
//       // ============================================
//       const visitorIds = rawVisitors.map((v: RawVisitorLog) =>
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
//       // STEP 6: Format Visitor Logs
//       // ============================================
//       const formattedVisitors: VisitorLogResponse[] = [];

//       for (const raw of rawVisitors) {
//         const imageUrl = imageMap.get(raw.non_society_user_id) || null;

//         // Track servants with logs
//         if (raw.role === "servant" && raw.phone_number) {
//           servantsWithLogs.add(raw.phone_number.trim());
//         }

//         formattedVisitors.push({
//           visitorId: raw.non_society_user_id,
//           name: raw.name || "N/A",
//           phoneNumber: raw.phone_number || "N/A",
//           role: raw.role || "visitor",
//           visitorStatus: raw.visitor_status || null,
//           purpose: raw.purpose || null,
//           preApproved: raw.pre_approved || false,
//           vehicleNumber: raw.vehicle_number || null,
//           idProofType: raw.id_proof_type || null,
//           gateNumber: raw.gate_no || null,
//           checkInTime: raw.check_in || null,
//           checkOutTime: raw.check_out || null,
//           imageUrl: imageUrl,
//           createdAt: raw.created_at || new Date().toISOString(),
//         });
//       }

//       // ============================================
//       // STEP 7: Add Hired Servants Without Logs
//       // ============================================
//       for (const [phone, servant] of hiredServantMap) {
//         if (!servantsWithLogs.has(phone)) {
//           formattedVisitors.push({
//             visitorId: servant.servant_id || "N/A",
//             name: servant.servant_name || "N/A",
//             phoneNumber: phone,
//             role: "servant",
//             visitorStatus: "outside",
//             purpose: "Hired Servant",
//             preApproved: true,
//             vehicleNumber: null,
//             idProofType: null,
//             gateNumber: null,
//             checkInTime: null,
//             checkOutTime: null,
//             imageUrl: null,
//             createdAt: new Date().toISOString(),
//           });
//         }
//       }

//       // ============================================
//       // STEP 8: Apply Search & Filters (Client-side)
//       // ============================================
//       let filteredVisitors = formattedVisitors;

//       if (search) {
//         filteredVisitors = applySearchFilter(filteredVisitors, search);
//       }

//       filteredVisitors = applyFilters(filteredVisitors, {
//         role: role || "all",
//         visitorStatus: visitorStatus || "all",
//       });

//       // ============================================
//       // STEP 9: Apply Pagination
//       // ============================================
//       const { items, total } = applyPagination(
//         filteredVisitors,
//         pageNum,
//         limitNum,
//       );

//       // ============================================
//       // STEP 10: Calculate Stats
//       // ============================================
//       let currentlyInside = 0;
//       let currentlyOutside = 0;

//       for (const v of filteredVisitors) {
//         if (v.visitorStatus === "inside") {
//           currentlyInside++;
//         } else if (v.visitorStatus === "outside") {
//           currentlyOutside++;
//         }
//       }

//       // ============================================
//       // STEP 11: Prepare Response
//       // ============================================
//       const response: ResidentLogVisitorsResponse = {
//         total: total,
//         page: pageNum,
//         limit: limitNum,
//         totalPages: Math.ceil(total / limitNum),
//         visitors: items,
//         filters: {
//           role: role || null,
//           visitorStatus: visitorStatus || null,
//           filterOption: filterOption || null,
//           fromDate: fromDate || null,
//           toDate: toDate || null,
//         },
//         search: search || null,
//         stats: {
//           totalVisitors: filteredVisitors.length,
//           currentlyInside,
//           currentlyOutside,
//         },
//       };

//       logger.info({
//         level: "info",
//         action: "resident-log-visitors",
//         userId: authCtx.user.id,
//         residentId: hostUser.user_id,
//         visitorsFound: total,
//         returned: items.length,
//         stats: { currentlyInside, currentlyOutside },
//         duration: Date.now() - startTime,
//         message: "Resident log visitors fetched successfully",
//         timestamp: new Date().toISOString(),
//       });

//       return successResponse(response);
//     } catch (error: unknown) {
//       const errorMessage = error instanceof Error
//         ? error.message
//         : "Unknown error";

//       logger.error({
//         level: "error",
//         action: "resident-log-visitors",
//         userId: authCtx?.user?.id || "unknown",
//         message: errorMessage,
//         stack: error instanceof Error ? error.stack : undefined,
//         timestamp: new Date().toISOString(),
//       });

//       return errorResponse(
//         errorMessage || "Failed to fetch resident log visitors.",
//       );
//     }
//   }),
// );




// ============================================
// resident-log-visitors - Get Visitor Logs for a Resident (Optimized)
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

interface ResidentLogVisitorsRequest {
  societyRegistrationNumber: string;
  residentId: string;
  role?: string | string[];
  visitorStatus?: string;
  filterOption?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface VisitorLogResponse {
  visitorId: string;
  name: string;
  phoneNumber: string;
  role: string;
  visitorStatus: string | null;
  purpose: string | null;
  preApproved: boolean;
  vehicleNumber: string | null;
  idProofType: string | null;
  gateNumber: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface ResidentLogVisitorsResponse {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  visitors: VisitorLogResponse[];
  filters: {
    role: string | string[] | null;
    visitorStatus: string | null;
    filterOption: string | null;
    fromDate: string | null;
    toDate: string | null;
  };
  search: string | null;
  stats: {
    totalVisitors: number;
    currentlyInside: number;
    currentlyOutside: number;
  };
}

interface RawVisitorLog {
  non_society_user_id: string;
  name: string | null;
  phone_number: string | null;
  visitor_status: string | null;
  purpose: string | null;
  pre_approved: boolean | null;
  vehicle_number: string | null;
  id_proof_type: string | null;
  gate_no: string | null;
  check_in: string | null;
  check_out: string | null;
  role: string | null;
  created_at: string;
}

interface RawServant {
  servant_id: string;
  phone_number: string | null;
  servant_name: string | null;
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

// Cached IST formatters
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
  visitors: VisitorLogResponse[],
  searchTerm: string,
): VisitorLogResponse[] {
  if (!searchTerm) return visitors;
  const term = searchTerm.toLowerCase().trim();
  return visitors.filter((v) =>
    v.name.toLowerCase().includes(term) ||
    v.phoneNumber.includes(term) ||
    (v.purpose?.toLowerCase().includes(term) ?? false) ||
    (v.vehicleNumber?.toLowerCase().includes(term) ?? false)
  );
}

function applyFilters(
  visitors: VisitorLogResponse[],
  filters: { role?: string | string[]; visitorStatus?: string },
): VisitorLogResponse[] {
  let filtered = visitors;

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

  if (filters.visitorStatus && filters.visitorStatus.toLowerCase() !== "all") {
    const target = filters.visitorStatus.toLowerCase();
    filtered = filtered.filter(
      (v) => v.visitorStatus?.toLowerCase() === target,
    );
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
        action: "resident-log-visitors",
        userId: authCtx.user.id,
        message: "Resident log visitors request received",
        timestamp: new Date().toISOString(),
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.");
      }

      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("Request body is required.");

      const {
        societyRegistrationNumber,
        residentId,
        role,
        visitorStatus,
        filterOption,
        fromDate,
        toDate,
        search,
        page,
        limit,
      } = body as ResidentLogVisitorsRequest;

      const validator = new Validator()
        .validateRequired(
          societyRegistrationNumber,
          "societyRegistrationNumber",
        )
        .validateRequired(residentId, "residentId");

      if (!validator.isValid()) {
        logger.warn({
          level: "warn",
          action: "resident-log-visitors",
          userId: authCtx.user.id,
          message: "Validation failed",
          errors: JSON.stringify(validator.getErrors()),
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Validation failed");
      }

      const regNum = sanitizeString(societyRegistrationNumber);
      const cleanResidentId = sanitizeString(residentId);
      const pageNum = Number(page) || 1;
      const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
      const roleFilter = normalizeRoleFilter(role);

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
          action: "resident-log-visitors",
          message: `Society lookup failed: ${socErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to fetch society data.");
      }

      if (!society) {
        return errorResponse("Society not found for provided registration number.");
      }

      // --------------------------------------------------
      // STEP 2: Verify resident
      // --------------------------------------------------
      const { data: hostUser, error: hostErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, unit_flat_number")
        .eq("user_id", cleanResidentId)
        .eq("society", society.society_id)
        .maybeSingle();

      if (hostErr) {
        logger.error({
          level: "error",
          action: "resident-log-visitors",
          message: `Resident lookup failed: ${hostErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to verify resident.");
      }

      if (!hostUser) {
        return errorResponse("Resident not found in this society.");
      }

      logger.info({
        level: "info",
        action: "resident-log-visitors",
        message: "Resident verified",
        residentId: hostUser.user_id,
        timestamp: new Date().toISOString(),
      });

      // --------------------------------------------------
      // STEP 3: Get active servants
      // --------------------------------------------------
      const { data: hiredServants, error: servantErr } = await supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, phone_number, servant_name")
        .eq("society", society.society_id)
        .eq("status", "active");

      if (servantErr) {
        logger.warn({
          level: "warn",
          action: "resident-log-visitors",
          message: `Servant fetch failed: ${servantErr.message}`,
          timestamp: new Date().toISOString(),
        });
      }

      const hiredServantMap = new Map<string, RawServant>();
      const servantPhoneNumbers: string[] = [];

      if (hiredServants && hiredServants.length > 0) {
        for (const servant of hiredServants as RawServant[]) {
          if (servant.phone_number && servant.phone_number.trim() !== "") {
            const formattedPhone = servant.phone_number.trim();
            hiredServantMap.set(formattedPhone, servant);
            servantPhoneNumbers.push(formattedPhone);
          }
        }
      }

      logger.info({
        level: "info",
        action: "resident-log-visitors",
        message: `Found ${hiredServantMap.size} active servants`,
        servantCount: hiredServantMap.size,
        timestamp: new Date().toISOString(),
      });

      // --------------------------------------------------
      // STEP 4: Visitor logs query
      // --------------------------------------------------
      let query = supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(`
          non_society_user_id,
          name,
          phone_number,
          visitor_status,
          purpose,
          pre_approved,
          vehicle_number,
          id_proof_type,
          gate_no,
          check_in,
          check_out,
          role,
          created_at
        `)
        .not("check_in", "is", null);

      let targetAudienceClause = `hosted_by.eq.${hostUser.user_id}`;

      if (servantPhoneNumbers.length > 0) {
        const formattedArrayStr = servantPhoneNumbers.map((p) => `"${p}"`).join(
          ",",
        );
        targetAudienceClause =
          `and(hosted_by.eq.${hostUser.user_id},role.eq.Visitor),` +
          `and(phone_number.in.(${formattedArrayStr}),role.eq.Servant)`;
      } else {
        query = query.eq("role", "visitor");
      }

      query = query.or(targetAudienceClause);

      if (roleFilter && roleFilter.length > 0) {
        const roleConditions = roleFilter.map((r) => `role.eq.${r}`).join(",");
        query = query.or(roleConditions);
      }

      if (
        visitorStatus && visitorStatus.trim() !== "" &&
        visitorStatus.toLowerCase() !== "all"
      ) {
        query = query.eq("visitor_status", visitorStatus.trim());
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
            `purpose.ilike.%${term}%,` +
            `vehicle_number.ilike.%${term}%`,
        );
      }

      const { data: visitorLogs, error: fetchErr } = await query.order(
        "check_in",
        { ascending: false },
      );

      if (fetchErr) {
        logger.error({
          level: "error",
          action: "resident-log-visitors",
          message: `Fetch error: ${fetchErr.message}`,
          timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to fetch visitor logs.");
      }

      const rawVisitors = (visitorLogs || []) as RawVisitorLog[];

      // --------------------------------------------------
      // STEP 5 (BATCHED): Fetch all docs + sign all URLs
      // --------------------------------------------------
      const visitorIds = rawVisitors.map((v) => v.non_society_user_id);
      const imagePathMap = new Map<string, string>();
      const servantsWithLogs = new Set<string>();

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
            // First doc per visitor wins (matches original)
            if (!imagePathMap.has(doc.non_society_user)) {
              imagePathMap.set(doc.non_society_user, doc.s3_path);
            }
          }
        }
      }

      // Sign all paths in one batched pass
      const allPaths = Array.from(imagePathMap.values());
      const signedUrlMap = await batchSignUrls(allPaths);

      // Final visitor_id → signed_url map
      const imageMap = new Map<string, string>();
      for (const [visitorId, rawPath] of imagePathMap.entries()) {
        const url = signedUrlMap.get(rawPath);
        if (url) imageMap.set(visitorId, url);
      }

      // --------------------------------------------------
      // STEP 6: Format visitor logs (no I/O)
      // --------------------------------------------------
      const formattedVisitors: VisitorLogResponse[] = [];

      for (const raw of rawVisitors) {
        const imageUrl = imageMap.get(raw.non_society_user_id) || null;

        if (raw.role === "servant" && raw.phone_number) {
          servantsWithLogs.add(raw.phone_number.trim());
        }

        formattedVisitors.push({
          visitorId: raw.non_society_user_id,
          name: raw.name || "N/A",
          phoneNumber: raw.phone_number || "N/A",
          role: raw.role || "visitor",
          visitorStatus: raw.visitor_status || null,
          purpose: raw.purpose || null,
          preApproved: raw.pre_approved || false,
          vehicleNumber: raw.vehicle_number || null,
          idProofType: raw.id_proof_type || null,
          gateNumber: raw.gate_no || null,
          checkInTime: raw.check_in || null,
          checkOutTime: raw.check_out || null,
          imageUrl,
          createdAt: raw.created_at || new Date().toISOString(),
        });
      }

      // --------------------------------------------------
      // STEP 7: Add hired servants without logs
      // --------------------------------------------------
      for (const [phone, servant] of hiredServantMap) {
        if (!servantsWithLogs.has(phone)) {
          formattedVisitors.push({
            visitorId: servant.servant_id || "N/A",
            name: servant.servant_name || "N/A",
            phoneNumber: phone,
            role: "servant",
            visitorStatus: "outside",
            purpose: "Hired Servant",
            preApproved: true,
            vehicleNumber: null,
            idProofType: null,
            gateNumber: null,
            checkInTime: null,
            checkOutTime: null,
            imageUrl: null,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // --------------------------------------------------
      // STEP 8: Client-side search + filters (preserved)
      // --------------------------------------------------
      let filteredVisitors = formattedVisitors;

      if (search) {
        filteredVisitors = applySearchFilter(filteredVisitors, search);
      }

      filteredVisitors = applyFilters(filteredVisitors, {
        role: role || "all",
        visitorStatus: visitorStatus || "all",
      });

      // --------------------------------------------------
      // STEP 9: Pagination
      // --------------------------------------------------
      const { items, total } = applyPagination(
        filteredVisitors,
        pageNum,
        limitNum,
      );

      // --------------------------------------------------
      // STEP 10: Stats (over full filtered set — preserved)
      // --------------------------------------------------
      let currentlyInside = 0;
      let currentlyOutside = 0;

      for (const v of filteredVisitors) {
        if (v.visitorStatus === "inside") currentlyInside++;
        else if (v.visitorStatus === "outside") currentlyOutside++;
      }

      // --------------------------------------------------
      // STEP 11: Response
      // --------------------------------------------------
      const response: ResidentLogVisitorsResponse = {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        visitors: items,
        filters: {
          role: role || null,
          visitorStatus: visitorStatus || null,
          filterOption: filterOption || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
        },
        search: search || null,
        stats: {
          totalVisitors: filteredVisitors.length,
          currentlyInside,
          currentlyOutside,
        },
      };

      logger.info({
        level: "info",
        action: "resident-log-visitors",
        userId: authCtx.user.id,
        residentId: hostUser.user_id,
        visitorsFound: total,
        returned: items.length,
        stats: { currentlyInside, currentlyOutside },
        duration: Date.now() - startTime,
        message: "Resident log visitors fetched successfully",
        timestamp: new Date().toISOString(),
      });

      return successResponse(response);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";

      logger.error({
        level: "error",
        action: "resident-log-visitors",
        userId: authCtx?.user?.id || "unknown",
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });

      return errorResponse(
        errorMessage || "Failed to fetch resident log visitors.",
      );
    }
  }),
);