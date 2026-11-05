import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Validator } from "../_shared/validation.ts";
import { sanitizeString, sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
import { ApiError, handleError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const logger = createLogger("get-profile");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const action = "POST /get-profile";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Request body is empty or malformed JSON.", 400);
    }

    // 3. INPUT VALIDATION
    const validator = new Validator();
    validator.validateRequired(body.phoneNumber, "phoneNumber");
    validator.validateRequired(body.registrationNumber, "registrationNumber");
    validator.validateRequired(body.role, "role");

    if (!validator.isValid()) {
      throw new ApiError("BAD_REQUEST", "phoneNumber, registrationNumber and role are mandatory.", 422, validator.getErrors());
    }

    const phoneInput = sanitizeString(String(body.phoneNumber));
    const regNumInput = sanitizeString(String(body.registrationNumber));
    const roleInput = sanitizeString(String(body.role)).toLowerCase().trim();

    // Normalize the requested role (handle "service_agent" vs "service agent")
    const targetRoleNormalized = roleInput.replace(/_/g, " ");

    logger.info({ message: `Starting execution for ${action} - Role: ${targetRoleNormalized}` });

    // Helper for phone normalization
    const phoneDigits = (raw: unknown) => {
      let d = String(raw ?? "").replace(/\D/g, "");
      if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
      if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
      return d;
    };
    const cleanInputPhone = phoneDigits(phoneInput);

    // 4. FETCH SOCIETY CONTEXT
    const { data: societyContext, error: socError } = await supabase
      .from("SSP_Society")
      .select("society_id, address_line1, address_line2, country, city, state, postal_code")
      .ilike("registration_number", regNumInput)
      .maybeSingle();

    if (socError || !societyContext) {
      throw new ApiError("NOT_FOUND", "Society registration profile not found.", 404);
    }

    const societyAddress = {
      addressLine1: societyContext.address_line1 ?? "NA",
      addressLine2: societyContext.address_line2 ?? "NA",
      country: societyContext.country ?? "NA",
      city: societyContext.city ?? "NA",
      state: societyContext.state ?? "NA",
      postalCode: societyContext.postal_code ?? "NA",
    };

    // Initialize response objects
    let contactProfile = null;
    let societyUserDetail = null;
    let serviceAgentDetail = null;
    let vendorDetail = null;
    let targetContactId: string | null = null;

    // 5. FETCH VENDOR PROFILE (If requested)
    if (targetRoleNormalized === "vendor") {
      const { data: vendorData } = await supabase
        .from("SSP_Non_Society_User")
        .select(`non_society_user_id, vendor_id, name, phone_number, role`)
        .ilike("phone_number", `%${cleanInputPhone}%`)
        .eq("society", societyContext.society_id)
        .ilike("role", "vendor")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (vendorData) {
        vendorDetail = {
          vendorId: vendorData.vendor_id ?? vendorData.non_society_user_id ?? "NA",
          name: vendorData.name ?? "NA",
          phoneNumber: vendorData.phone_number ?? "NA",
          role: "vendor", // Hardcode to the requested role
        };
      }
    } 
    // 6. FETCH RESIDENT/STAFF PROFILE (If requested)
    else {
      // Fetch Contact
      const { data: contactData } = await supabase
        .from("SSP_Contact")
        .select(`
          contact_id, name, phone, email, whatsapp_phone, gender, emergency_phone, 
          occupation, vehicle_type, vehicle_registration_number, id_proof_type, id_proof_number, society
        `)
        .ilike("phone", `%${cleanInputPhone}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (contactData) {
        targetContactId = contactData.contact_id;
        contactProfile = {
          contactId: contactData.contact_id,
          fullName: contactData.name ?? "NA",
          phone: contactData.phone ?? "NA",
          email: contactData.email ?? "NA",
          whatsAppPhone: contactData.whatsapp_phone ?? "NA",
          gender: contactData.gender ?? "NA",
          emergencyPhone: contactData.emergency_phone ?? "NA",
          occupation: contactData.occupation ?? "NA",
          vehicleType: contactData.vehicle_type ?? "NA",
          vehicleRegistrationNumber: contactData.vehicle_registration_number ?? "NA",
          idProofType: contactData.id_proof_type ?? "NA",
          idProofNumber: contactData.id_proof_number ?? "NA",
          societyId: contactData.society ?? "NA",
        };

        // Fetch Society User
        const { data: suData } = await supabase
          .from("SSP_Society_User")
          .select(`
            role, unit_flat_number, status, move_in_date, move_out_date, user_ownership_type, user_type,
            agent_availability_status, service_agent_services,
            SSP_Block!left ( block_name ),
            SSP_Tower!left ( name )
          `)
          .eq("contact", targetContactId)
          .eq("society", societyContext.society_id)
          .maybeSingle();

        if (suData) {
          const blockObj = Array.isArray(suData.SSP_Block) ? suData.SSP_Block[0] : suData.SSP_Block;
          const towerObj = Array.isArray(suData.SSP_Tower) ? suData.SSP_Tower[0] : suData.SSP_Tower;

          // FIX: Return the EXACT role that was requested, capitalized properly.
          // Do NOT return the entire array as a string.
          let displayRole = targetRoleNormalized;
          if (displayRole === "service agent") displayRole = "Service Agent";
          else displayRole = displayRole.charAt(0).toUpperCase() + displayRole.slice(1);

          societyUserDetail = {
            role: displayRole, // <--- THIS FIXES THE FLUTTER UI OVERWRITE BUG
            blockName: blockObj?.block_name ?? "NA",
            towerName: towerObj?.name ?? "NA",
            unitFlatNumber: suData.unit_flat_number ?? "NA",
            status: suData.status ? "Active" : "Inactive",
            moveInDate: suData.move_in_date ?? null,
            moveOutDate: suData.move_out_date ?? null,
            ownershipType: suData.user_ownership_type ?? "NA",
            userType: suData.user_type ?? "NA",
          };

          // Populate Service Agent details if this is the requested role
          if (targetRoleNormalized === "service agent") {
            serviceAgentDetail = {
              agentId: targetContactId, // Using contactId as fallback since we didn't select user_id
              name: contactData.name ?? "NA",
              contactId: targetContactId,
              phoneNumber: phoneInput,
              agentAvailabilityStatus: suData.agent_availability_status ?? "NA",
              agentServices: suData.service_agent_services ?? "NA",
            };
          }
        }
      }
    }

    logger.info({ message: `Successfully completed ${action}` });

    return new Response(
      JSON.stringify({
        contact: contactProfile,
        societyUser: societyUserDetail,
        SocietyAddress: societyAddress,
        serviceAgent: serviceAgentDetail,
        vendor: vendorDetail,
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