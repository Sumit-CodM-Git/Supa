/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Validate Request Body Presence
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const { societyRegistrationNumber, facilityName, bookingDate } = JSON.parse(bodyText)

    // 2. Validate Mandatory Fields
    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '' ||
        !facilityName || String(facilityName).trim() === '' || !bookingDate) {
      return buildErrorResponse(
        'BAD_REQUEST',
        'Society Registration Number, Facility Name, and Booking Date are mandatory.',
        400
      )
    }

    // Parse incoming date elements safely (YYYY-MM-DD)
    const [year, month, day] = String(bookingDate).split('-').map(Number)
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return buildErrorResponse('BAD_REQUEST', 'Invalid bookingDate format. Expected YYYY-MM-DD.', 400)
    }

    // 3. Fetch Facility Master Record with fallback from Name to Type
    let { data: facilityData, error: facilityError } = await supabase
      .from('SSP_Facility')
      .select(`
        id,
        name,
        facility_type,
        closed_days,
        opening_time,
        closing_time,
        on_maintenance,
        maintenance_start,
        maintenance_end,
        maintenance_reason,
        society:SSP_Society!SSP_Facility_society_fkey!inner (
          registration_number
        )
      `)
      .ilike('name', String(facilityName).trim())
      .ilike('society.registration_number', String(societyRegistrationNumber).trim())
      .limit(1)

    if (facilityError) throw facilityError

    if (!facilityData || facilityData.length === 0) {
      const { data: typeData, error: typeError } = await supabase
        .from('SSP_Facility')
        .select(`
          id,
          name,
          facility_type,
          closed_days,
          opening_time,
          closing_time,
          on_maintenance,
          maintenance_start,
          maintenance_end,
          maintenance_reason,
          society:SSP_Society!SSP_Facility_society_fkey!inner (
            registration_number
          )
        `)
        .ilike('facility_type', String(facilityName).trim())
        .ilike('society.registration_number', String(societyRegistrationNumber).trim())
        .limit(1)

      if (typeError) throw typeError
      facilityData = typeData
    }

    if (!facilityData || facilityData.length === 0) {
      return buildErrorResponse('NOT_FOUND', 'Specified facility was not found for this society.', 404)
    }

    const facility = facilityData[0]

    // Calculate operating hours or default to 08:00 - 20:00
    let startHour = 8
    let endHour = 20

    if (facility.opening_time) {
      const parsedStart = parseInt(facility.opening_time.split(':')[0], 10)
      if (!isNaN(parsedStart)) startHour = parsedStart
    }

    if (facility.closing_time) {
      const parsedEnd = parseInt(facility.closing_time.split(':')[0], 10)
      if (!isNaN(parsedEnd)) endHour = parsedEnd
    }

    // Full day bounds for filtering (covering 00:00:00 to 23:59:59 UTC of the target bookingDate)
    const dayStartBound = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)).toISOString()
    const dayEndBound = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).toISOString()

    // 4. Fetch Overlapping Existing Bookings (FIX: Added 'Pending' & 'Booked' status filters)
    const { data: existingBookings, error: fetchError } = await supabase
      .from('SSP_Facility_Booking')
      .select(`
        booking_start_date,
        booking_end_date,
        approval_status,
        booking_status,
        maintenance_status,
        facility
      `)
      .eq('facility', facility.id)
      .or('approval_status.in.(Approved,Requested,Pending),booking_status.in.(Approved,Requested,Pending,Booked)')
      .lt('booking_start_date', dayEndBound)
      .gt('booking_end_date', dayStartBound)

    if (fetchError) throw fetchError

    // 5. Evaluate Closed Day Condition
    const targetDate = new Date(Date.UTC(year, month - 1, day))
    const isClosed = checkIfClosedDay(targetDate, facility.closed_days)

    // Maintenance Window Parsing
    const maintStart = facility.maintenance_start ? new Date(facility.maintenance_start).getTime() : null
    const maintEnd = facility.maintenance_end ? new Date(facility.maintenance_end).getTime() : null

    // 6. Generate Hourly Slots Matrix
    const dailySlots = []

    for (let hour = startHour; hour < endHour; hour++) {
      const slotStart = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0)).getTime()
      const slotEnd = new Date(Date.UTC(year, month - 1, day, hour + 1, 0, 0, 0)).getTime()

      let status = 'Available'
      let onMaintenanceFlag = false
      let maintStartFormatted: string | null = null
      let maintEndFormatted: string | null = null
      let maintReason: string | null = null

      // RULE 1: Closed Day
      if (isClosed) {
        status = 'Closed'
      } 
      // RULE 2: Global Facility Maintenance Window
      else if (
        facility.on_maintenance &&
        maintStart &&
        maintEnd &&
        slotStart < maintEnd &&
        slotEnd > maintStart
      ) {
        status = 'Unavailable'
        onMaintenanceFlag = true
        maintStartFormatted = facility.maintenance_start
        maintEndFormatted = facility.maintenance_end
        maintReason = facility.maintenance_reason ?? null
      } 
      // RULE 3: Existing Bookings (Hourly, Full-Day, or Multi-Day Overlaps)
      else {
        for (const booking of (existingBookings ?? [])) {
          // Parse ISO strings safely with fallback for non-ISO SQL timestamps
          const dbStartStr = booking.booking_start_date.includes('T') || booking.booking_start_date.includes('Z')
            ? booking.booking_start_date
            : `${booking.booking_start_date.replace(' ', 'T')}Z`
          
          const dbEndStr = booking.booking_end_date.includes('T') || booking.booking_end_date.includes('Z')
            ? booking.booking_end_date
            : `${booking.booking_end_date.replace(' ', 'T')}Z`

          const dbStart = new Date(dbStartStr).getTime()
          const dbEnd = new Date(dbEndStr).getTime()

          // Check interval overlap: [slotStart, slotEnd) intersects [dbStart, dbEnd)
          if (slotStart < dbEnd && slotEnd > dbStart) {
            if (booking.maintenance_status === true) {
              status = 'Unavailable'
              onMaintenanceFlag = true
            } else {
              status = 'Booked'
            }
            break
          }
        }
      }

      const slotObj: Record<string, any> = {
        startTime: formatTime(new Date(slotStart)),
        endTime: formatTime(new Date(slotEnd)),
        status: status,
        onMaintenance: onMaintenanceFlag
      }

      if (onMaintenanceFlag) {
        slotObj.maintenanceStart = maintStartFormatted
        slotObj.maintenanceEnd = maintEndFormatted
        if (maintReason) slotObj.maintenanceReason = maintReason
      }

      dailySlots.push(slotObj)
    }

    // 7. Output Response Wrapper
    return new Response(
      JSON.stringify({
        facilitySchedule: {
          slots: dailySlots
        },
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', error.message || 'Fatal crash computing schedule matrix.', 500)
  }
})

function checkIfClosedDay(date: Date, closedDaysStr: string | null): boolean {
  if (!closedDaysStr || closedDaysStr.trim() === '') return false;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const fullWeekday = days[date.getUTCDay()].toLowerCase();
  const shortWeekday = fullWeekday.substring(0, 3);

  const daysList = closedDaysStr.split(',').map(d => d.trim().toLowerCase());

  return daysList.some(day => day === fullWeekday || day === shortWeekday);
}

function formatTime(date: Date): string {
  let hours = date.getUTCHours()
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  
  hours = hours % 12
  hours = hours ? hours : 12
  const strHours = String(hours).padStart(2, '0')
  
  return `${strHours}:${minutes} ${ampm}`
}

function buildErrorResponse(code: string, message: string, statusCode: number) {
  console.error(`Get Facility Schedule Failure -> [${code}]: ${message}`)
  return new Response(
    JSON.stringify({
      facilitySchedule: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString()
      }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/

import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import { createClient } from "@supabase/supabase-js";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const logger = createLogger("get-facility-schedule");

// ============================================
// TYPES & INTERFACES
// ============================================
interface ScheduleRequestBody {
  societyRegistrationNumber: string;
  facilityName?: string;
  facilityType?: string;
  bookingDate: string;
}

interface SocietyJoinRecord {
  registration_number: string;
}

interface FacilityRecord {
  id: string;
  name: string | null;
  facility_type: string | null;
  closed_days: string | string[] | null;
  opening_time: string | null;
  closing_time: string | null;
  on_maintenance: boolean | null;
  maintenance_start: string | null;
  maintenance_end: string | null;
  maintenance_reason: string | null;
  SSP_Society: SocietyJoinRecord | SocietyJoinRecord[];
}

interface BookingRecord {
  booking_start_date: string;
  booking_end_date: string;
  approval_status: string | null;
  booking_status: string | null;
  maintenance_status: boolean | null;
  facility: string;
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

interface FacilityScheduleResponse {
  facilityId: string;
  facilityName: string | null;
  facilityType: string | null;
  bookingDate: string;
  slots: SlotResponse[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Checks if a target Date falls on a facility closed day.
 * Handles Postgres array formats like '{Monday,Tuesday}' or 'Monday, Tuesday'.
 */
function checkIfClosedDay(date: Date, closedDays: string | string[] | null | undefined): boolean {
  if (!closedDays) return false;

  let daysList: string[] = [];

  if (Array.isArray(closedDays)) {
    daysList = closedDays.map((d) => d.trim().toLowerCase());
  } else if (typeof closedDays === "string") {
    let trimmed = closedDays.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      trimmed = trimmed.slice(1, -1);
    }
    if (trimmed === "") return false;
    daysList = trimmed.split(",").map((d) => d.trim().toLowerCase());
  }

  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const fullWeekday = days[date.getUTCDay()];
  const shortWeekday = fullWeekday.substring(0, 3);

  return daysList.some((day) => day === fullWeekday || day === shortWeekday);
}

/**
 * Formats a Date object into 'hh:mm AM/PM' UTC format
 */
function formatTime(date: Date): string {
  let hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, "0");

  return `${strHours}:${minutes} ${ampm}`;
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

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
        action: "get_schedule_start",
        userId: authCtx.user.id,
        method: req.method,
        message: "Facility schedule calculation requested",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = (await req.json().catch(() => null)) as ScheduleRequestBody | null;
      if (!body) {
        return errorResponse("Request body is empty or invalid JSON.", 400);
      }

      const { societyRegistrationNumber, facilityName, facilityType, bookingDate } = body;

      const searchTerm = facilityName || facilityType;

      if (
        !societyRegistrationNumber || String(societyRegistrationNumber).trim() === "" ||
        !searchTerm || String(searchTerm).trim() === "" ||
        !bookingDate
      ) {
        return errorResponse("Society Registration Number, Facility Name/Type, and Booking Date are mandatory.", 400);
      }

      // Parse bookingDate (YYYY-MM-DD)
      const [year, month, day] = String(bookingDate).split("-").map(Number);
      if (isNaN(year) || isNaN(month) || isNaN(day)) {
        return errorResponse("Invalid bookingDate format. Expected YYYY-MM-DD.", 400);
      }

      const regNum = String(societyRegistrationNumber).trim();
      const facSearchTerm = String(searchTerm).trim();

      // 1. Fetch Facility Records (Primary search: Name, Fallback search: Facility Type)
      let { data: facilityData, error: facilityError } = await supabaseAdmin
        .from("SSP_Facility")
        .select(`
          id,
          name,
          facility_type,
          closed_days,
          opening_time,
          closing_time,
          on_maintenance,
          maintenance_start,
          maintenance_end,
          maintenance_reason,
          SSP_Society!inner ( registration_number )
        `)
        .ilike("name", facSearchTerm)
        .ilike("SSP_Society.registration_number", regNum);

      if (facilityError) throw facilityError;

      if (!facilityData || facilityData.length === 0) {
        const { data: typeData, error: typeError } = await supabaseAdmin
          .from("SSP_Facility")
          .select(`
            id,
            name,
            facility_type,
            closed_days,
            opening_time,
            closing_time,
            on_maintenance,
            maintenance_start,
            maintenance_end,
            maintenance_reason,
            SSP_Society!inner ( registration_number )
          `)
          .ilike("facility_type", facSearchTerm)
          .ilike("SSP_Society.registration_number", regNum);

        if (typeError) throw typeError;
        facilityData = typeData;
      }

      if (!facilityData || facilityData.length === 0) {
        return errorResponse("Specified facility was not found for this society.", 404);
      }

      const facilityRecords = (facilityData as unknown) as FacilityRecord[];
      const facilityIds = facilityRecords.map((f) => f.id);

      // Day bounds (UTC)
      const dayStartBound = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)).toISOString();
      const dayEndBound = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).toISOString();

      // 2. Fetch active/overlapping bookings for ALL retrieved facilities
      const { data: existingBookings, error: fetchError } = await supabaseAdmin
        .from("SSP_Facility_Booking")
        .select(`
          booking_start_date,
          booking_end_date,
          approval_status,
          booking_status,
          maintenance_status,
          facility
        `)
        .in("facility", facilityIds)
        .or("approval_status.in.(Approved,Requested,Pending),booking_status.in.(Approved,Requested,Pending,Booked)")
        .lt("booking_start_date", dayEndBound)
        .gt("booking_end_date", dayStartBound);

      if (fetchError) throw fetchError;

      const typedBookings = (existingBookings ?? []) as BookingRecord[];

      // Map bookings by facility ID for faster lookup
      const bookingsByFacility = new Map<string, BookingRecord[]>();
      for (const booking of typedBookings) {
        const list = bookingsByFacility.get(booking.facility) || [];
        list.push(booking);
        bookingsByFacility.set(booking.facility, list);
      }

      const targetDate = new Date(Date.UTC(year, month - 1, day));

      // 3. Generate schedule matrix for each facility found
      const facilitiesSchedules: FacilityScheduleResponse[] = facilityRecords.map((facility) => {
        let startHour = 8;
        let endHour = 20;

        if (facility.opening_time) {
          const parsedStart = parseInt(facility.opening_time.split(":")[0], 10);
          if (!isNaN(parsedStart)) startHour = parsedStart;
        }

        if (facility.closing_time) {
          const parsedEnd = parseInt(facility.closing_time.split(":")[0], 10);
          if (!isNaN(parsedEnd)) endHour = parsedEnd;
        }

        const isClosed = checkIfClosedDay(targetDate, facility.closed_days);

        const maintStart = facility.maintenance_start ? new Date(facility.maintenance_start).getTime() : null;
        const maintEnd = facility.maintenance_end ? new Date(facility.maintenance_end).getTime() : null;

        const facilityBookings = bookingsByFacility.get(facility.id) || [];
        const dailySlots: SlotResponse[] = [];

        for (let hour = startHour; hour < endHour; hour++) {
          const slotStart = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0)).getTime();
          const slotEnd = new Date(Date.UTC(year, month - 1, day, hour + 1, 0, 0, 0)).getTime();

          let status: "Available" | "Booked" | "Closed" | "Unavailable" = "Available";
          let onMaintenanceFlag = false;
          let maintStartFormatted: string | null = null;
          let maintEndFormatted: string | null = null;
          let maintReason: string | null = null;

          // Rule A: Closed Day
          if (isClosed) {
            status = "Closed";
          }
          // Rule B: Global Facility Maintenance
          else if (
            facility.on_maintenance &&
            maintStart &&
            maintEnd &&
            slotStart < maintEnd &&
            slotEnd > maintStart
          ) {
            status = "Unavailable";
            onMaintenanceFlag = true;
            maintStartFormatted = facility.maintenance_start;
            maintEndFormatted = facility.maintenance_end;
            maintReason = facility.maintenance_reason ?? null;
          }
          // Rule C: Overlapping Bookings
          else {
            for (const booking of facilityBookings) {
              const dbStartStr = booking.booking_start_date.includes("T") || booking.booking_start_date.includes("Z")
                ? booking.booking_start_date
                : `${booking.booking_start_date.replace(" ", "T")}Z`;

              const dbEndStr = booking.booking_end_date.includes("T") || booking.booking_end_date.includes("Z")
                ? booking.booking_end_date
                : `${booking.booking_end_date.replace(" ", "T")}Z`;

              const dbStart = new Date(dbStartStr).getTime();
              const dbEnd = new Date(dbEndStr).getTime();

              if (slotStart < dbEnd && slotEnd > dbStart) {
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
            startTime: formatTime(new Date(slotStart)),
            endTime: formatTime(new Date(slotEnd)),
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
        action: "get_schedule_end",
        facilityCount: facilitiesSchedules.length,
        duration: Date.now() - startTime,
        message: "Facility schedules generated successfully",
      });

      return successResponse({
        facilitiesSchedules,
      });

    } catch (error: unknown) {
      const err = error as Error;

      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "get_schedule_error",
        error: err.message,
        stack: err.stack,
        message: "Failed to generate facility schedules",
        duration: Date.now() - startTime,
      });

      const isDev = Deno.env.get("DENO_ENV") === "development";

      return errorResponse(
        err.message || "Failed to process facility schedule calculation.",
        500,
        isDev ? err.stack : null
      );
    }
  })
);