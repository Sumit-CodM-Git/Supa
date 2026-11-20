import { visitorDateOtp } from "../_shared/visitor-otp-date.ts";
import { hasVisitorName, readVisitorName, findVisitorDraft, canVerifyVisitorOtp, findPendingVisitorForOtp, VisitorDraftError } from "../_shared/visitor-drafts.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { generateId, getCurrentTimestamp, logger, sanitizeString, } from "../_shared/utils.ts";
import { Validator } from "../_shared/validation.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
interface VisitorOtpRequest {
    phoneNumber: string;
    visitorName?: string;
    name?: string;
    otp?: string;
    visitorId?: string;
    societyUserId: string;
}
interface VisitorOtpResponse {
    visitorId: string;
    name: string | null;
    visitorName: string | null;
    phoneNumber: string;
    message: string;
    otpVerified: boolean;
    isNewVisitor: boolean;
    nextStep: "VERIFY_OTP" | "COMPLETED";
    requiresVisitorDetails?: boolean;
}
interface VisitorData {
    non_society_user_id: string;
    name: string;
    phone_number: string;
    one_time_password: string | null;
    visitor_status: string | null;
}
interface TargetResident {
    userId: string;
    society: string;
    tower: string | null;
    block: string | null;
    flatNumber: string;
}
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
function generateDateOtp(): string {
    return visitorDateOtp();
}
function validateOtp(otp: string): boolean {
    return /^[0-9]{6}$/.test(otp);
}
function validatePhoneNumber(phone: string): boolean {
    return /^[0-9]{10}$/.test(phone) || /^[0-9]{10,15}$/.test(phone);
}
async function resolveTargetResident(societyUserId: string): Promise<{
    ok: true;
    resident: TargetResident;
} | {
    ok: false;
    response: Response;
}> {
    const { data: resident, error: resErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, society, tower, block, unit_flat_number, deleted_at")
        .eq("user_id", societyUserId)
        .maybeSingle();
    if (resErr) {
        logger.error({
            level: "error",
            action: "visitor-otp",
            message: `Resident lookup failed: ${resErr.message}`,
            societyUserId,
            timestamp: new Date().toISOString(),
        });
        return {
            ok: false,
            response: errorResponse("Failed to load target resident.", 500),
        };
    }
    if (!resident || resident.deleted_at) {
        return {
            ok: false,
            response: errorResponse("Target resident not found.", 404),
        };
    }
    if (!resident.society || !resident.unit_flat_number) {
        return {
            ok: false,
            response: errorResponse("Target resident's flat is not configured.", 400),
        };
    }
    const { data: entitlements, error: entErr } = await supabaseAdmin.rpc("get_entitlements", {
        p_society: resident.society,
        p_tower: resident.tower,
        p_block: resident.block,
        p_flat: resident.unit_flat_number,
    });
    if (entErr) {
        logger.error({
            level: "error",
            action: "visitor-otp",
            message: `Entitlement lookup failed: ${entErr.message}`,
            societyUserId,
            timestamp: new Date().toISOString(),
        });
        return {
            ok: false,
            response: errorResponse("Failed to check resident's plan.", 500),
        };
    }
    const hasOtp = entitlements?.VISITOR_OTP === true;
    if (!hasOtp) {
        const { data: planCode } = await supabaseAdmin.rpc("get_current_plan_code", {
            p_society: resident.society,
            p_tower: resident.tower,
            p_block: resident.block,
            p_flat: resident.unit_flat_number,
        });
        const residentPlan = (planCode as string) ?? "FREE";
        logger.warn({
            level: "warn",
            action: "visitor-otp",
            message: `Resident's plan lacks VISITOR_OTP`,
            societyUserId,
            residentPlan,
            timestamp: new Date().toISOString(),
        });
        return {
            ok: false,
            response: new Response(JSON.stringify({
                success: false,
                error: "FEATURE_NOT_AVAILABLE_FOR_RESIDENT",
                message: `The selected resident's plan does not include Visitor OTP. Their plan: ${residentPlan}.`,
                requiredFeature: "VISITOR_OTP",
                residentPlan,
            }), {
                status: 402,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                },
            }),
        };
    }
    return {
        ok: true,
        resident: {
            userId: resident.user_id,
            society: resident.society,
            tower: resident.tower,
            block: resident.block,
            flatNumber: resident.unit_flat_number,
        },
    };
}
async function createNewVisitor(phoneNumber: string, target: TargetResident, visitorName: string | null): Promise<{
    visitor: VisitorData | null;
    error?: string;
}> {
    try {
        const visitorId = generateId();
        const newVisitorData = {
            non_society_user_id: visitorId,
            phone_number: phoneNumber,
            name: visitorName ?? "Unknown Visitor",
            role: "visitor",
            visitor_status: "otp_pending",
            check_in: null,
            check_out: null,
            visitor_approval_status: null,
            is_otp_verified: false,
            pre_approved: false,
            hosted_by: target.userId,
            society: target.society,
            created_at: getCurrentTimestamp(),
        };
        const { data: createdVisitor, error: insertError } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .insert(newVisitorData)
            .select()
            .single();
        if (insertError) {
            return { visitor: null, error: insertError.message };
        }
        logger.info({
            level: "info",
            action: "create-visitor-otp",
            message: `New visitor record created for visit`,
            visitorId: visitorId,
            phoneNumber: phoneNumber,
            targetResidentId: target.userId,
            timestamp: new Date().toISOString(),
        });
        return { visitor: createdVisitor as VisitorData };
    }
    catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
        return { visitor: null, error: errorMessage };
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
            action: "visitor-otp",
            userId: authCtx.user.id,
            message: "Visitor OTP request received",
            timestamp: new Date().toISOString(),
        });
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.");
        }
        const body = await req.json().catch(() => null);
        if (!body) {
            return errorResponse("Request body is required.");
        }
        const { phoneNumber, otp, societyUserId } = body as VisitorOtpRequest;
        const validator = new Validator()
            .validateRequired(phoneNumber, "phoneNumber")
            .validateRequired(societyUserId, "societyUserId");
        if (!validator.isValid()) {
            const errors = validator.getErrors();
            logger.warn({
                level: "warn",
                action: "visitor-otp",
                userId: authCtx.user.id,
                message: "Validation failed",
                errors: JSON.stringify(errors),
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Validation failed: phoneNumber and societyUserId are required.");
        }
        const visitorName = readVisitorName(body);
        const cleanPhone = sanitizeString(phoneNumber);
        const cleanSocietyUserId = sanitizeString(societyUserId);
        if (!validatePhoneNumber(cleanPhone)) {
            return errorResponse("Invalid phone number format. Please enter a valid 10-15 digit number.");
        }
        const targetResult = await resolveTargetResident(cleanSocietyUserId);
        if (!targetResult.ok) {
            return targetResult.response;
        }
        const target = targetResult.resident;
        const cleanOtp = otp ? sanitizeString(otp) : null;
        if (cleanOtp && !validateOtp(cleanOtp))
            return errorResponse("Invalid OTP format. OTP must be 6 digits.");
        const suppliedVisitorId = (body as VisitorOtpRequest).visitorId?.trim();
        let draft;
        try {
            draft = await findVisitorDraft(supabaseAdmin, target.userId, target.society, cleanPhone, suppliedVisitorId);
        }
        catch (error) {
            if (!(error instanceof VisitorDraftError) || error.status !== 409 || suppliedVisitorId)
                throw error;
            draft = null;
        }
        if (!draft && !suppliedVisitorId)
            draft = await findPendingVisitorForOtp(supabaseAdmin, target.userId, target.society, cleanPhone);
        if (draft && !canVerifyVisitorOtp(draft))
            return errorResponse("This visitor has already been submitted. Start a new visit without visitorId.", 409);
        if (!draft && cleanOtp)
            return errorResponse("No active OTP request found. Request an OTP first.", 404);
        if (!draft) {
            const created = await createNewVisitor(cleanPhone, target, visitorName);
            if (created.error) {
                draft = await findVisitorDraft(supabaseAdmin, target.userId, target.society, cleanPhone);
                if (!draft)
                    return errorResponse(`Failed to create visitor: ${created.error}`);
            }
            else
                draft = created.visitor;
        }
        if (!draft)
            return errorResponse("Failed to create visitor record.");
        if (visitorName && draft.name !== visitorName) {
            if (hasVisitorName(draft.name)) {
                return errorResponse("Visitor name does not match this visit.", 409);
            }
            let nameUpdate = supabaseAdmin.from("SSP_Non_Society_User")
                .update({ name: visitorName }).eq("non_society_user_id", draft.non_society_user_id)
                .eq("hosted_by", target.userId).eq("society", target.society);
            nameUpdate = draft.name == null ? nameUpdate.is("name", null) : nameUpdate.eq("name", draft.name);
            const { data: savedVisitor, error: nameError } = await nameUpdate.select("*").maybeSingle();
            if (nameError)
                return errorResponse(`Failed to save visitor name: ${nameError.message}`, 500);
            if (!savedVisitor)
                return errorResponse("Visitor changed. Refresh and retry.", 409);
            draft = savedVisitor;
        }
        const visitorData = draft as VisitorData;
        if (!cleanOtp) {
            const { error: updateError } = await supabaseAdmin.from("SSP_Non_Society_User")
                .update({ one_time_password: generateDateOtp() })
                .eq("non_society_user_id", visitorData.non_society_user_id)
                .eq("hosted_by", target.userId);
            if (updateError)
                return errorResponse(`Failed to store OTP: ${updateError.message}`);
        }
        if (!cleanOtp) {
            logger.info({
                level: "info",
                action: "visitor-otp",
                message: "OTP generated for new visitor",
                phoneNumber: cleanPhone,
                visitorId: visitorData.non_society_user_id,
                timestamp: new Date().toISOString(),
            });
            return successResponse({
                visitorId: visitorData.non_society_user_id,
                phoneNumber: visitorData.phone_number,
                name: hasVisitorName(visitorData.name) ? visitorData.name : null,
                visitorName: hasVisitorName(visitorData.name) ? visitorData.name : null,
                message: `OTP has been sent. Please verify OTP.`,
                otpVerified: false,
                isNewVisitor: true,
                nextStep: "VERIFY_OTP",
                requiresVisitorDetails: !hasVisitorName(visitorData.name),
            });
        }
        if (!validateOtp(cleanOtp)) {
            return errorResponse("Invalid OTP format. OTP must be 6 digits.");
        }
        const isOtpValid = !!visitorData.one_time_password && String(visitorData.one_time_password).trim() === String(cleanOtp).trim() && cleanOtp === generateDateOtp();
        if (!isOtpValid) {
            logger.warn({
                level: "warn",
                action: "visitor-otp",
                message: "Invalid OTP provided",
                phoneNumber: cleanPhone,
                timestamp: new Date().toISOString(),
            });
            return errorResponse("Invalid OTP provided. Please try again.");
        }
        const { data: consumed, error: clearError } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .update({
            one_time_password: null,
            is_otp_verified: true,
            ...(visitorData.visitor_status === "otp_pending" && hasVisitorName(visitorData.name) ? {
                visitor_status: "Pending", visitor_approval_status: "pending",
            } : {}),
        })
            .eq("non_society_user_id", visitorData.non_society_user_id)
            .eq("hosted_by", target.userId)
            .eq("one_time_password", cleanOtp)
            .select("non_society_user_id");
        if (clearError) {
            return errorResponse(`Failed to verify OTP: ${clearError.message}`, 500);
        }
        if (!consumed?.length)
            return errorResponse("OTP has already been used or the request changed. Request a new OTP.", 409);
        const response: VisitorOtpResponse = {
            visitorId: visitorData.non_society_user_id,
            phoneNumber: visitorData.phone_number,
            name: hasVisitorName(visitorData.name) ? visitorData.name : null,
            visitorName: hasVisitorName(visitorData.name) ? visitorData.name : null,
            message: "OTP verified successfully.",
            otpVerified: true,
            isNewVisitor: true,
            nextStep: "COMPLETED",
            requiresVisitorDetails: !hasVisitorName(visitorData.name),
        };
        logger.info({
            level: "info",
            action: "visitor-otp",
            userId: authCtx.user.id,
            visitorId: visitorData.non_society_user_id,
            phoneNumber: cleanPhone,
            targetResidentId: target.userId,
            otpVerified: true,
            duration: Date.now() - startTime,
            message: "Visitor OTP verified successfully",
            timestamp: new Date().toISOString(),
        });
        return successResponse(response);
    }
    catch (error: unknown) {
        if (error instanceof VisitorDraftError)
            return errorResponse(error.message, error.status);
        const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({
            level: "error",
            action: "visitor-otp",
            userId: authCtx?.user?.id || "unknown",
            message: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString(),
        });
        return errorResponse(errorMessage || "Failed to process OTP request.");
    }
}));
