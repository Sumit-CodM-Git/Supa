/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface BookingData {
  bookingId: string | null;
  requestedBy: string | null;
  amenity: string | null;
  approvalStatus: string | null;
  bookingStatus: string | null;
  maintenanceStatus: boolean;
  capacity: number | null;
  startDate: string | null;
  endDate: string | null;
  phone: string | null;
  towerName: string | null;
  blockName: string | null;
  flatNumber: string | null;
  purposeOfVisit: string | null;
  paymentStatus: string | null;
  extraCharges: number | null;
  facilityId: string | null;
  paymentId: string | null;
  paymentDate: string | null;
  amount: number | null;
  rejectionReason: string | null;
  receiptImageUrl: string | null;
}

serve(async (req: Request) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Validate Payload Body
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildError('BAD_REQUEST', 'Request body is empty.', 400, startTime)
    }

    const { societyRegistrationNumber, status } = JSON.parse(bodyText)

    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildError('BAD_REQUEST', 'societyRegistrationNumber is mandatory.', 400, startTime)
    }

    const regNum = String(societyRegistrationNumber).trim()

    // 2. Build Base Relational Select Query
    // CHANGED: Added payment_status under SSP_Payment selection
    let query = supabase
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
        created_at,
        extra_charges,
        rejection_reason,

        SSP_Facility!inner (
          id,
          name
        ),

        SSP_Payment!left (
          pay_rec_id,
          payment_date,
          payment_status,
          amount,
          receipt_url,
          payment_type,
          SSP_Document!left (
            s3_path,
            document_type
          )
        ),

        SSP_Society_User!inner (
          unit_flat_number,
          SSP_Tower!left (
            name
          ),
          SSP_Block!left (
            block_name
          ),
          SSP_Contact!left (
            name,
            phone
          ),
          SSP_Society!inner (
            registration_number
          )
        )
      `)
      .eq('SSP_Society_User.SSP_Society.registration_number', regNum)

    // 3. Dynamic Status Filter Evaluation
    if (status && String(status).trim().toLowerCase() !== 'all') {
      query = query.eq(
        'approval_status',
        String(status).trim()
      )
    }

    // Order by record registration timeline descending
    const { data: records, error: dbErr } = await query.order('created_at', { ascending: false })

    if (dbErr) throw dbErr

    // 4. Map Query Output to Target Wrapper Structure
    const bookingsList: BookingData[] = []

    if (records) {
      for (const record of records) {
        const facilityObj = Array.isArray(record.SSP_Facility) ? record.SSP_Facility[0] : record.SSP_Facility
        const paymentObj = Array.isArray(record.SSP_Payment) ? record.SSP_Payment[0] : record.SSP_Payment
        const userObj = Array.isArray(record.SSP_Society_User) ? record.SSP_Society_User[0] : record.SSP_Society_User
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower
        const blockObj = Array.isArray(userObj?.SSP_Block) ? userObj?.SSP_Block[0] : userObj?.SSP_Block
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact

        // NEW LOGIC: Look inside SSP_Document first, then fallback to paymentObj.receipt_url
        let screenshotUrl: string | null = null

        // Get document path if attached to SSP_Document
        const docArray = paymentObj?.SSP_Document
        const docObj = Array.isArray(docArray) ? docArray[0] : docArray
        const rawPath = docObj?.s3_path || paymentObj?.receipt_url || null

        if (rawPath && rawPath.trim() !== '') {
          const cleanPath = rawPath.trim()
          screenshotUrl = cleanPath.startsWith('http')
            ? cleanPath
            : `${supabaseUrl}/storage/v1/object/public/society-documents/${cleanPath}`
        }

        // RESOLVE PAYMENT STATUS: Check Payment record first, fallback to Booking record
        const resolvedPaymentStatus = paymentObj?.payment_status 
          || record.payment_status 
          || 'Unpaid'

        bookingsList.push({
          bookingId: record.name ?? 'NA',
          amenity: facilityObj?.name ?? 'NA',
          approvalStatus: record.approval_status ?? 'Pending',
          bookingStatus: record.booking_status ?? 'Pending',
          maintenanceStatus: record.maintenance_status ?? false,
          capacity: record.capacity ? Number(record.capacity) : null,
          startDate: record.booking_start_date ?? null,
          endDate: record.booking_end_date ?? null,
          purposeOfVisit: record.purpose_of_visit ?? null,
          paymentStatus: resolvedPaymentStatus,
          towerName: towerObj?.name ?? null,
          blockName: blockObj?.block_name ?? null,
          flatNumber: userObj?.unit_flat_number ?? null,
          requestedBy: contactObj?.name ?? 'System',
          phone: contactObj?.phone ?? null,
          rejectionReason: record.rejection_reason ?? null,
          extraCharges: record.extra_charges != null ? Number(record.extra_charges) : null,
          facilityId: facilityObj?.id ?? null,
          paymentId: paymentObj?.pay_rec_id ?? null,
          paymentDate: paymentObj?.payment_date ?? null,
          amount: paymentObj?.amount != null ? Number(paymentObj.amount) : null,
          receiptImageUrl: screenshotUrl
        })
      }
    }

    console.log(`Successfully pulled facility ledger details in ${Date.now() - startTime}ms`)
    return new Response(
      JSON.stringify({ bookings: bookingsList, errorResponse: null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildError(
      'SERVER_ERROR',
      `Database Execution Failure: ${error.message || 'Fatal error processing booking matrices.'}`,
      500,
      startTime
    )
  }
})

function buildError(code: string, msg: string, status: number, start: number) {
  console.error(`Get Bookings Failure -> [${code}]: ${msg}`)
  return new Response(
    JSON.stringify({
      bookings: [],
      errorResponse: { errorCode: code, message: msg, timestamp: new Date().toISOString() }
    }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface BookingData {
  bookingId: string | null;
  requestedBy: string | null;
  amenity: string | null;
  approvalStatus: string | null;
  bookingStatus: string | null;
  maintenanceStatus: boolean;
  capacity: number | null;
  startDate: string | null;
  endDate: string | null;
  phone: string | null;
  towerName: string | null;
  blockName: string | null;
  flatNumber: string | null;
  purposeOfVisit: string | null;
  paymentStatus: string | null;
  extraCharges: number | null;
  facilityId: string | null;
  paymentId: string | null;
  paymentDate: string | null;
  amount: number | null;
  rejectionReason: string | null;
  receiptImageUrl: string | null;
}

serve(async (req: Request) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Validate Payload Body
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildError('BAD_REQUEST', 'Request body is empty.', 400, startTime)
    }

    const { 
      societyRegistrationNumber, 
      status, 
      facilityId, 
      startDate, 
      endDate,
      searchQuery,
      page = 1,    
      limit = 10   
    } = JSON.parse(bodyText)

    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildError('BAD_REQUEST', 'societyRegistrationNumber is mandatory.', 400, startTime)
    }

    const regNum = String(societyRegistrationNumber).trim()
    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10))
    const offset = (pageNum - 1) * limitNum

    // 2. Build Base Relational Select Query
    let query = supabase
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
        created_at,
        extra_charges,
        rejection_reason,

        SSP_Facility!inner (
          id,
          name
        ),

        SSP_Payment!left (
          pay_rec_id,
          payment_date,
          payment_status,
          amount,
          receipt_url,
          payment_type,
          SSP_Document!left (
            s3_path,
            document_type
          )
        ),

        SSP_Society_User!inner (
          unit_flat_number,
          SSP_Tower!left (
            name
          ),
          SSP_Block!left (
            block_name
          ),
          SSP_Contact!left (
            name,
            phone
          ),
          SSP_Society!inner (
            registration_number
          )
        )
      `, { count: 'exact' })
      .eq('SSP_Society_User.SSP_Society.registration_number', regNum)

    // 3. Dynamic Filters Evaluation
    if (status && String(status).trim().toLowerCase() !== 'all') {
      query = query.eq('approval_status', String(status).trim())
    }

    if (facilityId && String(facilityId).trim() !== '') {
      query = query.eq('SSP_Facility.id', String(facilityId).trim())
    }

    if (startDate) {
      query = query.gte('booking_start_date', startDate)
    }

    if (endDate) {
      query = query.lte('booking_end_date', endDate)
    }

    // ✅ ADDED: Search by Resident Name OR Amenity Name
    if (searchQuery && String(searchQuery).trim() !== '') {
      const cleanSearch = String(searchQuery).trim()
      // PostgREST allows combining OR conditions across joined tables
      query = query.or(`SSP_Society_User.SSP_Contact.name.ilike.%${cleanSearch}%,SSP_Facility.name.ilike.%${cleanSearch}%`)
    }

    // 4. Apply Pagination
    const { data: records, error: dbErr, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1)

    if (dbErr) throw dbErr

    // 5. Map Query Output to Target Structure
    const bookingsList: BookingData[] = []

    if (records) {
      for (const record of records) {
        const facilityObj = Array.isArray(record.SSP_Facility) ? record.SSP_Facility[0] : record.SSP_Facility
        const paymentObj = Array.isArray(record.SSP_Payment) ? record.SSP_Payment[0] : record.SSP_Payment
        const userObj = Array.isArray(record.SSP_Society_User) ? record.SSP_Society_User[0] : record.SSP_Society_User
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower
        const blockObj = Array.isArray(userObj?.SSP_Block) ? userObj?.SSP_Block[0] : userObj?.SSP_Block
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact

        let screenshotUrl: string | null = null
        const docArray = paymentObj?.SSP_Document
        const docObj = Array.isArray(docArray) ? docArray[0] : docArray
        const rawPath = docObj?.s3_path || paymentObj?.receipt_url || null

        if (rawPath && rawPath.trim() !== '') {
          const cleanPath = rawPath.trim()
          screenshotUrl = cleanPath.startsWith('http')
            ? cleanPath
            : `${supabaseUrl}/storage/v1/object/public/society-documents/${cleanPath}`
        }

        const resolvedPaymentStatus = paymentObj?.payment_status 
          || record.payment_status 
          || 'Unpaid'

        bookingsList.push({
          bookingId: record.name ?? 'NA',
          amenity: facilityObj?.name ?? 'NA',
          approvalStatus: record.approval_status ?? 'Pending',
          bookingStatus: record.booking_status ?? 'Pending',
          maintenanceStatus: record.maintenance_status ?? false,
          capacity: record.capacity ? Number(record.capacity) : null,
          startDate: record.booking_start_date ?? null,
          endDate: record.booking_end_date ?? null,
          purposeOfVisit: record.purpose_of_visit ?? null,
          paymentStatus: resolvedPaymentStatus,
          towerName: towerObj?.name ?? null,
          blockName: blockObj?.block_name ?? null,
          flatNumber: userObj?.unit_flat_number ?? null,
          requestedBy: contactObj?.name ?? 'System',
          phone: contactObj?.phone ?? null,
          rejectionReason: record.rejection_reason ?? null,
          extraCharges: record.extra_charges != null ? Number(record.extra_charges) : null,
          facilityId: facilityObj?.id ?? null,
          paymentId: paymentObj?.pay_rec_id ?? null,
          paymentDate: paymentObj?.payment_date ?? null,
          amount: paymentObj?.amount != null ? Number(paymentObj.amount) : null,
          receiptImageUrl: screenshotUrl
        })
      }
    }

    const totalRecords = count ?? 0
    const totalPages = Math.ceil(totalRecords / limitNum)

    console.log(`Successfully pulled facility ledger details in ${Date.now() - startTime}ms`)
    return new Response(
      JSON.stringify({ 
        bookings: bookingsList, 
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalRecords,
          totalPages
        },
        errorResponse: null 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildError(
      'SERVER_ERROR',
      `Database Execution Failure: ${error.message || 'Fatal error processing booking matrices.'}`,
      500,
      startTime
    )
  }
})

function buildError(code: string, msg: string, status: number, start: number) {
  console.error(`Get Bookings Failure -> [${code}]: ${msg}`)
  return new Response(
    JSON.stringify({
      bookings: [],
      pagination: null,
      errorResponse: { errorCode: code, message: msg, timestamp: new Date().toISOString() }
    }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}