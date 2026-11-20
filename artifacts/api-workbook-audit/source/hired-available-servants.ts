import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
interface HiredAvailableServantsRequest {
    residentId: string;
    societyRegistrationNumber: string;
    search?: string;
    role?: string | string[];
    recurringDays?: string | string[];
    shiftTiming?: string | string[];
    filterOption?: "all" | "hired" | "available" | "today" | "thisweek" | "lastweek" | "thismonth" | "lastmonth" | "custom";
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
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
interface FormattedServant {
    servantId: string;
    name: string;
    flatNumber: string;
    address: string | null;
    dob: string | null;
    gender: string | null;
    idProofType: string | null;
    idProofNumber: string | null;
    phone: string | null;
    roles: string[];
    shiftTimings: string[];
    workingHours: string | null;
    isRecurring: boolean;
    recurringDays: string[];
    scheduledArrival: string | null;
    scheduledDeparture: string | null;
    currentStatus: "Inside" | "Outside";
    imageUrl: string | null;
    createdAt: string;
    hireStatus: HireStatus;
}
interface HiredAvailableServantsResponse {
    status: "SUCCESS" | "FAILURE";
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hired: {
        count: number;
        servants: FormattedServant[];
    };
    available: {
        count: number;
        servants: FormattedServant[];
    };
    filters: {
        role: string | string[] | null;
        recurringDays: string | string[] | null;
        shiftTiming: string | string[] | null;
        filterOption: string | null;
        fromDate: string | null;
        toDate: string | null;
    };
    search: string | null;
    errorResponse: {
        errorCode: string;
        message: string;
        timestamp: string;
    } | null;
}
interface ServantQueryResult {
    servant_id: string;
    servant_name: string;
    phone_number: string | null;
    address: string | null;
    role: string | string[] | null;
    shift_timing: string | string[] | null;
    gender: string | null;
    status: string | null;
    date_of_birth: string | null;
    id_proof_type: string | null;
    id_proof_number: string | null;
    is_recurring: boolean | null;
    scheduled_arrival: string | null;
    scheduled_departure: string | null;
    created_at: string;
}
interface BlockResult {
    block_name: string;
}
interface ResidentInfoResult {
    user_id: string;
    unit_flat_number: string;
    block: BlockResult | BlockResult[] | null;
}
interface HireJunctionResult {
    servant_id: string;
    hired_roles: string[] | null;
    is_recurring: boolean | null;
    recurring_days: string[] | null;
    created_at: string;
}
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SIGNED_URL_EXPIRY = 900;
const BUCKET_NAME = "society-documents";
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
function parseTimeToMinutes(timeStr: string | null): number | null {
    if (!timeStr || typeof timeStr !== "string")
        return null;
    const cleanStr = timeStr.trim().toUpperCase();
    if (cleanStr.includes("-") || cleanStr.includes("T")) {
        const d = new Date(cleanStr.replace(" ", "T"));
        if (!isNaN(d.getTime())) {
            return d.getHours() * 60 + d.getMinutes();
        }
    }
    const amPmMatch = cleanStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
    if (amPmMatch) {
        let hours = parseInt(amPmMatch[1], 10);
        const minutes = parseInt(amPmMatch[2], 10);
        const modifier = amPmMatch[3];
        if (modifier === "PM" && hours < 12)
            hours += 12;
        if (modifier === "AM" && hours === 12)
            hours = 0;
        return hours * 60 + minutes;
    }
    return null;
}
function calculateWorkingHours(arrival: string | null, departure: string | null): string | null {
    if (!arrival || !departure)
        return null;
    const start = new Date(arrival.replace(" ", "T"));
    const end = new Date(departure.replace(" ", "T"));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return null;
    }
    let diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) {
        diffMs += 24 * 60 * 60 * 1000;
    }
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0 && mins === 0)
        return "0 Mins";
    if (mins === 0)
        return `${hours} Hours`;
    if (hours === 0)
        return `${mins} Mins`;
    return `${hours} Hours ${mins} Mins`;
}
function determineCurrentStatus(dbStatus: string | null, arrival: string | null, departure: string | null): "Inside" | "Outside" {
    if (dbStatus && dbStatus.trim() !== "") {
        const statusLower = dbStatus.trim().toLowerCase();
        const insideKeywords = ["inside", "in", "mark in", "marked in"];
        const outsideKeywords = ["outside", "out", "mark out", "marked out"];
        if (insideKeywords.includes(statusLower))
            return "Inside";
        if (outsideKeywords.includes(statusLower))
            return "Outside";
    }
    const startMins = parseTimeToMinutes(arrival);
    const endMins = parseTimeToMinutes(departure);
    if (startMins === null || endMins === null) {
        return "Outside";
    }
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
        return (currentMins >= startMins && currentMins <= endMins)
            ? "Inside"
            : "Outside";
    }
    else {
        return (currentMins >= startMins || currentMins <= endMins)
            ? "Inside"
            : "Outside";
    }
}
function parseArrayField(value: string | string[] | null | undefined): string[] {
    if (!value)
        return [];
    if (Array.isArray(value)) {
        return value.filter((item) => item && item.trim() !== "");
    }
    if (typeof value === "string") {
        try {
            if (value.startsWith("[") && value.endsWith("]")) {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.filter((item) => item && item.trim() !== "");
                }
            }
            return value.split(/[;,]/).map((item) => item.trim()).filter((item) => item !== "");
        }
        catch {
            return value.split(/[;,]/).map((item) => item.trim()).filter((item) => item !== "");
        }
    }
    return [];
}
function normalizeArrayFilter(value: string | string[] | undefined): string[] | null {
    if (!value)
        return null;
    if (Array.isArray(value)) {
        const filtered = value.filter((item) => item && typeof item === "string" && item.trim() !== "");
        if (filtered.length === 0)
            return null;
        if (filtered.some((item) => item.toLowerCase() === "all")) {
            return null;
        }
        return filtered.map((item) => item.trim());
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        if (trimmed.toLowerCase() === "all")
            return null;
        return [trimmed];
    }
    return null;
}
async function createSignedUrl(rawPath: string | null): Promise<string | null> {
    if (!rawPath)
        return null;
    let storageKey = rawPath.trim();
    const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;
    if (storageKey.includes(marker)) {
        storageKey = storageKey.split(marker)[1];
    }
    else if (storageKey.includes(".amazonaws.com/")) {
        storageKey = storageKey.split(".amazonaws.com/")[1];
    }
    storageKey = storageKey.trim();
    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storageKey, SIGNED_URL_EXPIRY);
    if (error) {
        console.error(`Signed URL Error for path [${storageKey}]:`, error.message);
        return null;
    }
    return data?.signedUrl ?? null;
}
async function getServantImageUrl(servantId: string): Promise<string | null> {
    try {
        const { data: docData, error: docError } = await supabaseAdmin
            .from("SSP_Document")
            .select("s3_path")
            .eq("servant", servantId)
            .ilike("document_type", "Servant Image")
            .order("uploaded_on", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (docError || !docData?.s3_path) {
            return null;
        }
        return await createSignedUrl(docData.s3_path);
    }
    catch (error) {
        console.error(`Error getting image for servant ${servantId}:`, error);
        return null;
    }
}
async function processServantRecord(servant: ServantQueryResult, hireStatusMap: Map<string, {
    hiredRoles: string[];
    isRecurring: boolean;
    recurringDays: string[];
    hiredAt: string;
}>, residentFlatInfo: {
    unit_flat_number: string;
    block_name: string;
} | null): Promise<FormattedServant | null> {
    if (!servant)
        return null;
    const flatNum = residentFlatInfo?.unit_flat_number ?? "N/A";
    const blockName = residentFlatInfo?.block_name ?? "";
    const fullFlatAddress = blockName ? `${blockName} - ${flatNum}` : flatNum;
    const allRolesArray = parseArrayField(servant.role);
    const shiftsArray = parseArrayField(servant.shift_timing);
    const imageUrl = await getServantImageUrl(servant.servant_id);
    const workingHours = calculateWorkingHours(servant.scheduled_arrival, servant.scheduled_departure);
    const currentStatus = determineCurrentStatus(servant.status, servant.scheduled_arrival, servant.scheduled_departure);
    const hireInfo = hireStatusMap.get(servant.servant_id);
    const hiredRoles = hireInfo?.hiredRoles || [];
    const isHired = hiredRoles.length > 0;
    const roleStatus: RoleStatus[] = allRolesArray.map((role) => ({
        role: role,
        isHired: hiredRoles.includes(role),
    }));
    let recurringDays: string[] | null = null;
    if (hireInfo && hireInfo.recurringDays && hireInfo.recurringDays.length > 0) {
        recurringDays = hireInfo.recurringDays;
    }
    const hireStatus: HireStatus = {
        isHired: isHired,
        hiredRoles: hiredRoles,
        allRoles: allRolesArray,
        roleStatus: roleStatus,
        isRecurring: hireInfo?.isRecurring || null,
        recurringDays: recurringDays,
        hiredAt: hireInfo?.hiredAt || null,
    };
    return {
        servantId: servant.servant_id,
        name: servant.servant_name || "Unknown",
        flatNumber: fullFlatAddress,
        address: servant.address || null,
        dob: servant.date_of_birth || null,
        gender: servant.gender || null,
        idProofType: servant.id_proof_type || null,
        idProofNumber: servant.id_proof_number || null,
        phone: servant.phone_number || null,
        roles: allRolesArray,
        shiftTimings: shiftsArray,
        workingHours,
        isRecurring: servant.is_recurring || false,
        recurringDays: [],
        scheduledArrival: servant.scheduled_arrival || null,
        scheduledDeparture: servant.scheduled_departure || null,
        currentStatus,
        imageUrl,
        createdAt: servant.created_at || new Date().toISOString(),
        hireStatus,
    };
}
serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        if (req.method !== "POST") {
            return buildErrorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed.", 405);
        }
        const bodyText = await req.text();
        if (!bodyText || bodyText.trim() === "") {
            return buildErrorResponse("BAD_REQUEST", "Request body is empty.", 400);
        }
        const requestData: HiredAvailableServantsRequest = JSON.parse(bodyText);
        console.log("📥 Request received:", JSON.stringify(requestData, null, 2));
        if (!requestData.residentId || requestData.residentId.trim() === "") {
            return buildErrorResponse("MISSING_PARAMETERS", "residentId is required.", 400);
        }
        if (!requestData.societyRegistrationNumber ||
            requestData.societyRegistrationNumber.trim() === "") {
            return buildErrorResponse("MISSING_PARAMETERS", "societyRegistrationNumber is required.", 400);
        }
        if (requestData.filterOption === "custom") {
            if (!requestData.fromDate || !requestData.toDate) {
                return buildErrorResponse("MISSING_PARAMETERS", "fromDate and toDate are required for custom date filter.", 400);
            }
        }
        const page = Math.max(1, requestData.page || 1);
        const limit = Math.min(MAX_LIMIT, Math.max(1, requestData.limit || DEFAULT_LIMIT));
        const offset = (page - 1) * limit;
        const roleFilter = normalizeArrayFilter(requestData.role);
        const recurringDaysFilter = normalizeArrayFilter(requestData.recurringDays);
        const shiftTimingFilter = normalizeArrayFilter(requestData.shiftTiming);
        const { data: society, error: societyError } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id, registration_number, society_name")
            .eq("registration_number", requestData.societyRegistrationNumber)
            .maybeSingle();
        if (societyError) {
            console.error("❌ Society error:", societyError);
            return buildErrorResponse("DATABASE_ERROR", societyError.message, 500);
        }
        if (!society) {
            return buildErrorResponse("NOT_FOUND", `Society not found: ${requestData.societyRegistrationNumber}`, 404);
        }
        const { data: residentInfo, error: residentError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
        user_id,
        unit_flat_number,
        block:SSP_Block!left (
          block_name
        )
      `)
            .eq("user_id", requestData.residentId)
            .eq("society", society.society_id)
            .maybeSingle();
        if (residentError) {
            console.error("❌ Resident error:", residentError);
        }
        const residentData = residentInfo as ResidentInfoResult | null;
        const flatInfo = residentData
            ? {
                unit_flat_number: residentData.unit_flat_number || "N/A",
                block_name: Array.isArray(residentData.block)
                    ? (residentData.block[0] as BlockResult)?.block_name || ""
                    : (residentData.block as BlockResult)?.block_name || "",
            }
            : null;
        console.log("🔍 Getting hire status for resident...");
        const { data: hiredJunctions, error: hiredError } = await supabaseAdmin
            .from("SSP_Society_Servant")
            .select("servant_id, hired_roles, is_recurring, recurring_days, created_at")
            .eq("society_user", requestData.residentId)
            .eq("hired", true);
        if (hiredError) {
            console.error("❌ Error fetching hire status:", hiredError);
            return buildErrorResponse("DATABASE_ERROR", hiredError.message, 500);
        }
        const hireStatusMap = new Map<string, {
            hiredRoles: string[];
            isRecurring: boolean;
            recurringDays: string[];
            hiredAt: string;
        }>();
        for (const junction of (hiredJunctions || []) as HireJunctionResult[]) {
            const hiredRoles = parseArrayField(junction.hired_roles);
            hireStatusMap.set(junction.servant_id, {
                hiredRoles: hiredRoles,
                isRecurring: junction.is_recurring || false,
                recurringDays: junction.recurring_days || [],
                hiredAt: junction.created_at,
            });
        }
        console.log(`✅ Found ${hireStatusMap.size} hired servants`);
        console.log("🔍 Fetching all servants from society...");
        let servantQuery = supabaseAdmin
            .from("SSP_Servant")
            .select(`
        servant_id,
        servant_name,
        phone_number,
        address,
        role,
        shift_timing,
        gender,
        status,
        date_of_birth,
        id_proof_type,
        id_proof_number,
        is_recurring,
        scheduled_arrival,
        scheduled_departure,
        created_at
      `)
            .eq("society", society.society_id);
        if (requestData.search && requestData.search.trim() !== "") {
            const term = requestData.search.trim();
            servantQuery = servantQuery.or(`servant_name.ilike.%${term}%,` +
                `phone_number.ilike.%${term}%,` +
                `address.ilike.%${term}%`);
        }
        if (roleFilter && roleFilter.length > 0) {
            const roleArray = roleFilter.map((r) => `"${r}"`).join(",");
            servantQuery = servantQuery.filter("role", "cs", `{${roleArray}}`);
        }
        if (shiftTimingFilter && shiftTimingFilter.length > 0) {
            const shiftArray = shiftTimingFilter.map((s) => `"${s}"`).join(",");
            servantQuery = servantQuery.filter("shift_timing", "cs", `{${shiftArray}}`);
        }
        if (requestData.filterOption !== "hired" &&
            requestData.filterOption !== "available") {
            const now = new Date();
            let startDate: Date | null = null;
            let endDate: Date | null = null;
            switch (requestData.filterOption) {
                case "today": {
                    startDate = new Date(now);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(now);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "thisweek": {
                    const dayOfWeek = now.getDay();
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - dayOfWeek);
                    startDate.setHours(0, 0, 0, 0);
                    break;
                }
                case "lastweek": {
                    const dayOfWeek = now.getDay();
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - dayOfWeek - 7);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 7);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "thismonth": {
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    startDate.setHours(0, 0, 0, 0);
                    break;
                }
                case "lastmonth": {
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "custom": {
                    if (requestData.fromDate && requestData.toDate) {
                        startDate = new Date(requestData.fromDate);
                        startDate.setHours(0, 0, 0, 0);
                        endDate = new Date(requestData.toDate);
                        endDate.setHours(23, 59, 59, 999);
                    }
                    break;
                }
            }
            if (startDate) {
                servantQuery = servantQuery.gte("created_at", startDate.toISOString());
            }
            if (endDate) {
                servantQuery = servantQuery.lte("created_at", endDate.toISOString());
            }
        }
        const { data: allServants, error: servantsError, count } = await servantQuery
            .order("created_at", { ascending: true })
            .range(offset, offset + limit - 1);
        if (servantsError) {
            console.error("❌ Servants error:", servantsError);
            return buildErrorResponse("DATABASE_ERROR", servantsError.message, 500);
        }
        console.log(`📊 Found ${count || 0} total servants`);
        if (!allServants || allServants.length === 0) {
            return buildEmptyResponse(requestData);
        }
        const servantsDetailsMapped = await Promise.all((allServants as ServantQueryResult[]).map((servant) => processServantRecord(servant, hireStatusMap, flatInfo)));
        const finalServants = servantsDetailsMapped.filter((s): s is FormattedServant => s !== null);
        let filteredServants = finalServants;
        if (recurringDaysFilter && recurringDaysFilter.length > 0) {
            filteredServants = filteredServants.filter((servant) => {
                const hireInfo = hireStatusMap.get(servant.servantId);
                const servantRecurringDays = hireInfo?.recurringDays || [];
                return recurringDaysFilter.some((day) => servantRecurringDays.includes(day));
            });
        }
        if (requestData.filterOption === "hired") {
            filteredServants = filteredServants.filter((s) => s.hireStatus.isHired === true);
        }
        else if (requestData.filterOption === "available") {
            filteredServants = filteredServants.filter((s) => s.hireStatus.isHired === false);
        }
        const hiredServants = filteredServants.filter((s) => s.hireStatus.isHired);
        const availableServants = filteredServants.filter((s) => !s.hireStatus.isHired);
        const totalPages = count ? Math.ceil(count / limit) : 0;
        const response = {
            status: "SUCCESS" as const,
            total: filteredServants.length,
            page: page,
            limit: limit,
            totalPages: totalPages,
            hired: {
                count: hiredServants.length,
                servants: hiredServants,
            },
            available: {
                count: availableServants.length,
                servants: availableServants,
            },
            filters: {
                role: requestData.role || null,
                recurringDays: requestData.recurringDays || null,
                shiftTiming: requestData.shiftTiming || null,
                filterOption: requestData.filterOption || null,
                fromDate: requestData.fromDate || null,
                toDate: requestData.toDate || null,
            },
            search: requestData.search || null,
            errorResponse: null,
        };
        console.log(`✅ Returning ${filteredServants.length} servants (${hiredServants.length} hired, ${availableServants.length} available)`);
        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    catch (error) {
        console.error("❌ Server error:", error);
        return buildErrorResponse("SERVER_ERROR", error instanceof Error ? error.message : "Internal server error", 500);
    }
});
function buildEmptyResponse(requestData: HiredAvailableServantsRequest): Response {
    const response = {
        status: "SUCCESS" as const,
        total: 0,
        page: requestData.page || 1,
        limit: requestData.limit || DEFAULT_LIMIT,
        totalPages: 0,
        hired: {
            count: 0,
            servants: [],
        },
        available: {
            count: 0,
            servants: [],
        },
        filters: {
            role: requestData.role || null,
            recurringDays: requestData.recurringDays || null,
            shiftTiming: requestData.shiftTiming || null,
            filterOption: requestData.filterOption || null,
            fromDate: requestData.fromDate || null,
            toDate: requestData.toDate || null,
        },
        search: requestData.search || null,
        errorResponse: null,
    };
    return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
function buildErrorResponse(code: string, message: string, statusCode: number): Response {
    const response = {
        status: "FAILURE" as const,
        total: 0,
        page: 1,
        limit: 0,
        totalPages: 0,
        hired: {
            count: 0,
            servants: [],
        },
        available: {
            count: 0,
            servants: [],
        },
        filters: {
            role: null,
            recurringDays: null,
            shiftTiming: null,
            filterOption: null,
            fromDate: null,
            toDate: null,
        },
        search: null,
        errorResponse: {
            errorCode: code,
            message: message,
            timestamp: new Date().toISOString(),
        },
    };
    return new Response(JSON.stringify(response), {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
