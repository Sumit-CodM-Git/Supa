import { contactParkingSlot } from "../_shared/contact.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { logger, sanitizeString } from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
interface ResidentComplaintsRequest {
    societyRegistrationNumber: string;
    residentId: string;
    status?: string;
    priority?: string;
    type?: string;
    filterOption?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
    page?: number;
    limit?: number;
}
interface ComplaintResponse {
    complaintId: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    type: string;
    createdAt: string;
    assignedDateTime: string | null;
    completionDateTime: string | null;
    assignedAgent: {
        agentId: string | null;
        name: string | null;
    };
    assignedVendor: {
        vendorId: string | null;
        name: string | null;
    };
    images: {
        residentUploaded: string[] | null;
        before: string[] | null;
        after: string[] | null;
    };
}
interface DocumentImage {
    complaint: string;
    document_type: string;
    s3_path: string;
}
interface ContactInfo {
    parkingSlot?: string | null;
    contact_id: string;
    name: string;
    phone: string;
    email: string;
}
interface SocietyUserData {
    user_id: string;
    unit_flat_number: string | null;
    tower: string | null;
    block: string | null;
    society: string;
    contact: ContactInfo | ContactInfo[] | null;
}
interface PaginatedResponse {
    complaints: ComplaintResponse[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
    filters: {
        status: string | null;
        priority: string | null;
        type: string | null;
        filterOption: string | null;
        fromDate: string | null;
        toDate: string | null;
    };
    search: string | null;
    residentDetails: {
        residentId: string;
        name: string;
        phone: string;
        email: string;
        unitFlatNumber: string | null;
        blockName: string | null;
        towerName: string | null;
    };
}
interface RawComplaint {
    complaint_id: string;
    name: string;
    description: string;
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
const BUCKET_NAME = "society-documents";
const MAX_IMAGES_PER_TYPE = 5;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
function formatToIST(dateValue: string | Date | null): string | null {
    if (!dateValue)
        return null;
    const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
    if (isNaN(date.getTime()))
        return null;
    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
}
function calculateDateBounds(filter: string | null, fromStr?: string, toStr?: string): {
    startISO: string;
    endISO: string;
} | null {
    if (!filter || filter.trim() === "" || filter.toLowerCase() === "all") {
        return null;
    }
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        weekday: "short",
    });
    const parts = formatter.formatToParts(now);
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
        case "lastmonth": {
            startMonth = month - 1;
            startDay = 1;
            endMonth = month;
            endDay = 1;
            break;
        }
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
async function createSignedUrls(paths: string[] | null): Promise<string[] | null> {
    if (!paths || paths.length === 0)
        return null;
    const signedUrls: string[] = [];
    for (const path of paths) {
        if (!path)
            continue;
        let storageKey = path.trim();
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
            .createSignedUrl(storageKey, 900);
        if (error) {
            logger.error({
                level: "error",
                action: "create-signed-url",
                message: `Signed URL Error for path [${storageKey}]: ${error.message}`,
                timestamp: new Date().toISOString(),
            });
            continue;
        }
        if (data?.signedUrl) {
            signedUrls.push(data.signedUrl);
        }
    }
    return signedUrls.length > 0 ? signedUrls : null;
}
function applySearchFilter(complaints: ComplaintResponse[], searchTerm: string): ComplaintResponse[] {
    if (!searchTerm)
        return complaints;
    const term = searchTerm.toLowerCase().trim();
    return complaints.filter((c) => c.title.toLowerCase().includes(term) ||
        c.description.toLowerCase().includes(term) ||
        c.complaintId.toLowerCase().includes(term) ||
        c.assignedAgent.name?.toLowerCase().includes(term) ||
        c.assignedVendor.name?.toLowerCase().includes(term) ||
        c.type.toLowerCase().includes(term) ||
        c.status.toLowerCase().includes(term) ||
        c.priority.toLowerCase().includes(term));
}
function applyFilters(complaints: ComplaintResponse[], filters: {
    status?: string;
    priority?: string;
    type?: string;
}): ComplaintResponse[] {
    let filtered = [...complaints];
    if (filters.status && filters.status.toLowerCase() !== "all") {
        filtered = filtered.filter((c) => c.status.toLowerCase() === filters.status!.toLowerCase());
    }
    if (filters.priority && filters.priority.toLowerCase() !== "all") {
        filtered = filtered.filter((c) => c.priority.toLowerCase() === filters.priority!.toLowerCase());
    }
    if (filters.type && filters.type.toLowerCase() !== "all") {
        filtered = filtered.filter((c) => c.type.toLowerCase() === filters.type!.toLowerCase());
    }
    return filtered;
}
function applyPagination<T>(data: T[], page: number, limit: number): {
    items: T[];
    total: number;
} {
    const total = data.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const items = data.slice(start, end);
    return { items, total };
}
function extractContact(contact: ContactInfo | ContactInfo[] | null | undefined): ContactInfo | null {
    if (!contact)
        return null;
    if (Array.isArray(contact)) {
        return contact.length > 0 ? contact[0] : null;
    }
    return contact;
}
async function findResidentUser(residentId: string, societyId: string): Promise<{
    data: SocietyUserData | null;
    error?: string;
}> {
    try {
        const { data: userData, error: userError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
        user_id,
        unit_flat_number,
        tower,
        block,
        society,
        contact:SSP_Contact!inner(parking_slot,
          contact_id,
          name,
          phone,
          email
        )
      `)
            .eq("user_id", residentId)
            .eq("society", societyId)
            .maybeSingle();
        if (userError) {
            return { data: null, error: userError.message };
        }
        if (!userData) {
            return { data: null, error: "NOT_FOUND" };
        }
        const contactData = extractContact(userData.contact);
        if (!contactData) {
            return { data: null, error: "Contact not found" };
        }
        return {
            data: {
                user_id: userData.user_id,
                unit_flat_number: userData.unit_flat_number || null,
                tower: userData.tower || null,
                block: userData.block || null,
                society: userData.society,
                contact: {
                    parkingSlot: contactParkingSlot(contactData),
                    contact_id: contactData.contact_id,
                    name: contactData.name,
                    phone: contactData.phone,
                    email: contactData.email || "",
                },
            },
        };
    }
    catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
        return { data: null, error: errorMessage };
    }
}
async function findResidentByIdOrName(residentId: string, societyId: string): Promise<{
    data: SocietyUserData | null;
    error?: string;
}> {
    try {
        let query = supabaseAdmin
            .from("SSP_Society_User")
            .select(`
        user_id,
        unit_flat_number,
        tower,
        block,
        society,
        contact:SSP_Contact!inner(parking_slot,
          contact_id,
          name,
          phone,
          email
        )
      `)
            .eq("society", societyId);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(residentId)) {
            query = query.or(`user_id.eq.${residentId},contact.eq.${residentId}`);
        }
        else if (/^\d{10}$/.test(residentId)) {
            query = query.eq("contact.phone", residentId);
        }
        else {
            query = query.ilike("contact.name", `%${residentId}%`);
        }
        const { data: users, error } = await query.maybeSingle();
        if (error) {
            return { data: null, error: error.message };
        }
        if (!users) {
            return { data: null, error: "NOT_FOUND" };
        }
        const contactData = extractContact(users.contact);
        if (!contactData) {
            return { data: null, error: "Contact not found" };
        }
        return {
            data: {
                user_id: users.user_id,
                unit_flat_number: users.unit_flat_number || null,
                tower: users.tower || null,
                block: users.block || null,
                society: users.society,
                contact: {
                    parkingSlot: contactParkingSlot(contactData),
                    contact_id: contactData.contact_id,
                    name: contactData.name,
                    phone: contactData.phone,
                    email: contactData.email || "",
                },
            },
        };
    }
    catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
        return { data: null, error: errorMessage };
    }
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
            action: "resident-complaints",
            userId: authCtx.user.id,
            message: "Resident complaints request received",
            timestamp: new Date().toISOString(),
        });
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.");
        }
        const body = await req.json().catch(() => null);
        if (!body) {
            return errorResponse("Request body is required.");
        }
        const { societyRegistrationNumber, residentId, status, priority, type, filterOption, fromDate, toDate, search, page, limit, } = body as ResidentComplaintsRequest;
        const validator = new Validator()
            .validateRequired(societyRegistrationNumber, "societyRegistrationNumber")
            .validateRequired(residentId, "residentId");
        if (!validator.isValid()) {
            const errors = validator.getErrors();
            logger.warn({
                level: "warn",
                action: "resident-complaints",
                userId: authCtx.user.id,
                message: "Validation failed",
                errors: JSON.stringify(errors),
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Validation failed");
        }
        const regNum = sanitizeString(societyRegistrationNumber);
        const cleanResidentId = sanitizeString(residentId);
        const rawFilter = filterOption ? sanitizeString(filterOption) : null;
        if (rawFilter && rawFilter.toLowerCase() === "custom" &&
            (!fromDate || !toDate)) {
            return errorResponse("fromDate and toDate are required for Custom filter.");
        }
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
                action: "resident-complaints",
                message: `Society lookup failed: ${socErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to fetch society data.");
        }
        if (!society) {
            return errorResponse("Society not found for provided registration number.");
        }
        const residentResult = await findResidentByIdOrName(cleanResidentId, society.society_id);
        if (residentResult.error || !residentResult.data) {
            if (residentResult.error === "NOT_FOUND") {
                return errorResponse("Resident not found in this society.");
            }
            logger.error({
                level: "error",
                action: "resident-complaints",
                message: `Resident lookup failed: ${residentResult.error}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to find resident.");
        }
        const resident = residentResult.data;
        const residentUserId = resident.user_id;
        const residentContact = resident.contact;
        logger.info({
            level: "info",
            action: "resident-complaints",
            message: "Resident found",
            residentId: residentUserId,
            residentName: residentContact
                ? extractContact(residentContact)?.name || "Unknown"
                : "Unknown",
            timestamp: new Date().toISOString(),
        });
        let query = supabaseAdmin
            .from("SSP_Complaint")
            .select(`
          complaint_id,
          name,
          complaint_type,
          description,
          status,
          priority,
          assigned_date_time,
          completion_date_time,
          created_at,
          society_user,
          assigned_agent,
          non_society_user,
          assigned_by
        `)
            .eq("society_user", residentUserId);
        if (status && status.trim() !== "" && status.toLowerCase() !== "all") {
            query = query.eq("status", status.trim());
        }
        if (priority && priority.trim() !== "" && priority.toLowerCase() !== "all") {
            query = query.eq("priority", priority.trim());
        }
        if (type && type.trim() !== "" && type.toLowerCase() !== "all") {
            query = query.eq("complaint_type", type.trim());
        }
        const dateBounds = calculateDateBounds(rawFilter, fromDate, toDate);
        if (dateBounds) {
            query = query
                .gte("created_at", dateBounds.startISO)
                .lt("created_at", dateBounds.endISO);
        }
        const { data: complaints, error: fetchErr } = await query
            .order("created_at", { ascending: false });
        if (fetchErr) {
            logger.error({
                level: "error",
                action: "resident-complaints",
                message: `Fetch error: ${fetchErr.message}`,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Failed to fetch complaints.");
        }
        const rawComplaints = (complaints || []) as RawComplaint[];
        const complaintIds = rawComplaints.map((c: RawComplaint) => c.complaint_id);
        const imageMap = new Map<string, {
            residentUploaded: string[];
            before: string[];
            after: string[];
        }>();
        if (complaintIds.length > 0) {
            const { data: documents } = await supabaseAdmin
                .from("SSP_Document")
                .select("complaint, document_type, s3_path")
                .in("complaint", complaintIds);
            (documents as DocumentImage[] | null)?.forEach((doc: DocumentImage) => {
                if (!doc.complaint)
                    return;
                if (!imageMap.has(doc.complaint)) {
                    imageMap.set(doc.complaint, {
                        residentUploaded: [],
                        before: [],
                        after: [],
                    });
                }
                const images = imageMap.get(doc.complaint)!;
                const docType = (doc.document_type ?? "").trim().toLowerCase();
                if (docType === "complaint_attachment" ||
                    docType === "facility_attachment") {
                    if (images.residentUploaded.length < MAX_IMAGES_PER_TYPE) {
                        images.residentUploaded.push(doc.s3_path);
                    }
                }
                else if (docType === "before_complaint_image" ||
                    docType === "before_image") {
                    if (images.before.length < MAX_IMAGES_PER_TYPE) {
                        images.before.push(doc.s3_path);
                    }
                }
                else if (docType === "after_complaint_image" ||
                    docType === "after_image") {
                    if (images.after.length < MAX_IMAGES_PER_TYPE) {
                        images.after.push(doc.s3_path);
                    }
                }
            });
        }
        const formattedComplaints: ComplaintResponse[] = [];
        for (const comp of rawComplaints) {
            let agentName: string | null = null;
            if (comp.assigned_agent) {
                const agentResult = await findResidentUser(comp.assigned_agent, society.society_id);
                if (agentResult.data && !agentResult.error) {
                    const contact = extractContact(agentResult.data.contact);
                    agentName = contact?.name || null;
                }
            }
            let vendorName: string | null = null;
            if (comp.non_society_user) {
                const { data: vendorData } = await supabaseAdmin
                    .from("SSP_Non_Society_User")
                    .select("name")
                    .eq("non_society_user_id", comp.non_society_user)
                    .maybeSingle();
                if (vendorData) {
                    vendorName = vendorData.name;
                }
            }
            const rawImages = imageMap.get(comp.complaint_id);
            const residentUploadedImages = await createSignedUrls(rawImages?.residentUploaded ?? null);
            const beforeImages = await createSignedUrls(rawImages?.before ?? null);
            const afterImages = await createSignedUrls(rawImages?.after ?? null);
            formattedComplaints.push({
                complaintId: comp.complaint_id,
                title: comp.name || "Untitled",
                description: comp.description || "",
                status: comp.status || "pending",
                priority: comp.priority || "medium",
                type: comp.complaint_type || "general",
                createdAt: comp.created_at || new Date().toISOString(),
                assignedDateTime: formatToIST(comp.assigned_date_time),
                completionDateTime: formatToIST(comp.completion_date_time),
                assignedAgent: {
                    agentId: comp.assigned_agent || null,
                    name: agentName,
                },
                assignedVendor: {
                    vendorId: comp.non_society_user || null,
                    name: vendorName,
                },
                images: {
                    residentUploaded: residentUploadedImages,
                    before: beforeImages,
                    after: afterImages,
                },
            });
        }
        let filteredComplaints = formattedComplaints;
        if (search) {
            filteredComplaints = applySearchFilter(filteredComplaints, search);
        }
        filteredComplaints = applyFilters(filteredComplaints, {
            status: status || "all",
            priority: priority || "all",
            type: type || "all",
        });
        const { items, total } = applyPagination(filteredComplaints, pageNum, limitNum);
        const contact = extractContact(residentContact);
        const residentResponseDetails = {
            parkingSlot: contactParkingSlot(contact),
            residentId: resident.user_id,
            name: contact?.name || "Unknown",
            phone: contact?.phone || "",
            email: contact?.email || "",
            unitFlatNumber: resident.unit_flat_number || null,
            blockName: resident.block || null,
            towerName: resident.tower || null,
        };
        const response: PaginatedResponse = {
            complaints: items,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
            filters: {
                status: status || null,
                priority: priority || null,
                type: type || null,
                filterOption: filterOption || null,
                fromDate: fromDate || null,
                toDate: toDate || null,
            },
            search: search || null,
            residentDetails: residentResponseDetails,
        };
        logger.info({
            level: "info",
            action: "resident-complaints",
            userId: authCtx.user.id,
            residentId: resident.user_id,
            complaintsFound: total,
            returned: items.length,
            duration: Date.now() - startTime,
            message: "Resident complaints fetched successfully",
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
            action: "resident-complaints",
            userId: authCtx?.user?.id || "unknown",
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
        });
        return errorResponse(errorMessage || "Failed to fetch complaints.");
    }
}));
