import { resolveResidentFlatType, residentFlatTypeFields, ResidentFlatTypeError } from "../_shared/resident-flat-type.ts";
import { normalizeParkingSlot } from "../_shared/contact.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
const ALLOWED_USER_TYPES = ["owner", "tenant"] as const;
const ALLOWED_OWNERSHIP_TYPES = ["primary", "secondary"] as const;
const ALLOWED_ROLES = ["admin", "resident", "security", "service_agent"] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_CHECK_VIOLATION = "23514";
const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION = "23503";
const PG_INVALID_INPUT = "22P02";
const PGRST_MULTIPLE_ROWS = "PGRST116";
interface UpdateMemberRequest {
    memberId: string;
    updatedData: {
        flatTypeId?: string | null;
        flatType?: string | null;
        vendorName?: string;
        vendorServiceType?: string;
        vendorRating?: number | string;
        vendorId?: string;
        name?: string;
        phoneNumber?: string;
        serviceType?: string;
        vehicleNumber?: string;
        fullName?: string;
        parkingSlot?: string | null;
        parking_slot?: string | null;
        phone?: string;
        email?: string;
        gender?: string;
        occupation?: string;
        idProofType?: string;
        idProofNumber?: string;
        whatsappPhone?: string;
        emergencyPhone?: string;
        vehicleType?: string;
        vehicleRegistrationNumber?: string;
        blockName?: string;
        towerName?: string;
        unitFlatNumber?: string;
        userType?: string;
        userOwnershipType?: string;
        status?: string | boolean;
        moveInDate?: string;
        moveOutDate?: string;
        shift?: string;
        securityZone?: string;
        securityGuardStatus?: string;
        gateNumber?: string;
        securityGuardId?: string;
        serviceAgentRating?: number | string;
        agentAvailabilityStatus?: string;
        serviceAgentServices?: string[] | string;
        role?: string[] | string;
    };
}
class ValidationError extends Error {
    constructor(message: string, public field?: string) {
        super(message);
        this.name = "ValidationError";
    }
}
const isUUID = (str: string): boolean => UUID_REGEX.test(str);
function coerceOptional(value: unknown): string | number | boolean | null | undefined {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    }
    return value as string | number | boolean;
}
function normalizeEnum(value: unknown, allowed: readonly string[], fieldName: string): string | null | undefined {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    const s = String(value).trim();
    if (s === "")
        return null;
    const lower = s.toLowerCase();
    const match = allowed.find((a) => a.toLowerCase() === lower);
    if (!match) {
        throw new ValidationError(`Invalid ${fieldName} "${s}". Allowed values: ${allowed.join(", ")}.`, fieldName);
    }
    return match;
}
function parseStatus(value: unknown): boolean | null | undefined {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value === "boolean")
        return value;
    const s = String(value).trim().toLowerCase();
    if (s === "" || s === "null")
        return null;
    if (s === "true" || s === "active")
        return true;
    if (s === "false" || s === "inactive")
        return false;
    throw new ValidationError(`Invalid status "${value}". Use true/false/active/inactive.`, "status");
}
function autoFixSwappedTypes(userType: unknown, ownershipType: unknown): {
    userType: unknown;
    ownershipType: unknown;
    swapped: boolean;
} {
    if (userType === undefined || ownershipType === undefined) {
        return { userType, ownershipType, swapped: false };
    }
    const uType = String(userType ?? "").trim().toLowerCase();
    const uOwn = String(ownershipType ?? "").trim().toLowerCase();
    if (!uType || !uOwn)
        return { userType, ownershipType, swapped: false };
    const userTypeIsOwnershipValue = ALLOWED_OWNERSHIP_TYPES.map((v) => v.toLowerCase()).includes(uType);
    const ownershipIsUserTypeValue = ALLOWED_USER_TYPES.map((v) => v.toLowerCase()).includes(uOwn);
    if (userTypeIsOwnershipValue && ownershipIsUserTypeValue) {
        console.warn(`⚠️ SWAP DETECTED in update-member: userType="${userType}" ` +
            `userOwnershipType="${ownershipType}" — swapping before save. ` +
            `Fix the frontend to send these correctly.`);
        return { userType: ownershipType, ownershipType: userType, swapped: true };
    }
    return { userType, ownershipType, swapped: false };
}
async function resolveBlockId(supabaseAdmin: any, blockInput: string, societyId: string): Promise<string | null> {
    if (!blockInput || blockInput.trim() === "")
        return null;
    if (!societyId) {
        throw new ValidationError("Society context is required to resolve block.", "blockName");
    }
    const blockVal = blockInput.trim();
    if (isUUID(blockVal))
        return blockVal;
    const { data: blocks, error: blockErr } = await supabaseAdmin
        .from("SSP_Block")
        .select("block_id")
        .ilike("block_name", blockVal)
        .eq("society", societyId)
        .limit(1);
    if (blockErr)
        throw new Error(`Failed to resolve block: ${blockErr.message}`);
    const blockMatch = blocks?.[0];
    if (!blockMatch) {
        throw new ValidationError(`Block '${blockVal}' not found in this society.`, "blockName");
    }
    return blockMatch.block_id;
}
async function resolveTowerId(supabaseAdmin: any, towerInput: string, societyId: string): Promise<string | null> {
    if (!towerInput || towerInput.trim() === "")
        return null;
    if (!societyId) {
        throw new ValidationError("Society context is required to resolve tower.", "towerName");
    }
    const towerVal = towerInput.trim();
    if (isUUID(towerVal))
        return towerVal;
    const { data: towers, error: towerErr } = await supabaseAdmin
        .from("SSP_Tower")
        .select("tower_id")
        .ilike("name", towerVal)
        .eq("society", societyId)
        .limit(1);
    if (towerErr)
        throw new Error(`Failed to resolve tower: ${towerErr.message}`);
    const towerMatch = towers?.[0];
    if (!towerMatch) {
        throw new ValidationError(`Tower '${towerVal}' not found in this society.`, "towerName");
    }
    return towerMatch.tower_id;
}
function buildUpdateErrorResponse(code: string, message: string, status: number, startTime: number, field?: string): Response {
    console.error(`❌ [${code}] ${message}${field ? ` (field=${field})` : ""} ` +
        `(${Date.now() - startTime}ms)`);
    return new Response(JSON.stringify({
        success: false,
        error: code,
        message,
        updateMember: null,
        errorResponse: {
            errorCode: code,
            message,
            field: field ?? null,
            timestamp: new Date().toISOString(),
        },
    }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function mapPgError(err: any): {
    code: string;
    status: number;
    message: string;
    field?: string;
} | null {
    if (!err?.code)
        return null;
    switch (err.code) {
        case PG_CHECK_VIOLATION: {
            const m = /check constraint "([^"]+)"/.exec(String(err.message ?? ""));
            const constraint = m?.[1] ?? "unknown";
            const hints: Record<string, string> = {
                chk_user_type: "userType must be 'owner' or 'tenant'.",
                chk_society_user_role: "role contains an invalid value.",
            };
            return {
                code: "INVALID_PARAMETERS",
                status: 400,
                message: hints[constraint] ??
                    `Invalid value for a required field (constraint: ${constraint}).`,
            };
        }
        case PG_UNIQUE_VIOLATION: {
            const m = /constraint "([^"]+)"/.exec(String(err.message ?? ""));
            const constraint = m?.[1] ?? "unique";
            const hints: Record<string, string> = {
                uq_one_primary_per_flat: "Another primary owner already exists for this flat.",
                uq_society_user_idempotency: "Duplicate request detected.",
            };
            return {
                code: "CONFLICT",
                status: 409,
                message: hints[constraint] ??
                    `Conflict: ${err.details ?? err.message ?? "duplicate or constraint violation"}`,
            };
        }
        case PG_FK_VIOLATION:
            return {
                code: "INVALID_PARAMETERS",
                status: 400,
                message: `Referenced record does not exist: ${err.details ?? err.message}`,
            };
        case PG_INVALID_INPUT:
            return {
                code: "INVALID_PARAMETERS",
                status: 400,
                message: `Invalid input format: ${err.message}`,
            };
        case PGRST_MULTIPLE_ROWS:
            return {
                code: "DATABASE_ERROR",
                status: 500,
                message: "A unique lookup returned more than one row.",
            };
        default:
            return null;
    }
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const startTime = Date.now();
    try {
        console.log("📝 update-member called");
        console.log(`👤 Authenticated user: ${authCtx.user.id}`);
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }
        const body = await parseRequestBody<UpdateMemberRequest>(req);
        if (!body) {
            return buildUpdateErrorResponse("BAD_REQUEST", "Request body is required.", 400, startTime);
        }
        const { memberId, updatedData } = body;
        if (!memberId || String(memberId).trim() === "") {
            return buildUpdateErrorResponse("BAD_REQUEST", "memberId is mandatory.", 400, startTime, "memberId");
        }
        const targetId = String(memberId).trim();
        if (!isUUID(targetId)) {
            console.error(`❌ Rejected update: memberId="${targetId}" is not a valid UUID. ` +
                `Frontend must send the user_id (UUID), not a display name.`);
            return buildUpdateErrorResponse("INVALID_PARAMETERS", `memberId must be a valid UUID. Received "${targetId}" — ` +
                `likely a display label was sent instead of the member's user_id.`, 400, startTime, "memberId");
        }
        if (!updatedData || Object.keys(updatedData).length === 0) {
            return buildUpdateErrorResponse("BAD_REQUEST", "updatedData is mandatory and cannot be empty.", 400, startTime, "updatedData");
        }
        const { data: memberRecord, error: fetchErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id, contact, society, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type)")
            .eq("user_id", targetId)
            .maybeSingle();
        if (fetchErr)
            throw fetchErr;
        if (!memberRecord) {
            const { data: vendor, error: vendorErr } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .select("non_society_user_id, society")
                .eq("non_society_user_id", targetId)
                .ilike("role", "vendor")
                .maybeSingle();
            if (vendorErr)
                throw vendorErr;
            if (!vendor) {
                return buildUpdateErrorResponse("NOT_FOUND", "Member record not found.", 404, startTime);
            }
            if (!vendor.society) {
                return buildUpdateErrorResponse("INVALID_STATE", "Vendor record is missing society context — cannot update.", 400, startTime);
            }
            if (updatedData.role !== undefined) {
                const roles = Array.isArray(updatedData.role) ? updatedData.role : [updatedData.role];
                if (roles.length !== 1 || String(roles[0]).trim().toLowerCase() !== "vendor") {
                    throw new ValidationError("Vendor role must remain vendor.", "role");
                }
            }
            const vendorPayload: Record<string, unknown> = {};
            const vendorFields: [
                string,
                string
            ][] = [
                ["fullName", "name"], ["name", "name"], ["vendorName", "name"],
                ["phone", "phone_number"], ["phoneNumber", "phone_number"],
                ["email", "email"], ["gender", "gender"],
                ["idProofType", "id_proof_type"], ["idProofNumber", "id_proof_number"],
                ["vehicleType", "vehicle_type"],
                ["vehicleRegistrationNumber", "vehicle_number"], ["vehicleNumber", "vehicle_number"],
                ["serviceType", "service_type"], ["vendorServiceType", "service_type"],
                ["vendorId", "vendor_id"],
            ];
            for (const [field, column] of vendorFields) {
                const value = (updatedData as Record<string, unknown>)[field];
                if (value !== undefined)
                    vendorPayload[column] = coerceOptional(value);
            }
            if (updatedData.vendorRating !== undefined) {
                const value = coerceOptional(updatedData.vendorRating);
                const rating = value === null ? null : Number(value);
                if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
                    throw new ValidationError("vendorRating must be between 0 and 5.", "vendorRating");
                }
                vendorPayload.vendor_rating = rating;
            }
            if (Object.keys(vendorPayload).length === 0) {
                throw new ValidationError("No supported vendor fields provided.", "updatedData");
            }
            const { data: savedVendor, error: updateErr } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .update(vendorPayload)
                .eq("non_society_user_id", targetId)
                .eq("society", vendor.society)
                .ilike("role", "vendor")
                .select("non_society_user_id")
                .maybeSingle();
            if (updateErr)
                throw updateErr;
            if (!savedVendor) {
                return buildUpdateErrorResponse("NOT_FOUND", "Vendor record not found.", 404, startTime);
            }
            return successResponse({
                updatedMember: { memberId: targetId, updatedData, status: "Successfully Updated" },
            });
        }
        const swapResult = autoFixSwappedTypes(updatedData.userType, updatedData.userOwnershipType);
        if (swapResult.swapped) {
            updatedData.userType = String(swapResult.userType);
            updatedData.userOwnershipType = String(swapResult.ownershipType);
        }
        let requestedParkingSlot: string | null | undefined;
        let savedParkingSlot: string | null | undefined;
        try {
            try {
                requestedParkingSlot = normalizeParkingSlot(updatedData.parkingSlot !== undefined ? updatedData.parkingSlot : updatedData.parking_slot);
            }
            catch {
                throw new ValidationError("parkingSlot must be text or null.", "parkingSlot");
            }
            if (requestedParkingSlot !== undefined && !memberRecord.contact) {
                throw new ValidationError("Member has no linked contact to save parkingSlot.", "parkingSlot");
            }
            if (updatedData.userType !== undefined) {
                normalizeEnum(updatedData.userType, ALLOWED_USER_TYPES, "userType");
            }
            if (updatedData.userOwnershipType !== undefined) {
                normalizeEnum(updatedData.userOwnershipType, ALLOWED_OWNERSHIP_TYPES, "userOwnershipType");
            }
            if (updatedData.status !== undefined) {
                parseStatus(updatedData.status);
            }
            if (updatedData.serviceAgentRating !== undefined &&
                updatedData.serviceAgentRating !== null &&
                updatedData.serviceAgentRating !== "") {
                const r = Number(updatedData.serviceAgentRating);
                if (!Number.isFinite(r) || r < 0 || r > 5) {
                    throw new ValidationError("serviceAgentRating must be between 0 and 5.", "serviceAgentRating");
                }
            }
            if (updatedData.role !== undefined) {
                if (!Array.isArray(updatedData.role)) {
                    throw new ValidationError("role must be an array of strings.", "role");
                }
                const cleanRoles = updatedData.role.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
                const invalidRoles = cleanRoles.filter((r) => !ALLOWED_ROLES.includes(r as any));
                if (invalidRoles.length > 0) {
                    throw new ValidationError(`Invalid roles: ${invalidRoles.join(", ")}`, "role");
                }
            }
        }
        catch (err: any) {
            if (err instanceof ValidationError) {
                return buildUpdateErrorResponse("INVALID_PARAMETERS", err.message, 400, startTime, err.field);
            }
            throw err;
        }
        if (!memberRecord.society) {
            return buildUpdateErrorResponse("INVALID_STATE", "Member record is missing society context — cannot update.", 400, startTime);
        }
        const societyId = memberRecord.society as string;
        const societyUserUpdatePayload: Record<string, unknown> = {};
        if (updatedData.blockName !== undefined) {
            try {
                societyUserUpdatePayload.block = await resolveBlockId(supabaseAdmin, updatedData.blockName ?? "", societyId);
            }
            catch (err: any) {
                if (err instanceof ValidationError) {
                    return buildUpdateErrorResponse("NOT_FOUND", err.message, 404, startTime, err.field);
                }
                throw err;
            }
        }
        if (updatedData.towerName !== undefined) {
            try {
                societyUserUpdatePayload.tower = await resolveTowerId(supabaseAdmin, updatedData.towerName ?? "", societyId);
            }
            catch (err: any) {
                if (err instanceof ValidationError) {
                    return buildUpdateErrorResponse("NOT_FOUND", err.message, 404, startTime, err.field);
                }
                throw err;
            }
        }
        const resolvedFlatType = await resolveResidentFlatType(supabaseAdmin, societyId, updatedData);
        if (resolvedFlatType)
            societyUserUpdatePayload.flat_type_id = resolvedFlatType.flatTypeId;
        const stringFieldMappings: [
            keyof UpdateMemberRequest["updatedData"],
            string
        ][] = [
            ["unitFlatNumber", "unit_flat_number"],
            ["moveInDate", "move_in_date"],
            ["moveOutDate", "move_out_date"],
            ["shift", "shift"],
            ["securityZone", "security_zone"],
            ["securityGuardStatus", "security_guard_status"],
            ["gateNumber", "gate_number"],
            ["securityGuardId", "security_guard_id"],
            ["agentAvailabilityStatus", "agent_availability_status"],
        ];
        for (const [field, dbField] of stringFieldMappings) {
            if (updatedData[field] !== undefined) {
                societyUserUpdatePayload[dbField] = coerceOptional(updatedData[field]);
            }
        }
        if (updatedData.userType !== undefined) {
            societyUserUpdatePayload.user_type = normalizeEnum(updatedData.userType, ALLOWED_USER_TYPES, "userType");
        }
        if (updatedData.userOwnershipType !== undefined) {
            societyUserUpdatePayload.user_ownership_type = normalizeEnum(updatedData.userOwnershipType, ALLOWED_OWNERSHIP_TYPES, "userOwnershipType");
        }
        if (updatedData.status !== undefined) {
            societyUserUpdatePayload.status = parseStatus(updatedData.status);
        }
        if (updatedData.serviceAgentRating !== undefined) {
            if (updatedData.serviceAgentRating === null ||
                updatedData.serviceAgentRating === "") {
                societyUserUpdatePayload.service_agent_rating = null;
            }
            else {
                const r = Number(updatedData.serviceAgentRating);
                societyUserUpdatePayload.service_agent_rating = Number(r.toFixed(2));
            }
        }
        if (updatedData.serviceAgentServices !== undefined) {
            societyUserUpdatePayload.service_agent_services =
                Array.isArray(updatedData.serviceAgentServices)
                    ? updatedData.serviceAgentServices.join(", ")
                    : updatedData.serviceAgentServices || null;
        }
        if (updatedData.role !== undefined) {
            societyUserUpdatePayload.role = (updatedData.role as string[]).map((r) => String(r).toLowerCase().trim());
        }
        if (Object.keys(societyUserUpdatePayload).length > 0) {
            const { error: userUpdateErr } = await supabaseAdmin
                .from("SSP_Society_User")
                .update(societyUserUpdatePayload)
                .eq("user_id", memberRecord.user_id);
            if (userUpdateErr) {
                const mapped = mapPgError(userUpdateErr);
                if (mapped) {
                    return buildUpdateErrorResponse(mapped.code, mapped.message, mapped.status, startTime, mapped.field);
                }
                throw userUpdateErr;
            }
        }
        let finalEmail = "";
        let finalName = "";
        if (memberRecord.contact) {
            const contactUpdatePayload: Record<string, unknown> = {};
            if (requestedParkingSlot !== undefined)
                contactUpdatePayload.parking_slot = requestedParkingSlot;
            const contactFieldMappings: [
                keyof UpdateMemberRequest["updatedData"],
                string
            ][] = [
                ["fullName", "name"],
                ["phone", "phone"],
                ["email", "email"],
                ["gender", "gender"],
                ["occupation", "occupation"],
                ["idProofType", "id_proof_type"],
                ["idProofNumber", "id_proof_number"],
                ["whatsappPhone", "whatsapp_phone"],
                ["emergencyPhone", "emergency_phone"],
                ["vehicleType", "vehicle_type"],
                ["vehicleRegistrationNumber", "vehicle_registration_number"],
            ];
            for (const [field, dbField] of contactFieldMappings) {
                if (updatedData[field] !== undefined) {
                    contactUpdatePayload[dbField] = coerceOptional(updatedData[field]);
                }
            }
            if (Object.keys(contactUpdatePayload).length > 0) {
                const { data: updatedContact, error: contactUpdateErr } = await supabaseAdmin
                    .from("SSP_Contact")
                    .update(contactUpdatePayload)
                    .eq("contact_id", memberRecord.contact)
                    .select("name, email, phone, parking_slot")
                    .single();
                if (contactUpdateErr) {
                    const mapped = mapPgError(contactUpdateErr);
                    if (mapped) {
                        return buildUpdateErrorResponse(mapped.code, mapped.message, mapped.status, startTime, mapped.field);
                    }
                    throw contactUpdateErr;
                }
                if (!updatedContact)
                    throw new Error("Contact update returned no saved record.");
                if (requestedParkingSlot !== undefined) {
                    savedParkingSlot = updatedContact.parking_slot ?? null;
                }
                if (updatedContact) {
                    finalEmail = updatedContact.email || `${updatedContact.phone}@temp.user`;
                    finalName = updatedContact.name || "User";
                }
            }
        }
        try {
            const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
            const targetAuthUser = authUsers?.users?.find((u: any) => u.user_metadata?.user_id === targetId);
            if (targetAuthUser) {
                const metadataUpdate: Record<string, any> = { ...targetAuthUser.user_metadata };
                let needsUpdate = false;
                if (updatedData.role !== undefined) {
                    metadataUpdate.roles = (updatedData.role as string[]).map((r) => String(r).toLowerCase().trim());
                    needsUpdate = true;
                }
                if (finalName) {
                    metadataUpdate.name = finalName;
                    needsUpdate = true;
                }
                if (needsUpdate) {
                    await supabaseAdmin.auth.admin.updateUserById(targetAuthUser.id, {
                        user_metadata: metadataUpdate,
                    });
                    console.log(`✅ Synced auth metadata for user: ${targetAuthUser.id}`);
                }
            }
        }
        catch (authSyncErr) {
            console.warn(`⚠️ Failed to sync auth metadata:`, authSyncErr);
        }
        console.log(`✅ Member updated: ${targetId} in ${Date.now() - startTime}ms`);
        return successResponse({
            updatedMember: {
                memberId: targetId,
                updatedData: {
                    ...updatedData,
                    ...(resolvedFlatType ?? residentFlatTypeFields(memberRecord)),
                    ...(savedParkingSlot !== undefined ? { parkingSlot: savedParkingSlot } : {}),
                    ...(updatedData.parking_slot !== undefined && savedParkingSlot !== undefined
                        ? { parking_slot: savedParkingSlot } : {}),
                },
                status: "Successfully Updated",
            },
        });
    }
    catch (error: any) {
        if (error instanceof ResidentFlatTypeError)
            return errorResponse(error.message, 400);
        const mapped = mapPgError(error);
        if (mapped) {
            return buildUpdateErrorResponse(mapped.code, mapped.message, mapped.status, startTime, mapped.field);
        }
        if (error instanceof ValidationError) {
            return buildUpdateErrorResponse("INVALID_PARAMETERS", error.message, 400, startTime, error.field);
        }
        console.error("❌ update-member error:", error);
        return buildUpdateErrorResponse("SERVER_ERROR", error.message || "Failed to update member", 500, startTime);
    }
}));
