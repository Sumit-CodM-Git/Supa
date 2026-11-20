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
    // 1. Request Body Structure Validation
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const requestObj = JSON.parse(bodyText)
    const { societyRegistrationNumber, residentId, role } = requestObj

    // 2. Mandatory Parameters Validation
    if (!societyRegistrationNumber?.trim() || !residentId?.trim()) {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber and residentId are mandatory.', 400)
    }

    const cleanRegNo = societyRegistrationNumber.trim()
    const cleanResidentId = residentId.trim()

    // 3. Step A: Locate Society Profile safely
    const { data: societyContext, error: socError } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', cleanRegNo)
      .maybeSingle()

    if (socError) throw new Error(`SSP_Society record verification failed: ${socError.message}`)
    if (!societyContext) {
      return buildErrorResponse('NOT_FOUND', 'No society registration found matching the identifier provided.', 404)
    }

    // 4. Step B: Fetch Existing Junctions (Using standard query list array to handle duplicates safely)
    let userQuery = supabase
      .from('SSP_Society_User')
      .select(`
        user_id,
        role,
        contact:SSP_Contact!inner(contact_id, name),
        unit_flat_number,
        block,
        tower
      `)
      .eq('society', societyContext.society_id)

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidRegex.test(cleanResidentId)) {
      userQuery = userQuery.eq('contact', cleanResidentId)
    } else {
      userQuery = userQuery.ilike('contact.name', `%${cleanResidentId}%`)
    }

    const { data: userRecords, error: userError } = await userQuery

    if (userError) throw new Error(`SSP_Society_User retrieval processing failed: ${userError.message}`)
    if (!userRecords || userRecords.length === 0) {
      return buildErrorResponse('NOT_FOUND', 'No resident profile found to update.', 404)
    }

    // FIX: Extract targeted index profile safely using explicit role context matching if available
    let su = userRecords[0]
    if (role?.trim()) {
      const matchedRoleProfile = userRecords.find((r: any) => 
        r.role && Array.isArray(r.role) && r.role.some((v: string) => v.toLowerCase() === role.trim().toLowerCase())
      )
      if (matchedRoleProfile) su = matchedRoleProfile
    }

    // 5. Build Partial Mutation Dictionaries
    const contactUpdates: Record<string, any> = {}
    const userUpdates: Record<string, any> = {}

    if (requestObj.name?.trim() !== undefined) contactUpdates.name = requestObj.name.trim()
    if (requestObj.gender?.trim() !== undefined) contactUpdates.gender = requestObj.gender.trim()
    if (requestObj.occupation?.trim() !== undefined) contactUpdates.occupation = requestObj.occupation.trim()
    if (requestObj.idProofType?.trim() !== undefined) contactUpdates.id_proof_type = requestObj.idProofType.trim()
    if (requestObj.idProofNumber?.trim() !== undefined) contactUpdates.id_proof_number = requestObj.idProofNumber.trim()
    if (requestObj.vehicleType?.trim() !== undefined) contactUpdates.vehicle_type = requestObj.vehicleType.trim()
    if (requestObj.vehicleRegNo?.trim() !== undefined) contactUpdates.vehicle_registration_number = requestObj.vehicleRegNo.trim()

    if (requestObj.email?.trim() !== undefined) contactUpdates.email = requestObj.email.trim()
    if (requestObj.phone?.trim() !== undefined) contactUpdates.phone = requestObj.phone.trim()
    if (requestObj.whatsAppPhone?.trim() !== undefined) contactUpdates.whatsapp_phone = requestObj.whatsAppPhone.trim()
    if (requestObj.emergencyPhone?.trim() !== undefined) contactUpdates.emergency_phone = requestObj.emergencyPhone.trim()

    if (requestObj.flatNumber?.trim() !== undefined) userUpdates.unit_flat_number = requestObj.flatNumber.trim()

    if (requestObj.block?.trim()) {
      const { data: blockData, error: blockErr } = await supabase
        .from('SSP_Block')
        .select('block_id')
        .eq('society', societyContext.society_id)
        .eq('block_name', requestObj.block.trim())
        .maybeSingle()

      if (blockErr) throw new Error(`Block cross-reference lookup failed: ${blockErr.message}`)
      if (blockData) userUpdates.block = blockData.block_id
    }

    if (requestObj.tower?.trim()) {
      const { data: towerData, error: towerErr } = await supabase
        .from('SSP_Tower')
        .select('tower_id')
        .eq('society', societyContext.society_id)
        .eq('name', requestObj.tower.trim())
        .maybeSingle()

      if (towerErr) throw new Error(`Tower cross-reference lookup failed: ${towerErr.message}`)
      if (towerData) userUpdates.tower = towerData.tower_id
    }

    // 6. Execute Atomic Database Updates
    const targetContactId = su.contact?.contact_id || su.contact

    if (Object.keys(contactUpdates).length > 0 && targetContactId) {
      const { error: conUpdateErr } = await supabase
        .from('SSP_Contact')
        .update(contactUpdates)
        .eq('contact_id', targetContactId)

      if (conUpdateErr) throw new Error(`SSP_Contact table mutation transaction aborted: ${conUpdateErr.message}`)
    }

    if (Object.keys(userUpdates).length > 0) {
      const { error: userUpdateErr } = await supabase
        .from('SSP_Society_User')
        .update(userUpdates)
        .eq('user_id', su.user_id)

      if (userUpdateErr) throw new Error(`SSP_Society_User table mutation transaction aborted: ${userUpdateErr.message}`)
    }

    // 7. Success Output Response
    return new Response(
      JSON.stringify({
        profileUpdate: {
          updated: `Profile for ${cleanResidentId} updated successfully.`
        },
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse(
      'SERVER_ERROR',
      `Profile Mutation Pipeline Failure: ${error.message || 'Fatal runtime execution exception.'}`,
      500
    )
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      profileUpdate: null,
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


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ResidentRecord {
  user_id: string;
  role: string[] | null;
  contact:
    | { contact_id: string; name: string }
    | { contact_id: string; name: string }[]
    | null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Authentication Layer
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return buildErrorResponse("UNAUTHORIZED", "Missing Authorization header.", 401);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user: authUser },
      error: authErr,
    } = await supabase.auth.getUser(token);

    if (authErr || !authUser) {
      return buildErrorResponse("UNAUTHORIZED", "Invalid or expired authorization token.", 401);
    }

    // 2. Request Body Parsing
    const bodyText = await req.text();
    if (!bodyText || bodyText.trim() === "") {
      return buildErrorResponse("BAD_REQUEST", "Request body is empty.", 400);
    }

    const requestObj = JSON.parse(bodyText) as Record<string, unknown>;
    const {
      operation = "UPDATE",
      societyRegistrationNumber,
      residentId,
      page = 1,
      limit = 10,
      search,
      filterRole,
      filterStatus,
      filterUserType,
      filterUserOwnershipType,
      filterTower,
      filterBlock,
    } = requestObj;

    // 3. Global Mandatory Context Validation
    if (typeof societyRegistrationNumber !== "string" || !societyRegistrationNumber.trim()) {
      return buildErrorResponse("BAD_REQUEST", "societyRegistrationNumber is mandatory.", 400);
    }

    const cleanRegNo = societyRegistrationNumber.trim();
    const opString = typeof operation === "string" ? operation.toUpperCase() : "UPDATE";

    // 4. Verify Society Context
    const { data: societyContext, error: socError } = await supabase
      .from("SSP_Society")
      .select("society_id")
      .eq("registration_number", cleanRegNo)
      .maybeSingle();

    if (socError) {
      throw new Error(`SSP_Society verification failed: ${socError.message}`);
    }
    if (!societyContext) {
      return buildErrorResponse("NOT_FOUND", "No society registration found matching the identifier provided.", 404);
    }

    // =========================================================================
    // OPERATION A: FETCH (Paginated & Filtered Directory Query - NO residentId required)
    // =========================================================================
    if (opString === "FETCH") {
      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
      const offset = (pageNum - 1) * limitNum;

      let query = supabase
        .from("SSP_Society_User")
        .select(
          `
          user_id,
          unit_flat_number,
          role,
          user_type,
          user_ownership_type,
          status,
          move_in_date,
          move_out_date,
          tower:SSP_Tower(tower_id, name),
          block:SSP_Block(block_id, block_name),
          contact:SSP_Contact!inner(
            contact_id,
            name,
            description,
            email,
            phone,
            whatsapp_phone,
            emergency_phone,
            gender,
            occupation,
            id_proof_type,
            id_proof_number,
            vehicle_type,
            vehicle_registration_number
          )
        `,
          { count: "exact" },
        )
        .eq("society", societyContext.society_id);

      // Apply Filters
      if (filterStatus !== undefined) {
        query = query.eq("status", Boolean(filterStatus));
      }
      if (typeof filterUserType === "string" && filterUserType.trim()) {
        query = query.eq("user_type", filterUserType.trim());
      }
      if (typeof filterUserOwnershipType === "string" && filterUserOwnershipType.trim()) {
        query = query.eq("user_ownership_type", filterUserOwnershipType.trim());
      }
      if (filterTower) query = query.eq("tower", filterTower);
      if (filterBlock) query = query.eq("block", filterBlock);
      if (typeof filterRole === "string" && filterRole.trim()) {
        query = query.contains("role", [filterRole.trim()]);
      }

      // General Text Search Across Name, Phone, Email, and Flat Number
     if (typeof search === "string" && search.trim()) {
  const term = search.trim();
  
  // 1. Fetch matching contact IDs first
  const { data: matchedContacts } = await supabase
    .from("SSP_Contact")
    .select("contact_id")
    .or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);

  const contactIds = matchedContacts?.map((c) => c.contact_id) || [];

  // 2. Query main table matching flat number OR contact UUIDs
  if (contactIds.length > 0) {
    query = query.or(`unit_flat_number.ilike.%${term}%,contact.in.(${contactIds.join(",")})`);
  } else {
    query = query.ilike("unit_flat_number", `%${term}%`);
  }
}

      const { data: records, count: totalRecords, error: fetchError } = await query
        .range(offset, offset + limitNum - 1)
        .order("created_at", { ascending: false });

      if (fetchError) throw new Error(`Fetch failed: ${fetchError.message}`);

      return new Response(
        JSON.stringify({
          profileUpdate: null,
          data: {
            pagination: {
              total: totalRecords || 0,
              page: pageNum,
              limit: limitNum,
              totalPages: Math.ceil((totalRecords || 0) / limitNum),
            },
            residents: records,
          },
          errorResponse: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =========================================================================
    // OPERATION B: UPDATE (Resident Profile Mutation - residentId IS mandatory)
    // =========================================================================
    if (typeof residentId !== "string" || !residentId.trim()) {
      return buildErrorResponse("BAD_REQUEST", "residentId is mandatory for UPDATE operation.", 400);
    }

    const cleanResidentId = residentId.trim();

    // Locate Target Resident Junction Record
    let userQuery = supabase
      .from("SSP_Society_User")
      .select(
        `
        user_id,
        role,
        contact:SSP_Contact!inner(contact_id, name)
      `,
      )
      .eq("society", societyContext.society_id);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(cleanResidentId)) {
      userQuery = userQuery.or(`user_id.eq.${cleanResidentId},contact.eq.${cleanResidentId}`);
    } else {
      userQuery = userQuery.ilike("contact.name", `%${cleanResidentId}%`);
    }

    const { data: rawUserRecords, error: userError } = await userQuery;

    if (userError) throw new Error(`Resident retrieval failed: ${userError.message}`);
    if (!rawUserRecords || rawUserRecords.length === 0) {
      return buildErrorResponse("NOT_FOUND", "No resident profile found to update.", 404);
    }

    const userRecords = rawUserRecords as unknown as ResidentRecord[];

    // Select Target Profile Instance
    let su = userRecords[0];
    if (requestObj.role) {
      const targetRole = Array.isArray(requestObj.role)
        ? String(requestObj.role[0])
        : String(requestObj.role);
      const matchedRoleProfile = userRecords.find(
        (r) =>
          r.role &&
          Array.isArray(r.role) &&
          r.role.some((v: string) => v.toLowerCase() === targetRole.trim().toLowerCase()),
      );
      if (matchedRoleProfile) su = matchedRoleProfile;
    }

    // Build Mutation Object Dictionaries
    const contactUpdates: Record<string, unknown> = {};
    const userUpdates: Record<string, unknown> = {};

    // Validation & Population: SSP_Contact Fields
    if (requestObj.name !== undefined) contactUpdates.name = validateString("name", requestObj.name);
    if (requestObj.description !== undefined) contactUpdates.description = validateString("description", requestObj.description);
    if (requestObj.gender !== undefined) contactUpdates.gender = validateString("gender", requestObj.gender);
    if (requestObj.occupation !== undefined) contactUpdates.occupation = validateString("occupation", requestObj.occupation);
    if (requestObj.idProofType !== undefined) contactUpdates.id_proof_type = validateString("idProofType", requestObj.idProofType);
    if (requestObj.idProofNumber !== undefined) contactUpdates.id_proof_number = validateString("idProofNumber", requestObj.idProofNumber);
    if (requestObj.vehicleType !== undefined) contactUpdates.vehicle_type = validateString("vehicleType", requestObj.vehicleType);
    if (requestObj.vehicleRegNo !== undefined) contactUpdates.vehicle_registration_number = validateString("vehicleRegNo", requestObj.vehicleRegNo);

    if (requestObj.email !== undefined) {
      const email = validateString("email", requestObj.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return buildErrorResponse("VALIDATION_ERROR", "Invalid email format.", 400);
      }
      contactUpdates.email = email;
    }

    if (requestObj.phone !== undefined) contactUpdates.phone = validateString("phone", requestObj.phone);
    if (requestObj.whatsAppPhone !== undefined) contactUpdates.whatsapp_phone = validateString("whatsAppPhone", requestObj.whatsAppPhone);
    if (requestObj.emergencyPhone !== undefined) contactUpdates.emergency_phone = validateString("emergencyPhone", requestObj.emergencyPhone);

    // Validation & Population: SSP_Society_User Fields
    if (requestObj.flatNumber !== undefined) userUpdates.unit_flat_number = validateString("flatNumber", requestObj.flatNumber);
    if (requestObj.status !== undefined) userUpdates.status = Boolean(requestObj.status);
    if (requestObj.userType !== undefined) userUpdates.user_type = validateString("userType", requestObj.userType);
    if (requestObj.userOwnershipType !== undefined) userUpdates.user_ownership_type = validateString("userOwnershipType", requestObj.userOwnershipType);

    if (requestObj.moveInDate !== undefined) {
      userUpdates.move_in_date = validateDate("moveInDate", requestObj.moveInDate);
    }
    if (requestObj.moveOutDate !== undefined) {
      userUpdates.move_out_date = validateDate("moveOutDate", requestObj.moveOutDate);
    }

    if (requestObj.role !== undefined) {
      if (Array.isArray(requestObj.role)) {
        userUpdates.role = requestObj.role.map((r: unknown) => String(r).trim());
      } else if (typeof requestObj.role === "string") {
        userUpdates.role = [requestObj.role.trim()];
      }
    }

    // Resolve Block UUID Reference
    if (typeof requestObj.block === "string" && requestObj.block.trim()) {
      const { data: blockData, error: blockErr } = await supabase
        .from("SSP_Block")
        .select("block_id")
        .eq("society", societyContext.society_id)
        .eq("block_name", requestObj.block.trim())
        .maybeSingle();

      if (blockErr) throw new Error(`Block lookup failed: ${blockErr.message}`);
      if (blockData) userUpdates.block = blockData.block_id;
    }

    // Resolve Tower UUID Reference
    if (typeof requestObj.tower === "string" && requestObj.tower.trim()) {
      const { data: towerData, error: towerErr } = await supabase
        .from("SSP_Tower")
        .select("tower_id")
        .eq("society", societyContext.society_id)
        .eq("name", requestObj.tower.trim())
        .maybeSingle();

      if (towerErr) throw new Error(`Tower lookup failed: ${towerErr.message}`);
      if (towerData) userUpdates.tower = towerData.tower_id;
    }

    // Execute Mutation Transactions
    let targetContactId: string | null = null;
    if (Array.isArray(su.contact)) {
      targetContactId = su.contact[0]?.contact_id || null;
    } else if (su.contact && typeof su.contact === "object") {
      targetContactId = su.contact.contact_id || null;
    }

    if (Object.keys(contactUpdates).length > 0 && targetContactId) {
      const { error: conUpdateErr } = await supabase
        .from("SSP_Contact")
        .update(contactUpdates)
        .eq("contact_id", targetContactId);

      if (conUpdateErr) throw new Error(`SSP_Contact mutation failed: ${conUpdateErr.message}`);
    }

    if (Object.keys(userUpdates).length > 0) {
      const { error: userUpdateErr } = await supabase
        .from("SSP_Society_User")
        .update(userUpdates)
        .eq("user_id", su.user_id);

      if (userUpdateErr) throw new Error(`SSP_Society_User mutation failed: ${userUpdateErr.message}`);
    }

    return new Response(
      JSON.stringify({
        profileUpdate: {
          updated: `Profile for identifier '${cleanResidentId}' updated successfully.`,
          recordId: su.user_id,
          contactId: targetContactId,
        },
        errorResponse: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Fatal execution error.";
    return buildErrorResponse(
      "SERVER_ERROR",
      `Profile Mutation Pipeline Failure: ${errorMessage}`,
      500,
    );
  }
});

// Helper Functions
function validateString(fieldName: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Field '${fieldName}' must be a string.`);
  }
  return value.trim();
}

function validateDate(fieldName: string, value: unknown): string | null {
  if (!value) return null;
  const dateStr = String(value).trim();
  if (isNaN(Date.parse(dateStr))) {
    throw new Error(`Field '${fieldName}' must be a valid ISO date string (YYYY-MM-DD).`);
  }
  return dateStr;
}

function buildErrorResponse(code: string, message: string, statusCode: number): Response {
  return new Response(
    JSON.stringify({
      profileUpdate: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString(),
      },
    }),
    { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}