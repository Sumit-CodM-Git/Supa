/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const BUCKET_NAME = 'society-documents'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const bodyText = await req.text()

    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse(
        'BAD_REQUEST',
        'Request body is empty.',
        400
      )
    }

    const requestObj = JSON.parse(bodyText)

    const {
      actionType,
      societyRegistrationNumber,
      societyUserId,
      securityGuardId,
      flatNumber,
      block,
      tower,
      visitorId,
      newStatus,
      visitorName,
      phone,
      email,
      gender,
      role,
      idProofType,
      idProofNumber,
      gateNumber,
      platform,
      vehicleNumber,
      vehicleType,
      purpose
    } = requestObj

    if (!societyRegistrationNumber) {
      return buildErrorResponse(
        'BAD_REQUEST',
        'societyRegistrationNumber is mandatory',
        400
      )
    }

    const cleanRegNum = String(societyRegistrationNumber).trim()
    const currentAction = actionType?.toUpperCase().trim()

    // ============================================================
    // Resolve Society
    // ============================================================
    const { data: societyContext } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', cleanRegNum)
      .maybeSingle()

    if (!societyContext) {
      return buildErrorResponse(
        'NOT_FOUND',
        'Target society environment reference not found.',
        404
      )
    }

    const societyId = societyContext.society_id

    const responseBody: any = {
      Visitors: [],
      visitorId: null,
      success: false,
      errorResponse: null
    }

    // ============================================================
    // BRANCH 1 : FETCH_PRE_APPROVALS
    // ============================================================
    if (currentAction === 'FETCH_PRE_APPROVALS') {

      const { data: visitors, error: fetchErr } = await supabase
        .from('SSP_Non_Society_User')
        .select(`
          non_society_user_id,
          name,
          delivery_origin,
          phone_number,
          vehicle_number,
          purpose,
          visitor_status,

          hosted_by:SSP_Society_User!SSP_Non_Society_User_hosted_by_fkey(
            user_id,
            unit_flat_number,
            contact:SSP_Contact!SSP_Society_User_contact_fkey(
              name
            )
          )
        `)
        .eq('society', societyId)
        .neq('visitor_status', 'Inside')
        .eq('hosted_by.user_id', societyUserId)
        .order('name', { ascending: true })

      if (fetchErr) throw fetchErr

      if (visitors && visitors.length > 0) {
        responseBody.Visitors =
          await attachSignedURLsToVisitors(
            supabase,
            visitors,
            cleanRegNum
          )
      }

      responseBody.success = true

      return buildSuccessResponse(responseBody)
    }

    // =========================================================================
    // BRANCH 2: REQUEST_APPROVAL
    // =========================================================================
    else if (currentAction === 'REQUEST_APPROVAL') {

      // -----------------------------------------------------------------
      // societyUserId and securityGuardId are already SSP_Society_User.user_id
      // -----------------------------------------------------------------

      const hostedByUuid =
        societyUserId && String(societyUserId).trim() !== ''
          ? String(societyUserId).trim()
          : null

      const approverUuid =
        securityGuardId && String(securityGuardId).trim() !== ''
          ? String(securityGuardId).trim()
          : null

      // -----------------------------------------------------------------
      // Optional validation of hosted_by
      // -----------------------------------------------------------------

      if (hostedByUuid) {
        const { data: resident } = await supabase
          .from('SSP_Society_User')
          .select('user_id')
          .eq('user_id', hostedByUuid)
          .eq('society', societyId)
          .maybeSingle()

        if (!resident) {
          return buildErrorResponse(
            'NOT_FOUND',
            'Resident user not found.',
            404
          )
        }
      }

      // -----------------------------------------------------------------
      // Optional validation of approver
      // -----------------------------------------------------------------

      if (approverUuid) {
        const { data: security } = await supabase
          .from('SSP_Society_User')
          .select('user_id')
          .eq('user_id', approverUuid)
          .eq('society', societyId)
          .maybeSingle()

        if (!security) {
          return buildErrorResponse(
            'NOT_FOUND',
            'Security Guard not found.',
            404
          )
        }
      }

      // -----------------------------------------------------------------
      // Insert Visitor
      // -----------------------------------------------------------------

      const { data: newVisitor, error: insertErr } = await supabase
        .from('SSP_Non_Society_User')
        .insert({
          name: visitorName,
          phone_number: phone,
          delivery_origin: platform,
          vehicle_number: vehicleNumber,
          purpose: purpose,
          role: role,
          gender: gender,
          email: email,
          id_proof_type: idProofType,
          id_proof_number: idProofNumber,
          gate_no: gateNumber,
          vehicle_type: vehicleType,

          visitor_status: null,
          check_in: null,
          check_out: null,

          // =====================================================
          // Direct UUID assignment
          // =====================================================
          hosted_by: hostedByUuid,
          approver: approverUuid,

          society: societyId
        })
        .select('non_society_user_id')
        .single()

      if (insertErr) throw insertErr

      responseBody.visitorId = newVisitor.non_society_user_id
      responseBody.success = true

      return buildSuccessResponse(responseBody)
    }

        // =========================================================================
    // BRANCH 3: UPDATE_STATUS
    // =========================================================================
    else if (currentAction === 'UPDATE_STATUS') {

      if (!visitorId) {
        return buildErrorResponse(
          'BAD_REQUEST',
          'visitorId parameter missing from update routing request.',
          400
        )
      }

      // Verify visitor belongs to the same society
      const { data: checkVisitor } = await supabase
        .from('SSP_Non_Society_User')
        .select('non_society_user_id')
        .eq('non_society_user_id', visitorId)
        .eq('society', societyId)
        .maybeSingle()

      if (!checkVisitor) {
        return buildErrorResponse(
          'NOT_FOUND',
          `No visitor found with ID: ${visitorId}`,
          404
        )
      }

      const updatePayload: any = {}

      const targetStatus = String(newStatus).trim().toLowerCase()

      if (targetStatus === 'inside') {
        updatePayload.check_in = new Date().toISOString()
        updatePayload.check_out = null
        updatePayload.visitor_status = 'Inside'
      }
      else if (targetStatus === 'outside') {
        updatePayload.check_out = new Date().toISOString()
        updatePayload.visitor_status = 'Outside'
      }
      else {
        return buildErrorResponse(
          'INVALID_STATUS',
          'Status must be Inside or Outside',
          400
        )
      }

      const { error: updateErr } = await supabase
        .from('SSP_Non_Society_User')
        .update(updatePayload)
        .eq('non_society_user_id', visitorId)

      if (updateErr) throw updateErr

      responseBody.success = true

      return buildSuccessResponse(responseBody)
    }

    // =========================================================================
    // BRANCH 4: FETCH_INSIDE_LOGS
    // =========================================================================
    else if (currentAction === 'FETCH_INSIDE_LOGS') {

      let query = supabase
        .from('SSP_Non_Society_User')
        .select(`
          non_society_user_id,
          name,
          delivery_origin,
          phone_number,
          vehicle_number,
          purpose,
          visitor_status,
          check_in,

          hosted_by:SSP_Society_User!SSP_Non_Society_User_hosted_by_fkey(
            user_id,
            unit_flat_number,

            block:SSP_Block!SSP_Society_User_block_fkey(
              block_name
            ),

            tower:SSP_Tower!SSP_Society_User_tower_fkey(
              name
            ),

            contact:SSP_Contact!SSP_Society_User_contact_fkey(
              name
            )
          )
        `)
        .eq('visitor_status', 'Inside')
        .eq('society', societyId)

      const cleanFlat = flatNumber ? String(flatNumber).trim() : ''
      const cleanBlock = block ? String(block).trim() : ''
      const cleanTower = tower ? String(tower).trim() : ''

      if (cleanFlat !== '') {
        query = query.eq(
          'hosted_by.unit_flat_number',
          cleanFlat
        )
      }

      if (cleanBlock !== '') {
        query = query.eq(
          'hosted_by.block.block_name',
          cleanBlock
        )
      }

      if (cleanTower !== '') {
        query = query.eq(
          'hosted_by.tower.name',
          cleanTower
        )
      }

      // Default today's entries
      if (
        cleanFlat === '' &&
        cleanBlock === '' &&
        cleanTower === ''
      ) {
        const todayStart = new Date()
        todayStart.setUTCHours(0, 0, 0, 0)

        query = query.gte(
          'check_in',
          todayStart.toISOString()
        )
      }

      const { data: insideVisitors, error: logErr } =
        await query.order('check_in', { ascending: false })

      if (logErr) throw logErr

      if (insideVisitors && insideVisitors.length > 0) {
        responseBody.Visitors =
          await attachSignedURLsToVisitors(
            supabase,
            insideVisitors,
            cleanRegNum
          )
      }

      responseBody.success = true

      return buildSuccessResponse(responseBody)
    }

    // =========================================================================
    // INVALID ACTION
    // =========================================================================
    return buildErrorResponse(
      'BAD_REQUEST',
      'Invalid or unmapped actionType operation.',
      400
    )
  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', error.message || 'Fatal execution thread context failure.', 500)
  }
})

// =============================================================================
// STORAGE RESOURCE HELPER UTIL
// =============================================================================
async function attachSignedURLsToVisitors(
  supabase: any,
  visitorList: any[],
  registrationNumber: string
) {
  const visitorIds = visitorList.map(
    (v) => v.non_society_user_id
  )

  const { data: docs } = await supabase
    .from('SSP_Document')
    .select('non_society_user, s3_path')
    .in('non_society_user', visitorIds)

  const imageMap = new Map()

  docs?.forEach((doc: any) => {
    if (doc.non_society_user && doc.s3_path) {
      imageMap.set(
        doc.non_society_user,
        doc.s3_path.trim()
      )
    }
  })

  return await Promise.all(
    visitorList.map(async (v: any) => {

      let finalSignedUrl = null

      const rawPath = imageMap.get(
        v.non_society_user_id
      )

      if (rawPath) {

        let storageKey = rawPath

        if (rawPath.includes('.amazonaws.com/')) {
          storageKey =
            rawPath
              .split('.amazonaws.com/')[1]
              .trim()
        }

        if (
          !storageKey.startsWith(
            `${registrationNumber}/`
          )
        ) {
          storageKey =
            `${registrationNumber}/${storageKey}`
        }

        const { data: signedPayload } =
          await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(storageKey, 900)

        if (signedPayload) {
          finalSignedUrl =
            signedPayload.signedUrl
        }
      }

      return {
        visitorId: v.non_society_user_id,
        name: v.name ?? '',
        phone: v.phone_number ?? '',
        platform: v.delivery_origin ?? 'N/A',
        purpose: v.purpose ?? 'N/A',
        vehicle: v.vehicle_number ?? 'N/A',
        status: v.visitor_status ?? '',
        checkIn: v.check_in ?? null,

        flat: v.hosted_by?.unit_flat_number ?? 'N/A',
        block:
          v.hosted_by?.block?.block_name ??
          'N/A',
        tower:
          v.hosted_by?.tower?.name ??
          'N/A',

        residentName:
          v.hosted_by?.contact?.name ??
          'N/A',

        imageUrl: finalSignedUrl
      }
    })
  )
}

// =============================================================================
// SUCCESS RESPONSE
// =============================================================================
function buildSuccessResponse(data: any) {
  return new Response(
    JSON.stringify(data),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    }
  )
}

// =============================================================================
// ERROR RESPONSE
// =============================================================================
function buildErrorResponse(
  code: string,
  message: string,
  statusCode: number
) {
  return new Response(
    JSON.stringify({
      Visitors: null,
      visitorId: null,
      success: false,
      errorResponse: {
        errorCode: code,
        message,
        timestamp: new Date().toISOString()
      }
    }),
    {
      status: statusCode,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    }
  )
}*/

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const BUCKET_NAME = "society-documents";
const baseLogger = createLogger("security-gate-console");

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
// TYPES & INTERFACES
// ============================================
interface SecurityGatePayload {
  actionType: "FETCH_PRE_APPROVALS" | "REQUEST_APPROVAL" | "UPDATE_STATUS" | "FETCH_INSIDE_LOGS";
  societyRegistrationNumber: string;
  societyUserId?: string;
  securityGuardId?: string;
  flatNumber?: string;
  block?: string;
  tower?: string;
  visitorId?: string;
  newStatus?: string;
  visitorName?: string;
  phone?: string;
  email?: string;
  gender?: string;
  role?: string;
  idProofType?: string;
  idProofNumber?: string;
  gateNumber?: string;
  platform?: string;
  vehicleNumber?: string;
  vehicleType?: string;
  purpose?: string;
  // Pagination Parameters
  page?: number | string;
  limit?: number | string;
  // Extended Filter Parameters
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
}

interface AuthContext {
  user: {
    id: string;
    email?: string;
  };
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

// ============================================
// INITIALIZATION
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx = (req as AuthenticatedRequest).authContext;
    const startTime = Date.now();

    try {
      logger.info({
        action: "security_gate_console_start",
        userId: authCtx?.user?.id ?? "unknown",
        method: req.method,
        message: "Security gate console request initialized",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => null);
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is empty.", 400);
      }

      const requestObj: SecurityGatePayload = JSON.parse(bodyText);

      const {
        actionType,
        societyRegistrationNumber,
        societyUserId,
        securityGuardId,
        flatNumber,
        block,
        tower,
        visitorId,
        newStatus,
        visitorName,
        phone,
        email,
        gender,
        role,
        idProofType,
        idProofNumber,
        gateNumber,
        platform,
        vehicleNumber,
        vehicleType,
        purpose,
        page = 1,
        limit = 10,
        searchTerm,
        startDate,
        endDate,
      } = requestObj;

      if (!societyRegistrationNumber || societyRegistrationNumber.trim() === "") {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanRegNum = societyRegistrationNumber.trim();
      const currentAction = actionType?.toUpperCase()?.trim();

      // Resolve Society Context
      const { data: societyContext, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", cleanRegNum)
        .maybeSingle();

      if (socErr || !societyContext) {
        return errorResponse("Target society environment reference not found.", 404);
      }

      const societyId = societyContext.society_id;

      // Calculate Pagination Offset
      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Math.min(100, Number(limit) || 10)); // Max 100 per page
      const offset = (pageNum - 1) * limitNum;

      // =========================================================================
      // BRANCH 1: FETCH_PRE_APPROVALS
      // =========================================================================
      if (currentAction === "FETCH_PRE_APPROVALS") {
        let baseQuery = supabaseAdmin
          .from("SSP_Non_Society_User")
          .select(
            `
            non_society_user_id,
            name,
            delivery_origin,
            phone_number,
            vehicle_number,
            purpose,
            visitor_status,
            check_in,
            check_out,
            hosted_by:SSP_Society_User!hosted_by(
              user_id,
              unit_flat_number,
              contact:SSP_Contact(
                name
              )
            )
          `,
            { count: "exact" }
          )
          .eq("society", societyId)
          .is("check_in", null) // Pre-approvals have NOT checked in yet
          //.or("visitor_status.is.null,visitor_status.ilike.Approved,visitor_status.ilike.Pending")
          .or("visitor_approval_status.is.null,visitor_approval_status.ilike.approved,visitor_approval_status.ilike.pending");

        if (societyUserId) {
          baseQuery = baseQuery.eq("hosted_by.user_id", societyUserId.trim());
        }

        if (searchTerm && searchTerm.trim() !== "") {
          const cleanSearch = searchTerm.trim();
          baseQuery = baseQuery.or(
            `name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,vehicle_number.ilike.%${cleanSearch}%`
          );
        }

        /* const { data: visitors, count, error: fetchErr } = await baseQuery
          .order("name", { ascending: true })
          .range(offset, offset + limitNum - 1); */
          const { data: visitors, count, error: fetchErr } = await baseQuery
  .order("created_at", { ascending: false })
  .range(offset, offset + limitNum - 1);

        if (fetchErr) throw fetchErr;

        let processedVisitors: any[] = [];
        if (visitors && visitors.length > 0) {
          processedVisitors = await attachSignedURLsToVisitors(
            supabaseAdmin,
            visitors,
            cleanRegNum
          );
        }

        const totalRecords = count ?? 0;
        const totalPages = Math.ceil(totalRecords / limitNum);

        logger.info({
          action: "fetch_pre_approvals_success",
          count: processedVisitors.length,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          Visitors: processedVisitors,
          pagination: {
            currentPage: pageNum,
            pageSize: limitNum,
            totalRecords,
            totalPages,
          },
          visitorId: null,
          success: true,
        });
      }

      // =========================================================================
      // BRANCH 2: REQUEST_APPROVAL
      // =========================================================================
      else if (currentAction === "REQUEST_APPROVAL") {
        const hostedByUuid = societyUserId && String(societyUserId).trim() !== "" ? String(societyUserId).trim() : null;
        const approverUuid = securityGuardId && String(securityGuardId).trim() !== "" ? String(securityGuardId).trim() : null;

        if (hostedByUuid) {
          const { data: resident } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id")
            .eq("user_id", hostedByUuid)
            .eq("society", societyId)
            .maybeSingle();

          if (!resident) {
            return errorResponse("Resident user not found.", 404);
          }
        }

        if (approverUuid) {
          const { data: security } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id")
            .eq("user_id", approverUuid)
            .eq("society", societyId)
            .maybeSingle();

          if (!security) {
            return errorResponse("Security Guard not found.", 404);
          }
        }

        const { data: newVisitor, error: insertErr } = await supabaseAdmin
          .from("SSP_Non_Society_User")
          .insert({
            name: visitorName,
            phone_number: phone,
            delivery_origin: platform,
            vehicle_number: vehicleNumber,
            purpose: purpose,
            role: role,
            gender: gender,
            email: email,
            id_proof_type: idProofType,
            id_proof_number: idProofNumber,
            gate_no: gateNumber,
            vehicle_type: vehicleType,
            visitor_status: "Pending", // Default initial request status
            check_in: null,
            check_out: null,
            hosted_by: hostedByUuid,
            approver: approverUuid,
            society: societyId,
          })
          .select("non_society_user_id")
          .single();

        if (insertErr) throw insertErr;

        logger.info({
          action: "request_approval_success",
          visitorId: newVisitor.non_society_user_id,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          Visitors: [],
          visitorId: newVisitor.non_society_user_id,
          success: true,
        });
      }

      // =========================================================================
      // BRANCH 3: UPDATE_STATUS
      // =========================================================================
      else if (currentAction === "UPDATE_STATUS") {
        if (!visitorId) {
          return errorResponse("visitorId parameter missing from update routing request.", 400);
        }

        const { data: checkVisitor } = await supabaseAdmin
          .from("SSP_Non_Society_User")
          .select("non_society_user_id")
          .eq("non_society_user_id", visitorId)
          .eq("society", societyId)
          .maybeSingle();

        if (!checkVisitor) {
          return errorResponse(`No visitor found with ID: ${visitorId}`, 404);
        }

        const updatePayload: Record<string, any> = {};
        const targetStatus = String(newStatus).trim().toLowerCase();

        if (targetStatus === "inside") {
          updatePayload.check_in = new Date().toISOString();
          updatePayload.check_out = null;
          updatePayload.visitor_status = "Inside";
        } else if (targetStatus === "outside") {
          updatePayload.check_out = new Date().toISOString();
          updatePayload.visitor_status = "Outside";
        } else if (targetStatus === "approved") {
          updatePayload.visitor_status = "Approved";
        } else if (targetStatus === "rejected") {
          updatePayload.visitor_status = "Rejected";
        } else {
          return errorResponse("Invalid status provided. Expected 'Approved', 'Rejected', 'Inside', or 'Outside'.", 400);
        }

        const { error: updateErr } = await supabaseAdmin
          .from("SSP_Non_Society_User")
          .update(updatePayload)
          .eq("non_society_user_id", visitorId);

        if (updateErr) throw updateErr;

        logger.info({
          action: "update_status_success",
          visitorId,
          status: updatePayload.visitor_status,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          Visitors: [],
          visitorId,
          success: true,
        });
      }

      // =========================================================================
      // BRANCH 4: FETCH_INSIDE_LOGS (VISITOR LOGS)
      // =========================================================================
      else if (currentAction === "FETCH_INSIDE_LOGS") {
        let query = supabaseAdmin
          .from("SSP_Non_Society_User")
          .select(
            `
            non_society_user_id,
            name,
            delivery_origin,
            phone_number,
            vehicle_number,
            purpose,
            visitor_status,
            check_in,
            check_out,
            hosted_by:SSP_Society_User!hosted_by(
              user_id,
              unit_flat_number,
              block:SSP_Block(
                block_name
              ),
              tower:SSP_Tower(
                name
              ),
              contact:SSP_Contact(
                name
              )
            )
          `,
            { count: "exact" }
          )
          .eq("society", societyId);

        // Dynamically filter by status if passed (e.g. Approved, Rejected, Inside, Outside), default to "Inside"
        if (newStatus && newStatus.trim() !== "") {
          query = query.ilike("visitor_status", newStatus.trim());
        } else {
          query = query.ilike("visitor_status", "Inside");
        }

        const cleanFlat = flatNumber ? String(flatNumber).trim() : "";
        const cleanBlock = block ? String(block).trim() : "";
        const cleanTower = tower ? String(tower).trim() : "";

        if (cleanFlat !== "") query = query.eq("hosted_by.unit_flat_number", cleanFlat);
        if (cleanBlock !== "") query = query.eq("hosted_by.block.block_name", cleanBlock);
        if (cleanTower !== "") query = query.eq("hosted_by.tower.name", cleanTower);

        if (searchTerm && searchTerm.trim() !== "") {
          const cleanSearch = searchTerm.trim();
          query = query.or(
            `name.ilike.%${cleanSearch}%,phone_number.ilike.%${cleanSearch}%,vehicle_number.ilike.%${cleanSearch}%`
          );
        }

        if (startDate) {
          query = query.gte("created_at", new Date(startDate).toISOString());
        }
        if (endDate) {
          query = query.lte("created_at", new Date(endDate).toISOString());
        }

        // Default to today's entries if no specific location/date filters applied and querying "Inside" status
        if (!cleanFlat && !cleanBlock && !cleanTower && !startDate && !endDate && (!newStatus || newStatus.toLowerCase() === "inside")) {
          const todayStart = new Date();
          todayStart.setUTCHours(0, 0, 0, 0);
          query = query.gte("check_in", todayStart.toISOString());
        }

        const { data: insideVisitors, count, error: logErr } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (logErr) throw logErr;

        let processedVisitors: any[] = [];
        if (insideVisitors && insideVisitors.length > 0) {
          processedVisitors = await attachSignedURLsToVisitors(
            supabaseAdmin,
            insideVisitors,
            cleanRegNum
          );
        }

        const totalRecords = count ?? 0;
        const totalPages = Math.ceil(totalRecords / limitNum);

        logger.info({
          action: "fetch_inside_logs_success",
          count: processedVisitors.length,
          durationMs: Date.now() - startTime,
        });

        return successResponse({
          Visitors: processedVisitors,
          pagination: {
            currentPage: pageNum,
            pageSize: limitNum,
            totalRecords,
            totalPages,
          },
          visitorId: null,
          success: true,
        });
      }

      return errorResponse("Invalid or unmapped actionType operation.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        action: "security_gate_console_error",
        error: err.message,
        durationMs: Date.now() - startTime,
      });

      return errorResponse(
        err.message || "Security gate console execution failed.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null
      );
    }
  })
);

// =============================================================================
// STORAGE RESOURCE HELPER UTIL
// =============================================================================
async function attachSignedURLsToVisitors(
  supabase: SupabaseClient,
  visitorList: any[],
  registrationNumber: string
) {
  const visitorIds = visitorList.map((v) => v.non_society_user_id);

  const { data: docs } = await supabase
    .from("SSP_Document")
    .select("non_society_user, s3_path")
    .in("non_society_user", visitorIds);

  const imageMap = new Map<string, string>();

  docs?.forEach((doc: any) => {
    if (doc.non_society_user && doc.s3_path) {
      imageMap.set(doc.non_society_user, doc.s3_path.trim());
    }
  });

  return await Promise.all(
    visitorList.map(async (v: any) => {
      let finalSignedUrl: string | null = null;
      const rawPath = imageMap.get(v.non_society_user_id);

      if (rawPath) {
        let storageKey = rawPath;

        if (rawPath.includes(".amazonaws.com/")) {
          storageKey = rawPath.split(".amazonaws.com/")[1].trim();
        }

        if (!storageKey.startsWith(`${registrationNumber}/`)) {
          storageKey = `${registrationNumber}/${storageKey}`;
        }

        const { data: signedPayload } = await supabase.storage
          .from(BUCKET_NAME)
          .createSignedUrl(storageKey, 900);

        if (signedPayload) {
          finalSignedUrl = signedPayload.signedUrl;
        }
      }

      return {
        visitorId: v.non_society_user_id,
        name: v.name ?? "",
        phone: v.phone_number ?? "",
        platform: v.delivery_origin ?? "N/A",
        purpose: v.purpose ?? "N/A",
        vehicle: v.vehicle_number ?? "N/A",
        status: v.visitor_status ?? "",
        checkIn: v.check_in ?? null,
        checkOut: v.check_out ?? null, // Included checkOut in returned response payload
        flat: v.hosted_by?.unit_flat_number ?? "N/A",
        block: v.hosted_by?.block?.block_name ?? "N/A",
        tower: v.hosted_by?.tower?.name ?? "N/A",
        residentName: v.hosted_by?.contact?.name ?? "N/A",
        imageUrl: finalSignedUrl,
      };
    })
  );
}