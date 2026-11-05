// ============================================
// crud-notice — Merged CRUD for SSP_Alert
// Actions: CREATE | VIEW | UPDATE | DELETE
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

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const VALID_TYPES = [
    "general",
    "maintenance",
    "event",
    "emergency",
    "security",
    "financial",
] as const;

const ADMIN_ROLES = ["admin", "super_admin"] as const;

// ============================================
// TYPES
// ============================================
interface CrudNoticeRequest {
    action: Action;
    societyRegistrationNumber: string;
    requesterId?: string; // optional, JWT is source of truth
    // CREATE / UPDATE
    noticeData?: {
        noticeId?: string; // required for UPDATE
        title?: string;
        message?: string;
        type?: string;
        priority?: string;
        targetAudience?: string | string[];
        publishedDate?: string;
        expiryDate?: string;
    };
    // DELETE
    noticeId?: string;
    // VIEW
    filters?: {
        type?: string;
        priority?: string;
        search?: string;
    };
    sort?: { field?: string; order?: "asc" | "desc" };
    pagination?: { page?: number; pageSize?: number };
    // CREATE
    idempotencyKey?: string;
}

interface AuthContext {
    user: { id: string; email: string };
}

interface AlertRow {
    alert_id: string;
    title: string;
    message: string;
    priority: string;
    target_audience: string | string[] | null;
    type: string;
    expiry_date: string | null;
    published_date: string | null;
    created_at: string | null;
    name: string | null;
    society_user: string | null;
    deleted_at?: string | null;
}

interface ContextSuccess {
    ok: true;
    societyId: string;
    displayName: string;
    userEmail: string;
    roles: string[];
}

interface ContextFailure {
    ok: false;
    code: string;
    message: string;
    status: number;
}

// ============================================
// SUPABASE CLIENT (module scope — reused across invocations)
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
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

function getDateOnly(dateString: string | null | undefined): string {
    if (!dateString) return "";
    return dateString.split("T")[0];
}

function clampPageSize(n: number | undefined): number {
    if (!n || n < 1) return DEFAULT_PAGE_SIZE;
    return Math.min(n, MAX_PAGE_SIZE);
}

/**
 * Normalizes the DB `role` column (Postgres text[]) to a lowercase-safe set.
 * Your DB stores "Admin", "SuperAdmin", "Security", etc.
 */
function hasAdminRole(roles: string[]): boolean {
    if (!Array.isArray(roles)) return false;
    return roles.some((r) => {
        if (typeof r !== "string") return false;
        // Normalize: lowercase + strip separators so "super_admin" / "super-admin" both work
        const normalized = r.toLowerCase().replace(/[_\s-]/g, "");
        // "superadmin" matches both "superadmin" and "super_admin" after normalize
        return normalized === "admin" || normalized === "superadmin";
    });
}

/**
 * Fetches:
 *  - society_id from registration number
 *  - verifies user belongs to that society
 *  - returns user's display name + roles
 * All in 2 DB round-trips (no extra name lookup call).
 */
async function getContext(
    societyRegistrationNumber: string,
    userId: string,
): Promise<ContextSuccess | ContextFailure> {
    const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", societyRegistrationNumber)
        .maybeSingle();

    if (socErr) {
        return {
            ok: false,
            code: "SERVER_ERROR",
            message: socErr.message,
            status: 500,
        };
    }
    if (!society) {
        return {
            ok: false,
            code: "NOT_FOUND",
            message: "Society registration number not found.",
            status: 404,
        };
    }

    const { data: userRow, error: userErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
            user_id,
            role,
            SSP_Contact:SSP_Contact!contact ( name )
        `)
        .eq("user_id", userId)
        .eq("society", society.society_id)
        .maybeSingle();

    if (userErr) {
        return {
            ok: false,
            code: "SERVER_ERROR",
            message: userErr.message,
            status: 500,
        };
    }
    if (!userRow) {
        return {
            ok: false,
            code: "FORBIDDEN",
            message: "User does not belong to this society.",
            status: 403,
        };
    }

    const contact = Array.isArray(userRow.SSP_Contact)
        ? userRow.SSP_Contact[0]
        : userRow.SSP_Contact;
    const displayName = (contact?.name as string) || "";
    const roles = Array.isArray(userRow.role) ? (userRow.role as string[]) : [];

    return {
        ok: true,
        societyId: society.society_id,
        displayName,
        userEmail: "",
        roles,
    };
}

function extractCreatedBy(alert: AlertRow): string {
    return alert.name || "System";
}

function extractTargetAudience(alert: AlertRow): string {
    return ArrayHandler.join(alert.target_audience ?? [], ", ");
}

function validateDate(name: string, value: string | undefined): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new Error(`${name} is not a valid ISO date.`);
    return d.toISOString();
}

// ============================================
// ACTION HANDLERS
// ============================================

async function handleCreate(
    body: CrudNoticeRequest,
    authCtx: AuthContext,
    ctx: { societyId: string; displayName: string; userEmail: string },
): Promise<Response> {
    const nd = body.noticeData;
    if (!nd) return buildError("BAD_REQUEST", "noticeData is mandatory.", 400);
    if (!nd.title?.trim()) {
        return buildError("BAD_REQUEST", "Title is required.", 400);
    }
    if (!nd.message?.trim()) {
        return buildError("BAD_REQUEST", "Message is required.", 400);
    }
    if (nd.title.length > 200) {
        return buildError("BAD_REQUEST", "Title exceeds 200 chars.", 400);
    }
    if (nd.message.length > 5000) {
        return buildError("BAD_REQUEST", "Message exceeds 5000 chars.", 400);
    }

    const cleanTitle = sanitizeString(nd.title);
    const cleanMessage = sanitizeString(nd.message);

    const normalizedType = (nd.type ?? "general").toLowerCase().trim();
    const normalizedPriority = (nd.priority ?? "medium").toLowerCase().trim();

    if (
        !VALID_PRIORITIES.includes(
            normalizedPriority as typeof VALID_PRIORITIES[number],
        )
    ) {
        return buildError(
            "BAD_REQUEST",
            `priority must be one of ${VALID_PRIORITIES.join(", ")}`,
            400,
        );
    }
    if (!VALID_TYPES.includes(normalizedType as typeof VALID_TYPES[number])) {
        return buildError(
            "BAD_REQUEST",
            `type must be one of ${VALID_TYPES.join(", ")}`,
            400,
        );
    }

    const publishDate = validateDate("publishedDate", nd.publishedDate) ??
        new Date().toISOString();
    const expiryDate = validateDate("expiryDate", nd.expiryDate);

    // Idempotency short-circuit
    if (body.idempotencyKey) {
        const { data: existing } = await supabaseAdmin
            .from("SSP_Alert")
            .select("alert_id, created_at")
            .eq("idempotency_key", body.idempotencyKey)
            .maybeSingle();

        if (existing) {
            return successResponse({
                noticeCreated: true,
                idempotentReplay: true,
                noticeId: existing.alert_id,
                createdBy: ctx.displayName || authCtx.user.email,
                createdAt: existing.created_at,
            });
        }
    }

    // Duplicate check — single indexed query using date range
    const { data: dup } = await supabaseAdmin
        .from("SSP_Alert")
        .select("alert_id")
        .eq("society", ctx.societyId)
        .eq("title", cleanTitle)
        .eq("message", cleanMessage)
        .gte("published_date", `${getDateOnly(publishDate)}T00:00:00Z`)
        .lt("published_date", `${getDateOnly(publishDate)}T23:59:59Z`)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

    if (dup) {
        return successResponse({
            noticeCreated: false,
            message:
                "A duplicate notice with this title, message, and published date already exists.",
            noticeId: null,
            createdBy: ctx.displayName || authCtx.user.email,
            createdAt: null,
        });
    }

    // Default audience = everyone
    const targetAudience = ArrayHandler.toArray(
        nd.targetAudience || ["both"],
        {
            trim: true,
            removeEmpty: true,
            unique: true,
            lowercase: true,
        },
    );

    // Validate against picklist
    const VALID_AUDIENCES = ["owners", "tenants", "both"] as const;
    if (targetAudience.length === 0) {
        return buildError(
            "BAD_REQUEST",
            "targetAudience must include at least one of: owners, tenants, both",
            400,
        );
    }
    const invalidAudiences = targetAudience.filter(
        (a) => !VALID_AUDIENCES.includes(a as typeof VALID_AUDIENCES[number]),
    );
    if (invalidAudiences.length > 0) {
        return buildError(
            "BAD_REQUEST",
            `targetAudience must be one of: owners, tenants, both. Got: ${
                invalidAudiences.join(", ")
            }`,
            400,
        );
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("SSP_Alert")
        .insert({
            society: ctx.societyId,
            society_user: null, // ⬅️ broadcast notice — no specific user
            title: cleanTitle,
            name: ctx.displayName || authCtx.user.email || "System",
            created_by: authCtx.user.email || "System",
            message: cleanMessage,
            priority: normalizedPriority,
            type: normalizedType,
            target_audience: targetAudience,
            published_date: publishDate,
            expiry_date: expiryDate,
            idempotency_key: body.idempotencyKey ?? null,
        })
        .select("alert_id, created_at")
        .single();

    if (insertErr) {
        return buildError(
            "SERVER_ERROR",
            `Failed to create notice: ${insertErr.message}`,
            500,
        );
    }

    return successResponse({
        noticeCreated: true,
        message: "Notice created successfully.",
        noticeId: inserted.alert_id,
        createdBy: ctx.displayName || authCtx.user.email,
        createdAt: inserted.created_at,
    });
}

async function handleView(
    body: CrudNoticeRequest,
    ctx: { societyId: string; roles: string[] },
): Promise<Response> {
    const filters = body.filters ?? {};
    const sortField = body.sort?.field === "created_at"
        ? "created_at"
        : "published_date";
    const sortAsc = body.sort?.order === "asc";
    const page = Math.max(1, body.pagination?.page ?? 1);
    const pageSize = clampPageSize(body.pagination?.pageSize);
    const offset = (page - 1) * pageSize;

    const cleanType = filters.type && filters.type.toLowerCase() !== "all"
        ? sanitizeString(filters.type).toLowerCase()
        : null;
    const cleanPriority =
        filters.priority && filters.priority.toLowerCase() !== "all"
            ? sanitizeString(filters.priority).toLowerCase()
            : null;
    const searchTerm = filters.search && filters.search.trim() !== ""
        ? sanitizeString(filters.search).replace(/[%_]/g, "") // prevent wildcard injection
        : null;

    const SELECT = `
        alert_id, title, message, expiry_date, priority,
        published_date, target_audience, type, society_user, name, created_at
    `;

    let dataQuery = supabaseAdmin
        .from("SSP_Alert")
        .select(SELECT)
        .eq("society", ctx.societyId)
        .is("deleted_at", null);

    let countQuery = supabaseAdmin
        .from("SSP_Alert")
        .select("*", { count: "exact", head: true })
        .eq("society", ctx.societyId)
        .is("deleted_at", null);

    if (cleanType) {
        dataQuery = dataQuery.eq("type", cleanType);
        countQuery = countQuery.eq("type", cleanType);
    }
    if (cleanPriority) {
        dataQuery = dataQuery.eq("priority", cleanPriority);
        countQuery = countQuery.eq("priority", cleanPriority);
    }
    if (searchTerm) {
        const orClause =
            `title.ilike.%${searchTerm}%,message.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`;
        dataQuery = dataQuery.or(orClause);
        countQuery = countQuery.or(orClause);
    }

    dataQuery = dataQuery
        .order(sortField, { ascending: sortAsc, nullsFirst: false })
        .range(offset, offset + pageSize - 1);

    const [dataRes, countRes] = await Promise.all([dataQuery, countQuery]);

    if (dataRes.error) {
        return buildError(
            "SERVER_ERROR",
            `Database error: ${dataRes.error.message}`,
            500,
        );
    }

    const total = countRes.error ? 0 : countRes.count ?? 0;

    const notices = ((dataRes.data ?? []) as unknown as AlertRow[]).map((
        a,
    ) => ({
        noticeId: a.alert_id,
        title: a.title,
        message: a.message,
        priority: a.priority,
        targetAudience: extractTargetAudience(a),
        type: a.type,
        expiryDate: a.expiry_date,
        publishedDate: a.published_date,
        createdBy: extractCreatedBy(a),
        createdAt: a.created_at,
    }));

    const isAdmin = hasAdminRole(ctx.roles);

    return successResponse({
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        notices,
        filters: {
            type: filters.type ?? "all",
            priority: filters.priority ?? "all",
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
    body: CrudNoticeRequest,
    authCtx: AuthContext,
    ctx: { societyId: string; displayName: string; roles: string[] },
): Promise<Response> {
    // Authorization: Admin only (mirrors RLS policy alert_admin_all)
    if (!hasAdminRole(ctx.roles)) {
        return buildError("FORBIDDEN", "Only Admin can update notices.", 403);
    }

    const nd = body.noticeData;
    const noticeId = nd?.noticeId ?? body.noticeId;
    if (!noticeId?.trim()) {
        return buildError(
            "BAD_REQUEST",
            "noticeId is mandatory for UPDATE.",
            400,
        );
    }
    if (!nd || Object.keys(nd).length <= 1) {
        return buildError(
            "BAD_REQUEST",
            "noticeData with at least one field is required.",
            400,
        );
    }

    const cleanNoticeId = sanitizeString(noticeId);

    // Verify ownership in the same round-trip as existence
    const { data: existing, error: findErr } = await supabaseAdmin
        .from("SSP_Alert")
        .select("alert_id, society")
        .eq("alert_id", cleanNoticeId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) return buildError("SERVER_ERROR", findErr.message, 500);
    if (!existing) return buildError("NOT_FOUND", "Notice not found.", 404);
    if (existing.society !== ctx.societyId) {
        return buildError(
            "FORBIDDEN",
            "Notice does not belong to this society.",
            403,
        );
    }

    // Don't overwrite the original creator on update.
    // If you want to track editor separately, add `updated_by` + `updated_at` columns.
    const payload: Record<string, unknown> = {};

    if (nd.title?.trim()) payload.title = sanitizeString(nd.title);
    if (nd.message?.trim()) payload.message = sanitizeString(nd.message);

    if (nd.type) {
        const normalizedType = nd.type.toLowerCase().trim();
        if (
            !VALID_TYPES.includes(normalizedType as typeof VALID_TYPES[number])
        ) {
            return buildError("BAD_REQUEST", "Invalid type.", 400);
        }
        payload.type = normalizedType;
    }
    if (nd.priority) {
        const normalizedPriority = nd.priority.toLowerCase().trim();
        if (
            !VALID_PRIORITIES.includes(
                normalizedPriority as typeof VALID_PRIORITIES[number],
            )
        ) {
            return buildError("BAD_REQUEST", "Invalid priority.", 400);
        }
        payload.priority = normalizedPriority;
    }
    if (nd.targetAudience !== undefined) {
        const aud = ArrayHandler.toArray(nd.targetAudience, {
            trim: true,
            removeEmpty: true,
            unique: true,
            lowercase: true,
        });
        if (aud.length === 0) {
            return buildError(
                "BAD_REQUEST",
                "targetAudience cannot be empty.",
                400,
            );
        }
        const VALID_AUDIENCES = ["owners", "tenants", "both"] as const;
        const invalid = aud.filter(
            (a) =>
                !VALID_AUDIENCES.includes(a as typeof VALID_AUDIENCES[number]),
        );
        if (invalid.length > 0) {
            return buildError(
                "BAD_REQUEST",
                `targetAudience must be one of: owners, tenants, both. Got: ${
                    invalid.join(", ")
                }`,
                400,
            );
        }
        payload.target_audience = aud;
    }
    if (nd.publishedDate) {
        payload.published_date = validateDate(
            "publishedDate",
            nd.publishedDate,
        );
    }
    if (nd.expiryDate !== undefined) {
        payload.expiry_date = validateDate("expiryDate", nd.expiryDate);
    }

    const { error: updateErr } = await supabaseAdmin
        .from("SSP_Alert")
        .update(payload)
        .eq("alert_id", cleanNoticeId)
        .eq("society", ctx.societyId); // defence in depth

    if (updateErr) {
        return buildError(
            "SERVER_ERROR",
            `Failed to update: ${updateErr.message}`,
            500,
        );
    }

    return successResponse({
        updatedNotice: { updated: true, noticeId: cleanNoticeId },
        message: "Notice updated successfully.",
        updatedBy: ctx.displayName || authCtx.user.email,
    });
}

async function handleDelete(
    body: CrudNoticeRequest,
    ctx: { societyId: string; roles: string[] },
): Promise<Response> {
    // Authorization: Admin only (mirrors RLS policy alert_admin_all)
    if (!hasAdminRole(ctx.roles)) {
        return buildError("FORBIDDEN", "Only Admin can delete notices.", 403);
    }

    const noticeId = body.noticeId ?? body.noticeData?.noticeId;
    if (!noticeId?.trim()) {
        return buildError("BAD_REQUEST", "noticeId is mandatory.", 400);
    }

    const cleanNoticeId = sanitizeString(noticeId);

    // Verify existence + ownership before soft-delete
    const { data: existing, error: findErr } = await supabaseAdmin
        .from("SSP_Alert")
        .select("alert_id, society")
        .eq("alert_id", cleanNoticeId)
        .is("deleted_at", null)
        .maybeSingle();

    if (findErr) return buildError("SERVER_ERROR", findErr.message, 500);
    if (!existing) return buildError("NOT_FOUND", "Notice not found.", 404);
    if (existing.society !== ctx.societyId) {
        return buildError(
            "FORBIDDEN",
            "Notice does not belong to this society.",
            403,
        );
    }

    const { error: delErr } = await supabaseAdmin
        .from("SSP_Alert")
        .update({ deleted_at: new Date().toISOString() })
        .eq("alert_id", cleanNoticeId)
        .eq("society", ctx.societyId);

    if (delErr) {
        return buildError(
            "SERVER_ERROR",
            `Failed to delete: ${delErr.message}`,
            500,
        );
    }

    return successResponse({
        updatedNotice: { deleted: true, noticeId: cleanNoticeId },
        message: "Notice deleted successfully.",
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
        let action = "UNKNOWN";

        try {
            const body = await parseRequestBody<CrudNoticeRequest>(req);
            if (!body) {
                return buildError(
                    "BAD_REQUEST",
                    "Request body is required.",
                    400,
                );
            }

            action = (body.action ?? "").toString().toUpperCase() as Action;

            if (!VALID_ACTIONS.includes(action)) {
                return buildError(
                    "BAD_REQUEST",
                    `action must be one of ${VALID_ACTIONS.join(", ")}`,
                    400,
                );
            }
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

            // Role gate for all mutation actions (CREATE / UPDATE / DELETE)
            // VIEW is allowed for all society members.
            if (
                action !== "VIEW" && !hasAdminRole(ctxResult.roles)
            ) {
                return buildError(
                    "FORBIDDEN",
                    `Only Admin can perform ${action} on notices.`,
                    403,
                );
            }

            let response: Response;
            const tAction = Date.now();

            switch (action) {
                case "CREATE":
                    response = await handleCreate(body, authCtx, {
                        societyId: ctxResult.societyId,
                        displayName: ctxResult.displayName,
                        userEmail: authCtx.user.email,
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
                        displayName: ctxResult.displayName,
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
                `[crud-notice][${action}] ctx=${ctxLatency}ms action=${
                    Date.now() - tAction
                }ms total=${Date.now() - t0}ms`,
            );

            return response!;
        } catch (error) {
            const err = error as Error;
            console.error(`[crud-notice][${action}] ERROR:`, err.message);
            return buildError(
                "SERVER_ERROR",
                err.message || "Failed to process notice request",
                500,
            );
        }
    }),
);
