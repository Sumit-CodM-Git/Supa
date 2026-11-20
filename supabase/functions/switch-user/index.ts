// import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "POST, OPTIONS",
// };

// // =========================================================
// // TYPES
// // =========================================================

// interface ContactInfo {
//   contact_id: string;
//   name: string | null;
//   phone: string | null;
//   vehicle_type: string | null;
// }

// interface SocietyInfo {
//   society_id: string;
//   society_name: string | null;
//   registration_number: string | null;
//   subscription_plan: string | null;
//   address_line1: string | null;
//   city: string | null;
//   total_unit: number | null;
//   parking_slot: string | number | null;
// }

// interface SocietyUserRecord {
//   user_id: string;
//   role: string | string[] | null;
//   user_type: string | null;
//   user_ownership_type: string | null;
//   status: boolean | null;
//   move_in_date: string | null;
//   unit_flat_number: string | null;
//   created_at: string;
//   agent_availability_status: string | null;
//   service_agent_services: unknown;
//   contact: ContactInfo | null;
//   society: SocietyInfo | null;
//   tower: unknown;
//   block: unknown;
// }

// interface NonSocietyUserRecord {
//   non_society_user_id: string;
//   vendor_id: string | null;
//   name: string | null;
//   phone_number: string | null;
//   role: string | null;
//   service_type: string | null;
//   created_at: string;
// }

// interface AlertItem {
//   title: string | null;
//   message: string | null;
//   type: string | null;
// }

// interface UserDetail {
//   societyUserID: string | null;
//   nonSocietyUserID: string | null;
//   vendorID: string | null;
//   fullName: string | null;
//   phone: string | null;
//   role: string;
//   flatNumber: string | null;
//   tower: unknown;
//   block: unknown;
//   status: boolean | null;
//   ownership: string | null;
//   userType: string | null;
//   moveInDate: string | null;
//   joiningDate: string;
//   myComplaints: { total: number; pending: number; resolved: number };
//   myBookings: { totalUpcoming: number; pending: number; confirmed: number };
// }

// interface SwitchRequestBody {
//   phoneNumber?: string;
//   registrationNumber?: string;
//   role?: string;
//   page?: number | string;
//   limit?: number | string;
//   filters?: {
//     statusFilter?: string | null;
//     userTypeFilter?: string | null;
//     complaintStatus?: string | null;
//     bookingStatus?: string | null;
//     searchQuery?: string | null;
//   };
// }

// // =========================================================
// // HELPERS
// // =========================================================

// function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
//   if (value == null) return null;
//   return Array.isArray(value) ? (value[0] ?? null) : value;
// }

// function normalizeRole(r: string | null | undefined): string {
//   if (!r) return "";
//   return r.toLowerCase().replace(/_/g, " ").trim();
// }

// function phoneDigits(raw: unknown): string {
//   let d = String(raw ?? "").replace(/\D/g, "");
//   if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
//   if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
//   return d;
// }

// function parsePostgresArray(roleField: unknown): string[] {
//   if (!roleField) return [];
//   if (Array.isArray(roleField)) return roleField.map((r) => String(r).trim());
//   const str = String(roleField).trim();
//   if (str.startsWith("{") && str.endsWith("}")) {
//     return str.slice(1, -1).split(",").map((r) => r.replace(/"/g, "").trim());
//   }
//   return [str];
// }

// function buildErrorResponse(code: string, message: string, statusCode: number) {
//   return new Response(
//     JSON.stringify({
//       userDetail: null,
//       societyDetail: null,
//       alerts: null,
//       serviceAgent: null,
//       roles: null,
//       pagination: null,
//       errorResponse: { errorCode: code, message, timestamp: new Date().toISOString() },
//     }),
//     { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
//   );
// }

// // =========================================================
// // MAIN HANDLER
// // =========================================================

// Deno.serve(async (req: Request): Promise<Response> => {
//   if (req.method === "OPTIONS") {
//     return new Response("ok", { headers: corsHeaders });
//   }

//   const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
//   const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   const isProd = Deno.env.get("DENO_ENV") === "production";

//   try {
//     // 1. AUTHENTICATION
//     const authHeader = req.headers.get("Authorization");
//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//       return buildErrorResponse("UNAUTHORIZED", "Missing or invalid Authorization header.", 401);
//     }

//     const token = authHeader.replace("Bearer ", "");
//     const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

//     if (authError || !authUser) {
//       return buildErrorResponse("UNAUTHORIZED", "Authentication token is invalid or expired.", 401);
//     }

//     // 2. INPUT VALIDATION
//     const bodyText = await req.text();
//     let payload: SwitchRequestBody;
//     try {
//       payload = JSON.parse(bodyText) as SwitchRequestBody;
//     } catch {
//       return buildErrorResponse("BAD_REQUEST", "Malformed JSON payload.", 400);
//     }

//     const { phoneNumber, registrationNumber, role, page = 1, limit = 10, filters = {} } = payload;

//     if (!phoneNumber || !registrationNumber || !role) {
//       return buildErrorResponse("BAD_REQUEST", "phoneNumber, registrationNumber, and role are mandatory.", 400);
//     }

//     const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
//     const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
//     const offset = (pageNum - 1) * limitNum;

//     const cleanRegNum = String(registrationNumber).trim();
//     const targetRole = String(role).trim();
//     const inputPhone = phoneDigits(phoneNumber);

//     if (inputPhone.length < 7) {
//       return buildErrorResponse("BAD_REQUEST", "Invalid phoneNumber format.", 400);
//     }

//     // 3. FETCH SOCIETY & CALLER PROFILE IN PARALLEL
//     const [societyRes, callerRes] = await Promise.all([
//       supabase.from("SSP_Society").select("*").eq("registration_number", cleanRegNum).maybeSingle(),
//       supabase.from("SSP_Society_User").select(`user_id, contact:contact(phone)`).eq("user_id", authUser.id)
//     ]);

//     const societyRecord = societyRes.data;
//     if (societyRes.error || !societyRecord) {
//       return buildErrorResponse("NOT_FOUND", "Society not found.", 404);
//     }

//     const societyId = societyRecord.society_id;
//     const callerRow = callerRes.data;

//     let callerPhone = "";
//     if (callerRow) {
//       callerPhone = phoneDigits(unwrapOne(callerRow.contact as any)?.phone);
//     }

//     // 4. AUTHORIZATION (Allow if they are a matching resident OR matching vendor)
//     if (callerPhone !== inputPhone) {
//       const { data: vendorRow } = await supabase
//         .from("SSP_Non_Society_User")
//         .select("non_society_user_id")
//         .eq("society", societyId)
//         .ilike("phone_number", `%${inputPhone}%`)
//         .maybeSingle();
      
//       if (!vendorRow) {
//         return buildErrorResponse("FORBIDDEN", "You can only access your own profile.", 403);
//       }
//     }

//     // 5. FETCH MATCHING PROFILES (Optimized to only query matching phone numbers!)
//     const [userRes, nsRes] = await Promise.all([
//       supabase
//         .from("SSP_Society_User")
//         .select(`
//           user_id, role, user_type, user_ownership_type, status, move_in_date, unit_flat_number, created_at,
//           agent_availability_status, service_agent_services,
//           contact:contact ( contact_id, name, phone, vehicle_type ),
//           society:society ( society_id, society_name, registration_number, subscription_plan, address_line1, city, total_unit, parking_slot ),
//           tower:tower (*), block:block (*)
//         `)
//         .eq("society", societyId)
//         .ilike("contact.phone", `%${inputPhone}%`), // Database-level filtering
//       supabase
//         .from("SSP_Non_Society_User")
//         .select(`non_society_user_id, vendor_id, name, phone_number, role, service_type, created_at`)
//         .eq("society", societyId)
//         .ilike("phone_number", `%${inputPhone}%`) // Database-level filtering
//     ]);

//     const userRecords = userRes.data;
//     const nonSocietyRecords = nsRes.data;

//     const normalizedUsers = (userRecords ?? []).map((u) => ({
//       ...u,
//       contact: unwrapOne(u.contact),
//       society: unwrapOne(u.society),
//     })) as SocietyUserRecord[];

//     const mySocietyProfiles = normalizedUsers.filter((u) => phoneDigits(u.contact?.phone) === inputPhone);
//     const myNonSocietyProfiles = (nonSocietyRecords ?? []) as NonSocietyUserRecord[];

//     // 6. BUILD ROLES LIST
//     const distinctRoles = new Set<string>();
//     const addRole = (roleStr: string | null | undefined) => {
//       if (!roleStr) return;
//       let clean = String(roleStr).trim().toLowerCase();
//       if (clean === "" || clean === "na" || clean === "null") return;
//       if (clean === "service_agent") clean = "service agent";
//       const formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
//       distinctRoles.add(formatted);
//     };

//     mySocietyProfiles.forEach((u) => parsePostgresArray(u.role).forEach(addRole));
//     myNonSocietyProfiles.forEach((ns) => { if (ns.role) addRole(ns.role); });
//     const rolesList = Array.from(distinctRoles);

//     // 7. SELECT TARGET PROFILE
//     const targetNormalized = normalizeRole(targetRole);

//     let matchedSocietyUser = mySocietyProfiles.find((u) => 
//       parsePostgresArray(u.role).map(normalizeRole).includes(targetNormalized)
//     );

//     let matchedNonSocietyUser = myNonSocietyProfiles.find((ns) => 
//       normalizeRole(ns.role) === targetNormalized
//     );

//     const linkedSocietyUserId = matchedSocietyUser?.user_id ?? mySocietyProfiles[0]?.user_id ?? null;
//     const linkedNonSocietyUserId = matchedNonSocietyUser?.non_society_user_id ?? myNonSocietyProfiles[0]?.non_society_user_id ?? null;

//     // 8. BUILD USER DETAIL & METRICS IN PARALLEL
//     let userDetail: UserDetail | null = null;

//     if (matchedSocietyUser) {
//       // Fetch all counts in parallel
//       const [compTotal, compPending, compResolved, bookUpcoming, bookPending, bookConfirmed] = await Promise.all([
//         supabase.from("SSP_Complaint").select("*", { count: "exact", head: true }).eq("society_user", matchedSocietyUser.user_id).ilike("status", filters.complaintStatus ? String(filters.complaintStatus) : "%"),
//         supabase.from("SSP_Complaint").select("*", { count: "exact", head: true }).eq("society_user", matchedSocietyUser.user_id).ilike("status", "pending"),
//         supabase.from("SSP_Complaint").select("*", { count: "exact", head: true }).eq("society_user", matchedSocietyUser.user_id).ilike("status", "resolved"),
//         supabase.from("SSP_Facility_Booking_Request").select("*", { count: "exact", head: true }).eq("requested_by", matchedSocietyUser.user_id).gte("booking_start_date", new Date().toISOString()).ilike("status", filters.bookingStatus ? String(filters.bookingStatus) : "%"),
//         supabase.from("SSP_Facility_Booking_Request").select("*", { count: "exact", head: true }).eq("requested_by", matchedSocietyUser.user_id).ilike("status", "waiting_payment"),
//         supabase.from("SSP_Facility_Booking_Request").select("*", { count: "exact", head: true }).eq("requested_by", matchedSocietyUser.user_id).ilike("status", "approved")
//       ]);

//       userDetail = {
//         societyUserID: matchedSocietyUser.user_id,
//         nonSocietyUserID: linkedNonSocietyUserId,
//         vendorID: null,
//         fullName: matchedSocietyUser.contact?.name ?? null,
//         phone: matchedSocietyUser.contact?.phone ?? null,
//         role: targetRole,
//         flatNumber: matchedSocietyUser.unit_flat_number,
//         tower: matchedSocietyUser.tower,
//         block: matchedSocietyUser.block,
//         status: matchedSocietyUser.status,
//         ownership: matchedSocietyUser.user_ownership_type,
//         userType: matchedSocietyUser.user_type,
//         moveInDate: matchedSocietyUser.move_in_date,
//         joiningDate: matchedSocietyUser.created_at,
//         myComplaints: { 
//           total: compTotal.count ?? 0, 
//           pending: compPending.count ?? 0, 
//           resolved: compResolved.count ?? 0 
//         },
//         myBookings: { 
//           totalUpcoming: bookUpcoming.count ?? 0, 
//           pending: bookPending.count ?? 0, 
//           confirmed: bookConfirmed.count ?? 0 
//         },
//       };
//     } else if (matchedNonSocietyUser) {
//       const { count: assignedComplaints } = await supabase
//         .from("SSP_Complaint")
//         .select("*", { count: "exact", head: true })
//         .eq("non_society_user", matchedNonSocietyUser.non_society_user_id)
//         .not("status", "ilike", "resolved");

//       userDetail = {
//         societyUserID: linkedSocietyUserId,
//         nonSocietyUserID: matchedNonSocietyUser.non_society_user_id,
//         vendorID: matchedNonSocietyUser.vendor_id ?? matchedNonSocietyUser.non_society_user_id,
//         fullName: matchedNonSocietyUser.name,
//         phone: matchedNonSocietyUser.phone_number,
//         role: matchedNonSocietyUser.role ?? "Vendor",
//         flatNumber: null, tower: null, block: null,
//         status: true, ownership: null, userType: "Vendor", moveInDate: null,
//         joiningDate: matchedNonSocietyUser.created_at,
//         myComplaints: { total: assignedComplaints ?? 0, pending: assignedComplaints ?? 0, resolved: 0 },
//         myBookings: { totalUpcoming: 0, pending: 0, confirmed: 0 },
//       };
//     }

//     // 9. ADMIN-ONLY SOCIETY STATISTICS
//     const isAdmin = targetNormalized === "admin";
//     let societyDetail = null;

//     if (isAdmin) {
//       const { data: allSocietyUsers } = await supabase
//         .from("SSP_Society_User")
//         .select("user_type, contact:contact(vehicle_type)")
//         .eq("society", societyId);

//       let ownersCount = 0, tenantsCount = 0, twoWheelers = 0, fourWheelers = 0;
//       (allSocietyUsers ?? []).forEach((raw) => {
//         const u = raw as any;
//         const contact = unwrapOne(u.contact);
//         const type = String(u.user_type ?? "").trim().toLowerCase();
//         if (type === "owner") ownersCount++;
//         if (type === "tenant") tenantsCount++;
//         const vehicle = String(contact?.vehicle_type ?? "").trim().toLowerCase();
//         if (vehicle.includes("two")) twoWheelers++;
//         if (vehicle.includes("four")) fourWheelers++;
//       });

//       const totalUnits = Number(societyRecord.total_unit) || 0;
//       const totalParking = Number(societyRecord.parking_slot) || 0;
//       const occupiedFlats = ownersCount + tenantsCount;

//       societyDetail = {
//         name: societyRecord.society_name || "Unnamed Society",
//         address: [societyRecord.address_line1, societyRecord.city].filter(Boolean).join(", "),
//         subscriptionPlan: societyRecord.subscription_plan || null,
//         totalFlats: totalUnits,
//         occupiedFlats,
//         vacantFlats: Math.max(0, totalUnits - occupiedFlats),
//         owners: ownersCount,
//         tenants: tenantsCount,
//         twoWheelers,
//         fourWheelers,
//         vacantParkingSlots: Math.max(0, totalParking - (twoWheelers + fourWheelers)),
//       };
//     } else {
//       societyDetail = {
//         name: societyRecord.society_name || "Unnamed Society",
//         address: [societyRecord.address_line1, societyRecord.city].filter(Boolean).join(", "),
//         subscriptionPlan: societyRecord.subscription_plan || null,
//         totalFlats: null, occupiedFlats: null, vacantFlats: null, owners: null, tenants: null, twoWheelers: null, fourWheelers: null, vacantParkingSlots: null,
//       };
//     }

//     // 10. ALERTS
//     const [alertsRes, totalAlertsRes] = await Promise.all([
//       supabase.from("SSP_Alert").select("title, message, type").eq("society", societyId).range(offset, offset + limitNum - 1),
//       supabase.from("SSP_Alert").select("*", { count: "exact", head: true }).eq("society", societyId)
//     ]);

//     const alerts = (alertsRes.data ?? []).map((al) => ({ title: al.title, message: al.message, type: al.type }));
//     const totalAlerts = totalAlertsRes.count ?? 0;

//     // 11. SERVICE AGENT METADATA
//     let serviceAgent = null;
//     if (targetNormalized === "service agent") {
//       const agentRecord = mySocietyProfiles.find((u) => parsePostgresArray(u.role).map(normalizeRole).includes("service agent"));
//       if (agentRecord?.contact) {
//         serviceAgent = {
//           agentId: agentRecord.user_id,
//           name: agentRecord.contact.name,
//           contactId: agentRecord.contact.contact_id,
//           phoneNumber: agentRecord.contact.phone,
//           agentAvailabilityStatus: agentRecord.agent_availability_status || null,
//           agentServices: agentRecord.service_agent_services || null,
//         };
//       }
//     }

//     // 12. RESPONSE
//     return new Response(
//       JSON.stringify({
//         matched: userDetail !== null,
//         roles: rolesList,
//         userDetail,
//         societyDetail,
//         alerts,
//         serviceAgent,
//         pagination: { page: pageNum, limit: limitNum, totalAlerts, totalPages: Math.ceil(totalAlerts / limitNum) },
//         errorResponse: null,
//       }),
//       { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
//     );
//   } catch (error: unknown) {
//     const message = error instanceof Error ? error.message : "Fatal error";
//     console.error("switch-user error:", message);
//     return buildErrorResponse("SERVER_ERROR", isProd ? "An internal error occurred." : `Execution Failure: ${message}`, 500);
//   }
// });


import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// =========================================================
// TYPES
// =========================================================

interface ContactInfo {
  contact_id: string;
  name: string | null;
  phone: string | null;
  gender: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  email: string | null;
  occupation: string | null;
  whatsapp_phone: string | null;
  emergency_phone: string | null;
  vehicle_type: string | null;
  vehicle_registration_number: string | null;
  description: string | null;
}

interface SocietyInfo {
  society_id: string;
  society_name: string | null;
  registration_number: string | null;
  subscription_plan: string | null;
  address_line1: string | null;
  city: string | null;
  total_unit: number | null;
  parking_slot: string | number | null;
}

interface SocietyUserRecord {
  user_id: string;
  role: string | string[] | null;
  user_type: string | null;
  user_ownership_type: string | null;
  status: boolean | null;
  move_in_date: string | null;
  unit_flat_number: string | null;
  created_at: string;
  agent_availability_status: string | null;
  service_agent_services: unknown;
  contact: ContactInfo | null;
  society: SocietyInfo | null;
  tower: unknown;
  block: unknown;
}

interface NonSocietyUserRecord {
  non_society_user_id: string;
  vendor_id: string | null;
  name: string | null;
  phone_number: string | null;
  role: string | null;
  service_type: string | null;
  created_at: string;
  gender: string | null;
  email: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  vehicle_number: string | null;
  vehicle_type: string | null;
  vendor_rating: number | string | null;
  delivery_origin: string | null;
}

interface SwitchRequestBody {
  phoneNumber?: string;
  registrationNumber?: string;
  role?: string;
  page?: number | string;
  limit?: number | string;
  filters?: {
    statusFilter?: string | null;
    userTypeFilter?: string | null;
    complaintStatus?: string | null;
    bookingStatus?: string | null;
    searchQuery?: string | null;
  };
}

// =========================================================
// HELPERS
// =========================================================

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeRole(r: string | null | undefined): string {
  if (!r) return "";
  return r.toLowerCase().replace(/_/g, " ").trim();
}

/** STRICT FORMATTER: Guarantees the string sent to Flutter is "Service Agent", "Admin", etc. */
function formatRoleForDisplay(role: string): string {
  const clean = role.toLowerCase().replace(/_/g, " ").trim();
  if (clean === "service agent") return "Service Agent";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function phoneDigits(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

function parsePostgresArray(roleField: unknown): string[] {
  if (!roleField) return [];
  if (Array.isArray(roleField)) return roleField.map((r) => String(r).trim());
  const str = String(roleField).trim();
  if (str.startsWith("{") && str.endsWith("}")) {
    return str.slice(1, -1).split(",").map((r) => r.replace(/"/g, "").trim());
  }
  return [str];
}

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      userDetail: null,
      societyDetail: null,
      alerts: null,
      serviceAgent: null,
      roles: null,
      pagination: null,
      errorResponse: {
        errorCode: code,
        message,
        timestamp: new Date().toISOString(),
      },
    }),
    {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// =========================================================
// MAIN HANDLER
// =========================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const isProd = Deno.env.get("DENO_ENV") === "production";

  try {
    // =========================================================
    // 1. AUTHENTICATION
    // =========================================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return buildErrorResponse("UNAUTHORIZED", "Missing or invalid Authorization header.", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !authUser) {
      return buildErrorResponse("UNAUTHORIZED", "Authentication token is invalid or expired.", 401);
    }

    // =========================================================
    // 2. INPUT VALIDATION
    // =========================================================
    const bodyText = await req.text();
    let payload: SwitchRequestBody;
    try {
      payload = JSON.parse(bodyText) as SwitchRequestBody;
    } catch {
      return buildErrorResponse("BAD_REQUEST", "Malformed JSON payload.", 400);
    }

    const { phoneNumber, registrationNumber, role, page = 1, limit = 10, filters = {} } = payload;

    if (!phoneNumber || !registrationNumber || !role) {
      return buildErrorResponse(
        "BAD_REQUEST",
        "phoneNumber, registrationNumber, and role are mandatory.",
        400
      );
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const cleanRegNum = String(registrationNumber).trim();
    const targetRole = String(role).trim();
    const inputPhone = phoneDigits(phoneNumber);

    if (inputPhone.length < 7) {
      return buildErrorResponse("BAD_REQUEST", "Invalid phoneNumber format.", 400);
    }

    // =========================================================
    // 3. FETCH SOCIETY & CALLER PROFILE
    // =========================================================
    const [societyRes, callerRes] = await Promise.all([
      supabase
        .from("SSP_Society")
        .select("*")
        .eq("registration_number", cleanRegNum)
        .maybeSingle(),
      supabase
        .from("SSP_Society_User")
        .select(`user_id, contact:contact(phone)`)
        .eq("user_id", authUser.id)
        .maybeSingle(),
    ]);

    const societyRecord = societyRes.data;
    if (societyRes.error || !societyRecord) {
      return buildErrorResponse("NOT_FOUND", "Society not found.", 404);
    }

    const societyId = societyRecord.society_id;
    const callerRow = callerRes.data as
      | { user_id: string; contact: unknown }
      | null;
    const callerContact = unwrapOne(callerRow?.contact as any);
    const callerPhone = phoneDigits(callerContact?.phone);

    // =========================================================
    // 4. AUTHORIZATION
    // =========================================================
    if (callerPhone !== inputPhone) {
      const { data: vendorRows } = await supabase
        .from("SSP_Non_Society_User")
        .select("non_society_user_id, phone_number")
        .eq("society", societyId);
      const vendorRow = (vendorRows ?? []).find(
        (v: any) => phoneDigits(v.phone_number) === inputPhone
      );
      if (!vendorRow) {
        return buildErrorResponse(
          "FORBIDDEN",
          "You can only access your own profile.",
          403
        );
      }
    }

    // =========================================================
    // 5. FETCH MATCHING PROFILES
    // =========================================================
    // ✅ FIX: Removed `ilike` so we don't miss phone numbers with spaces/hyphens.
    // Fetch all for the society and filter in JS.
    const [userRes, nsRes] = await Promise.all([
      supabase
        .from("SSP_Society_User")
        .select(
          `
          user_id, role, user_type, user_ownership_type, status,
          move_in_date, unit_flat_number, created_at,
          agent_availability_status, service_agent_services,
          contact:contact (
            contact_id, name, phone, gender,
            id_proof_type, id_proof_number,
            email, occupation, whatsapp_phone, emergency_phone,
            vehicle_type, vehicle_registration_number, description
          ),
          society:society (
            society_id, society_name, registration_number,
            subscription_plan, address_line1, city, total_unit, parking_slot
          ),
          tower:tower (*), block:block (*)
        `
        )
        .eq("society", societyId),
      supabase
        .from("SSP_Non_Society_User")
        .select(
          `non_society_user_id, vendor_id, name, phone_number, role,
           service_type, created_at,
           gender, email, id_proof_type, id_proof_number,
           vehicle_number, vehicle_type, vendor_rating, delivery_origin`
        )
        .eq("society", societyId),
    ]);

    const userRecords = userRes.data;
    const nonSocietyRecords = nsRes.data;

    const normalizedUsers = (userRecords ?? []).map((u) => ({
      ...u,
      contact: unwrapOne(u.contact),
      society: unwrapOne(u.society),
    })) as SocietyUserRecord[];
    
    // ✅ FIX: Strict digit matching in JS.
    const mySocietyProfiles = normalizedUsers.filter(
      (u) => phoneDigits(u.contact?.phone) === inputPhone
    );
    const myNonSocietyProfiles = (nonSocietyRecords ?? []).filter(
      (ns) => phoneDigits(ns.phone_number) === inputPhone
    ) as NonSocietyUserRecord[];

    // =========================================================
    // 6. BUILD ROLES LIST
    // =========================================================
    const distinctRoles = new Set<string>();
    const addRole = (roleStr: string | null | undefined) => {
      if (!roleStr) return;
      
      const clean = roleStr.toLowerCase().replace(/_/g, " ").trim();
      
      // ✅ FIX: Explicitly exclude "visitor" from the roles switcher.
      // Residents don't switch to "Visitor" mode.
      if (clean === "visitor" || clean === "na" || clean === "null") return;

      const formatted = formatRoleForDisplay(roleStr);
      if (formatted) {
        distinctRoles.add(formatted);
      }
    };

    mySocietyProfiles.forEach((u) => parsePostgresArray(u.role).forEach(addRole));
    myNonSocietyProfiles.forEach((ns) => {
      if (ns.role) addRole(ns.role);
    });
    const rolesList = Array.from(distinctRoles);

    // =========================================================
    // 7. SELECT TARGET PROFILE
    // =========================================================
    const targetNormalized = normalizeRole(targetRole);

    const matchedSocietyUser = mySocietyProfiles.find((u) =>
      parsePostgresArray(u.role).map(normalizeRole).includes(targetNormalized)
    );
    const matchedNonSocietyUser = myNonSocietyProfiles.find(
      (ns) => normalizeRole(ns.role) === targetNormalized
    );

    const linkedSocietyUserId =
      matchedSocietyUser?.user_id ?? mySocietyProfiles[0]?.user_id ?? null;
    const linkedNonSocietyUserId =
      matchedNonSocietyUser?.non_society_user_id ??
      myNonSocietyProfiles[0]?.non_society_user_id ??
      null;

    // =========================================================
    // 8. BUILD USER DETAIL & METRICS
    // =========================================================
    let userDetail: any = null;

    if (matchedSocietyUser) {
      const [
        compTotal,
        compPending,
        compResolved,
        bookUpcoming,
        bookPending,
        bookConfirmed,
      ] = await Promise.all([
        supabase
          .from("SSP_Complaint")
          .select("*", { count: "exact", head: true })
          .eq("society_user", matchedSocietyUser.user_id)
          .ilike(
            "status",
            filters.complaintStatus ? String(filters.complaintStatus) : "%"
          ),
        supabase
          .from("SSP_Complaint")
          .select("*", { count: "exact", head: true })
          .eq("society_user", matchedSocietyUser.user_id)
          .ilike("status", "pending"),
        supabase
          .from("SSP_Complaint")
          .select("*", { count: "exact", head: true })
          .eq("society_user", matchedSocietyUser.user_id)
          .ilike("status", "resolved"),
        supabase
          .from("SSP_Facility_Booking_Request")
          .select("*", { count: "exact", head: true })
          .eq("requested_by", matchedSocietyUser.user_id)
          .gte("booking_start_date", new Date().toISOString())
          .ilike(
            "status",
            filters.bookingStatus ? String(filters.bookingStatus) : "%"
          ),
        supabase
          .from("SSP_Facility_Booking_Request")
          .select("*", { count: "exact", head: true })
          .eq("requested_by", matchedSocietyUser.user_id)
          .ilike("status", "waiting_payment"),
        supabase
          .from("SSP_Facility_Booking_Request")
          .select("*", { count: "exact", head: true })
          .eq("requested_by", matchedSocietyUser.user_id)
          .ilike("status", "approved"),
      ]);

      userDetail = {
        societyUserID: matchedSocietyUser.user_id,
        nonSocietyUserID: linkedNonSocietyUserId,
        vendorID: null,

        // ── Identity ──
        fullName: matchedSocietyUser.contact?.name ?? null,
        phone: matchedSocietyUser.contact?.phone ?? null,
        gender: matchedSocietyUser.contact?.gender ?? null,
        email: matchedSocietyUser.contact?.email ?? null,
        occupation: matchedSocietyUser.contact?.occupation ?? null,
        whatsappPhone: matchedSocietyUser.contact?.whatsapp_phone ?? null,
        emergencyPhone: matchedSocietyUser.contact?.emergency_phone ?? null,
        description: matchedSocietyUser.contact?.description ?? null,

        // ── ID proof ──
        idProofType: matchedSocietyUser.contact?.id_proof_type ?? null,
        idProofNumber: matchedSocietyUser.contact?.id_proof_number ?? null,

        // ── Vehicle ──
        vehicleType: matchedSocietyUser.contact?.vehicle_type ?? null,
        vehicleRegistrationNumber:
          matchedSocietyUser.contact?.vehicle_registration_number ?? null,

        // ── Role / residence ──
        role: formatRoleForDisplay(targetRole),
        flatNumber: matchedSocietyUser.unit_flat_number,
        tower: matchedSocietyUser.tower,
        block: matchedSocietyUser.block,
        status: matchedSocietyUser.status,
        ownership: matchedSocietyUser.user_ownership_type,
        userType: matchedSocietyUser.user_type,
        moveInDate: matchedSocietyUser.move_in_date,
        joiningDate: matchedSocietyUser.created_at,

        // ── Metrics ──
        myComplaints: {
          total: compTotal.count ?? 0,
          pending: compPending.count ?? 0,
          resolved: compResolved.count ?? 0,
        },
        myBookings: {
          totalUpcoming: bookUpcoming.count ?? 0,
          pending: bookPending.count ?? 0,
          confirmed: bookConfirmed.count ?? 0,
        },
      };
    } else if (matchedNonSocietyUser) {
      const { count: assignedComplaints } = await supabase
        .from("SSP_Complaint")
        .select("*", { count: "exact", head: true })
        .eq("non_society_user", matchedNonSocietyUser.non_society_user_id)
        .not("status", "ilike", "resolved");

      userDetail = {
        societyUserID: linkedSocietyUserId,
        nonSocietyUserID: matchedNonSocietyUser.non_society_user_id,
        vendorID:
          matchedNonSocietyUser.vendor_id ??
          matchedNonSocietyUser.non_society_user_id,

        // ── Identity ──
        fullName: matchedNonSocietyUser.name,
        phone: matchedNonSocietyUser.phone_number,
        gender: matchedNonSocietyUser.gender ?? null,
        email: matchedNonSocietyUser.email ?? null,
        occupation: null,
        whatsappPhone: null,
        emergencyPhone: null,
        description: null,

        // ── ID proof ──
        idProofType: matchedNonSocietyUser.id_proof_type ?? null,
        idProofNumber: matchedNonSocietyUser.id_proof_number ?? null,

        // ── Vehicle ──
        vehicleType: matchedNonSocietyUser.vehicle_type ?? null,
        vehicleRegistrationNumber: matchedNonSocietyUser.vehicle_number ?? null,

        // ── Role / vendor meta ──
        role: "Vendor",
        serviceType: matchedNonSocietyUser.service_type ?? null,
        vendorRating: matchedNonSocietyUser.vendor_rating ?? null,
        deliveryOrigin: matchedNonSocietyUser.delivery_origin ?? null,

        // ── No residence for vendors ──
        flatNumber: null,
        tower: null,
        block: null,
        status: true,
        ownership: null,
        userType: "Vendor",
        moveInDate: null,
        joiningDate: matchedNonSocietyUser.created_at,

        // ── Metrics ──
        myComplaints: {
          total: assignedComplaints ?? 0,
          pending: assignedComplaints ?? 0,
          resolved: 0,
        },
        myBookings: { totalUpcoming: 0, pending: 0, confirmed: 0 },
      };
    }

    // =========================================================
    // 9. ADMIN STATS, ALERTS, AGENT META
    // =========================================================
    const isAdmin = targetNormalized === "admin";
    let societyDetail = null;

    if (isAdmin) {
      const { data: allSocietyUsers } = await supabase
        .from("SSP_Society_User")
        .select("user_type, contact:contact(vehicle_type)")
        .eq("society", societyId);

      let ownersCount = 0,
        tenantsCount = 0,
        twoWheelers = 0,
        fourWheelers = 0;
      (allSocietyUsers ?? []).forEach((raw) => {
        const u = raw as any;
        const contact = unwrapOne(u.contact);
        const type = String(u.user_type ?? "").trim().toLowerCase();
        if (type === "owner") ownersCount++;
        if (type === "tenant") tenantsCount++;
        const vehicle = String(contact?.vehicle_type ?? "").trim().toLowerCase();
        if (vehicle.includes("two")) twoWheelers++;
        if (vehicle.includes("four")) fourWheelers++;
      });

      const totalUnits = Number(societyRecord.total_unit) || 0;
      const totalParking = Number(societyRecord.parking_slot) || 0;
      const occupiedFlats = ownersCount + tenantsCount;

      societyDetail = {
        name: societyRecord.society_name || "Unnamed Society",
        address: [societyRecord.address_line1, societyRecord.city]
          .filter(Boolean)
          .join(", "),
        subscriptionPlan: societyRecord.subscription_plan || null,
        totalFlats: totalUnits,
        occupiedFlats,
        vacantFlats: Math.max(0, totalUnits - occupiedFlats),
        owners: ownersCount,
        tenants: tenantsCount,
        twoWheelers,
        fourWheelers,
        vacantParkingSlots: Math.max(
          0,
          totalParking - (twoWheelers + fourWheelers)
        ),
      };
    } else {
      societyDetail = {
        name: societyRecord.society_name || "Unnamed Society",
        address: [societyRecord.address_line1, societyRecord.city]
          .filter(Boolean)
          .join(", "),
        subscriptionPlan: societyRecord.subscription_plan || null,
        totalFlats: null,
        occupiedFlats: null,
        vacantFlats: null,
        owners: null,
        tenants: null,
        twoWheelers: null,
        fourWheelers: null,
        vacantParkingSlots: null,
      };
    }

    const [alertsRes, totalAlertsRes] = await Promise.all([
      supabase
        .from("SSP_Alert")
        .select("title, message, type")
        .eq("society", societyId)
        .range(offset, offset + limitNum - 1),
      supabase
        .from("SSP_Alert")
        .select("*", { count: "exact", head: true })
        .eq("society", societyId),
    ]);

    const alerts = (alertsRes.data ?? []).map((al) => ({
      title: al.title,
      message: al.message,
      type: al.type,
    }));
    const totalAlerts = totalAlertsRes.count ?? 0;

    let serviceAgent = null;
    if (targetNormalized === "service agent") {
      const agentRecord = mySocietyProfiles.find((u) =>
        parsePostgresArray(u.role).map(normalizeRole).includes("service agent")
      );
      if (agentRecord?.contact) {
        serviceAgent = {
          agentId: agentRecord.user_id,
          name: agentRecord.contact.name,
          contactId: agentRecord.contact.contact_id,
          phoneNumber: agentRecord.contact.phone,
          agentAvailabilityStatus: agentRecord.agent_availability_status || null,
          agentServices: agentRecord.service_agent_services || null,
        };
      }
    }

    return new Response(
      JSON.stringify({
        matched: userDetail !== null,
        roles: rolesList,
        userDetail,
        societyDetail,
        alerts,
        serviceAgent,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalAlerts,
          totalPages: Math.ceil(totalAlerts / limitNum),
        },
        errorResponse: null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Fatal error";
    console.error("switch-user error:", message);
    return buildErrorResponse(
      "SERVER_ERROR",
      isProd ? "An internal error occurred." : `Execution Failure: ${message}`,
      500
    );
  }
});