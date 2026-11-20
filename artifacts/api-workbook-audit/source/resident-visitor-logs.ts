import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";
interface ResidentLogVisitorsRequest {
    societyRegistrationNumber: string;
    residentId: string;
    role?: string | string[];
    visitorStatus?: string;
    filterOption?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
    page?: number;
    limit?: number;
}
interface VisitorLogResponse {
    visitorName?: string;
    visitorId: string;
    name: string;
    phoneNumber: string;
    role: string;
    visitorStatus: string | null;
    purpose: string | null;
    preApproved: boolean;
    vehicleNumber: string | null;
    idProofType: string | null;
    gateNumber: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    imageUrl: string | null;
    createdAt: string;
}
interface ResidentLogVisitorsResponse {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    visitors: VisitorLogResponse[];
    filters: {
        role: string | string[] | null;
        visitorStatus: string | null;
        filterOption: string | null;
        fromDate: string | null;
        toDate: string | null;
    };
    search: string | null;
    stats: {
        totalVisitors: number;
        currentlyInside: number;
        currentlyOutside: number;
    };
}
interface RawVisitorLog {
    non_society_user_id: string;
    name: string | null;
    phone_number: string | null;
    visitor_status: string | null;
    purpose: string | null;
    pre_approved: boolean | null;
    vehicle_number: string | null;
    id_proof_type: string | null;
    gate_no: string | null;
    check_in: string | null;
    check_out: string | null;
    role: string | null;
    created_at: string;
}
interface RawServant {
    servant_id: string;
    phone_number: string | null;
    servant_name: string | null;
}
const BUCKET_NAME = "society-documents";
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const SIGNED_URL_EXPIRY = 900;
const SIGNED_URL_CONCURRENCY = 50;
const SIGNED_URL_SAFETY_MARGIN_MS = 60000;
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const urlCache = new Map<string, {
    url: string;
    expiresAt: number;
}>();
const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
});
const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
});
function formatToIST(dateValue: string | Date | null): string | null {
    if (!dateValue)
        return null;
    const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
    if (isNaN(date.getTime()))
        return null;
    return IST_FORMATTER.format(date);
}
function calculateDateBounds(filter: string | null, fromStr?: string, toStr?: string): {
    startISO: string;
    endISO: string;
} | null {
    if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
        return null;
    }
    const now = new Date();
    const parts = IST_PARTS_FORMATTER.formatToParts(now);
    const pMap = new Map(parts.map((p) => [p.type, p.value]));
    const year = parseInt(pMap.get("year")!);
    const month = parseInt(pMap.get("month")!) - 1;
    const day = parseInt(pMap.get("day")!);
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(pMap.get("weekday")!);
    let startDay = day;
    let endDay = day + 1;
    let startMonth = month;
    let endMonth = month;
    const startYear = year;
    const endYear = year;
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
            if (!fromStr || !toStr)
                return null;
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
    const startObj = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0));
    const endObj = new Date(Date.UTC(endYear, endMonth, endDay, 0, 0, 0));
    startObj.setMinutes(startObj.getMinutes() - 330);
    endObj.setMinutes(endObj.getMinutes() - 330);
    return {
        startISO: startObj.toISOString(),
        endISO: endObj.toISOString(),
    };
}
function extractStorageKey(path: string): string {
    let key = path.trim();
    const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
    const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
    if (key.includes(publicMarker))
        return key.split(publicMarker)[1];
    if (key.includes(signedMarker))
        return key.split(signedMarker)[1];
    if (key.includes(".amazonaws.com/"))
        return key.split(".amazonaws.com/")[1];
    return key;
}
async function batchSignUrls(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (paths.length === 0)
        return result;
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0)
        return result;
    const now = Date.now();
    const toSign: string[] = [];
    for (const p of unique) {
        const cached = urlCache.get(p);
        if (cached && cached.expiresAt > now + SIGNED_URL_SAFETY_MARGIN_MS) {
            result.set(p, cached.url);
        }
        else {
            toSign.push(p);
        }
    }
    for (let i = 0; i < toSign.length; i += SIGNED_URL_CONCURRENCY) {
        const chunk = toSign.slice(i, i + SIGNED_URL_CONCURRENCY);
        const signed = await Promise.all(chunk.map(async (originalPath) => {
            const key = extractStorageKey(originalPath);
            try {
                const { data, error } = await supabaseAdmin.storage
                    .from(BUCKET_NAME)
                    .createSignedUrl(key, SIGNED_URL_EXPIRY);
                if (error || !data?.signedUrl)
                    return [originalPath, null] as const;
                return [originalPath, data.signedUrl] as const;
            }
            catch {
                return [originalPath, null] as const;
            }
        }));
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
function normalizeRoleFilter(role: string | string[] | undefined): string[] | null {
    if (!role)
        return null;
    const roles = Array.isArray(role) ? role : [role];
    const filtered = roles.filter((r) => r.trim() !== "");
    if (filtered.length === 0)
        return null;
    if (filtered.some((r) => r.toLowerCase() === "all"))
        return null;
    return filtered.map((r) => r.trim());
}
function applySearchFilter(visitors: VisitorLogResponse[], searchTerm: string): VisitorLogResponse[] {
    if (!searchTerm)
        return visitors;
    const term = searchTerm.toLowerCase().trim();
    return visitors.filter((v) => v.name.toLowerCase().includes(term) ||
        v.phoneNumber.includes(term) ||
        (v.purpose?.toLowerCase().includes(term) ?? false) ||
        (v.vehicleNumber?.toLowerCase().includes(term) ?? false));
}
function applyFilters(visitors: VisitorLogResponse[], filters: {
    role?: string | string[];
    visitorStatus?: string;
}): VisitorLogResponse[] {
    let filtered = visitors;
    if (filters.role) {
        const roles = Array.isArray(filters.role) ? filters.role : [filters.role];
        const hasAll = roles.some((r) => r.toLowerCase() === "all");
        if (!hasAll && roles.length > 0) {
            const lowerRoles = roles.map((r) => r.toLowerCase());
            filtered = filtered.filter((v) => v.role && lowerRoles.includes(v.role.toLowerCase()));
        }
    }
    if (filters.visitorStatus && filters.visitorStatus.toLowerCase() !== "all") {
        const target = filters.visitorStatus.toLowerCase();
        filtered = filtered.filter((v) => v.visitorStatus?.toLowerCase() === target);
    }
    return filtered;
}
function applyPagination<T>(data: T[], page: number, limit: number): {
    items: T[];
    total: number;
} {
    const total = data.length;
    const start = (page - 1) * limit;
    return { items: data.slice(start, start + limit), total };
}
Deno.serve(requireAuth(async (req: Request, authCtx: {
    user: {
        id: string;
    };
}) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const startTime = Date.now();
    try {
        logger.info({
            level: "info",
            action: "resident-log-visitors",
            userId: authCtx.user.id,
            message: "Resident log visitors request received",
            timestamp: new Date().toISOString(),
        });
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.");
        }
        const body = await req.json().catch(() => null);
        if (!body)
            return errorResponse("Request body is required.");
        const { societyRegistrationNumber, residentId, role, visitorStatus, filterOption, fromDate, toDate, search, page, limit, } = body as ResidentLogVisitorsRequest;
        const validator = new Validator()
            .validateRequired(societyRegistrationNumber, "societyRegistrationNumber")
            .validateRequired(residentId, "residentId");
        if (!validator.isValid()) {
            logger.warn({
                level: "warn",
                action: "resident-log-visitors",
                userId: authCtx.user.id,
                message: "Validation failed",
                errors: JSON.stringify(validator.getErrors()),
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Validation failed");
        }
        const regNum = sanitizeString(societyRegistrationNumber);
        const cleanResidentId = sanitizeString(residentId);
        const pageNum = Number(page) || 1;
        const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
        const roleFilter = normalizeRoleFilter(role);
        const { data: society, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id, registration_number, society_name")
            .eq("registration_number", regNum)
            .maybeSingle();
        if (socErr) {
            logger.error({
                level: "error",
                action: "resident-log-visitors",
                message: `Society lookup failed: ${socErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to fetch society data.");
        }
        if (!society) {
            return errorResponse("Society not found for provided registration number.");
        }
        const { data: hostUser, error: hostErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id, unit_flat_number")
            .eq("user_id", cleanResidentId)
            .eq("society", society.society_id)
            .maybeSingle();
        if (hostErr) {
            logger.error({
                level: "error",
                action: "resident-log-visitors",
                message: `Resident lookup failed: ${hostErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to verify resident.");
        }
        if (!hostUser) {
            return errorResponse("Resident not found in this society.");
        }
        logger.info({
            level: "info",
            action: "resident-log-visitors",
            message: "Resident verified",
            residentId: hostUser.user_id,
            timestamp: new Date().toISOString(),
        });
        const { data: hiredServants, error: servantErr } = await supabaseAdmin
            .from("SSP_Servant")
            .select("servant_id, phone_number, servant_name")
            .eq("society", society.society_id)
            .eq("status", "active");
        if (servantErr) {
            logger.warn({
                level: "warn",
                action: "resident-log-visitors",
                message: `Servant fetch failed: ${servantErr.message}`,
                timestamp: new Date().toISOString(),
            });
        }
        const hiredServantMap = new Map<string, RawServant>();
        const servantPhoneNumbers: string[] = [];
        if (hiredServants && hiredServants.length > 0) {
            for (const servant of hiredServants as RawServant[]) {
                if (servant.phone_number && servant.phone_number.trim() !== "") {
                    const formattedPhone = servant.phone_number.trim();
                    hiredServantMap.set(formattedPhone, servant);
                    servantPhoneNumbers.push(formattedPhone);
                }
            }
        }
        logger.info({
            level: "info",
            action: "resident-log-visitors",
            message: `Found ${hiredServantMap.size} active servants`,
            servantCount: hiredServantMap.size,
            timestamp: new Date().toISOString(),
        });
        let query = supabaseAdmin
            .from("SSP_Non_Society_User")
            .select(`
          non_society_user_id,
          name,
          phone_number,
          visitor_status,
          purpose,
          pre_approved,
          vehicle_number,
          id_proof_type,
          gate_no,
          check_in,
          check_out,
          role,
          created_at
        `)
            .not("check_in", "is", null);
        let targetAudienceClause = `hosted_by.eq.${hostUser.user_id}`;
        if (servantPhoneNumbers.length > 0) {
            const formattedArrayStr = servantPhoneNumbers.map((p) => `"${p}"`).join(",");
            targetAudienceClause =
                `and(hosted_by.eq.${hostUser.user_id},role.eq.Visitor),` +
                    `and(phone_number.in.(${formattedArrayStr}),role.eq.Servant)`;
        }
        else {
            query = query.eq("role", "visitor");
        }
        query = query.or(targetAudienceClause);
        if (roleFilter && roleFilter.length > 0) {
            const roleConditions = roleFilter.map((r) => `role.eq.${r}`).join(",");
            query = query.or(roleConditions);
        }
        if (visitorStatus && visitorStatus.trim() !== "" &&
            visitorStatus.toLowerCase() !== "all") {
            query = query.eq("visitor_status", visitorStatus.trim());
        }
        const dateBounds = calculateDateBounds(filterOption || null, fromDate, toDate);
        if (dateBounds) {
            query = query
                .gte("check_in", dateBounds.startISO)
                .lt("check_in", dateBounds.endISO);
        }
        if (search && search.trim() !== "") {
            const term = search.trim();
            query = query.or(`name.ilike.%${term}%,` +
                `phone_number.ilike.%${term}%,` +
                `purpose.ilike.%${term}%,` +
                `vehicle_number.ilike.%${term}%`);
        }
        const { data: visitorLogs, error: fetchErr } = await query.order("check_in", { ascending: false });
        if (fetchErr) {
            logger.error({
                level: "error",
                action: "resident-log-visitors",
                message: `Fetch error: ${fetchErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to fetch visitor logs.");
        }
        const rawVisitors = (visitorLogs || []) as RawVisitorLog[];
        const visitorIds = rawVisitors.map((v) => v.non_society_user_id);
        const imagePathMap = new Map<string, string>();
        const servantsWithLogs = new Set<string>();
        if (visitorIds.length > 0) {
            const { data: documents } = await supabaseAdmin
                .from("SSP_Document")
                .select("non_society_user, s3_path")
                .in("non_society_user", visitorIds)
                .eq("society", society.society_id)
                .not("s3_path", "is", null)
                .in("document_type", ["visitor_image", "security_guard_image", "guest_image", "photo"])
                .order("created_at", { ascending: false });
            for (const doc of (documents ?? []) as {
                non_society_user: string;
                s3_path: string;
            }[]) {
                if (doc.non_society_user && doc.s3_path) {
                    if (!imagePathMap.has(doc.non_society_user)) {
                        imagePathMap.set(doc.non_society_user, doc.s3_path);
                    }
                }
            }
        }
        const allPaths = Array.from(imagePathMap.values());
        const signedUrlMap = await batchSignUrls(allPaths);
        const imageMap = new Map<string, string>();
        for (const [visitorId, rawPath] of imagePathMap.entries()) {
            const url = signedUrlMap.get(rawPath);
            if (url)
                imageMap.set(visitorId, url);
        }
        const formattedVisitors: VisitorLogResponse[] = [];
        for (const raw of rawVisitors) {
            const imageUrl = imageMap.get(raw.non_society_user_id) || null;
            if (raw.role === "servant" && raw.phone_number) {
                servantsWithLogs.add(raw.phone_number.trim());
            }
            formattedVisitors.push({
                visitorId: raw.non_society_user_id,
                name: raw.name || "N/A",
                visitorName: raw.name || "N/A",
                phoneNumber: raw.phone_number || "N/A",
                role: raw.role || "visitor",
                visitorStatus: raw.visitor_status || null,
                purpose: raw.purpose || null,
                preApproved: raw.pre_approved || false,
                vehicleNumber: raw.vehicle_number || null,
                idProofType: raw.id_proof_type || null,
                gateNumber: raw.gate_no || null,
                checkInTime: raw.check_in || null,
                checkOutTime: raw.check_out || null,
                imageUrl,
                createdAt: raw.created_at || new Date().toISOString(),
            });
        }
        for (const [phone, servant] of hiredServantMap) {
            if (!servantsWithLogs.has(phone)) {
                formattedVisitors.push({
                    visitorId: servant.servant_id || "N/A",
                    name: servant.servant_name || "N/A",
                    phoneNumber: phone,
                    role: "servant",
                    visitorStatus: "outside",
                    purpose: "Hired Servant",
                    preApproved: true,
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
        let filteredVisitors = formattedVisitors;
        if (search) {
            filteredVisitors = applySearchFilter(filteredVisitors, search);
        }
        filteredVisitors = applyFilters(filteredVisitors, {
            role: role || "all",
            visitorStatus: visitorStatus || "all",
        });
        const { items, total } = applyPagination(filteredVisitors, pageNum, limitNum);
        let currentlyInside = 0;
        let currentlyOutside = 0;
        for (const v of filteredVisitors) {
            if (v.visitorStatus === "inside")
                currentlyInside++;
            else if (v.visitorStatus === "outside")
                currentlyOutside++;
        }
        const response: ResidentLogVisitorsResponse = {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            visitors: items,
            filters: {
                role: role || null,
                visitorStatus: visitorStatus || null,
                filterOption: filterOption || null,
                fromDate: fromDate || null,
                toDate: toDate || null,
            },
            search: search || null,
            stats: {
                totalVisitors: filteredVisitors.length,
                currentlyInside,
                currentlyOutside,
            },
        };
        logger.info({
            level: "info",
            action: "resident-log-visitors",
            userId: authCtx.user.id,
            residentId: hostUser.user_id,
            visitorsFound: total,
            returned: items.length,
            stats: { currentlyInside, currentlyOutside },
            duration: Date.now() - startTime,
            message: "Resident log visitors fetched successfully",
            timestamp: new Date().toISOString(),
        });
        return successResponse(response);
    }
    catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
        logger.error({
            level: "error",
            action: "resident-log-visitors",
            userId: authCtx?.user?.id || "unknown",
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
        });
        return errorResponse(errorMessage || "Failed to fetch resident log visitors.");
    }
}));
