import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import { Validator } from "../_shared/validation.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const BUCKET_NAME = "society-documents";
const DOCUMENT_TYPE_FINANCIAL = "financial";
const SIGNED_URL_EXPIRY = 900;
const MAX_LIMIT = 100;

const logger = createLogger("resident-payments-console");

// ============================================
// TYPES
// ============================================
type ActionType = "SUBMIT_PAYMENT" | "FETCH_OWN";

interface MergedRequest {
  actionType: ActionType;
  societyRegistrationNumber: string;

  // ---- SUBMIT_PAYMENT ----
  residentId?: string;       // legacy — ignored if it doesn't match JWT
  paymentId?: string;
  status?: string;           // also used as filter inside SUBMIT_PAYMENT
  fileName?: string;
  fileType?: string;
  fileSize?: number | string;
  page?: number | string;
  limit?: number | string;

  // ---- FETCH_OWN ----
  paymentType?: string;
  search?: string;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

interface RawPaymentRow {
  pay_rec_id: string;
  payment_id: string | null;
  amount: number | string | null;
  due_date: string | null;
  month_period: string | null;
  payment_date: string | null;
  payment_method: string | null;
  payment_status: string | null;
  payment_type: string | null;
  receipt_information: string | null;
  receipt_url: string | null;
  transaction_id: string | null;
  rejection_reason: string | null;
  created_at: string | null;
  facility?:
    | { id: string | number; name: string | null }
    | { id: string | number; name: string | null }[]
    | null;
}

interface RawLedgerRow {
  amount: number | string | null;
  payment_status: string | null;
}

// ============================================
// INIT
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================
// deno-lint-ignore no-explicit-any
function asPayload(obj: Record<string, unknown>): any {
  return obj;
}

function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
  return arr;
}

function extractStorageKey(path: string): string | null {
  if (!path) return null;
  const raw = path.trim();
  const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
  const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
  if (raw.includes(publicMarker)) return raw.split(publicMarker)[1].split("?")[0];
  if (raw.includes(signedMarker)) return raw.split(signedMarker)[1].split("?")[0];
  if (raw.includes(".amazonaws.com/")) return raw.split(".amazonaws.com/")[1].split("?")[0];
  return raw.split("?")[0];
}

function buildPublicUrl(s3Path: string | null): string {
  if (!s3Path) return "";
  const raw = s3Path.trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const clean = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/${BUCKET_NAME}/${clean}`;
}

async function signOrPublic(s3Path: string | null): Promise<string> {
  if (!s3Path) return "";
  const key = extractStorageKey(s3Path);
  if (!key) return buildPublicUrl(s3Path);
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUrl(key, SIGNED_URL_EXPIRY);
    if (error || !data?.signedUrl) return buildPublicUrl(s3Path);
    return data.signedUrl;
  } catch {
    return buildPublicUrl(s3Path);
  }
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request, authCtxFromParam?: AuthContext) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx =
      authCtxFromParam ?? (req as AuthenticatedRequest).authContext;

    if (!authCtx?.user?.id) {
      return errorResponse("Authentication context missing.", 401);
    }

    const userId = authCtx.user.id;
    const startTime = Date.now();

    try {
      logger.info({
        level: "info",
        timestamp: new Date().toISOString(),
        action: "resident_payments_console_start",
        userId,
        method: req.method,
        message: "Resident payments console request received",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => "");
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      let body: MergedRequest;
      try {
        body = JSON.parse(bodyText) as MergedRequest;
      } catch {
        return errorResponse("Invalid JSON in request body.", 400);
      }

      const { actionType, societyRegistrationNumber } = body;

      if (!actionType || String(actionType).trim() === "") {
        return errorResponse("actionType is mandatory.", 400);
      }
      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanAction = String(actionType).trim().toUpperCase() as ActionType;
      const ALLOWED: ActionType[] = ["SUBMIT_PAYMENT", "FETCH_OWN"];
      if (!ALLOWED.includes(cleanAction)) {
        return errorResponse(
          `Invalid actionType: ${actionType}. Allowed: ${ALLOWED.join(", ")}.`,
          400,
        );
      }

      const cleanRegNo = String(societyRegistrationNumber).trim();

      // ---- Resolve society (case-insensitive) ----
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, society_name, city, state, postal_code")
        .ilike("registration_number", cleanRegNo)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          timestamp: new Date().toISOString(),
          action: "resident_payments_console_society_lookup_error",
          error: socErr.message,
        });
        return errorResponse("Failed to verify society context.", 500);
      }
      if (!society) {
        return errorResponse("Target society environment reference not found.", 404);
      }

      // ---- Membership gate ----
      const { data: resident } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", userId)
        .eq("society", society.society_id)
        .maybeSingle();

      if (!resident) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "resident_payments_console_membership_denied",
          userId,
          societyId: society.society_id,
        });
        return errorResponse(
          "Authenticated user is not an active resident of this society.",
          403,
        );
      }

      // ---- Legacy residentId check (from make-resident-payment) ----
      if (body.residentId && String(body.residentId).trim() !== "") {
        if (String(body.residentId).trim() !== userId) {
          logger.warn({
            level: "warn",
            timestamp: new Date().toISOString(),
            action: "resident_payments_console_resident_id_mismatch",
            userId,
            suppliedResidentId: String(body.residentId).trim(),
          });
          return errorResponse(
            "residentId does not match the authenticated user.",
            403,
          );
        }
      }

      const targetResidentId = userId; // always JWT-derived

      // =====================================================================
      // ACTION 1: SUBMIT_PAYMENT
      // =====================================================================
      if (cleanAction === "SUBMIT_PAYMENT") {
        const validator = new Validator()
          .validateRequired(body.paymentId, "paymentId");

        if (!validator.isValid()) {
          return errorResponse(
            "paymentId is mandatory.",
            422,
            JSON.stringify(validator.getErrors()),
          );
        }

        const cleanPaymentId = String(body.paymentId).trim();
        const fileName = body.fileName ? String(body.fileName).trim() : null;
        const fileType = body.fileType ? String(body.fileType).trim() : null;
        const statusFilter = body.status ? String(body.status).trim() : null;

        const pageNum = Math.max(1, parseInt(String(body.page ?? 1)) || 1);
        const limitNum = Math.min(
          MAX_LIMIT,
          Math.max(1, parseInt(String(body.limit ?? 10)) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

        // ---- Lookup target payment ----
        let paymentQuery = supabaseAdmin
          .from("SSP_Payment")
          .select("pay_rec_id, payment_id, payment_status, amount", { count: "exact" })
          .eq("payment_id", cleanPaymentId)
          .eq("society_user", targetResidentId); // scoped to caller

        if (statusFilter) {
          paymentQuery = paymentQuery.ilike("payment_status", statusFilter);
        }

        paymentQuery = paymentQuery.range(offset, offset + limitNum - 1);

        const { data: paymentRecords, count: totalRecords, error: payError } =
          await paymentQuery;

        if (payError) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_payments_console_submit_lookup_error",
            error: payError.message,
          });
          throw new Error(`Target payment query failed: ${payError.message}`);
        }
        if (!paymentRecords || paymentRecords.length === 0) {
          return errorResponse(
            "Target payment record profile instance not found.",
            404,
          );
        }

        const currentPayment = paymentRecords[0];
        const statusVal = currentPayment.payment_status
          ? String(currentPayment.payment_status).trim().toUpperCase()
          : "";
        const paymentRecordUuid = currentPayment.pay_rec_id;

        const needsUnderReview =
          statusVal === "UNPAID" || statusVal === "REJECTED" || statusVal === "";

        if (needsUnderReview) {
          const { error: updateErr } = await supabaseAdmin
            .from("SSP_Payment")
            .update({ payment_status: "UNDER REVIEW" })
            .eq("pay_rec_id", paymentRecordUuid);

          if (updateErr) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_payments_console_submit_status_error",
              error: updateErr.message,
            });
            throw new Error(`Payment status update failed: ${updateErr.message}`);
          }
        }

        // ---- Optional receipt upload ----
        let uploadPresignedUrl: string | null = null;
        let documentUuid: string | null = null;

        if (fileName && fileType) {
          const cleanFileName = fileName.replace(/\s+/g, "_");
          const uniqueFileName = `${Date.now()}_${cleanFileName}`;
          
          // FIX SSP-0013: Change "Financial" to "financial"
          const targetObjectKey = `${cleanRegNo}/financial/${uniqueFileName}`;

          const { data: uploadPayload, error: storageLinkErr } =
            await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .createSignedUploadUrl(targetObjectKey);

          if (storageLinkErr) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_payments_console_submit_storage_error",
              error: storageLinkErr.message,
            });
            throw new Error(
              `Storage URL generation failed: ${storageLinkErr.message}`,
            );
          }

          uploadPresignedUrl = uploadPayload?.signedUrl ?? null;
          const fullS3Path = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/${BUCKET_NAME}/${targetObjectKey}`;

          const { data: newDoc, error: docInsertErr } = await supabaseAdmin
            .from("SSP_Document")
            .insert({
              name: fileName,
              file_name: uniqueFileName,
              file_type: fileType,
              file_size: body.fileSize ? parseFloat(String(body.fileSize)) : null,
              document_type: DOCUMENT_TYPE_FINANCIAL,
              s3_path: fullS3Path,
              payment: paymentRecordUuid,
              society: society.society_id,
              uploaded_by: targetResidentId,
              uploaded_on: new Date().toISOString(),
            })
            .select("document_id")
            .single();

          if (docInsertErr) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_payments_console_submit_doc_error",
              error: docInsertErr.message,
            });
            throw new Error(
              `Document record creation failed: ${docInsertErr.message}`,
            );
          }

          documentUuid = newDoc.document_id;

          // FIX SSP-0013: Update the payment record so the admin can see it
          await supabaseAdmin
            .from("SSP_Payment")
            .update({ receipt_url: fullS3Path })
            .eq("pay_rec_id", paymentRecordUuid);
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_payments_console_submit_end",
          userId,
          paymentRecordId: paymentRecordUuid,
          status: needsUnderReview ? "UNDER REVIEW" : statusVal,
          hasUpload: !!uploadPresignedUrl,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            paymentSubmission: {
              submitted: true,
              paymentRecordId: paymentRecordUuid,
              status: needsUnderReview ? "UNDER REVIEW" : statusVal,
            },
            uploadUrl: uploadPresignedUrl,
            documentId: documentUuid,
            pagination: {
              page: pageNum,
              limit: limitNum,
              retrievedRecords: paymentRecords.length,
              totalRecords: totalRecords ?? paymentRecords.length,
            },
          }),
        );
      }

      // =====================================================================
      // ACTION 2: FETCH_OWN
      // =====================================================================
      if (cleanAction === "FETCH_OWN") {
        const cleanStatus = body.status ? String(body.status).trim() : null;
        const cleanPaymentType = body.paymentType ? String(body.paymentType).trim() : null;
        const cleanSearch = body.search ? String(body.search).trim() : null;

        const pageNum = Math.max(1, parseInt(String(body.page ?? 1)) || 1);
        const limitNum = Math.min(
          MAX_LIMIT,
          Math.max(1, parseInt(String(body.limit ?? 10)) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

        // ---- Global totals ----
        const { data: allLedger, error: ledgerErr } = await supabaseAdmin
          .from("SSP_Payment")
          .select("amount, payment_status")
          .eq("society_user", targetResidentId);

        if (ledgerErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_payments_console_fetch_ledger_error",
            error: ledgerErr.message,
          });
          throw ledgerErr;
        }

        const rawLedger = (allLedger ?? []) as RawLedgerRow[];
        const totalDues = rawLedger.reduce((acc, p) => {
          const st = (p.payment_status ?? "").trim().toLowerCase();
          if (["pending", "due", "unpaid", "overdue"].includes(st)) {
            return acc + Number(p.amount ?? 0);
          }
          return acc;
        }, 0);

        const totalPaidAmount = rawLedger.reduce((acc, p) => {
          const st = (p.payment_status ?? "").trim().toLowerCase();
          if (["paid", "completed", "success"].includes(st)) {
            return acc + Number(p.amount ?? 0);
          }
          return acc;
        }, 0);

        // ---- Build filtered queries ----
        let countQuery = supabaseAdmin
          .from("SSP_Payment")
          .select("pay_rec_id", { count: "exact", head: true })
          .eq("society_user", targetResidentId);

        let dataQuery = supabaseAdmin
          .from("SSP_Payment")
          .select(`
            pay_rec_id,
            amount,
            due_date,
            month_period,
            payment_id,
            payment_status,
            payment_type,
            receipt_url,
            facility:SSP_Facility(id, name)
          `)
          .eq("society_user", targetResidentId);

        if (cleanStatus && cleanStatus !== "") {
          countQuery = countQuery.ilike("payment_status", cleanStatus);
          dataQuery = dataQuery.ilike("payment_status", cleanStatus);
        }

        if (cleanPaymentType && cleanPaymentType !== "") {
          countQuery = countQuery.ilike("payment_type", cleanPaymentType);
          dataQuery = dataQuery.ilike("payment_type", cleanPaymentType);
        }

        if (cleanSearch && cleanSearch !== "") {
          const searchTerm = `%${cleanSearch}%`;
          const searchFilter =
            `payment_id.ilike.${searchTerm},` +
            `payment_type.ilike.${searchTerm},` +
            `month_period.ilike.${searchTerm},` +
            `payment_status.ilike.${searchTerm}`;
          countQuery = countQuery.or(searchFilter);
          dataQuery = dataQuery.or(searchFilter);
        }

        const { count: filteredTotal, error: countErr } = await countQuery;
        if (countErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_payments_console_fetch_count_error",
            error: countErr.message,
          });
          throw countErr;
        }

        const { data: pendingList, error: paymentError } = await dataQuery
          .order("due_date", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (paymentError) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_payments_console_fetch_query_error",
            error: paymentError.message,
          });
          throw new Error(`Payments query failed: ${paymentError.message}`);
        }

        const rawPayments = (pendingList ?? []) as unknown as RawPaymentRow[];

        // ---- Sign receipt URLs ----
        const signedReceipts = await Promise.all(
          rawPayments.map((p) => signOrPublic(p.receipt_url)),
        );

        // ---- Map DTO ----
        const mappedPayments = rawPayments.map((p, idx) => {
          const facilityObj = firstOrNull(p.facility);
          const normalizedType = String(p.payment_type ?? "").trim().toLowerCase().replace(/_/g, " ");
          
          let descriptionText = "";

          if (normalizedType === "facility booking" && facilityObj) {
            const facName = facilityObj.name ? facilityObj.name : "Facility";
            descriptionText = `Booking for ${facName}`;
          } else {
            descriptionText = normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1);
          }

          return {
            customPaymentId: (p.pay_rec_id ?? "").trim(),
            paymentRecordName: (p.payment_id ?? "N/A").trim(),
            amount: p.amount ? Number(p.amount) : 0,
            dueDate: p.due_date ?? "",
            monthPeriod: (p.month_period ?? "").trim(),
            status: (p.payment_status ?? "").trim(),
            type: (p.payment_type ?? "").trim(), 
            description: descriptionText,        
            receiptUrl: signedReceipts[idx] || null,
            rejectionReason: p.rejection_reason ?? null,
            facilityName: facilityObj?.name ?? null,
          };
        });

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_payments_console_fetch_end",
          userId,
          returned: mappedPayments.length,
          total: filteredTotal ?? 0,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            totalDues,
            totalPaidAmount,
            pagination: {
              totalCount: filteredTotal || 0,
              currentPage: pageNum,
              limit: limitNum,
              totalPages: Math.ceil((filteredTotal || 0) / limitNum),
            },
            payments: mappedPayments,
          }),
        );
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "resident_payments_console_error",
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - startTime,
        message: "Resident payments console request failed",
      });

      return errorResponse(
        err.message || "Unable to process payment ledger request.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);