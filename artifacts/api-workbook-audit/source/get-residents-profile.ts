import { residentFlatTypeFields } from "../_shared/resident-flat-type.ts";
import { contactParkingSlot } from "../_shared/contact.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.48.0";
import { Validator } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
import { getEnv, parseRequestBody, sanitizeString, logger, ApiError, handleError, } from "../_shared/utils.ts";
interface ContactRecord {
    contact_id?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    whatsapp_phone?: string | null;
    gender?: string | null;
    emergency_phone?: string | null;
    occupation?: string | null;
    vehicle_type?: string | null;
    vehicle_registration_number?: string | null;
    id_proof_type?: string | null;
    id_proof_number?: string | null;
}
interface BlockRecord {
    block_name?: string | null;
}
interface TowerRecord {
    name?: string | null;
}
interface ResidentProfileRecord {
    flat_type_id?: string | null;
    flatTypeRecord?: {
        flat_type?: string | null;
    } | {
        flat_type?: string | null;
    }[] | null;
    user_id?: string | null;
    role?: string[] | string | null;
    user_type?: string | null;
    unit_flat_number?: string | null;
    user_ownership_type?: string | null;
    status?: boolean | null;
    contact?: ContactRecord | ContactRecord[] | null;
    SSP_Block?: BlockRecord | BlockRecord[] | null;
    SSP_Tower?: TowerRecord | TowerRecord[] | null;
}
interface SocietyContext {
    society_id: string;
    society_name?: string | null;
    address_line1?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
}
function buildProfile(record: ResidentProfileRecord, society: SocietyContext) {
    const rawContact = Array.isArray(record.contact) ? record.contact[0] : record.contact;
    const rawBlock = Array.isArray(record.SSP_Block) ? record.SSP_Block[0] : record.SSP_Block;
    const rawTower = Array.isArray(record.SSP_Tower) ? record.SSP_Tower[0] : record.SSP_Tower;
    const derivedSocietyName = society.society_name ?? "NA";
    const derivedCity = society.city ?? "NA";
    const derivedState = society.state ?? "NA";
    const derivedPincode = society.postal_code ?? "NA";
    return {
        userId: record.user_id ?? "NA",
        personalInformation: {
            parkingSlot: contactParkingSlot(rawContact),
            Name: String(rawContact?.name ?? "NA"),
            gender: String(rawContact?.gender ?? "NA"),
            occupation: String(rawContact?.occupation ?? "NA"),
            idProoftype: String(rawContact?.id_proof_type ?? "NA"),
            idProofNumber: String(rawContact?.id_proof_number ?? "NA"),
            vehicleType: String(rawContact?.vehicle_type ?? "NA"),
            vehicleRegistrationNumber: String(rawContact?.vehicle_registration_number ?? "NA"),
        },
        contactInformation: {
            parkingSlot: contactParkingSlot(rawContact),
            contactID: String(rawContact?.contact_id ?? "NA"),
            email: String(rawContact?.email ?? "NA"),
            phone: String(rawContact?.phone ?? "NA"),
            whatsAppPhone: String(rawContact?.whatsapp_phone ?? "NA"),
            emergencyPhone: String(rawContact?.emergency_phone ?? "NA"),
        },
        residentialInformation: {
            society: derivedSocietyName,
            ...residentFlatTypeFields(record),
            flatNumber: record.unit_flat_number ?? "NA",
            block: String(rawBlock?.block_name ?? "NA"),
            tower: String(rawTower?.name ?? "NA"),
            city: derivedCity,
            pincode: derivedPincode,
            state: derivedState,
            role: Array.isArray(record.role) ? record.role.join(", ") : (record.role ?? "NA"),
            userType: record.user_type ?? "NA",
            ownershipType: record.user_ownership_type ?? "NA",
            status: record.status ? "Active" : "Inactive",
        },
    };
}
function matchesRole(record: ResidentProfileRecord, wanted: string): boolean {
    const wantedLc = wanted.toLowerCase();
    const roleArray = Array.isArray(record.role)
        ? record.role.map((v) => String(v).toLowerCase())
        : record.role
            ? [String(record.role).toLowerCase()]
            : [];
    const userType = record.user_type ? String(record.user_type).toLowerCase() : "";
    return roleArray.includes(wantedLc) || userType === wantedLc;
}
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const action = "POST /get-residents-profile";
    try {
        const supabaseUrl = getEnv("SUPABASE_URL");
        const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
        }
        const token = authHeader.replace("Bearer ", "");
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authUser) {
            throw new ApiError("UNAUTHORIZED", "Invalid or expired session token", 401);
        }
        const body = await parseRequestBody(req);
        if (!body) {
            throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
        }
        const validator = new Validator();
        validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");
        validator.validateRequired(body.residentId, "residentId");
        if (!validator.isValid()) {
            throw new ApiError("BAD_REQUEST", "societyRegistrationNumber and residentId are mandatory.", 422, validator.getErrors());
        }
        const cleanRegNo = sanitizeString(String(body.societyRegistrationNumber));
        const cleanResidentId = sanitizeString(String(body.residentId));
        const roleInput = body.role ? sanitizeString(String(body.role)) : null;
        const url = new URL(req.url);
        const pageStr = url.searchParams.get("page") || "1";
        const limitStr = url.searchParams.get("limit") || "10";
        const pagination = sanitizePagination(pageStr, limitStr);
        const offset = (pagination.page - 1) * pagination.limit;
        logger.info({ message: `Starting execution for ${action}` });
        const { data: societyContext, error: socError } = await supabase
            .from("SSP_Society")
            .select("society_id, society_name, address_line1, city, state, postal_code")
            .eq("registration_number", cleanRegNo)
            .maybeSingle();
        if (socError) {
            throw new ApiError("SERVER_ERROR", `Society lookup failed: ${socError.message}`, 500);
        }
        if (!societyContext) {
            throw new ApiError("NOT_FOUND", "No society registration found matching the identifier provided.", 404);
        }
        let userQuery = supabase
            .from("SSP_Society_User")
            .select(`
        user_id, unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type), status, move_in_date, move_out_date, user_ownership_type, user_type, role,
        contact:SSP_Contact!inner(parking_slot,
          contact_id, name, phone, email, whatsapp_phone, gender, emergency_phone,
          occupation, vehicle_type, vehicle_registration_number, id_proof_type, id_proof_number
        ),
        SSP_Block!left ( block_name ),
        SSP_Tower!left ( name )
      `)
            .eq("society", societyContext.society_id);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(cleanResidentId)) {
            userQuery = userQuery.eq("user_id", cleanResidentId);
        }
        else {
            userQuery = userQuery.ilike("contact.name", `%${cleanResidentId}%`);
        }
        userQuery = userQuery.range(offset, offset + pagination.limit - 1);
        const { data: userRecords, error: userError } = await userQuery;
        if (userError) {
            throw new ApiError("SERVER_ERROR", `Society user lookup failed: ${userError.message}`, 500);
        }
        if (!userRecords || userRecords.length === 0) {
            throw new ApiError("NOT_FOUND", "No resident profile found for the provided details.", 404);
        }
        let filteredRecords = userRecords as ResidentProfileRecord[];
        if (roleInput) {
            filteredRecords = filteredRecords.filter((r) => matchesRole(r, roleInput));
        }
        if (filteredRecords.length === 0) {
            throw new ApiError("NOT_FOUND", `No resident profile matched the provided details with role "${roleInput}".`, 404);
        }
        const profiles = filteredRecords.map((r) => buildProfile(r, societyContext as SocietyContext));
        const responsePayload = {
            profiles,
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                retrievedRecords: userRecords.length,
                returnedProfiles: profiles.length,
            },
            errorResponse: null,
        };
        logger.info({ message: `Successfully completed ${action}` });
        return new Response(JSON.stringify(responsePayload), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    catch (err) {
        logger.error({ message: `Error executing ${action}`, details: String(err) });
        return handleError(err);
    }
});
