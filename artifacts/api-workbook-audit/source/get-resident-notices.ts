import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, successResponse } from "../_shared/response.ts";
import { parseRequestBody, sanitizeString } from "../_shared/utils.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";
interface GetResidentNoticesRequest {
    societyRegistrationNumber: string;
    residentId: string;
    type?: string;
    priority?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: "publishedDate" | "createdAt" | "expiryDate" | "priority";
    sortOrder?: "asc" | "desc";
    showExpired?: boolean;
    dateFrom?: string;
    dateTo?: string;
}
interface Alert {
    alert_id: string;
    title: string;
    message: string;
    priority: string;
    published_date: string | null;
    expiry_date: string | null;
    type: string;
    target_audience: string | string[] | null;
    society_user: string | null;
    name: string | null;
    created_at: string | null;
    created_by: string | null;
}
interface UserRecord {
    user_id: string;
    user_type: string;
    user_ownership_type: string;
    contact: {
        contact_id: string;
        name: string;
        email: string;
        phone: string;
    } | Array<{
        contact_id: string;
        name: string;
        email: string;
        phone: string;
    }>;
}
function toArray(value: string | string[] | null): string[] {
    if (!value)
        return [];
    if (Array.isArray(value)) {
        return value.map((s: string) => String(s).trim().toLowerCase());
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return [];
        if (trimmed.includes(",")) {
            return trimmed.split(",").map((s: string) => s.trim().toLowerCase());
        }
        return [trimmed.toLowerCase()];
    }
    return [];
}
function buildErrorResponse(code: string, message: string, status: number): Response {
    return new Response(JSON.stringify({
        success: false,
        error: code,
        message,
        notices: null,
        errorResponse: {
            errorCode: code,
            message,
            timestamp: new Date().toISOString(),
        },
    }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, _authCtx: unknown) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const t0 = Date.now();
    try {
        if (req.method !== "POST") {
            return buildErrorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed.", 405);
        }
        const body = await parseRequestBody<GetResidentNoticesRequest>(req);
        if (!body) {
            return buildErrorResponse("BAD_REQUEST", "Request body is required.", 400);
        }
        const { societyRegistrationNumber, residentId, type, priority, search, page = 1, limit = 20, sortBy = "publishedDate", sortOrder = "desc", showExpired = false, dateFrom, dateTo, } = body;
        if (!societyRegistrationNumber?.trim()) {
            return buildErrorResponse("BAD_REQUEST", "societyRegistrationNumber is mandatory.", 400);
        }
        if (!residentId?.trim()) {
            return buildErrorResponse("BAD_REQUEST", "residentId is mandatory.", 400);
        }
        const cleanRegNo = societyRegistrationNumber.trim();
        const cleanResidentId = residentId.trim();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const { data: socData, error: socError } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNo)
            .maybeSingle();
        if (socError || !socData) {
            return buildErrorResponse("NOT_FOUND", "No society registration found.", 404);
        }
        const socId = socData.society_id;
        let userQuery = supabaseAdmin
            .from("SSP_Society_User")
            .select(`
          user_id,
          user_type,
          user_ownership_type,
          contact:SSP_Contact!inner(parking_slot, contact_id, name, email, phone)
        `)
            .eq("society", socId);
        if (uuidRegex.test(cleanResidentId)) {
            userQuery = userQuery.or(`user_id.eq.${cleanResidentId},contact.eq.${cleanResidentId}`);
        }
        else {
            userQuery = userQuery.ilike("contact.name", `%${cleanResidentId}%`);
        }
        const { data: userRecords, error: userError } = await userQuery;
        if (userError || !userRecords || userRecords.length === 0) {
            return buildErrorResponse("NOT_FOUND", "Resident not found within this society.", 404);
        }
        const matchedUser = userRecords[0] as UserRecord;
        const targetUserId = matchedUser.user_id;
        const contact = Array.isArray(matchedUser.contact)
            ? matchedUser.contact[0]
            : matchedUser.contact;
        const userType = (matchedUser.user_ownership_type || matchedUser.user_type || "").trim().toLowerCase();
        let normalizedUserType: string;
        if (["owner", "tenant", "resident"].includes(userType)) {
            normalizedUserType = userType;
        }
        else if (userType === "admin" || userType === "administrator") {
            normalizedUserType = "admin";
        }
        else {
            normalizedUserType = "resident";
        }
        if (!["owner", "tenant", "resident", "admin"].includes(normalizedUserType)) {
            return buildErrorResponse("FORBIDDEN", `Access Denied: This API is only for residents. User is registered as '${normalizedUserType}'.`, 403);
        }
        const userAudienceTargets = new Set<string>();
        userAudienceTargets.add("both");
        if (normalizedUserType === "owner") {
            userAudienceTargets.add("owners");
        }
        else if (normalizedUserType === "tenant") {
            userAudienceTargets.add("tenants");
        }
        else {
            userAudienceTargets.add("owners");
            userAudienceTargets.add("tenants");
        }
        const todayISO = new Date().toISOString();
        let query = supabaseAdmin
            .from("SSP_Alert")
            .select(`
          alert_id,
          title,
          message,
          priority,
          published_date,
          expiry_date,
          type,
          target_audience,
          society_user,
          name,
          created_at,
          created_by
        `)
            .eq("society", socId);
        if (!showExpired) {
            query = query.or(`expiry_date.is.null,expiry_date.gte.${todayISO}`);
        }
        if (type && type.trim().toLowerCase() !== "all") {
            query = query.eq("type", sanitizeString(type));
        }
        if (priority && priority.trim().toLowerCase() !== "all") {
            query = query.eq("priority", sanitizeString(priority));
        }
        if (dateFrom)
            query = query.gte("published_date", dateFrom);
        if (dateTo)
            query = query.lte("published_date", dateTo);
        if (search && search.trim() !== "") {
            query = query.ilike("title", `%${sanitizeString(search)}%`);
        }
        const orderColumn = sortBy === "createdAt"
            ? "created_at"
            : sortBy === "expiryDate"
                ? "expiry_date"
                : sortBy === "priority"
                    ? "priority"
                    : "published_date";
        const ascending = sortOrder === "asc";
        query = query.order(orderColumn, { ascending, nullsFirst: false });
        const { data: alerts, error: alertError } = await query;
        if (alertError) {
            return buildErrorResponse("SERVER_ERROR", "Failed to fetch notices.", 500);
        }
        const filteredAlerts = (alerts || []).filter((alert: Alert) => {
            const noticeTargets = toArray(alert.target_audience);
            if (noticeTargets.length > 0) {
                return noticeTargets.some((target) => userAudienceTargets.has(target));
            }
            if (alert.society_user) {
                return alert.society_user === targetUserId;
            }
            return true;
        });
        const limitNum = Math.min(Number(limit) || 20, 50);
        const pageNum = Math.max(Number(page) || 1, 1);
        const offset = (pageNum - 1) * limitNum;
        const total = filteredAlerts.length;
        const paginatedAlerts = filteredAlerts.slice(offset, offset + limitNum);
        const mappedNotices = paginatedAlerts.map((alert: Alert) => ({
            noticeId: alert.alert_id ?? "N/A",
            title: alert.title ?? "No Title",
            message: alert.message ?? "",
            priority: alert.priority ?? "normal",
            publishedDate: alert.published_date
                ? alert.published_date.split("T")[0]
                : null,
            expiryDate: alert.expiry_date ? alert.expiry_date.split("T")[0] : null,
            type: alert.type ?? "general",
            createdAt: alert.created_at || null,
            createdBy: alert.name || alert.created_by || "System",
            targetAudience: toArray(alert.target_audience),
            isUserSpecific: !!alert.society_user,
        }));
        console.log(`[get-resident-notices] served ${mappedNotices.length}/${total} in ${Date.now() - t0}ms`);
        return successResponse({
            notices: mappedNotices,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            filters: {
                audienceType: normalizedUserType,
                type: type || "all",
                priority: priority || "all",
                search: search || null,
                sortBy,
                sortOrder,
                showExpired,
                dateFrom: dateFrom || null,
                dateTo: dateTo || null,
            },
            user: {
                userId: targetUserId,
                userType: normalizedUserType,
                userName: contact?.name || "Unknown",
                userEmail: contact?.email || null,
                userPhone: contact?.phone || null,
            },
        });
    }
    catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
        return buildErrorResponse("SERVER_ERROR", errorMessage || "Failed to fetch resident notices", 500);
    }
}));
