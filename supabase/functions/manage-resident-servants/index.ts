// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// resident-servants
// Actions: DETAIL | HIRE | LAYOFF | VIEW
// Resident-side servant management
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

type ActionType = "DETAIL" | "HIRE" | "LAYOFF" | "VIEW";

interface ResidentServantsRequest {
    action: ActionType;
    servantId?: string;
    // HIRE / LAYOFF
    roles?: string[];
    isRecurring?: boolean;
    recurringDays?: string[];
    // VIEW
    filters?: {
        search?: string;
        role?: string;
        shiftTiming?: string;
        recurringDays?: string[] | string;
        hiredStatus?: "all" | "hired" | "available";
        dateOption?: string;
        fromDate?: string;
        toDate?: string;
    };
    pagination?: { page?: number; pageSize?: number };
}

interface CallerCtx {
    authUserId: string;
    callerUserId: string;
    callerSocietyId: string;
    callerFlat: string;
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
    deleted_at: string | null;
}

interface HireJunctionRow {
    society_servant_id: string;
    society_user: string;
    servant_id: string;
    hired: boolean | null;
    is_recurring: boolean | null;
    recurring_days: string[] | null;
    hired_roles: string[] | null;
    created_at: string;
}

interface RoleStatus {
    role: string;
    isHired: boolean;
}

interface HireStatus {
    isHired: boolean;
    hiredRoles: string[];
    allRoles: string[];
    roleStatus: RoleStatus[];
    isRecurring: boolean | null;
    recurringDays: string[] | null;
    hiredAt: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const SIGNED_URL_TTL = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60_000;

const VALID_ACTIONS = ["DETAIL", "HIRE", "LAYOFF", "VIEW"] as const;

const VALID_SERVANT_ROLES = [
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

const VALID_RECURRING_DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
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
// HELPERS
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

function calculateWorkingHours(
    arrival: string | null,
    departure: string | null,
): string | null {
    if (!arrival || !departure) return null;

    const start = new Date(arrival.replace(" ", "T"));
    const end = new Date(departure.replace(" ", "T"));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

    let diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    if (hours === 0 && mins === 0) return "0 Mins";
    if (mins === 0) return `${hours} Hours`;
    if (hours === 0) return `${mins} Mins`;
    return `${hours} Hours ${mins} Mins`;
}

function parseTimeToMinutes(timeStr: string | null): number | null {
    if (!timeStr || typeof timeStr !== "string") return null;
    const cleanStr = timeStr.trim().toUpperCase();

    if (cleanStr.includes("-") || cleanStr.includes("T")) {
        const d = new Date(cleanStr.replace(" ", "T"));
        if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }

    const amPmMatch = cleanStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
    if (amPmMatch) {
        let hours = parseInt(amPmMatch[1], 10);
        const minutes = parseInt(amPmMatch[2], 10);
        const modifier = amPmMatch[3];
        if (modifier === "PM" && hours < 12) hours += 12;
        if (modifier === "AM" && hours === 12) hours = 0;
        return hours * 60 + minutes;
    }
    return null;
}

function determineCurrentStatus(
    _dbStatus: string | null,
    arrival: string | null,
    departure: string | null,
): "Inside" | "Outside" {
    const startMins = parseTimeToMinutes(arrival);
    const endMins = parseTimeToMinutes(departure);

    if (startMins === null || endMins === null) return "Outside";

    const now = new Date();
    const istFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
    });
    const parts = istFormatter.formatToParts(now);
    const pMap = new Map(parts.map((p) => [p.type, p.value]));
    const currentMins = parseInt(pMap.get("hour") || "0", 10) * 60 +
        parseInt(pMap.get("minute") || "0", 10);

    if (startMins <= endMins) {
        return currentMins >= startMins && currentMins <= endMins
            ? "Inside"
            : "Outside";
    }
    return currentMins >= startMins || currentMins <= endMins
        ? "Inside"
        : "Outside";
}

function normalizeRolesInput(input: unknown): string[] {
    if (!input) return [];
    let raw: string[] = [];
    if (Array.isArray(input)) {
        raw = input.filter((r): r is string => typeof r === "string");
    } else if (typeof input === "string") {
        raw = input.split(/[;,]/);
    }
    const normalized = raw
        .map((r) => r.trim().toLowerCase().replace(/[\s-]+/g, "_"))
        .filter(Boolean);
    return Array.from(new Set(normalized));
}

function normalizeRecurringDays(input: unknown): string[] {
    if (!input) return [];
    let raw: string[] = [];
    if (Array.isArray(input)) {
        raw = input.filter((d): d is string => typeof d === "string");
    } else if (typeof input === "string") {
        raw = input.split(/[;,]/);
    }
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
        .map((d) => dayMap[d.toLowerCase().slice(0, 3)] ?? d);
    return Array.from(new Set(out));
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

async function fetchServantImageMap(
    servantIds: string[],
    societyId: string,
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (servantIds.length === 0) return map;

    const { data: docs } = await supabaseAdmin
        .from("SSP_Document")
        .select("servant, s3_path")
        .in("servant", servantIds)
        .eq("society", societyId)
        .eq("document_type", "servant_image")
        .not("s3_path", "is", null);

    const servantToPath = new Map<string, string>();
    for (
        const d of (docs ?? []) as Array<{ servant: string; s3_path: string }>
    ) {
        if (d.servant && d.s3_path && !servantToPath.has(d.servant)) {
            servantToPath.set(d.servant, d.s3_path);
        }
    }

    const signed = await batchSignUrls(Array.from(servantToPath.values()));
    for (const [sid, path] of servantToPath.entries()) {
        const url = signed.get(path);
        if (url) map.set(sid, url);
    }
    return map;
}

// ============================================
// AUTH
// ============================================

async function getContext(
    userId: string,
): Promise<ContextSuccess | ContextFailure> {
    const { data, error } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, society, unit_flat_number, block, tower, deleted_at")
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

    return {
        ok: true,
        ctx: {
            authUserId: userId,
            callerUserId: String(data.user_id),
            callerSocietyId: String(data.society ?? ""),
            callerFlat: String(data.unit_flat_number ?? "").trim(),
            callerBlock: data.block ?? null,
            callerTower: data.tower ?? null,
        },
    };
}

// ============================================
// SHARED HELPERS
// ============================================

function buildRoleStatus(
    allRoles: string[],
    hiredRoles: string[],
): RoleStatus[] {
    return allRoles.map((role) => ({
        role,
        isHired: hiredRoles.includes(role),
    }));
}

function toServantResponse(
    servant: ServantRow,
    hireStatus: HireStatus,
    imageUrl: string | null,
) {
    return {
        servantId: servant.servant_id,
        name: servant.servant_name || "Unknown",
        phone: servant.phone_number,
        address: servant.address,
        roles: servant.role ?? [],
        shiftTimings: servant.shift_timing ?? [],
        gender: servant.gender,
        dob: servant.date_of_birth,
        idProofType: servant.id_proof_type,
        idProofNumber: servant.id_proof_number,
        status: servant.status,
        scheduledArrival: servant.scheduled_arrival,
        scheduledDeparture: servant.scheduled_departure,
        isRecurring: servant.is_recurring ?? false,
        workingHours: calculateWorkingHours(
            servant.scheduled_arrival,
            servant.scheduled_departure,
        ),
        currentStatus: determineCurrentStatus(
            servant.status,
            servant.scheduled_arrival,
            servant.scheduled_departure,
        ),
        imageUrl,
        createdAt: servant.created_at,
        hireStatus,
    };
}

// ============================================
// HANDLER — DETAIL
// ============================================

async function handleDetail(
    req: Request,
    ctx: CallerCtx,
    body: ResidentServantsRequest,
): Promise<Response> {
    const servantId = cleanText(body.servantId, 50);
    if (!servantId) {
        return buildError(req, "BAD_REQUEST", "servantId is mandatory.", 400);
    }

    const { data: servant, error } = await supabaseAdmin
        .from("SSP_Servant")
        .select(`
            servant_id, servant_name, phone_number, address, role,
            shift_timing, gender, status, date_of_birth, id_proof_type,
            id_proof_number, is_recurring, scheduled_arrival,
            scheduled_departure, created_at, deleted_at
        `)
        .eq("servant_id", servantId)
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) return buildError(req, "SERVER_ERROR", error.message, 500);
    if (!servant) {
        return buildError(req, "NOT_FOUND", "Servant not found.", 404);
    }

    const imageMap = await fetchServantImageMap(
        [servantId],
        ctx.callerSocietyId,
    );

    const s = servant as ServantRow;
    const roles = s.role ?? [];

    return buildSuccess(req, {
        servantId: s.servant_id,
        name: s.servant_name || "Unknown",
        phoneNumber: s.phone_number,
        address: s.address,
        idProofType: s.id_proof_type,
        idProofNumber: s.id_proof_number,
        roles,
        shiftTimings: s.shift_timing ?? [],
        gender: s.gender,
        dateOfBirth: s.date_of_birth,
        status: s.status,
        scheduledArrival: s.scheduled_arrival,
        scheduledDeparture: s.scheduled_departure,
        isRecurring: s.is_recurring,
        workingHours: calculateWorkingHours(
            s.scheduled_arrival,
            s.scheduled_departure,
        ),
        currentStatus: determineCurrentStatus(
            s.status,
            s.scheduled_arrival,
            s.scheduled_departure,
        ),
        imageUrl: imageMap.get(servantId) ?? null,
        createdAt: s.created_at,
    });
}

// ============================================
// HANDLER — HIRE
// ============================================

async function handleHire(
    req: Request,
    ctx: CallerCtx,
    body: ResidentServantsRequest,
): Promise<Response> {
    const servantId = cleanText(body.servantId, 50);
    if (!servantId) {
        return buildError(req, "BAD_REQUEST", "servantId is mandatory.", 400);
    }

    const rolesToHire = normalizeRolesInput(body.roles);
    if (rolesToHire.length === 0) {
        return buildError(
            req,
            "BAD_REQUEST",
            "At least one role must be specified for hiring.",
            400,
        );
    }

    const invalidRoles = rolesToHire.filter(
        (r) =>
            !VALID_SERVANT_ROLES.includes(
                r as typeof VALID_SERVANT_ROLES[number],
            ),
    );
    if (invalidRoles.length > 0) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Invalid role(s): ${invalidRoles.join(", ")}. Allowed: ${
                VALID_SERVANT_ROLES.join(", ")
            }`,
            400,
        );
    }

    const isRecurring = body.isRecurring === true;
    const recurringDays = isRecurring
        ? normalizeRecurringDays(body.recurringDays)
        : [];

    if (isRecurring && recurringDays.length === 0) {
        return buildError(
            req,
            "BAD_REQUEST",
            "recurringDays is required when isRecurring is true.",
            400,
        );
    }

    const invalidDays = recurringDays.filter(
        (d) =>
            !VALID_RECURRING_DAYS.includes(
                d as typeof VALID_RECURRING_DAYS[number],
            ),
    );
    if (invalidDays.length > 0) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Invalid recurringDays: ${invalidDays.join(", ")}.`,
            400,
        );
    }

    // Fetch servant
    const { data: servant, error: servErr } = await supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, servant_name, role")
        .eq("servant_id", servantId)
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null)
        .maybeSingle();

    if (servErr) return buildError(req, "SERVER_ERROR", servErr.message, 500);
    if (!servant) {
        return buildError(req, "NOT_FOUND", "Servant not found.", 404);
    }

    const servantRoles = (servant.role ?? []) as string[];
    const rolesNotInServant = rolesToHire.filter((r) =>
        !servantRoles.includes(r)
    );
    if (rolesNotInServant.length > 0) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Servant does not have these roles: ${
                rolesNotInServant.join(", ")
            }. Available: ${servantRoles.join(", ")}`,
            400,
        );
    }

    // Fetch existing junction
    const { data: existing, error: junErr } = await supabaseAdmin
        .from("SSP_Society_Servant")
        .select("society_servant_id, hired_roles, is_recurring, recurring_days")
        .eq("society_user", ctx.callerUserId)
        .eq("servant_id", servantId)
        .maybeSingle();

    if (junErr) return buildError(req, "SERVER_ERROR", junErr.message, 500);

    const existingRoles = (existing?.hired_roles ?? []) as string[];

    const alreadyHired = rolesToHire.filter((r) => existingRoles.includes(r));
    if (alreadyHired.length > 0) {
        return buildError(
            req,
            "CONFLICT",
            `Roles already hired: ${alreadyHired.join(", ")}`,
            409,
        );
    }

    const updatedRoles = [...new Set([...existingRoles, ...rolesToHire])];

    let junctionRow: HireJunctionRow;

    if (!existing) {
        const { data: inserted, error: insErr } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .insert({
                society_user: ctx.callerUserId,
                servant_id: servantId,
                hired: true,
                hired_roles: updatedRoles,
                is_recurring: isRecurring,
                recurring_days: recurringDays.length > 0 ? recurringDays : null,
            })
            .select(
                "society_servant_id, society_user, servant_id, hired, is_recurring, recurring_days, hired_roles, created_at",
            )
            .single();

        if (insErr || !inserted) {
            return buildError(
                req,
                "SERVER_ERROR",
                insErr?.message ?? "Insert failed",
                500,
            );
        }
        junctionRow = inserted as HireJunctionRow;
    } else {
        const { data: updated, error: updErr } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .update({
                hired: true,
                hired_roles: updatedRoles,
                is_recurring: isRecurring,
                recurring_days: recurringDays.length > 0 ? recurringDays : null,
            })
            .eq("society_servant_id", existing.society_servant_id)
            .select(
                "society_servant_id, society_user, servant_id, hired, is_recurring, recurring_days, hired_roles, created_at",
            )
            .single();

        if (updErr || !updated) {
            return buildError(
                req,
                "SERVER_ERROR",
                updErr?.message ?? "Update failed",
                500,
            );
        }
        junctionRow = updated as HireJunctionRow;
    }

    const allRoles = servantRoles;
    const hiredRoles = (junctionRow.hired_roles ?? []) as string[];

    return buildSuccess(req, {
        servantId: junctionRow.servant_id,
        servantName: servant.servant_name,
        operation: "HIRE",
        hiredRoles,
        allRoles,
        roleStatus: buildRoleStatus(allRoles, hiredRoles),
        isRecurring: junctionRow.is_recurring,
        recurringDays: junctionRow.recurring_days,
        hired: true,
        message: `Servant hired for roles: ${rolesToHire.join(", ")}`,
    });
}

// ============================================
// HANDLER — LAYOFF
// ============================================

async function handleLayoff(
    req: Request,
    ctx: CallerCtx,
    body: ResidentServantsRequest,
): Promise<Response> {
    const servantId = cleanText(body.servantId, 50);
    if (!servantId) {
        return buildError(req, "BAD_REQUEST", "servantId is mandatory.", 400);
    }

    const rolesToLayoff = normalizeRolesInput(body.roles);

    const { data: servant, error: servErr } = await supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, servant_name, role")
        .eq("servant_id", servantId)
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null)
        .maybeSingle();

    if (servErr) return buildError(req, "SERVER_ERROR", servErr.message, 500);
    if (!servant) {
        return buildError(req, "NOT_FOUND", "Servant not found.", 404);
    }

    const allRoles = (servant.role ?? []) as string[];

    const { data: existing, error: junErr } = await supabaseAdmin
        .from("SSP_Society_Servant")
        .select("society_servant_id, hired_roles, is_recurring, recurring_days")
        .eq("society_user", ctx.callerUserId)
        .eq("servant_id", servantId)
        .maybeSingle();

    if (junErr) return buildError(req, "SERVER_ERROR", junErr.message, 500);
    if (!existing) {
        return buildError(
            req,
            "NOT_FOUND",
            `Servant '${servant.servant_name ?? "Unknown"}' is not hired.`,
            404,
        );
    }

    const existingRoles = (existing.hired_roles ?? []) as string[];
    const rolesToRemove = rolesToLayoff.length > 0
        ? rolesToLayoff
        : existingRoles;

    const notHired = rolesToRemove.filter((r) => !existingRoles.includes(r));
    if (notHired.length > 0) {
        return buildError(
            req,
            "NOT_FOUND",
            `Roles not hired: ${notHired.join(", ")}. Hired: ${
                existingRoles.join(", ")
            }`,
            404,
        );
    }

    const remainingRoles = existingRoles.filter((r) =>
        !rolesToRemove.includes(r)
    );

    if (remainingRoles.length === 0) {
        const { error: delErr } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .delete()
            .eq("society_servant_id", existing.society_servant_id);

        if (delErr) return buildError(req, "SERVER_ERROR", delErr.message, 500);

        return buildSuccess(req, {
            servantId,
            servantName: servant.servant_name,
            operation: "LAYOFF",
            hiredRoles: [],
            allRoles,
            roleStatus: buildRoleStatus(allRoles, []),
            isRecurring: null,
            recurringDays: null,
            hired: false,
            message: `Servant laid off for all roles: ${
                rolesToRemove.join(", ")
            }.`,
        });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
        .from("SSP_Society_Servant")
        .update({ hired_roles: remainingRoles })
        .eq("society_servant_id", existing.society_servant_id)
        .select(
            "society_servant_id, society_user, servant_id, hired, is_recurring, recurring_days, hired_roles, created_at",
        )
        .single();

    if (updErr || !updated) {
        return buildError(
            req,
            "SERVER_ERROR",
            updErr?.message ?? "Update failed",
            500,
        );
    }

    const j = updated as HireJunctionRow;

    return buildSuccess(req, {
        servantId: j.servant_id,
        servantName: servant.servant_name,
        operation: "LAYOFF",
        hiredRoles: (j.hired_roles ?? []) as string[],
        allRoles,
        roleStatus: buildRoleStatus(
            allRoles,
            (j.hired_roles ?? []) as string[],
        ),
        isRecurring: j.is_recurring,
        recurringDays: j.recurring_days,
        hired: true,
        message: `Servant laid off for roles: ${
            rolesToRemove.join(", ")
        }. Remaining: ${remainingRoles.join(", ")}.`,
    });
}

// ============================================
// HANDLER — VIEW
// ============================================

async function handleView(
    req: Request,
    ctx: CallerCtx,
    body: ResidentServantsRequest,
): Promise<Response> {
    const filters = body.filters ?? {};
    const page = Math.max(1, Number(body.pagination?.page ?? 1) | 0);
    const pageSize = clampPageSize(body.pagination?.pageSize);
    const offset = (page - 1) * pageSize;

    const cleanSearch = filters.search && filters.search.trim() !== ""
        ? cleanText(filters.search, 60).replace(/[%_,()]/g, "")
        : null;
    const cleanRole = filters.role
        ? cleanText(filters.role, 30).toLowerCase().replace(/[\s-]+/g, "_")
        : null;
    const cleanShift = filters.shiftTiming
        ? cleanText(filters.shiftTiming, 30).toLowerCase().replace(
            /[\s-]+/g,
            "_",
        )
        : null;
    const cleanRecurringDays = filters.recurringDays
        ? normalizeRecurringDays(filters.recurringDays)
        : [];
    const cleanHiredStatus = filters.hiredStatus ?? "all";
    const cleanDateOption = filters.dateOption;

    // ─── Fetch this resident's hire junctions ───
    const { data: junctions, error: junErr } = await supabaseAdmin
        .from("SSP_Society_Servant")
        .select(
            "society_servant_id, society_user, servant_id, hired, is_recurring, recurring_days, hired_roles, created_at",
        )
        .eq("society_user", ctx.callerUserId);

    if (junErr) return buildError(req, "SERVER_ERROR", junErr.message, 500);

    const hireMap = new Map<string, HireJunctionRow>();
    for (const j of (junctions ?? []) as HireJunctionRow[]) {
        hireMap.set(j.servant_id, j);
    }

    // ─── Build servant query ───
    let q = supabaseAdmin
        .from("SSP_Servant")
        .select(
            `
            servant_id, servant_name, phone_number, address, role,
            shift_timing, gender, status, date_of_birth, id_proof_type,
            id_proof_number, is_recurring, scheduled_arrival,
            scheduled_departure, created_at, deleted_at
        `,
            { count: "exact" },
        )
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null);

    let countQ = supabaseAdmin
        .from("SSP_Servant")
        .select("*", { count: "exact", head: true })
        .eq("society", ctx.callerSocietyId)
        .is("deleted_at", null);

    // deno-lint-ignore no-explicit-any
    const applyFilters = (query: any): any => {
        let out = query;
        if (cleanRole) out = out.contains("role", [cleanRole]);
        if (cleanShift) out = out.contains("shift_timing", [cleanShift]);
        if (cleanSearch) {
            out = out.or(
                `servant_name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`,
            );
        }
        const bounds = calculateDateBounds(
            cleanDateOption,
            filters.fromDate,
            filters.toDate,
        );
        if (bounds) {
            out = out
                .gte("created_at", bounds.startISO)
                .lt("created_at", bounds.endISO);
        }
        return out;
    };

    q = applyFilters(q);
    countQ = applyFilters(countQ);

    q = q.order("created_at", { ascending: false }).range(
        offset,
        offset + pageSize - 1,
    );

    const [dataRes, countRes] = await Promise.all([q, countQ]);

    if (dataRes.error) {
        logger.error({
            level: "error",
            action: "resident-servants.VIEW",
            message: dataRes.error.message,
            timestamp: new Date().toISOString(),
        });
        return buildError(req, "SERVER_ERROR", dataRes.error.message, 500);
    }

    const total = countRes.error ? 0 : countRes.count ?? 0;
    const rows = (dataRes.data ?? []) as ServantRow[];

    // ─── Batch image lookup ───
    const servantIds = rows.map((s) => s.servant_id);
    const imageMap = await fetchServantImageMap(
        servantIds,
        ctx.callerSocietyId,
    );

    // ─── Build response items ───
    const hiredList: any[] = [];
    const availableList: any[] = [];

    for (const s of rows) {
        const junction = hireMap.get(s.servant_id) ?? null;
        const allRoles = s.role ?? [];
        const hiredRoles = (junction?.hired_roles ?? []) as string[];

        const hireStatus: HireStatus = {
            isHired: hiredRoles.length > 0,
            hiredRoles,
            allRoles,
            roleStatus: buildRoleStatus(allRoles, hiredRoles),
            isRecurring: junction?.is_recurring ?? null,
            recurringDays: junction?.recurring_days ?? null,
            hiredAt: junction?.created_at ?? null,
        };

        // Recurring days filter
        if (cleanRecurringDays.length > 0) {
            const servantRecurring = hireStatus.recurringDays ?? [];
            const matches = cleanRecurringDays.some((d) =>
                servantRecurring.includes(d)
            );
            if (!matches) continue;
        }

        const item = toServantResponse(
            s,
            hireStatus,
            imageMap.get(s.servant_id) ?? null,
        );

        // Split per Option C1
        if (hireStatus.isHired) {
            hiredList.push(item);
        } else {
            availableList.push(item);
        }
    }

    // Apply hiredStatus filter after split
    let finalHired = hiredList;
    let finalAvailable = availableList;
    if (cleanHiredStatus === "hired") {
        finalAvailable = [];
    } else if (cleanHiredStatus === "available") {
        finalHired = [];
    }

    return buildSuccess(req, {
        hired: {
            count: finalHired.length,
            servants: finalHired,
        },
        available: {
            count: finalAvailable.length,
            servants: finalAvailable,
        },
        pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        },
        filters: {
            search: filters.search ?? null,
            role: filters.role ?? null,
            shiftTiming: filters.shiftTiming ?? null,
            recurringDays: filters.recurringDays ?? null,
            hiredStatus: filters.hiredStatus ?? null,
            dateOption: filters.dateOption ?? null,
            fromDate: filters.fromDate ?? null,
            toDate: filters.toDate ?? null,
        },
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
        let action: ActionType = "VIEW";

        try {
            const body = await req.json().catch(() => null) as
                | ResidentServantsRequest
                | null;
            if (!body) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    "Request body is required.",
                    400,
                );
            }

            const rawAction = String(body.action ?? "")
                .toUpperCase() as ActionType;
            if (!VALID_ACTIONS.includes(rawAction)) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    `action must be one of ${VALID_ACTIONS.join(", ")}`,
                    400,
                );
            }
            action = rawAction;

            const ctxResult = await getContext(authCtx.user.id);
            if (!ctxResult.ok) {
                return buildError(
                    req,
                    ctxResult.code,
                    ctxResult.message,
                    ctxResult.status,
                );
            }

            const tAction = Date.now();
            let response: Response;

            switch (action) {
                case "DETAIL":
                    response = await handleDetail(req, ctxResult.ctx, body);
                    break;
                case "HIRE":
                    response = await handleHire(req, ctxResult.ctx, body);
                    break;
                case "LAYOFF":
                    response = await handleLayoff(req, ctxResult.ctx, body);
                    break;
                case "VIEW":
                    response = await handleView(req, ctxResult.ctx, body);
                    break;
            }

            logger.info({
                level: "info",
                action: `resident-servants.${action}`,
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
                action: `resident-servants.${action}`,
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
