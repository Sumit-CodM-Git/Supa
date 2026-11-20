import { resolveFacilityReceiptImage } from "../_shared/facility-receipt.ts";
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
  recordType: "booking" | "request";
  requestId: string | null;
  createdAt: string | null;
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
  receiptUploadStatus: "uploaded" | "missing" | "not_provided" | "unverified";
}

function normalizeBookingStatus(value: unknown): string {
  const status = String(value ?? '').trim().toLowerCase()
  if (['waiting_payment', 'payment_pending', 'pending_payment', 'requested'].includes(status)) return 'requested'
  if (['approved', 'booked'].includes(status)) return 'approved'
  if (['rejected', 'failed_slot_already_booked'].includes(status)) return 'rejected'
  return status
}

function mergeBookingRecords(
  confirmed: Record<string, any>[],
  requests: Record<string, any>[],
  confirmedPayments: Set<string>,
): Record<string, any>[] {
  const rows = [
    ...confirmed.map(row => ({ ...row, recordType: 'booking' })),
    ...requests.filter(row => !row.payment || !confirmedPayments.has(row.payment)).map(row => ({
      ...row,
      name: row.request_id,
      approval_status: normalizeBookingStatus(row.status),
      booking_status: normalizeBookingStatus(row.status),
      recordType: 'request',
    })),
  ] as Record<string, any>[]
  return rows.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : NaN
    const bTime = b.created_at ? Date.parse(b.created_at) : NaN
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0
    if (!Number.isFinite(bTime)) return -1
    return bTime - aTime || String(b.name ?? '').localeCompare(String(a.name ?? ''))
  })
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
      facilityName,
      startDate, 
      endDate,
      searchQuery,
      page = 1,    
      limit = 10   
    } = JSON.parse(bodyText)

    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildError('BAD_REQUEST', 'societyRegistrationNumber is mandatory.', 400, startTime)
    }

    if (facilityName != null && typeof facilityName !== 'string') {
      return buildError('BAD_REQUEST', 'facilityName must be text.', 400, startTime)
    }
    const cleanFacilityName = typeof facilityName === 'string' ? facilityName.trim() : ''
    const hasFacilityName = cleanFacilityName !== ''
    // Match literal names: SQL wildcard characters in a facility label are not filters.
    const facilityNamePattern = cleanFacilityName.replace(/[\\%_]/g, '\\$&')

    const regNum = String(societyRegistrationNumber).trim()
    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10))
    const offset = (pageNum - 1) * limitNum

    const cleanSearch = searchQuery == null ? '' : String(searchQuery).trim()
    // Separate left embeds let either search branch match without removing
    // the resident/facility details selected for the response.
    const searchEmbeds = cleanSearch
      ? `, search_facility:SSP_Facility(),
          search_resident:SSP_Society_User!requested_by(SSP_Contact!inner())`
      : ''

    const bookingSelect = `
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
        payment,
        extra_charges,
        rejection_reason,

        booking_facility:SSP_Facility!inner (
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

        booking_resident:SSP_Society_User!requested_by!inner (
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
        ${searchEmbeds}
      `

    // Apply society/search/date filters to both sources before combining them.
    function buildQuery(table: string, select: string) {
      let query = supabase
        .from(table)
        .select(select)
        .eq('booking_resident.SSP_Society.registration_number', regNum)

      if (hasFacilityName) {
        if (cleanFacilityName.toLowerCase() !== 'all') {
          query = query.ilike('booking_facility.name', facilityNamePattern)
        }
      } else if (facilityId && String(facilityId).trim() !== '') {
        query = query.eq('booking_facility.id', String(facilityId).trim())
      }

      if (startDate) {
        query = query.gte('booking_start_date', startDate)
      }

      if (endDate) {
        query = query.lte('booking_end_date', endDate)
      }

      // PostgREST requires null checks on separate embeds for OR across relations.
      if (cleanSearch) {
        const pattern = `%${cleanSearch.replace(/[\\%_]/g, '\\$&')}%`
        query = query
          .ilike('search_facility.name', pattern)
          .ilike('search_resident.SSP_Contact.name', pattern)
          .or('search_facility.not.is.null,search_resident.not.is.null')
      }

      return query
    }

    // Requests have not necessarily been copied into the confirmed booking table.
    const requestSelect = `
      name:request_id, request_id, status, purpose_of_visit,
      booking_start_date, booking_end_date, created_at, rejection_reason, payment,
      ${bookingSelect.slice(bookingSelect.indexOf('booking_facility:'))}
    `
    async function fetchAll(table: string, select: string, idColumn: string) {
      const rows: Record<string, any>[] = []
      const batchSize = 500
      for (let start = 0; ; start += batchSize) {
        const { data, error } = await buildQuery(table, select)
          .order('created_at', { ascending: false, nullsFirst: false })
          .order(idColumn, { ascending: false })
          .range(start, start + batchSize - 1)
        if (error) throw error
        const batch = (data ?? []) as unknown as Record<string, any>[]
        rows.push(...batch)
        if (batch.length < batchSize) return rows
      }
    }
    const [confirmed, requests] = await Promise.all([
      fetchAll('SSP_Facility_Booking', bookingSelect, 'name'),
      fetchAll('SSP_Facility_Booking_Request', requestSelect, 'request_id')
    ])

    // A confirmed booking wins over its old request, including when filtered out.
    const confirmedPayments = new Set<string>(confirmed.map(row => row.payment).filter(Boolean))
    const requestPayments = [...new Set<string>(requests.map(row => row.payment).filter(Boolean))]
    for (let start = 0; start < requestPayments.length; start += 100) {
      const { data, error } = await supabase.from('SSP_Facility_Booking')
        .select('payment').in('payment', requestPayments.slice(start, start + 100))
      if (error) throw error
      for (const row of data ?? []) if (row.payment) confirmedPayments.add(row.payment)
    }
    const merged = mergeBookingRecords(confirmed, requests, confirmedPayments)
    const pendingCount = merged.filter(row => ['pending', 'requested'].includes(normalizeBookingStatus(row.approval_status))).length
    const approvedCount = merged.filter(row => normalizeBookingStatus(row.approval_status) === 'approved').length
    const cleanStatus = status ? normalizeBookingStatus(status) : 'all'
    const matching = cleanStatus === 'all' ? merged
      : merged.filter(row => normalizeBookingStatus(row.approval_status) === cleanStatus)
    const count = matching.length
    const records = matching.slice(offset, offset + limitNum)

    // 5. Map Query Output to Target Structure
    const bookingsList: BookingData[] = []

    if (records) {
      const mappedBookings = await Promise.all(records.map(async (record) => {
        const facilityObj = Array.isArray(record.booking_facility) ? record.booking_facility[0] : record.booking_facility
        const paymentObj = Array.isArray(record.SSP_Payment) ? record.SSP_Payment[0] : record.SSP_Payment
        const userObj = Array.isArray(record.booking_resident) ? record.booking_resident[0] : record.booking_resident
        const towerObj = Array.isArray(userObj?.SSP_Tower) ? userObj?.SSP_Tower[0] : userObj?.SSP_Tower
        const blockObj = Array.isArray(userObj?.SSP_Block) ? userObj?.SSP_Block[0] : userObj?.SSP_Block
        const contactObj = Array.isArray(userObj?.SSP_Contact) ? userObj?.SSP_Contact[0] : userObj?.SSP_Contact

        const docArray = paymentObj?.SSP_Document
        const documents = Array.isArray(docArray) ? docArray : docArray ? [docArray] : []
        const receipt = await resolveFacilityReceiptImage(supabase, [
          ...documents.map((doc: any) => doc.s3_path), paymentObj?.receipt_url
        ])

        const resolvedPaymentStatus = paymentObj?.payment_status 
          || record.payment_status 
          || 'Unpaid'

        return {
          bookingId: record.name ?? 'NA',
          recordType: record.recordType,
          requestId: record.request_id ?? null,
          createdAt: record.created_at ?? null,
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
          ...receipt
        } as BookingData
      }))
      bookingsList.push(...mappedBookings)
    }

    const totalRecords = count ?? 0
    const totalPages = Math.ceil(totalRecords / limitNum)

    console.log(`Successfully pulled facility ledger details in ${Date.now() - startTime}ms`)
    return new Response(
      JSON.stringify({ 
        bookings: bookingsList,
        total: totalRecords,
        pending: pendingCount,
        approved: approvedCount,
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
