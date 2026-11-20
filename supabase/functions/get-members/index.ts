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
//     const { registrationNumber, role, flat, block, tower } = JSON.parse(bodyText);
//     if (!registrationNumber) {
//       return buildError('BAD_REQUEST', 'registrationNumber is mandatory.', 400, startTime);
//     }
//     const regNum = String(registrationNumber).trim();
//     const roleInput = role ? String(role).trim() : 'all';
//     // Fetch Parent Society
//     const { data: society, error: socErr } = await supabase.from('SSP_Society').select('society_id, registration_number,society_name').eq('registration_number', regNum).maybeSingle();
//     if (socErr) throw socErr;
//     if (!society) {
//       return buildError('NOT_FOUND', 'Society not found for provided registration number.', 404, startTime);
//     }
//     /*const socId = society.society_id
//     const contacts: ContactWrapper[] = []

//     const isNonSocietyRole = (r: string) => r.toLowerCase() === 'vendor' || r.toLowerCase() === 'visitor'
//     const roleLower = roleInput.toLowerCase()

//     // ================= BRANCH 1: SOCIETY USERS (MEMBERS) =================
//     if (roleLower === 'all' || !isNonSocietyRole(roleLower)) {
//       let query = supabase
//         .from('SSP_Society_User')
//         .select(`
//           user_id, role, agent_availability_status, service_agent_services,
//           move_in_date, security_guard_id, security_guard_status, security_zone,
//           service_agent_rating, shift, status, unit_flat_number, user_ownership_type, user_type,
//           SSP_Block!left ( block_name ),
//           SSP_Tower!left ( name ),
//           SSP_Contact!left ( name, phone, email, whatsapp_phone, gender, emergency_phone, occupation, vehicle_type, vehicle_registration_number, id_proof_type, id_proof_number, contact_id)
//         `)
//         .eq('society', socId)

//       if (flat) query = query.eq('unit_flat_number', String(flat).trim())
//       if (block) query = query.eq('SSP_Block.block_name', String(block).trim())
//       if (tower) query = query.eq('SSP_Tower.name', String(tower).trim())

//       // Replace the old role filter code block with this updated containment mapping:
// if (roleLower === 'all') {
//   query = query.not('role', 'is', null)
// } else if (roleLower === 'nonresident') {
//   // Use .not.contains() for array types
//   query = query.not('role', 'cs', ['Resident']).not('role', 'cs', ['admin'])
// } else {
//   // FIX HERE: Use .contains() to match a string inside a Postgres array layout
//   query = query.contains('role', [roleInput])
// }

//       const { data: socUsers, error: socUsersErr } = await query
//       if (socUsersErr) throw socUsersErr*/ const socId = society.society_id;
//     const contacts = [];
//     // =====================================================
//     // NEW: Resolve Block and Tower Text Names to UUIDs First
//     // =====================================================
//     let resolvedBlockId = null;
//     let resolvedTowerId = null;
//     if (block) {
//       const { data: blockData } = await supabase.from('SSP_Block').select('block_id').eq('society', socId).eq('block_name', String(block).trim()).maybeSingle();
//       if (blockData) resolvedBlockId = blockData.block_id;
//     }
//     if (tower) {
//       const { data: towerData } = await supabase.from('SSP_Tower').select('tower_id').eq('society', socId).eq('name', String(tower).trim()).maybeSingle();
//       if (towerData) resolvedTowerId = towerData.tower_id;
//     }
//     const isNonSocietyRole = (r)=>r.toLowerCase() === 'vendor' || r.toLowerCase() === 'visitor';
//     const roleLower = roleInput.toLowerCase();
//     // ================= BRANCH 1: SOCIETY USERS (MEMBERS) =================
//     if (roleLower === 'all' || !isNonSocietyRole(roleLower)) {
//       let query = supabase.from('SSP_Society_User').select(`
//           user_id, role, agent_availability_status, service_agent_services,
//           move_in_date,move_out_date,gate_number, security_guard_id, security_guard_status, security_zone,
//           service_agent_rating, shift, status, unit_flat_number, user_ownership_type, user_type,
//           SSP_Block!left ( block_name ),
//           SSP_Tower!left ( name ),
//           SSP_Contact!left ( name, phone, email, whatsapp_phone, gender, emergency_phone, occupation, vehicle_type, vehicle_registration_number, id_proof_type, id_proof_number, contact_id)
//         `).eq('society', socId);
//       // FIX: Filter by exact column parameters on the base table itself
//       if (flat) query = query.eq('unit_flat_number', String(flat).trim());
//       if (resolvedBlockId) query = query.eq('block', resolvedBlockId);
//       if (resolvedTowerId) query = query.eq('tower', resolvedTowerId);
//       if (roleLower === 'all') {
//         query = query.not('role', 'is', null);
//       } else if (roleLower === 'nonresident') {
//         query = query.not('role', 'cs', [
//           'Resident'
//         ]).not('role', 'cs', [
//           'admin'
//         ]);
//       } else {
//         query = query.contains('role', [
//           roleInput
//         ]);
//       }
//       const { data: socUsers, error: socUsersErr } = await query;
//       if (socUsersErr) throw socUsersErr;
//       /* if (socUsers) {
//         for (const su of socUsers) {
//           const contactObj = Array.isArray(su.SSP_Contact) ? su.SSP_Contact[0] : su.SSP_Contact
//           const blockObj = Array.isArray(su.SSP_Block) ? su.SSP_Block[0] : su.SSP_Block
//           const towerObj = Array.isArray(su.SSP_Tower) ? su.SSP_Tower[0] : su.SSP_Tower

//           contacts.push({
//             societyName: su.user_id ?? 'NA',
//             role: Array.isArray(su.role) ? su.role.join(', ') : (su.role ?? 'NA'),
//             agentAvailabilityStatus: su.agent_availability_status ?? 'NA',
//             serviceAgentServices: su.service_agent_services ?? 'NA',
//             blockName: blockObj?.block_name ?? 'NA',
//             moveInDate: su.move_in_date ?? null,
//             securityGuardId: su.security_guard_id ?? 'NA',
//             securityGuardStatus: su.security_guard_status ?? 'NA',
//             securityZone: su.security_zone ?? 'NA',
//             serviceAgentRating: su.service_agent_rating ? String(su.service_agent_rating) : 'NA',
//             shift: su.shift ?? 'NA',
//             status: su.status ? 'Active' : 'Inactive',
//             towerName: towerObj?.name ?? 'NA',
//             unitFlatNumber: su.unit_flat_number ?? 'NA',
//             userOwnershipType: su.user_ownership_type ?? 'NA',
//             userType: su.user_type ?? 'NA',
//             vendorName: null,
//             vendorServiceType: null,
//             fullName: contactObj?.name ?? 'NA',
//             phone: contactObj?.phone ?? 'NA',
//             email: contactObj?.email ?? 'NA',
//             whatsappPhone: contactObj?.whatsapp_phone ?? 'NA',
//             gender: contactObj?.gender ?? 'NA',
//             emergencyPhone: contactObj?.emergency_phone ?? 'NA',
//             occupation: contactObj?.occupation ?? 'NA',
//             vehicleType: contactObj?.vehicle_type ?? 'NA',
//             vehicleRegistrationNumber: contactObj?.vehicle_registration_number ?? 'NA',
//             idProofType: contactObj?.id_proof_type ?? 'NA',
//             idProofNumber: contactObj?.id_proof_number ?? 'NA',
//             contactId: contactObj?.contact_id_custom ?? 'NA',
//             societyId: society.registration_number ?? null,
//             vendorId: 'NA',
//             recordId: null,
//           })
//         }
//       }*/ if (socUsers) {
//         for (const su of socUsers){
//           const contactObj = Array.isArray(su.SSP_Contact) ? su.SSP_Contact[0] : su.SSP_Contact;
//           const blockObj = Array.isArray(su.SSP_Block) ? su.SSP_Block[0] : su.SSP_Block;
//           const towerObj = Array.isArray(su.SSP_Tower) ? su.SSP_Tower[0] : su.SSP_Tower;
//           // Convert Postgres text[] to JS array
//           const roles = Array.isArray(su.role) ? su.role : String(su.role ?? "").replace(/[{}]/g, "").split(",").map((r)=>r.trim()).filter(Boolean);
//           // One response object per role
//           for (const singleRole of roles){
//             contacts.push({
//               societyName: society.society_name,
//               role: singleRole,
//               agentAvailabilityStatus: su.agent_availability_status ?? "NA",
//               serviceAgentServices: su.service_agent_services ?? "NA",
//               blockName: blockObj?.block_name ?? "NA",
//               moveInDate: su.move_in_date ?? null,
//               moveOutDate: su.move_out_date ?? null,
//               gateNumber: su.gate_number ?? null,
//               securityGuardId: su.security_guard_id ?? "NA",
//               securityGuardStatus: su.security_guard_status ?? "NA",
//               securityZone: su.security_zone ?? "NA",
//               serviceAgentRating: su.service_agent_rating != null ? String(su.service_agent_rating) : "NA",
//               shift: su.shift ?? "NA",
//               status: su.status ? "Active" : "Inactive",
//               towerName: towerObj?.name ?? "NA",
//               unitFlatNumber: su.unit_flat_number ?? "NA",
//               userOwnershipType: su.user_ownership_type ?? "NA",
//               userType: su.user_type ?? "NA",
//               vendorName: null,
//               vendorServiceType: null,
//               fullName: contactObj?.name ?? "NA",
//               phone: contactObj?.phone ?? "NA",
//               email: contactObj?.email ?? "NA",
//               whatsappPhone: contactObj?.whatsapp_phone ?? "NA",
//               gender: contactObj?.gender ?? "NA",
//               emergencyPhone: contactObj?.emergency_phone ?? "NA",
//               occupation: contactObj?.occupation ?? "NA",
//               vehicleType: contactObj?.vehicle_type ?? "NA",
//               vehicleRegistrationNumber: contactObj?.vehicle_registration_number ?? "NA",
//               idProofType: contactObj?.id_proof_type ?? "NA",
//               idProofNumber: contactObj?.id_proof_number ?? "NA",
//               contactId: contactObj?.contact_id ?? "NA",
//               memberId: su.user_id,
//               societyId: society.registration_number,
//               vendorId: "NA",
//               vendorRating: "NA",
//               recordId: null
//             });
//           }
//         }
//       }
//     }
//     // ================= BRANCH 2: NON-SOCIETY USERS (VENDORS/VISITORS) =================
//     // FIX: Removed invalid relationship join tracking path to SSP_Contact entirely
//     if (roleLower === 'all' || isNonSocietyRole(roleLower)) {
//       let query = supabase.from('SSP_Non_Society_User').select(`
//           non_society_user_id, name, role,vendor_id, service_type, id_proof_number, id_proof_type, email, phone_number,
//           vendor_rating
//         `).eq('society', socId);
//       if (roleLower === 'all') {
//         query = query.neq('role', 'Visitor');
//       } else {
//         query = query.eq('role', roleInput);
//       }
//       const { data: nonSocUsers, error: nonSocErr } = await query;
//       if (nonSocErr) throw nonSocErr;
//       if (nonSocUsers) {
//         for (const nsu of nonSocUsers){
//           contacts.push({
//             societyName: 'NA',
//             memberId: "NA",
//             role: nsu.role ?? 'NA',
//             agentAvailabilityStatus: 'NA',
//             serviceAgentServices: 'NA',
//             blockName: 'NA',
//             moveInDate: null,
//             moveOutDate: null,
//             securityGuardId: 'NA',
//             securityGuardStatus: 'NA',
//             securityZone: 'NA',
//             serviceAgentRating: 'NA',
//             shift: 'NA',
//             status: 'Active',
//             towerName: 'NA',
//             unitFlatNumber: 'NA',
//             gateNumber: 'NA',
//             userOwnershipType: 'NA',
//             userType: 'NA',
//             vendorName: nsu.name ?? null,
//             vendorServiceType: nsu.service_type ?? 'NA',
//             fullName: nsu.name ?? 'NA',
//             phone: nsu.phone_number ?? 'NA',
//             email: nsu.email ?? 'NA',
//             whatsappPhone: 'NA',
//             gender: 'NA',
//             emergencyPhone: 'NA',
//             occupation: 'NA',
//             vehicleType: 'NA',
//             vehicleRegistrationNumber: 'NA',
//             idProofType: nsu.id_proof_type ?? 'NA',
//             idProofNumber: nsu.id_proof_number ?? 'NA',
//             contactId: 'NA',
//             societyId: society.registration_number ?? null,
//             vendorId: nsu.vendor_id ?? 'NA',
//             vendorRating: nsu.vendor_rating ?? 'NA',
//             recordId: nsu.non_society_user_id
//           });
//         }
//       }
//     }
//     console.log(`Executed Member Fetch Processing Chain cleanly in ${Date.now() - startTime}ms`);
//     return new Response(JSON.stringify({
//       errorResponse: null,
//       contacts
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (error) {
//     return buildError('SERVER_ERROR', `Unable to fetch members: ${error.message || 'Fatal system fallback error logged.'}`, 500, startTime);
//   }
// });
// function buildError(code, msg, status, start) {
//   return new Response(JSON.stringify({
//     contacts: [],
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

// ============================================
// get-members - Fetch Members with Pagination, Search & Filters
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================
interface GetMembersRequest {
  registrationNumber: string;
  role?: string;
  flat?: string;
  block?: string;
  tower?: string;
  search?: string;
  page?: number;
  limit?: number;
  status?: string;
}

interface MemberContact {
  contact_id: string;
  name: string;
  phone: string;
  email: string;
  whatsapp_phone: string;
  gender: string;
  emergency_phone: string;
  occupation: string;
  vehicle_type: string;
  vehicle_registration_number: string;
  id_proof_type: string;
  id_proof_number: string;
}

interface MemberBlock {
  block_id: string;
  block_name: string;
}

interface MemberTower {
  tower_id: string;
  name: string;
}

interface MemberResponse {
  societyName: string;
  memberId: string;
  role: string;
  agentAvailabilityStatus: string;
  serviceAgentServices: string;
  blockName: string;
  moveInDate: string | null;
  moveOutDate: string | null;
  gateNumber: string | null;
  securityGuardId: string;
  securityGuardStatus: string;
  securityZone: string;
  serviceAgentRating: string;
  shift: string;
  status: string;
  towerName: string;
  unitFlatNumber: string;
  userOwnershipType: string;
  userType: string;
  vendorName: string | null;
  vendorServiceType: string | null;
  fullName: string;
  phone: string;
  email: string;
  whatsappPhone: string;
  gender: string;
  emergencyPhone: string;
  occupation: string;
  vehicleType: string;
  vehicleRegistrationNumber: string;
  idProofType: string;
  idProofNumber: string;
  contactId: string;
  registrationNumber: string | null;
  vendorId: string;
  vendorRating: string;
  recordId: string | null;
}

// ============================================
// HELPER: Extract first item from array or return null
// ============================================
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) {
    return arr.length > 0 ? arr[0] : null;
  }
  return arr;
}

// ============================================
// HELPER: Parse Postgres Array to JS Array
// ============================================
function parseRoleArray(role: any): string[] {
  if (Array.isArray(role)) return role;
  if (typeof role === "string") {
    const cleaned = role.replace(/[{}"]/g, "");
    if (cleaned.includes(",")) {
      return cleaned.split(",").map((r: string) => r.trim()).filter(Boolean);
    }
    return [cleaned.trim()];
  }
  return [];
}

// ============================================
// HELPER: Check if role is non-society
// ============================================
function isNonSocietyRole(role: string): boolean {
  const lower = role.toLowerCase();
  return lower === "vendor" || lower === "visitor";
}

// ============================================
// HELPER: Apply search filter to data
// ============================================
function applySearchFilter(
  members: MemberResponse[],
  searchTerm: string,
): MemberResponse[] {
  if (!searchTerm) return members;

  const term = searchTerm.toLowerCase().trim();
  return members.filter((m) =>
    m.fullName.toLowerCase().includes(term) ||
    m.phone.includes(term) ||
    m.email.toLowerCase().includes(term) ||
    m.unitFlatNumber.toLowerCase().includes(term) ||
    m.blockName.toLowerCase().includes(term) ||
    m.towerName.toLowerCase().includes(term) ||
    m.role.toLowerCase().includes(term) ||
    m.vehicleRegistrationNumber.toLowerCase().includes(term) ||
    m.idProofNumber.toLowerCase().includes(term)
  );
}

// ============================================
// HELPER: Apply filters to data
// ============================================
function applyFilters(members: MemberResponse[], filters: {
  role?: string;
  flat?: string;
  block?: string;
  tower?: string;
  status?: string;
}): MemberResponse[] {
  let filtered = [...members];

  if (filters.role && filters.role !== "all") {
    filtered = filtered.filter((m) =>
      m.role.toLowerCase() === filters.role!.toLowerCase()
    );
  }

  if (filters.flat) {
    filtered = filtered.filter((m) =>
      m.unitFlatNumber.toLowerCase() === filters.flat!.toLowerCase()
    );
  }

  if (filters.block) {
    filtered = filtered.filter((m) =>
      m.blockName.toLowerCase() === filters.block!.toLowerCase()
    );
  }

  if (filters.tower) {
    filtered = filtered.filter((m) =>
      m.towerName.toLowerCase() === filters.tower!.toLowerCase()
    );
  }

  if (filters.status) {
    filtered = filtered.filter((m) =>
      m.status.toLowerCase() === filters.status!.toLowerCase()
    );
  }

  return filtered;
}

// ============================================
// HELPER: Apply pagination to data
// ============================================
function applyPagination<T>(
  data: T[],
  page: number,
  limit: number,
): { items: T[]; total: number } {
  const total = data.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const items = data.slice(start, end);
  return { items, total };
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      console.log("📊 get-members called");
      console.log(`👤 Authenticated user: ${authCtx.user.id}`);

      // Only allow POST method
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      // Parse request body
      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const {
        registrationNumber,
        role,
        flat,
        block,
        tower,
        search,
        page,
        limit,
        status,
      } = body;

      // Validate required fields
      if (!registrationNumber) {
        return errorResponse("registrationNumber is mandatory.", 400);
      }

      const regNum = String(registrationNumber).trim();
      const roleInput = role ? String(role).trim() : "all";

      // Pagination params (with defaults)
      const pageNum = Number(page) || 1;
      const limitNum = Math.min(Number(limit) || 20, 100); // Max 100 per page

      console.log(`🔍 Fetching members for society: ${regNum}`);
      console.log(`📄 Pagination: page=${pageNum}, limit=${limitNum}`);
      if (search) console.log(`🔎 Search: ${search}`);

      // ============================================
      // STEP 1: Get Society
      // ============================================
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number, society_name")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        console.error("❌ Society fetch error:", socErr);
        return errorResponse("Failed to fetch society data.", 500);
      }

      if (!society) {
        return errorResponse(
          "Society not found for provided registration number.",
          404,
        );
      }

      const socId = society.society_id;
      let allMembers: MemberResponse[] = [];

      // ============================================
      // STEP 2: Resolve Block and Tower to UUIDs
      // ============================================
      let resolvedBlockId: string | null = null;
      let resolvedTowerId: string | null = null;

      if (block) {
        const { data: blockData } = await supabaseAdmin
          .from("SSP_Block")
          .select("block_id")
          .eq("society", socId)
          .eq("block_name", String(block).trim())
          .maybeSingle();
        if (blockData) resolvedBlockId = blockData.block_id;
      }

      if (tower) {
        const { data: towerData } = await supabaseAdmin
          .from("SSP_Tower")
          .select("tower_id")
          .eq("society", socId)
          .eq("name", String(tower).trim())
          .maybeSingle();
        if (towerData) resolvedTowerId = towerData.tower_id;
      }

      const roleLower = roleInput.toLowerCase();

      // ============================================
      // STEP 3: Fetch Society Users (Members)
      // ============================================
      if (roleLower === "all" || !isNonSocietyRole(roleLower)) {
        console.log("👥 Fetching society users...");

        let query = supabaseAdmin
          .from("SSP_Society_User")
          .select(`
                        user_id,
                        role,
                        agent_availability_status,
                        service_agent_services,
                        move_in_date,
                        move_out_date,
                        gate_number,
                        security_guard_id,
                        security_guard_status,
                        security_zone,
                        service_agent_rating,
                        shift,
                        status,
                        unit_flat_number,
                        user_ownership_type,
                        user_type,
                        SSP_Block!left (
                            block_id,
                            block_name
                        ),
                        SSP_Tower!left (
                            tower_id,
                            name
                        ),
                        SSP_Contact!left (
                            contact_id,
                            name,
                            phone,
                            email,
                            whatsapp_phone,
                            gender,
                            emergency_phone,
                            occupation,
                            vehicle_type,
                            vehicle_registration_number,
                            id_proof_type,
                            id_proof_number
                        )
                    `)
          .eq("society", socId);

        // Apply filters
        if (flat) query = query.eq("unit_flat_number", String(flat).trim());
        if (resolvedBlockId) query = query.eq("block", resolvedBlockId);
        if (resolvedTowerId) query = query.eq("tower", resolvedTowerId);

        // Role filtering
        if (roleLower === "all") {
          query = query.not("role", "is", null);
        } else if (roleLower === "nonresident") {
          query = query.not("role", "cs", ["resident"]).not("role", "cs", [
            "admin",
          ]);
        } else {
          query = query.contains("role", [roleInput]);
        }

        const { data: socUsers, error: socUsersErr } = await query;

        if (socUsersErr) {
          console.error("❌ Society users fetch error:", socUsersErr);
          throw socUsersErr;
        }

        if (socUsers && socUsers.length > 0) {
          console.log(`✅ Found ${socUsers.length} society users`);

          for (const su of socUsers) {
            // Extract contact data - properly handle array or object
            const contactData = firstOrNull<MemberContact>(su.SSP_Contact);
            const blockData = firstOrNull<MemberBlock>(su.SSP_Block);
            const towerData = firstOrNull<MemberTower>(su.SSP_Tower);

            const roles = parseRoleArray(su.role);

            for (const singleRole of roles) {
              allMembers.push({
                societyName: society.society_name || "NA",
                memberId: su.user_id || "NA",
                role: singleRole,
                agentAvailabilityStatus: su.agent_availability_status || "NA",
                serviceAgentServices: su.service_agent_services || "NA",
                blockName: blockData?.block_name || "NA",
                moveInDate: su.move_in_date || null,
                moveOutDate: su.move_out_date || null,
                gateNumber: su.gate_number || null,
                securityGuardId: su.security_guard_id || "NA",
                securityGuardStatus: su.security_guard_status || "NA",
                securityZone: su.security_zone || "NA",
                serviceAgentRating: su.service_agent_rating != null
                  ? String(su.service_agent_rating)
                  : "NA",
                shift: su.shift || "NA",
                status: su.status ? "active" : "inactive",
                towerName: towerData?.name || "NA",
                unitFlatNumber: su.unit_flat_number || "NA",
                userOwnershipType: su.user_ownership_type || "NA",
                userType: su.user_type || "NA",
                vendorName: null,
                vendorServiceType: null,
                // ✅ Contact fields - properly extracted
                fullName: contactData?.name || "NA",
                phone: contactData?.phone || "NA",
                email: contactData?.email || "NA",
                whatsappPhone: contactData?.whatsapp_phone || "NA",
                gender: contactData?.gender || "NA",
                emergencyPhone: contactData?.emergency_phone || "NA",
                occupation: contactData?.occupation || "NA",
                vehicleType: contactData?.vehicle_type || "NA",
                vehicleRegistrationNumber:
                  contactData?.vehicle_registration_number || "NA",
                idProofType: contactData?.id_proof_type || "NA",
                idProofNumber: contactData?.id_proof_number || "NA",
                contactId: contactData?.contact_id || "NA",
                registrationNumber: society.registration_number || null,
                vendorId: "NA",
                vendorRating: "NA",
                recordId: null,
              });
            }
          }
        }
      }

      // ============================================
      // STEP 4: Fetch Non-Society Users (Vendors/Visitors)
      // ============================================
      if (roleLower === "all" || isNonSocietyRole(roleLower)) {
        console.log("👤 Fetching non-society users...");

        let query = supabaseAdmin
          .from("SSP_Non_Society_User")
          .select(`
                        non_society_user_id,
                        name,
                        role,
                        vendor_id,
                        service_type,
                        id_proof_number,
                        id_proof_type,
                        email,
                        phone_number,
                        vendor_rating,
                        gender,
                        gate_no,
                        vehicle_number,
                        vehicle_type,
                        delivery_origin,
                        purpose,
                        check_in,
                        check_out,
                        pre_approved,
                        is_recurring,
                        recurring_days,
                        visitor_approval_status,
                        visitor_status,
                        verification_pin,
                        created_at
                    `)
          .eq("society", socId);

        if (roleLower === "all") {
          query = query.neq("role", "visitor");
        } else {
          query = query.eq("role", roleInput);
        }

        const { data: nonSocUsers, error: nonSocErr } = await query;

        if (nonSocErr) {
          console.error("❌ Non-society users fetch error:", nonSocErr);
          throw nonSocErr;
        }

        if (nonSocUsers && nonSocUsers.length > 0) {
          console.log(`✅ Found ${nonSocUsers.length} non-society users`);

          for (const nsu of nonSocUsers) {
            allMembers.push({
              societyName: "NA",
              memberId: "NA",
              role: nsu.role || "NA",
              agentAvailabilityStatus: "NA",
              serviceAgentServices: "NA",
              blockName: "NA",
              moveInDate: null,
              moveOutDate: null,
              gateNumber: nsu.gate_no || null,
              securityGuardId: "NA",
              securityGuardStatus: "NA",
              securityZone: "NA",
              serviceAgentRating: "NA",
              shift: "NA",
              status: "active",
              towerName: "NA",
              unitFlatNumber: "NA",
              userOwnershipType: "NA",
              userType: "NA",
              vendorName: nsu.name || null,
              vendorServiceType: nsu.service_type || "NA",
              fullName: nsu.name || "NA",
              phone: nsu.phone_number || "NA",
              email: nsu.email || "NA",
              whatsappPhone: "NA",
              gender: nsu.gender || "NA",
              emergencyPhone: "NA",
              occupation: "NA",
              vehicleType: nsu.vehicle_type || "NA",
              vehicleRegistrationNumber: nsu.vehicle_number || "NA",
              idProofType: nsu.id_proof_type || "NA",
              idProofNumber: nsu.id_proof_number || "NA",
              contactId: "NA",
              registrationNumber: society.registration_number || null,
              vendorId: nsu.vendor_id || "NA",
              vendorRating: nsu.vendor_rating || "NA",
              recordId: nsu.non_society_user_id,
            });
          }
        }
      }

      console.log(`📊 Total members before filtering: ${allMembers.length}`);

      // ============================================
      // STEP 5: Apply Filters (Client-side)
      // ============================================
      const filters = {
        role: roleInput,
        flat: flat || undefined,
        block: block || undefined,
        tower: tower || undefined,
        status: status || undefined,
      };

      let filteredMembers = applyFilters(allMembers, filters);
      console.log(`📊 After filters: ${filteredMembers.length}`);

      // ============================================
      // STEP 6: Apply Search (Client-side)
      // ============================================
      if (search) {
        filteredMembers = applySearchFilter(filteredMembers, search);
        console.log(`📊 After search: ${filteredMembers.length}`);
      }

      // ============================================
      // STEP 7: Apply Pagination
      // ============================================
      const { items, total } = applyPagination(
        filteredMembers,
        pageNum,
        limitNum,
      );
      console.log(
        `📄 Paginated: ${items.length} of ${total} (page ${pageNum}, limit ${limitNum})`,
      );

      // ============================================
      // STEP 8: Return Response with Pagination
      // ============================================
      return successResponse({
        total: total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        members: items,
        filters: {
          role: filters.role,
          flat: filters.flat || null,
          block: filters.block || null,
          tower: filters.tower || null,
          status: filters.status || null,
        },
        search: search || null,
      });
    } catch (error: any) {
      console.error("❌ get-members error:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: "SERVER_ERROR",
          message: error.message || "Failed to fetch members",
          errorResponse: {
            errorCode: "SERVER_ERROR",
            message: error.message || "Failed to fetch members",
            timestamp: new Date().toISOString(),
          },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  }),
);
