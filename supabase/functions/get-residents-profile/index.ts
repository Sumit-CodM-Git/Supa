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
    // 1. Initial Request Body Structural Validations
    const bodyText = await req.text()
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400)
    }

    const { societyRegistrationNumber, residentId, role } = JSON.parse(bodyText)

    // 2. Mandatory Validation
    if (!societyRegistrationNumber?.trim() || !residentId?.trim()) {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber and residentId are mandatory.', 400)
    }

    const cleanRegNo = societyRegistrationNumber.trim()
    const cleanResidentId = residentId.trim()

    // 3. Step A: Locate Society Profile safely first via its unique registration_number string
    const { data: societyContext, error: socError } = await supabase
      .from('SSP_Society')
      .select('*')
      .eq('registration_number', cleanRegNo)
      .maybeSingle()

    if (socError) throw new Error(`SSP_Society record identification step failed: ${socError.message}`)
    if (!societyContext) {
      return buildErrorResponse('NOT_FOUND', 'No society registration found matching the identifier provided.', 404)
    }

    // 4. Step B: Build Target Query matrix pulling full relational dependency trees
    let userQuery = supabase
      .from('SSP_Society_User')
      .select(`
        *,
        contact:SSP_Contact!inner(*),
        block:SSP_Block(block_name),
        tower:SSP_Tower(name)
      `)
      .eq('society', societyContext.society_id)

    // Check if the input residentId is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidRegex.test(cleanResidentId)) {
      // If it's a UUID, check the primary key directly
      userQuery = userQuery.eq('user_id', cleanResidentId)
    } else {
      // Otherwise, perform a case-insensitive search against the resident's text name
      userQuery = userQuery.ilike('contact.name', `%${cleanResidentId}%`)
    }

    const { data: userRecords, error: userError } = await userQuery

    if (userError) throw new Error(`SSP_Society_User processing lookup failed: ${userError.message}`)
    if (!userRecords || userRecords.length === 0) {
      return buildErrorResponse('NOT_FOUND', 'No resident profile found for the provided details.', 404)
    }

    // 5. Match role context if supplied in request payload (handling Postgres text[] arrays natively)
    let su = userRecords[0]
    if (role?.trim()) {
      const matchedRoleProfile = userRecords.find((r: any) => 
        r.role && Array.isArray(r.role) && r.role.some((v: string) => v.toLowerCase() === role.trim().toLowerCase())
      )
      if (matchedRoleProfile) su = matchedRoleProfile
    }

    // 6. Build Flexible Field Mapping Wrapper
    const contactContext = su.contact
    const blockContext = su.block
    const towerContext = su.tower

    const derivedSocietyName = societyContext.society_name ?? societyContext.name ?? 'N/A'
    const derivedCity = societyContext.city ?? 'N/A'
    const derivedState = societyContext.state ?? 'N/A'
    const derivedPincode = societyContext.postal_code ?? societyContext.postalCode ?? societyContext.pincode ?? 'N/A'

    const responsePayload = {
      profile: {
        personalInformation: {
          Name: contactContext?.name ?? 'N/A',
          gender: contactContext?.gender ?? 'N/A',
          occupation: contactContext?.occupation ?? 'N/A',
          idProoftype: contactContext?.id_proof_type ?? 'N/A',
          idProofNumber: contactContext?.id_proof_number ?? 'N/A',
          vehicleType: contactContext?.vehicle_type ?? 'N/A',
          vehicleRegistrationNumber: contactContext?.vehicle_registration_number ?? 'N/A'
        },
        contactInformation: {
          contactID: contactContext?.contact_id ?? 'N/A',
          email: contactContext?.email ?? 'N/A',
          phone: contactContext?.phone ?? 'N/A',
          whatsAppPhone: contactContext?.whatsapp_phone ?? 'N/A',
          emergencyPhone: contactContext?.emergency_phone ?? 'N/A'
        },
        residentialInformation: {
          society: derivedSocietyName,
          flatNumber: su.unit_flat_number ?? 'N/A',
          block: blockContext?.name ?? 'N/A',
          tower: towerContext?.name ?? 'N/A',
          city: derivedCity,
          pincode: derivedPincode,
          state: derivedState,
          role: Array.isArray(su.role) ? su.role.join(', ') : (su.role ?? 'N/A')
        }
      },
      errorResponse: null
    }

    return new Response(
      JSON.stringify(responsePayload),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse(
      'SERVER_ERROR',
      `Resident Profile Pipeline Failure: ${error.message || 'Fatal workflow engine initialization exception.'}`,
      500
    )
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      profile: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString()
      }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

interface ContactRecord {
  contact_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp_phone?: string | null;
  gender?: string | null;
  emergency_phone?: string | null;
  occupation?: string | null;
  vehicle_type?: string | null;
  vehicle_registration_number?: string | null;
  id_proof_type?: string | null;
  id_proof_number?: string | null;
}

interface BlockRecord {
  block_name?: string | null;
}

interface TowerRecord {
  name?: string | null;
}

interface ResidentProfileRecord {
  user_id?: string | null;
  role?: string[] | string | null;
  user_type?: string | null;
  unit_flat_number?: string | null;
  user_ownership_type?: string | null;
  status?: boolean | null;
  contact?: ContactRecord | ContactRecord[] | null;
  SSP_Block?: BlockRecord | BlockRecord[] | null;
  SSP_Tower?: TowerRecord | TowerRecord[] | null;
}

interface SocietyContext {
  society_id: string;
  society_name?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

/**
 * Builds a single response profile object from a resident record
 * plus its associated society context.
 */
function buildProfile(record: ResidentProfileRecord, society: SocietyContext) {
  const rawContact = Array.isArray(record.contact) ? record.contact[0] : record.contact;
  const rawBlock = Array.isArray(record.SSP_Block) ? record.SSP_Block[0] : record.SSP_Block;
  const rawTower = Array.isArray(record.SSP_Tower) ? record.SSP_Tower[0] : record.SSP_Tower;

  const derivedSocietyName = society.society_name ?? "NA";
  const derivedCity = society.city ?? "NA";
  const derivedState = society.state ?? "NA";
  const derivedPincode = society.postal_code ?? "NA";

  return {
    userId: record.user_id ?? "NA",
    personalInformation: {
      Name: String(rawContact?.name ?? "NA"),
      gender: String(rawContact?.gender ?? "NA"),
      occupation: String(rawContact?.occupation ?? "NA"),
      idProoftype: String(rawContact?.id_proof_type ?? "NA"),
      idProofNumber: String(rawContact?.id_proof_number ?? "NA"),
      vehicleType: String(rawContact?.vehicle_type ?? "NA"),
      vehicleRegistrationNumber: String(rawContact?.vehicle_registration_number ?? "NA"),
    },
    contactInformation: {
      contactID: String(rawContact?.contact_id ?? "NA"),
      email: String(rawContact?.email ?? "NA"),
      phone: String(rawContact?.phone ?? "NA"),
      whatsAppPhone: String(rawContact?.whatsapp_phone ?? "NA"),
      emergencyPhone: String(rawContact?.emergency_phone ?? "NA"),
    },
    residentialInformation: {
      society: derivedSocietyName,
      flatNumber: record.unit_flat_number ?? "NA",
      block: String(rawBlock?.block_name ?? "NA"),
      tower: String(rawTower?.name ?? "NA"),
      city: derivedCity,
      pincode: derivedPincode,
      state: derivedState,
      role: Array.isArray(record.role) ? record.role.join(", ") : (record.role ?? "NA"),
      userType: record.user_type ?? "NA",
      ownershipType: record.user_ownership_type ?? "NA",
      status: record.status ? "Active" : "Inactive",
    },
  };
}

/**
 * Checks whether a record's role/user_type matches the requested role (case-insensitive).
 */
function matchesRole(record: ResidentProfileRecord, wanted: string): boolean {
  const wantedLc = wanted.toLowerCase();
  const roleArray = Array.isArray(record.role)
    ? record.role.map((v) => String(v).toLowerCase())
    : record.role
      ? [String(record.role).toLowerCase()]
      : [];
  const userType = record.user_type ? String(record.user_type).toLowerCase() : "";
  return roleArray.includes(wantedLc) || userType === wantedLc;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const action = "POST /get-residents-profile";

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. AUTHENTICATION
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      throw new ApiError("UNAUTHORIZED", "Invalid or expired session token", 401);
    }

    // 2. PARSE REQUEST BODY
    const body = await parseRequestBody(req);
    if (!body) {
      throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
    }

    // 3. INPUT VALIDATION
    const validator = new Validator();
    validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");
    validator.validateRequired(body.residentId, "residentId");

    if (!validator.isValid()) {
      throw new ApiError(
        "BAD_REQUEST",
        "societyRegistrationNumber and residentId are mandatory.",
        422,
        validator.getErrors()
      );
    }

    const cleanRegNo = sanitizeString(String(body.societyRegistrationNumber));
    const cleanResidentId = sanitizeString(String(body.residentId));
    const roleInput = body.role ? sanitizeString(String(body.role)) : null;

    // 4. PAGINATION
    const url = new URL(req.url);
    const pageStr = url.searchParams.get("page") || "1";
    const limitStr = url.searchParams.get("limit") || "10";
    const pagination = sanitizePagination(pageStr, limitStr);
    const offset = (pagination.page - 1) * pagination.limit;

    logger.info({ message: `Starting execution for ${action}` });

    // 5. STEP A: LOCATE SOCIETY PROFILE
    const { data: societyContext, error: socError } = await supabase
      .from("SSP_Society")
      .select("society_id, society_name, address_line1, city, state, postal_code")
      .eq("registration_number", cleanRegNo)
      .maybeSingle();

    if (socError) {
      throw new ApiError("SERVER_ERROR", `Society lookup failed: ${socError.message}`, 500);
    }
    if (!societyContext) {
      throw new ApiError("NOT_FOUND", "No society registration found matching the identifier provided.", 404);
    }

    // 6. STEP B: QUERY SOCIETY USER DETAILS
    let userQuery = supabase
      .from("SSP_Society_User")
      .select(`
        user_id, unit_flat_number, status, move_in_date, move_out_date, user_ownership_type, user_type, role,
        contact:SSP_Contact!inner(
          contact_id, name, phone, email, whatsapp_phone, gender, emergency_phone,
          occupation, vehicle_type, vehicle_registration_number, id_proof_type, id_proof_number
        ),
        SSP_Block!left ( block_name ),
        SSP_Tower!left ( name )
      `)
      .eq("society", societyContext.society_id);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(cleanResidentId)) {
      userQuery = userQuery.eq("user_id", cleanResidentId);
    } else {
      userQuery = userQuery.ilike("contact.name", `%${cleanResidentId}%`);
    }

    userQuery = userQuery.range(offset, offset + pagination.limit - 1);

    const { data: userRecords, error: userError } = await userQuery;

    if (userError) {
      throw new ApiError("SERVER_ERROR", `Society user lookup failed: ${userError.message}`, 500);
    }
    if (!userRecords || userRecords.length === 0) {
      throw new ApiError("NOT_FOUND", "No resident profile found for the provided details.", 404);
    }

    // 7. APPLY ROLE FILTER (if provided) — filter the array, don't pick one
    let filteredRecords = userRecords as ResidentProfileRecord[];
    if (roleInput) {
      filteredRecords = filteredRecords.filter((r) => matchesRole(r, roleInput));
    }

    if (filteredRecords.length === 0) {
      throw new ApiError(
        "NOT_FOUND",
        `No resident profile matched the provided details with role "${roleInput}".`,
        404
      );
    }

    // 8. BUILD RESPONSE PROFILES (one per matched resident)
    const profiles = filteredRecords.map((r) => buildProfile(r, societyContext as SocietyContext));

    const responsePayload = {
      profiles,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        retrievedRecords: userRecords.length,   // rows fetched from DB for this page
        returnedProfiles: profiles.length,      // profiles actually returned after role filter
      },
      errorResponse: null,
    };

    logger.info({ message: `Successfully completed ${action}` });

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error({ message: `Error executing ${action}`, details: String(err) });
    return handleError(err);
  }
});