/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface ComplaintsApproval {
  complaintName: string | null;
  complaintType: string | null;
  residentName: string | null;
  unitNumber: string | null;
  towerName: string | null;
}

interface FacilityBookingsApproval {
  bookingName: string | null;
  requestedBy: string | null;
  phone: string | null;
  unitNumber: string | null;
  towerName: string | null;
  blockName: string | null;
  purpose: string | null;
  paymentStatus: string | null;
  amenity: string | null;
  approvalStatus: string | null;
  bookingStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  isMaintenance: boolean;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Parse & Validate Payload
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildError('BAD_REQUEST', 'Request body is empty.', 400, startTime)
    }

    const { societyRegistrationNumber } = JSON.parse(bodyText)

    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildError('BAD_REQUEST', 'Society Registration Number is mandatory.', 400, startTime)
    }

    const regNum = String(societyRegistrationNumber).trim()

   // ================= STEP 2: BUILD CONCURRENT QUERIES =================
  const complaintsPromise = supabase
      .from('SSP_Complaint')
      .select(`
        name,
        complaint_type,
        SSP_Society_User!society_user!inner (
          unit_flat_number,
          SSP_Tower!left ( name ),
          SSP_Contact!left ( name ),
          SSP_Society!inner ( registration_number )
        )
      `)
      .eq('SSP_Society_User.SSP_Society.registration_number', regNum)

    const bookingsPromise = supabase
      .from('SSP_Facility_Booking')
      .select(`
        name,
        purpose_of_visit,
        payment_status,
        approval_status,
        booking_start_date,
        booking_end_date,
        booking_status,
        capacity,
        maintenance_status,
        SSP_Society_User!inner (
          unit_flat_number,
          SSP_Tower!left ( name ),
          SSP_Block!left ( block_name ),
          SSP_Contact!left ( name, phone ),
          SSP_Society!inner ( 
            registration_number,
            amenities 
          )
        )
      `)
      .eq('SSP_Society_User.SSP_Society.registration_number', regNum)
      .eq('approval_status', 'Pending')

    // Execute database reads concurrently
    const [complaintsResult, bookingsResult] = await Promise.all([complaintsPromise, bookingsPromise])

    if (complaintsResult.error) throw complaintsResult.error
    if (bookingsResult.error) throw bookingsResult.error

   // ================= STEP 3: MAP COMPLAINTS DATASET =================
    const mappedComplaints: ComplaintsApproval[] = []
    if (complaintsResult.data) {
      for (const comp of complaintsResult.data) {
        // Safely extract nested structures from potential array payloads
        const userObj = Array.isArray(comp.SSP_Society_User) ? comp.SSP_Society_User[0] : comp.SSP_Society_User
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact

        mappedComplaints.push({
          complaintName: comp.name ?? null,
          complaintType: comp.complaint_type ?? null,
          // REMOVED userObj?.name to prevent the "column does not exist" error
          residentName: contactObj?.name ?? 'Resident', 
          unitNumber: userObj?.unit_flat_number ?? null,
          towerName: towerObj?.name ?? null
        })
      }
    }

    // 4. Map Facility Bookings Dataset
    // ================= STEP 4: MAP FACILITY BOOKINGS DATASET =================
    const mappedBookings: FacilityBookingsApproval[] = []
    if (bookingsResult.data) {
      for (const book of bookingsResult.data) {
        const userObj = Array.isArray(book.SSP_Society_User) ? book.SSP_Society_User[0] : book.SSP_Society_User
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower
        const blockObj = Array.isArray(userObj?.SSP_Block) ? userObj?.SSP_Block[0] : userObj?.SSP_Block
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact
        const societyObj = Array.isArray(userObj?.SSP_Society) ? userObj?.SSP_Society[0] : userObj?.SSP_Society

        mappedBookings.push({
          bookingName: book.name ?? null,
          purpose: book.purpose_of_visit ?? null,
          paymentStatus: book.payment_status ?? null,
          // Pulling amenities safely from the parsed society object now
          amenity: societyObj?.amenities ?? null, 
          approvalStatus: book.approval_status ?? null,
          bookingStatus: book.booking_status ?? null,
          startDate: book.booking_start_date ?? null,
          endDate: book.booking_end_date ?? null,
          capacity: book.capacity ? Number(book.capacity) : null,
          isMaintenance: book.maintenance_status ?? false,
          unitNumber: userObj?.unit_flat_number ?? null,
          towerName: towerObj?.name ?? null,
          blockName: blockObj?.block_name ?? null,
          requestedBy: contactObj?.name ?? null,
          phone: contactObj?.phone ?? null
        })
      }
    }
    console.log(`Aggregated pending review summaries in ${Date.now() - startTime}ms`)
    return new Response(
      JSON.stringify({
        pendingApprovals: {
          complaints: mappedComplaints,
          facilityBookings: mappedBookings
        },
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildError(
      'SERVER_ERROR',
      `Database Execution Failure: ${error.message || 'Fatal error aggregation dashboard workflows.'}`,
      500,
      startTime
    )
  }
})

function buildError(code: string, msg: string, status: number, start: number) {
  console.error(`Get Pending Approvals Failure -> [${code}]: ${msg}`)
  return new Response(
    JSON.stringify({
      pendingApprovals: { complaints: [], facilityBookings: [] },
      errorResponse: { errorCode: code, message: msg, timestamp: new Date().toISOString() }
    }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/

import { createClient } from "npm:@supabase/supabase-js@^2.48.0";
import { Validator } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
import {
  getEnv,
  parseRequestBody,
  sanitizeString,
  logger,
  ApiError,
  handleError,
} from "../_shared/utils.ts";

interface ComplaintsApproval {
  complaintName: string | null;
  complaintType: string | null;
  residentName: string | null;
  unitNumber: string | null;
  towerName: string | null;
}

interface FacilityBookingsApproval {
  bookingName: string | null;
  requestedBy: string | null;
  phone: string | null;
  unitNumber: string | null;
  towerName: string | null;
  blockName: string | null;
  purpose: string | null;
  paymentStatus: string | null;
  amenity: string | null;
  approvalStatus: string | null;
  bookingStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  isMaintenance: boolean;
}

interface UserRelation {
  unit_flat_number?: string | null;
  SSP_Tower?: { name?: string | null }[] | { name?: string | null } | null;
  SSP_Block?: { block_name?: string | null }[] | { block_name?: string | null } | null;
  SSP_Contact?: { name?: string | null; phone?: string | null }[] | { name?: string | null; phone?: string | null } | null;
  SSP_Society?: { registration_number?: string | null; amenities?: string | null }[] | { registration_number?: string | null; amenities?: string | null } | null;
}

interface ComplaintRecord {
  name: string | null;
  complaint_type: string | null;
  SSP_Society_User: UserRelation[] | UserRelation | null;
}

interface BookingRecord {
  name: string | null;
  purpose_of_visit: string | null;
  payment_status: string | null;
  approval_status: string | null;
  booking_start_date: string | null;
  booking_end_date: string | null;
  booking_status: string | null;
  capacity: number | null;
  maintenance_status: boolean | null;
  SSP_Society_User: UserRelation[] | UserRelation | null;
}

interface QueryResult {
  data: ComplaintRecord[] | BookingRecord[] | null;
  error?: { message: string } | null;
}

type QueryPromise = Promise;

Deno.serve(async (req: Request): Promise => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const action = "POST /get-pending-approvals";

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. AUTHENTICATION: Bearer Token Verification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      throw new ApiError("UNAUTHORIZED", "Invalid or expired session token", 401);
    }

    // 2. PARSE BODY
    const body = await parseRequestBody(req);
    if (!body) {
      throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
    }

    // 3. VALIDATION
    const validator = new Validator();
    validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");

    if (!validator.isValid()) {
      throw new ApiError("BAD_REQUEST", "Invalid input parameters", 422, validator.getErrors());
    }

    const regNum = sanitizeString(String(body.societyRegistrationNumber));
    const filterType = body.type ? sanitizeString(String(body.type)).toUpperCase() : "ALL";

    // 4. PAGINATION
    const url = new URL(req.url);
    const cPageStr = url.searchParams.get("complaintPage") || "1";
    const cLimitStr = url.searchParams.get("complaintLimit") || "10";
    const bPageStr = url.searchParams.get("bookingPage") || "1";
    const bLimitStr = url.searchParams.get("bookingLimit") || "10";

    const complaintPagination = sanitizePagination(cPageStr, cLimitStr);
    const bookingPagination = sanitizePagination(bPageStr, bLimitStr);

    const cOffset = (complaintPagination.page - 1) * complaintPagination.limit;
    const bOffset = (bookingPagination.page - 1) * bookingPagination.limit;

    logger.info({ message: `Starting execution for ${action}` });

    let mappedComplaints: ComplaintsApproval[] = [];
    let mappedBookings: FacilityBookingsApproval[] = [];

    const fetchComplaints = filterType === "ALL" || filterType === "COMPLAINTS";
    const fetchBookings = filterType === "ALL" || filterType === "BOOKINGS";

    const queryPromises: QueryPromise[] = [];

    // 5. COMPLAINTS QUERY
    if (fetchComplaints) {
      const complaintQuery = supabase
  .from("SSP_Complaint")
  .select(`
    name,
    complaint_type,
    SSP_Society_User!society_user!inner (
      unit_flat_number,
      SSP_Tower!left ( name ),
      SSP_Contact!left ( name ),
      SSP_Society!inner ( registration_number )
    )
  `)
        .eq("SSP_Society_User.SSP_Society.registration_number", regNum)
        .ilike("status", "pending")
        .range(cOffset, cOffset + complaintPagination.limit - 1);

      queryPromises.push(complaintQuery as unknown as QueryPromise);
    } else {
      queryPromises.push(Promise.resolve({ data: null }));
    }

    // 6. BOOKINGS QUERY (Using requested_by foreign key)
    if (fetchBookings) {
      const bookingQuery = supabase
        .from("SSP_Facility_Booking")
        .select(`
          name,
          purpose_of_visit,
          payment_status,
          approval_status,
          booking_start_date,
          booking_end_date,
          booking_status,
          capacity,
          maintenance_status,
          SSP_Society_User!requested_by!inner (
            unit_flat_number,
            SSP_Tower!left ( name ),
            SSP_Block!left ( block_name ),
            SSP_Contact!left ( name, phone ),
            SSP_Society!inner ( 
              registration_number,
              amenities 
            )
          )
        `)
        .eq("SSP_Society_User.SSP_Society.registration_number", regNum)
        .ilike("approval_status", "pending")
        .range(bOffset, bOffset + bookingPagination.limit - 1);

      queryPromises.push(bookingQuery as unknown as QueryPromise);
    } else {
      queryPromises.push(Promise.resolve({ data: null }));
    }

    const [complaintsRes, bookingsRes] = await Promise.all(queryPromises);

    if (complaintsRes?.error) {
      throw new ApiError("SERVER_ERROR", `Complaints fetch failed: ${complaintsRes.error.message}`, 500);
    }
    if (bookingsRes?.error) {
      throw new ApiError("SERVER_ERROR", `Bookings fetch failed: ${bookingsRes.error.message}`, 500);
    }

    // 7. MAP COMPLAINTS
    if (complaintsRes?.data) {
      const complaintsData = complaintsRes.data as ComplaintRecord[];
      mappedComplaints = complaintsData.map((comp) => {
        const userObj = Array.isArray(comp.SSP_Society_User) ? comp.SSP_Society_User[0] : comp.SSP_Society_User;
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower;
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact;

        return {
          complaintName: comp.name ?? null,
          complaintType: comp.complaint_type ?? null,
          residentName: contactObj?.name ?? "Resident",
          unitNumber: userObj?.unit_flat_number ?? null,
          towerName: towerObj?.name ?? null,
        };
      });
    }

    // 8. MAP BOOKINGS
    if (bookingsRes?.data) {
      const bookingsData = bookingsRes.data as BookingRecord[];
      mappedBookings = bookingsData.map((book) => {
        const userObj = Array.isArray(book.SSP_Society_User) ? book.SSP_Society_User[0] : book.SSP_Society_User;
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower;
        const blockObj = Array.isArray(userObj?.SSP_Block) ? userObj?.SSP_Block[0] : userObj?.SSP_Block;
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact;
        const societyObj = Array.isArray(userObj?.SSP_Society) ? userObj?.SSP_Society[0] : userObj?.SSP_Society;

        return {
          bookingName: book.name ?? null,
          purpose: book.purpose_of_visit ?? null,
          paymentStatus: book.payment_status ?? null,
          amenity: societyObj?.amenities ?? null,
          approvalStatus: book.approval_status ?? null,
          bookingStatus: book.booking_status ?? null,
          startDate: book.booking_start_date ?? null,
          endDate: book.booking_end_date ?? null,
          capacity: book.capacity ? Number(book.capacity) : null,
          isMaintenance: book.maintenance_status ?? false,
          unitNumber: userObj?.unit_flat_number ?? null,
          towerName: towerObj?.name ?? null,
          blockName: blockObj?.block_name ?? null,
          requestedBy: contactObj?.name ?? null,
          phone: contactObj?.phone ?? null,
        };
      });
    }

    logger.info({ message: `Successfully completed ${action}` });

    return new Response(
      JSON.stringify({
        pendingApprovals: {
          complaints: mappedComplaints,
          facilityBookings: mappedBookings,
        },
        errorResponse: null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    logger.error({ message: `Error executing ${action}`, details: String(err) });
    return handleError(err);
  }
});