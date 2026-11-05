import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const logger = createLogger("facility-console");
const BUCKET_NAME = "society-documents";
const SIGNED_URL_EXPIRY = 900;
const IST_OFFSET_MINUTES = 330;
const SIGNED_URL_CONCURRENCY = 50;

// ============================================
// TYPES
// ============================================
type ActionType = "FETCH_FACILITIES" | "FETCH_SCHEDULE" | "FETCH_MY_BOOKINGS";

interface MergedRequestBody {
  actionType: ActionType;
  societyRegistrationNumber: string;

  // FETCH_SCHEDULE
  facilityName?: string;
  facilityType?: string;
  bookingDate?: string;
}

interface SocietyJoinRecord {
  registration_number: string;
}

interface FacilityRecord {
  id: string;
  name: string | null;
  facility_type: string | null;
  description: string | null;
  rules: string | string[] | null;
  booking_mode: string | null;
  opening_time: string | null;
  closing_time: string | null;
  closed_days: string | string[] | null;
  is_chargeable: boolean | null;
  base_price: number | null;
  on_maintenance: boolean | null;
  maintenance_start: string | null;
  maintenance_end: string | null;
  maintenance_reason: string | null;
  SSP_Society: SocietyJoinRecord | SocietyJoinRecord[];
}

interface DocumentRecord {
  facility: string;
  s3_path: string;
  document_type: string | null;
}

interface BookingRecord {
  booking_start_date: string;
  booking_end_date: string;
  approval_status: string | null;
  booking_status: string | null;
  maintenance_status: boolean | null;
  facility: string;
}

// ---- FETCH_MY_BOOKINGS raw + output ----
interface MyBookingRaw {
  name: string | null;
  booking_status: string | null;
  booking_start_date: string | null;
  booking_end_date: string | null;
  payment_status: string | null;
  capacity: number | string | null;
  purpose_of_visit: string | null;
  facility: string | null;
  SSP_Facility: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
}

interface PaymentRaw {
  pay_rec_id: string;
  facility: string | null;
  payment_method: string | null;
  payment_status: string | null;
}

interface MyBookingResponse {
  facilityName: string | null;
  bookingStatus: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  capacity: number | null;
  purpose: string | null;
  facilityBookingId: string | null;
  payRecId: string | null;
}

interface SlotResponse {
  startTime: string;
  endTime: string;
  status: "Available" | "Booked" | "Closed" | "Unavailable";
  onMaintenance: boolean;
  maintenanceStart?: string | null;
  maintenanceEnd?: string | null;
  maintenanceReason?: string | null;
}

// ============================================
// INITIALIZATION
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

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
      logger.info({
        level: "info",
        timestamp: new Date().toISOString(),
        action: "facility_console_start",
        userId: authCtx.user.id,
        method: req.method,
        message: "Facility console request received",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = (await req.json().catch(() => null)) as MergedRequestBody | null;
      if (!body) {
        return errorResponse("Request body is empty or invalid JSON.", 400);
      }

      const { actionType, societyRegistrationNumber } = body;

      if (!actionType || String(actionType).trim() === "") {
        return errorResponse("actionType is mandatory.", 400);
      }
      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("Society Registration Number is mandatory.", 400);
      }

      const cleanAction = String(actionType).trim().toUpperCase() as ActionType;
      const ALLOWED_ACTIONS: ActionType[] = [
        "FETCH_FACILITIES",
        "FETCH_SCHEDULE",
        "FETCH_MY_BOOKINGS",
      ];

      if (!ALLOWED_ACTIONS.includes(cleanAction)) {
        return errorResponse(
          `Invalid actionType: ${actionType}. Allowed: ${ALLOWED_ACTIONS.join(", ")}.`,
          400,
        );
      }

      const regNum = String(societyRegistrationNumber).trim();

      // ---- Resolve society (case-insensitive) ----
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number")
        .ilike("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          timestamp: new Date().toISOString(),
          action: "facility_console_society_lookup_error",
          error: socErr.message,
        });
        return errorResponse("Failed to fetch society data.", 500);
      }
      if (!society) {
        return errorResponse("Society not found for provided registration number.", 404);
      }

      // ---- Society-membership check ----
      const { data: membership } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", authCtx.user.id)
        .eq("society", society.society_id)
        .maybeSingle();

      if (!membership) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "facility_console_membership_denied",
          userId: authCtx.user.id,
          societyId: society.society_id,
        });
        return errorResponse("You are not a member of this society.", 403);
      }

      // =====================================================================
      // ACTION 1: FETCH_FACILITIES
      // =====================================================================
      if (cleanAction === "FETCH_FACILITIES") {
        const { data: records, error: dbErr } = await supabaseAdmin
          .from("SSP_Facility")
          .select(`
            id, name, facility_type, description, rules, booking_mode,
            opening_time, closing_time, closed_days, is_chargeable,
            base_price, on_maintenance,
            maintenance_start, maintenance_end, maintenance_reason,
            SSP_Society!inner ( registration_number )
          `)
          .eq("society", society.society_id);

        if (dbErr) throw dbErr;

        const facilityRecords = (records ?? []) as unknown as FacilityRecord[];
        const facilityIds = facilityRecords.map((f) => f.id);

        const docsByFacility = new Map<string, string[]>();
        if (facilityIds.length > 0) {
          const { data: docRecords } = await supabaseAdmin
            .from("SSP_Document")
            .select("facility, s3_path, document_type")
            .in("facility", facilityIds);

          for (const doc of (docRecords ?? []) as DocumentRecord[]) {
            if (!doc.facility || !doc.s3_path) continue;
            const list = docsByFacility.get(doc.facility) ?? [];
            list.push(doc.s3_path);
            docsByFacility.set(doc.facility, list);
          }
        }

        const allPaths: string[] = [];
        for (const list of docsByFacility.values()) allPaths.push(...list);
        const signedMap = await batchSignUrls(allPaths);

        const facilitiesList = facilityRecords.map((facility) => {
          const societyObj = Array.isArray(facility.SSP_Society)
            ? facility.SSP_Society[0]
            : facility.SSP_Society;

          const rawPaths = docsByFacility.get(facility.id) ?? [];
          const signedImages: string[] = [];
          for (const p of rawPaths) {
            const s = signedMap.get(p);
            if (s) signedImages.push(s);
          }

          return {
            id: facility.id,
            societyRegistrationNumber: societyObj?.registration_number ?? regNum,
            name: facility.name ?? null,
            type: facility.facility_type ?? null,
            description: facility.description ?? null,
            rules: parseArrayField(facility.rules),
            bookingMode: facility.booking_mode ?? null,
            closedDays: parseArrayField(facility.closed_days),
            basePrice: facility.base_price != null ? Number(facility.base_price) : null,
            openingTime: formatTime(facility.opening_time),
            closingTime: formatTime(facility.closing_time),
            isChargeable: facility.is_chargeable ?? false,
            onMaintenance: facility.on_maintenance ?? false,
            maintenanceStart: facility.maintenance_start ?? null,
            maintenanceEnd: facility.maintenance_end ?? null,
            maintenanceReason: facility.maintenance_reason ?? null,
            images: signedImages,
            imageUrl: signedImages[0] ?? null,
          };
        });

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "facility_console_facilities_end",
          userId: authCtx.user.id,
          count: facilitiesList.length,
          duration: Date.now() - startTime,
        });

        return successResponse({ facilities: facilitiesList });
      }

      // =====================================================================
      // ACTION 2: FETCH_SCHEDULE
      // =====================================================================
      if (cleanAction === "FETCH_SCHEDULE") {
        const { facilityName, facilityType, bookingDate } = body;
        const searchTerm = facilityName || facilityType;

        if (!searchTerm || String(searchTerm).trim() === "" || !bookingDate) {
          return errorResponse("Facility Name/Type and Booking Date are mandatory.", 400);
        }

        const [year, month, day] = String(bookingDate).split("-").map(Number);
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
          return errorResponse("Invalid bookingDate format. Expected YYYY-MM-DD.", 400);
        }

        const facSearchTerm = String(searchTerm).trim();
        const SELECT_FACILITY = `
          id, name, facility_type, closed_days, opening_time, closing_time,
          on_maintenance, maintenance_start, maintenance_end, maintenance_reason,
          SSP_Society!inner ( registration_number )
        `;

        let { data: facilityData, error: facilityError } = await supabaseAdmin
          .from("SSP_Facility")
          .select(SELECT_FACILITY)
          .eq("society", society.society_id)
          .ilike("name", facSearchTerm);

        if (facilityError) throw facilityError;

        if (!facilityData || facilityData.length === 0) {
          const { data: typeData, error: typeError } = await supabaseAdmin
            .from("SSP_Facility")
            .select(SELECT_FACILITY)
            .eq("society", society.society_id)
            .ilike("facility_type", facSearchTerm);

          if (typeError) throw typeError;
          facilityData = typeData;
        }

        if (!facilityData || facilityData.length === 0) {
          return errorResponse("Specified facility was not found for this society.", 404);
        }

        const facilityRecords = facilityData as unknown as FacilityRecord[];
        const facilityIds = facilityRecords.map((f) => f.id);
        const { startISO, endISO } = buildISTDayBounds(year, month, day);

        const { data: existingBookings, error: fetchError } = await supabaseAdmin
          .from("SSP_Facility_Booking")
          .select(`
            booking_start_date, booking_end_date, approval_status,
            booking_status, maintenance_status, facility
          `)
          .in("facility", facilityIds)
          .or("approval_status.in.(Approved,Requested,Pending),booking_status.in.(Approved,Requested,Pending,Booked)")
          .lt("booking_start_date", endISO)
          .gt("booking_end_date", startISO);

        if (fetchError) throw fetchError;

        const bookingsByFacility = new Map<string, BookingRecord[]>();
        for (const booking of (existingBookings ?? []) as BookingRecord[]) {
          const list = bookingsByFacility.get(booking.facility) ?? [];
          list.push(booking);
          bookingsByFacility.set(booking.facility, list);
        }

        const targetDate = new Date(Date.UTC(year, month - 1, day));

        const facilitiesSchedules = facilityRecords.map((facility) => {
          let openHour = 8, openMinute = 0, closeHour = 20, closeMinute = 0;
          if (facility.opening_time) {
            const p = parseTimeComponents(facility.opening_time);
            openHour = p.hour; openMinute = p.minute;
          }
          if (facility.closing_time) {
            const p = parseTimeComponents(facility.closing_time);
            closeHour = p.hour; closeMinute = p.minute;
          }

          const openTotal = openHour * 60 + openMinute;
          const closeTotal = closeHour * 60 + closeMinute;
          const slotCount = Math.max(0, Math.floor((closeTotal - openTotal) / 60));

          const isClosed = checkIfClosedDay(targetDate, facility.closed_days);
          const maintStart = facility.maintenance_start ? parseDBTimestamp(facility.maintenance_start) : null;
          const maintEnd = facility.maintenance_end ? parseDBTimestamp(facility.maintenance_end) : null;
          const facilityBookings = bookingsByFacility.get(facility.id) ?? [];
          const dailySlots: SlotResponse[] = [];

          for (let i = 0; i < slotCount; i++) {
            const startMin = openTotal + i * 60;
            const endMin = startMin + 60;
            const slotStartDate = buildISTDate(year, month, day, Math.floor(startMin / 60), startMin % 60);
            const slotEndDate = buildISTDate(year, month, day, Math.floor(endMin / 60), endMin % 60);
            const slotStartMs = slotStartDate.getTime();
            const slotEndMs = slotEndDate.getTime();

            let status: SlotResponse["status"] = "Available";
            let onMaintenanceFlag = false;
            let maintStartFormatted: string | null = null;
            let maintEndFormatted: string | null = null;
            let maintReason: string | null = null;

            if (isClosed) {
              status = "Closed";
            } else if (
              facility.on_maintenance &&
              maintStart !== null && maintEnd !== null &&
              !isNaN(maintStart) && !isNaN(maintEnd) &&
              slotStartMs < maintEnd && slotEndMs > maintStart
            ) {
              status = "Unavailable";
              onMaintenanceFlag = true;
              maintStartFormatted = facility.maintenance_start;
              maintEndFormatted = facility.maintenance_end;
              maintReason = facility.maintenance_reason ?? null;
            } else {
              for (const booking of facilityBookings) {
                const dbStart = parseDBTimestamp(booking.booking_start_date);
                const dbEnd = parseDBTimestamp(booking.booking_end_date);
                if (!isNaN(dbStart) && !isNaN(dbEnd) &&
                    slotStartMs < dbEnd && slotEndMs > dbStart) {
                  if (booking.maintenance_status === true) {
                    status = "Unavailable";
                    onMaintenanceFlag = true;
                  } else {
                    status = "Booked";
                  }
                  break;
                }
              }
            }

            const slotObj: SlotResponse = {
              startTime: formatISTTime(slotStartDate),
              endTime: formatISTTime(slotEndDate),
              status,
              onMaintenance: onMaintenanceFlag,
            };
            if (onMaintenanceFlag) {
              slotObj.maintenanceStart = maintStartFormatted;
              slotObj.maintenanceEnd = maintEndFormatted;
              if (maintReason) slotObj.maintenanceReason = maintReason;
            }
            dailySlots.push(slotObj);
          }

          return {
            facilityId: facility.id,
            facilityName: facility.name,
            facilityType: facility.facility_type,
            bookingDate,
            slots: dailySlots,
          };
        });

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "facility_console_schedule_end",
          userId: authCtx.user.id,
          facilityCount: facilitiesSchedules.length,
          duration: Date.now() - startTime,
        });

        return successResponse({ facilitiesSchedules });
      }

      // =====================================================================
      // ACTION 3: FETCH_MY_BOOKINGS
      //  • residentId derived from JWT (never trusted from body)
      //  • response key renamed: facilities → myBookings (no collision)
      //  • item-level fields preserved 1:1 from old get-my-facility-bookings
      // =====================================================================
      if (cleanAction === "FETCH_MY_BOOKINGS") {
        const residentId = authCtx.user.id;

        const { data: bookingsList, error: dbErr } = await supabaseAdmin
          .from("SSP_Facility_Booking")
          .select(`
            name, booking_status, booking_start_date, booking_end_date,
            payment_status, capacity, purpose_of_visit, facility,
            SSP_Facility!facility ( id, name )
          `)
          .eq("requested_by", residentId);

        if (dbErr) {
          return errorResponse(`Failed to retrieve records: ${dbErr.message}`, 500);
        }

        const bookings = (bookingsList ?? []) as unknown as MyBookingRaw[];
        const facilityIds = bookings
          .map((bk) => bk.facility)
          .filter((f): f is string => Boolean(f));

        // Payment map: one per facility (latest first)
        const paymentMap = new Map<string, {
          payRecId: string;
          paymentMethod: string | null;
          paymentStatus: string | null;
        }>();

        if (facilityIds.length > 0) {
          const { data: payments } = await supabaseAdmin
            .from("SSP_Payment")
            .select("pay_rec_id, facility, payment_method, payment_status")
            .eq("society_user", residentId)
            .in("facility", facilityIds)
            .order("created_at", { ascending: false });

          ((payments ?? []) as PaymentRaw[]).forEach((pay) => {
            if (pay.facility && !paymentMap.has(pay.facility)) {
              paymentMap.set(pay.facility, {
                payRecId: pay.pay_rec_id,
                paymentMethod: pay.payment_method ?? null,
                paymentStatus: pay.payment_status ?? null,
              });
            }
          });
        }

        const myBookings: MyBookingResponse[] = bookings.map((bk) => {
          const facilityObj = Array.isArray(bk.SSP_Facility)
            ? bk.SSP_Facility[0]
            : bk.SSP_Facility;

          const pay = bk.facility ? paymentMap.get(bk.facility) : undefined;

          // Preserve original paymentStatus resolution priority:
          //  1. paymentMap value (joined payment record)
          //  2. raw booking payment_status if it's "approved" or "rejected"
          //  3. null
          let resolvedPaymentStatus: string | null = null;
          if (pay) {
            resolvedPaymentStatus = pay.paymentStatus;
          } else if (bk.payment_status === "approved" || bk.payment_status === "rejected") {
            resolvedPaymentStatus = bk.payment_status;
          }

          return {
            facilityName: facilityObj?.name ?? null,
            bookingStatus: bk.booking_status ?? null,
            startDateTime: bk.booking_start_date ?? null,
            endDateTime: bk.booking_end_date ?? null,
            paymentStatus: resolvedPaymentStatus,
            paymentMethod: pay?.paymentMethod ?? null,
            capacity: bk.capacity ? parseFloat(String(bk.capacity)) : null,
            purpose: bk.purpose_of_visit ?? null,
            facilityBookingId: bk.name ?? null,
            payRecId: pay?.payRecId ?? null,
          };
        });

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "facility_console_my_bookings_end",
          userId: residentId,
          count: myBookings.length,
          duration: Date.now() - startTime,
        });

        return successResponse({ myBookings });
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "facility_console_error",
        error: err.message,
        stack: err.stack,
        duration: Date.now() - startTime,
      });

      const isDev = Deno.env.get("DENO_ENV") === "development";
      return errorResponse(
        err.message || "Failed to process facility request.",
        500,
        isDev ? err.stack : null,
      );
    }
  }),
);

// ============================================
// HELPERS
// ============================================
function parseArrayField(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string" && v.trim() !== "");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const content = trimmed.slice(1, -1);
      if (content === "") return [];
      return content.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

function formatTime(timeStr: string | null): string | null {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  if (parts.length >= 2) return `${parts[0].padStart(2, "0")}:${parts[1]}`;
  return timeStr;
}

function parseTimeComponents(timeStr: string | null): { hour: number; minute: number } {
  if (!timeStr) return { hour: 0, minute: 0 };
  const parts = timeStr.split(":");
  const hour = parseInt(parts[0] ?? "0", 10);
  const minute = parseInt(parts[1] ?? "0", 10);
  return { hour: isNaN(hour) ? 0 : hour, minute: isNaN(minute) ? 0 : minute };
}

function buildISTDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(utcMs - IST_OFFSET_MINUTES * 60 * 1000);
}

function formatISTTime(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  let hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}

function parseDBTimestamp(value: string): number {
  if (!value) return NaN;
  const v = value.trim();
  if (v.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(v)) return new Date(v).getTime();
  const normalized = v.includes("T") ? v : v.replace(" ", "T");
  return new Date(`${normalized}+05:30`).getTime();
}

function buildISTDayBounds(year: number, month: number, day: number): {
  startISO: string;
  endISO: string;
} {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startISO = `${year}-${pad(month)}-${pad(day)}T00:00:00+05:30`;
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const endISO = `${nextDay.getUTCFullYear()}-${pad(nextDay.getUTCMonth() + 1)}-${pad(nextDay.getUTCDate())}T00:00:00+05:30`;
  return { startISO, endISO };
}

function checkIfClosedDay(
  date: Date,
  closedDays: string | string[] | null | undefined,
): boolean {
  const daysList = parseArrayField(closedDays).map((d) => d.toLowerCase());
  if (daysList.length === 0) return false;
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const fullWeekday = weekdays[date.getUTCDay()];
  const shortWeekday = fullWeekday.substring(0, 3);
  return daysList.some((day) => day === fullWeekday || day === shortWeekday);
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

async function batchSignUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let i = 0; i < unique.length; i += SIGNED_URL_CONCURRENCY) {
    const chunk = unique.slice(i, i + SIGNED_URL_CONCURRENCY);
    const signed = await Promise.all(
      chunk.map(async (originalPath) => {
        const key = extractStorageKey(originalPath);
        if (!key) return [originalPath, null] as const;
        try {
          const { data, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(key, SIGNED_URL_EXPIRY);
          if (error || !data?.signedUrl) return [originalPath, null] as const;
          return [originalPath, data.signedUrl] as const;
        } catch {
          return [originalPath, null] as const;
        }
      }),
    );
    for (const [orig, url] of signed) {
      if (url) result.set(orig, url);
    }
  }
  return result;
}