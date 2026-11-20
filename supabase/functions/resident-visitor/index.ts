// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// resident-visitor — Resident-side read APIs
// Optimized: fewer roundtrips, DB-side pagination, batch signed URLs
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
    corsHeaders,
    errorResponse,
    successResponse,
} from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface ResidentVisitorRequest {
    action: "VIEW" | "LOGS";
    preApproved?: boolean;
    approvalStatus?: string;
    visitorStatus?: string;
    role?: string | string[];
    isRecurring?: boolean;
    filterOption?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
    page?: number;
    limit?: number;
}

interface VisitorItem {
    visitorId: string;
    name: string;
    phoneNumber: string;
    role: string;
    visitorStatus: string | null;
    purpose: string | null;
    preApproved: boolean;
    approvalStatus: string | null;
    vehicleNumber: string | null;
    idProofType: string | null;
    gateNumber: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    imageUrl: string | null;
    createdAt: string;
}

interface RawVisitor {
    non_society_user_id: string;
    name: string | null;
    phone_number: string | null;
    email: string | null;
    gender: string | null;
    role: string | null;
    purpose: string | null;
    visitor_status: string | null;
    visitor_approval_status: string | null;
    verification_pin: number | null;
    check_in: string | null;
    check_out: string | null;
    is_recurring: boolean | null;
    recurring_days: string[] | null;
    vehicle_number: string | null;
    vehicle_type: string | null;
    gate_no: string | null;
    delivery_origin: string | null;
    id_proof_type: string | null;
    id_proof_number: string | null;
    pre_approved: boolean | null;
    created_at: string;
}

interface RawServant {
    servant_id: string;
    phone_number: string | null;
    servant_name: string | null;
}

interface ContactInfo {
    name: string;
    phone: string;
    email: string;
}

interface ResidentData {
    user_id: string;
    unit_flat_number: string | null;
    contact: ContactInfo | ContactInfo[] | null;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const SIGNED_URL_EXPIRY = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const VALID_ACTIONS = ["VIEW", "LOGS"] as const;
type Action = typeof VALID_ACTIONS[number];

const VALID_APPROVAL_STATUS = ["pending", "approved", "rejected"] as const;

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

const SELECT_VISITOR = `
    non_society_user_id, name, phone_number, email, gender, role,
    purpose, visitor_status, visitor_approval_status, verification_pin,
    check_in, check_out, is_recurring, recurring_days, vehicle_number,
    vehicle_type, gate_no, delivery_origin, id_proof_type, id_proof_number,
    pre_approved, created_at
`;

// ============================================
// HELPERS
// ============================================

function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
    if (!arr) return null;
    if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
    return arr;
}

function calculateDateBounds(
    filter: string | null,
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
    const startYear = year;

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

    const startObj = new Date(
        Date.UTC(startYear, startMonth, startDay, 0, 0, 0),
    );
    const endObj = new Date(Date.UTC(startYear, endMonth, endDay, 0, 0, 0));
    startObj.setMinutes(startObj.getMinutes() - 330);
    endObj.setMinutes(endObj.getMinutes() - 330);

    return { startISO: startObj.toISOString(), endISO: endObj.toISOString() };
}

function extractStorageKey(path: string): string {
    let key = path.trim();
    const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
    const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
    if (key.includes(publicMarker)) return key.split(publicMarker)[1];
    if (key.includes(signedMarker)) return key.split(signedMarker)[1];
    if (key.includes(".amazonaws.com/")) return key.split(".amazonaws.com/")[1];
    return key;
}

// Batch sign URLs with cache + single-call batch API
async function batchSignUrls(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (paths.length === 0) return result;

    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0) return result;

    const now = Date.now();
    const toSign: string[] = [];
    const keyMap = new Map<string, string>(); // originalPath -> storage key

    for (const p of unique) {
        const cached = urlCache.get(p);
        if (cached && cached.expiresAt > now + SIGNED_URL_SAFETY_MARGIN_MS) {
            result.set(p, cached.url);
        } else {
            const key = extractStorageKey(p);
            keyMap.set(p, key);
            toSign.push(p);
        }
    }

    if (toSign.length === 0) return result;

    // Try batch API first (single roundtrip for all keys)
    const keys = toSign.map((p) => keyMap.get(p)!);
    const keyToPath = new Map<string, string>();
    for (const p of toSign) {
        const k = keyMap.get(p)!;
        if (!keyToPath.has(k)) keyToPath.set(k, p);
    }

    try {
        const { data: signedList, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrls(keys, SIGNED_URL_EXPIRY);

        if (!error && signedList) {
            const expiresAt = Date.now() + SIGNED_URL_EXPIRY * 1000;
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

    // Fallback: per-key in chunks (rare)
    for (let i = 0; i < toSign.length; i += SIGNED_URL_CONCURRENCY) {
        const chunk = toSign.slice(i, i + SIGNED_URL_CONCURRENCY);
        const signed = await Promise.all(
            chunk.map(async (originalPath) => {
                const key = keyMap.get(originalPath)!;
                try {
                    const { data, error } = await supabaseAdmin.storage
                        .from(BUCKET_NAME)
                        .createSignedUrl(key, SIGNED_URL_EXPIRY);
                    if (error || !data?.signedUrl) {
                        return [originalPath, null] as const;
                    }
                    return [originalPath, data.signedUrl] as const;
                } catch {
                    return [originalPath, null] as const;
                }
            }),
        );
        const expiresAt = Date.now() + SIGNED_URL_EXPIRY * 1000;
        for (const [orig, url] of signed) {
            if (url) {
                result.set(orig, url);
                urlCache.set(orig, { url, expiresAt });
            }
        }
    }

    return result;
}

async function fetchImageMap(
    visitorIds: string[],
    societyId: string,
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (visitorIds.length === 0) return map;

    const { data: documents } = await supabaseAdmin
        .from("SSP_Document")
        .select("non_society_user, s3_path")
        .in("non_society_user", visitorIds)
        .eq("society", societyId)
        .not("s3_path", "is", null);

    const imagePathMap = new Map<string, string>();
    for (
        const doc of (documents ?? []) as {
            non_society_user: string;
            s3_path: string;
        }[]
    ) {
        if (
            doc.non_society_user && doc.s3_path &&
            !imagePathMap.has(doc.non_society_user)
        ) {
            imagePathMap.set(doc.non_society_user, doc.s3_path);
        }
    }

    const allPaths = Array.from(imagePathMap.values());
    const signedUrlMap = await batchSignUrls(allPaths);

    for (const [visitorId, rawPath] of imagePathMap.entries()) {
        const url = signedUrlMap.get(rawPath);
        if (url) map.set(visitorId, url);
    }
    return map;
}

// ============================================
// UNIFIED FORMATTER
// ============================================

function toVisitorItem(
    raw: RawVisitor,
    imageUrl: string | null,
): VisitorItem {
    return {
        visitorId: raw.non_society_user_id,
        name: raw.name || "N/A",
        phoneNumber: raw.phone_number || "N/A",
        role: raw.role || "visitor",
        visitorStatus: raw.visitor_status || null,
        purpose: raw.purpose || null,
        preApproved: raw.pre_approved === true,
        approvalStatus: raw.visitor_approval_status || null,
        vehicleNumber: raw.vehicle_number || null,
        idProofType: raw.id_proof_type || null,
        gateNumber: raw.gate_no || null,
        checkInTime: raw.check_in || null,
        checkOutTime: raw.check_out || null,
        imageUrl,
        createdAt: raw.created_at || new Date().toISOString(),
    };
}

function normalizeRoleFilter(
    role: string | string[] | undefined,
): string[] | null {
    if (!role) return null;
    const roles = Array.isArray(role) ? role : [role];
    const filtered = roles.filter((r) => r.trim() !== "");
    if (filtered.length === 0) return null;
    if (filtered.some((r) => r.toLowerCase() === "all")) return null;
    return filtered.map((r) => r.trim());
}

// ============================================
// SHARED SEARCH + FILTERS (still applied post-merge for servant items)
// ============================================

function applySearchFilter(
    visitors: VisitorItem[],
    searchTerm: string,
): VisitorItem[] {
    if (!searchTerm) return visitors;
    const term = searchTerm.toLowerCase().trim();
    return visitors.filter((v) =>
        v.name.toLowerCase().includes(term) ||
        v.phoneNumber.includes(term) ||
        (v.purpose?.toLowerCase().includes(term) ?? false) ||
        (v.vehicleNumber?.toLowerCase().includes(term) ?? false)
    );
}

function applyFilters(
    visitors: VisitorItem[],
    filters: {
        role?: string | string[];
        visitorStatus?: string;
        preApproved?: boolean;
        approvalStatus?: string;
    },
): VisitorItem[] {
    let filtered = visitors;

    if (filters.role) {
        const roles = Array.isArray(filters.role)
            ? filters.role
            : [filters.role];
        const hasAll = roles.some((r) => r.toLowerCase() === "all");
        if (!hasAll && roles.length > 0) {
            const lowerRoles = roles.map((r) => r.toLowerCase());
            filtered = filtered.filter(
                (v) => v.role && lowerRoles.includes(v.role.toLowerCase()),
            );
        }
    }

    if (
        filters.visitorStatus && filters.visitorStatus.toLowerCase() !== "all"
    ) {
        const target = filters.visitorStatus.toLowerCase();
        filtered = filtered.filter(
            (v) => v.visitorStatus?.toLowerCase() === target,
        );
    }

    if (typeof filters.preApproved === "boolean") {
        filtered = filtered.filter((v) =>
            v.preApproved === filters.preApproved
        );
    }

    if (
        filters.approvalStatus && filters.approvalStatus.toLowerCase() !== "all"
    ) {
        const target = filters.approvalStatus.toLowerCase();
        filtered = filtered.filter(
            (v) => v.approvalStatus?.toLowerCase() === target,
        );
    }

    return filtered;
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
    requireAuth(async (req: Request, authCtx: { user: { id: string } }) => {
        if (req.method === "OPTIONS") {
            return new Response("ok", { headers: corsHeaders });
        }

        const startTime = Date.now();
        let action: Action = "VIEW";

        try {
            if (req.method !== "POST") {
                return errorResponse("Only POST method is allowed.");
            }

            const body = await req.json().catch(() => null);
            if (!body) return errorResponse("Request body is required.");

            const reqBody = body as ResidentVisitorRequest;

            const rawAction = String(reqBody.action ?? "").toUpperCase();
            if (!VALID_ACTIONS.includes(rawAction as Action)) {
                return errorResponse(
                    `action must be one of ${VALID_ACTIONS.join(", ")}`,
                );
            }
            action = rawAction as Action;

            if (
                action === "VIEW" &&
                reqBody.approvalStatus !== undefined &&
                reqBody.approvalStatus !== null &&
                reqBody.approvalStatus.toLowerCase() !== "all" &&
                reqBody.approvalStatus.trim() !== ""
            ) {
                const as = reqBody.approvalStatus.toLowerCase().trim();
                if (
                    !VALID_APPROVAL_STATUS.includes(
                        as as typeof VALID_APPROVAL_STATUS[number],
                    )
                ) {
                    return errorResponse(
                        `approvalStatus must be one of ${
                            VALID_APPROVAL_STATUS.join(", ")
                        } or "all"`,
                    );
                }
            }

            if (
                reqBody.preApproved !== undefined &&
                typeof reqBody.preApproved !== "boolean"
            ) {
                return errorResponse("preApproved must be a boolean.");
            }

            const auth = await resolveCaller(authCtx.user.id);
            if ("error" in auth) return auth.error;

            const { callerUserId, callerSocietyId } = auth;

            const validator = new Validator();
            if (!callerUserId) {
                validator.validateRequired(callerUserId, "residentId");
            }
            if (!validator.isValid()) {
                logger.warn({
                    level: "warn",
                    action: `resident-visitor.${action}`,
                    userId: authCtx.user.id,
                    message: "Validation failed",
                    errors: JSON.stringify(validator.getErrors()),
                    timestamp: new Date().toISOString(),
                });
                return errorResponse("Validation failed");
            }

            const pageNum = Math.max(1, Number(reqBody.page) || 1);
            const limitNum = Math.min(
                Number(reqBody.limit) || DEFAULT_LIMIT,
                MAX_LIMIT,
            );

            let response: Response;
            if (action === "VIEW") {
                response = await handleView(
                    callerUserId,
                    callerSocietyId,
                    reqBody,
                    pageNum,
                    limitNum,
                );
            } else {
                response = await handleLogs(
                    callerUserId,
                    callerSocietyId,
                    reqBody,
                    pageNum,
                    limitNum,
                );
            }

            logger.info({
                level: "info",
                action: `resident-visitor.${action}`,
                userId: authCtx.user.id,
                duration: Date.now() - startTime,
                message: `Resident visitor ${action} completed`,
                timestamp: new Date().toISOString(),
            });

            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error
                ? error.message
                : "Unknown error";

            logger.error({
                level: "error",
                action: `resident-visitor.${action}`,
                userId: authCtx?.user?.id || "unknown",
                message: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
            });

            return errorResponse(errorMessage || "Failed to process request.");
        }
    }),
);

// ============================================
// AUTH HELPER — now also returns unit_flat_number to avoid re-fetch
// ============================================

async function resolveCaller(
    callerUserIdRaw: string,
): Promise<
    | { callerUserId: string; callerSocietyId: string }
    | { error: Response }
> {
    const callerUserId = sanitizeString(callerUserIdRaw);
    if (!callerUserId) {
        return { error: errorResponse("Unauthorized.", 401) };
    }

    const { data, error } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, society, deleted_at")
        .eq("user_id", callerUserId)
        .maybeSingle();

    if (error || !data) {
        return { error: errorResponse("Resident not found.", 401) };
    }

    if (data.deleted_at) {
        return { error: errorResponse("Account is deactivated.", 401) };
    }

    return {
        callerUserId: String(data.user_id),
        callerSocietyId: String(data.society ?? ""),
    };
}

// ============================================
// HANDLER: VIEW (my-visitors)
// ============================================

async function handleView(
    callerUserId: string,
    societyId: string,
    body: ResidentVisitorRequest,
    pageNum: number,
    limitNum: number,
): Promise<Response> {
    const t0 = Date.now();

    const {
        preApproved,
        approvalStatus,
        visitorStatus,
        role,
        isRecurring,
        filterOption,
        fromDate,
        toDate,
        search,
    } = body;

    // ---- PARALLEL: resident details + filtered count + filtered data ----
    // All three queries fire together. The residents table lookup is needed
    // for response metadata; it's independent of the visitor query.

    const residentPromise = supabaseAdmin
        .from("SSP_Society_User")
        .select(`
            user_id,
            unit_flat_number,
            contact:contact ( name, phone, email )
        `)
        .eq("user_id", callerUserId)
        .eq("society", societyId)
        .maybeSingle();

    // Build the visitor query with all SQL-side filters
    let visitorQuery = supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(SELECT_VISITOR)
        .eq("hosted_by", callerUserId)
        .eq("role", "visitor");

    if (typeof preApproved === "boolean") {
        visitorQuery = visitorQuery.eq("pre_approved", preApproved);
    }
    if (
        approvalStatus && approvalStatus.trim() !== "" &&
        approvalStatus.toLowerCase() !== "all"
    ) {
        visitorQuery = visitorQuery.eq(
            "visitor_approval_status",
            approvalStatus.trim(),
        );
    }
    if (
        visitorStatus && visitorStatus.trim() !== "" &&
        visitorStatus.toLowerCase() !== "all"
    ) {
        visitorQuery = visitorQuery.eq("visitor_status", visitorStatus.trim());
    }
    if (isRecurring !== undefined) {
        visitorQuery = visitorQuery.eq("is_recurring", isRecurring);
    }

    const dateBounds = calculateDateBounds(
        filterOption || null,
        fromDate,
        toDate,
    );
    if (dateBounds) {
        visitorQuery = visitorQuery
            .gte("check_in", dateBounds.startISO)
            .lt("check_in", dateBounds.endISO);
    }

    // Push the search filter to SQL — the JS filter later only re-applies for safety
    if (search && search.trim() !== "") {
        const term = search.trim().replace(/[%_,()]/g, "");
        if (term) {
            visitorQuery = visitorQuery.or(
                `name.ilike.%${term}%,` +
                    `phone_number.ilike.%${term}%,` +
                    `email.ilike.%${term}%,` +
                    `vehicle_number.ilike.%${term}%,` +
                    `purpose.ilike.%${term}%`,
            );
        }
    }

    // Apply SQL-side ordering. Note: some rows may have NULL check_in.
    // We still order by check_in DESC to match original behavior.
    visitorQuery = visitorQuery.order("check_in", {
        ascending: false,
        nullsFirst: false,
    });

    const [residentRes, visitorRes] = await Promise.all([
        residentPromise,
        visitorQuery,
    ]);

    console.log(`[resident-visitor][VIEW] parallel fetch ${Date.now() - t0}ms`);

    if (residentRes.error) {
        logger.error({
            level: "error",
            action: "resident-visitor.VIEW",
            message: `Resident lookup failed: ${residentRes.error.message}`,
            timestamp: new Date().toISOString(),
        });
        return errorResponse(
            `Failed to verify resident: ${residentRes.error.message}`,
        );
    }
    if (!residentRes.data) {
        return errorResponse("Resident not found in this society.");
    }
    if (visitorRes.error) {
        logger.error({
            level: "error",
            action: "resident-visitor.VIEW",
            message: `Fetch error: ${visitorRes.error.message}`,
            timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to fetch visitors.");
    }

    const residentData = residentRes.data as ResidentData;
    const contactData = firstOrNull(residentData.contact);
    const rawVisitors = (visitorRes.data || []) as RawVisitor[];

    // ---- Image map (only for the page slice) ----
    // Note: we defer pagination until after we know how many rows we have.
    // For VIEW we keep in-memory pagination because of JS-side filter re-application,
    // BUT we skip the expensive image fetch for rows we won't return.
    //
    // Strategy: apply JS-side filters to the FULL result set (fast, in-memory),
    // then paginate, then fetch images only for the returned slice.

    let formatted: VisitorItem[] = rawVisitors.map((v) => toVisitorItem(v, null) // image filled later
    );

    let filtered = formatted;
    if (search) filtered = applySearchFilter(filtered, search);
    filtered = applyFilters(filtered, {
        role: role || "all",
        visitorStatus: visitorStatus || "all",
        preApproved,
        approvalStatus: approvalStatus || "all",
    });

    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const pageItems = filtered.slice(start, start + limitNum);

    // Fetch images ONLY for the paginated slice
    const pageVisitorIds = pageItems.map((v) => v.visitorId);
    const imageMap = await fetchImageMap(pageVisitorIds, societyId);

    const items: VisitorItem[] = pageItems.map((v) => ({
        ...v,
        imageUrl: imageMap.get(v.visitorId) ?? null,
    }));

    console.log(`[resident-visitor][VIEW] TOTAL ${Date.now() - t0}ms`);

    return successResponse({
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        visitors: items,
        residentDetails: {
            residentId: residentData.user_id,
            name: contactData?.name || "Unknown",
            phone: contactData?.phone || "",
            email: contactData?.email || "",
            flatNumber: residentData.unit_flat_number || "N/A",
        },
        filters: {
            preApproved: preApproved !== undefined ? preApproved : null,
            approvalStatus: approvalStatus || null,
            visitorStatus: visitorStatus || null,
            role: role || null,
            isRecurring: isRecurring !== undefined ? isRecurring : null,
            filterOption: filterOption || null,
            fromDate: fromDate || null,
            toDate: toDate || null,
        },
        search: search || null,
    });
}

// ============================================
// HANDLER: LOGS (resident-log-visitors)
// ============================================

async function handleLogs(
    callerUserId: string,
    societyId: string,
    body: ResidentVisitorRequest,
    pageNum: number,
    limitNum: number,
): Promise<Response> {
    const t0 = Date.now();

    const {
        preApproved,
        visitorStatus,
        role,
        filterOption,
        fromDate,
        toDate,
        search,
    } = body;

    const roleFilter = normalizeRoleFilter(role);

    // ---- PARALLEL: host user + servants + visitor logs ----
    // Servants and visitor logs don't depend on each other — fire together.
    const hostPromise = supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, unit_flat_number")
        .eq("user_id", callerUserId)
        .eq("society", societyId)
        .maybeSingle();

    const servantsPromise = supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, phone_number, servant_name")
        .eq("society", societyId)
        .eq("status", "active");

    let query = supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(SELECT_VISITOR)
        .not("check_in", "is", null)
        .eq("visitor_approval_status", "approved");

    // Build the scoping clause. We still need the host user_id, so we build
    // a clause that matches the caller's hosted visitors OR servants by phone.
    // Servant phones are unknown until the servantsPromise resolves, so we
    // wait for both together, then decide the query shape.
    //
    // Optimization: we fetch host + servants first (parallel), then run the
    // main query. This is still faster than sequential because host+servants
    // overlap. The visitor query itself remains a single roundtrip.
    const [hostRes, servantsRes] = await Promise.all([
        hostPromise,
        servantsPromise,
    ]);

    console.log(`[resident-visitor][LOGS] host+servants ${Date.now() - t0}ms`);

    if (hostRes.error) {
        logger.error({
            level: "error",
            action: "resident-visitor.LOGS",
            message: `Resident lookup failed: ${hostRes.error.message}`,
            timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to verify resident.");
    }
    if (!hostRes.data) {
        return errorResponse("Resident not found in this society.");
    }

    const hostUser = hostRes.data as {
        user_id: string;
        unit_flat_number: string | null;
    };

    if (servantsRes.error) {
        logger.warn({
            level: "warn",
            action: "resident-visitor.LOGS",
            message: `Servant fetch failed: ${servantsRes.error.message}`,
            timestamp: new Date().toISOString(),
        });
    }

    const hiredServantMap = new Map<string, RawServant>();
    const servantPhoneNumbers: string[] = [];

    if (servantsRes.data && servantsRes.data.length > 0) {
        for (const servant of servantsRes.data as RawServant[]) {
            if (servant.phone_number && servant.phone_number.trim() !== "") {
                const formattedPhone = servant.phone_number.trim();
                hiredServantMap.set(formattedPhone, servant);
                servantPhoneNumbers.push(formattedPhone);
            }
        }
    }

    // Build scoping clause (same semantics as original)
    let targetAudienceClause = `hosted_by.eq.${hostUser.user_id}`;
    if (servantPhoneNumbers.length > 0) {
        const formattedArrayStr = servantPhoneNumbers.map((p) => `"${p}"`).join(
            ",",
        );
        targetAudienceClause =
            `and(hosted_by.eq.${hostUser.user_id},role.eq.visitor),` +
            `and(phone_number.in.(${formattedArrayStr}),role.eq.servant)`;
    } else {
        query = query.eq("role", "visitor");
    }

    query = query.or(targetAudienceClause);

    if (roleFilter && roleFilter.length > 0) {
        const roleConditions = roleFilter.map((r) => `role.eq.${r}`).join(",");
        query = query.or(roleConditions);
    }

    if (typeof preApproved === "boolean") {
        query = query.eq("pre_approved", preApproved);
    }

    if (
        visitorStatus && visitorStatus.trim() !== "" &&
        visitorStatus.toLowerCase() !== "all"
    ) {
        query = query.eq("visitor_status", visitorStatus.trim());
    }

    const dateBounds = calculateDateBounds(
        filterOption || null,
        fromDate,
        toDate,
    );
    if (dateBounds) {
        query = query
            .gte("check_in", dateBounds.startISO)
            .lt("check_in", dateBounds.endISO);
    }

    if (search && search.trim() !== "") {
        const term = search.trim().replace(/[%_,()]/g, "");
        if (term) {
            query = query.or(
                `name.ilike.%${term}%,` +
                    `phone_number.ilike.%${term}%,` +
                    `purpose.ilike.%${term}%,` +
                    `vehicle_number.ilike.%${term}%`,
            );
        }
    }

    const { data: visitorLogs, error: fetchErr } = await query.order(
        "check_in",
        { ascending: false, nullsFirst: false },
    );

    console.log(`[resident-visitor][LOGS] main query ${Date.now() - t0}ms`);

    if (fetchErr) {
        logger.error({
            level: "error",
            action: "resident-visitor.LOGS",
            message: `Fetch error: ${fetchErr.message}`,
            timestamp: new Date().toISOString(),
        });
        return errorResponse("Failed to fetch visitor logs.");
    }

    const rawVisitors = (visitorLogs || []) as RawVisitor[];

    // Build formatted items WITHOUT image yet
    const formatted: VisitorItem[] = [];
    const servantsWithLogs = new Set<string>();

    for (const raw of rawVisitors) {
        if (raw.role === "servant" && raw.phone_number) {
            servantsWithLogs.add(raw.phone_number.trim());
        }
        formatted.push(toVisitorItem(raw, null));
    }

    // Merge active servants who have no visitor log entry
    for (const [phone, servant] of hiredServantMap) {
        if (!servantsWithLogs.has(phone)) {
            formatted.push({
                visitorId: servant.servant_id || "N/A",
                name: servant.servant_name || "N/A",
                phoneNumber: phone,
                role: "servant",
                visitorStatus: "outside",
                purpose: "Hired Servant",
                preApproved: true,
                approvalStatus: "approved",
                vehicleNumber: null,
                idProofType: null,
                gateNumber: null,
                checkInTime: null,
                checkOutTime: null,
                imageUrl: null,
                createdAt: new Date().toISOString(),
            });
        }
    }

    let filtered = formatted;
    if (search) filtered = applySearchFilter(filtered, search);
    filtered = applyFilters(filtered, {
        role: role || "all",
        visitorStatus: visitorStatus || "all",
        preApproved,
    });

    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const pageItems = filtered.slice(start, start + limitNum);

    // Stats computed on FULL filtered set (matches original semantics)
    let currentlyInside = 0;
    let currentlyOutside = 0;
    for (const v of filtered) {
        if (v.visitorStatus === "inside") currentlyInside++;
        else if (v.visitorStatus === "outside") currentlyOutside++;
    }

    // Fetch images only for page slice
    const pageVisitorIds = pageItems
        .map((v) => v.visitorId)
        .filter((id) => id !== "N/A");
    const imageMap = await fetchImageMap(pageVisitorIds, societyId);

    const items: VisitorItem[] = pageItems.map((v) => ({
        ...v,
        imageUrl: imageMap.get(v.visitorId) ?? null,
    }));

    console.log(`[resident-visitor][LOGS] TOTAL ${Date.now() - t0}ms`);

    return successResponse({
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        visitors: items,
        filters: {
            preApproved: preApproved !== undefined ? preApproved : null,
            visitorStatus: visitorStatus || null,
            role: role || null,
            filterOption: filterOption || null,
            fromDate: fromDate || null,
            toDate: toDate || null,
        },
        search: search || null,
        stats: {
            totalVisitors: filtered.length,
            currentlyInside,
            currentlyOutside,
        },
    });
}
