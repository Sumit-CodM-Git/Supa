import { hasVisitorName, readVisitorName, VisitorDraftError, findVisitorDraft, isVisitorOtpDraft, canCompleteVisitorDetails } from "../_shared/visitor-drafts.ts";
import { contactParkingSlot } from "../_shared/contact.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
const BUCKET_NAME = "society-documents";
const baseLogger = createLogger("security-gate-console");
const logger = {
    info: (data: Record<string, unknown>) => baseLogger.info({
        level: "info",
        timestamp: new Date().toISOString(),
        ...data,
    }),
    error: (data: Record<string, unknown>) => baseLogger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        ...data,
    }),
};
interface SecurityGatePayload {
    actionType: "FETCH_PRE_APPROVALS" | "REQUEST_APPROVAL" | "UPDATE_STATUS" | "FETCH_INSIDE_LOGS";
    societyRegistrationNumber: string;
    societyUserId?: string;
    securityGuardId?: string;
    flatNumber?: string;
    block?: string;
    tower?: string;
    visitorId?: string;
    newStatus?: string;
    visitorName?: string;
    phone?: string;
    email?: string;
    gender?: string;
    role?: string;
    idProofType?: string;
    idProofNumber?: string;
    gateNumber?: string;
    platform?: string;
    vehicleNumber?: string;
    vehicleType?: string;
    purpose?: string;
    page?: number | string;
    limit?: number | string;
    searchTerm?: string;
    startDate?: string;
    endDate?: string;
}
interface AuthContext {
    user: {
        id: string;
        email?: string;
    };
}
interface AuthenticatedRequest extends Request {
    authContext?: AuthContext;
}
const supabaseAdmin: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const authCtx = (req as AuthenticatedRequest).authContext;
    const startTime = Date.now();
    try {
        logger.info({
            action: "security_gate_console_start",
            userId: authCtx?.user?.id ?? "unknown",
            method: req.method,
            message: "Security gate console request initialized",
        });
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }
        const bodyText = await req.text().catch(() => null);
        if (!bodyText || bodyText.trim() === "") {
            return errorResponse("Request body is empty.", 400);
        }
        const requestObj: SecurityGatePayload = JSON.parse(bodyText);
        const { actionType, societyRegistrationNumber, societyUserId, securityGuardId, flatNumber, block, tower, visitorId, newStatus, visitorName, phone, email, gender, role, idProofType, idProofNumber, gateNumber, platform, vehicleNumber, vehicleType, purpose, page = 1, limit = 10, searchTerm, startDate, endDate, } = requestObj;
        if (!societyRegistrationNumber || societyRegistrationNumber.trim() === "") {
            return errorResponse("societyRegistrationNumber is mandatory.", 400);
        }
        const cleanRegNum = societyRegistrationNumber.trim();
        const currentAction = actionType?.toUpperCase()?.trim();
        const { data: societyContext, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNum)
            .maybeSingle();
        if (socErr || !societyContext) {
            return errorResponse("Target society environment reference not found.", 404);
        }
        const societyId = societyContext.society_id;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
        const offset = (pageNum - 1) * limitNum;
        if (currentAction === "FETCH_PRE_APPROVALS") {
            let baseQuery = supabaseAdmin
                .from("SSP_Non_Society_User")
                .select(`
            non_society_user_id,
            name,
            delivery_origin,
            phone_number,
            vehicle_number,
            purpose,
            visitor_status,
            check_in,
            check_out,
            hosted_by:SSP_Society_User!hosted_by(
              user_id,
              unit_flat_number,
              contact:SSP_Contact(parking_slot,
                name
              )
            )
          `, { count: "exact" })
                .eq("society", societyId)
                .is("check_in", null)
                .or("visitor_approval_status.is.null,visitor_approval_status.ilike.approved,visitor_approval_status.ilike.pending");
            if (societyUserId) {
                baseQuery = baseQuery.eq("hosted_by.user_id", societyUserId.trim());
            }
            if (searchTerm && searchTerm.trim() !== "") {
                const cleanSearch = searchTerm.trim();
                baseQuery = baseQuery.or(`name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,vehicle_number.ilike.%${cleanSearch}%`);
            }
            const { data: visitors, count, error: fetchErr } = await baseQuery
                .order("created_at", { ascending: false })
                .range(offset, offset + limitNum - 1);
            if (fetchErr)
                throw fetchErr;
            let processedVisitors: any[] = [];
            if (visitors && visitors.length > 0) {
                processedVisitors = await attachSignedURLsToVisitors(supabaseAdmin, visitors, cleanRegNum);
            }
            const totalRecords = count ?? 0;
            const totalPages = Math.ceil(totalRecords / limitNum);
            logger.info({
                action: "fetch_pre_approvals_success",
                count: processedVisitors.length,
                durationMs: Date.now() - startTime,
            });
            return successResponse({
                Visitors: processedVisitors,
                pagination: {
                    currentPage: pageNum,
                    pageSize: limitNum,
                    totalRecords,
                    totalPages,
                },
                visitorId: null,
                success: true,
            });
        }
        else if (currentAction === "REQUEST_APPROVAL") {
            const hostedByUuid = societyUserId && String(societyUserId).trim() !== "" ? String(societyUserId).trim() : null;
            const approverUuid = securityGuardId && String(securityGuardId).trim() !== "" ? String(securityGuardId).trim() : null;
            if (!hostedByUuid)
                return errorResponse("societyUserId is required.", 400);
            if (hostedByUuid) {
                const { data: resident } = await supabaseAdmin
                    .from("SSP_Society_User")
                    .select("user_id")
                    .eq("user_id", hostedByUuid)
                    .eq("society", societyId)
                    .maybeSingle();
                if (!resident) {
                    return errorResponse("Resident user not found.", 404);
                }
            }
            if (approverUuid) {
                const { data: security } = await supabaseAdmin
                    .from("SSP_Society_User")
                    .select("user_id")
                    .eq("user_id", approverUuid)
                    .eq("society", societyId)
                    .maybeSingle();
                if (!security) {
                    return errorResponse("Security Guard not found.", 404);
                }
            }
            const input = requestObj as SecurityGatePayload & {
                name?: string;
                phoneNumber?: string;
            };
            const cleanPhone = String(phone ?? input.phoneNumber ?? "").trim() || null;
            const draft = await findVisitorDraft(supabaseAdmin, hostedByUuid, societyId, cleanPhone, visitorId);
            const savedName = hasVisitorName(draft?.name) ? draft.name : null;
            const suppliedName = readVisitorName(requestObj as unknown as Record<string, unknown>);
            if (savedName && suppliedName && savedName !== suppliedName)
                return errorResponse("Visitor name does not match this visit.", 409);
            const name = suppliedName ?? savedName;
            const phoneNumber = cleanPhone ?? draft?.phone_number;
            if (!name || !phoneNumber)
                return errorResponse("visitorName and phone/phoneNumber (or an OTP visitorId) are required.", 400);
            const reusable = draft && (isVisitorOtpDraft(draft) || canCompleteVisitorDetails(draft));
            const keepDecision = draft && ["approved", "rejected"].includes(String(draft.visitor_approval_status ?? "").toLowerCase());
            const payload = {
                name, phone_number: phoneNumber, delivery_origin: platform ?? null,
                vehicle_number: vehicleNumber ?? null, purpose: purpose ?? null,
                role: role || "visitor", gender: gender ?? null, email: email ?? null,
                id_proof_type: idProofType ?? null, id_proof_number: idProofNumber ?? null,
                gate_no: gateNumber ?? null, vehicle_type: vehicleType ?? null,
                visitor_status: keepDecision ? draft.visitor_status : "Pending",
                visitor_approval_status: keepDecision ? draft.visitor_approval_status : "pending",
                pre_approved: keepDecision ? draft.pre_approved : false,
                is_otp_verified: draft?.is_otp_verified === true,
                check_in: null, check_out: null, hosted_by: hostedByUuid,
                approver: approverUuid, society: societyId,
            };
            const table = supabaseAdmin.from("SSP_Non_Society_User");
            const write = draft && !reusable
                ? table.select("*").eq("non_society_user_id", draft.non_society_user_id)
                : reusable
                    ? table.update(payload).eq("non_society_user_id", draft.non_society_user_id)
                        .eq("society", societyId).eq("hosted_by", hostedByUuid).eq("name", draft.name)
                    : table.insert(payload);
            const { data: newVisitor, error: insertErr } = await write.select("non_society_user_id, name").single();
            if (insertErr)
                throw insertErr;
            if (!newVisitor)
                return errorResponse("Visitor changed. Please refresh and retry.", 409);
            return successResponse({ Visitors: [], visitorId: newVisitor.non_society_user_id,
                name: newVisitor.name, visitorName: newVisitor.name, success: true });
        }
        else if (currentAction === "UPDATE_STATUS") {
            if (!visitorId) {
                return errorResponse("visitorId parameter missing from update routing request.", 400);
            }
            const { data: checkVisitor } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .select("non_society_user_id, name")
                .eq("non_society_user_id", visitorId)
                .eq("society", societyId)
                .maybeSingle();
            if (!checkVisitor) {
                return errorResponse(`No visitor found with ID: ${visitorId}`, 404);
            }
            const updatePayload: Record<string, any> = {};
            const suppliedVisitorName = readVisitorName(requestObj as unknown as Record<string, unknown>);
            if (suppliedVisitorName) {
                if (hasVisitorName(checkVisitor.name) && checkVisitor.name !== suppliedVisitorName) {
                    return errorResponse("Visitor name does not match this visit.", 409);
                }
                updatePayload.name = suppliedVisitorName;
            }
            const targetStatus = String(newStatus).trim().toLowerCase();
            if (targetStatus === "inside") {
                updatePayload.check_in = new Date().toISOString();
                updatePayload.check_out = null;
                updatePayload.visitor_status = "Inside";
            }
            else if (targetStatus === "outside") {
                updatePayload.check_out = new Date().toISOString();
                updatePayload.visitor_status = "Outside";
            }
            else if (["approved", "approve", "accept", "accepted", "allow"].includes(targetStatus)) {
                updatePayload.visitor_status = "Approved";
                updatePayload.visitor_approval_status = "approved";
                updatePayload.pre_approved = true;
            }
            else if (["rejected", "reject", "deny"].includes(targetStatus)) {
                updatePayload.visitor_status = "Rejected";
                updatePayload.visitor_approval_status = "rejected";
                updatePayload.pre_approved = false;
            }
            else {
                return errorResponse("Invalid status provided. Expected 'Approved', 'Rejected', 'Inside', or 'Outside'.", 400);
            }
            const { error: updateErr } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .update(updatePayload)
                .eq("non_society_user_id", visitorId);
            if (updateErr)
                throw updateErr;
            logger.info({
                action: "update_status_success",
                visitorId,
                status: updatePayload.visitor_status,
                durationMs: Date.now() - startTime,
            });
            return successResponse({
                Visitors: [],
                visitorId,
                success: true,
            });
        }
        else if (currentAction === "FETCH_INSIDE_LOGS") {
            let query = supabaseAdmin
                .from("SSP_Non_Society_User")
                .select(`
            non_society_user_id,
            name,
            delivery_origin,
            phone_number,
            vehicle_number,
            purpose,
            visitor_status,
            check_in,
            check_out,
            hosted_by:SSP_Society_User!hosted_by(
              user_id,
              unit_flat_number,
              block:SSP_Block(
                block_name
              ),
              tower:SSP_Tower(
                name
              ),
              contact:SSP_Contact(parking_slot,
                name
              )
            )
          `, { count: "exact" })
                .eq("society", societyId);
            if (newStatus && newStatus.trim() !== "") {
                query = query.ilike("visitor_status", newStatus.trim());
            }
            else {
                query = query.ilike("visitor_status", "Inside");
            }
            const cleanFlat = flatNumber ? String(flatNumber).trim() : "";
            const cleanBlock = block ? String(block).trim() : "";
            const cleanTower = tower ? String(tower).trim() : "";
            if (cleanFlat !== "")
                query = query.eq("hosted_by.unit_flat_number", cleanFlat);
            if (cleanBlock !== "")
                query = query.eq("hosted_by.block.block_name", cleanBlock);
            if (cleanTower !== "")
                query = query.eq("hosted_by.tower.name", cleanTower);
            if (searchTerm && searchTerm.trim() !== "") {
                const cleanSearch = searchTerm.trim();
                query = query.or(`name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,vehicle_number.ilike.%${cleanSearch}%`);
            }
            if (startDate) {
                query = query.gte("created_at", new Date(startDate).toISOString());
            }
            if (endDate) {
                query = query.lte("created_at", new Date(endDate).toISOString());
            }
            if (!cleanFlat && !cleanBlock && !cleanTower && !startDate && !endDate && (!newStatus || newStatus.toLowerCase() === "inside")) {
                const todayStart = new Date();
                todayStart.setUTCHours(0, 0, 0, 0);
                query = query.gte("check_in", todayStart.toISOString());
            }
            const { data: insideVisitors, count, error: logErr } = await query
                .order("created_at", { ascending: false })
                .range(offset, offset + limitNum - 1);
            if (logErr)
                throw logErr;
            let processedVisitors: any[] = [];
            if (insideVisitors && insideVisitors.length > 0) {
                processedVisitors = await attachSignedURLsToVisitors(supabaseAdmin, insideVisitors, cleanRegNum);
            }
            const totalRecords = count ?? 0;
            const totalPages = Math.ceil(totalRecords / limitNum);
            logger.info({
                action: "fetch_inside_logs_success",
                count: processedVisitors.length,
                durationMs: Date.now() - startTime,
            });
            return successResponse({
                Visitors: processedVisitors,
                pagination: {
                    currentPage: pageNum,
                    pageSize: limitNum,
                    totalRecords,
                    totalPages,
                },
                visitorId: null,
                success: true,
            });
        }
        return errorResponse("Invalid or unmapped actionType operation.", 400);
    }
    catch (error: unknown) {
        if (error instanceof VisitorDraftError)
            return errorResponse(error.message, error.status);
        const err = error as Error;
        logger.error({
            action: "security_gate_console_error",
            error: err.message,
            durationMs: Date.now() - startTime,
        });
        return errorResponse(err.message || "Security gate console execution failed.", 500, Deno.env.get("DENO_ENV") === "development" ? err.stack : null);
    }
}));
async function attachSignedURLsToVisitors(supabase: SupabaseClient, visitorList: any[], registrationNumber: string) {
    const visitorIds = visitorList.map((v) => v.non_society_user_id);
    const { data: docs } = await supabase
        .from("SSP_Document")
        .select("non_society_user, s3_path")
        .in("non_society_user", visitorIds);
    const imageMap = new Map<string, string>();
    docs?.forEach((doc: any) => {
        if (doc.non_society_user && doc.s3_path) {
            imageMap.set(doc.non_society_user, doc.s3_path.trim());
        }
    });
    return await Promise.all(visitorList.map(async (v: any) => {
        let finalSignedUrl: string | null = null;
        const rawPath = imageMap.get(v.non_society_user_id);
        if (rawPath) {
            let storageKey = rawPath;
            if (rawPath.includes(".amazonaws.com/")) {
                storageKey = rawPath.split(".amazonaws.com/")[1].trim();
            }
            if (!storageKey.startsWith(`${registrationNumber}/`)) {
                storageKey = `${registrationNumber}/${storageKey}`;
            }
            const { data: signedPayload } = await supabase.storage
                .from(BUCKET_NAME)
                .createSignedUrl(storageKey, 900);
            if (signedPayload) {
                finalSignedUrl = signedPayload.signedUrl;
            }
        }
        return {
            parkingSlot: contactParkingSlot(v.hosted_by?.contact),
            visitorId: v.non_society_user_id,
            name: v.name ?? "",
            phone: v.phone_number ?? "",
            platform: v.delivery_origin ?? "N/A",
            purpose: v.purpose ?? "N/A",
            vehicle: v.vehicle_number ?? "N/A",
            status: v.visitor_status ?? "",
            checkIn: v.check_in ?? null,
            checkOut: v.check_out ?? null,
            flat: v.hosted_by?.unit_flat_number ?? "N/A",
            block: v.hosted_by?.block?.block_name ?? "N/A",
            tower: v.hosted_by?.tower?.name ?? "N/A",
            residentName: v.hosted_by?.contact?.name ?? "N/A",
            imageUrl: finalSignedUrl,
        };
    }));
}
