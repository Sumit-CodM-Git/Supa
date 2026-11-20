import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

type Action = "VIEW" | "UPLOAD" | "DOWNLOAD" | "DELETE";
type UploadPhase = "request" | "confirm";

interface CrudDocumentRequest {
    societyRegistrationNumber: string;
    adminId: string;
    action: Action;

    // VIEW options
    search?: string;
    filters?: {
        documentType?: string | string[];
        fileType?: string | string[];
        uploadedBy?: string | string[];
        dateFrom?: string;
        dateTo?: string;
    };
    sort?: {
        field?: string;
        order?: "asc" | "desc";
    };
    page?: number;
    limit?: number;

    // UPLOAD
    phase?: UploadPhase;
    payload?: {
        documentTitle?: string;
        category?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number | string;
        objectKey?: string;
    };

    // DOWNLOAD / DELETE / UPLOAD-confirm
    documentId?: string;
}

interface DocumentRow {
    document_id: string;
    name: string | null;
    file_name: string | null;
    file_type: string | null;
    file_size: number | null;
    document_type: string | null;
    uploaded_on: string | null;
    s3_path: string | null;
    society: string | null;
    uploaded_by: string | null;
}

interface UserRow {
    user_id: string;
    contact: string | null;
}

interface ContactRow {
    contact_id: string;
    name: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET_NAME = "society-documents";

// ✅ This matches your bucket structure exactly
const DOCUMENTS_FOLDER = "documents/societyDocuments";

const ADMIN_ROLE = "admin";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const SIGNED_URL_EXPIRY = 900; // 15 min
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const VALID_ACTIONS: readonly Action[] = [
    "VIEW",
    "UPLOAD",
    "DOWNLOAD",
    "DELETE",
];

const VALID_SORT_FIELDS = [
    "name",
    "file_name",
    "uploaded_on",
    "file_size",
    "document_type",
] as const;

const VALID_CATEGORIES = [
    "before_complaint_image",
    "after_complaint_image",
    "bylaws",
    "financial",
    "identification",
    "market_place_image",
    "security_guard_image",
    "servant_image",
    "society_rules",
] as const;

const VALID_FILE_TYPES = [
    "application/pdf",
    "image/avif",
    "image/jpeg",
    "image/png",
] as const;

const DOC_SELECT_FIELDS =
    "document_id,name,file_name,file_type,file_size,document_type," +
    "uploaded_on,s3_path,society,uploaded_by";

const FILE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|heic|bmp|tiff?|pdf|docx?|xlsx?|pptx?|txt|csv)$/i;

const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// RESPONSE HELPERS
// ============================================

function respond(data: unknown, status = 200): Response {
    return new Response(
        JSON.stringify({ status: "SUCCESS", data }),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

function fail(message: string, status = 400, code = "ERROR"): Response {
    return new Response(
        JSON.stringify({
            status: "FAILURE",
            errorResponse: { errorCode: code, message },
        }),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

// ============================================
// VALIDATION HELPERS
// ============================================

function isValidUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(value);
}

/**
 * Robust admin-role check — handles text[], scalar text, and Postgres
 * array-literal strings like `{admin,resident}` or `["admin"]`.
 * Case-insensitive.
 */
function hasAdminRole(role: unknown): boolean {
    if (role === null || role === undefined) return false;

    if (Array.isArray(role)) {
        return role.some(
            (r) => String(r).trim().toLowerCase() === "admin",
        );
    }

    const s = String(role).trim();
    if (s === "") return false;

    // Handles Postgres string format: '{admin,resident}' or JSON format: '["admin"]'
    if (s.startsWith("{") || s.startsWith("[")) {
        const inner = s.replace(/^[\[{]/, "").replace(/[\]}]$/, "");
        return inner
            .split(",")
            .map((r) => r.replace(/["']/g, "").trim().toLowerCase())
            .includes("admin");
    }

    return s.toLowerCase() === "admin";
}

function normalizeArray(input: string | string[] | undefined): string[] | null {
    if (!input) return null;
    if (Array.isArray(input)) {
        const cleaned = input.filter((x) => x && String(x).trim() !== "");
        return cleaned.length > 0 ? cleaned.map((x) => String(x).trim()) : null;
    }
    const trimmed = String(input).trim();
    if (!trimmed) return null;
    if (trimmed.includes(",")) {
        const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
        return parts.length > 0 ? parts : null;
    }
    return [trimmed];
}

function parseNumber(
    value: number | string | undefined | null,
): number | null {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

function isValidCategory(c: string): boolean {
    return (VALID_CATEGORIES as readonly string[]).includes(c);
}

function isValidFileType(t: string): boolean {
    return (VALID_FILE_TYPES as readonly string[]).includes(t);
}

function extractStorageKey(s3Path: string | null): string | null {
    if (!s3Path) return null;
    const trimmed = s3Path.trim();
    if (!trimmed) return null;

    const markers = [
        `/storage/v1/object/public/${BUCKET_NAME}/`,
        `/storage/v1/object/sign/${BUCKET_NAME}/`,
    ];

    for (const marker of markers) {
        const idx = trimmed.indexOf(marker);
        if (idx >= 0) {
            return trimmed.slice(idx + marker.length).split("?")[0];
        }
    }

    if (trimmed.includes(".amazonaws.com/")) {
        return trimmed.split(".amazonaws.com/")[1].split("?")[0];
    }

    return trimmed.split("?")[0];
}

// ============================================
// AUTH
// ============================================

async function authorizeAdmin(
    societyRegistrationNumber: string,
    adminId: string,
): Promise<
    { ok: true; societyId: string } | { ok: false; response: Response }
> {
    const cleanRegNum = String(societyRegistrationNumber).trim();
    const cleanAdminId = String(adminId).trim();

    if (!isValidUUID(cleanAdminId)) {
        return {
            ok: false,
            response: fail("adminId must be a valid UUID.", 400, "INVALID_PARAMETERS"),
        };
    }

    const { data: society, error: societyErr } = await supabase
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", cleanRegNum)
        .maybeSingle();

    if (societyErr) {
        return { ok: false, response: fail(societyErr.message, 500, "DATABASE_ERROR") };
    }
    if (!society) {
        return { ok: false, response: fail("Society not found.", 404, "NOT_FOUND") };
    }

    const { data: admin, error: adminErr } = await supabase
        .from("SSP_Society_User")
        .select("user_id, role")
        .eq("user_id", cleanAdminId)
        .eq("society", society.society_id)
        .maybeSingle();

    if (adminErr) {
        return { ok: false, response: fail(adminErr.message, 500, "DATABASE_ERROR") };
    }

    const role = (admin as { role?: unknown } | null)?.role;
    if (!admin || !hasAdminRole(role)) {
        return { ok: false, response: fail("Unauthorized Admin Access.", 403, "UNAUTHORIZED") };
    }

    return { ok: true, societyId: society.society_id };
}

// ============================================
// FORMATTER
// ============================================

async function buildUploaderMap(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length === 0) return map;

    const { data: users } = await supabase
        .from("SSP_Society_User")
        .select("user_id, contact")
        .in("user_id", uniqueIds);

    const contactIds = ((users ?? []) as UserRow[])
        .map((u) => u.contact)
        .filter((c): c is string => !!c);

    if (contactIds.length === 0) return map;

    const { data: contacts } = await supabase
        .from("SSP_Contact")
        .select("contact_id, name")
        .in("contact_id", contactIds);

    const contactNameMap = new Map(
        ((contacts ?? []) as ContactRow[]).map((c) => [
            c.contact_id,
            c.name ?? "Unknown",
        ]),
    );

    for (const u of (users ?? []) as UserRow[]) {
        if (u.contact && contactNameMap.has(u.contact)) {
            map.set(u.user_id, contactNameMap.get(u.contact) ?? "Unknown");
        }
    }
    return map;
}

/**
 * Fixes legacy records where `file_name` is null and the filename was
 * mistakenly saved into the `name` column.
 */
function resolveNameAndFileName(row: DocumentRow): { name: string | null; fileName: string | null } {
    const dbName = row.name?.trim() ?? null;
    const dbFileName = row.file_name?.trim() ?? null;

    // Happy path: file_name is set OR name doesn't look like a file
    if (dbFileName || !dbName || !FILE_EXT_RE.test(dbName)) {
        return { name: dbName, fileName: dbFileName };
    }

    // Legacy path: `name` holds the filename (e.g. "document_123.jpg")
    const base = dbName.replace(/\.[^.]+$/, "");
    const friendly = base.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();

    const recoveredName = friendly.length > 0
        ? friendly.replace(/\b\w/g, (c) => c.toUpperCase())
        : "Untitled Document";

    return { name: recoveredName, fileName: dbName };
}

function formatDocument(
    row: DocumentRow,
    uploaderName: string | null,
): Record<string, unknown> {
    const { name, fileName } = resolveNameAndFileName(row);

    return {
        documentId: row.document_id,
        name,                                                     
        fileName,                                                 
        fileType: row.file_type,
        fileSize: row.file_size != null ? String(row.file_size) : null,  
        documentType: row.document_type,
        uploadedOn: row.uploaded_on,
        uploadedBy: row.uploaded_by
            ? {
                userId: row.uploaded_by,
                name: uploaderName ?? "Unknown",
            }
            : null,
    };
}

// ============================================
// ACTION: VIEW
// ============================================

async function handleView(
    req: CrudDocumentRequest,
    societyId: string,
): Promise<Response> {
    const page = Math.max(1, Number(req.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.limit) || DEFAULT_LIMIT));
    const offset = (page - 1) * limit;

    let query = supabase
        .from("SSP_Document")
        .select(DOC_SELECT_FIELDS, { count: "exact" })
        .eq("society", societyId);

    // ── Search ──
    if (req.search && req.search.trim() !== "") {
        const term = req.search.trim();
        query = query.or(
            `name.ilike.%${term}%,` +
                `file_name.ilike.%${term}%,` +
                `document_type.ilike.%${term}%,` +
                `file_type.ilike.%${term}%`,
        );
    }

    // ── Filters ──
    if (req.filters) {
        const docTypes = normalizeArray(req.filters.documentType);
        if (docTypes && docTypes.length > 0) {
            query = query.in("document_type", docTypes);
        }

        const fileTypes = normalizeArray(req.filters.fileType);
        if (fileTypes && fileTypes.length > 0) {
            query = query.in("file_type", fileTypes);
        }

        const uploadedBy = normalizeArray(req.filters.uploadedBy);
        if (uploadedBy && uploadedBy.length > 0) {
            query = query.in("uploaded_by", uploadedBy);
        }

        if (req.filters.dateFrom) {
            query = query.gte("uploaded_on", req.filters.dateFrom);
        }
        if (req.filters.dateTo) {
            const end = `${req.filters.dateTo}T23:59:59.999Z`;
            query = query.lte("uploaded_on", end);
        }
    }

    // ── Sort ──
    const requestedSort = req.sort?.field || "uploaded_on";
    const sortField = (VALID_SORT_FIELDS as readonly string[]).includes(requestedSort)
        ? requestedSort
        : "uploaded_on";
    const ascending = req.sort?.order === "asc";

    // ✅ FIX: nullsFirst: false prevents legacy null dates from taking over page 1
    query = query.order(sortField, { ascending, nullsFirst: false });

    // ── Pagination ──
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
        return fail(error.message, 500, "DATABASE_ERROR");
    }

    const rows = (data ?? []) as DocumentRow[];

    const uploaderIds = rows
        .map((r) => r.uploaded_by)
        .filter((x): x is string => !!x);
    const uploaderMap = await buildUploaderMap(uploaderIds);

    const documents = rows.map((r) =>
        formatDocument(
            r,
            r.uploaded_by ? uploaderMap.get(r.uploaded_by) ?? null : null,
        )
    );

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    return respond({
        documents,
        pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
        },
        filters: {
            documentType: req.filters?.documentType ?? null,
            fileType: req.filters?.fileType ?? null,
            uploadedBy: req.filters?.uploadedBy ?? null,
            dateFrom: req.filters?.dateFrom ?? null,
            dateTo: req.filters?.dateTo ?? null,
        },
        search: req.search ?? null,
        sort: { field: sortField, order: ascending ? "asc" : "desc" },
    });
}

// ============================================
// ACTION: UPLOAD
// ============================================

async function handleUpload(
    req: CrudDocumentRequest,
    societyId: string,
    societyRegNo: string,
    adminId: string,
): Promise<Response> {
    const p = req.payload;
    if (!p) {
        return fail("payload is required for UPLOAD.", 400, "MISSING_PARAMETERS");
    }

    const phase = (req.phase || "request").toLowerCase();

    const required = ["documentTitle", "category", "fileName", "fileType"] as const;
    for (const k of required) {
        if (!p[k] || String(p[k]).trim() === "") {
            return fail(`payload.${k} is required for UPLOAD.`, 400, "MISSING_PARAMETERS");
        }
    }

    const cleanFileName = String(p.fileName).trim();
    const cleanFileType = String(p.fileType).trim();
    const cleanCategory = String(p.category).trim().toLowerCase();
    const cleanTitle = String(p.documentTitle).trim();
    const fileSize = parseNumber(p.fileSize);

    if (/[\/\\]/.test(cleanFileName) || cleanFileName.includes("..")) {
        return fail("payload.fileName must not contain slashes or '..'.", 400, "INVALID_PARAMETERS");
    }

    if (!isValidCategory(cleanCategory)) {
        return fail(`Invalid category: "${cleanCategory}". Valid: ${VALID_CATEGORIES.join(", ")}`, 400, "INVALID_PARAMETERS");
    }

    if (!isValidFileType(cleanFileType)) {
        return fail(`Invalid fileType: "${cleanFileType}". Valid: ${VALID_FILE_TYPES.join(", ")}`, 400, "INVALID_PARAMETERS");
    }

    if (fileSize !== null && fileSize > MAX_FILE_SIZE) {
        return fail(`File too large. Max ${MAX_FILE_SIZE / (1024 * 1024)} MB.`, 400, "FILE_TOO_LARGE");
    }

    // ── PHASE: request ──
    if (phase === "request") {
        const documentId = crypto.randomUUID();

        // ✅ Path is exactly what you requested
        const objectKey = `${societyRegNo}/${DOCUMENTS_FOLDER}/${documentId}/${cleanFileName}`;

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey);

        if (error || !data) {
            return fail(`Failed to generate upload URL: ${error?.message ?? "unknown"}`, 500, "STORAGE_ERROR");
        }

        return respond({
            uploaded: false,
            documentId,
            signedUrl: data.signedUrl,
            objectKey,
            expiresIn: SIGNED_URL_EXPIRY,
            maxFileSize: MAX_FILE_SIZE,
        });
    }

    // ── PHASE: confirm ──
    if (phase === "confirm") {
        if (!p.objectKey || String(p.objectKey).trim() === "") {
            return fail("payload.objectKey is required for confirm phase.", 400, "MISSING_PARAMETERS");
        }

        if (!req.documentId || String(req.documentId).trim() === "") {
            return fail("documentId is required for confirm phase.", 400, "MISSING_PARAMETERS");
        }
        if (!isValidUUID(String(req.documentId).trim())) {
            return fail("documentId must be a valid UUID.", 400, "INVALID_PARAMETERS");
        }

        const objectKey = String(p.objectKey).trim();
        const documentId = String(req.documentId).trim();

        const expectedSegment = `${societyRegNo}/${DOCUMENTS_FOLDER}/${documentId}/`;
        if (!objectKey.startsWith(expectedSegment)) {
            return fail("objectKey does not match the provided documentId.", 400, "INVALID_PARAMETERS");
        }

        const folder = objectKey.split("/").slice(0, -1).join("/");
        const leaf = objectKey.split("/").pop() ?? "";

        const { data: existsCheck } = await supabase.storage
            .from(BUCKET_NAME)
            .list(folder, { search: leaf });

        const fileExists = Array.isArray(existsCheck) &&
            existsCheck.some((f) => `${folder}/${f.name}` === objectKey);

        if (!fileExists) {
            return fail("Uploaded file not found in storage. Please re-upload.", 400, "STORAGE_ERROR");
        }

        const { data: urlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(objectKey);

        const { data: inserted, error: insertErr } = await supabase
            .from("SSP_Document")
            .insert({
                document_id: documentId,
                name: cleanTitle,           
                file_name: cleanFileName,   
                file_type: cleanFileType,
                file_size: fileSize,
                document_type: cleanCategory,
                s3_path: urlData.publicUrl, 
                society: societyId,
                uploaded_by: adminId,
                uploaded_on: new Date().toISOString(),
            })
            .select("document_id")
            .single();

        if (insertErr || !inserted) {
            return fail(`Failed to save metadata: ${insertErr?.message ?? "unknown"}`, 500, "DATABASE_ERROR");
        }

        return respond({
            uploaded: true,
            documentId: inserted.document_id,
            objectKey,
            message: "Document uploaded successfully.",
        });
    }

    return fail(`Invalid phase: "${phase}".`, 400, "INVALID_PARAMETERS");
}

// ============================================
// ACTION: DOWNLOAD
// ============================================

async function handleDownload(
    req: CrudDocumentRequest,
    societyId: string,
): Promise<Response> {
    if (!req.documentId || String(req.documentId).trim() === "") {
        return fail("documentId is required.", 400, "MISSING_PARAMETERS");
    }
    if (!isValidUUID(String(req.documentId).trim())) {
        return fail("documentId must be a valid UUID.", 400, "INVALID_PARAMETERS");
    }

    const { data: doc, error: findErr } = await supabase
        .from("SSP_Document")
        .select("document_id,s3_path,society")
        .eq("document_id", String(req.documentId).trim())
        .eq("society", societyId)
        .maybeSingle();

    if (findErr) return fail(findErr.message, 500, "DATABASE_ERROR");
    if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

    const storageKey = extractStorageKey((doc as { s3_path: string | null }).s3_path);
    if (!storageKey) {
        return fail("Document has no valid storage path.", 500, "STORAGE_ERROR");
    }

    const { data, error: signedErr } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storageKey, SIGNED_URL_EXPIRY);

    if (signedErr || !data) {
        return fail(`Failed to generate download URL: ${signedErr?.message ?? "unknown"}`, 500, "STORAGE_ERROR");
    }

    return respond({
        documentId: doc.document_id,
        signedUrl: data.signedUrl,
        expiresIn: SIGNED_URL_EXPIRY,
    });
}

// ============================================
// ACTION: DELETE
// ============================================

async function handleDelete(
    req: CrudDocumentRequest,
    societyId: string,
): Promise<Response> {
    if (!req.documentId || String(req.documentId).trim() === "") {
        return fail("documentId is required.", 400, "MISSING_PARAMETERS");
    }
    if (!isValidUUID(String(req.documentId).trim())) {
        return fail("documentId must be a valid UUID.", 400, "INVALID_PARAMETERS");
    }

    const { data: doc, error: findErr } = await supabase
        .from("SSP_Document")
        .select("document_id,s3_path,society")
        .eq("document_id", String(req.documentId).trim())
        .eq("society", societyId)
        .maybeSingle();

    if (findErr) return fail(findErr.message, 500, "DATABASE_ERROR");
    if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

    const storageKey = extractStorageKey((doc as { s3_path: string | null }).s3_path);

    if (storageKey) {
        const { error: storageErr } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([storageKey]);

        if (storageErr) {
            console.error(`⚠️ Storage delete failed for ${storageKey}: ${storageErr.message}`);
        }
    }

    const { error: dbErr } = await supabase
        .from("SSP_Document")
        .delete()
        .eq("document_id", String(req.documentId).trim())
        .eq("society", societyId);

    if (dbErr) return fail(dbErr.message, 500, "DATABASE_ERROR");

    return respond({
        documentId: req.documentId,
        message: "Document deleted successfully.",
    });
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return fail("Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
    }

    const startTime = Date.now();

    try {
        const body = (await req.json().catch(() => null)) as CrudDocumentRequest | null;
        if (!body) return fail("Request body is required.", 400, "BAD_REQUEST");

        const { societyRegistrationNumber, adminId, action } = body;

        if (!societyRegistrationNumber || !adminId || !action) {
            return fail("societyRegistrationNumber, adminId, and action are required.", 400, "MISSING_PARAMETERS");
        }

        const actionUpper = String(action).toUpperCase() as Action;
        if (!VALID_ACTIONS.includes(actionUpper)) {
            return fail(`Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`, 400, "INVALID_ACTION");
        }

        const auth = await authorizeAdmin(String(societyRegistrationNumber), String(adminId));
        if (!auth.ok) return auth.response;

        const societyId = auth.societyId;
        const cleanRegNo = String(societyRegistrationNumber).trim();
        const cleanAdminId = String(adminId).trim();

        let response: Response;

        switch (actionUpper) {
            case "VIEW":
                response = await handleView(body, societyId);
                break;
            case "UPLOAD":
                response = await handleUpload(body, societyId, cleanRegNo, cleanAdminId);
                break;
            case "DOWNLOAD":
                response = await handleDownload(body, societyId);
                break;
            case "DELETE":
                response = await handleDelete(body, societyId);
                break;
            default:
                return fail("Unhandled action.", 400, "INVALID_ACTION");
        }

        console.log(`✅ crud-document: action=${actionUpper}, society=${societyId}, ${Date.now() - startTime}ms`);

        return response;
    } catch (err: unknown) {
        console.error("❌ FULL ERROR:", err);
        const msg = err instanceof Error ? err.message : "Unknown error";
        return fail(msg, 500, "SERVER_ERROR");
    }
});