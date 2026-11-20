// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// staff-complaint-workflow
// Actions: UPLOAD_IMAGE | FETCH_IMAGE | DELETE_IMAGE
//          START_OTP | VERIFY_START | END_OTP | VERIFY_END
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import {
    corsHeaders,
    errorResponse,
    successResponse,
} from "../_shared/response.ts";
import {
    generateId,
    getCurrentTimestamp,
    logger,
    sanitizeString,
} from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

type ActionType =
    | "UPLOAD_IMAGE"
    | "FETCH_IMAGE"
    | "DELETE_IMAGE"
    | "START_OTP"
    | "VERIFY_START"
    | "END_OTP"
    | "VERIFY_END";

type ImageType = "BEFORE" | "AFTER";

type StaffType = "SERVICE_AGENT" | "VENDOR";

interface FileInput {
    fileName: string;
    fileType: string;
    fileSize?: number | string;
    objectKey?: string;
}

interface StaffComplaintWorkflowRequest {
    action: ActionType;
    complaintId?: string;
    imageType?: ImageType;
    files?: FileInput[];
    isUploaded?: boolean | string;
    documentId?: string;
    otp?: string;
}

interface StaffContext {
    authUserId: string;
    staffId: string;
    staffType: StaffType;
    societyId: string;
    societyRegistrationNumber: string;
    name: string;
    phone: string;
}

interface ContextSuccess {
    ok: true;
    ctx: StaffContext;
}

interface ContextFailure {
    ok: false;
    code: string;
    message: string;
    status: number;
}

interface DocumentInfo {
    documentId: string;
    url: string | null;
    fileName: string | null;
    fileType: string | null;
    fileSize: number | null;
    uploadedAt: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const BUCKET_NAME = "society-documents";
const MAX_IMAGES_LIMIT = 5;
const SIGNED_URL_EXPIRY = 900;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_TTL_MINUTES = 10;

const VALID_ACTIONS: ActionType[] = [
    "UPLOAD_IMAGE",
    "FETCH_IMAGE",
    "DELETE_IMAGE",
    "START_OTP",
    "VERIFY_START",
    "END_OTP",
    "VERIFY_END",
];

const IMAGE_TYPE_TO_DOCUMENT_TYPE: Record<ImageType, string> = {
    BEFORE: "before_complaint_image",
    AFTER: "after_complaint_image",
};

const IMAGE_TYPE_PREFIX: Record<ImageType, string> = {
    BEFORE: "before_",
    AFTER: "after_",
};

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const IST_ISO_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
});

// ============================================
// HELPERS
// ============================================

function cleanText(v: unknown, max = 500): string {
    if (v === null || v === undefined) return "";
    return String(v).trim().slice(0, max);
}

function getISTISOString(): string {
    const parts = IST_ISO_FORMATTER.formatToParts(new Date());
    const map = new Map(parts.map((p) => [p.type, p.value]));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${
        map.get("hour")
    }:${map.get("minute")}:${map.get("second")}+05:30`;
}

/**
 * Generate a 6-digit date-based OTP (DDMMYY in IST).
 * Example: 2026-09-29 → "290926"
 */
function generateDateOtp(): string {
    const now = new Date();
    const ist = new Date(
        now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );
    const dd = String(ist.getDate()).padStart(2, "0");
    const mm = String(ist.getMonth() + 1).padStart(2, "0");
    const yy = String(ist.getFullYear()).slice(-2);
    return `${dd}${mm}${yy}`;
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
// AUTH — resolve staff context
// ============================================

async function getStaffContext(
    authUserId: string,
): Promise<ContextSuccess | ContextFailure> {
    // ─── Try as service_agent ───
    const { data: agentRow, error: agentErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
            user_id, society, role, deleted_at,
            contact:SSP_Contact!contact ( name, phone ),
            society_data:SSP_Society!society ( registration_number )
        `)
        .eq("user_id", authUserId)
        .maybeSingle();

    if (agentErr) {
        return {
            ok: false,
            code: "SERVER_ERROR",
            message: agentErr.message,
            status: 500,
        };
    }

    if (agentRow && !agentRow.deleted_at) {
        const roles = Array.isArray(agentRow.role)
            ? (agentRow.role as string[])
            : [];
        const normalized = roles.map((r) =>
            r.toLowerCase().replace(/[\s-]+/g, "_")
        );

        if (normalized.includes("service_agent")) {
            const contact = Array.isArray(agentRow.contact)
                ? (agentRow.contact[0] as
                    | { name?: string; phone?: string }
                    | undefined)
                : (agentRow.contact as
                    | { name?: string; phone?: string }
                    | null);

            const societyRel = Array.isArray(agentRow.society_data)
                ? agentRow.society_data[0]
                : agentRow.society_data;

            return {
                ok: true,
                ctx: {
                    authUserId,
                    staffId: String(agentRow.user_id),
                    staffType: "SERVICE_AGENT",
                    societyId: String(agentRow.society ?? ""),
                    societyRegistrationNumber:
                        (societyRel?.registration_number as string) ?? "",
                    name: contact?.name ?? "",
                    phone: contact?.phone ?? "",
                },
            };
        }
    }

    // ─── Try as vendor ───
    const { data: vendorRow, error: vendorErr } = await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select(`
            non_society_user_id, society, role, name, phone_number,
            society_data:SSP_Society!society ( registration_number )
        `)
        .eq("non_society_user_id", authUserId)
        .maybeSingle();

    if (vendorErr) {
        return {
            ok: false,
            code: "SERVER_ERROR",
            message: vendorErr.message,
            status: 500,
        };
    }

    if (vendorRow && (vendorRow.role ?? "").toLowerCase() === "vendor") {
        const societyRel = Array.isArray(vendorRow.society_data)
            ? vendorRow.society_data[0]
            : vendorRow.society_data;

        return {
            ok: true,
            ctx: {
                authUserId,
                staffId: String(vendorRow.non_society_user_id),
                staffType: "VENDOR",
                societyId: String(vendorRow.society ?? ""),
                societyRegistrationNumber:
                    (societyRel?.registration_number as string) ?? "",
                name: vendorRow.name ?? "",
                phone: vendorRow.phone_number ?? "",
            },
        };
    }

    return {
        ok: false,
        code: "FORBIDDEN",
        message: "Only Service Agents or Vendors can access this API.",
        status: 403,
    };
}

// ============================================
// AUTHORIZATION — verify staff is assigned
// ============================================

interface ComplaintRow {
    complaint_id: string;
    status: string | null;
    assigned_agent: string | null;
    non_society_user: string | null;
    start_otp: string | null;
    start_otp_verified_at: string | null;
    start_otp_generated_at: string | null;
    end_otp: string | null;
    end_otp_verified_at: string | null;
    end_otp_generated_at: string | null;
    society_user: string | null;
}

async function fetchAssignedComplaint(
    complaintId: string,
    ctx: StaffContext,
): Promise<
    | { ok: true; complaint: ComplaintRow }
    | { ok: false; code: string; message: string; status: number }
> {
    const { data, error } = await supabaseAdmin
        .from("SSP_Complaint")
        .select(`
            complaint_id, status, assigned_agent, non_society_user,
            start_otp, start_otp_verified_at, start_otp_generated_at,
            end_otp, end_otp_verified_at, end_otp_generated_at,
            society_user
        `)
        .eq("complaint_id", complaintId)
        .is("deleted_at", null)
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
            code: "NOT_FOUND",
            message: "Complaint not found.",
            status: 404,
        };
    }

    // Must be assigned to caller
    if (ctx.staffType === "SERVICE_AGENT") {
        if (data.assigned_agent !== ctx.staffId) {
            return {
                ok: false,
                code: "FORBIDDEN",
                message: "You are not assigned to this complaint.",
                status: 403,
            };
        }
    } else {
        if (data.non_society_user !== ctx.staffId) {
            return {
                ok: false,
                code: "FORBIDDEN",
                message: "You are not assigned to this complaint.",
                status: 403,
            };
        }
    }

    // Society guard
    const { data: residentRow } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("society")
        .eq("user_id", data.society_user ?? "")
        .maybeSingle();

    if (!residentRow || residentRow.society !== ctx.societyId) {
        return {
            ok: false,
            code: "FORBIDDEN",
            message: "Complaint does not belong to your society.",
            status: 403,
        };
    }

    return { ok: true, complaint: data as ComplaintRow };
}

// ============================================
// HANDLER — UPLOAD_IMAGE
// ============================================

async function handleUploadImage(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    const imageType = body.imageType;
    const files = body.files;

    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }
    if (imageType !== "BEFORE" && imageType !== "AFTER") {
        return buildError(
            req,
            "BAD_REQUEST",
            "imageType must be 'BEFORE' or 'AFTER'.",
            400,
        );
    }
    if (!Array.isArray(files) || files.length === 0) {
        return buildError(req, "BAD_REQUEST", "files array is required.", 400);
    }
    if (files.length > MAX_IMAGES_LIMIT) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Maximum ${MAX_IMAGES_LIMIT} images allowed.`,
            400,
        );
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const isUploadedValue = body.isUploaded === true ||
        body.isUploaded === "true";

    const documentType = IMAGE_TYPE_TO_DOCUMENT_TYPE[imageType];
    const prefix = IMAGE_TYPE_PREFIX[imageType];

    const pathPrefix = ctx.societyRegistrationNumber || ctx.societyId;

    // ─── Step 1: sign upload URLs ───
    if (!isUploadedValue) {
        const uploadUrls: Array<{
            fileName: string;
            fileUrl: string;
            objectKey: string;
        }> = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.fileName || !file.fileType) {
                return buildError(
                    req,
                    "BAD_REQUEST",
                    `File at index ${i} missing fileName or fileType.`,
                    400,
                );
            }

            const cleanFileName = file.fileName.replace(/\s+/g, "_");
            const objectKey =
                `${pathPrefix}/complaints/${complaintId}/${prefix}${Date.now()}_${i}_${cleanFileName}`;

            const { data: upload, error: signErr } = await supabaseAdmin.storage
                .from(BUCKET_NAME)
                .createSignedUploadUrl(objectKey, { upsert: true });

            if (signErr || !upload) {
                logger.error({
                    level: "error",
                    action: "staff-complaint-workflow.UPLOAD_IMAGE",
                    message:
                        `Sign failed for ${file.fileName}: ${signErr?.message}`,
                    timestamp: new Date().toISOString(),
                });
                return buildError(
                    req,
                    "SERVER_ERROR",
                    `Failed to generate upload URL for ${file.fileName}`,
                    500,
                );
            }

            uploadUrls.push({
                fileName: file.fileName,
                fileUrl: upload.signedUrl,
                objectKey,
            });
        }

        return buildSuccess(req, {
            uploaded: false,
            imageType,
            documentType,
            uploadUrls,
            documentIds: null,
        });
    }

    // ─── Step 2: confirm + insert document rows ───
    const insertedIds: string[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.objectKey || !file.fileName || !file.fileType) {
            return buildError(
                req,
                "BAD_REQUEST",
                `File at index ${i} missing objectKey, fileName, or fileType.`,
                400,
            );
        }

        const { data: urlInfo } = supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(file.objectKey);

        const documentPayload = {
            document_id: generateId(),
            name: file.fileName,
            file_name: file.fileName,
            file_type: file.fileType,
            file_size: file.fileSize ? parseFloat(String(file.fileSize)) : null,
            document_type: documentType,
            s3_path: urlInfo.publicUrl,
            society: ctx.societyId,
            complaint: complaintId,
            uploaded_by: ctx.staffId,
            uploaded_on: getCurrentTimestamp(),
            created_at: getCurrentTimestamp(),
        };

        const { data: inserted, error: insertErr } = await supabaseAdmin
            .from("SSP_Document")
            .insert(documentPayload)
            .select("document_id")
            .single();

        if (insertErr || !inserted) {
            logger.error({
                level: "error",
                action: "staff-complaint-workflow.UPLOAD_IMAGE",
                message:
                    `Insert failed for ${file.fileName}: ${insertErr?.message}`,
                timestamp: new Date().toISOString(),
            });
            return buildError(
                req,
                "SERVER_ERROR",
                `Failed to save document record for ${file.fileName}`,
                500,
            );
        }

        insertedIds.push(inserted.document_id);
    }

    return buildSuccess(req, {
        uploaded: true,
        imageType,
        documentType,
        uploadUrls: null,
        documentIds: insertedIds,
    });
}

// ============================================
// HANDLER — FETCH_IMAGE
// ============================================

async function handleFetchImage(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const { data: docs, error } = await supabaseAdmin
        .from("SSP_Document")
        .select(
            "document_id, name, file_type, file_size, s3_path, document_type, uploaded_on",
        )
        .eq("complaint", complaintId)
        .in("document_type", [
            "before_complaint_image",
            "after_complaint_image",
        ])
        .not("s3_path", "is", null)
        .order("uploaded_on", { ascending: true });

    if (error) {
        return buildError(req, "SERVER_ERROR", error.message, 500);
    }

    const before: DocumentInfo[] = [];
    const after: DocumentInfo[] = [];

    for (
        const doc of (docs ?? []) as Array<{
            document_id: string;
            name: string | null;
            file_type: string | null;
            file_size: number | null;
            s3_path: string | null;
            document_type: string | null;
            uploaded_on: string | null;
        }>
    ) {
        const key = extractStorageKey(doc.s3_path);
        let signedUrl: string | null = null;
        if (key) {
            const { data: signed } = await supabaseAdmin.storage
                .from(BUCKET_NAME)
                .createSignedUrl(key, SIGNED_URL_EXPIRY);
            signedUrl = signed?.signedUrl ?? null;
        }

        const info: DocumentInfo = {
            documentId: doc.document_id,
            url: signedUrl,
            fileName: doc.name,
            fileType: doc.file_type,
            fileSize: doc.file_size,
            uploadedAt: doc.uploaded_on,
        };

        if (doc.document_type === "before_complaint_image") before.push(info);
        else if (doc.document_type === "after_complaint_image") {
            after.push(info);
        }
    }

    return buildSuccess(req, {
        complaintId,
        images: { before, after },
        total: before.length + after.length,
    });
}

// ============================================
// HANDLER — DELETE_IMAGE
// ============================================

async function handleDeleteImage(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    const documentId = cleanText(body.documentId, 50);

    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }
    if (!documentId) {
        return buildError(req, "BAD_REQUEST", "documentId is mandatory.", 400);
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const { data: doc, error: findErr } = await supabaseAdmin
        .from("SSP_Document")
        .select("document_id, s3_path, document_type, uploaded_by")
        .eq("document_id", documentId)
        .eq("complaint", complaintId)
        .maybeSingle();

    if (findErr) return buildError(req, "SERVER_ERROR", findErr.message, 500);
    if (!doc) return buildError(req, "NOT_FOUND", "Document not found.", 404);

    if (
        doc.document_type !== "before_complaint_image" &&
        doc.document_type !== "after_complaint_image"
    ) {
        return buildError(
            req,
            "FORBIDDEN",
            "Only before/after complaint images can be deleted here.",
            403,
        );
    }

    const key = extractStorageKey(doc.s3_path);
    if (key) {
        const { error: storageErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .remove([key]);
        if (storageErr) {
            logger.warn({
                level: "warn",
                action: "staff-complaint-workflow.DELETE_IMAGE",
                message:
                    `Storage delete failed (continuing): ${storageErr.message}`,
                timestamp: new Date().toISOString(),
            });
        }
    }

    const { error: delErr } = await supabaseAdmin
        .from("SSP_Document")
        .delete()
        .eq("document_id", documentId);

    if (delErr) return buildError(req, "SERVER_ERROR", delErr.message, 500);

    return buildSuccess(req, {
        deleted: true,
        documentId,
        complaintId,
        message: "Image deleted successfully.",
    });
}

// ============================================
// OTP HELPERS
// ============================================

function isOtpExpired(generatedAt: string | null): boolean {
    if (!generatedAt) return true;
    const genMs = new Date(generatedAt).getTime();
    if (isNaN(genMs)) return true;
    return Date.now() - genMs > OTP_TTL_MS;
}

function isValidOtpFormat(otp: string): boolean {
    return /^[0-9]{6}$/.test(otp);
}

// ============================================
// HANDLER — START_OTP
// ============================================

async function handleStartOtp(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const c = auth.complaint;

    // ✅ FIX: Removed strict "status === 'assigned'" check. 
    // Only block if the complaint is already closed/resolved.
    const currentStatus = String(c.status).toLowerCase();
    if (["resolved", "cancelled", "rejected", "completed"].includes(currentStatus)) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Cannot start work on a complaint with status '${c.status}'.`,
            400,
        );
    }

    if (c.start_otp_verified_at) {
        return buildError(
            req,
            "BAD_REQUEST",
            "START OTP has already been verified.",
            400,
        );
    }

    if (
        c.start_otp && c.start_otp_generated_at &&
        !isOtpExpired(c.start_otp_generated_at)
    ) {
        return buildError(
            req,
            "CONFLICT",
            "START OTP already generated. Wait for it to expire (10 minutes) or use the existing OTP.",
            409,
        );
    }

    const otp = generateDateOtp();
    const now = new Date().toISOString();

    const { error: upErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .update({
            start_otp: otp,
            start_otp_generated_at: now,
        })
        .eq("complaint_id", complaintId);

    if (upErr) {
        return buildError(req, "SERVER_ERROR", "Failed to store OTP.", 500);
    }

    return buildSuccess(req, {
        complaintId,
        stage: "START",
        message:
            `START OTP has been generated and sent to the resident. It is valid for ${OTP_TTL_MINUTES} minutes. Ask the resident to share it with you, then verify it.`,
        otpVerified: false,
        nextStep: "VERIFY_START",
    });
}

// ============================================
// HANDLER — VERIFY_START
// ============================================

async function handleVerifyStart(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    const otp = cleanText(body.otp, 10);

    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }
    if (!otp) {
        return buildError(req, "BAD_REQUEST", "otp is mandatory.", 400);
    }
    if (!isValidOtpFormat(otp)) {
        return buildError(
            req,
            "BAD_REQUEST",
            "OTP must be a 6-digit number.",
            400,
        );
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const c = auth.complaint;

    // ✅ FIX: Removed strict "status === 'assigned'" check.
    const currentStatus = String(c.status).toLowerCase();
    if (["resolved", "cancelled", "rejected", "completed"].includes(currentStatus)) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Cannot verify START OTP for a complaint with status '${c.status}'.`,
            400,
        );
    }

    if (!c.start_otp) {
        return buildError(req, "BAD_REQUEST", "Request START OTP first.", 400);
    }
    if (c.start_otp_verified_at) {
        return buildError(
            req,
            "BAD_REQUEST",
            "START OTP already verified.",
            400,
        );
    }
    if (isOtpExpired(c.start_otp_generated_at)) {
        return buildError(
            req,
            "BAD_REQUEST",
            "START OTP has expired. Request a new one.",
            400,
        );
    }
    if (String(c.start_otp).trim() !== otp.trim()) {
        return buildError(
            req,
            "BAD_REQUEST",
            "Invalid OTP. Please try again.",
            400,
        );
    }

    const now = getCurrentTimestamp();

    // ✅ FIX: Removed .eq("status", "assigned") from the update query
    const { data: updated, error: upErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .update({
            status: "in_progress",
            start_otp_verified_at: now,
        })
        .eq("complaint_id", complaintId)
        .is("start_otp_verified_at", null)
        .select("complaint_id, status")
        .maybeSingle();

    if (upErr) {
        return buildError(
            req,
            "SERVER_ERROR",
            "Failed to update complaint.",
            500,
        );
    }
    if (!updated) {
        return buildError(
            req,
            "CONFLICT",
            "OTP already verified or state changed. Please refresh.",
            409,
        );
    }

    return buildSuccess(req, {
        complaintId,
        stage: "START",
        message: "Work started successfully.",
        otpVerified: true,
        status: "in_progress",
        nextStep: "REQUEST_END_OTP",
    });
}

// ============================================
// HANDLER — END_OTP
// ============================================

async function handleEndOtp(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const c = auth.complaint;

    // ✅ FIX: Removed strict "status === 'in_progress'" check.
    const currentStatus = String(c.status).toLowerCase();
    if (["resolved", "cancelled", "rejected", "completed"].includes(currentStatus)) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Cannot generate END OTP for a complaint with status '${c.status}'.`,
            400,
        );
    }

    if (c.end_otp_verified_at) {
        return buildError(
            req,
            "BAD_REQUEST",
            "END OTP already verified.",
            400,
        );
    }
    if (
        c.end_otp && c.end_otp_generated_at &&
        !isOtpExpired(c.end_otp_generated_at)
    ) {
        return buildError(
            req,
            "CONFLICT",
            "END OTP already generated. Wait for it to expire (10 minutes) or use the existing OTP.",
            409,
        );
    }

    const otp = generateDateOtp();
    const now = new Date().toISOString();

    const { error: upErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .update({
            end_otp: otp,
            end_otp_generated_at: now,
        })
        .eq("complaint_id", complaintId);

    if (upErr) {
        return buildError(req, "SERVER_ERROR", "Failed to store OTP.", 500);
    }

    return buildSuccess(req, {
        complaintId,
        stage: "END",
        message:
            `END OTP has been generated and sent to the resident. It is valid for ${OTP_TTL_MINUTES} minutes. Ask the resident to share it with you, then verify it.`,
        otpVerified: false,
        nextStep: "VERIFY_END",
    });
}

// ============================================
// HANDLER — VERIFY_END
// ============================================

async function handleVerifyEnd(
    req: Request,
    ctx: StaffContext,
    body: StaffComplaintWorkflowRequest,
): Promise<Response> {
    const complaintId = cleanText(body.complaintId, 50);
    const otp = cleanText(body.otp, 10);

    if (!complaintId) {
        return buildError(req, "BAD_REQUEST", "complaintId is mandatory.", 400);
    }
    if (!otp) {
        return buildError(req, "BAD_REQUEST", "otp is mandatory.", 400);
    }
    if (!isValidOtpFormat(otp)) {
        return buildError(
            req,
            "BAD_REQUEST",
            "OTP must be a 6-digit number.",
            400,
        );
    }

    const auth = await fetchAssignedComplaint(complaintId, ctx);
    if (!auth.ok) {
        return buildError(req, auth.code, auth.message, auth.status);
    }

    const c = auth.complaint;

    // ✅ FIX: Removed strict "status === 'in_progress'" check.
    const currentStatus = String(c.status).toLowerCase();
    if (["resolved", "cancelled", "rejected", "completed"].includes(currentStatus)) {
        return buildError(
            req,
            "BAD_REQUEST",
            `Cannot verify END OTP for a complaint with status '${c.status}'.`,
            400,
        );
    }

    if (!c.end_otp) {
        return buildError(req, "BAD_REQUEST", "Request END OTP first.", 400);
    }
    if (c.end_otp_verified_at) {
        return buildError(req, "BAD_REQUEST", "END OTP already verified.", 400);
    }
    if (isOtpExpired(c.end_otp_generated_at)) {
        return buildError(
            req,
            "BAD_REQUEST",
            "END OTP has expired. Request a new one.",
            400,
        );
    }
    if (String(c.end_otp).trim() !== otp.trim()) {
        return buildError(
            req,
            "BAD_REQUEST",
            "Invalid OTP. Please try again.",
            400,
        );
    }

    const now = getCurrentTimestamp();

    // ✅ FIX: Removed .eq("status", "in_progress") from the update query
    const { data: updated, error: upErr } = await supabaseAdmin
        .from("SSP_Complaint")
        .update({
            status: "resolved",
            end_otp_verified_at: now,
            completion_date_time: now,
        })
        .eq("complaint_id", complaintId)
        .is("end_otp_verified_at", null)
        .select("complaint_id, status")
        .maybeSingle();

    if (upErr) {
        return buildError(
            req,
            "SERVER_ERROR",
            "Failed to update complaint.",
            500,
        );
    }
    if (!updated) {
        return buildError(
            req,
            "CONFLICT",
            "OTP already verified or state changed. Please refresh.",
            409,
        );
    }

    return buildSuccess(req, {
        complaintId,
        stage: "END",
        message: "Work completed successfully.",
        otpVerified: true,
        status: "resolved",
        nextStep: "COMPLETED",
    });
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
        let action: ActionType = "FETCH_IMAGE";

        try {
            const body = await req.json().catch(() => null) as
                | StaffComplaintWorkflowRequest
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

            // Resolve staff context
            const ctxResult = await getStaffContext(authCtx.user.id);
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
                case "UPLOAD_IMAGE":
                    response = await handleUploadImage(
                        req,
                        ctxResult.ctx,
                        body,
                    );
                    break;
                case "FETCH_IMAGE":
                    response = await handleFetchImage(req, ctxResult.ctx, body);
                    break;
                case "DELETE_IMAGE":
                    response = await handleDeleteImage(
                        req,
                        ctxResult.ctx,
                        body,
                    );
                    break;
                case "START_OTP":
                    response = await handleStartOtp(req, ctxResult.ctx, body);
                    break;
                case "VERIFY_START":
                    response = await handleVerifyStart(
                        req,
                        ctxResult.ctx,
                        body,
                    );
                    break;
                case "END_OTP":
                    response = await handleEndOtp(req, ctxResult.ctx, body);
                    break;
                case "VERIFY_END":
                    response = await handleVerifyEnd(req, ctxResult.ctx, body);
                    break;
            }

            logger.info({
                level: "info",
                action: `staff-complaint-workflow.${action}`,
                userId: authCtx.user.id,
                staffType: ctxResult.ctx.staffType,
                actionMs: Date.now() - tAction,
                totalMs: Date.now() - t0,
                timestamp: new Date().toISOString(),
            });

            return response!;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Unknown error";
            logger.error({
                level: "error",
                action: `staff-complaint-workflow.${action}`,
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