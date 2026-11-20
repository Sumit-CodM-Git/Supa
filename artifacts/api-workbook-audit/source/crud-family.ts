import { resolveResidentFlatType, residentFlatTypeFields, ResidentFlatTypeError } from "../_shared/resident-flat-type.ts";
import { contactParkingSlot } from "../_shared/contact.ts";
import { normalizeParkingSlot } from "../_shared/contact.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient, } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { verify as jwtVerify } from "https://deno.land/x/djwt@v2.8/mod.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";
const SUPABASE_JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ??
    Deno.env.get("JWT_SECRET") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
    .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const VALID_ACTIONS = [
    "CREATE",
    "VIEW",
    "UPDATE",
    "DELETE",
    "RESTORE",
    "CHANGE_PRIMARY",
] as const;
type Action = typeof VALID_ACTIONS[number];
const FAMILY_ROLE: string[] = ["resident"];
const VALID_OWNERSHIP = ["primary", "secondary"] as const;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase env vars");
}
if (!SUPABASE_JWT_SECRET)
    console.error("Missing SUPABASE_JWT_SECRET");
const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch },
});
let _jwtKeyPromise: Promise<CryptoKey> | null = null;
function getJwtKey(): Promise<CryptoKey> {
    if (!_jwtKeyPromise) {
        _jwtKeyPromise = crypto.subtle.importKey("raw", new TextEncoder().encode(SUPABASE_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    }
    return _jwtKeyPromise;
}
interface CallerCtx {
    authUserId: string;
    callerUserId: string;
    callerSocietyId: string;
    callerFlat: string;
    callerFlatTypeId: string | null;
    callerBlock: string | null;
    callerTower: string | null;
    callerOwnership: string;
    callerRoles: string[];
}
interface CrudFamilyRequest {
    flatTypeId?: string | null;
    flatType?: string | null;
    action: Action;
    memberName?: string;
    memberPhone?: string;
    idProofType?: string;
    idProofNumber?: string;
    relationship?: string;
    email?: string;
    gender?: string;
    occupation?: string;
    description?: string;
    whatsAppPhone?: string;
    emergencyPhone?: string;
    vehicleNumber?: string;
    parkingSlot?: string | null;
    parking_slot?: string | null;
    vehicleType?: string;
    role?: string | string[];
    status?: "active" | "inactive" | boolean;
    ownershipType?: string;
    targetResidentId?: string;
    filters?: {
        status?: string | boolean;
        role?: string;
        ownershipType?: string;
        relationship?: string;
        search?: string;
    };
    sort?: {
        by?: string;
        dir?: "asc" | "desc";
    };
    pagination?: {
        page?: number;
        pageSize?: number;
    };
    includeDeleted?: boolean;
    idempotencyKey?: string;
}
interface ContextSuccess {
    ok: true;
    ctx: CallerCtx;
}
interface ContextFailure {
    ok: false;
    code: string;
    message: string;
    status: number;
}
function corsHeaders(origin: string | null): Record<string, string> {
    let allow = "*";
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS[0] !== "*") {
        allow = origin && ALLOWED_ORIGINS.includes(origin)
            ? origin
            : ALLOWED_ORIGINS[0];
    }
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}
function buildSuccess(req: Request, data: unknown): Response {
    return new Response(JSON.stringify({ success: true, data, errorResponse: null }), {
        status: 200,
        headers: {
            ...corsHeaders(req.headers.get("origin")),
            "Content-Type": "application/json",
        },
    });
}
function buildError(req: Request, code: string, message: string, status = 400): Response {
    return new Response(JSON.stringify({
        success: false,
        data: null,
        errorResponse: {
            errorCode: code,
            message,
            timestamp: new Date().toISOString(),
        },
    }), {
        status,
        headers: {
            ...corsHeaders(req.headers.get("origin")),
            "Content-Type": "application/json",
        },
    });
}
function log(level: "info" | "warn" | "error", action: string, message: string, meta: Record<string, unknown> = {}) {
    const line = JSON.stringify({
        level,
        action,
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    });
    if (level === "error")
        console.error(line);
    else if (level === "warn")
        console.warn(line);
    else
        console.log(line);
}
function cleanText(v: unknown, max = 500): string {
    if (v === null || v === undefined)
        return "";
    return String(v).trim().slice(0, max);
}
function cleanPhone(v: unknown): string {
    return String(v ?? "").trim().replace(/\s+/g, "").slice(0, 20);
}
function isValidPhone(p: string): boolean {
    return /^[0-9]{10,15}$/.test(p);
}
function isPrimaryOwnership(value: unknown): boolean {
    return String(value ?? "").trim().toLowerCase() === "primary";
}
function normalizeOwnership(input: unknown): string | null {
    if (input === null || input === undefined)
        return null;
    const v = String(input).trim().toLowerCase();
    if (!VALID_OWNERSHIP.includes(v as typeof VALID_OWNERSHIP[number])) {
        return null;
    }
    return v;
}
function normalizeStatus(input: unknown): boolean | null {
    if (input === null || input === undefined)
        return null;
    if (input === true || input === "active")
        return true;
    if (input === false || input === "inactive")
        return false;
    return null;
}
async function authenticate(req: Request): Promise<ContextSuccess | ContextFailure> {
    const h = req.headers.get("Authorization") ?? "";
    if (!h.startsWith("Bearer ")) {
        return {
            ok: false,
            code: "UNAUTHORIZED",
            message: "Missing bearer token.",
            status: 401,
        };
    }
    const token = h.slice(7).trim();
    if (!token) {
        return {
            ok: false,
            code: "UNAUTHORIZED",
            message: "Missing bearer token.",
            status: 401,
        };
    }
    if (!SUPABASE_JWT_SECRET) {
        return {
            ok: false,
            code: "SERVER_ERROR",
            message: "Auth not configured.",
            status: 500,
        };
    }
    let payload: {
        sub?: string;
        user_id?: string;
    };
    try {
        const key = await getJwtKey();
        payload = await jwtVerify(token, key) as typeof payload;
    }
    catch {
        return {
            ok: false,
            code: "UNAUTHORIZED",
            message: "Invalid or expired token.",
            status: 401,
        };
    }
    const authUserId = String(payload.sub ?? "").trim();
    const callerUserId = String(payload.user_id ?? "").trim();
    if (!authUserId || !callerUserId) {
        return {
            ok: false,
            code: "UNAUTHORIZED",
            message: "Token missing subject/user_id.",
            status: 401,
        };
    }
    const { data, error } = await admin
        .from("SSP_Society_User")
        .select("user_id, society, unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type), block, tower, user_ownership_type, role, deleted_at")
        .eq("user_id", callerUserId)
        .maybeSingle();
    if (error || !data) {
        return {
            ok: false,
            code: "UNAUTHORIZED",
            message: "Caller not found.",
            status: 401,
        };
    }
    if (data.deleted_at) {
        return {
            ok: false,
            code: "UNAUTHORIZED",
            message: "Account is deactivated.",
            status: 401,
        };
    }
    return {
        ok: true,
        ctx: {
            authUserId,
            callerUserId,
            callerSocietyId: String(data.society ?? ""),
            callerFlatTypeId: data.flat_type_id ?? null,
            callerFlat: String(data.unit_flat_number ?? "").trim(),
            callerBlock: data.block ?? null,
            callerTower: data.tower ?? null,
            callerOwnership: String(data.user_ownership_type ?? "").trim()
                .toLowerCase(),
            callerRoles: Array.isArray(data.role) ? data.role : [],
        },
    };
}
function sameFlat(target: Record<string, unknown>, ctx: CallerCtx): boolean {
    return target.society === ctx.callerSocietyId &&
        target.unit_flat_number === ctx.callerFlat &&
        (target.block ?? null) === (ctx.callerBlock ?? null) &&
        (target.tower ?? null) === (ctx.callerTower ?? null);
}
async function handleCreate(req: Request, ctx: CallerCtx, body: CrudFamilyRequest): Promise<Response> {
    const t0 = Date.now();
    if (ctx.callerOwnership !== "primary") {
        return buildError(req, "FORBIDDEN", "Only the primary resident can add family members.", 403);
    }
    const name = cleanText(body.memberName, 150);
    const phone = cleanPhone(body.memberPhone);
    const idProofType = cleanText(body.idProofType, 50);
    const idProofNumber = cleanText(body.idProofNumber, 100);
    const relationship = cleanText(body.relationship, 30);
    if (!name) {
        return buildError(req, "BAD_REQUEST", "memberName is required.", 400);
    }
    if (!phone || !isValidPhone(phone)) {
        return buildError(req, "BAD_REQUEST", "Valid memberPhone (10-15 digits) is required.", 400);
    }
    if (!idProofType) {
        return buildError(req, "BAD_REQUEST", "idProofType is required.", 400);
    }
    if (!idProofNumber) {
        return buildError(req, "BAD_REQUEST", "idProofNumber is required.", 400);
    }
    if (!relationship) {
        return buildError(req, "BAD_REQUEST", "relationship is required.", 400);
    }
    const normalizedStatus = body.status === undefined
        ? true
        : normalizeStatus(body.status);
    if (normalizedStatus === null) {
        return buildError(req, "BAD_REQUEST", 'status must be "active" or "inactive".', 400);
    }
    const tChecks = Date.now();
    const idemPromise = body.idempotencyKey
        ? admin
            .from("SSP_Society_User")
            .select("user_id, created_at, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type)")
            .eq("idempotency_key", body.idempotencyKey)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);
    const flatMembersPromise = admin
        .from("SSP_Society_User")
        .select(`
            user_id,
            contact:SSP_Contact!inner (parking_slot, phone )
        `)
        .eq("society", ctx.callerSocietyId)
        .eq("unit_flat_number", ctx.callerFlat)
        .is("deleted_at", null);
    const existingContactPromise = admin
        .from("SSP_Contact")
        .select("contact_id, parking_slot")
        .eq("society", ctx.callerSocietyId)
        .eq("phone", phone)
        .maybeSingle();
    const [idemRes, flatMembersRes, existingContactRes] = await Promise.all([
        idemPromise,
        flatMembersPromise,
        existingContactPromise,
    ]);
    console.log(`[crud-family][CREATE] parallel checks ${Date.now() - tChecks}ms`);
    if (idemRes.data) {
        return buildSuccess(req, {
            familyUpdate: {
                updated: true,
                action: "CREATE",
                residentId: idemRes.data.user_id,
                ...residentFlatTypeFields(idemRes.data),
                idempotentReplay: true,
                createdAt: idemRes.data.created_at,
            },
        });
    }
    const dup = (flatMembersRes.data ?? []).find((u) => {
        const c = u.contact as {
            phone?: string;
        } | {
            phone?: string;
        }[] | null;
        const contact = Array.isArray(c) ? c[0] : c;
        return cleanPhone(contact?.phone) === phone;
    });
    if (dup) {
        return buildError(req, "DUPLICATE_MEMBER", `A member with phone ${phone} already exists in this flat.`, 400);
    }
    const explicitFlatType = body.flatTypeId !== undefined || body.flatType !== undefined;
    let resolvedFlatType;
    try {
        resolvedFlatType = await resolveResidentFlatType(admin, ctx.callerSocietyId, explicitFlatType ? body : { flatTypeId: ctx.callerFlatTypeId });
    }
    catch (error) {
        if (explicitFlatType || !(error instanceof ResidentFlatTypeError))
            throw error;
        resolvedFlatType = { flatTypeId: null, flatType: null };
    }
    let contactId: string;
    if (existingContactRes.data?.contact_id) {
        contactId = existingContactRes.data.contact_id;
        const parkingSlot = normalizeParkingSlot(body.parkingSlot !== undefined ? body.parkingSlot : body.parking_slot);
        if (parkingSlot !== undefined) {
            const { error: parkingErr } = await admin.from("SSP_Contact")
                .update({ parking_slot: parkingSlot }).eq("contact_id", contactId);
            if (parkingErr)
                return buildError(req, "SERVER_ERROR", "Failed to update contact parking slot.", 500);
        }
    }
    else {
        const { data: newContact, error: cErr } = await admin
            .from("SSP_Contact")
            .insert({
            name,
            phone,
            society: ctx.callerSocietyId,
            email: cleanText(body.email, 150) || null,
            gender: cleanText(body.gender, 20) || null,
            occupation: cleanText(body.occupation, 100) || null,
            description: cleanText(body.description, 500) || null,
            id_proof_type: idProofType,
            id_proof_number: idProofNumber,
            whatsapp_phone: cleanPhone(body.whatsAppPhone) || null,
            emergency_phone: cleanPhone(body.emergencyPhone) || null,
            vehicle_registration_number: cleanText(body.vehicleNumber, 30) || null,
            vehicle_type: cleanText(body.vehicleType, 30) || null,
            parking_slot: normalizeParkingSlot(body.parkingSlot !== undefined ? body.parkingSlot : body.parking_slot) ?? null,
        })
            .select("contact_id")
            .single();
        if (cErr || !newContact) {
            log("error", "crud-family.CREATE", "Contact insert failed", {
                err: cErr?.message,
            });
            return buildError(req, "SERVER_ERROR", "Failed to create contact.", 500);
        }
        contactId = newContact.contact_id;
    }
    const { data: newUser, error: uErr } = await admin
        .from("SSP_Society_User")
        .insert({
        flat_type_id: resolvedFlatType?.flatTypeId ?? null,
        contact: contactId,
        society: ctx.callerSocietyId,
        unit_flat_number: ctx.callerFlat,
        block: ctx.callerBlock,
        tower: ctx.callerTower,
        role: FAMILY_ROLE,
        user_ownership_type: "secondary",
        relationship,
        status: normalizedStatus,
        deleted_at: null,
        idempotency_key: body.idempotencyKey ?? null,
    })
        .select("user_id")
        .single();
    if (uErr || !newUser) {
        log("error", "crud-family.CREATE", "User insert failed", {
            err: uErr?.message,
        });
        return buildError(req, "SERVER_ERROR", "Failed to create member.", 500);
    }
    console.log(`[crud-family][CREATE] TOTAL ${Date.now() - t0}ms`);
    return buildSuccess(req, {
        familyUpdate: {
            updated: true,
            action: "CREATE",
            ...(resolvedFlatType ?? { flatTypeId: null, flatType: null }),
            residentId: newUser.user_id,
            contactId,
            parkingSlot: (body.parkingSlot !== undefined || body.parking_slot !== undefined)
                ? normalizeParkingSlot(body.parkingSlot !== undefined ? body.parkingSlot : body.parking_slot)
                : existingContactRes.data?.parking_slot ?? null,
        },
    });
}
async function handleView(req: Request, ctx: CallerCtx, body: CrudFamilyRequest): Promise<Response> {
    const t0 = Date.now();
    const page = Math.max(1, Number(body.pagination?.page ?? 1) | 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(body.pagination?.pageSize ?? DEFAULT_PAGE_SIZE) | 0));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const includeDeleted = body.includeDeleted === true;
    let q = admin
        .from("SSP_Society_User")
        .select(`
            user_id,
            role,
            user_ownership_type,
            relationship,
            status,
            deleted_at,
            unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type),
            tower,
            block,
            created_at,
            contact:SSP_Contact!inner(parking_slot,
                contact_id, name, phone, email, gender, occupation, description,
                id_proof_type, id_proof_number, whatsapp_phone, emergency_phone,
                vehicle_registration_number, vehicle_type, created_at
            )
        `, { count: "exact" })
        .eq("society", ctx.callerSocietyId)
        .eq("unit_flat_number", ctx.callerFlat);
    if (ctx.callerBlock)
        q = q.eq("block", ctx.callerBlock);
    else
        q = q.is("block", null);
    if (ctx.callerTower)
        q = q.eq("tower", ctx.callerTower);
    else
        q = q.is("tower", null);
    if (!includeDeleted)
        q = q.is("deleted_at", null);
    const f = body.filters ?? {};
    if (f.status === "active")
        q = q.eq("status", true);
    else if (f.status === "inactive")
        q = q.eq("status", false);
    else if (typeof f.status === "boolean")
        q = q.eq("status", f.status);
    if (f.ownershipType)
        q = q.eq("user_ownership_type", f.ownershipType);
    if (f.relationship)
        q = q.eq("relationship", f.relationship);
    if (f.role)
        q = q.contains("role", [f.role]);
    if (f.search) {
        const s = cleanText(f.search, 60).replace(/[%_,()]/g, "");
        if (s) {
            q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`, {
                foreignTable: "SSP_Contact",
            });
        }
    }
    const sortBy = body.sort?.by ?? "ownershipType";
    const ascending = body.sort?.dir !== "desc";
    if (sortBy === "name") {
        q = q.order("name", { ascending, foreignTable: "SSP_Contact" });
    }
    else if (sortBy === "createdAt") {
        q = q.order("created_at", { ascending });
    }
    else if (sortBy === "relationship") {
        q = q.order("relationship", { ascending, nullsFirst: false });
    }
    else {
        q = q.order("user_ownership_type", { ascending: true });
        q = q.order("created_at", { ascending: false });
    }
    q = q.range(from, to);
    const tParallel = Date.now();
    const societyPromise = admin
        .from("SSP_Society")
        .select("society_id, society_name, registration_number")
        .eq("society_id", ctx.callerSocietyId)
        .maybeSingle();
    const blockPromise = ctx.callerBlock
        ? admin
            .from("SSP_Block")
            .select("block_name")
            .eq("block_id", ctx.callerBlock)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);
    const towerPromise = ctx.callerTower
        ? admin
            .from("SSP_Tower")
            .select("name")
            .eq("tower_id", ctx.callerTower)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);
    const [mainRes, societyRes, blockRes, towerRes] = await Promise.all([
        q,
        societyPromise,
        blockPromise,
        towerPromise,
    ]);
    console.log(`[crud-family][VIEW] parallel queries ${Date.now() - tParallel}ms`);
    if (mainRes.error) {
        log("error", "crud-family.VIEW", "Query failed", {
            err: mainRes.error.message,
        });
        return buildError(req, "SERVER_ERROR", "Failed to fetch family members.", 500);
    }
    const rows = (mainRes.data ?? []) as Array<Record<string, unknown>>;
    const totalCount = mainRes.count ?? rows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const members = rows.map((m) => {
        const c = (Array.isArray(m.contact) ? m.contact[0] : m.contact) ?? {};
        const cObj = c as Record<string, unknown>;
        const roles = Array.isArray(m.role) ? m.role : (m.role ? [m.role] : []);
        const ownership = String(m.user_ownership_type ?? "").trim();
        return {
            parkingSlot: contactParkingSlot(cObj),
            residentId: m.user_id ?? "",
            name: cObj.name ?? "",
            phone: cObj.phone ?? "",
            email: cObj.email ?? "",
            gender: cObj.gender ?? "",
            occupation: cObj.occupation ?? "",
            description: cObj.description ?? "",
            idProofType: cObj.id_proof_type ?? "",
            idProofNumber: cObj.id_proof_number ?? "",
            whatsAppPhone: cObj.whatsapp_phone ?? "",
            emergencyPhone: cObj.emergency_phone ?? "",
            vehicleNumber: cObj.vehicle_registration_number ?? "",
            vehicleType: cObj.vehicle_type ?? "",
            contactId: cObj.contact_id ?? "",
            role: roles,
            ownershipType: ownership,
            relationship: m.relationship ?? null,
            isPrimary: ownership.toLowerCase() === "primary",
            status: m.status === false ? "inactive" : "active",
            deletedAt: m.deleted_at ?? null,
            towerId: m.tower ?? null,
            blockId: m.block ?? null,
            ...residentFlatTypeFields(m),
            flatNumber: m.unit_flat_number ?? "",
            createdAt: cObj.created_at ?? m.created_at ?? null,
        };
    });
    const society = societyRes.data;
    const blockName = blockRes.data?.block_name ?? null;
    const towerName = towerRes.data?.name ?? null;
    console.log(`[crud-family][VIEW] TOTAL ${Date.now() - t0}ms`);
    return buildSuccess(req, {
        familyMembers: members,
        flatContext: {
            societyId: ctx.callerSocietyId,
            societyName: society?.society_name ?? null,
            registrationNumber: society?.registration_number ?? null,
            blockId: ctx.callerBlock,
            blockName,
            towerId: ctx.callerTower,
            towerName,
            flatNumber: ctx.callerFlat,
        },
        pagination: {
            page,
            pageSize,
            totalCount,
            totalPages,
            hasMore: page < totalPages,
        },
    });
}
async function handleUpdate(req: Request, ctx: CallerCtx, body: CrudFamilyRequest): Promise<Response> {
    const t0 = Date.now();
    const targetId = cleanText(body.targetResidentId, 50);
    if (!targetId) {
        return buildError(req, "BAD_REQUEST", "targetResidentId is required.", 400);
    }
    const { data: target, error: tErr } = await admin
        .from("SSP_Society_User")
        .select("user_id, society, unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type), block, tower, contact, user_ownership_type, deleted_at")
        .eq("user_id", targetId)
        .maybeSingle();
    if (tErr || !target) {
        return buildError(req, "NOT_FOUND", "Member not found.", 404);
    }
    if (!sameFlat(target, ctx)) {
        return buildError(req, "FORBIDDEN", "Target member is not in your flat.", 403);
    }
    const isSelf = ctx.callerUserId === target.user_id;
    const isPrimary = ctx.callerOwnership === "primary";
    if (!isPrimary && !isSelf) {
        return buildError(req, "FORBIDDEN", "Only the primary resident can edit other members.", 403);
    }
    const cu: Record<string, unknown> = {};
    const parkingSlot = normalizeParkingSlot(body.parkingSlot !== undefined ? body.parkingSlot : body.parking_slot);
    if (parkingSlot !== undefined)
        cu.parking_slot = parkingSlot;
    if (body.memberName !== undefined) {
        const v = cleanText(body.memberName, 150);
        if (!v) {
            return buildError(req, "BAD_REQUEST", "memberName cannot be empty.", 400);
        }
        cu.name = v;
    }
    if (body.memberPhone !== undefined) {
        const v = cleanPhone(body.memberPhone);
        if (!isValidPhone(v)) {
            return buildError(req, "BAD_REQUEST", "Invalid phone number.", 400);
        }
        cu.phone = v;
    }
    if (body.email !== undefined)
        cu.email = cleanText(body.email, 150) || null;
    if (body.gender !== undefined) {
        cu.gender = cleanText(body.gender, 20) || null;
    }
    if (body.occupation !== undefined) {
        cu.occupation = cleanText(body.occupation, 100) || null;
    }
    if (body.description !== undefined) {
        cu.description = cleanText(body.description, 500) || null;
    }
    if (body.idProofType !== undefined) {
        cu.id_proof_type = cleanText(body.idProofType, 50) || null;
    }
    if (body.idProofNumber !== undefined) {
        cu.id_proof_number = cleanText(body.idProofNumber, 100) || null;
    }
    if (body.whatsAppPhone !== undefined) {
        cu.whatsapp_phone = cleanPhone(body.whatsAppPhone) || null;
    }
    if (body.emergencyPhone !== undefined) {
        cu.emergency_phone = cleanPhone(body.emergencyPhone) || null;
    }
    if (body.vehicleNumber !== undefined) {
        cu.vehicle_registration_number = cleanText(body.vehicleNumber, 30) ||
            null;
    }
    if (body.vehicleType !== undefined) {
        cu.vehicle_type = cleanText(body.vehicleType, 30) || null;
    }
    if (!isPrimary && (body.flatTypeId !== undefined || body.flatType !== undefined))
        return buildError(req, "FORBIDDEN", "Only the primary resident can change flat type assignments.", 403);
    const resolvedFlatType = await resolveResidentFlatType(admin, ctx.callerSocietyId, body);
    const uu: Record<string, unknown> = {};
    if (resolvedFlatType)
        uu.flat_type_id = resolvedFlatType.flatTypeId;
    if (isPrimary) {
        if (body.relationship !== undefined) {
            const v = cleanText(body.relationship, 30);
            uu.relationship = v || null;
        }
        if (body.status !== undefined) {
            const s = normalizeStatus(body.status);
            if (s === null) {
                return buildError(req, "BAD_REQUEST", 'status must be "active" or "inactive".', 400);
            }
            uu.status = s;
        }
        uu.role = FAMILY_ROLE;
    }
    if (body.ownershipType !== undefined) {
        const requested = normalizeOwnership(body.ownershipType);
        if (requested === null) {
            return buildError(req, "BAD_REQUEST", "ownershipType must be 'primary' or 'secondary'.", 400);
        }
        const current = String(target.user_ownership_type ?? "").trim()
            .toLowerCase();
        if (current === "primary" && requested !== "primary") {
            return buildError(req, "FORBIDDEN", "Primary member cannot be downgraded. Use CHANGE_PRIMARY to hand off first.", 403);
        }
        if (current !== "primary" && requested === "primary") {
            return buildError(req, "BAD_REQUEST", "Use CHANGE_PRIMARY to promote a member to primary.", 400);
        }
    }
    const tWrite = Date.now();
    const writes: Promise<any>[] = [];
    if (Object.keys(cu).length > 0 && target.contact) {
        writes.push(admin.from("SSP_Contact").update(cu).eq("contact_id", target.contact));
    }
    if (Object.keys(uu).length > 0) {
        writes.push(admin.from("SSP_Society_User").update(uu).eq("user_id", targetId));
    }
    if (writes.length > 0) {
        const results = await Promise.all(writes);
        for (let i = 0; i < results.length; i++) {
            const r = results[i] as {
                error?: {
                    message: string;
                };
            };
            if (r?.error) {
                const isContact = Object.keys(cu).length > 0 && i === 0 &&
                    target.contact;
                if (isContact) {
                    log("error", "crud-family.UPDATE", "Contact update failed", { err: r.error.message });
                    return buildError(req, "SERVER_ERROR", "Failed to update contact.", 500);
                }
                log("error", "crud-family.UPDATE", "User update failed", {
                    err: r.error.message,
                });
                return buildError(req, "SERVER_ERROR", "Failed to update member.", 500);
            }
        }
    }
    console.log(`[crud-family][UPDATE] writes ${Date.now() - tWrite}ms`);
    console.log(`[crud-family][UPDATE] TOTAL ${Date.now() - t0}ms`);
    return buildSuccess(req, {
        familyUpdate: { updated: true, action: "UPDATE", residentId: targetId, ...(resolvedFlatType ?? residentFlatTypeFields(target)), ...(parkingSlot !== undefined ? { parkingSlot } : {}) },
    });
}
async function handleDelete(req: Request, ctx: CallerCtx, body: CrudFamilyRequest): Promise<Response> {
    const t0 = Date.now();
    if (ctx.callerOwnership !== "primary") {
        return buildError(req, "FORBIDDEN", "Only the primary resident can remove members.", 403);
    }
    const targetId = cleanText(body.targetResidentId, 50);
    if (!targetId) {
        return buildError(req, "BAD_REQUEST", "targetResidentId is required.", 400);
    }
    if (targetId === ctx.callerUserId) {
        return buildError(req, "BAD_REQUEST", "You cannot delete yourself. Change primary first.", 400);
    }
    const { data: target } = await admin
        .from("SSP_Society_User")
        .select("user_id, society, unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type), block, tower, user_ownership_type, deleted_at")
        .eq("user_id", targetId)
        .maybeSingle();
    if (!target)
        return buildError(req, "NOT_FOUND", "Member not found.", 404);
    if (!sameFlat(target, ctx)) {
        return buildError(req, "FORBIDDEN", "Target member is not in your flat.", 403);
    }
    if (isPrimaryOwnership(target.user_ownership_type)) {
        return buildError(req, "BAD_REQUEST", "Primary member cannot be removed. Change primary first.", 400);
    }
    if (target.deleted_at) {
        return buildError(req, "CONFLICT", "Member is already removed.", 409);
    }
    const [uRes] = await Promise.all([
        admin
            .from("SSP_Society_User")
            .update({ deleted_at: new Date().toISOString(), status: false })
            .eq("user_id", targetId),
        admin.from("SSP_User_Device").delete().eq("user_type", "society_user")
            .eq("user_id", targetId),
        admin.from("SSP_Society_Servant").delete().eq("society_user", targetId),
    ]);
    if (uRes.error) {
        log("error", "crud-family.DELETE", "Soft delete failed", {
            err: uRes.error.message,
        });
        return buildError(req, "SERVER_ERROR", "Failed to remove member.", 500);
    }
    console.log(`[crud-family][DELETE] TOTAL ${Date.now() - t0}ms`);
    return buildSuccess(req, {
        familyUpdate: {
            updated: true,
            action: "DELETE",
            ...residentFlatTypeFields(target),
            residentId: targetId,
            soft: true,
        },
    });
}
async function handleRestore(req: Request, ctx: CallerCtx, body: CrudFamilyRequest): Promise<Response> {
    if (ctx.callerOwnership !== "primary") {
        return buildError(req, "FORBIDDEN", "Only the primary resident can restore members.", 403);
    }
    const targetId = cleanText(body.targetResidentId, 50);
    if (!targetId) {
        return buildError(req, "BAD_REQUEST", "targetResidentId is required.", 400);
    }
    const { data: target } = await admin
        .from("SSP_Society_User")
        .select("user_id, society, unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type), block, tower, deleted_at")
        .eq("user_id", targetId)
        .maybeSingle();
    if (!target)
        return buildError(req, "NOT_FOUND", "Member not found.", 404);
    if (!sameFlat(target, ctx)) {
        return buildError(req, "FORBIDDEN", "Target member is not in your flat.", 403);
    }
    if (!target.deleted_at) {
        return buildError(req, "CONFLICT", "Member is not currently removed.", 409);
    }
    const { error: uErr } = await admin
        .from("SSP_Society_User")
        .update({ deleted_at: null, status: true, role: FAMILY_ROLE })
        .eq("user_id", targetId);
    if (uErr) {
        log("error", "crud-family.RESTORE", "Restore failed", {
            err: uErr.message,
        });
        return buildError(req, "SERVER_ERROR", "Failed to restore member.", 500);
    }
    return buildSuccess(req, {
        familyUpdate: {
            updated: true,
            action: "RESTORE",
            ...residentFlatTypeFields(target),
            residentId: targetId,
        },
    });
}
async function handleChangePrimary(req: Request, ctx: CallerCtx, body: CrudFamilyRequest): Promise<Response> {
    const t0 = Date.now();
    if (ctx.callerOwnership !== "primary") {
        return buildError(req, "FORBIDDEN", "Only the primary resident can change primary.", 403);
    }
    const targetId = cleanText(body.targetResidentId, 50);
    if (!targetId) {
        return buildError(req, "BAD_REQUEST", "targetResidentId is required.", 400);
    }
    const { data: target } = await admin
        .from("SSP_Society_User")
        .select("user_id, society, unit_flat_number, flat_type_id, flatTypeRecord:SSP_Flat_Type!flat_type_id(flat_type), block, tower, deleted_at")
        .eq("user_id", targetId)
        .maybeSingle();
    if (!target) {
        return buildError(req, "NOT_FOUND", "Target member not found.", 404);
    }
    const flatMatch = target.society === ctx.callerSocietyId &&
        target.unit_flat_number === ctx.callerFlat &&
        (target.block ?? null) === (ctx.callerBlock ?? null) &&
        (target.tower ?? null) === (ctx.callerTower ?? null) &&
        target.deleted_at === null;
    if (!flatMatch) {
        return buildError(req, "FORBIDDEN", "Target member is not in your flat.", 403);
    }
    let dq = admin
        .from("SSP_Society_User")
        .update({ user_ownership_type: "secondary", role: FAMILY_ROLE })
        .eq("society", ctx.callerSocietyId)
        .eq("unit_flat_number", ctx.callerFlat)
        .is("deleted_at", null);
    if (ctx.callerBlock)
        dq = dq.eq("block", ctx.callerBlock);
    else
        dq = dq.is("block", null);
    if (ctx.callerTower)
        dq = dq.eq("tower", ctx.callerTower);
    else
        dq = dq.is("tower", null);
    const dRes = await dq;
    if (dRes.error) {
        log("error", "crud-family.CHANGE_PRIMARY", "Downgrade failed", {
            err: dRes.error.message,
        });
        return buildError(req, "SERVER_ERROR", "Failed to reset primary status.", 500);
    }
    const uRes = await admin
        .from("SSP_Society_User")
        .update({
        user_ownership_type: "primary",
        relationship: null,
        role: FAMILY_ROLE,
    })
        .eq("user_id", targetId);
    if (uRes.error) {
        log("error", "crud-family.CHANGE_PRIMARY", "Upgrade failed", {
            err: uRes.error.message,
        });
        await admin
            .from("SSP_Society_User")
            .update({ user_ownership_type: "primary" })
            .eq("user_id", ctx.callerUserId);
        return buildError(req, "SERVER_ERROR", "Failed to promote member.", 500);
    }
    console.log(`[crud-family][CHANGE_PRIMARY] TOTAL ${Date.now() - t0}ms`);
    return buildSuccess(req, {
        familyUpdate: {
            updated: true,
            action: "CHANGE_PRIMARY",
            residentId: targetId,
        },
    });
}
serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: corsHeaders(req.headers.get("origin")),
        });
    }
    if (req.method !== "POST") {
        return buildError(req, "METHOD_NOT_ALLOWED", "Only POST allowed.", 405);
    }
    const t0 = Date.now();
    let action: Action = "VIEW";
    try {
        const [body, auth] = await Promise.all([
            req.json().catch(() => null) as Promise<CrudFamilyRequest | null>,
            authenticate(req),
        ]);
        if (!body) {
            return buildError(req, "BAD_REQUEST", "Request body is required.", 400);
        }
        if (!body.action) {
            return buildError(req, "BAD_REQUEST", "action is required.", 400);
        }
        const rawAction = String(body.action).toUpperCase();
        if (!VALID_ACTIONS.includes(rawAction as Action)) {
            return buildError(req, "BAD_REQUEST", `action must be one of ${VALID_ACTIONS.join(", ")}`, 400);
        }
        action = rawAction as Action;
        if (!auth.ok) {
            return buildError(req, auth.code, auth.message, auth.status);
        }
        const tAction = Date.now();
        let response: Response;
        switch (action) {
            case "CREATE":
                response = await handleCreate(req, auth.ctx, body);
                break;
            case "VIEW":
                response = await handleView(req, auth.ctx, body);
                break;
            case "UPDATE":
                response = await handleUpdate(req, auth.ctx, body);
                break;
            case "DELETE":
                response = await handleDelete(req, auth.ctx, body);
                break;
            case "RESTORE":
                response = await handleRestore(req, auth.ctx, body);
                break;
            case "CHANGE_PRIMARY":
                response = await handleChangePrimary(req, auth.ctx, body);
                break;
        }
        log("info", "crud-family", `OK`, {
            action,
            caller: auth.ctx.callerUserId,
            actionMs: Date.now() - tAction,
            totalMs: Date.now() - t0,
        });
        return response!;
    }
    catch (e: unknown) {
        if (e instanceof ResidentFlatTypeError)
            return buildError(req, "INVALID_PARAMETERS", e.message, 400);
        const msg = e instanceof Error ? e.message : "Unknown error";
        log("error", "crud-family", "Unhandled", {
            action,
            err: msg,
            ms: Date.now() - t0,
        });
        return buildError(req, "SERVER_ERROR", "Internal server error.", 500);
    }
});
