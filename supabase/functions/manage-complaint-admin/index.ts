// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// crud-complaint-admin
// Actions: VIEW | ASSIGN | STAFF_LIST
// Admin-side complaint management
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
    corsHeaders,
    errorResponse,
    successResponse,
} from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface CrudComplaintAdminRequest {
    action: "VIEW" | "ASSIGN" | "STAFF_LIST";
    // VIEW
    filters?: {
        status?: string;
        priority?: string;
        complaintType?: string;
        assignedAgentId?: string;
        assignedVendorId?: string;
        residentId?: string;
        filterOption?: string;
        fromDate?: string;
        toDate?: string;
        search?: string;
    };
    sort?: { field?: string; order?: "asc" | "desc" };
    pagination?: { page?: number; pageSize?: number };
    // ASSIGN / STAFF_LIST
    complaintId?: string;
    // ASSIGN
    staffId?: string;
}

interface CallerCtx {
    authUserId: string;
    callerUserId: string;
    callerSocietyId: string;
    callerRoles: string[];
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

interface AvailableStaff {
    id: string;
    name: string;
    phone: string | null;
    role: "vendor" | "service_agent";
    serviceType: string | null;
    rating: string | null;
    availabilityStatus: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_IMAGES_PER_TYPE = 5;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const SIGNED_URL_TTL = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const VALID_ACTIONS = ["VIEW", "ASSIGN", "STAFF_LIST"] as const;
type Action = typeof VALID_ACTIONS[number];

const VALID_SORT_FIELDS = [
    "created_at",
    "priority",
    "status",
    "assigned_date_time",
] as const;

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
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
// INPUT HELPERS
// ============================================

function cleanText(v: unknown, max = 500): string {
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

function isAdminRole(roles: string[]): boolean {
    return roles.some((r) => {
        const n = r.toLowerCase().replace(/[\s-]+/g, "_");
        return n === "admin" || n === "super_admin" || n === "superadmin";
    });
}

function getISTISOString(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${
        map.get("hour")
    }:${map.get("minute")}:${map.get("second")}+05:30`;
}

// ============================================
// SIGNED URL HELPERS
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
        .select("user_id, society, role, deleted_at")
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

    const roles = Array.isArray(data.role) ? (data.role as string[]) : [];

    return {
        ok: true,
        ctx: {
            authUserId: userId,
            callerUserId: String(data.user_id),
            callerSocietyId: String(data.society ?? ""),
            callerRoles: roles,
        },
    };
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
        const docType = (d.document_type ?? "")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "_");

        const entry = {
            documentId: d.document_id,
            path: d.s3_path,
            name: d.name,
            type: d.file_type,
            size: d.file_size,
        };

        if (
            docType === "complaint_attachment" ||
            docType === "facility_attachment" ||
            docType === "before_complaint_image"
        ) {
            if (bucket.residentUploaded.length < MAX_IMAGES_PER_TYPE) {
                bucket.residentUploaded.push(entry);
            }
        } else if (docType === "before_image") {
            if (bucket.before.length < MAX_IMAGES_PER_TYPE) {
                bucket.before.push(entry);
            }
        } else if (
            docType === "after_complaint_image" ||
            docType === "after_image"
        ) {
            if (bucket.after.length < MAX_IMAGES_PER_TYPE) {
                bucket.after.push(entry);
            }
        }
        allPaths.push(d.s3_path);
    }

    const signedMap = await batchSignUrls(allPaths);

    for (const [complaintId, bucket] of tmp.entries()) {
        const build = (
            list: typeof bucket.residentUploaded,
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
// STAFF_LIST — helpers
// ============================================

function parseServiceTypes(serviceType: string | null): string[] {
    if (!serviceType) return [];
    const raw = String(serviceType).trim();

    if (raw.startsWith("[")) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((s: string) =>
                    String(s).trim().toLowerCase()
                );
            }
            return [];
        } catch {
            return [];
        }
    }

    if (raw.includes(",")) {
        return raw.split(",").map((x) => x.trim().toLowerCase());
    }

    return [raw.toLowerCase()];
}

function normalizeComplaintType(type: string): string {
    const n = type.toLowerCase().trim();
    const map: Record<string, string> = {
        "electric": "electrical",
        "carpenter": "carpentry",
        "carpanter": "carpentry",
        "painter": "painting",
        "plumber": "plumbing",
        "other": "other",
        "others": "other",
    };
    return map[n] || n;
}

function matchesComplaintType(
    staffServices: string[],
    complaintType: string,
    isOtherComplaint: boolean,
): boolean {
    if (isOtherComplaint) return staffServices.includes("other");
    const nc = normalizeComplaintType(complaintType);
    return staffServices.some((s) => normalizeComplaintType(s) === nc);
}

function sortStaff(staff: AvailableStaff[]): AvailableStaff[] {
    return [...staff].sort((a, b) => {
        if (a.role === "service_agent" && b.role === "vendor") return -1;
        if (a.role === "vendor" && b.role === "service_agent") return 1;
        const ra = parseFloat(a.rating || "0");
        const rb = parseFloat(b.rating || "0");
        return rb - ra;
    });
}

// ============================================
// HANDLER — VIEW
// ============================================

async function handleView(
    req: Request,
    ctx: CallerCtx,
    body: CrudComplaintAdminRequest,
): Promise<Response> {
    const filters = body.filters ?? {};
    const sortField = VALID_SORT_FIELDS.includes(
            body.sort?.field as typeof VALID_SORT_FIELDS[number],
        )
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
    const cleanAgentId = filters.assignedAgentId
        ? cleanText(filters.assignedAgentId, 50)
        : null;
    const cleanVendorId = filters.assignedVendorId
        ? cleanText(filters.assignedVendorId, 50)
        : null;
    const cleanResidentId = filters.residentId
        ? cleanText(filters.residentId, 50)
        : null;

    // Society scoping — fetch all user_ids in society
    const { data: societyUsers, error: usersErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("society", ctx.callerSocietyId);

    if (usersErr) {
        return buildError(req, "SERVER_ERROR", usersErr.message, 500);
    }

    const userIds = (societyUsers ?? []).map((u) => String(u.user_id));

    if (userIds.length === 0) {
        return buildSuccess(req, {
            complaints: [],
            pagination: { total: 0, page, pageSize, totalPages: 0 },
            filters: {
                status: filters.status ?? null,
                priority: filters.priority ?? null,
                complaintType: filters.complaintType ?? null,
                assignedAgentId: filters.assignedAgentId ?? null,
                assignedVendorId: filters.assignedVendorId ?? null,
                residentId: filters.residentId ?? null,
                filterOption: filters.filterOption ?? null,
                fromDate: filters.fromDate ?? null,
                toDate: filters.toDate ?? null,
            },
            search: filters.search ?? null,
        });
    }

    const SELECT = `
        complaint_id, name, description, status, complaint_type,
        priority, created_at, assigned_date_time, completion_date_time,
        society_user, assigned_agent, non_society_user, assigned_by
    `;

    let dataQuery = supabaseAdmin
        .from("SSP_Complaint")
        .select(SELECT)
        .in("society_user", userIds)
        .is("deleted_at", null);

    let countQuery = supabaseAdmin
        .from("SSP_Complaint")
        .select("*", { count: "exact", head: true })
        .in("society_user", userIds)
        .is("deleted_at", null);

    // deno-lint-ignore no-explicit-any
    const applyFilters = (q: any): any => {
        let out = q;
        if (cleanStatus) out = out.eq("status", cleanStatus);
        if (cleanPriority) out = out.eq("priority", cleanPriority);
        if (cleanType) out = out.eq("complaint_type", cleanType);
        if (cleanAgentId) out = out.eq("assigned_agent", cleanAgentId);
        if (cleanVendorId) out = out.eq("non_society_user", cleanVendorId);
        if (cleanResidentId) out = out.eq("society_user", cleanResidentId);

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

    if (dataRes.error) {
        logger.error({
            level: "error",
            action: "crud-complaint-admin.VIEW",
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
    const rows = (dataRes.data ?? []) as Array<Record<string, unknown>>;

    const complaintIds = rows.map((c) => String(c.complaint_id));
    const residentIds = Array.from(
        new Set(
            rows.map((c) => String(c.society_user ?? "")).filter(Boolean),
        ),
    );
    const agentIds = Array.from(
        new Set(
            rows
                .map((c) => c.assigned_agent as string | null)
                .filter((v): v is string => !!v),
        ),
    );
    const vendorIds = Array.from(
        new Set(
            rows
                .map((c) => c.non_society_user as string | null)
                .filter((v): v is string => !!v),
        ),
    );
    const allUserIds = Array.from(new Set([...residentIds, ...agentIds]));

    const [usersRes, vendorsRes, imageMap] = await Promise.all([
        allUserIds.length > 0
            ? supabaseAdmin
                .from("SSP_Society_User")
                .select(`
                    user_id, 
                    unit_flat_number, 
                    tower:SSP_Tower ( name ), 
                    block:SSP_Block ( block_name ), 
                    contact:SSP_Contact!contact ( name, phone, email )
                `)
                .in("user_id", allUserIds)
            : Promise.resolve({ data: [], error: null } as const),

        vendorIds.length > 0
            ? supabaseAdmin
                .from("SSP_Non_Society_User")
                .select("non_society_user_id, name")
                .in("non_society_user_id", vendorIds)
            : Promise.resolve({ data: [], error: null } as const),

        fetchComplaintImages(complaintIds, ctx.callerSocietyId),
    ]);

    const userMap = new Map<string, Record<string, unknown>>();
    for (const u of (usersRes.data ?? []) as Array<Record<string, unknown>>) {
        userMap.set(String(u.user_id), u);
    }

    const vendorMap = new Map<string, string>();
    for (
        const v of (vendorsRes.data ?? []) as Array<{
            non_society_user_id: string;
            name: string | null;
        }>
    ) {
        if (v.name) vendorMap.set(v.non_society_user_id, v.name);
    }

    const complaints = rows.map((c) => {
        const cid = String(c.complaint_id);
        const residentId = String(c.society_user ?? "");
        const agentId = (c.assigned_agent as string | null) ?? null;
        const vendorId = (c.non_society_user as string | null) ?? null;

        const residentRow = userMap.get(residentId);
        const residentContact = residentRow
            ? Array.isArray(residentRow.contact)
                ? (residentRow.contact as any[])[0] ?? null
                : residentRow.contact
            : null;

        const agentRow = agentId ? userMap.get(agentId) : null;
        const agentContact = agentRow
            ? Array.isArray(agentRow.contact)
                ? (agentRow.contact as any[])[0] ?? null
                : agentRow.contact
            : null;

        const imgs = imageMap.get(cid) ?? {
            residentUploaded: [],
            before: [],
            after: [],
        };

        return {
            complaintId: cid,
            title: c.name ?? "Untitled",
            description: c.description ?? "",
            // FIX SSP-0067: Force metadata to lowercase for Flutter UI
            status: String(c.status ?? "pending").toLowerCase(),
            priority: String(c.priority ?? "medium").toLowerCase(),
            complaintType: String(c.complaint_type ?? "general").toLowerCase(),
            createdAt: c.created_at ?? null,
            assignedDateTime: c.assigned_date_time ?? null,
            completionDateTime: c.completion_date_time ?? null,
            residentDetails: {
                residentId,
                name: (residentContact as { name?: string } | null)?.name ??
                    "Unknown",
                phone: (residentContact as { phone?: string } | null)?.phone ??
                    "",
                email: (residentContact as { email?: string } | null)?.email ??
                    "",
                unitFlatNumber:
                    (residentRow?.unit_flat_number as string | null) ?? null,
                blockName: (() => {
                    const b = Array.isArray(residentRow?.block) ? residentRow.block[0] : residentRow?.block;
                    return (b as any)?.block_name ?? null;
                })(),
                towerName: (() => {
                    const t = Array.isArray(residentRow?.tower) ? residentRow.tower[0] : residentRow?.tower;
                    return (t as any)?.name ?? null;
                })(),
            },
            assignedAgent: {
                agentId,
                name: agentId
                    ? (agentContact as { name?: string } | null)?.name ?? null
                    : null,
            },
            assignedVendor: {
                vendorId,
                name: vendorId ? vendorMap.get(vendorId) ?? null : null,
            },
            // FIX: Always return arrays to prevent Flutter null pointer crashes
            images: {
                residentUploaded: imgs.residentUploaded,
                before: imgs.before,
                after: imgs.after,
            },
        };
    });

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
            assignedAgentId: filters.assignedAgentId ?? null,
            assignedVendorId: filters.assignedVendorId ?? null,
            residentId: filters.residentId ?? null,
            filterOption: filters.filterOption ?? null,
            fromDate: filters.fromDate ?? null,
            toDate: filters.toDate ?? null,
        },
        search: filters.search ?? null,
    });
}

// ============================================
// HANDLER — ASSIGN
// ============================================

async function handleAssign(
    req: Request,
    ctx: CallerCtx,
    body: CrudComplaintAdminRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    const staffId = cleanText(body.staffId, 50);

    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }
    if (!staffId) {
        return buildError(req, "BAD_REQUEST", "staffId is mandatory.", 400);
    }

    const { data: complaintRow, error: compErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .select(`
            complaint_id, status, assigned_agent, non_society_user,
            society_user_data:SSP_Society_User!society_user ( society )
        `)
        .eq("complaint_id", complaintId)
        .is("deleted_at", null)
        .maybeSingle();

    if (compErr) return buildError(req, "SERVER_ERROR", compErr.message, 500);
    if (!complaintRow) {
        return buildError(req, "NOT_FOUND", "Complaint not found.", 404);
    }

    const socRel = Array.isArray(complaintRow.society_user_data)
        ? complaintRow.society_user_data[0]
        : complaintRow.society_user_data;

    if (!socRel || socRel.society !== ctx.callerSocietyId) {
        return buildError(
            req,
            "FORBIDDEN",
            "Complaint does not belong to your society.",
            403,
        );
    }

    // Try vendor first
    const { data: vendorRow } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select("non_society_user_id, role, society")
        .eq("non_society_user_id", staffId)
        .eq("society", ctx.callerSocietyId)
        .maybeSingle();

    let targetType: "vendor" | "service_agent" | null = null;
    if (vendorRow && vendorRow.role === "vendor") {
        targetType = "vendor";
    } else {
        const { data: agentRow } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id, role, society")
            .eq("user_id", staffId)
            .eq("society", ctx.callerSocietyId)
            .maybeSingle();

        if (agentRow) {
            const roles = Array.isArray(agentRow.role)
                ? (agentRow.role as string[])
                : [];
            if (roles.includes("service_agent")) {
                targetType = "service_agent";
            }
        }
    }

    if (!targetType) {
        return buildError(
            req,
            "BAD_REQUEST",
            "staffId must be a valid vendor or service_agent in this society.",
            400,
        );
    }

    const updatePayload: Record<string, unknown> = {
        assigned_by: ctx.callerUserId,
        status: "assigned",
        assigned_date_time: getISTISOString(),
    };

    if (targetType === "vendor") {
        updatePayload.non_society_user = staffId;
        updatePayload.assigned_agent = null;
    } else {
        updatePayload.assigned_agent = staffId;
        updatePayload.non_society_user = null;
    }

    const { error: updateErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .update(updatePayload)
        .eq("complaint_id", complaintId);

    if (updateErr) {
        logger.error({
            level: "error",
            action: "crud-complaint-admin.ASSIGN",
            message: `Update failed: ${updateErr.message}`,
            timestamp: new Date().toISOString(),
        });
        return buildError(
            req,
            "SERVER_ERROR",
            `Failed to assign: ${updateErr.message}`,
            500,
        );
    }

    const { data: updated } = await supabaseAdmin
        .from("SSP_Complaint")
        .select(`
            complaint_id, status, assigned_date_time,
            assigned_agent, non_society_user, assigned_by
        `)
        .eq("complaint_id", complaintId)
        .maybeSingle();

    return buildSuccess(req, {
        assignmentStatus: {
            assigned: true,
            message: targetType === "vendor"
                ? "Vendor assigned successfully."
                : "Service Agent assigned successfully.",
        },
        complaint: updated
            ? {
                complaintId: updated.complaint_id,
                status: updated.status,
                assignedDateTime: updated.assigned_date_time,
                assignedAgentId: updated.assigned_agent,
                assignedVendorId: updated.non_society_user,
                assignedBy: updated.assigned_by,
            }
            : null,
    });
}

// ============================================
// HANDLER — STAFF_LIST
// ============================================

async function handleStaffList(
    req: Request,
    ctx: CallerCtx,
    body: CrudComplaintAdminRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }

    const { data: complaintRow, error: compErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .select(`
            complaint_id, complaint_type,
            society_user_data:SSP_Society_User!society_user ( society )
        `)
        .eq("complaint_id", complaintId)
        .is("deleted_at", null)
        .maybeSingle();

    if (compErr) return buildError(req, "SERVER_ERROR", compErr.message, 500);
    if (!complaintRow) {
        return buildError(req, "NOT_FOUND", "Complaint not found.", 404);
    }

    const socRel = Array.isArray(complaintRow.society_user_data)
        ? complaintRow.society_user_data[0]
        : complaintRow.society_user_data;

    if (!socRel || socRel.society !== ctx.callerSocietyId) {
        return buildError(
            req,
            "FORBIDDEN",
            "Complaint does not belong to your society.",
            403,
        );
    }

    const complaintType = String(complaintRow.complaint_type ?? "general")
        .trim();
    const normalized = complaintType.toLowerCase();
    const isOther = normalized === "other" || normalized === "others";

    const availableStaff: AvailableStaff[] = [];

    // Service agents
    const { data: agents } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
            user_id, role, service_agent_services,
            agent_availability_status, service_agent_rating,
            contact:SSP_Contact!contact ( name, phone )
        `)
        .eq("society", ctx.callerSocietyId);

    for (
        const a of (agents ?? []) as Array<{
            user_id: string;
            role: string[] | null;
            service_agent_services: string | null;
            agent_availability_status: string | null;
            service_agent_rating: number | null;
            contact: unknown;
        }>
    ) {
        const roles = Array.isArray(a.role) ? a.role : [];
        if (!roles.includes("service_agent")) continue;

        const services = parseServiceTypes(a.service_agent_services);
        if (services.length === 0) continue;
        if (!matchesComplaintType(services, normalized, isOther)) continue;

        const c = Array.isArray(a.contact) ? a.contact[0] : a.contact;
        const rating = a.service_agent_rating !== null &&
                a.service_agent_rating !== undefined
            ? Number(a.service_agent_rating).toFixed(2)
            : null;

        availableStaff.push({
            id: a.user_id,
            name: (c as { name?: string } | null)?.name ?? "Unknown Agent",
            phone: (c as { phone?: string } | null)?.phone ?? null,
            role: "service_agent",
            serviceType: a.service_agent_services,
            rating,
            availabilityStatus: a.agent_availability_status ?? null,
        });
    }

    // Vendors
    const { data: vendors } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(
            "non_society_user_id, name, role, service_type, phone_number, vendor_rating",
        )
        .eq("society", ctx.callerSocietyId)
        .eq("role", "vendor");

    for (
        const v of (vendors ?? []) as Array<{
            non_society_user_id: string;
            name: string | null;
            service_type: string | null;
            phone_number: string | null;
            vendor_rating: string | null;
        }>
    ) {
        const services = parseServiceTypes(v.service_type);
        if (services.length === 0) continue;
        if (!matchesComplaintType(services, normalized, isOther)) continue;

        availableStaff.push({
            id: v.non_society_user_id,
            name: v.name ?? "Unknown Vendor",
            phone: v.phone_number,
            role: "vendor",
            serviceType: v.service_type,
            rating: v.vendor_rating,
            availabilityStatus: null,
        });
    }

    // Dedupe + sort (agents first, then by rating desc)
    const uniqueStaff = Array.from(
        new Map(availableStaff.map((s) => [s.id, s])).values(),
    );
    const sorted = sortStaff(uniqueStaff);

    // ─── Auto-assign when exactly one match ───
    if (sorted.length === 1) {
        const target = sorted[0];
        const result = await autoAssignStaff(
            complaintId,
            target,
            ctx.callerUserId,
        );

        if (result.success) {
            return buildSuccess(req, {
                complaintId,
                complaintType,
                autoAssigned: true,
                assignedStaff: target,
                availableStaff: sorted,
                total: 1,
                message: `Auto-assigned to ${target.name} (${target.role}).`,
            });
        }

        // Fallback: return list so admin can retry with explicit ASSIGN
        return buildSuccess(req, {
            complaintId,
            complaintType,
            autoAssigned: false,
            autoAssignFailed: true,
            autoAssignError: result.message ?? "Auto-assign failed.",
            assignedStaff: null,
            availableStaff: sorted,
            total: 1,
        });
    }

    // 0 or 2+ matches
    return buildSuccess(req, {
        complaintId,
        complaintType,
        autoAssigned: false,
        assignedStaff: null,
        availableStaff: sorted,
        total: sorted.length,
    });
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
            const body = await req.json().catch(() => null) as
                | CrudComplaintAdminRequest
                | null;
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

            const ctxResult = await getContext(authCtx.user.id);
            if (!ctxResult.ok) {
                return buildError(
                    req,
                    ctxResult.code,
                    ctxResult.message,
                    ctxResult.status,
                );
            }

            if (!isAdminRole(ctxResult.ctx.callerRoles)) {
                return buildError(
                    req,
                    "FORBIDDEN",
                    "Only Admin or SuperAdmin can access this API.",
                    403,
                );
            }

            const tAction = Date.now();
            let response: Response;

            switch (action) {
                case "VIEW":
                    response = await handleView(req, ctxResult.ctx, body);
                    break;
                case "ASSIGN":
                    response = await handleAssign(req, ctxResult.ctx, body);
                    break;
                case "STAFF_LIST":
                    response = await handleStaffList(req, ctxResult.ctx, body);
                    break;
            }

            logger.info({
                level: "info",
                action: `crud-complaint-admin.${action}`,
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
                action: `crud-complaint-admin.${action}`,
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