import { contactParkingSlot } from "../_shared/contact.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";
interface MyVisitorsRequest {
    societyRegistrationNumber: string;
    residentId: string;
    flatNumber: string;
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
interface VisitorResponse {
    visitorName?: string;
    visitorId: string;
    name: string;
    phoneNumber: string;
    email: string | null;
    gender: string | null;
    role: string | null;
    purpose: string | null;
    visitorStatus: string | null;
    approvalStatus: string | null;
    verificationPin: number | null;
    checkIn: string | null;
    checkOut: string | null;
    isRecurring: boolean | null;
    recurringDays: string[] | null;
    vehicleNumber: string | null;
    vehicleType: string | null;
    gateNo: string | null;
    deliveryOrigin: string | null;
    idProofType: string | null;
    idProofNumber: string | null;
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
    created_at: string;
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
const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
});
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
    if (!arr)
        return null;
    if (Array.isArray(arr))
        return arr.length > 0 ? arr[0] : null;
    return arr;
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
function applySearchFilter(visitors: VisitorResponse[], searchTerm: string): VisitorResponse[] {
    if (!searchTerm)
        return visitors;
    const term = searchTerm.toLowerCase().trim();
    return visitors.filter((v) => v.name.toLowerCase().includes(term) ||
        v.phoneNumber.includes(term) ||
        (v.email?.toLowerCase().includes(term) ?? false) ||
        (v.vehicleNumber?.toLowerCase().includes(term) ?? false) ||
        (v.purpose?.toLowerCase().includes(term) ?? false) ||
        (v.idProofNumber?.toLowerCase().includes(term) ?? false));
}
function applyFilters(visitors: VisitorResponse[], filters: {
    approvalStatus?: string;
    visitorStatus?: string;
    role?: string | string[];
    isRecurring?: boolean;
}): VisitorResponse[] {
    let filtered = visitors;
    if (filters.approvalStatus && filters.approvalStatus.toLowerCase() !== "all") {
        const target = filters.approvalStatus.toLowerCase();
        filtered = filtered.filter((v) => v.approvalStatus?.toLowerCase() === target);
    }
    if (filters.visitorStatus && filters.visitorStatus.toLowerCase() !== "all") {
        const target = filters.visitorStatus.toLowerCase();
        filtered = filtered.filter((v) => v.visitorStatus?.toLowerCase() === target);
    }
    if (filters.role) {
        const roles = Array.isArray(filters.role) ? filters.role : [filters.role];
        const hasAll = roles.some((r) => r.toLowerCase() === "all");
        if (!hasAll && roles.length > 0) {
            const lowerRoles = roles.map((r) => r.toLowerCase());
            filtered = filtered.filter((v) => v.role && lowerRoles.includes(v.role.toLowerCase()));
        }
    }
    if (filters.isRecurring !== undefined) {
        filtered = filtered.filter((v) => v.isRecurring === filters.isRecurring);
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
function normalizeVisitorData(rawVisitor: RawVisitor, imageUrl: string | null): VisitorResponse {
    return {
        visitorId: rawVisitor.non_society_user_id,
        name: rawVisitor.name || "N/A",
        visitorName: rawVisitor.name || "N/A",
        phoneNumber: rawVisitor.phone_number || "N/A",
        email: rawVisitor.email || null,
        gender: rawVisitor.gender || null,
        role: rawVisitor.role || null,
        purpose: rawVisitor.purpose || null,
        visitorStatus: rawVisitor.visitor_status || null,
        approvalStatus: rawVisitor.visitor_approval_status || null,
        verificationPin: rawVisitor.verification_pin || null,
        checkIn: rawVisitor.check_in || null,
        checkOut: rawVisitor.check_out || null,
        isRecurring: rawVisitor.is_recurring || null,
        recurringDays: rawVisitor.recurring_days || null,
        vehicleNumber: rawVisitor.vehicle_number || null,
        vehicleType: rawVisitor.vehicle_type || null,
        gateNo: rawVisitor.gate_no || null,
        deliveryOrigin: rawVisitor.delivery_origin || null,
        idProofType: rawVisitor.id_proof_type || null,
        idProofNumber: rawVisitor.id_proof_number || null,
        imageUrl,
        createdAt: rawVisitor.created_at || new Date().toISOString(),
    };
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
            action: "my-visitors",
            userId: authCtx.user.id,
            message: "My visitors request received",
            timestamp: new Date().toISOString(),
        });
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.");
        }
        const body = await req.json().catch(() => null);
        if (!body)
            return errorResponse("Request body is required.");
        const { societyRegistrationNumber, residentId, flatNumber, approvalStatus, visitorStatus, role, isRecurring, filterOption, fromDate, toDate, search, page, limit, } = body as MyVisitorsRequest;
        const validator = new Validator()
            .validateRequired(societyRegistrationNumber, "societyRegistrationNumber")
            .validateRequired(residentId, "residentId")
            .validateRequired(flatNumber, "flatNumber");
        if (!validator.isValid()) {
            logger.warn({
                level: "warn",
                action: "my-visitors",
                userId: authCtx.user.id,
                message: "Validation failed",
                errors: JSON.stringify(validator.getErrors()),
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Validation failed");
        }
        const regNum = sanitizeString(societyRegistrationNumber);
        const cleanResidentId = sanitizeString(residentId);
        const cleanFlatNumber = sanitizeString(flatNumber);
        const pageNum = Number(page) || 1;
        const limitNum = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
        const { data: society, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id, registration_number, society_name")
            .eq("registration_number", regNum)
            .maybeSingle();
        if (socErr) {
            logger.error({
                level: "error",
                action: "my-visitors",
                message: `Society lookup failed: ${socErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to fetch society data.");
        }
        if (!society) {
            return errorResponse("Society not found for provided registration number.");
        }
        const { data: resident, error: residentErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
          user_id,
          unit_flat_number,
          contact:contact (parking_slot,
            name,
            phone,
            email
          )
        `)
            .eq("user_id", cleanResidentId)
            .eq("unit_flat_number", cleanFlatNumber)
            .eq("society", society.society_id)
            .maybeSingle();
        if (residentErr) {
            logger.error({
                level: "error",
                action: "my-visitors",
                message: `Resident lookup failed: ${residentErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse(`Failed to verify resident: ${residentErr.message}`);
        }
        if (!resident) {
            logger.warn({
                level: "warn",
                action: "my-visitors",
                message: "Resident not found",
                residentId: cleanResidentId,
                flatNumber: cleanFlatNumber,
                societyId: society.society_id,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Resident not found matching the provided ID and flat number.");
        }
        const residentData = resident as ResidentData;
        const contactData = firstOrNull(residentData.contact);
        let query = supabaseAdmin
            .from("SSP_Non_Society_User")
            .select(`
          non_society_user_id,
          name,
          phone_number,
          email,
          gender,
          role,
          purpose,
          visitor_status,
          visitor_approval_status,
          verification_pin,
          check_in,
          check_out,
          is_recurring,
          recurring_days,
          vehicle_number,
          vehicle_type,
          gate_no,
          delivery_origin,
          id_proof_type,
          id_proof_number,
          created_at
        `)
            .eq("hosted_by", residentData.user_id);
        if (approvalStatus && approvalStatus.trim() !== "" &&
            approvalStatus.toLowerCase() !== "all") {
            query = query.eq("visitor_approval_status", approvalStatus.trim());
        }
        if (visitorStatus && visitorStatus.trim() !== "" &&
            visitorStatus.toLowerCase() !== "all") {
            query = query.eq("visitor_status", visitorStatus.trim());
        }
        if (isRecurring !== undefined) {
            query = query.eq("is_recurring", isRecurring);
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
                `email.ilike.%${term}%,` +
                `vehicle_number.ilike.%${term}%,` +
                `purpose.ilike.%${term}%`);
        }
        const { data: visitors, error: fetchErr } = await query.order("check_in", {
            ascending: false,
        });
        if (fetchErr) {
            logger.error({
                level: "error",
                action: "my-visitors",
                message: `Fetch error: ${fetchErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to fetch visitors.");
        }
        const rawVisitors = (visitors || []) as RawVisitor[];
        const visitorIds = rawVisitors.map((v) => v.non_society_user_id);
        const imagePathMap = new Map<string, string>();
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
        const formattedVisitors: VisitorResponse[] = rawVisitors.map((v) => {
            const imageUrl = imageMap.get(v.non_society_user_id) || null;
            return normalizeVisitorData(v, imageUrl);
        });
        let filteredVisitors = formattedVisitors;
        if (search) {
            filteredVisitors = applySearchFilter(filteredVisitors, search);
        }
        filteredVisitors = applyFilters(filteredVisitors, {
            approvalStatus: approvalStatus || "all",
            visitorStatus: visitorStatus || "all",
            role: role || "all",
            isRecurring,
        });
        const { items, total } = applyPagination(filteredVisitors, pageNum, limitNum);
        const residentResponseDetails = {
            parkingSlot: contactParkingSlot(contactData),
            residentId: residentData.user_id,
            name: contactData?.name || "Unknown",
            phone: contactData?.phone || "",
            email: contactData?.email || "",
            flatNumber: residentData.unit_flat_number || "N/A",
        };
        const response = {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            visitors: items,
            residentDetails: residentResponseDetails,
            filters: {
                approvalStatus: approvalStatus || null,
                visitorStatus: visitorStatus || null,
                role: role || null,
                isRecurring: isRecurring !== undefined ? isRecurring : null,
                filterOption: filterOption || null,
                fromDate: fromDate || null,
                toDate: toDate || null,
            },
            search: search || null,
        };
        logger.info({
            level: "info",
            action: "my-visitors",
            userId: authCtx.user.id,
            residentId: residentData.user_id,
            visitorsFound: total,
            returned: items.length,
            duration: Date.now() - startTime,
            message: "My visitors fetched successfully",
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
            action: "my-visitors",
            userId: authCtx?.user?.id || "unknown",
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
        });
        return errorResponse(errorMessage || "Failed to fetch visitors.");
    }
}));
