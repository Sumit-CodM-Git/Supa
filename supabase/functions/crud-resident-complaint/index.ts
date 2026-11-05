// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// crud-resident-complaint
// Actions: CREATE | VIEW | UPDATE
// Resident-side complaint management
// Optimized: parallel I/O, batch image signing, cached society reg num
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
    corsHeaders,
    errorResponse,
    successResponse,
} from "../_shared/response.ts";
import {
    generateId,
    getCurrentTimestamp,
    logger,
    parseRequestBody,
    sanitizeString,
} from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface CrudResidentComplaintRequest {
    action: "CREATE" | "VIEW" | "UPDATE";
    // CREATE / UPDATE
    complaintId?: string;
    complaintData?: {
        title?: string;
        description?: string;
        complaintType?: string;
        priority?: string;
    };
    complaintImages?: Array<{
        fileName: string;
        fileType: string;
        fileSize?: number | string;
    }>;
    removeDocumentIds?: string[];
    idempotencyKey?: string;
    // VIEW
    filters?: {
        status?: string;
        priority?: string;
        complaintType?: string;
        filterOption?: string;
        fromDate?: string;
        toDate?: string;
        search?: string;
    };
    sort?: { field?: string; order?: "asc" | "desc" };
    pagination?: { page?: number; pageSize?: number };
}

interface CallerCtx {
    authUserId: string;
    callerUserId: string;
    callerSocietyId: string;
    callerFlat: string;
    callerName: string;
    callerPhone: string;
    callerEmail: string;
    callerBlock: string | null;
    callerTower: string | null;
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

interface RawComplaint {
    complaint_id: string;
    name: string;
    description: string | null;
    status: string;
    complaint_type: string;
    priority: string;
    created_at: string;
    assigned_date_time: string | null;
    completion_date_time: string | null;
    society_user: string;
    assigned_agent: string | null;
    non_society_user: string | null;
    assigned_by: string | null;
}

interface DocumentResponse {
    documentId: string;
    uploadUrl: string | null;
    filePath: string;
    fileName: string;
}

interface DocumentInfo {
    documentId: string;
    url: string;
    fileName: string | null;
    fileType: string | null;
    fileSize: number | null;
}

interface ComplaintImages {
    residentUploaded: DocumentInfo[];
    before: DocumentInfo[];
    after: DocumentInfo[];
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_IMAGES = 5;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const SIGNED_URL_TTL = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const VALID_ACTIONS = ["CREATE", "VIEW", "UPDATE"] as const;
type Action = typeof VALID_ACTIONS[number];

const VALID_TYPES = [
    "electrical",
    "plumbing",
    "general",
    "maintenance",
    "others",
    "housekeeping",
    "security",
    "parking",
] as const;

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
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

// In-memory cache for society registration_number
const societyRegCache = new Map<
    string,
    { value: string; expiresAt: number }
>();
const SOCIETY_REG_TTL_MS = 5 * 60 * 1000; // 5 min

// ============================================
// HELPERS
// ============================================

function cleanText(v: unknown, max = 2000): string {
    if (v === null || v === undefined) return "";
    return String(v).trim().slice(0, max);
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
// BATCH SIGN URLS — uses Supabase batch API when possible
// ============================================

async function batchSignUrls(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (paths.length === 0) return result;

    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0) return result;

    const now = Date.now();
    const toSign: string[] = [];
    const keyMap = new Map<string, string>();
    const keyToPath = new Map<string, string>();

    for (const p of unique) {
        const cached = urlCache.get(p);
        if (cached && cached.expiresAt > now + SIGNED_URL_SAFETY_MARGIN_MS) {
            result.set(p, cached.url);
        } else {
            const key = extractStorageKey(p);
            if (key) {
                keyMap.set(p, key);
                if (!keyToPath.has(key)) keyToPath.set(key, p);
                toSign.push(p);
            }
        }
    }

    if (toSign.length === 0) return result;

    const keys = Array.from(keyToPath.keys());

    // Try batch API first (single roundtrip)
    try {
        const { data: signedList, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrls(keys, SIGNED_URL_TTL);

        if (!error && signedList) {
            const expiresAt = Date.now() + SIGNED_URL_TTL * 1000;
            for (const s of signedList) {
                if (s.signedUrl && !s.error) {
                    const originalPath = keyToPath.get(s.path);
                    if (originalPath) {
                        result.set(originalPath, s.signedUrl);
                        urlCache.set(originalPath, {
                            url: s.signedUrl,
                            expiresAt,
                        });
                    }
                }
            }
            return result;
        }
    } catch {
        // fall through to per-key
    }

    // Fallback: per-key in chunks
    for (let i = 0; i < toSign.length; i += SIGNED_URL_CONCURRENCY) {
        const chunk = toSign.slice(i, i + SIGNED_URL_CONCURRENCY);
        const signed = await Promise.all(
            chunk.map(async (originalPath) => {
                const key = keyMap.get(originalPath)!;
                try {
                    const { data, error } = await supabaseAdmin.storage
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
// AUTH
// ============================================

async function getContext(
    userId: string,
): Promise<ContextSuccess | ContextFailure> {
    const { data, error } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
            user_id,
            society,
            unit_flat_number,
            block,
            tower,
            deleted_at,
            contact:SSP_Contact!contact ( name, phone, email )
        `)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
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

    const contact = Array.isArray(data.contact)
        ? data.contact[0]
        : data.contact;

    return {
        ok: true,
        ctx: {
            authUserId: userId,
            callerUserId: String(data.user_id),
            callerSocietyId: String(data.society ?? ""),
            callerFlat: String(data.unit_flat_number ?? "").trim(),
            callerBlock: data.block ?? null,
            callerTower: data.tower ?? null,
            callerName: (contact?.name as string) || "",
            callerPhone: (contact?.phone as string) || "",
            callerEmail: (contact?.email as string) || "",
        },
    };
}

// ============================================
// Society registration number (in-memory cached)
// ============================================

async function getSocietyRegistrationNumber(
    societyId: string,
): Promise<string> {
    const now = Date.now();
    const cached = societyRegCache.get(societyId);
    if (cached && cached.expiresAt > now) return cached.value;

    const { data } = await supabaseAdmin
        .from("SSP_Society")
        .select("registration_number")
        .eq("society_id", societyId)
        .maybeSingle();

    const value = data?.registration_number ?? "unknown";
    societyRegCache.set(societyId, {
        value,
        expiresAt: now + SOCIETY_REG_TTL_MS,
    });
    return value;
}

// ============================================
// CREATE / UPDATE — image helpers
// ============================================

/**
 * Prepare a single complaint image: signs upload URL + inserts document row.
 * Both operations run in parallel.
 */
async function prepareComplaintImage(
    complaintId: string,
    societyId: string,
    societyRegistrationNumber: string,
    callerUserId: string,
    image: { fileName: string; fileType: string; fileSize?: number | string },
    index: number,
): Promise<DocumentResponse | null> {
    try {
        const cleanFileName = image.fileName.replace(/\s+/g, "_");
        const objectKey =
            `${societyRegistrationNumber}/complaints/${complaintId}/${Date.now()}_${index}_${cleanFileName}`;

        const documentId = generateId();
        const now = getCurrentTimestamp();

        const parsedSize =
            image.fileSize !== undefined && image.fileSize !== null
                ? parseFloat(String(image.fileSize))
                : null;

        const documentPayload = {
            document_id: documentId,
            name: image.fileName,
            file_name: objectKey,
            file_type: image.fileType,
            file_size: parsedSize,
            document_type: "complaint_attachment",
            s3_path: objectKey,
            society: societyId,
            society_user: callerUserId,
            complaint: complaintId,
            uploaded_on: now,
            created_at: now,
        };

        // Parallel: sign upload URL + insert document row
        const [signRes, docRes] = await Promise.all([
            supabaseAdmin.storage
                .from(BUCKET_NAME)
                .createSignedUploadUrl(objectKey, { upsert: true }),
            supabaseAdmin.from("SSP_Document").insert(documentPayload),
        ]);

        const { data: signed, error: signErr } = signRes;
        const { error: docErr } = docRes;

        if (signErr || !signed) {
            logger.warn({
                level: "warn",
                action: "crud-resident-complaint.image",
                message: `Image sign failed: ${signErr?.message}`,
                complaintId,
                timestamp: new Date().toISOString(),
            });
            return null;
        }

        if (docErr) {
            logger.warn({
                level: "warn",
                action: "crud-resident-complaint.image",
                message: `Document insert failed: ${docErr.message}`,
                complaintId,
                timestamp: new Date().toISOString(),
            });
            return null;
        }

        return {
            documentId,
            uploadUrl: signed.signedUrl,
            filePath: objectKey,
            fileName: image.fileName,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.warn({
            level: "warn",
            action: "crud-resident-complaint.image",
            message: `Image handling failed (non-fatal): ${msg}`,
            complaintId,
            timestamp: new Date().toISOString(),
        });
        return null;
    }
}

/**
 * Prepare ALL complaint images in parallel.
 * Preserves index-based ordering in the objectKey.
 */
async function prepareComplaintImages(
    complaintId: string,
    societyId: string,
    societyRegistrationNumber: string,
    callerUserId: string,
    images: Array<{
        fileName: string;
        fileType: string;
        fileSize?: number | string;
    }>,
): Promise<DocumentResponse[]> {
    if (images.length === 0) return [];

    const results = await Promise.all(
        images.map((img, index) =>
            prepareComplaintImage(
                complaintId,
                societyId,
                societyRegistrationNumber,
                callerUserId,
                img,
                index,
            )
        ),
    );

    return results.filter((d): d is DocumentResponse => d !== null);
}

async function removeComplaintImages(
    complaintId: string,
    societyId: string,
    callerUserId: string,
    documentIds: string[],
): Promise<number> {
    if (documentIds.length === 0) return 0;

    const { data: docs } = await supabaseAdmin
        .from("SSP_Document")
        .select("document_id, s3_path")
        .in("document_id", documentIds)
        .eq("complaint", complaintId)
        .eq("society", societyId)
        .eq("society_user", callerUserId) // resident's own
        .eq("document_type", "complaint_attachment"); // their uploads only

    if (!docs || docs.length === 0) return 0;

    const keys = docs
        .map((d) =>
            extractStorageKey((d as { s3_path: string | null }).s3_path)
        )
        .filter((k): k is string => !!k);

    // Parallel: storage remove + DB delete
    await Promise.all([
        keys.length > 0
            ? supabaseAdmin.storage.from(BUCKET_NAME).remove(keys)
            : Promise.resolve({ data: null, error: null } as any),
        supabaseAdmin
            .from("SSP_Document")
            .delete()
            .in(
                "document_id",
                docs.map((d) => (d as { document_id: string }).document_id),
            ),
    ]);

    return docs.length;
}

// ============================================
// VIEW — image grouping
// ============================================

async function fetchComplaintImages(
    complaintIds: string[],
    societyId: string,
): Promise<Map<string, ComplaintImages>> {
    const result = new Map<string, ComplaintImages>();
    if (complaintIds.length === 0) return result;

    const { data: docs } = await supabaseAdmin
        .from("SSP_Document")
        .select(
            "document_id, complaint, document_type, s3_path, name, file_type, file_size",
        )
        .in("complaint", complaintIds)
        .eq("society", societyId)
        .not("s3_path", "is", null);

    const tmp = new Map<
        string,
        {
            residentUploaded: Array<{
                documentId: string;
                path: string;
                name: string | null;
                type: string | null;
                size: number | null;
            }>;
            before: Array<{
                documentId: string;
                path: string;
                name: string | null;
                type: string | null;
                size: number | null;
            }>;
            after: Array<{
                documentId: string;
                path: string;
                name: string | null;
                type: string | null;
                size: number | null;
            }>;
        }
    >();

    const allPaths: string[] = [];

    for (
        const d of (docs ?? []) as Array<{
            document_id: string;
            complaint: string | null;
            document_type: string | null;
            s3_path: string | null;
            name: string | null;
            file_type: string | null;
            file_size: number | null;
        }>
    ) {
        if (!d.complaint || !d.s3_path) continue;

        if (!tmp.has(d.complaint)) {
            tmp.set(d.complaint, {
                residentUploaded: [],
                before: [],
                after: [],
            });
        }
        const bucket = tmp.get(d.complaint)!;
        const docType = (d.document_type ?? "").toLowerCase().trim();

        const entry = {
            documentId: d.document_id,
            path: d.s3_path,
            name: d.name,
            type: d.file_type,
            size: d.file_size,
        };

        if (docType === "complaint_attachment") {
            bucket.residentUploaded.push(entry);
        } else if (docType === "before_complaint_image") {
            bucket.before.push(entry);
        } else if (docType === "after_complaint_image") {
            bucket.after.push(entry);
        }
        allPaths.push(d.s3_path);
    }

    const signedMap = await batchSignUrls(allPaths);

    for (const [complaintId, bucket] of tmp.entries()) {
        const build = (
            list: Array<{
                documentId: string;
                path: string;
                name: string | null;
                type: string | null;
                size: number | null;
            }>,
        ): DocumentInfo[] =>
            list
                .map((e) => {
                    const url = signedMap.get(e.path);
                    if (!url) return null;
                    return {
                        documentId: e.documentId,
                        url,
                        fileName: e.name,
                        fileType: e.type,
                        fileSize: e.size,
                    };
                })
                .filter((d): d is DocumentInfo => d !== null);

        result.set(complaintId, {
            residentUploaded: build(bucket.residentUploaded),
            before: build(bucket.before),
            after: build(bucket.after),
        });
    }

    return result;
}

// ============================================
// VIEW — agent/vendor name resolution
// ============================================

async function fetchAgentNames(
    agentIds: string[],
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (agentIds.length === 0) return map;

    const { data } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, contact:SSP_Contact!contact ( name )")
        .in("user_id", agentIds);

    for (
        const row of (data ?? []) as Array<{
            user_id: string;
            contact: unknown;
        }>
    ) {
        const contact = Array.isArray(row.contact)
            ? row.contact[0]
            : row.contact;
        const name = (contact as { name?: string } | null)?.name;
        if (name) map.set(row.user_id, name);
    }
    return map;
}

async function fetchVendorNames(
    vendorIds: string[],
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (vendorIds.length === 0) return map;

    const { data } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select("non_society_user_id, name")
        .in("non_society_user_id", vendorIds);

    for (
        const row of (data ?? []) as Array<{
            non_society_user_id: string;
            name: string | null;
        }>
    ) {
        if (row.name) map.set(row.non_society_user_id, row.name);
    }
    return map;
}

// ============================================
// RESPONSE HELPERS
// ============================================

function buildSuccess(_req: Request, data: unknown): Response {
    return new Response(
        JSON.stringify({ success: true, data, errorResponse: null }),
        {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

function buildError(
    _req: Request,
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
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

// ============================================
// HANDLER: CREATE
// ============================================

async function handleCreate(
    req: Request,
    ctx: CallerCtx,
    body: CrudResidentComplaintRequest,
): Promise<Response> {
    const t0 = Date.now();
    const cd = body.complaintData;
    if (!cd) {
        return buildError(
            req,
            "BAD_REQUEST",
            "complaintData is mandatory.",
            400,
        );
    }

    const title = cleanText(cd.title, 200);
    const description = cleanText(cd.description, 5000);
    const complaintType = cleanText(cd.complaintType, 30).toLowerCase() ||
        "general";
    const priority = cleanText(cd.priority, 20).toLowerCase() || "medium";

    if (!title) {
        return buildError(
            req,
            "BAD_REQUEST",
            "complaintData.title is required.",
            400,
        );
    }
    if (!description) {
        return buildError(
            req,
            "BAD_REQUEST",
            "complaintData.description is required.",
            400,
        );
    }
    if (!VALID_TYPES.includes(complaintType as typeof VALID_TYPES[number])) {
        return buildError(
            req,
            "BAD_REQUEST",
            `complaintType must be one of ${VALID_TYPES.join(", ")}`,
            400,
        );
    }
    if (
        !VALID_PRIORITIES.includes(priority as typeof VALID_PRIORITIES[number])
    ) {
        return buildError(
            req,
            "BAD_REQUEST",
            `priority must be one of ${VALID_PRIORITIES.join(", ")}`,
            400,
        );
    }

    const images = body.complaintImages ?? [];
    if (images.length > MAX_IMAGES) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Maximum ${MAX_IMAGES} images allowed. You provided ${images.length}.`,
            400,
        );
    }
    for (const img of images) {
        if (!img.fileName || !img.fileType) {
            return buildError(
                req,
                "BAD_REQUEST",
                "Each image must have fileName and fileType.",
                400,
            );
        }
    }

    // ---- PARALLEL: idempotency check + society reg num (only if images) ----
    const tChecks = Date.now();
    const idemPromise = body.idempotencyKey
        ? supabaseAdmin
            .from("SSP_Complaint")
            .select("complaint_id, created_at")
            .eq("idempotency_key", body.idempotencyKey)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);

    const regNumPromise = images.length > 0
        ? getSocietyRegistrationNumber(ctx.callerSocietyId)
        : Promise.resolve("");

    const [idemRes, societyRegNum] = await Promise.all([
        idemPromise,
        regNumPromise,
    ]);
    console.log(
        `[complaint][CREATE] parallel checks ${Date.now() - tChecks}ms`,
    );

    if (idemRes.data) {
        return buildSuccess(req, {
            complaintCreated: true,
            idempotentReplay: true,
            complaintId: idemRes.data.complaint_id,
            createdAt: idemRes.data.created_at,
        });
    }

    const complaintId = generateId();
    const now = getCurrentTimestamp();

    const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .insert({
            complaint_id: complaintId,
            name: title,
            description,
            complaint_type: complaintType,
            priority,
            status: "pending",
            society_user: ctx.callerUserId,
            created_at: now,
            assigned_date_time: null,
            assigned_agent: null,
            assigned_by: null,
            non_society_user: null,
            completion_date_time: null,
            idempotency_key: body.idempotencyKey ?? null,
        })
        .select(`
            complaint_id, name, description, status, priority,
            complaint_type, created_at, society_user
        `)
        .single();

    if (insertErr || !inserted) {
        logger.error({
            level: "error",
            action: "crud-resident-complaint.CREATE",
            message: `Insert failed: ${insertErr?.message}`,
            timestamp: new Date().toISOString(),
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Failed to create complaint: ${insertErr?.message}`,
            500,
        );
    }

    // ---- Images: sign + insert ALL in parallel ----
    let uploadResponses: DocumentResponse[] = [];
    if (images.length > 0) {
        const tImg = Date.now();
        uploadResponses = await prepareComplaintImages(
            complaintId,
            ctx.callerSocietyId,
            societyRegNum,
            ctx.callerUserId,
            images,
        );
        console.log(
            `[complaint][CREATE] images(${images.length}) ${
                Date.now() - tImg
            }ms`,
        );
    }

    console.log(`[complaint][CREATE] TOTAL ${Date.now() - t0}ms`);

    return buildSuccess(req, {
        complaintCreated: true,
        message: "Complaint created successfully.",
        complaint: {
            complaintId: inserted.complaint_id,
            title: inserted.name,
            description: inserted.description,
            status: inserted.status,
            priority: inserted.priority,
            complaintType: inserted.complaint_type,
            createdAt: inserted.created_at,
            residentDetails: {
                residentId: inserted.society_user,
                name: ctx.callerName,
            },
        },
        documents: uploadResponses.length > 0 ? uploadResponses : null,
    });
}

// ============================================
// HANDLER: UPDATE (pending-only)
// ============================================

async function handleUpdate(
    req: Request,
    ctx: CallerCtx,
    body: CrudResidentComplaintRequest,
): Promise<Response> {
    const t0 = Date.now();
    const complaintId = cleanText(body.complaintId, 50);
    if (!complaintId) {
        return buildError(
            req,
            "BAD_REQUEST",
            "complaintId is mandatory for UPDATE.",
            400,
        );
    }

    const { data: current, error: findErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .select(`
            complaint_id, name, description, status, priority,
            complaint_type, society_user, deleted_at
        `)
        .eq("complaint_id", complaintId)
        .eq("society_user", ctx.callerUserId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) {
        return buildError(req, "SERVER_ERROR", findErr.message, 500);
    }
    if (!current) {
        return buildError(
            req,
            "NOT_FOUND",
            "Complaint not found or does not belong to you.",
            404,
        );
    }

    // Pending-only guard
    if (current.status !== "pending") {
        return buildError(
            req,
            "FORBIDDEN",
            `Complaint can only be updated while status is 'pending'. Current status: '${current.status}'.`,
            403,
        );
    }

    const updatePayload: Record<string, unknown> = {};
    const cd = body.complaintData;

    if (cd) {
        if (cd.title !== undefined) {
            const v = cleanText(cd.title, 200);
            if (!v) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "title cannot be empty.",
                    400,
                );
            }
            updatePayload.name = v;
        }
        if (cd.description !== undefined) {
            const v = cleanText(cd.description, 5000);
            if (!v) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "description cannot be empty.",
                    400,
                );
            }
            updatePayload.description = v;
        }
        if (cd.complaintType !== undefined) {
            const v = cleanText(cd.complaintType, 30).toLowerCase();
            if (!VALID_TYPES.includes(v as typeof VALID_TYPES[number])) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    `complaintType must be one of ${VALID_TYPES.join(", ")}`,
                    400,
                );
            }
            updatePayload.complaint_type = v;
        }
        if (cd.priority !== undefined) {
            const v = cleanText(cd.priority, 20).toLowerCase();
            if (
                !VALID_PRIORITIES.includes(
                    v as typeof VALID_PRIORITIES[number],
                )
            ) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    `priority must be one of ${VALID_PRIORITIES.join(", ")}`,
                    400,
                );
            }
            updatePayload.priority = v;
        }
    }

    const hasFieldUpdate = Object.keys(updatePayload).length > 0;
    const hasImageAdd = (body.complaintImages ?? []).length > 0;
    const hasImageRemove = (body.removeDocumentIds ?? []).length > 0;

    if (!hasFieldUpdate && !hasImageAdd && !hasImageRemove) {
        return buildError(
            req,
            "BAD_REQUEST",
            "Provide complaintData, complaintImages, or removeDocumentIds.",
            400,
        );
    }

    // Cap total images after add — uses index-backed count
    if (hasImageAdd) {
        const { count: existingCount } = await supabaseAdmin
            .from("SSP_Document")
            .select("*", { count: "exact", head: true })
            .eq("complaint", complaintId)
            .eq("document_type", "complaint_attachment");

        const totalAfter = (existingCount ?? 0) +
            (body.complaintImages?.length ?? 0) -
            (body.removeDocumentIds?.length ?? 0);

        if (totalAfter > MAX_IMAGES) {
            return buildError(
                req,
                "BAD_REQUEST",
                `Maximum ${MAX_IMAGES} images allowed. Would result in ${totalAfter}.`,
                400,
            );
        }
    }

    // ---- PARALLEL: field update + image removals + image additions + regNum ----
    const tParallel = Date.now();

    // 1. Field update
    const fieldUpdatePromise = hasFieldUpdate
        ? supabaseAdmin
            .from("SSP_Complaint")
            .update(updatePayload)
            .eq("complaint_id", complaintId)
            .eq("society_user", ctx.callerUserId)
        : Promise.resolve({ error: null } as any);

    // 2. Image removals
    const removePromise = hasImageRemove
        ? removeComplaintImages(
            complaintId,
            ctx.callerSocietyId,
            ctx.callerUserId,
            body.removeDocumentIds!,
        ).catch((err) => {
            const msg = err instanceof Error ? err.message : "Unknown error";
            logger.warn({
                level: "warn",
                action: "crud-resident-complaint.UPDATE",
                message: `Image removal failed (continuing): ${msg}`,
                timestamp: new Date().toISOString(),
            });
            return 0;
        })
        : Promise.resolve(0);

    // 3. Society reg num (cached, only if images added)
    const regNumPromise = hasImageAdd
        ? getSocietyRegistrationNumber(ctx.callerSocietyId)
        : Promise.resolve("");

    const [fieldUpdateRes, removedCount, societyRegNum] = await Promise.all([
        fieldUpdatePromise,
        removePromise,
        regNumPromise,
    ]);

    if (fieldUpdateRes.error) {
        logger.error({
            level: "error",
            action: "crud-resident-complaint.UPDATE",
            message: `Update failed: ${fieldUpdateRes.error.message}`,
            timestamp: new Date().toISOString(),
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Failed to update complaint: ${fieldUpdateRes.error.message}`,
            500,
        );
    }

    // 4. Image additions — in parallel, and in parallel with final fetch
    const imageAddPromise = hasImageAdd
        ? prepareComplaintImages(
            complaintId,
            ctx.callerSocietyId,
            societyRegNum,
            ctx.callerUserId,
            body.complaintImages!,
        )
        : Promise.resolve([] as DocumentResponse[]);

    const finalFetchPromise = supabaseAdmin
        .from("SSP_Complaint")
        .select(`
            complaint_id, name, description, status, priority,
            complaint_type, created_at, society_user
        `)
        .eq("complaint_id", complaintId)
        .maybeSingle();

    const [uploadResponses, updatedRes] = await Promise.all([
        imageAddPromise,
        finalFetchPromise,
    ]);

    const updated = updatedRes.data;

    console.log(
        `[complaint][UPDATE] parallel ${Date.now() - tParallel}ms, ` +
            `TOTAL ${Date.now() - t0}ms`,
    );

    return buildSuccess(req, {
        complaintUpdated: true,
        message: "Complaint updated successfully.",
        complaint: updated
            ? {
                complaintId: updated.complaint_id,
                title: updated.name,
                description: updated.description,
                status: updated.status,
                priority: updated.priority,
                complaintType: updated.complaint_type,
                createdAt: updated.created_at,
                residentDetails: {
                    residentId: updated.society_user,
                    name: ctx.callerName,
                },
            }
            : null,
        imagesRemoved: removedCount,
        documents: uploadResponses.length > 0 ? uploadResponses : null,
    });
}

// ============================================
// HANDLER: VIEW
// ============================================

async function handleView(
    req: Request,
    ctx: CallerCtx,
    body: CrudResidentComplaintRequest,
): Promise<Response> {
    const t0 = Date.now();
    const filters = body.filters ?? {};
    const sortField =
        ["created_at", "priority", "status"].includes(body.sort?.field ?? "")
            ? body.sort!.field!
            : "created_at";
    const sortAsc = body.sort?.order === "asc";
    const page = Math.max(1, Number(body.pagination?.page ?? 1) | 0);
    const pageSize = clampPageSize(body.pagination?.pageSize);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const cleanStatus = filters.status && filters.status.toLowerCase() !== "all"
        ? cleanText(filters.status, 30).toLowerCase()
        : null;
    const cleanPriority =
        filters.priority && filters.priority.toLowerCase() !== "all"
            ? cleanText(filters.priority, 20).toLowerCase()
            : null;
    const cleanType =
        filters.complaintType && filters.complaintType.toLowerCase() !== "all"
            ? cleanText(filters.complaintType, 30).toLowerCase()
            : null;
    const cleanSearch = filters.search && filters.search.trim() !== ""
        ? cleanText(filters.search, 60).replace(/[%_,()]/g, "")
        : null;

    const SELECT = `
        complaint_id, name, description, status, complaint_type,
        priority, created_at, assigned_date_time, completion_date_time,
        society_user, assigned_agent, non_society_user, assigned_by
    `;

    let dataQuery = supabaseAdmin
        .from("SSP_Complaint")
        .select(SELECT)
        .eq("society_user", ctx.callerUserId)
        .is("deleted_at", null);

    let countQuery = supabaseAdmin
        .from("SSP_Complaint")
        .select("*", { count: "exact", head: true })
        .eq("society_user", ctx.callerUserId)
        .is("deleted_at", null);

    // deno-lint-ignore no-explicit-any
    const applyFilters = (q: any): any => {
        let out = q;
        if (cleanStatus) out = out.eq("status", cleanStatus);
        if (cleanPriority) out = out.eq("priority", cleanPriority);
        if (cleanType) out = out.eq("complaint_type", cleanType);

        const bounds = calculateDateBounds(
            filters.filterOption,
            filters.fromDate,
            filters.toDate,
        );
        if (bounds) {
            out = out
                .gte("created_at", bounds.startISO)
                .lt("created_at", bounds.endISO);
        }
        if (cleanSearch) {
            out = out.or(
                `name.ilike.%${cleanSearch}%,description.ilike.%${cleanSearch}%`,
            );
        }
        return out;
    };

    dataQuery = applyFilters(dataQuery);
    countQuery = applyFilters(countQuery);

    dataQuery = dataQuery
        .order(sortField, { ascending: sortAsc, nullsFirst: false })
        .range(from, to);

    const [dataRes, countRes] = await Promise.all([dataQuery, countQuery]);
    console.log(`[complaint][VIEW] data+count ${Date.now() - t0}ms`);

    if (dataRes.error) {
        logger.error({
            level: "error",
            action: "crud-resident-complaint.VIEW",
            message: `Query failed: ${dataRes.error.message}`,
            timestamp: new Date().toISOString(),
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Database error: ${dataRes.error.message}`,
            500,
        );
    }

    const total = countRes.error ? 0 : countRes.count ?? 0;
    const rows = (dataRes.data ?? []) as RawComplaint[];

    const complaintIds = rows.map((c) => c.complaint_id);
    const agentIds = Array.from(
        new Set(
            rows.map((c) => c.assigned_agent).filter((v): v is string => !!v),
        ),
    );
    const vendorIds = Array.from(
        new Set(
            rows
                .map((c) => c.non_society_user)
                .filter((v): v is string => !!v),
        ),
    );

    // ---- PARALLEL: images + agent names + vendor names ----
    const tEnrich = Date.now();
    const [imageMap, agentNames, vendorNames] = await Promise.all([
        fetchComplaintImages(complaintIds, ctx.callerSocietyId),
        fetchAgentNames(agentIds),
        fetchVendorNames(vendorIds),
    ]);
    console.log(`[complaint][VIEW] enrich ${Date.now() - tEnrich}ms`);

    const complaints = rows.map((c) => {
        const imgs = imageMap.get(c.complaint_id) ?? {
            residentUploaded: [],
            before: [],
            after: [],
        };
        return {
            complaintId: c.complaint_id,
            title: c.name || "Untitled",
            description: c.description || "",
            status: c.status || "pending",
            priority: c.priority || "medium",
            complaintType: c.complaint_type || "general",
            createdAt: c.created_at,
            assignedDateTime: c.assigned_date_time,
            completionDateTime: c.completion_date_time,
            assignedAgent: {
                agentId: c.assigned_agent || null,
                name: c.assigned_agent
                    ? agentNames.get(c.assigned_agent) ?? null
                    : null,
            },
            assignedVendor: {
                vendorId: c.non_society_user || null,
                name: c.non_society_user
                    ? vendorNames.get(c.non_society_user) ?? null
                    : null,
            },
            images: {
                residentUploaded: imgs.residentUploaded.length > 0
                    ? imgs.residentUploaded
                    : null,
                before: imgs.before.length > 0 ? imgs.before : null,
                after: imgs.after.length > 0 ? imgs.after : null,
            },
        };
    });

    console.log(`[complaint][VIEW] TOTAL ${Date.now() - t0}ms`);

    return buildSuccess(req, {
        complaints,
        pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        },
        filters: {
            status: filters.status ?? null,
            priority: filters.priority ?? null,
            complaintType: filters.complaintType ?? null,
            filterOption: filters.filterOption ?? null,
            fromDate: filters.fromDate ?? null,
            toDate: filters.toDate ?? null,
        },
        search: filters.search ?? null,
        residentDetails: {
            residentId: ctx.callerUserId,
            name: ctx.callerName,
            phone: ctx.callerPhone,
            email: ctx.callerEmail,
            unitFlatNumber: ctx.callerFlat || null,
            blockName: ctx.callerBlock,
            towerName: ctx.callerTower,
        },
    });
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
    requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
        if (req.method === "OPTIONS") {
            return new Response("ok", { headers: corsHeaders });
        }
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }

        const t0 = Date.now();
        let action: Action = "VIEW";

        try {
            // ---- PARALLEL: body parse + auth context ----
            const [body, auth] = await Promise.all([
                parseRequestBody<CrudResidentComplaintRequest>(req),
                getContext(authCtx.user.id),
            ]);

            if (!body) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "Request body is required.",
                    400,
                );
            }

            const rawAction = String(body.action ?? "").toUpperCase();
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
            }

            logger.info({
                level: "info",
                action: `crud-resident-complaint.${action}`,
                userId: authCtx.user.id,
                actionMs: Date.now() - tAction,
                totalMs: Date.now() - t0,
                timestamp: new Date().toISOString(),
            });

            return response!;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Unknown error";
            logger.error({
                level: "error",
                action: `crud-resident-complaint.${action}`,
                userId: authCtx?.user?.id || "unknown",
                message: msg,
                stack: e instanceof Error ? e.stack : undefined,
                timestamp: new Date().toISOString(),
            });
            return buildError(
                req,
                "SERVER_ERROR",
                "Internal server error.",
                500,
            );
        }
    }),
);
