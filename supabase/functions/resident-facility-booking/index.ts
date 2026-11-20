import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";

const BUCKET_NAME = "society-documents";
const MAX_BOOKING_DAYS = 30;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

// FIX: Lowercase statuses to match Metadata
const BLOCKING_BOOKING_STATUSES = [
  "waiting_payment",
  "pending_verification",
  "approved",
  "requested",
] as const;

// ============================================
// TIMEZONE CONSTANTS & HELPERS (IST = UTC+05:30)
// ============================================
const IST_OFFSET_MINUTES = 5 * 60 + 30; // 330
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

function toIST(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function istMinutesOfDay(date: Date): number {
  const ist = toIST(date);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function timeStringToMinutes(t: string): number {
  const parts = String(t).split(":");
  const h = parseInt(parts[0] ?? "0", 10) || 0;
  const m = parseInt(parts[1] ?? "0", 10) || 0;
  return h * 60 + m;
}

/**
 * FIX: Handles the Flutter bug where local IST time is appended with 'Z' (UTC).
 * e.g. "2026-10-26T19:00:00.000Z" will be parsed as 19:00 IST (+05:30) instead of 00:30 IST next day.
 */
function parseClientTime(dateStr: string | undefined): Date {
  if (!dateStr) return new Date(NaN);
  let clean = dateStr.trim();

  if (clean.endsWith("Z")) {
    // Flutter sends 19:00Z for 7 PM IST. Force it to +05:30.
    clean = clean.replace("Z", "+05:30");
  } else if (!/[+-]\d{2}:?\d{2}$/.test(clean)) {
    // If no offset provided, assume IST
    clean += "+05:30";
  }
  
  return new Date(clean);
}

const baseLogger = createLogger("resident-facility-booking");
const logger = {
  info: (data: Record<string, unknown>) =>
    baseLogger.info({
      level: "info",
      timestamp: new Date().toISOString(),
      ...data,
    }),
  error: (data: Record<string, unknown>) =>
    baseLogger.error({
      level: "error",
      timestamp: new Date().toISOString(),
      ...data,
    }),
};

// ============================================
// TYPES
// ============================================
type BookingAction =
  | "list_facilities"
  | "get_blocked_slots" // ✅ ADDED FOR SSP-0109
  | "book"
  | "list_bookings"
  | "cancel_booking"
  | "abort_pending_booking";

interface BookingRequest {
  action?: BookingAction;
  societyRegistrationNumber: string;
  residentId?: string;
  facilityName?: string;
  bookingStartDateTime?: string;
  bookingEndDateTime?: string;
  isAllDay?: boolean | string;
  paymentMode?: string;
  purpose?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number | string;
  bookingRequestId?: string;
  page?: number | string;
  limit?: number | string;
  statusFilter?: string;
}

interface DBFacility {
  id: string;
  name: string;
  base_price: number | null;
  is_chargeable: boolean | null;
  description: string | null;
  facility_type: string | null;
  opening_time: string | null;
  closing_time: string | null;
  closed_days: string | null;
  on_maintenance: boolean;
  booking_mode: string | null;
  rules: string | null;
  maintenance_start: string | null;
  maintenance_end: string | null;
  maintenance_reason: string | null;
}

interface PriceBreakdown {
  units: number;
  unitLabel: string;
  baseAmount: number;
  total: number;
}

// ============================================
// SUPABASE CLIENT
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// PRICE CALCULATION
// ============================================
function countCalendarDays(start: Date, end: Date): number {
  const s = toIST(start);
  const e = toIST(end);
  const sDay = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const eDay = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  return Math.floor((eDay - sDay) / (1000 * 60 * 60 * 24)) + 1;
}

function calculateAmount(
  facility: DBFacility,
  reqStart: Date,
  reqEnd: Date,
  isAllDay: boolean,
): PriceBreakdown {
  const basePrice = Number(facility.base_price) || 0;
  const mode = (facility.booking_mode || "hourly").toLowerCase().trim();
  const durationMs = reqEnd.getTime() - reqStart.getTime();

  let units: number;
  let unitLabel: string;

  if (mode === "slot" || mode === "slot_based") {
    units = Math.max(1, Math.ceil(durationMs / (1000 * 60 * 60)));
    unitLabel = "slot";
  } else if (mode === "daily" || mode === "full_day" || mode === "full-day") {
    // ✅ If the facility is configured as DAILY, charge by days
    units = countCalendarDays(reqStart, reqEnd);
    unitLabel = "day";
  } else {
    // ✅ FIX FOR SSP-0112: If the facility is HOURLY, charge by operational hours per day
    const days = countCalendarDays(reqStart, reqEnd);

    if (days === 1) {
      // Single day booking: just calculate the exact hours
      units = Math.max(1, Math.ceil(durationMs / (1000 * 60 * 60)));
    } else {
      // Multi-day booking: Calculate hours per day based on facility timings
      const hasWindow = facility.opening_time && facility.closing_time;

      if (hasWindow) {
        const openMin = timeStringToMinutes(facility.opening_time!);
        const closeMin = timeStringToMinutes(facility.closing_time!);
        const hoursPerDay = (closeMin - openMin) / 60;
        units = days * hoursPerDay;
      } else {
        // If no open/close times configured, assume 24 hours a day
        units = days * 24;
      }
    }
    unitLabel = "hour";
  }

  const baseAmount = units * basePrice;
  return {
    units,
    unitLabel,
    baseAmount,
    total: baseAmount,
  };
}

// ============================================
// OTHER HELPERS
// ============================================
function normalizeIsAllDay(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

function safeFileName(name: string): string {
  return name
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\w.\-]/g, "_")
    .slice(0, 200);
}

function safeSocietySlug(reg: string): string {
  return reg.trim().replace(/[^\w\-]/g, "").slice(0, 64);
}

function checkIfClosedInDateRange(
  startDate: Date,
  endDate: Date,
  closedDaysStr: string | null,
): string | null {
  if (!closedDaysStr || closedDaysStr.trim() === "") return null;
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const daysList = closedDaysStr.split(",").map((d) => d.trim().toLowerCase());

  const startIST = toIST(startDate);
  const endIST = toIST(endDate);
  const cursorStart = Date.UTC(
    startIST.getUTCFullYear(),
    startIST.getUTCMonth(),
    startIST.getUTCDate(),
  );
  const cursorEnd = Date.UTC(
    endIST.getUTCFullYear(),
    endIST.getUTCMonth(),
    endIST.getUTCDate(),
  );

  for (let ms = cursorStart; ms <= cursorEnd; ms += 24 * 60 * 60 * 1000) {
    const d = new Date(ms);
    const dow = d.getUTCDay();
    const fullWeekday = days[dow].toLowerCase();
    const shortWeekday = fullWeekday.substring(0, 3);
    if (daysList.some((day) => day === fullWeekday || day === shortWeekday)) {
      return days[dow];
    }
  }
  return null;
}

function validateOpenHours(
  facility: DBFacility,
  reqStart: Date,
  reqEnd: Date,
): { ok: true } | { ok: false; message: string } {
  const openStr = facility.opening_time;
  const closeStr = facility.closing_time;

  if (!openStr || !closeStr) return { ok: true };

  const openMin = timeStringToMinutes(openStr);
  const closeMin = timeStringToMinutes(closeStr);

  if (closeMin <= openMin) {
    return {
      ok: false,
      message: `Facility '${facility.name}' has an invalid operating window configured. Please contact the society admin.`,
    };
  }

  const startMin = istMinutesOfDay(reqStart);
  const endMin = istMinutesOfDay(reqEnd);

  if (startMin < openMin) {
    return {
      ok: false,
      message:
        `Facility '${facility.name}' opens at ${openStr.slice(0, 5)} IST. ` +
        `Your start time is earlier than the opening time.`,
    };
  }
  if (startMin >= closeMin) {
    return {
      ok: false,
      message:
        `Facility '${facility.name}' closes at ${closeStr.slice(0, 5)} IST. ` +
        `Your start time is at or after the closing time.`,
    };
  }
  if (endMin > closeMin) {
    return {
      ok: false,
      message:
        `Facility '${facility.name}' closes at ${closeStr.slice(0, 5)} IST. ` +
        `Your end time is later than the closing time.`,
    };
  }

  return { ok: true };
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request, authCtx: AuthContext) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    const startTime = Date.now();

    try {
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => null);
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      let requestObj: BookingRequest;
      try {
        requestObj = JSON.parse(bodyText) as BookingRequest;
      } catch {
        return errorResponse("Malformed JSON body.", 400);
      }

      const {
        action,
        societyRegistrationNumber,
        residentId,
        facilityName,
        bookingStartDateTime,
        bookingEndDateTime,
        paymentMode,
        purpose,
        fileName,
        fileType,
        fileSize,
        bookingRequestId,
        page,
        limit,
        statusFilter,
      } = requestObj;

      const isAllDay = normalizeIsAllDay(requestObj.isAllDay);

      if (
        !societyRegistrationNumber ||
        societyRegistrationNumber.trim() === ""
      ) {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const resolvedAction: BookingAction =
        action ??
        (bookingRequestId
          ? "cancel_booking"
          : facilityName
          ? "book"
          : "list_facilities");

      // =====================================================================
      // WORKFLOW A: LIST AVAILABLE FACILITIES
      // =====================================================================
      if (resolvedAction === "list_facilities") {
        const { data: society, error: socErr } = await supabaseAdmin
          .from("SSP_Society")
          .select("society_id")
          .eq("registration_number", societyRegistrationNumber.trim())
          .maybeSingle();

        if (socErr || !society) {
          return errorResponse(
            "Society not found for the provided registration number.",
            404,
          );
        }

        const { data: facilityList, error: facListErr } = await supabaseAdmin
          .from("SSP_Facility")
          .select(`
            name, base_price, is_chargeable,
            description, facility_type, opening_time, closing_time, closed_days,
            on_maintenance, booking_mode, rules
          `)
          .eq("society", society.society_id);

        if (facListErr) {
          throw new Error(
            `Failed to retrieve facilities: ${facListErr.message}`,
          );
        }

        const availableFacilities = (facilityList || []).map(
          (f: Record<string, unknown>) => ({
            facilityName: f.name,
            basePrice: f.base_price ?? 0,
            isChargeable:
              f.is_chargeable ?? (Number(f.base_price) || 0) > 0,
            pricingType: f.booking_mode || "hourly",
            description: f.description || "",
            type: f.facility_type || "Not Specified",
            timings:
              f.opening_time && f.closing_time
                ? `${f.opening_time} to ${f.closing_time} (IST)`
                : "24/7 (Always Open)",
            closedDays: f.closed_days || "None",
            rules: f.rules || "",
            onMaintenance: f.on_maintenance ?? false,
          }),
        );

        return successResponse({
          action: "list_facilities",
          availableFacilities,
          facilityBooking: null,
          bookings: null,
          blockedSlots: null,
          uploadUrl: null,
          documentId: null,
          paymentId: null,
        });
      }

      // =====================================================================
      // ALL REMAINING WORKFLOWS REQUIRE AN AUTHENTICATED RESIDENT
      // =====================================================================
      if (!residentId || residentId.trim() === "") {
        return errorResponse("residentId is required.", 400);
      }

      if (!authCtx?.user?.id) {
        return errorResponse("Authentication context missing.", 401);
      }
      if (authCtx.user.id !== residentId.trim()) {
        logger.error({
          action: "resident_facility_booking_idor",
          callerId: authCtx.user.id,
          claimedId: residentId,
        });
        return errorResponse(
          "You can only manage bookings for your own account.",
          403,
        );
      }

      const { data: resident, error: resErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(
          `user_id, society, SSP_Society ( society_id, registration_number )`,
        )
        .eq("user_id", residentId.trim())
        .maybeSingle();

      if (resErr || !resident) {
        return errorResponse("Resident not found.", 404);
      }

      const resRecord = resident as Record<string, unknown>;
      const societyJoin = Array.isArray(resRecord.SSP_Society)
        ? (resRecord.SSP_Society[0] as Record<string, unknown> | undefined)
        : (resRecord.SSP_Society as Record<string, unknown> | undefined);

      const societyId = societyJoin?.society_id as string | undefined;
      const societyRegFromDB = String(societyJoin?.registration_number ?? "")
        .trim();
      const societyUserId = resRecord.user_id as string | undefined;

      if (!societyId || !societyUserId) {
        return errorResponse(
          "Resident or matching society affiliation not found.",
          404,
        );
      }

      if (
        societyRegFromDB &&
        societyRegFromDB.toLowerCase() !==
          societyRegistrationNumber.trim().toLowerCase()
      ) {
        return errorResponse(
          "Provided society does not match the resident's society.",
          403,
        );
      }

      // =====================================================================
      // WORKFLOW B: GET BLOCKED SLOTS (FOR UI DISABLING) - SSP-0109
      // =====================================================================
      if (resolvedAction === "get_blocked_slots") {
        if (!facilityName || !bookingStartDateTime) {
          return errorResponse("facilityName and bookingStartDateTime are required.", 400);
        }

        const reqStart = parseClientTime(bookingStartDateTime);
        if (isNaN(reqStart.getTime())) {
          return errorResponse("Invalid bookingStartDateTime.", 400);
        }

        const { data: facData } = await supabaseAdmin
          .from("SSP_Facility")
          .select("id")
          .eq("society", societyId)
          .ilike("name", facilityName.trim())
          .limit(1);

        if (!facData || facData.length === 0) {
          return errorResponse("Facility not found.", 404);
        }

        const facId = facData[0].id;
        
        // Fetch all blocking slots for the selected day (in IST)
        const startOfDay = new Date(reqStart);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(reqStart);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const { data: blocks, error: blockErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .select("booking_start_date, booking_end_date, is_all_day")
          .eq("facility", facId)
          .in("status", [...BLOCKING_BOOKING_STATUSES])
          .lt("booking_start_date", endOfDay.toISOString())
          .gt("booking_end_date", startOfDay.toISOString());

        if (blockErr) {
          throw new Error(`Failed to fetch blocked slots: ${blockErr.message}`);
        }

        return successResponse({
          action: "get_blocked_slots",
          blockedSlots: blocks ?? [],
          availableFacilities: null,
          facilityBooking: null,
          bookings: null,
          uploadUrl: null,
          documentId: null,
          paymentId: null,
        });
      }

      // =====================================================================
      // WORKFLOW C: LIST MY BOOKINGS
      // =====================================================================
      if (resolvedAction === "list_bookings") {
        const pageNum = Math.max(1, parseInt(String(page ?? 1), 10) || 1);
        const limitNum = Math.min(
          50,
          Math.max(1, parseInt(String(limit ?? 10), 10) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

        let listQ = supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .select(
            `
            request_id, status, booking_start_date, booking_end_date, is_all_day,
            purpose_of_visit, created_at,
            facility:facility ( id, name, booking_mode, base_price ),
            payment:payment ( pay_rec_id, payment_id, amount, payment_status, payment_method )
          `,
            { count: "exact" },
          )
          .eq("requested_by", societyUserId);

        if (statusFilter) {
          listQ = listQ.eq("status", String(statusFilter).trim().toLowerCase());
        }

        const { data: bookings, count, error: listErr } = await listQ
          .order("created_at", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (listErr) {
          throw new Error(`Failed to fetch bookings: ${listErr.message}`);
        }

        const items = (bookings ?? []).map((b: Record<string, unknown>) => {
          const fac = Array.isArray(b.facility) ? b.facility[0] : b.facility;
          const pay = Array.isArray(b.payment) ? b.payment[0] : b.payment;
          const payStatusRaw = String(
            (pay as Record<string, unknown> | null)?.payment_status ?? "",
          ).toLowerCase();
          const isPaymentPending =
            payStatusRaw === "unpaid" ||
            payStatusRaw === "pending" ||
            payStatusRaw === "waiting_payment";
            
          return {
            requestId: b.request_id,
            status: b.status,
            bookingStart: b.booking_start_date,
            bookingEnd: b.booking_end_date,
            isAllDay: b.is_all_day,
            purpose: b.purpose_of_visit,
            createdAt: b.created_at,
            facility: fac
              ? {
                  id: (fac as Record<string, unknown>).id,
                  name: (fac as Record<string, unknown>).name,
                  bookingMode: (fac as Record<string, unknown>).booking_mode,
                }
              : null,
            payment: pay
              ? {
                  payRecId: (pay as Record<string, unknown>).pay_rec_id,
                  paymentId: (pay as Record<string, unknown>).payment_id,
                  amount: (pay as Record<string, unknown>).amount,
                  status: (pay as Record<string, unknown>).payment_status,
                }
              : null,
            canCancel:
              isPaymentPending &&
              ["waiting_payment", "requested"].includes(
                String(b.status).toLowerCase(),
              ),
          };
        });

        const total = count ?? items.length;
        return successResponse({
          action: "list_bookings",
          bookings: items,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
          availableFacilities: null,
          blockedSlots: null,
          facilityBooking: null,
          uploadUrl: null,
          documentId: null,
          paymentId: null,
        });
      }

      // =====================================================================
      // WORKFLOW D: CANCEL BOOKING (SSP-0111 FIXED)
      // =====================================================================
      if (resolvedAction === "cancel_booking") {
        if (!bookingRequestId || bookingRequestId.trim() === "") {
          return errorResponse(
            "bookingRequestId is required to cancel a booking.",
            400,
          );
        }

        const { data: booking, error: bErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .select(
            `request_id, status, requested_by, payment:payment ( pay_rec_id, payment_status )`,
          )
          .eq("request_id", bookingRequestId.trim())
          .eq("requested_by", societyUserId)
          .maybeSingle();

        if (bErr) throw new Error(`Booking lookup failed: ${bErr.message}`);
        if (!booking) {
          return errorResponse(
            "Booking not found or does not belong to you.",
            404,
          );
        }

        const bRec = booking as Record<string, unknown>;
        const currentStatus = String(bRec.status ?? "").toLowerCase();
        const payRow = Array.isArray(bRec.payment)
          ? bRec.payment[0]
          : bRec.payment;
        const payRecId = (payRow as Record<string, unknown> | null)
          ?.pay_rec_id as string | undefined;
        const payStatus = String(
          (payRow as Record<string, unknown> | null)?.payment_status ?? "",
        ).toLowerCase();

        if (currentStatus === "cancelled") {
          return errorResponse(
            "This booking has already been cancelled.",
            409,
          );
        }

        const paymentPending =
          payStatus === "unpaid" ||
          payStatus === "pending" ||
          payStatus === "waiting_payment";

        // ✅ FIX FOR SSP-0111: If unpaid, hard-delete the record so the slot is freed immediately.
        // Otherwise, the DB exclusion constraint will permanently block that slot.
        if (paymentPending) {
          if (payRecId) {
            await supabaseAdmin.from("SSP_Document").delete().eq("payment", payRecId);
          }
          await supabaseAdmin
            .from("SSP_Facility_Booking_Request")
            .delete()
            .eq("request_id", bookingRequestId.trim());
            
          if (payRecId) {
            await supabaseAdmin
              .from("SSP_Payment")
              .delete()
              .eq("pay_rec_id", payRecId);
          }

          logger.info({
            action: "resident_facility_booking_cancel_hard_delete",
            requestId: bookingRequestId,
          });

          return successResponse({
            action: "cancel_booking",
            facilityBooking: {
              requestId: bookingRequestId,
              status: "cancelled",
              message: "Your unpaid booking has been cancelled and the slot is now free.",
            },
            availableFacilities: null,
            bookings: null,
            blockedSlots: null,
            uploadUrl: null,
            documentId: null,
            paymentId: null,
          });
        }

        // If already paid, just mark as cancelled for admin audit
        const { error: cancelErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .update({ status: "cancelled" })
          .eq("request_id", bookingRequestId.trim());
        if (cancelErr) {
          throw new Error(`Failed to cancel booking: ${cancelErr.message}`);
        }

        if (payRecId) {
          await supabaseAdmin
            .from("SSP_Payment")
            .update({ payment_status: "cancelled" })
            .eq("pay_rec_id", payRecId);
        }

        logger.info({
          action: "resident_facility_booking_cancel_soft",
          requestId: bookingRequestId,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          action: "cancel_booking",
          facilityBooking: {
            requestId: bookingRequestId,
            status: "cancelled",
            message: "Your facility booking has been cancelled successfully. Please contact admin for refunds if already paid.",
          },
          availableFacilities: null,
          bookings: null,
          blockedSlots: null,
          uploadUrl: null,
          documentId: null,
          paymentId: null,
        });
      }

      // =====================================================================
      // WORKFLOW E: ABORT PENDING BOOKING (hard-rollback before payment)
      // =====================================================================
      if (resolvedAction === "abort_pending_booking") {
        if (!bookingRequestId || bookingRequestId.trim() === "") {
          return errorResponse(
            "bookingRequestId is required to abort a pending booking.",
            400,
          );
        }

        const cleanBookingId = bookingRequestId.trim();

        const { data: booking, error: bErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .select(
            `request_id, status, requested_by,
             payment:payment ( pay_rec_id, payment_status, payment_id )`,
          )
          .eq("request_id", cleanBookingId)
          .eq("requested_by", societyUserId)
          .maybeSingle();

        if (bErr) throw new Error(`Booking lookup failed: ${bErr.message}`);
        if (!booking) {
          return errorResponse(
            "Booking not found or does not belong to you.",
            404,
          );
        }

        const bRec = booking as Record<string, unknown>;
        const currentStatus = String(bRec.status ?? "").toLowerCase();
        const payRow = Array.isArray(bRec.payment)
          ? bRec.payment[0]
          : bRec.payment;
        const payRecId = (payRow as Record<string, unknown> | null)
          ?.pay_rec_id as string | undefined;
        const payStatus = String(
          (payRow as Record<string, unknown> | null)?.payment_status ?? "",
        ).toLowerCase();

        const paymentPending =
          payStatus === "unpaid" ||
          payStatus === "pending" ||
          payStatus === "waiting_payment";

        if (!paymentPending) {
          return errorResponse(
            "This booking can no longer be aborted because payment has already been made or is being processed.",
            409,
          );
        }

        const abortableStatuses = [
          "waiting_payment",
          "requested",
          "pending_verification",
        ];
        if (!abortableStatuses.includes(currentStatus)) {
          return errorResponse(
            `This booking cannot be aborted from its current status '${currentStatus}'.`,
            409,
          );
        }

        if (payRecId) {
          await supabaseAdmin.from("SSP_Document").delete().eq("payment", payRecId);
        }

        const { error: delBookingErr } = await supabaseAdmin
          .from("SSP_Facility_Booking_Request")
          .delete()
          .eq("request_id", cleanBookingId);
        if (delBookingErr) {
          throw new Error(
            `Failed to abort booking: ${delBookingErr.message}`,
          );
        }

        if (payRecId) {
          await supabaseAdmin
            .from("SSP_Payment")
            .delete()
            .eq("pay_rec_id", payRecId);
        }

        logger.info({
          action: "resident_facility_booking_abort_success",
          requestId: cleanBookingId,
          paymentId: payRecId ?? null,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          action: "abort_pending_booking",
          facilityBooking: {
            requestId: cleanBookingId,
            aborted: true,
            partial: false,
            message:
              "Booking aborted and removed. You can book again anytime.",
          },
          availableFacilities: null,
          bookings: null,
          blockedSlots: null,
          uploadUrl: null,
          documentId: null,
          paymentId: null,
        });
      }

      // =====================================================================
      // WORKFLOW F: CREATE BOOKING
      // =====================================================================
      if (!facilityName || facilityName.trim() === "") {
        return errorResponse(
          "facilityName is required to book a facility.",
          400,
        );
      }
      if (!bookingStartDateTime || !bookingEndDateTime) {
        return errorResponse(
          "bookingStartDateTime and bookingEndDateTime are required for booking.",
          400,
        );
      }

      const reqStart = parseClientTime(bookingStartDateTime);
      const reqEnd = parseClientTime(bookingEndDateTime);

      if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime())) {
        return errorResponse(
          "Invalid booking start or end date-time range.",
          400,
        );
      }

      const now = new Date();
      const PAST_GRACE_MS = 60 * 1000;
      if (reqStart.getTime() < now.getTime() - PAST_GRACE_MS) {
        return errorResponse(
          "Booking start time is in the past. You can only book current or future time slots.",
          400,
        );
      }

      let { data: facilityData, error: facErr } = await supabaseAdmin
        .from("SSP_Facility")
        .select(`
          id, name, base_price, is_chargeable,
          booking_mode, closed_days, opening_time, closing_time,
          on_maintenance, maintenance_start, maintenance_end, maintenance_reason
        `)
        .ilike("name", facilityName.trim())
        .eq("society", societyId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (facErr) {
        throw new Error(`Error looking up facility: ${facErr.message}`);
      }

      if (!facilityData || facilityData.length === 0) {
        const { data: typeData, error: typeErr } = await supabaseAdmin
          .from("SSP_Facility")
          .select(`
            id, name, base_price, is_chargeable,
            booking_mode, closed_days, opening_time, closing_time,
            on_maintenance, maintenance_start, maintenance_end, maintenance_reason
          `)
          .ilike("facility_type", facilityName.trim())
          .eq("society", societyId)
          .order("created_at", { ascending: true })
          .limit(1);
        if (typeErr) {
          throw new Error(
            `Error looking up facility by type: ${typeErr.message}`,
          );
        }
        facilityData = typeData;
      }

      if (!facilityData || facilityData.length === 0) {
        return errorResponse("Facility not found for this society.", 404);
      }

      const targetFacility = facilityData[0] as DBFacility;

      // ------------------------------------------------------------------
      // NORMALIZE isAllDay USING IST + FACILITY OPEN WINDOW
      // ------------------------------------------------------------------
      if (isAllDay) {
        const startIST = toIST(reqStart);
        const endIST = toIST(reqEnd);
        const sy = startIST.getUTCFullYear();
        const sm = startIST.getUTCMonth();
        const sd = startIST.getUTCDate();
        const ey = endIST.getUTCFullYear();
        const em = endIST.getUTCMonth();
        const ed = endIST.getUTCDate();

        const hasWindow =
          targetFacility.opening_time && targetFacility.closing_time;
        const openMin = hasWindow
          ? timeStringToMinutes(String(targetFacility.opening_time))
          : 0;
        const closeMin = hasWindow
          ? timeStringToMinutes(String(targetFacility.closing_time))
          : 24 * 60;
        const validWindow = hasWindow && closeMin > openMin;

        // ✅ FIX FOR SSP-0112: Calculate START on start-date, END on end-date
        if (validWindow) {
          const startDayUTC = Date.UTC(sy, sm, sd, 0, 0, 0, 0) - IST_OFFSET_MS;
          const endDayUTC = Date.UTC(ey, em, ed, 0, 0, 0, 0) - IST_OFFSET_MS;
          reqStart.setTime(startDayUTC + openMin * 60 * 1000);
          reqEnd.setTime(endDayUTC + closeMin * 60 * 1000 - 1); 
        } else {
          const startDayUTC = Date.UTC(sy, sm, sd, 0, 0, 0, 0) - IST_OFFSET_MS;
          const endDayUTC = Date.UTC(ey, em, ed, 23, 59, 59, 999) - IST_OFFSET_MS;
          reqStart.setTime(startDayUTC);
          reqEnd.setTime(endDayUTC);
        }
      }

      if (reqStart >= reqEnd) {
        return errorResponse(
          "Booking start date-time must be earlier than end date-time.",
          400,
        );
      }

      const durationInDays =
        (reqEnd.getTime() - reqStart.getTime()) / (1000 * 60 * 60 * 24);
      if (durationInDays > MAX_BOOKING_DAYS) {
        return errorResponse(
          `A single booking cannot exceed ${MAX_BOOKING_DAYS} days.`,
          400,
        );
      }

      const closedDayMatch = checkIfClosedInDateRange(
        reqStart,
        reqEnd,
        targetFacility.closed_days,
      );
      if (closedDayMatch) {
        return errorResponse(
          `Facility '${targetFacility.name}' is closed on ${closedDayMatch}s during your selected date range.`,
          400,
        );
      }

      if (targetFacility.on_maintenance) {
        const maintStart = targetFacility.maintenance_start
          ? new Date(targetFacility.maintenance_start)
          : null;
        const maintEnd = targetFacility.maintenance_end
          ? new Date(targetFacility.maintenance_end)
          : null;
        if (
          !maintStart ||
          !maintEnd ||
          (reqStart < maintEnd && reqEnd > maintStart)
        ) {
          const reasonStr = targetFacility.maintenance_reason
            ? ` Reason: ${targetFacility.maintenance_reason}`
            : "";
          return errorResponse(
            `Facility '${targetFacility.name}' is currently under maintenance.${reasonStr}`,
            400,
          );
        }
      }

      const hoursCheck = validateOpenHours(targetFacility, reqStart, reqEnd);
      if (!hoursCheck.ok) {
        return errorResponse(hoursCheck.message, 400);
      }

      // ------------------------------------------------------------------
      // 🧹 CLEANUP STALE BOOKINGS (Abandoned Carts)
      // Unpaid bookings older than 5 minutes are deleted to free the slot
      // ------------------------------------------------------------------
      const EXPIRATION_MINUTES = 5;
      const expirationTime = new Date(Date.now() - EXPIRATION_MINUTES * 60 * 1000).toISOString();

      const { data: expiredReqs } = await supabaseAdmin
        .from("SSP_Facility_Booking_Request")
        .select("request_id, payment")
        .eq("facility", targetFacility.id)
        .eq("status", "waiting_payment")
        .lt("created_at", expirationTime);

      if (expiredReqs && expiredReqs.length > 0) {
        const expiredPayIds = expiredReqs.map(r => r.payment).filter(Boolean) as string[];
        const expiredReqIds = expiredReqs.map(r => r.request_id);

        // Delete linked documents and payments first
        if (expiredPayIds.length > 0) {
          await supabaseAdmin.from("SSP_Document").delete().in("payment", expiredPayIds);
          await supabaseAdmin.from("SSP_Payment").delete().in("pay_rec_id", expiredPayIds);
        }
        // Delete the booking requests
        await supabaseAdmin.from("SSP_Facility_Booking_Request").delete().in("request_id", expiredReqIds);
        
        logger.info({
          action: "resident_facility_booking_expired_cleanup",
          facilityId: targetFacility.id,
          deletedCount: expiredReqIds.length,
          expirationMinutes: EXPIRATION_MINUTES
        });
      }

      // ------------------------------------------------------------------
      // OVERLAP CHECK
      // ------------------------------------------------------------------
      const { data: existingRequests, error: overlapErr } = await supabaseAdmin
        .from("SSP_Facility_Booking_Request")
        .select(
          "request_id, status, booking_start_date, booking_end_date, is_all_day",
        )
        .eq("facility", targetFacility.id)
        .in("status", [...BLOCKING_BOOKING_STATUSES])
        .lt("booking_start_date", reqEnd.toISOString())
        .gt("booking_end_date", reqStart.toISOString())
        .limit(1);

      if (overlapErr) {
        throw new Error(
          `Failed checking existing bookings: ${overlapErr.message}`,
        );
      }
      if (existingRequests && existingRequests.length > 0) {
        const conflicting = existingRequests[0] as Record<string, unknown>;
        const clashMsg = conflicting.is_all_day
          ? `Facility '${targetFacility.name}' is booked for the entire day on the selected date.`
          : `Facility '${targetFacility.name}' is already booked for part of the selected time range.`;
        return errorResponse(
          `${clashMsg} Please choose a different slot.`,
          409,
        );
      }

      logger.info({
        action: "resident_facility_booking_pricing_debug",
        facilityId: targetFacility.id,
        facilityName: targetFacility.name,
        bookingMode: targetFacility.booking_mode,
        basePrice: targetFacility.base_price,
        reqStart: reqStart.toISOString(),
        reqEnd: reqEnd.toISOString(),
        isAllDay,
        durationDays: countCalendarDays(reqStart, reqEnd),
      });

      const price = calculateAmount(targetFacility, reqStart, reqEnd, isAllDay);

      logger.info({
        action: "resident_facility_booking_pricing_result",
        units: price.units,
        unitLabel: price.unitLabel,
        baseAmount: price.baseAmount,
        total: price.total,
      });

      if (!Number.isFinite(price.total)) {
        throw new Error("Computed booking amount is not a valid number.");
      }

      const paymentId = `PAY-${Date.now()}-${crypto
        .randomUUID()
        .slice(0, 8)
        .toUpperCase()}`;

      const { data: payment, error: payErr } = await supabaseAdmin
        .from("SSP_Payment")
        .insert({
          amount: price.total,
          payment_method: paymentMode || "PENDING",
          payment_status: "unpaid",
          payment_type: "facility_booking",
          society_user: societyUserId,
          facility: targetFacility.id,
          payment_date: new Date().toISOString(),
          payment_id: paymentId,
        })
        .select("pay_rec_id, payment_id, amount")
        .single();

      if (payErr || !payment) {
        throw new Error(
          `Payment record creation failed: ${payErr?.message ?? "unknown"}`,
        );
      }

      if (!payment.payment_id) {
        logger.error({
          action: "resident_facility_booking_missing_payment_id",
          message: "DB returned null for payment.payment_id, using fallback.",
          payRecId: payment.pay_rec_id,
          fallbackId: paymentId,
        });
      }
      const finalPaymentId = payment.payment_id || paymentId;

      const { data: bookingReq, error: requestErr } = await supabaseAdmin
        .from("SSP_Facility_Booking_Request")
        .insert({
          requested_by: societyUserId,
          facility: targetFacility.id,
          payment: payment.pay_rec_id,
          booking_start_date: reqStart.toISOString(),
          booking_end_date: reqEnd.toISOString(),
          purpose_of_visit: purpose ?? null,
          is_all_day: isAllDay,
          status: "waiting_payment",
        })
        .select("request_id")
        .single();

      if (requestErr || !bookingReq) {
        await supabaseAdmin
          .from("SSP_Payment")
          .delete()
          .eq("pay_rec_id", payment.pay_rec_id);

        const msg = String(requestErr?.message ?? "");
        const isOverlap =
          (requestErr as { code?: string } | null)?.code === "23P01" ||
          msg.includes("no_overlapping_bookings") ||
          msg.toLowerCase().includes("exclusion constraint");
        if (isOverlap) {
          return errorResponse(
            `Facility '${targetFacility.name}' was just booked for part of that time range. Please choose another slot.`,
            409,
          );
        }
        throw new Error(`Booking request creation failed: ${msg || "unknown"}`);
      }

      let uploadUrl: string | null = null;
      let documentId: string | null = null;

      if (fileName && fileType) {
        if (fileSize && Number(fileSize) > MAX_FILE_SIZE_BYTES) {
          logger.info({
            action: "resident_facility_booking_file_too_large",
            fileSize,
          });
        } else if (!ALLOWED_MIME.has(fileType)) {
          logger.info({
            action: "resident_facility_booking_mime_rejected",
            fileType,
          });
        } else {
          const cleanName = safeFileName(fileName);
          const objectKey = `${safeSocietySlug(
            societyRegistrationNumber,
          )}/Financial/${Date.now()}_${cleanName}`;

          const { data: uploadUrlData, error: storageErr } = await supabaseAdmin
            .storage.from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey, { upsert: false });

          if (storageErr || !uploadUrlData) {
            logger.error({
              action: "resident_facility_booking_storage_error",
              message: storageErr?.message ?? "unknown",
            });
          } else {
            const { data: doc, error: docErr } = await supabaseAdmin
              .from("SSP_Document")
              .insert({
                name: fileName,
                file_name: fileName,
                file_type: fileType,
                file_size: fileSize ? parseFloat(String(fileSize)) : null,
                document_type: "Financial",
                s3_path: objectKey,
                society: societyId,
                payment: payment.pay_rec_id,
                uploaded_on: new Date().toISOString(),
              })
              .select("document_id")
              .single();

            if (docErr || !doc) {
              logger.error({
                action: "resident_facility_booking_document_error",
                message: docErr?.message ?? "unknown",
              });
              uploadUrl = uploadUrlData.signedUrl;
            } else {
              uploadUrl = uploadUrlData.signedUrl;
              documentId = doc.document_id;
            }
          }
        }
      }

      logger.info({
        action: "resident_facility_booking_book_success",
        requestId: bookingReq.request_id,
        paymentId: payment.payment_id,
        amount: price.total,
        isAllDay,
        durationMs: Date.now() - startTime,
      });

      return successResponse({
        action: "book",
        facilityBooking: {
          requestId: bookingReq.request_id,
          payRecId: payment.pay_rec_id,
          paymentId: finalPaymentId,
          amount: payment.amount,
          status: "waiting_payment",
          isAllDay,
          pricingBreakdown: {
            units: price.units,
            unitLabel: price.unitLabel,
            baseAmount: price.baseAmount,
            total: price.total,
          },
          message:
            "Your booking request has been created. Please complete the payment to proceed.",
        },
        availableFacilities: null,
        bookings: null,
        blockedSlots: null,
        uploadUrl,
        documentId,
        paymentId: payment.payment_id,
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "resident_facility_booking_error",
        error: err.message,
        durationMs: Date.now() - startTime,
      });
      const isDev = Deno.env.get("DENO_ENV") === "development";
      return errorResponse(
        isDev ? err.message : "Failed to process resident facility booking.",
        500,
        isDev ? err.stack : null,
      );
    }
  }),
);