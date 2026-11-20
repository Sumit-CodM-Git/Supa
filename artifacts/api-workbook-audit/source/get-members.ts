import { residentFlatTypeFields } from "../_shared/resident-flat-type.ts";
import { contactParkingSlot } from "../_shared/contact.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
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
    parkingSlot: string | null;
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
    createdAt: string | null;
}
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
    if (!arr)
        return null;
    if (Array.isArray(arr)) {
        return arr.length > 0 ? arr[0] : null;
    }
    return arr;
}
function parseRoleArray(role: any): string[] {
    if (Array.isArray(role))
        return role;
    if (typeof role === "string") {
        const cleaned = role.replace(/[{}"]/g, "");
        if (cleaned.includes(",")) {
            return cleaned.split(",").map((r: string) => r.trim()).filter(Boolean);
        }
        return [cleaned.trim()];
    }
    return [];
}
function isNonSocietyRole(role: string): boolean {
    const lower = role.toLowerCase();
    return lower === "vendor" || lower === "visitor";
}
function applySearchFilter(members: MemberResponse[], searchTerm: string): MemberResponse[] {
    if (!searchTerm)
        return members;
    const term = searchTerm.toLowerCase().trim();
    return members.filter((m) => m.fullName.toLowerCase().includes(term) ||
        m.phone.includes(term) ||
        m.email.toLowerCase().includes(term) ||
        m.unitFlatNumber.toLowerCase().includes(term) ||
        m.blockName.toLowerCase().includes(term) ||
        m.towerName.toLowerCase().includes(term) ||
        m.role.toLowerCase().includes(term) ||
        m.vehicleRegistrationNumber.toLowerCase().includes(term) ||
        m.idProofNumber.toLowerCase().includes(term));
}
function applyFilters(members: MemberResponse[], filters: {
    role?: string;
    flat?: string;
    block?: string;
    tower?: string;
    status?: string;
}): MemberResponse[] {
    let filtered = [...members];
    if (filters.role && filters.role !== "all") {
        filtered = filtered.filter((m) => m.role.toLowerCase() === filters.role!.toLowerCase());
    }
    if (filters.flat) {
        filtered = filtered.filter((m) => m.unitFlatNumber.toLowerCase() === filters.flat!.toLowerCase());
    }
    if (filters.block) {
        filtered = filtered.filter((m) => m.blockName.toLowerCase() === filters.block!.toLowerCase());
    }
    if (filters.tower) {
        filtered = filtered.filter((m) => m.towerName.toLowerCase() === filters.tower!.toLowerCase());
    }
    if (filters.status) {
        filtered = filtered.filter((m) => m.status.toLowerCase() === filters.status!.toLowerCase());
    }
    return filtered;
}
function applyPagination<T>(data: T[], page: number, limit: number): {
    items: T[];
    total: number;
} {
    const total = data.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const items = data.slice(start, end);
    return { items, total };
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const startTime = Date.now();
    try {
        console.log("📊 get-members called");
        console.log(`👤 Authenticated user: ${authCtx.user.id}`);
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }
        const body = await req.json().catch(() => null);
        if (!body) {
            return errorResponse("Request body is required.", 400);
        }
        const { registrationNumber, role, flat, block, tower, search, page, limit, status, } = body;
        if (!registrationNumber) {
            return errorResponse("registrationNumber is mandatory.", 400);
        }
        const regNum = String(registrationNumber).trim();
        const roleInput = role ? String(role).trim() : "all";
        const pageNum = Number(page) || 1;
        const limitNum = Math.min(Number(limit) || 20, 100);
        console.log(`🔍 Fetching members for society: ${regNum}`);
        console.log(`📄 Pagination: page=${pageNum}, limit=${limitNum}`);
        if (search)
            console.log(`🔎 Search: ${search}`);
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
            return errorResponse("Society not found for provided registration number.", 404);
        }
        const socId = society.society_id;
        let allMembers: MemberResponse[] = [];
        let resolvedBlockId: string | null = null;
        let resolvedTowerId: string | null = null;
        if (block) {
            const { data: blockData } = await supabaseAdmin
                .from("SSP_Block")
                .select("block_id")
                .eq("society", socId)
                .eq("block_name", String(block).trim())
                .maybeSingle();
            if (blockData)
                resolvedBlockId = blockData.block_id;
        }
        if (tower) {
            const { data: towerData } = await supabaseAdmin
                .from("SSP_Tower")
                .select("tower_id")
                .eq("society", socId)
                .eq("name", String(tower).trim())
                .maybeSingle();
            if (towerData)
                resolvedTowerId = towerData.tower_id;
        }
        const roleLower = roleInput.toLowerCase();
        if (roleLower === "all" || !isNonSocietyRole(roleLower)) {
            console.log("👥 Fetching society users...");
            let query = supabaseAdmin
                .from("SSP_Society_User")
                .select(`
                        user_id,
                        role,
                        created_at,
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
                        unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type),
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
                        SSP_Contact!left (parking_slot,
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
                .eq("society", socId)
                .is("deleted_at", null);
            if (flat)
                query = query.eq("unit_flat_number", String(flat).trim());
            if (resolvedBlockId)
                query = query.eq("block", resolvedBlockId);
            if (resolvedTowerId)
                query = query.eq("tower", resolvedTowerId);
            if (roleLower === "all") {
                query = query.not("role", "is", null);
            }
            else if (roleLower === "nonresident") {
                query = query.not("role", "cs", ["resident"]).not("role", "cs", [
                    "admin",
                ]);
            }
            else {
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
                    const contactData = firstOrNull<MemberContact>(su.SSP_Contact);
                    const blockData = firstOrNull<MemberBlock>(su.SSP_Block);
                    const towerData = firstOrNull<MemberTower>(su.SSP_Tower);
                    const roles = parseRoleArray(su.role);
                    for (const singleRole of roles) {
                        allMembers.push({
                            parkingSlot: contactParkingSlot(contactData),
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
                            ...residentFlatTypeFields(su),
                            unitFlatNumber: su.unit_flat_number || "NA",
                            userOwnershipType: su.user_ownership_type || "NA",
                            userType: su.user_type || "NA",
                            vendorName: null,
                            vendorServiceType: null,
                            fullName: contactData?.name || "NA",
                            phone: contactData?.phone || "NA",
                            email: contactData?.email || "NA",
                            whatsappPhone: contactData?.whatsapp_phone || "NA",
                            gender: contactData?.gender || "NA",
                            emergencyPhone: contactData?.emergency_phone || "NA",
                            occupation: contactData?.occupation || "NA",
                            vehicleType: contactData?.vehicle_type || "NA",
                            vehicleRegistrationNumber: contactData?.vehicle_registration_number || "NA",
                            idProofType: contactData?.id_proof_type || "NA",
                            idProofNumber: contactData?.id_proof_number || "NA",
                            contactId: contactData?.contact_id || "NA",
                            registrationNumber: society.registration_number || null,
                            vendorId: "NA",
                            vendorRating: "NA",
                            recordId: null,
                            createdAt: su.created_at || null,
                        });
                    }
                }
            }
        }
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
            }
            else {
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
                        parkingSlot: null,
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
                        createdAt: nsu.created_at || null,
                    });
                }
            }
        }
        console.log(`📊 Total members before filtering: ${allMembers.length}`);
        allMembers.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });
        const filters = {
            role: roleInput,
            flat: flat || undefined,
            block: block || undefined,
            tower: tower || undefined,
            status: status || undefined,
        };
        let filteredMembers = applyFilters(allMembers, filters);
        console.log(`📊 After filters: ${filteredMembers.length}`);
        if (search) {
            filteredMembers = applySearchFilter(filteredMembers, search);
            console.log(`📊 After search: ${filteredMembers.length}`);
        }
        const { items, total } = applyPagination(filteredMembers, pageNum, limitNum);
        console.log(`📄 Paginated: ${items.length} of ${total} (page ${pageNum}, limit ${limitNum})`);
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
    }
    catch (error: any) {
        console.error("❌ get-members error:", error);
        return new Response(JSON.stringify({
            success: false,
            error: "SERVER_ERROR",
            message: error.message || "Failed to fetch members",
            errorResponse: {
                errorCode: "SERVER_ERROR",
                message: error.message || "Failed to fetch members",
                timestamp: new Date().toISOString(),
            },
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
}));
