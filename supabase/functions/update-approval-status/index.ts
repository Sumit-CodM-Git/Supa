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
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const requestObj = JSON.parse(bodyText)
    const { actionType, societyRegistrationNumber, visitorId } = requestObj

    if (!actionType || !societyRegistrationNumber || !visitorId) {
      return buildErrorResponse('BAD_REQUEST', 'actionType, societyRegistrationNumber, and visitorId are mandatory fields.', 400)
    }

    // 1. Fetch Visitor directly using the exact non_society_user_id column
    const { data: visitor, error: fetchErr } = await supabase
      .from('SSP_Non_Society_User')
      .select('*')
      .eq('non_society_user_id', visitorId.trim())
      .maybeSingle()

    if (fetchErr) {
      return buildErrorResponse('DATABASE_ERROR', `Visitor lookup query failed: ${fetchErr.message}`, 500)
    }

    if (!visitor) {
      return buildErrorResponse('NOT_FOUND', `No visitor found with the provided ID: ${visitorId}`, 404)
    }

    const hostUserId = visitor.hosted_by

    if (!hostUserId) {
      return buildErrorResponse('DATABASE_ERROR', 'Visitor record is missing a valid host relationship pointer.', 500)
    }

    // 2. Verify Host User maps to the requested Society Registry (Using 'user_id' from your DDL schema)
    const { data: hostVerification, error: hostErr } = await supabase
      .from('SSP_Society_User')
      .select(`
        user_id,
        SSP_Society!inner(
          registration_number
        )
      `)
      .eq('user_id', hostUserId) // Fixed: Changed from 'id' to 'user_id'
      .eq('SSP_Society.registration_number', societyRegistrationNumber.trim())
      .maybeSingle()

    if (hostErr) {
      return buildErrorResponse('DATABASE_ERROR', `Host verification query failed: ${hostErr.message}`, 500)
    }

    if (!hostVerification) {
      return buildErrorResponse('ACCESS_DENIED', `This visitor is registered under a host that does not belong to society registry: ${societyRegistrationNumber}`, 403)
    }

    // 3. State Engine Controller Evaluator
    let newStatus = visitor.visitor_approval_status
    let responseFlag = false
    const normalizedAction = actionType.toLowerCase().trim()

    if (normalizedAction === 'sendforapproval') {
      newStatus = 'Pending'
      responseFlag = false
    } else if (normalizedAction === 'approved') {
      newStatus = 'Approved'
      responseFlag = true
    } else if (normalizedAction === 'reject') {
      newStatus = 'Rejected'
      responseFlag = true
    } else {
      return buildErrorResponse('BAD_REQUEST', `Invalid actionType provided: ${actionType}. Must be SendForApproval, Approved, or Reject.`, 400)
    }

    // 4. Mutate the target row using the confirmed string primary key
    const { error: updateErr } = await supabase
      .from('SSP_Non_Society_User')
      .update({ visitor_approval_status: newStatus })
      .eq('non_society_user_id', visitor.non_society_user_id)

    if (updateErr) {
      return buildErrorResponse('DATABASE_ERROR', `Failed to update visitor status: ${updateErr.message}`, 500)
    }

    return new Response(
      JSON.stringify({
        status: {
          result: responseFlag
        },
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', `Status processing failed: ${error.message}`, 500)
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      status: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString()
      }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shared standard imports
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import { successResponse } from "../_shared/response.ts";
import { ApiError, ErrorCodes, handleError } from "../_shared/errors.ts";
import { validateRequired } from "../_shared/validation.ts";
import { sanitizeString } from "../_shared/sanitizer.ts";
import { ArrayHandler } from "../_shared/array-handler.ts";
import { logger } from "../_shared/logger.ts";

serve(
  requireAuth(async (req: Request, _ctx: AuthContext) => {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // 1. Request Parsing & Body Validation
      const bodyText = await req.text();
      if (!validateRequired(bodyText)) {
        throw new ApiError(ErrorCodes.BAD_REQUEST, "Request body is empty.", 400);
      }

      const payload = JSON.parse(bodyText);
      const {
        actionType,
        societyRegistrationNumber,
        visitorId,
        page = 1,
        limit = 10,
        filters = {},
      } = payload;

      // Validate mandatory fields using validation.ts helper
      if (
        !validateRequired(actionType) ||
        !validateRequired(societyRegistrationNumber) ||
        !validateRequired(visitorId)
      ) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          "Missing required fields: actionType, societyRegistrationNumber, and visitorId are required.",
          400
        );
      }

      // Pagination setup & numeric parsing
      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Number(limit) || 10);
      const offset = (pageNum - 1) * limitNum;

      // Input Sanitization
      const cleanAction = sanitizeString(actionType).toLowerCase();
      const cleanRegNum = sanitizeString(societyRegistrationNumber);
      const cleanVisitorId = sanitizeString(visitorId);

      // Extract Filters
      const { approvalStatusFilter, serviceTypeFilter, searchQuery } = filters;

      // 2. Visitor & Host Verification Lookup
      const { data: visitor, error: fetchErr } = await supabase
        .from("SSP_Non_Society_User")
        .select("*")
        .eq("non_society_user_id", cleanVisitorId)
        .maybeSingle();

      if (fetchErr) {
        logger.error({
          action: "updateApprovalStatus",
          message: `Visitor lookup failed: ${fetchErr.message}`,
        });
        throw new ApiError(
          ErrorCodes.SERVER_ERROR,
          `Visitor lookup query failed: ${fetchErr.message}`,
          500
        );
      }
      if (!visitor) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          `No visitor found with ID: ${cleanVisitorId}`,
          404
        );
      }

      const hostUserId = visitor.hosted_by;
      if (!hostUserId) {
        throw new ApiError(
          ErrorCodes.SERVER_ERROR,
          "Visitor record is missing host relationship pointer.",
          500
        );
      }

      // Verify Host against Society Registration Number
      const { data: hostVerification, error: hostErr } = await supabase
        .from("SSP_Society_User")
        .select(`
          user_id,
          SSP_Society!inner ( registration_number )
        `)
        .eq("user_id", hostUserId)
        .eq("SSP_Society.registration_number", cleanRegNum)
        .maybeSingle();

      if (hostErr) {
        logger.error({
          action: "updateApprovalStatus",
          message: `Host verification failed: ${hostErr.message}`,
        });
        throw new ApiError(
          ErrorCodes.SERVER_ERROR,
          `Host verification query failed: ${hostErr.message}`,
          500
        );
      }
      if (!hostVerification) {
        throw new ApiError(
          ErrorCodes.FORBIDDEN,
          `Visitor host does not belong to society: ${cleanRegNum}`,
          403
        );
      }

      // 3. State Machine Evaluation & Status Update
      let newStatus: string;
      let responseFlag: boolean;

      switch (cleanAction) {
        case "sendforapproval":
          newStatus = "Pending";
          responseFlag = false;
          break;
        case "approved":
          newStatus = "Approved";
          responseFlag = true;
          break;
        case "reject":
          newStatus = "Rejected";
          responseFlag = true;
          break;
        default:
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            `Invalid actionType: '${actionType}'. Allowed values: SendForApproval, Approved, Reject.`,
            400
          );
      }

      const { error: updateErr } = await supabase
        .from("SSP_Non_Society_User")
        .update({ visitor_approval_status: newStatus })
        .eq("non_society_user_id", visitor.non_society_user_id);

      if (updateErr) {
        logger.error({
          action: "updateApprovalStatus",
          message: `Status update error: ${updateErr.message}`,
        });
        throw new ApiError(
          ErrorCodes.SERVER_ERROR,
          `Failed to update visitor approval status: ${updateErr.message}`,
          500
        );
      }

      // 4. Query Updated Paginated Visitors List
      let visitorQuery = supabase
        .from("SSP_Non_Society_User")
        .select(
          `
          non_society_user_id,
          name,
          phone_number,
          role,
          service_type,
          visitor_approval_status,
          created_at
        `,
          { count: "exact" }
        )
        .eq("hosted_by", hostUserId);

      if (approvalStatusFilter) {
        visitorQuery = visitorQuery.eq(
          "visitor_approval_status",
          sanitizeString(approvalStatusFilter)
        );
      }

      if (serviceTypeFilter) {
        visitorQuery = visitorQuery.ilike(
          "service_type",
          `%${sanitizeString(serviceTypeFilter)}%`
        );
      }

      if (searchQuery) {
        const cleanSearch = sanitizeString(searchQuery);
        visitorQuery = visitorQuery.or(
          `name.ilike.%\({cleanSearch}%,phone_number.ilike.%\){cleanSearch}%`
        );
      }

      const {
        data: updatedVisitors,
        count: totalVisitors,
        error: listErr,
      } = await visitorQuery
        .order("created_at", { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (listErr) {
        logger.warn({
          action: "updateApprovalStatus",
          message: `Paginated fetch warning: ${listErr.message}`,
        });
      }

      const totalCount = totalVisitors ?? 0;

      // Clean role arrays using ArrayHandler
      const normalizedVisitors = (updatedVisitors ?? []).map((v) => ({
        ...v,
        role: ArrayHandler.toArray(v.role),
      }));

      // 5. Success Response Construction
      return successResponse({
        status: {
          result: responseFlag,
          updatedStatus: newStatus,
        },
        visitors: normalizedVisitors,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalVisitors: totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
        },
      });
    } catch (err: unknown) {
      return handleError(err);
    }
  })
);