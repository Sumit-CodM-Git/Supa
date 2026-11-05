// ============================================
// crud-servant — Merged CRUD for SSP_Servant
// Actions: CREATE | VIEW | UPDATE | DELETE
// Optimized for sub-3s response times
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
    corsHeaders,
    errorResponse,
    successResponse,
} from "../_shared/response.ts";
import { parseRequestBody, sanitizeString } from "../_shared/utils.ts";
import { ArrayHandler } from "../_shared/array-handler.ts";
import {
    createClient,
    SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// CONSTANTS
// ============================================
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const VALID_ACTIONS = ["CREATE", "VIEW", "UPDATE", "DELETE"] as const;
type Action = typeof VALID_ACTIONS[number];

const ADMIN_ROLES = ["admin", "superadmin"] as const;

const VALID_ROLES = [
    "baby_sitter",
    "car_cleaner",
    "caretaker",
    "cook",
    "driver",
    "gardener",
    "housekeeper",
    "laundry",
    "maid",
    "other",
] as const;

const VALID_SHIFT_TIMING = [
    "morning",
    "afternoon",
    "evening",
    "night",
    "full_day",
] as const;

const VALID_STATUS = ["active", "inactive"] as const;
const VALID_GENDER = ["male", "female", "other"] as const;
const VALID_ID_PROOF = [
    "aadhaar",
    "pan",
    "passport",
    "driving_license",
    "voter_id",
    "other",
] as const;

const BUCKET_NAME = "society-documents";
const SIGNED_URL_TTL = 900; // 15 minutes

// ============================================
// TYPES
// ============================================
interface CrudServantRequest {
    action: Action;
    societyRegistrationNumber: string;
    servantId?: string;
    servantData?: {
        servantId?: string;
        name?: string;
        phoneNumber?: string;
        address?: string;
        role?: string | string[];
        shiftTiming?: string | string[];
        gender?: string;
        status?: string;
        dateOfBirth?: string;
        idProofType?: string;
        idProofNumber?: string;
        isRecurring?: boolean;
        scheduledArrival?: string;
        scheduledDeparture?: string;
    };
    servantImage?: {
        fileName: string;
        fileType: string;
        fileSize?: number;
    };
    filters?: {
        status?: string;
        gender?: string;
        role?: string;
        shiftTiming?: string;
        isRecurring?: boolean;
        search?: string;
    };
    sort?: { field?: string; order?: "asc" | "desc" };
    pagination?: { page?: number; pageSize?: number };
    idempotencyKey?: string;
}

interface AuthContext {
    user: { id: string; email: string };
}

interface ServantRow {
    servant_id: string;
    servant_name: string | null;
    phone_number: string | null;
    address: string | null;
    role: string[] | null;
    shift_timing: string[] | null;
    gender: string | null;
    status: string | null;
    date_of_birth: string | null;
    id_proof_type: string | null;
    id_proof_number: string | null;
    is_recurring: boolean | null;
    scheduled_arrival: string | null;
    scheduled_departure: string | null;
    created_at: string | null;
    society: string | null;
    deleted_at?: string | null;
}

interface SocietyUserRow {
    user_id: string;
    role: string[] | null;
    society: string | null;
    SSP_Society:
        | { society_id: string; registration_number: string }
        | { society_id: string; registration_number: string }[]
        | null;
    SSP_Contact:
        | { name: string }
        | { name: string }[]
        | null;
}

interface ContextSuccess {
    ok: true;
    societyId: string;
    displayName: string;
    roles: string[];
}

interface ContextFailure {
    ok: false;
    code: string;
    message: string;
    status: number;
}

// ============================================
// SUPABASE CLIENT
// ============================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabaseAdmin: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    {
        auth: { persistSession: false },
        global: { fetch: fetch },
        db: { schema: "public" },
    },
);

// ============================================
// HELPERS
// ============================================
function buildError(code: string, message: string, status: number): Response {
    return new Response(
        JSON.stringify({
            success: false,
            data: null,
            errorResponse: {
                errorCode: code,
                message,
                timestamp: new Date().toISOString(),
            },
        }),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

function clampPageSize(n: number | undefined): number {
    if (!n || n < 1) return DEFAULT_PAGE_SIZE;
    return Math.min(n, MAX_PAGE_SIZE);
}

function hasAdminRole(roles: string[]): boolean {
    if (!Array.isArray(roles)) return false;
    return roles.some((r) => {
        if (typeof r !== "string") return false;
        const normalized = r.toLowerCase().trim().replace(/[\s-]+/g, "");
        return ADMIN_ROLES.includes(normalized as typeof ADMIN_ROLES[number]);
    });
}

function validatePhone(phone: string): boolean {
    return /^[0-9]{10,15}$/.test(phone);
}

function validateDate(name: string, value: string | undefined): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new Error(`${name} is not a valid date.`);
    return d.toISOString().split("T")[0];
}

function formatToTimestamp(timeStr: string | undefined): string | null {
    if (!timeStr) return null;
    const trimmed = timeStr.trim();
    if (!trimmed) return null;
    if (trimmed.includes("T")) return trimmed;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}T${trimmed}`;
}

function normalizeRoleArray(
    input: string | string[] | undefined,
): string[] | null {
    const arr = ArrayHandler.toArray(input, {
        trim: true,
        removeEmpty: true,
        unique: true,
        lowercase: true,
    });
    if (arr.length === 0) return null;
    return arr.map((r) => r.replace(/[\s-]+/g, "_"));
}

function normalizeShiftArray(
    input: string | string[] | undefined,
): string[] | null {
    const arr = ArrayHandler.toArray(input, {
        trim: true,
        removeEmpty: true,
        unique: true,
        lowercase: true,
    });
    if (arr.length === 0) return null;
    return arr.map((s) => s.replace(/[\s-]+/g, "_"));
}

function validateRoles(roles: string[]): string | null {
    const invalid = roles.filter((r) =>
        !VALID_ROLES.includes(r as typeof VALID_ROLES[number])
    );
    if (invalid.length > 0) {
        return `Invalid role(s): ${invalid.join(", ")}. Allowed: ${
            VALID_ROLES.join(", ")
        }`;
    }
    return null;
}

function validateShifts(shifts: string[]): string | null {
    const invalid = shifts.filter((s) =>
        !VALID_SHIFT_TIMING.includes(s as typeof VALID_SHIFT_TIMING[number])
    );
    if (invalid.length > 0) {
        return `Invalid shift(s): ${invalid.join(", ")}. Allowed: ${
            VALID_SHIFT_TIMING.join(", ")
        }`;
    }
    return null;
}

// ============================================
// OPTIMIZED: Single-query context resolution
// ============================================
async function getContext(
    societyRegistrationNumber: string,
    userId: string,
): Promise<ContextSuccess | ContextFailure> {
    const t0 = Date.now();

    const { data, error } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
            user_id,
            role,
            society,
            SSP_Society!inner ( society_id, registration_number ),
            SSP_Contact:SSP_Contact!contact ( name )
        `)
        .eq("user_id", userId)
        .eq("SSP_Society.registration_number", societyRegistrationNumber)
        .maybeSingle();

    if (error) {
        if (error.code === "PGRST116") {
            return {
                ok: false,
                code: "NOT_FOUND",
                message:
                    "Society registration number not found or user not a member.",
                status: 404,
            };
        }
        return {
            ok: false,
            code: "SERVER_ERROR",
            message: error.message,
            status: 500,
        };
    }

    if (!data) {
        return {
            ok: false,
            code: "FORBIDDEN",
            message: "User does not belong to this society.",
            status: 403,
        };
    }

    const row = data as unknown as SocietyUserRow;

    const societyRel = row.SSP_Society;
    const societyId = Array.isArray(societyRel)
        ? societyRel[0]?.society_id
        : societyRel?.society_id;

    if (!societyId) {
        return {
            ok: false,
            code: "NOT_FOUND",
            message: "Society registration number not found.",
            status: 404,
        };
    }

    const contact = Array.isArray(row.SSP_Contact)
        ? row.SSP_Contact[0]
        : row.SSP_Contact;

    const displayName = (contact?.name as string) || "";
    const roles = Array.isArray(row.role) ? (row.role as string[]) : [];

    console.log(`[ctx] resolved in ${Date.now() - t0}ms`);
    return { ok: true, societyId, displayName, roles };
}

function extractStorageKey(fullUrl: string | null): string | null {
    if (!fullUrl) return null;

    const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
    if (fullUrl.includes(publicMarker)) {
        return decodeURIComponent(fullUrl.split(publicMarker)[1]).trim();
    }

    const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
    if (fullUrl.includes(signedMarker)) {
        return decodeURIComponent(fullUrl.split(signedMarker)[1].split("?")[0])
            .trim();
    }

    if (fullUrl.includes(".amazonaws.com/")) {
        const parts = fullUrl.split(".amazonaws.com/");
        if (parts.length > 1) {
            const pathParts = parts[1].split("/");
            if (pathParts[0] === BUCKET_NAME) {
                return pathParts.slice(1).join("/");
            }
            return pathParts.join("/");
        }
    }

    return fullUrl.trim();
}

// ============================================
// OPTIMIZED: Batch signed URL generation
// ============================================
async function fetchImageMap(
    servantIds: string[],
    societyId: string,
): Promise<Record<string, string>> {
    if (servantIds.length === 0) return {};

    const { data: docs, error } = await supabaseAdmin
        .from("SSP_Document")
        .select("servant, s3_path")
        .in("servant", servantIds)
        .eq("society", societyId)
        .not("s3_path", "is", null);

    if (error || !docs || docs.length === 0) return {};

    const servantToKey: Record<string, string> = {};
    for (const doc of docs) {
        const sid = doc.servant;
        if (!sid) continue;
        const key = extractStorageKey(doc.s3_path);
        if (key && !servantToKey[sid]) {
            servantToKey[sid] = key;
        }
    }

    const keys = Object.values(servantToKey);
    if (keys.length === 0) return {};

    const { data: signedList, error: signErr } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .createSignedUrls(keys, SIGNED_URL_TTL);

    if (signErr || !signedList) return {};

    const keyToUrl: Record<string, string> = {};
    for (const s of signedList) {
        if (s.signedUrl && !s.error) {
            keyToUrl[s.path] = s.signedUrl;
        }
    }

    const map: Record<string, string> = {};
    for (const [servantId, key] of Object.entries(servantToKey)) {
        const url = keyToUrl[key];
        if (url) map[servantId] = url;
    }
    return map;
}

async function deleteServantDocuments(
    servantId: string,
    societyId: string,
): Promise<
    { documentsDeleted: number; storageDeleted: number; storageFailed: number }
> {
    const { data: docs, error: fetchErr } = await supabaseAdmin
        .from("SSP_Document")
        .select("document_id, s3_path")
        .eq("servant", servantId)
        .eq("society", societyId);

    if (fetchErr) {
        throw new Error(`Failed to fetch documents: ${fetchErr.message}`);
    }
    if (!docs || docs.length === 0) {
        return { documentsDeleted: 0, storageDeleted: 0, storageFailed: 0 };
    }

    let storageDeleted = 0;
    let storageFailed = 0;

    const keys = docs
        .map((d) => extractStorageKey(d.s3_path))
        .filter((k): k is string => !!k && k.length > 0);

    const [storageRes, dbRes] = await Promise.all([
        keys.length > 0
            ? supabaseAdmin.storage.from(BUCKET_NAME).remove(keys)
            : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
            .from("SSP_Document")
            .delete()
            .eq("servant", servantId)
            .eq("society", societyId),
    ]);

    if (storageRes.error) {
        storageFailed = keys.length;
        console.warn(
            `[crud-servant] storage cleanup failed (continuing): ${storageRes.error.message}`,
        );
    } else {
        storageDeleted = storageRes.data?.length ?? keys.length;
    }

    if (dbRes.error) {
        throw new Error(
            `Failed to delete document rows: ${dbRes.error.message}`,
        );
    }

    return { documentsDeleted: docs.length, storageDeleted, storageFailed };
}

/**
 * Prepare servant image: sign upload URL + insert document row (awaited).
 * The insert is cheap (~50–150ms) and keeps data consistent — no orphaned files.
 */
async function prepareServantImage(
    servantId: string,
    societyId: string,
    societyRegistrationNumber: string,
    image: { fileName: string; fileType: string; fileSize?: number },
): Promise<Record<string, unknown> | null> {
    try {
        const cleanFileName = image.fileName.replace(/\s+/g, "_");
        const objectKey =
            `${societyRegistrationNumber}/servant/${Date.now()}_${cleanFileName}`;

        const { data: signed, error: signErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey);

        if (signErr || !signed) {
            console.warn(
                `[crud-servant] image sign failed: ${signErr?.message}`,
            );
            return null;
        }

        const fullPublicPath =
            `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${objectKey}`;

        const documentPayload = {
            document_id: crypto.randomUUID(),
            name: image.fileName,
            file_name: image.fileName,
            file_type: image.fileType,
            file_size: image.fileSize || null,
            document_type: "servant_image",
            s3_path: fullPublicPath,
            society: societyId,
            servant: servantId,
            uploaded_on: new Date().toISOString(),
            created_at: new Date().toISOString(),
        };

        const { error: docErr } = await supabaseAdmin
            .from("SSP_Document")
            .insert(documentPayload);

        if (docErr) {
            console.warn(
                `[crud-servant] document insert failed: ${docErr.message}`,
            );
            return null;
        }

        return {
            documentId: documentPayload.document_id,
            imageUrl: signed.signedUrl, // signed UPLOAD URL for the client
            filePath: objectKey,
            fileName: image.fileName,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(
            `[crud-servant] image handling failed (non-fatal): ${msg}`,
        );
        return null;
    }
}

function toResponse(s: ServantRow, imageUrl?: string | null) {
    const base = {
        servantId: s.servant_id,
        name: s.servant_name || "N/A",
        phoneNumber: s.phone_number || "N/A",
        address: s.address,
        role: s.role,
        shiftTiming: s.shift_timing,
        gender: s.gender,
        status: s.status,
        dateOfBirth: s.date_of_birth,
        idProofType: s.id_proof_type,
        idProofNumber: s.id_proof_number,
        isRecurring: s.is_recurring,
        scheduledArrival: s.scheduled_arrival,
        scheduledDeparture: s.scheduled_departure,
        createdAt: s.created_at,
    };
    return imageUrl !== undefined ? { ...base, imageUrl } : base;
}

// ============================================
// ACTION HANDLERS
// ============================================

async function handleCreate(
    body: CrudServantRequest,
    _authCtx: AuthContext,
    ctx: { societyId: string; societyRegistrationNumber: string },
): Promise<Response> {
    const t0 = Date.now();
    const sd = body.servantData;
    if (!sd) return buildError("BAD_REQUEST", "servantData is mandatory.", 400);

    // ---- Validation (all in-memory) ----
    if (!sd.name?.trim()) {
        return buildError("BAD_REQUEST", "name is required.", 400);
    }
    if (!sd.phoneNumber?.trim()) {
        return buildError("BAD_REQUEST", "phoneNumber is required.", 400);
    }
    if (!sd.idProofType?.trim()) {
        return buildError("BAD_REQUEST", "idProofType is required.", 400);
    }
    if (!sd.idProofNumber?.trim()) {
        return buildError("BAD_REQUEST", "idProofNumber is required.", 400);
    }
    if (sd.name.length > 100) {
        return buildError("BAD_REQUEST", "name exceeds 100 chars.", 400);
    }
    if (sd.address && sd.address.length > 500) {
        return buildError("BAD_REQUEST", "address exceeds 500 chars.", 400);
    }
    if (sd.idProofNumber.length > 50) {
        return buildError(
            "BAD_REQUEST",
            "idProofNumber exceeds 50 chars.",
            400,
        );
    }

    const cleanName = sanitizeString(sd.name);
    const cleanPhone = sanitizeString(sd.phoneNumber);
    const cleanIdProofType = sanitizeString(sd.idProofType).toLowerCase();
    const cleanIdProofNumber = sanitizeString(sd.idProofNumber);

    if (!validatePhone(cleanPhone)) {
        return buildError(
            "BAD_REQUEST",
            "Invalid phone number. Must be 10–15 digits.",
            400,
        );
    }
    if (
        !VALID_ID_PROOF.includes(
            cleanIdProofType as typeof VALID_ID_PROOF[number],
        )
    ) {
        return buildError(
            "BAD_REQUEST",
            `idProofType must be one of ${VALID_ID_PROOF.join(", ")}`,
            400,
        );
    }

    const normalizedGender = sd.gender?.toLowerCase().trim() || null;
    if (
        normalizedGender &&
        !VALID_GENDER.includes(normalizedGender as typeof VALID_GENDER[number])
    ) {
        return buildError(
            "BAD_REQUEST",
            `gender must be one of ${VALID_GENDER.join(", ")}`,
            400,
        );
    }

    const normalizedStatus = (sd.status || "active").toLowerCase().trim();
    if (
        !VALID_STATUS.includes(normalizedStatus as typeof VALID_STATUS[number])
    ) {
        return buildError(
            "BAD_REQUEST",
            `status must be one of ${VALID_STATUS.join(", ")}`,
            400,
        );
    }

    const roleArray = normalizeRoleArray(sd.role);
    if (roleArray) {
        const roleErr = validateRoles(roleArray);
        if (roleErr) return buildError("BAD_REQUEST", roleErr, 400);
    }

    const shiftArray = normalizeShiftArray(sd.shiftTiming);
    if (shiftArray) {
        const shiftErr = validateShifts(shiftArray);
        if (shiftErr) return buildError("BAD_REQUEST", shiftErr, 400);
    }

    console.log(`[crud-servant][CREATE] validation ${Date.now() - t0}ms`);

    // ---- PARALLEL: idempotency + duplicate checks ----
    const tChecks = Date.now();

    const idempotencyPromise = body.idempotencyKey
        ? supabaseAdmin
            .from("SSP_Servant")
            .select("servant_id, created_at")
            .eq("idempotency_key", body.idempotencyKey)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

    const duplicatePromise = supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, phone_number, id_proof_number")
        .eq("society", ctx.societyId)
        .is("deleted_at", null)
        .or(`phone_number.eq.${cleanPhone},id_proof_number.eq.${cleanIdProofNumber}`)
        .limit(1)
        .maybeSingle();

    const [idemRes, dupRes] = await Promise.all([
        idempotencyPromise,
        duplicatePromise,
    ]);
    console.log(
        `[crud-servant][CREATE] parallel checks ${Date.now() - tChecks}ms`,
    );

    if (idemRes.data) {
        return successResponse({
            servantCreated: true,
            idempotentReplay: true,
            servantId: idemRes.data.servant_id,
            createdAt: idemRes.data.created_at,
        });
    }

    if (dupRes.data) {
        const reason = dupRes.data.phone_number === cleanPhone
            ? "phone number"
            : "ID proof number";
        return successResponse({
            servantCreated: false,
            message:
                `A servant with this ${reason} already exists in this society.`,
            servantId: null,
        });
    }

    // ---- Build insert payload ----
    const insertPayload: Record<string, unknown> = {
        servant_name: cleanName,
        phone_number: cleanPhone,
        id_proof_number: cleanIdProofNumber,
        id_proof_type: cleanIdProofType,
        society: ctx.societyId,
        status: normalizedStatus,
        idempotency_key: body.idempotencyKey ?? null,
    };

    if (sd.address) insertPayload.address = sanitizeString(sd.address);
    if (normalizedGender) insertPayload.gender = normalizedGender;
    if (sd.dateOfBirth) {
        insertPayload.date_of_birth = validateDate(
            "dateOfBirth",
            sd.dateOfBirth,
        );
    }
    if (sd.isRecurring !== undefined) {
        insertPayload.is_recurring = sd.isRecurring;
    }
    if (sd.scheduledArrival) {
        insertPayload.scheduled_arrival = formatToTimestamp(
            sd.scheduledArrival,
        );
    }
    if (sd.scheduledDeparture) {
        insertPayload.scheduled_departure = formatToTimestamp(
            sd.scheduledDeparture,
        );
    }
    if (roleArray) insertPayload.role = roleArray;
    if (shiftArray) insertPayload.shift_timing = shiftArray;

    // ---- INSERT ----
    const tInsert = Date.now();
    const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("SSP_Servant")
        .insert(insertPayload)
        .select(`
            servant_id, servant_name, phone_number, address,
            role, shift_timing, gender, status, date_of_birth,
            id_proof_type, id_proof_number, is_recurring,
            scheduled_arrival, scheduled_departure, created_at, society
        `)
        .single();

    if (insertErr) {
        return buildError(
            "SERVER_ERROR",
            `Failed to create servant: ${insertErr.message}`,
            500,
        );
    }
    console.log(`[crud-servant][CREATE] insert ${Date.now() - tInsert}ms`);

    // ---- Image: sign URL + insert doc row (awaited, correct & cheap) ----
    let documentResponse: Record<string, unknown> | null = null;
    if (body.servantImage?.fileName && body.servantImage?.fileType) {
        const tImg = Date.now();
        documentResponse = await prepareServantImage(
            inserted.servant_id,
            ctx.societyId,
            ctx.societyRegistrationNumber,
            body.servantImage,
        );
        console.log(`[crud-servant][CREATE] image ${Date.now() - tImg}ms`);
    }

    console.log(`[crud-servant][CREATE] TOTAL ${Date.now() - t0}ms`);

    return successResponse({
        servantCreated: true,
        message: "Servant created successfully.",
        servant: toResponse(inserted as ServantRow),
        document: documentResponse,
    });
}

async function handleView(
    body: CrudServantRequest,
    ctx: { societyId: string; roles: string[] },
): Promise<Response> {
    const t0 = Date.now();
    const filters = body.filters ?? {};
    const sortField = ["created_at", "servant_name", "status"].includes(
            body.sort?.field ?? "",
        )
        ? body.sort!.field!
        : "created_at";
    const sortAsc = body.sort?.order === "asc";
    const page = Math.max(1, body.pagination?.page ?? 1);
    const pageSize = clampPageSize(body.pagination?.pageSize);
    const offset = (page - 1) * pageSize;

    const cleanStatus = filters.status && filters.status.toLowerCase() !== "all"
        ? sanitizeString(filters.status).toLowerCase()
        : null;
    const cleanGender = filters.gender && filters.gender.toLowerCase() !== "all"
        ? sanitizeString(filters.gender).toLowerCase()
        : null;
    const cleanRole = filters.role
        ? sanitizeString(filters.role).toLowerCase().replace(/[\s-]+/g, "_")
        : null;
    const cleanShift = filters.shiftTiming
        ? sanitizeString(filters.shiftTiming).toLowerCase().replace(
            /[\s-]+/g,
            "_",
        )
        : null;
    const cleanSearch = filters.search && filters.search.trim() !== ""
        ? sanitizeString(filters.search).replace(/[%_]/g, "")
        : null;

    const SELECT = `
        servant_id, servant_name, phone_number, address,
        role, shift_timing, gender, status, date_of_birth,
        id_proof_type, id_proof_number, is_recurring,
        scheduled_arrival, scheduled_departure, created_at, society
    `;

    let dataQuery = supabaseAdmin
        .from("SSP_Servant")
        .select(SELECT)
        .eq("society", ctx.societyId)
        .is("deleted_at", null);

    let countQuery = supabaseAdmin
        .from("SSP_Servant")
        .select("*", { count: "exact", head: true })
        .eq("society", ctx.societyId)
        .is("deleted_at", null);

    // deno-lint-ignore no-explicit-any
    const applyFilters = (q: any): any => {
        let out = q;
        if (cleanStatus) out = out.eq("status", cleanStatus);
        if (cleanGender) out = out.eq("gender", cleanGender);
        if (cleanRole) out = out.contains("role", [cleanRole]);
        if (cleanShift) out = out.contains("shift_timing", [cleanShift]);
        if (typeof filters.isRecurring === "boolean") {
            out = out.eq("is_recurring", filters.isRecurring);
        }
        if (cleanSearch) {
            out = out.or(
                `servant_name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`,
            );
        }
        return out;
    };

    dataQuery = applyFilters(dataQuery);
    countQuery = applyFilters(countQuery);

    dataQuery = dataQuery
        .order(sortField, { ascending: sortAsc, nullsFirst: false })
        .range(offset, offset + pageSize - 1);

    const [dataRes, countRes] = await Promise.all([dataQuery, countQuery]);
    console.log(`[crud-servant][VIEW] data+count ${Date.now() - t0}ms`);

    if (dataRes.error) {
        return buildError(
            "SERVER_ERROR",
            `Database error: ${dataRes.error.message}`,
            500,
        );
    }

    const total = countRes.error ? 0 : countRes.count ?? 0;
    const servants = (dataRes.data ?? []) as unknown as ServantRow[];
    const servantIds = servants.map((s) => s.servant_id);

    const tImg = Date.now();
    const imageMap = await fetchImageMap(servantIds, ctx.societyId);
    console.log(`[crud-servant][VIEW] images ${Date.now() - tImg}ms`);

    const isAdmin = hasAdminRole(ctx.roles);

    console.log(`[crud-servant][VIEW] TOTAL ${Date.now() - t0}ms`);

    return successResponse({
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        servants: servants.map((s) => {
            const url = imageMap[s.servant_id];
            return url ? toResponse(s, url) : toResponse(s);
        }),
        filters: {
            status: filters.status ?? "all",
            gender: filters.gender ?? "all",
            role: filters.role ?? null,
            shiftTiming: filters.shiftTiming ?? null,
            isRecurring: filters.isRecurring ?? null,
            search: filters.search ?? null,
        },
        permissions: {
            canCreate: isAdmin,
            canUpdate: isAdmin,
            canDelete: isAdmin,
        },
    });
}

async function handleUpdate(
    body: CrudServantRequest,
    _authCtx: AuthContext,
    ctx: {
        societyId: string;
        societyRegistrationNumber: string;
        roles: string[];
    },
): Promise<Response> {
    const t0 = Date.now();

    if (!hasAdminRole(ctx.roles)) {
        return buildError("FORBIDDEN", "Only Admin can update servants.", 403);
    }

    const servantId = body.servantId ?? body.servantData?.servantId;
    if (!servantId?.trim()) {
        return buildError(
            "BAD_REQUEST",
            "servantId is mandatory for UPDATE.",
            400,
        );
    }

    const sd = body.servantData;
    const hasFieldUpdate = sd && Object.keys(sd).some((k) => k !== "servantId");
    const hasImageUpdate =
        !!(body.servantImage?.fileName && body.servantImage?.fileType);

    if (!hasFieldUpdate && !hasImageUpdate) {
        return buildError(
            "BAD_REQUEST",
            "servantData with at least one field, or servantImage, is required.",
            400,
        );
    }

    const cleanId = sanitizeString(servantId);

    const { data: existing, error: findErr } = await supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, society")
        .eq("servant_id", cleanId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) return buildError("SERVER_ERROR", findErr.message, 500);
    if (!existing) return buildError("NOT_FOUND", "Servant not found.", 404);
    if (existing.society !== ctx.societyId) {
        return buildError(
            "FORBIDDEN",
            "Servant does not belong to this society.",
            403,
        );
    }

    const payload: Record<string, unknown> = {};

    if (sd?.name !== undefined) {
        if (!sd.name.trim()) {
            return buildError("BAD_REQUEST", "name cannot be empty.", 400);
        }
        if (sd.name.length > 100) {
            return buildError("BAD_REQUEST", "name exceeds 100 chars.", 400);
        }
        payload.servant_name = sanitizeString(sd.name);
    }
    if (sd?.phoneNumber !== undefined) {
        const cleanPhone = sanitizeString(sd.phoneNumber);
        if (cleanPhone && !validatePhone(cleanPhone)) {
            return buildError("BAD_REQUEST", "Invalid phone number.", 400);
        }
        payload.phone_number = cleanPhone || null;
    }
    if (sd?.address !== undefined) {
        if (sd.address && sd.address.length > 500) {
            return buildError("BAD_REQUEST", "address exceeds 500 chars.", 400);
        }
        payload.address = sd.address ? sanitizeString(sd.address) : null;
    }
    if (sd?.idProofType !== undefined) {
        const v = sanitizeString(sd.idProofType).toLowerCase();
        if (v && !VALID_ID_PROOF.includes(v as typeof VALID_ID_PROOF[number])) {
            return buildError(
                "BAD_REQUEST",
                `idProofType must be one of ${VALID_ID_PROOF.join(", ")}`,
                400,
            );
        }
        payload.id_proof_type = v || null;
    }
    if (sd?.idProofNumber !== undefined) {
        if (sd.idProofNumber && sd.idProofNumber.length > 50) {
            return buildError(
                "BAD_REQUEST",
                "idProofNumber exceeds 50 chars.",
                400,
            );
        }
        payload.id_proof_number = sd.idProofNumber
            ? sanitizeString(sd.idProofNumber)
            : null;
    }
    if (sd?.gender !== undefined) {
        const v = sd.gender ? sd.gender.toLowerCase().trim() : null;
        if (v && !VALID_GENDER.includes(v as typeof VALID_GENDER[number])) {
            return buildError(
                "BAD_REQUEST",
                `gender must be one of ${VALID_GENDER.join(", ")}`,
                400,
            );
        }
        payload.gender = v;
    }
    if (sd?.status !== undefined) {
        const v = sd.status.toLowerCase().trim();
        if (!VALID_STATUS.includes(v as typeof VALID_STATUS[number])) {
            return buildError(
                "BAD_REQUEST",
                `status must be one of ${VALID_STATUS.join(", ")}`,
                400,
            );
        }
        payload.status = v;
    }
    if (sd?.dateOfBirth !== undefined) {
        payload.date_of_birth = sd.dateOfBirth
            ? validateDate("dateOfBirth", sd.dateOfBirth)
            : null;
    }
    if (sd?.isRecurring !== undefined) payload.is_recurring = sd.isRecurring;
    if (sd?.scheduledArrival !== undefined) {
        payload.scheduled_arrival = sd.scheduledArrival
            ? formatToTimestamp(sd.scheduledArrival)
            : null;
    }
    if (sd?.scheduledDeparture !== undefined) {
        payload.scheduled_departure = sd.scheduledDeparture
            ? formatToTimestamp(sd.scheduledDeparture)
            : null;
    }
    if (sd?.role !== undefined) {
        const arr = normalizeRoleArray(sd.role);
        if (arr) {
            const roleErr = validateRoles(arr);
            if (roleErr) return buildError("BAD_REQUEST", roleErr, 400);
        }
        payload.role = arr;
    }
    if (sd?.shiftTiming !== undefined) {
        const arr = normalizeShiftArray(sd.shiftTiming);
        if (arr) {
            const shiftErr = validateShifts(arr);
            if (shiftErr) return buildError("BAD_REQUEST", shiftErr, 400);
        }
        payload.shift_timing = arr;
    }

    // ---- Run servant update + image (cleanup + sign + doc insert) IN PARALLEL ----
    const updatePromise = Object.keys(payload).length > 0
        ? supabaseAdmin
            .from("SSP_Servant")
            .update(payload)
            .eq("servant_id", cleanId)
            .eq("society", ctx.societyId)
        : Promise.resolve({ error: null });

    const imagePromise: Promise<Record<string, unknown> | null> = hasImageUpdate
        ? (async () => {
            try {
                const cleanup = await deleteServantDocuments(
                    cleanId,
                    ctx.societyId,
                );
                console.log(
                    `[crud-servant][UPDATE] image replace: removed ${cleanup.documentsDeleted} doc(s), ${cleanup.storageDeleted} storage object(s)`,
                );
            } catch (err) {
                const msg = err instanceof Error
                    ? err.message
                    : "Unknown error";
                console.warn(
                    `[crud-servant][UPDATE] old image cleanup failed (continuing): ${msg}`,
                );
            }
            return prepareServantImage(
                cleanId,
                ctx.societyId,
                ctx.societyRegistrationNumber,
                body.servantImage!,
            );
        })()
        : Promise.resolve(null);

    const [updateRes, imgResult] = await Promise.all([
        updatePromise,
        imagePromise,
    ]);

    if (updateRes.error) {
        return buildError(
            "SERVER_ERROR",
            `Failed to update: ${updateRes.error.message}`,
            500,
        );
    }

    const documentResponse = imgResult ?? null;

    // Fetch updated row
    const { data: updated } = await supabaseAdmin
        .from("SSP_Servant")
        .select(`
            servant_id, servant_name, phone_number, address,
            role, shift_timing, gender, status, date_of_birth,
            id_proof_type, id_proof_number, is_recurring,
            scheduled_arrival, scheduled_departure, created_at, society
        `)
        .eq("servant_id", cleanId)
        .maybeSingle();

    console.log(`[crud-servant][UPDATE] TOTAL ${Date.now() - t0}ms`);

    return successResponse({
        servantUpdated: true,
        message: "Servant updated successfully.",
        servant: updated ? toResponse(updated as ServantRow) : null,
        document: documentResponse,
    });
}

async function handleDelete(
    body: CrudServantRequest,
    ctx: { societyId: string; roles: string[] },
): Promise<Response> {
    const t0 = Date.now();

    if (!hasAdminRole(ctx.roles)) {
        return buildError("FORBIDDEN", "Only Admin can delete servants.", 403);
    }

    const servantId = body.servantId ?? body.servantData?.servantId;
    if (!servantId?.trim()) {
        return buildError("BAD_REQUEST", "servantId is mandatory.", 400);
    }
    const cleanId = sanitizeString(servantId);

    const { data: existing, error: findErr } = await supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, society")
        .eq("servant_id", cleanId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) return buildError("SERVER_ERROR", findErr.message, 500);
    if (!existing) return buildError("NOT_FOUND", "Servant not found.", 404);
    if (existing.society !== ctx.societyId) {
        return buildError(
            "FORBIDDEN",
            "Servant does not belong to this society.",
            403,
        );
    }

    // Parallel: soft-delete + document cleanup
    const [docResult, delRes] = await Promise.all([
        deleteServantDocuments(cleanId, ctx.societyId).catch((err) => {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.warn(
                `[crud-servant][DELETE] document cleanup failed (continuing): ${msg}`,
            );
            return { documentsDeleted: 0, storageDeleted: 0, storageFailed: 0 };
        }),
        supabaseAdmin
            .from("SSP_Servant")
            .update({ deleted_at: new Date().toISOString() })
            .eq("servant_id", cleanId)
            .eq("society", ctx.societyId),
    ]);

    if (delRes.error) {
        return buildError(
            "SERVER_ERROR",
            `Failed to delete: ${delRes.error.message}`,
            500,
        );
    }

    console.log(`[crud-servant][DELETE] TOTAL ${Date.now() - t0}ms`);

    return successResponse({
        servantDeleted: true,
        message: "Servant deleted successfully.",
        servantId: cleanId,
        documentsDeleted: docResult.documentsDeleted,
        storageDeleted: docResult.storageDeleted,
    });
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
    requireAuth(async (req: Request, authCtx: AuthContext) => {
        if (req.method === "OPTIONS") {
            return new Response("ok", { headers: corsHeaders });
        }
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }

        const t0 = Date.now();
        let action: Action = "VIEW";

        try {
            const body = await parseRequestBody<CrudServantRequest>(req);
            if (!body) {
                return buildError(
                    "BAD_REQUEST",
                    "Request body is required.",
                    400,
                );
            }

            const rawAction = (body.action ?? "").toString().toUpperCase();
            if (!VALID_ACTIONS.includes(rawAction as Action)) {
                return buildError(
                    "BAD_REQUEST",
                    `action must be one of ${VALID_ACTIONS.join(", ")}`,
                    400,
                );
            }
            action = rawAction as Action;

            if (!body.societyRegistrationNumber?.trim()) {
                return buildError(
                    "BAD_REQUEST",
                    "societyRegistrationNumber is mandatory.",
                    400,
                );
            }

            const userId = authCtx.user.id;
            const cleanRegNum = sanitizeString(body.societyRegistrationNumber);

            const tCtx = Date.now();
            const ctxResult = await getContext(cleanRegNum, userId);
            if (!ctxResult.ok) {
                return buildError(
                    ctxResult.code,
                    ctxResult.message,
                    ctxResult.status,
                );
            }
            const ctxLatency = Date.now() - tCtx;

            if (action !== "VIEW" && !hasAdminRole(ctxResult.roles)) {
                return buildError(
                    "FORBIDDEN",
                    `Only Admin can perform ${action} on servants.`,
                    403,
                );
            }

            let response: Response;
            const tAction = Date.now();

            switch (action) {
                case "CREATE":
                    response = await handleCreate(body, authCtx, {
                        societyId: ctxResult.societyId,
                        societyRegistrationNumber: cleanRegNum,
                    });
                    break;
                case "VIEW":
                    response = await handleView(body, {
                        societyId: ctxResult.societyId,
                        roles: ctxResult.roles,
                    });
                    break;
                case "UPDATE":
                    response = await handleUpdate(body, authCtx, {
                        societyId: ctxResult.societyId,
                        societyRegistrationNumber: cleanRegNum,
                        roles: ctxResult.roles,
                    });
                    break;
                case "DELETE":
                    response = await handleDelete(body, {
                        societyId: ctxResult.societyId,
                        roles: ctxResult.roles,
                    });
                    break;
            }

            console.log(
                `[crud-servant][${action}] ctx=${ctxLatency}ms action=${
                    Date.now() - tAction
                }ms total=${Date.now() - t0}ms`,
            );

            return response!;
        } catch (error) {
            const err = error as Error;
            console.error(`[crud-servant][${action}] ERROR:`, err.message);
            return buildError(
                "SERVER_ERROR",
                err.message || "Failed to process servant request",
                500,
            );
        }
    }),
);
