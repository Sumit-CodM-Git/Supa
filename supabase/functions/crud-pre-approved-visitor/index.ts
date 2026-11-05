// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// manage-pre-approved-visitor
// Actions: CREATE | VIEW | UPDATE | DELETE
// Resident-side API for pre-approved visitors
// Optimized: cached JWT key, parallel I/O
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
    createClient,
    SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { verify as jwtVerify } from "https://deno.land/x/djwt@v2.8/mod.ts";

import { requireFeature } from "../_shared/entitlements.ts";

// ============================================
// CONFIG
// ============================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";
const SUPABASE_JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ??
    Deno.env.get("JWT_SECRET") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
    .split(",").map((s) => s.trim()).filter(Boolean);

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const SIGNED_URL_TTL = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const VALID_ACTIONS = ["CREATE", "VIEW", "UPDATE", "DELETE"] as const;
type Action = typeof VALID_ACTIONS[number];

const VISITOR_ROLE = "visitor";
const VALID_APPROVAL_STATUS = ["pending", "approved", "rejected"] as const;

const BUCKET_NAME = "society-documents";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase env vars");
}
if (!SUPABASE_JWT_SECRET) console.error("Missing SUPABASE_JWT_SECRET");

const admin: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: { persistSession: false },
        global: { fetch },
    },
);

const urlCache = new Map<string, { url: string; expiresAt: number }>();

const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
});

// ============================================
// WARM JWT KEY (module-scope, cached)
// ============================================
let _jwtKeyPromise: Promise<CryptoKey> | null = null;
function getJwtKey(): Promise<CryptoKey> {
    if (!_jwtKeyPromise) {
        _jwtKeyPromise = crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(SUPABASE_JWT_SECRET),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"],
        );
    }
    return _jwtKeyPromise;
}

// ============================================
// TYPES
// ============================================
interface CallerCtx {
    authUserId: string;
    callerUserId: string;
    callerSocietyId: string;
    callerFlat: string;
    callerBlock: string | null;
    callerTower: string | null;
}

interface ManageRequest {
    action: Action;
    visitorData?: {
        name?: string;
        phoneNumber?: string;
        purpose?: string;
        email?: string;
        gender?: string;
        idProofType?: string;
        idProofNumber?: string;
        vehicleType?: string;
        vehicleNumber?: string;
        serviceProvider?: string;
        isRecurring?: boolean;
        recurringDays?: string | string[];
        gateNo?: string;
        approvalStatus?: string;
    };
    visitorImage?: {
        fileName: string;
        fileType: string;
        fileSize?: number;
    };
    visitorId?: string;
    preApproved?: boolean;
    filters?: {
        visitorStatus?: string;
        filterOption?: string;
        fromDate?: string;
        toDate?: string;
        search?: string;
    };
    pagination?: { page?: number; pageSize?: number };
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

// ============================================
// CORS / RESPONSE
// ============================================
function corsHeaders(origin: string | null): Record<string, string> {
    let allow = "*";
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS[0] !== "*") {
        allow = origin && ALLOWED_ORIGINS.includes(origin)
            ? origin
            : ALLOWED_ORIGINS[0];
    }
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}

function buildSuccess(req: Request, data: unknown): Response {
    return new Response(
        JSON.stringify({ success: true, data, errorResponse: null }),
        {
            status: 200,
            headers: {
                ...corsHeaders(req.headers.get("origin")),
                "Content-Type": "application/json",
            },
        },
    );
}

function buildError(
    req: Request,
    code: string,
    message: string,
    status = 400,
): Response {
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
            headers: {
                ...corsHeaders(req.headers.get("origin")),
                "Content-Type": "application/json",
            },
        },
    );
}

function log(
    level: "info" | "warn" | "error",
    action: string,
    message: string,
    meta: Record<string, unknown> = {},
) {
    const line = JSON.stringify({
        level,
        action,
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
}

// ============================================
// INPUT HELPERS
// ============================================
function cleanText(v: unknown, max = 500): string {
    if (v === null || v === undefined) return "";
    return String(v).trim().slice(0, max);
}

function cleanPhone(v: unknown): string {
    return String(v ?? "").trim().replace(/\s+/g, "").slice(0, 20);
}

function isValidPhone(p: string): boolean {
    return /^[0-9]{10,15}$/.test(p);
}

function isValidEmail(e: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function normalizeRecurringDays(input: unknown): string[] | null {
    if (!input) return null;
    const raw = Array.isArray(input) ? input : String(input).split(",");
    const dayMap: Record<string, string> = {
        mon: "Monday",
        tue: "Tuesday",
        wed: "Wednesday",
        thu: "Thursday",
        fri: "Friday",
        sat: "Saturday",
        sun: "Sunday",
    };
    const out = raw
        .map((d) => String(d).trim())
        .filter(Boolean)
        .map((d) => dayMap[d.toLowerCase()] ?? d);
    return out.length > 0 ? out : null;
}

function clampPageSize(n: number | undefined): number {
    if (!n || n < 1) return DEFAULT_PAGE_SIZE;
    return Math.min(n, MAX_PAGE_SIZE);
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
// IST DATE BOUNDS
// ============================================
function calculateDateBounds(
    filter: string | null | undefined,
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

    const startObj = new Date(Date.UTC(year, startMonth, startDay, 0, 0, 0));
    const endObj = new Date(Date.UTC(year, endMonth, endDay, 0, 0, 0));
    startObj.setMinutes(startObj.getMinutes() - 330);
    endObj.setMinutes(endObj.getMinutes() - 330);

    return { startISO: startObj.toISOString(), endISO: endObj.toISOString() };
}

// ============================================
// AUTH
// ============================================
async function authenticate(
    req: Request,
): Promise<ContextSuccess | ContextFailure> {
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

    let payload: { sub?: string; user_id?: string };
    try {
        const key = await getJwtKey();
        payload = await jwtVerify(token, key) as typeof payload;
    } catch {
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
        .select("user_id, society, unit_flat_number, block, tower, deleted_at")
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
            callerFlat: String(data.unit_flat_number ?? "").trim(),
            callerBlock: data.block ?? null,
            callerTower: data.tower ?? null,
        },
    };
}

// ============================================
// SIGNED URL CACHE
// ============================================
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
                if (!key) return [originalPath, null] as const;
                try {
                    const { data, error } = await admin.storage
                        .from(BUCKET_NAME)
                        .createSignedUrl(key, SIGNED_URL_TTL);
                    if (error || !data?.signedUrl) {
                        return [originalPath, null] as const;
                    }
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
// SHARED: Image map for visitor IDs
// ============================================
async function fetchImageMap(
    visitorIds: string[],
    societyId: string,
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (visitorIds.length === 0) return map;

    const { data: docs } = await admin
        .from("SSP_Document")
        .select("non_society_user, s3_path")
        .in("non_society_user", visitorIds)
        .eq("society", societyId)
        .not("s3_path", "is", null);

    const visitorToPath = new Map<string, string>();
    for (
        const d of (docs ?? []) as Array<
            { non_society_user: string; s3_path: string }
        >
    ) {
        if (
            d.non_society_user && d.s3_path &&
            !visitorToPath.has(d.non_society_user)
        ) {
            visitorToPath.set(d.non_society_user, d.s3_path);
        }
    }

    const signedMap = await batchSignUrls(Array.from(visitorToPath.values()));
    for (const [vid, path] of visitorToPath.entries()) {
        const url = signedMap.get(path);
        if (url) map.set(vid, url);
    }
    return map;
}

// ============================================
// SHARED: Delete docs + storage for visitor
// ============================================
async function deleteVisitorDocs(
    visitorId: string,
    societyId: string,
): Promise<{ documentsDeleted: number; storageDeleted: number }> {
    const { data: docs } = await admin
        .from("SSP_Document")
        .select("document_id, s3_path")
        .eq("non_society_user", visitorId)
        .eq("society", societyId);

    if (!docs || docs.length === 0) {
        return { documentsDeleted: 0, storageDeleted: 0 };
    }

    const keys = docs
        .map((d) => extractStorageKey(d.s3_path))
        .filter((k): k is string => !!k && k.length > 0);

    let storageDeleted = 0;
    const [storageRes] = await Promise.all([
        keys.length > 0
            ? admin.storage.from(BUCKET_NAME).remove(keys)
            : Promise.resolve({ data: null, error: null } as any),
        admin
            .from("SSP_Document")
            .delete()
            .eq("non_society_user", visitorId)
            .eq("society", societyId),
    ]);

    storageDeleted = storageRes.data?.length ?? 0;

    return { documentsDeleted: docs.length, storageDeleted };
}

// ============================================
// SHARED: Upload visitor image
// ============================================
async function prepareVisitorImage(
    visitorId: string,
    societyId: string,
    societyRegistrationNumber: string,
    image: { fileName: string; fileType: string; fileSize?: number },
): Promise<Record<string, unknown> | null> {
    try {
        const cleanFileName = image.fileName.replace(/\s+/g, "_");
        const objectKey =
            `${societyRegistrationNumber}/visitors/${visitorId}/${Date.now()}_${cleanFileName}`;

        const { data: signed, error: signErr } = await admin.storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey);

        if (signErr || !signed) {
            log("warn", "visitor.image", `sign failed: ${signErr?.message}`);
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
            document_type: "visitor_image",
            s3_path: fullPublicPath,
            society: societyId,
            non_society_user: visitorId,
            uploaded_on: new Date().toISOString(),
            created_at: new Date().toISOString(),
        };

        const { error: docErr } = await admin
            .from("SSP_Document")
            .insert(documentPayload);

        if (docErr) {
            log(
                "warn",
                "visitor.image",
                `doc insert failed: ${docErr.message}`,
            );
            return null;
        }

        return {
            documentId: documentPayload.document_id,
            imageUrl: signed.signedUrl,
            filePath: objectKey,
            fileName: image.fileName,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        log("warn", "visitor.image", `failed (non-fatal): ${msg}`);
        return null;
    }
}

// ============================================
// SHARED: Get society registration number
// ============================================
async function getSocietyRegNum(societyId: string): Promise<string> {
    const { data } = await admin
        .from("SSP_Society")
        .select("registration_number")
        .eq("society_id", societyId)
        .maybeSingle();
    return data?.registration_number ?? "unknown";
}

// ============================================
// SHARED: Get host info
// ============================================
async function getHostInfo(
    userId: string,
): Promise<{ name: string; flatNumber: string }> {
    const { data } = await admin
        .from("SSP_Society_User")
        .select("unit_flat_number, contact:SSP_Contact!contact ( name )")
        .eq("user_id", userId)
        .maybeSingle();

    const contact = Array.isArray(data?.contact)
        ? data.contact[0]
        : data?.contact;
    return {
        name: (contact as { name?: string } | null)?.name ?? "",
        flatNumber: String(data?.unit_flat_number ?? ""),
    };
}

// ============================================
// SHARED: Row → response
// imageUrl is included ONLY when explicitly passed (VIEW path).
// CREATE / UPDATE return images via `document.imageUrl` (upload URL).
// ============================================
function toVisitorResponse(
    v: Record<string, unknown>,
    hostInfo: { name: string; flatNumber: string },
    imageUrl?: string | null,
) {
    const recurringDays = Array.isArray(v.recurring_days)
        ? (v.recurring_days as string[])
        : null;

    const base = {
        visitorId: v.non_society_user_id ?? "",
        name: v.name ?? "",
        phoneNumber: v.phone_number ?? "",
        email: v.email ?? null,
        gender: v.gender ?? null,
        role: v.role ?? "visitor",
        purpose: v.purpose ?? null,
        serviceProvider: v.delivery_origin ?? null,
        approvalStatus: v.visitor_approval_status ?? null,
        visitorStatus: v.visitor_status ?? null,
        preApproved: v.pre_approved ?? false,
        hostedBy: {
            residentId: v.hosted_by ?? "",
            name: hostInfo.name,
            flatNumber: hostInfo.flatNumber,
        },
        isRecurring: v.is_recurring ?? false,
        recurringDays,
        vehicleType: v.vehicle_type ?? null,
        vehicleNumber: v.vehicle_number ?? null,
        gateNo: v.gate_no ?? null,
        idProofType: v.id_proof_type ?? null,
        idProofNumber: v.id_proof_number ?? null,
        createdAt: v.created_at ?? null,
    };

    return imageUrl !== undefined ? { ...base, imageUrl } : base;
}

// ============================================
// HANDLERS
// ============================================

// ---------- CREATE ----------
async function handleCreate(
    req: Request,
    ctx: CallerCtx,
    body: ManageRequest,
): Promise<Response> {
    const t0 = Date.now();
    const vd = body.visitorData;
    if (!vd) {
        return buildError(req, "BAD_REQUEST", "visitorData is mandatory.", 400);
    }

    const name = cleanText(vd.name, 150);
    const phone = cleanPhone(vd.phoneNumber);
    const purpose = cleanText(vd.purpose, 100);

    if (!name) {
        return buildError(
            req,
            "BAD_REQUEST",
            "visitorData.name is required.",
            400,
        );
    }
    if (!phone || !isValidPhone(phone)) {
        return buildError(
            req,
            "BAD_REQUEST",
            "Valid visitorData.phoneNumber (10-15 digits) is required.",
            400,
        );
    }
    if (!purpose) {
        return buildError(
            req,
            "BAD_REQUEST",
            "visitorData.purpose is required.",
            400,
        );
    }

    if (vd.email && vd.email.trim() !== "" && !isValidEmail(vd.email)) {
        return buildError(req, "BAD_REQUEST", "Invalid email format.", 400);
    }

    if (vd.isRecurring === true && !vd.recurringDays) {
        return buildError(
            req,
            "BAD_REQUEST",
            "visitorData.recurringDays is required when isRecurring is true.",
            400,
        );
    }

    // ---- PARALLEL: idempotency + duplicate + host info ----
    const tChecks = Date.now();
    const idemPromise = body.idempotencyKey
        ? admin
            .from("SSP_Non_Society_User")
            .select("non_society_user_id, created_at")
            .eq("idempotency_key", body.idempotencyKey)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);

    const dupPromise = admin
        .from("SSP_Non_Society_User")
        .select("non_society_user_id")
        .eq("society", ctx.callerSocietyId)
        .eq("hosted_by", ctx.callerUserId)
        .eq("pre_approved", true)
        .eq("phone_number", phone)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

    const hostPromise = getHostInfo(ctx.callerUserId);

    const [idemRes, dupRes, hostInfo] = await Promise.all([
        idemPromise,
        dupPromise,
        hostPromise,
    ]);
    console.log(`[visitor][CREATE] parallel checks ${Date.now() - tChecks}ms`);

    if (idemRes.data) {
        return buildSuccess(req, {
            visitorCreated: true,
            idempotentReplay: true,
            visitorId: idemRes.data.non_society_user_id,
            createdAt: idemRes.data.created_at,
        });
    }

    if (dupRes.data) {
        return buildError(
            req,
            "DUPLICATE_VISITOR",
            `A pre-approved visitor with phone ${phone} already exists for this flat.`,
            400,
        );
    }

    const recurringDaysArray = vd.isRecurring === true
        ? normalizeRecurringDays(vd.recurringDays)
        : null;

    const insertPayload: Record<string, unknown> = {
        name,
        phone_number: phone,
        purpose,
        society: ctx.callerSocietyId,
        hosted_by: ctx.callerUserId,
        role: VISITOR_ROLE,
        pre_approved: true,
        visitor_approval_status: "approved",
        visitor_status: "expected",
        check_in: null,
        check_out: null,
        is_recurring: vd.isRecurring === true,
        recurring_days: recurringDaysArray,
        idempotency_key: body.idempotencyKey ?? null,
        created_at: new Date().toISOString(),
    };

    if (vd.email && vd.email.trim() !== "") {
        insertPayload.email = cleanText(vd.email, 150);
    }
    if (vd.gender && vd.gender.trim() !== "") {
        insertPayload.gender = cleanText(vd.gender, 20);
    }
    if (vd.idProofType && vd.idProofType.trim() !== "") {
        insertPayload.id_proof_type = cleanText(vd.idProofType, 50);
    }
    if (vd.idProofNumber && vd.idProofNumber.trim() !== "") {
        insertPayload.id_proof_number = cleanText(vd.idProofNumber, 100);
    }
    if (vd.vehicleType && vd.vehicleType.trim() !== "") {
        insertPayload.vehicle_type = cleanText(vd.vehicleType, 30);
    }
    if (vd.vehicleNumber && vd.vehicleNumber.trim() !== "") {
        insertPayload.vehicle_number = cleanText(vd.vehicleNumber, 30);
    }
    if (vd.serviceProvider && vd.serviceProvider.trim() !== "") {
        insertPayload.delivery_origin = cleanText(vd.serviceProvider, 100);
    }
    if (vd.gateNo && vd.gateNo.trim() !== "") {
        insertPayload.gate_no = cleanText(vd.gateNo, 20);
    }

    const tInsert = Date.now();
    const { data: inserted, error: insertErr } = await admin
        .from("SSP_Non_Society_User")
        .insert(insertPayload)
        .select("*")
        .single();

    if (insertErr || !inserted) {
        log("error", "visitor.CREATE", "insert failed", {
            err: insertErr?.message,
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Failed to create visitor: ${insertErr?.message}`,
            500,
        );
    }
    console.log(`[visitor][CREATE] insert ${Date.now() - tInsert}ms`);

    let documentResponse: Record<string, unknown> | null = null;
    if (body.visitorImage?.fileName && body.visitorImage?.fileType) {
        const tImg = Date.now();
        const regNum = await getSocietyRegNum(ctx.callerSocietyId);
        documentResponse = await prepareVisitorImage(
            inserted.non_society_user_id,
            ctx.callerSocietyId,
            regNum,
            body.visitorImage,
        );
        console.log(`[visitor][CREATE] image ${Date.now() - tImg}ms`);
    }

    console.log(`[visitor][CREATE] TOTAL ${Date.now() - t0}ms`);

    return buildSuccess(req, {
        visitorCreated: true,
        message: "Pre-approved visitor created successfully.",
        visitor: toVisitorResponse(
            inserted as Record<string, unknown>,
            hostInfo,
        ),
        document: documentResponse,
    });
}

// ---------- VIEW ----------
// Returns pre-approved visitors for the caller's flat.
// Each visitor includes a signed DOWNLOAD imageUrl when an image exists.
// ----------
async function handleView(
    req: Request,
    ctx: CallerCtx,
    body: ManageRequest,
): Promise<Response> {
    const t0 = Date.now();
    const filters = body.filters ?? {};
    const page = Math.max(1, Number(body.pagination?.page ?? 1) | 0);
    const pageSize = clampPageSize(body.pagination?.pageSize);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const cleanVisitorStatus =
        filters.visitorStatus && filters.visitorStatus.toLowerCase() !== "all"
            ? cleanText(filters.visitorStatus, 30)
            : null;
    const cleanSearch = filters.search && filters.search.trim() !== ""
        ? cleanText(filters.search, 60).replace(/[%_,()]/g, "")
        : null;

    const SELECT = `
        non_society_user_id, name, phone_number, email, gender, role,
        purpose, delivery_origin, is_recurring, recurring_days,
        pre_approved, visitor_approval_status, visitor_status,
        check_in, check_out, gate_no, vehicle_number, vehicle_type,
        id_proof_type, id_proof_number, hosted_by, created_at
    `;

    let preQ = admin
        .from("SSP_Non_Society_User")
        .select(SELECT, { count: "exact" })
        .eq("society", ctx.callerSocietyId)
        .eq("hosted_by", ctx.callerUserId)
        .eq("pre_approved", true)
        .is("deleted_at", null);

    let preCountQ = admin
        .from("SSP_Non_Society_User")
        .select("*", { count: "exact", head: true })
        .eq("society", ctx.callerSocietyId)
        .eq("hosted_by", ctx.callerUserId)
        .eq("pre_approved", true)
        .is("deleted_at", null);

    if (cleanVisitorStatus) {
        preQ = preQ.eq("visitor_status", cleanVisitorStatus);
        preCountQ = preCountQ.eq("visitor_status", cleanVisitorStatus);
    }

    const dateBounds = calculateDateBounds(
        filters.filterOption,
        filters.fromDate,
        filters.toDate,
    );
    if (dateBounds) {
        preQ = preQ
            .gte("created_at", dateBounds.startISO)
            .lt("created_at", dateBounds.endISO);
        preCountQ = preCountQ
            .gte("created_at", dateBounds.startISO)
            .lt("created_at", dateBounds.endISO);
    }

    if (cleanSearch) {
        const orClause = `name.ilike.%${cleanSearch}%,` +
            `phone_number.ilike.%${cleanSearch}%,` +
            `purpose.ilike.%${cleanSearch}%,` +
            `vehicle_number.ilike.%${cleanSearch}%,` +
            `delivery_origin.ilike.%${cleanSearch}%`;
        preQ = preQ.or(orClause);
        preCountQ = preCountQ.or(orClause);
    }

    preQ = preQ
        .order("created_at", { ascending: false })
        .range(from, to);

    // Parallel: main + count + host info
    const tQueries = Date.now();
    const [preRes, countRes, hostInfo] = await Promise.all([
        preQ,
        preCountQ,
        getHostInfo(ctx.callerUserId),
    ]);
    console.log(`[visitor][VIEW] parallel queries ${Date.now() - tQueries}ms`);

    if (preRes.error) {
        log("error", "visitor.VIEW", "query failed", {
            err: preRes.error.message,
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Database error: ${preRes.error.message}`,
            500,
        );
    }

    const totalPreApproved = countRes.error ? 0 : countRes.count ?? 0;
    const preRows = (preRes.data ?? []) as Array<Record<string, unknown>>;

    // ✅ Fetch + batch-sign images for all rows
    const visitorIds = preRows
        .map((r) => String(r.non_society_user_id ?? ""))
        .filter(Boolean);
    const imageMap = visitorIds.length > 0
        ? await fetchImageMap(visitorIds, ctx.callerSocietyId)
        : new Map<string, string>();

    const visitors = preRows.map((r) => {
        const vid = String(r.non_society_user_id ?? "");
        const url = imageMap.get(vid) ?? null;
        return url
            ? toVisitorResponse(r, hostInfo, url)
            : toVisitorResponse(r, hostInfo);
    });

    console.log(`[visitor][VIEW] TOTAL ${Date.now() - t0}ms`);

    return buildSuccess(req, {
        visitors,
        total: totalPreApproved,
        filters: {
            visitorStatus: filters.visitorStatus ?? null,
            filterOption: filters.filterOption ?? null,
            fromDate: filters.fromDate ?? null,
            toDate: filters.toDate ?? null,
        },
        search: filters.search ?? null,
        pagination: {
            page,
            pageSize,
            totalCount: totalPreApproved,
            totalPages: Math.ceil(totalPreApproved / pageSize),
            hasMore: page < Math.ceil(totalPreApproved / pageSize),
        },
    });
}

// ---------- UPDATE ----------
async function handleUpdate(
    req: Request,
    ctx: CallerCtx,
    body: ManageRequest,
): Promise<Response> {
    const t0 = Date.now();
    const visitorId = cleanText(body.visitorId, 50);
    if (!visitorId) {
        return buildError(
            req,
            "BAD_REQUEST",
            "visitorId is mandatory for UPDATE.",
            400,
        );
    }

    const { data: existing, error: findErr } = await admin
        .from("SSP_Non_Society_User")
        .select("*")
        .eq("non_society_user_id", visitorId)
        .eq("hosted_by", ctx.callerUserId)
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) return buildError(req, "SERVER_ERROR", findErr.message, 500);
    if (!existing) {
        return buildError(req, "NOT_FOUND", "Visitor not found.", 404);
    }

    const vd = body.visitorData;
    const hasImageUpdate =
        !!(body.visitorImage?.fileName && body.visitorImage?.fileType);

    if (!vd && !hasImageUpdate && body.preApproved === undefined) {
        return buildError(
            req,
            "BAD_REQUEST",
            "Provide visitorData, visitorImage, or preApproved.",
            400,
        );
    }

    const updates: Record<string, unknown> = {};

    if (vd) {
        if (vd.name !== undefined) {
            const v = cleanText(vd.name, 150);
            if (!v) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "name cannot be empty.",
                    400,
                );
            }
            updates.name = v;
        }
        if (vd.phoneNumber !== undefined) {
            const v = cleanPhone(vd.phoneNumber);
            if (!isValidPhone(v)) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "Invalid phone number.",
                    400,
                );
            }
            updates.phone_number = v;
        }
        if (vd.purpose !== undefined) {
            updates.purpose = cleanText(vd.purpose, 100) || null;
        }
        if (vd.email !== undefined) {
            const v = cleanText(vd.email, 150);
            if (v && !isValidEmail(v)) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "Invalid email format.",
                    400,
                );
            }
            updates.email = v || null;
        }
        if (vd.gender !== undefined) {
            updates.gender = cleanText(vd.gender, 20) || null;
        }
        if (vd.idProofType !== undefined) {
            updates.id_proof_type = cleanText(vd.idProofType, 50) || null;
        }
        if (vd.idProofNumber !== undefined) {
            updates.id_proof_number = cleanText(vd.idProofNumber, 100) || null;
        }
        if (vd.vehicleType !== undefined) {
            updates.vehicle_type = cleanText(vd.vehicleType, 30) || null;
        }
        if (vd.vehicleNumber !== undefined) {
            updates.vehicle_number = cleanText(vd.vehicleNumber, 30) || null;
        }
        if (vd.serviceProvider !== undefined) {
            updates.delivery_origin = cleanText(vd.serviceProvider, 100) ||
                null;
        }
        if (vd.gateNo !== undefined) {
            updates.gate_no = cleanText(vd.gateNo, 20) || null;
        }
        if (vd.isRecurring !== undefined) {
            updates.is_recurring = vd.isRecurring === true;
            if (vd.isRecurring === true) {
                if (!vd.recurringDays) {
                    return buildError(
                        req,
                        "BAD_REQUEST",
                        "recurringDays is required when isRecurring is true.",
                        400,
                    );
                }
                updates.recurring_days = normalizeRecurringDays(
                    vd.recurringDays,
                );
            } else {
                updates.recurring_days = null;
            }
        } else if (vd.recurringDays !== undefined) {
            updates.recurring_days = normalizeRecurringDays(vd.recurringDays);
        }
        if (vd.approvalStatus !== undefined) {
            const v = String(vd.approvalStatus).toLowerCase().trim();
            if (
                !VALID_APPROVAL_STATUS.includes(
                    v as typeof VALID_APPROVAL_STATUS[number],
                )
            ) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    `approvalStatus must be one of ${
                        VALID_APPROVAL_STATUS.join(", ")
                    }`,
                    400,
                );
            }
            updates.visitor_approval_status = v;
        }
    }

    if (body.preApproved !== undefined) {
        if (typeof body.preApproved !== "boolean") {
            return buildError(
                req,
                "BAD_REQUEST",
                "preApproved must be a boolean.",
                400,
            );
        }
        updates.pre_approved = body.preApproved;
        updates.visitor_approval_status = body.preApproved
            ? "approved"
            : "rejected";
    }

    const hasUpdates = Object.keys(updates).length > 0;

    const tParallel = Date.now();

    const hostPromise = getHostInfo(ctx.callerUserId);

    const updateChain: Promise<{ updated: any; err?: string }> = (async () => {
        if (hasUpdates) {
            const { error: updateErr } = await admin
                .from("SSP_Non_Society_User")
                .update(updates)
                .eq("non_society_user_id", visitorId)
                .eq("hosted_by", ctx.callerUserId)
                .eq("society", ctx.callerSocietyId);

            if (updateErr) return { updated: null, err: updateErr.message };
        }
        const { data: updated } = await admin
            .from("SSP_Non_Society_User")
            .select("*")
            .eq("non_society_user_id", visitorId)
            .maybeSingle();
        return { updated };
    })();

    const imageChain: Promise<Record<string, unknown> | null> = hasImageUpdate
        ? (async () => {
            try {
                const cleanup = await deleteVisitorDocs(
                    visitorId,
                    ctx.callerSocietyId,
                );
                log("info", "visitor.UPDATE", "old image cleanup", cleanup);
            } catch (err) {
                const msg = err instanceof Error
                    ? err.message
                    : "Unknown error";
                log(
                    "warn",
                    "visitor.UPDATE",
                    `image cleanup failed (continuing): ${msg}`,
                );
            }
            const regNum = await getSocietyRegNum(ctx.callerSocietyId);
            return prepareVisitorImage(
                visitorId,
                ctx.callerSocietyId,
                regNum,
                body.visitorImage!,
            );
        })()
        : Promise.resolve(null);

    const [updateResult, documentResponse, hostInfo] = await Promise.all([
        updateChain,
        imageChain,
        hostPromise,
    ]);
    console.log(`[visitor][UPDATE] parallel ${Date.now() - tParallel}ms`);

    if (updateResult.err) {
        log("error", "visitor.UPDATE", "update failed", {
            err: updateResult.err,
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Failed to update visitor: ${updateResult.err}`,
            500,
        );
    }

    const updated = updateResult.updated;

    let opMessage = "Pre-approved visitor updated successfully.";
    if (body.preApproved === false) opMessage = "Pre-approval cancelled.";
    else if (body.preApproved === true) {
        opMessage = "Visitor re-approved successfully.";
    }

    console.log(`[visitor][UPDATE] TOTAL ${Date.now() - t0}ms`);

    return buildSuccess(req, {
        updated: true,
        message: opMessage,
        visitor: updated
            ? toVisitorResponse(updated as Record<string, unknown>, hostInfo)
            : null,
        document: documentResponse,
    });
}

// ---------- DELETE ----------
async function handleDelete(
    req: Request,
    ctx: CallerCtx,
    body: ManageRequest,
): Promise<Response> {
    const t0 = Date.now();
    const visitorId = cleanText(body.visitorId, 50);
    if (!visitorId) {
        return buildError(
            req,
            "BAD_REQUEST",
            "visitorId is mandatory for DELETE.",
            400,
        );
    }

    const { data: existing, error: findErr } = await admin
        .from("SSP_Non_Society_User")
        .select("non_society_user_id, name, pre_approved")
        .eq("non_society_user_id", visitorId)
        .eq("hosted_by", ctx.callerUserId)
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) return buildError(req, "SERVER_ERROR", findErr.message, 500);
    if (!existing) {
        return buildError(
            req,
            "NOT_FOUND",
            "Visitor not found or already removed.",
            404,
        );
    }

    const [docCleanup] = await Promise.all([
        deleteVisitorDocs(visitorId, ctx.callerSocietyId).catch((err) => {
            const msg = err instanceof Error ? err.message : "Unknown error";
            log(
                "warn",
                "visitor.DELETE",
                `image cleanup failed (continuing): ${msg}`,
            );
            return { documentsDeleted: 0, storageDeleted: 0 };
        }),
        admin
            .from("SSP_Non_Society_User")
            .update({ deleted_at: new Date().toISOString() })
            .eq("non_society_user_id", visitorId)
            .eq("hosted_by", ctx.callerUserId)
            .eq("society", ctx.callerSocietyId)
            .then(({ error }) => {
                if (error) throw new Error(error.message);
                return null;
            }),
    ]);

    console.log(`[visitor][DELETE] TOTAL ${Date.now() - t0}ms`);

    return buildSuccess(req, {
        visitorDeleted: true,
        message: "Visitor removed successfully.",
        visitorId,
        wasPreApproved: existing.pre_approved ?? false,
        documentsDeleted: docCleanup.documentsDeleted,
        storageDeleted: docCleanup.storageDeleted,
    });
}

// ============================================
// MAIN HANDLER
// ============================================
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
            req.json().catch(() => null) as Promise<ManageRequest | null>,
            authenticate(req),
        ]);

        if (!body) {
            return buildError(
                req,
                "BAD_REQUEST",
                "Request body is required.",
                400,
            );
        }
        if (!body.action) {
            return buildError(req, "BAD_REQUEST", "action is required.", 400);
        }

        const rawAction = String(body.action).toUpperCase();
        if (!VALID_ACTIONS.includes(rawAction as Action)) {
            return buildError(
                req,
                "BAD_REQUEST",
                `action must be one of ${VALID_ACTIONS.join(", ")}`,
                400,
            );
        }
        action = rawAction as Action;

        if (!auth.ok) {
            return buildError(req, auth.code, auth.message, auth.status);
        }

        // ─────────────────────────────────────────────
        // FEATURE GATE — visitor approval
        // ─────────────────────────────────────────────
        const gate = await requireFeature(
            auth.ctx.callerUserId,
            "VISITOR_APPROVAL",
        );
        if (gate) return gate;

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
        }

        log("info", "manage-pre-approved-visitor", "OK", {
            action,
            caller: auth.ctx.callerUserId,
            actionMs: Date.now() - tAction,
            totalMs: Date.now() - t0,
        });

        return response!;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        log("error", "manage-pre-approved-visitor", "Unhandled", {
            action,
            err: msg,
            ms: Date.now() - t0,
        });
        return buildError(req, "SERVER_ERROR", "Internal server error.", 500);
    }
});
