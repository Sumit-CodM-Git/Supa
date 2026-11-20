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
const SIGNED_URL_EXPIRY = 900;
const MAX_LIMIT = 100;

const logger = createLogger("admin-payments-console");

const ENFORCE_STAFF_ROLE =
  (Deno.env.get("ENFORCE_STAFF_ROLE") ?? "true").toLowerCase() === "true";

const STAFF_ROLES = [
  "society_admin",
  "admin",
  "facility_manager",
  "facility_admin",
  "committee",
  "committee_member",
  "secretary",
  "manager",
  "treasurer",
  "accounts",
];

// ============================================
// TYPES
// ============================================
type ActionType = "FETCH_ALL" | "VERIFY_PAYMENT";

interface MergedRequest {
  actionType: ActionType;
  societyRegistrationNumber: string;

  // ---- FETCH_ALL ----
  paymentStatus?: string;
  paymentType?: string;
  searchText?: string;
  page?: number | string;
  limit?: number | string;

  // ---- VERIFY_PAYMENT ----
  paymentId?: string;
  action?: string;               // "VERIFY" | "REJECT"
  rejectionReason?: string;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

interface RawSocietyUserRow {
  user_id: string;
  unit_flat_number: string | null;
  contact?: { name: string | null } | { name: string | null }[] | null;
}

interface RawPaymentRow {
  pay_rec_id: string;
  amount: number | string | null;
  due_date: string | null;
  month_period: string | null;
  payment_date: string | null;
  payment_id: string | null;
  payment_method: string | null;
  payment_status: string | null;
  payment_type: string | null;
  receipt_information: string | null;
  receipt_url: string | null;
  transaction_id: string | null;
  rejection_reason: string | null;
  created_at: string | null;
  society_user?: {
    unit_flat_number: string | null;
    society: string;
    contact?: { name: string | null } | { name: string | null }[] | null;
  } | {
    unit_flat_number: string | null;
    society: string;
    contact?: { name: string | null } | { name: string | null }[] | null;
  }[] | null;
  SSP_Document?: 
    | { s3_path: string | null; file_name: string | null } 
    | { s3_path: string | null; file_name: string | null }[] 
    | null;
}

interface RawBookingRequest {
  request_id: string;
  requested_by: string | null;
  facility: string;
  payment: string;
  booking_start_date: string | null;
  booking_end_date: string | null;
  purpose_of_visit: string | null;
  is_all_day: boolean | null;
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

function isStaffRole(role: unknown): boolean {
  if (!role) return false;
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((r) => {
    if (typeof r !== "string") return false;
    return STAFF_ROLES.includes(r.toLowerCase().trim());
  });
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
        action: "admin_payments_console_start",
        userId,
        method: req.method,
        message: "Admin payments console request received",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      // ---- Content-type aware parsing (VERIFY_PAYMENT supports multipart) ----
      const contentType = req.headers.get("content-type") || "";
      const isMultipart = contentType.includes("multipart/form-data");

      let body: MergedRequest;
      // deno-lint-ignore no-explicit-any
      let uploadedFile: any = null;

      if (isMultipart) {
        let fd: FormData;
        try {
          fd = await req.formData();
        } catch {
          return errorResponse("Failed to parse multipart form data.", 400);
        }

        const actionTypeRaw = fd.get("actionType")?.toString();
        body = {
          actionType: (actionTypeRaw ?? "VERIFY_PAYMENT") as ActionType,
          societyRegistrationNumber: fd.get("societyRegistrationNumber")?.toString() ?? "",
          paymentId: fd.get("paymentId")?.toString(),
          action: fd.get("action")?.toString(),
          rejectionReason: fd.get("rejectionReason")?.toString(),
        };

        const fileEntry = fd.get("receiptImage");
        if (fileEntry && typeof fileEntry === "object" && "name" in fileEntry) {
          uploadedFile = fileEntry;
        }
      } else {
        const bodyText = await req.text().catch(() => "");
        if (!bodyText || bodyText.trim() === "") {
          return errorResponse("Request body is empty.", 400);
        }
        try {
          body = JSON.parse(bodyText) as MergedRequest;
        } catch {
          return errorResponse("Invalid JSON in request body.", 400);
        }
      }

      const { actionType, societyRegistrationNumber } = body;

      if (!actionType || String(actionType).trim() === "") {
        return errorResponse("actionType is mandatory.", 400);
      }
      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanAction = String(actionType).trim().toUpperCase() as ActionType;
      const ALLOWED: ActionType[] = ["FETCH_ALL", "VERIFY_PAYMENT"];
      if (!ALLOWED.includes(cleanAction)) {
        return errorResponse(
          `Invalid actionType: ${actionType}. Allowed: ${ALLOWED.join(", ")}.`,
          400,
        );
      }

      const cleanRegNum = String(societyRegistrationNumber).trim();

      // ---- Resolve society (case-insensitive) ----
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number")
        .ilike("registration_number", cleanRegNum)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          timestamp: new Date().toISOString(),
          action: "admin_payments_console_society_lookup_error",
          error: socErr.message,
        });
        return errorResponse("Failed to verify society context.", 500);
      }
      if (!society) {
        return errorResponse("No society registration found matching the identifier provided.", 404);
      }

      // ---- Membership + role gate ----
      const { data: membership } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, role")
        .eq("user_id", userId)
        .eq("society", society.society_id)
        .maybeSingle();

      if (!membership) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "admin_payments_console_membership_denied",
          userId,
          societyId: society.society_id,
        });
        return errorResponse("You are not a member of this society.", 403);
      }

      if (ENFORCE_STAFF_ROLE && !isStaffRole(membership.role)) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "admin_payments_console_role_denied",
          userId,
          societyId: society.society_id,
          roles: JSON.stringify(membership.role),
        });
        return errorResponse(
          "You don't have permission to manage society payments.",
          403,
        );
      }

      // =====================================================================
      // ACTION 1: FETCH_ALL
      // =====================================================================
      if (cleanAction === "FETCH_ALL") {
        const paymentStatus = body.paymentStatus ? String(body.paymentStatus).trim() : null;
        const paymentType = body.paymentType ? String(body.paymentType).trim() : null;
        const searchText = body.searchText ? String(body.searchText).trim() : null;

        const url = new URL(req.url);
        const pageStr = body.page ?? url.searchParams.get("page") ?? "1";
        const limitStr = body.limit ?? url.searchParams.get("limit") ?? "10";
        const pageNum = Math.max(1, parseInt(String(pageStr)) || 1);
        const limitNum = Math.min(
          MAX_LIMIT,
          Math.max(1, parseInt(String(limitStr)) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

        // ---- Build query ----
        // FIX SSP-0013: Join SSP_Document to find the image if receipt_url is null
        let query = supabaseAdmin
          .from("SSP_Payment")
          .select(
            `
            *,
            receipt_url,
            society_user:SSP_Society_User!inner(
              unit_flat_number,
              society,
              contact:SSP_Contact( name )
            ),
            SSP_Document ( s3_path, file_name )
          `,
            { count: "exact" },
          )
          .eq("society_user.society", society.society_id);

        if (paymentStatus && paymentStatus.toUpperCase() !== "ALL") {
          query = query.ilike("payment_status", `%${paymentStatus}%`);
        }

        if (paymentType && paymentType.toUpperCase() !== "ALL") {
          query = query.ilike("payment_type", `%${paymentType}%`);
        }

        if (searchText && searchText.trim() !== "") {
          const cleanSearch = searchText.trim();

          const { data: matchedUsers, error: matchedUsersError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select(`
              user_id,
              unit_flat_number,
              contact:SSP_Contact( name )
            `)
            .eq("society", society.society_id);

          if (matchedUsersError) throw new Error(`Society user search failed: ${matchedUsersError.message}`);

          const searchLower = cleanSearch.toLowerCase();
          const matchedUserIds = ((matchedUsers ?? []) as unknown as RawSocietyUserRow[])
            .filter((u) => {
              const flat = String(u.unit_flat_number ?? "").toLowerCase();
              const contact = firstOrNull(u.contact);
              const name = String(contact?.name ?? "").toLowerCase();
              return flat.includes(searchLower) || name.includes(searchLower);
            })
            .map((u) => u.user_id)
            .filter(Boolean);

          const { data: matchedPayments, error: matchedPaymentsError } = await supabaseAdmin
            .from("SSP_Payment")
            .select("payment_id")
            .ilike("payment_id", `%${cleanSearch}%`);

          if (matchedPaymentsError) throw new Error(`Payment search failed: ${matchedPaymentsError.message}`);

          const matchedPaymentIds = (matchedPayments ?? [])
            .map((p: { payment_id: string | null }) => p.payment_id)
            .filter((id): id is string => !!id);

          if (matchedUserIds.length > 0 && matchedPaymentIds.length > 0) {
            query = query.or(
              `society_user.in.(${matchedUserIds.join(",")}),payment_id.in.(${matchedPaymentIds.join(",")})`,
            );
          } else if (matchedUserIds.length > 0) {
            query = query.in("society_user", matchedUserIds);
          } else if (matchedPaymentIds.length > 0) {
            query = query.in("payment_id", matchedPaymentIds);
          } else {
            query = query.eq("payment_id", "__NO_MATCH__");
          }
        }

        query = query.order("created_at", { ascending: false }).range(offset, offset + limitNum - 1);

        const { data: paymentRecords, count: totalCount, error: paymentError } = await query;

        if (paymentError) throw new Error(`SSP_Payment processing lookup failed: ${paymentError.message}`);

        const rawRows = (paymentRecords ?? []) as unknown as RawPaymentRow[];

        // Sign receipt URLs in parallel
        // FIX SSP-0013: Look at receipt_url first, then fallback to SSP_Document
        const signedReceipts = await Promise.all(
          rawRows.map((p) => {
            if (p.receipt_url) return signOrPublic(p.receipt_url);
            
            const doc = firstOrNull(p.SSP_Document);
            if (doc?.s3_path) return signOrPublic(doc.s3_path);
            
            return "";
          }),
        );

        const formattedRecords = rawRows.map((p, idx) => {
          const societyUser = firstOrNull(p.society_user);
          const contact = firstOrNull(societyUser?.contact);
          const clickableImageUrl = signedReceipts[idx] || "N/A";

          return {
            paymentName: p.payment_id ?? "N/A",
            amount: p.amount != null ? String(p.amount) : "0",
            dueDate: p.due_date ? String(p.due_date) : null,
            monthPeriod: p.month_period ?? "N/A",
            paymentDate: p.payment_date ? String(p.payment_date) : null,
            paymentID: p.payment_id ?? "N/A",
            paymentMethod: p.payment_method ?? "N/A",
            paymentStatus: p.payment_status ?? "N/A",
            paymentType: p.payment_type ?? "N/A",
            receiptInfo: p.receipt_information ?? "N/A",
            transactionID: p.transaction_id ?? "N/A",
            residentName: contact?.name ?? "N/A",
            flatNumber: societyUser?.unit_flat_number ?? "N/A",
            imageUrl: clickableImageUrl,
            rejectionReason: p.rejection_reason ?? null,
          };
        });

        return successResponse(
          asPayload({
            payments: {
              payments: formattedRecords,
              pagination: {
                page: pageNum,
                limit: limitNum,
                totalRecords: totalCount ?? 0,
                totalPages: totalCount ? Math.ceil(totalCount / limitNum) : 0,
              },
            },
          }),
        );
      }

      // =====================================================================
      // ACTION 2: VERIFY_PAYMENT
      // =====================================================================
      if (cleanAction === "VERIFY_PAYMENT") {
        const validator = new Validator()
          .validateRequired(body.paymentId, "paymentId")
          .validateRequired(body.action, "action");

        if (!validator.isValid()) {
          return errorResponse("Missing mandatory fields: paymentId or action.", 400);
        }

        const cleanPaymentId = String(body.paymentId).trim();
        const targetAction = String(body.action).trim().toUpperCase();
        const rejectionReason = body.rejectionReason ? String(body.rejectionReason).trim() : "";

        if (targetAction !== "VERIFY" && targetAction !== "REJECT") {
          return errorResponse('Invalid action. Expected "VERIFY" or "REJECT".', 400);
        }

        if (targetAction === "REJECT" && !rejectionReason) {
          return errorResponse("rejectionReason is required when action is REJECT.", 400);
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let paymentQuery = supabaseAdmin
          .from("SSP_Payment")
          .select(`
            pay_rec_id,
            payment_id,
            society_user:SSP_Society_User!inner(society)
          `)
          .eq("society_user.society", society.society_id);

        if (uuidRegex.test(cleanPaymentId)) {
          paymentQuery = paymentQuery.eq("pay_rec_id", cleanPaymentId);
        } else {
          paymentQuery = paymentQuery.eq("payment_id", cleanPaymentId);
        }

        const { data: targetPayment, error: findError } = await paymentQuery.maybeSingle();

        if (findError) throw new Error(`Database lookup failed: ${findError.message}`);
        if (!targetPayment) return errorResponse("Payment record not found.", 404);

        let imageKey: string | null = null;
        if (uploadedFile && uploadedFile.name) {
          const fileExt = String(uploadedFile.name).split(".").pop() || "bin";
          
          // FIX SSP-0013: Change "Financial" to "financial"
          const filePath = `${society.registration_number}/financial/${Date.now()}_${
            targetPayment.payment_id || targetPayment.pay_rec_id
          }.${fileExt}`;

          const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(filePath, uploadedFile, { upsert: false });

          if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
          imageKey = filePath;
        }

        const updateData: Record<string, unknown> = {};
        if (targetAction === "VERIFY") {
          updateData.payment_status = "Paid";
          updateData.rejection_reason = null;
        } else {
          updateData.payment_status = "Rejected";
          updateData.rejection_reason = rejectionReason || null;
        }

        let returnUrl: string | null = null;
        if (imageKey) {
          updateData.receipt_url = imageKey;
          returnUrl = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/${BUCKET_NAME}/${imageKey}`;
        }

        const { error: updateError } = await supabaseAdmin
          .from("SSP_Payment")
          .update(updateData)
          .eq("pay_rec_id", targetPayment.pay_rec_id);

        if (updateError) throw new Error(`Update transaction failed: ${updateError.message}`);

        let confirmedBookingId: string | null = null;

        if (targetAction === "VERIFY") {
          const { data: bookingRequest, error: requestError } = await supabaseAdmin
            .from("SSP_Facility_Booking_Request")
            .select("*")
            .eq("payment", targetPayment.pay_rec_id)
            .maybeSingle();

          if (requestError) throw new Error(`Booking request lookup failed: ${requestError.message}`);

          if (bookingRequest) {
            const req = bookingRequest as unknown as RawBookingRequest;

            const { data: existingBookings, error: overlapError } = await supabaseAdmin
              .from("SSP_Facility_Booking")
              .select("name")
              .eq("facility", req.facility)
              .in("approval_status", ["approved", "pending", "requested"])
              .lt("booking_start_date", req.booking_end_date)
              .gt("booking_end_date", req.booking_start_date)
              .limit(1);

            if (overlapError) throw new Error(overlapError.message);

            if (existingBookings && existingBookings.length > 0) {
              await supabaseAdmin
                .from("SSP_Facility_Booking_Request")
                .update({ status: "FAILED_SLOT_ALREADY_BOOKED" })
                .eq("request_id", req.request_id);

              return errorResponse(
                "Payment has been verified but another resident already booked this slot. Please refund this payment.",
                409,
              );
            }

            const { data: newBooking, error: bookingError } = await supabaseAdmin
              .from("SSP_Facility_Booking")
              .insert({
                requested_by: req.requested_by,
                facility: req.facility,
                payment: req.payment,
                booking_start_date: req.booking_start_date,
                booking_end_date: req.booking_end_date,
                purpose_of_visit: req.purpose_of_visit,
                is_all_day: req.is_all_day ?? false,
                booking_status: "Approved",
                approval_status: "Approved",
                payment_status: "Paid",
              })
              .select("name")
              .single();

            if (bookingError) throw new Error(`Booking creation failed: ${bookingError.message}`);

            confirmedBookingId = newBooking?.name ?? null;

            const { error: requestUpdateError } = await supabaseAdmin
              .from("SSP_Facility_Booking_Request")
              .update({ status: "BOOKED" })
              .eq("request_id", req.request_id);

            if (requestUpdateError) throw new Error(requestUpdateError.message);
          }
        }

        return successResponse(
          asPayload({
            success: true,
            paymentStatus: updateData.payment_status,
            message:
              targetAction === "VERIFY"
                ? "Payment verified successfully. Facility booking has been created."
                : "Payment rejected successfully.",
            receipt_url: returnUrl,
            bookingId: confirmedBookingId,
          }),
        );
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "admin_payments_console_error",
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - startTime,
        message: "Admin payments console request failed",
      });

      return errorResponse(
        err.message || "Unable to process admin payments request.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);