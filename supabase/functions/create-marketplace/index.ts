/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  try {
    const bodyText = await req.text();
    if (!bodyText || bodyText.trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400);
    }
    const requestObj = JSON.parse(bodyText);
    const { societyRegistrationNumber, residentId, title, category, price, priceType, status, description } = requestObj;
    // 1. Conditional Pricing Form Field Check
    const isPriceMissing = priceType !== 'Free' && (!price || String(price).trim() === '');
    // 2. Mandatory Parameter Verification Validation Guard
    if (!societyRegistrationNumber || !residentId || !title || !category || isPriceMissing) {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber, residentId, title, category and price are mandatory and price is mandatory unless the item is Free.', 400);
    }
    // 3. Resolve Target Society Schema Pointer Context
    const { data: society, error: societyErr } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', societyRegistrationNumber.trim()).maybeSingle();
    if (societyErr || !society) {
      return buildErrorResponse('NOT_FOUND', 'Society not found.', 404);
    }
    // 4. Resolve the Listing Author Resident User Record Context Instance
    const { data: resident, error: residentErr } = await supabase.from('SSP_Society_User').select('user_id').eq('user_id', residentId.trim()).eq('society', society.society_id).maybeSingle();
    if (residentErr || !resident) {
      return buildErrorResponse('NOT_FOUND', 'Society user not found for provided residentId.', 404);
    }
    // 5. Parse Type Conversion Rules to Safely Cast Price Value
    let calculatedPrice = 0;
    if (priceType !== 'Free' && price) {
      calculatedPrice = parseFloat(price);
      if (isNaN(calculatedPrice)) {
        return buildErrorResponse('BAD_REQUEST', 'Provided price string value cannot be cast to an accurate numeric float.', 400);
      }
    }
    // 6. Map Object Payload for Marketplace Insertion
    const insertPayload = {
      title: title.trim(),
      category: category.trim(),
      price: calculatedPrice,
      price_type: priceType ? priceType.trim() : 'Fixed',
      status: status ? status.trim() : 'Active',
      description: description ? description.trim() : null,
      society_user: resident.user_id // Maps to the original mp.societyUser__c pointer relation field
    };
    // 7. Write Data Transaction Entry row to table layer
    const { data: newListing, error: insertErr } = await supabase.from('SSP_Market_Place').insert(insertPayload).select('id').single();
    if (insertErr) {
      throw new Error(`Database listing insertion rejected execution: ${insertErr.message}`);
    }
    // 8. Construct Structural Data Transfer Object (DTO) Success Output Package
    return new Response(JSON.stringify({
      marketPlace: {
        marketPlaceId: newListing.id,
        isCreated: true
      },
      errorResponse: null
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return buildErrorResponse('SERVER_ERROR', error.message || 'Fatal execution catch trace.', 500);
  }
});
function buildErrorResponse(code, message, statusCode) {
  return new Response(JSON.stringify({
    marketPlace: null,
    errorResponse: {
      errorCode: code,
      message: message,
      timestamp: new Date().toISOString()
    }
  }), {
    status: statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}*/
import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const BUCKET_NAME = "society-documents";

// ============================================
// TYPES
// ============================================
interface FilePayload {
  fileName: string;
  fileType?: string;
  fileSize?: number | string;
}

interface CreateMarketplaceRequest {
  registrationNumber: string;
  title: string;
  category: string;
  price?: number | string;
  priceType?: string;
  status?: string;
  description?: string;
  files: FilePayload[];
}

interface AuthUser {
  id: string;
  email?: string;
}

interface AuthContext {
  user: AuthUser;
}

interface DocumentInsertPayload {
  name: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  document_type: string;
  s3_path: string;
  society: string;
  marketplace: number;
  uploaded_by: string;
  uploaded_on: string;
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

    try {
      console.log("🛒 create-marketplace called");
      console.log(`👤 Authenticated user (Auth ID): ${authCtx.user.id}`);

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body: CreateMarketplaceRequest | null = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const {
        registrationNumber,
        title,
        category,
        price,
        priceType,
        status,
        description,
        files,
      } = body;

      // Extract & trim inputs
      const regNum = registrationNumber ? String(registrationNumber).trim() : "";
      const trimmedTitle = title ? String(title).trim() : "";
      const trimmedCategory = category ? String(category).trim() : "";
      const trimmedPriceType = priceType ? String(priceType).trim() : "Fixed";

      const isPriceMissing =
        trimmedPriceType.toLowerCase() !== "free" &&
        (price === undefined || price === null || String(price).trim() === "");

      // 1. Mandatory Fields Validation
      if (!regNum || !trimmedTitle || !trimmedCategory || isPriceMissing) {
        return errorResponse(
          "registrationNumber, title, category, and price are mandatory (unless priceType is 'Free').",
          400,
        );
      }

      // 2. Strict Image Count Validation (Minimum 1, Maximum 5)
      if (!files || !Array.isArray(files) || files.length === 0) {
        return errorResponse("At least one image file is required to create a post.", 400);
      }

      if (files.length > 5) {
        return errorResponse("You can upload a maximum of 5 images per listing.", 400);
      }

      // Validate individual file objects
      for (const [index, f] of files.entries()) {
        if (!f || !f.fileName || String(f.fileName).trim() === "") {
          return errorResponse(`File item at index ${index} is missing 'fileName'.`, 400);
        }
      }

      // Safe price casting
      let calculatedPrice = 0;
      if (trimmedPriceType.toLowerCase() !== "free" && price !== undefined) {
        calculatedPrice = parseFloat(String(price));
        if (isNaN(calculatedPrice)) {
          return errorResponse(
            "Provided price value cannot be cast to a valid numeric float.",
            400,
          );
        }
      }

      // ============================================
      // STEP 1: Resolve Society Context
      // ============================================
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        console.error("❌ Society resolution error:", socErr);
        return errorResponse("Failed to verify society context.", 500);
      }

      if (!society) {
        return errorResponse("Target society context not found.", 404);
      }

      // ============================================
      // STEP 2: Verify Authenticated Resident Membership
      // ============================================
      const { data: resident, error: residentErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", authCtx.user.id)
        .eq("society", society.society_id)
        .maybeSingle();

      if (residentErr) {
        console.error("❌ Resident resolution error:", residentErr);
        return errorResponse("Failed to verify resident record.", 500);
      }

      if (!resident) {
        return errorResponse(
          "Authenticated user is not an active resident of this society.",
          403,
        );
      }

      // ============================================
      // STEP 3: Create Marketplace Base Record
      // ============================================
      const insertPayload = {
        title: trimmedTitle,
        category: trimmedCategory,
        price: calculatedPrice,
        price_type: trimmedPriceType,
        status: status ? String(status).trim() : "Active",
        description: description ? String(description).trim() : null,
        society_user: resident.user_id,
      };

      const { data: newListing, error: insertErr } = await supabaseAdmin
        .from("SSP_Market_Place")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertErr || !newListing) {
        console.error("❌ Marketplace insertion error:", insertErr);
        return errorResponse(
          `Database listing insertion failed: ${insertErr?.message}`,
          500,
        );
      }

      const marketPlaceId = newListing.id;
      console.log(`✅ Marketplace item created successfully with ID: ${marketPlaceId}`);

      // ============================================
      // STEP 4: Generate Signed Upload URLs & Insert SSP_Document Records
      // ============================================
      const docsToInsert: DocumentInsertPayload[] = [];
      const signedUploadUrls: { fileName: string; uploadUrl: string }[] = [];

      // Clean registration number (keep only alphanumeric, hyphens, underscores)
      const safeRegNum = regNum.replace(/[^a-zA-Z0-9_-]/g, "");

      for (const f of files) {
        const rawFileName = String(f.fileName).trim();

        // Strip path traversal and extract raw filename
        const baseName = rawFileName.split("/").pop()?.split("\\").pop() || "image.jpg";
        
        // Clean filename (keep only alphanumeric, dots, hyphens, underscores)
        const cleanFileName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");

        const uniqueToken = Date.now().toString() + "_" + crypto.randomUUID().slice(0, 8);
        const uniqueFileName = uniqueToken + "_" + cleanFileName;

        // Direct explicit concatenation
        const objectKey = safeRegNum + "/marketplace/" + marketPlaceId + "/" + uniqueFileName;

        console.log("📌 Generated S3 Key:", objectKey);

        // Generate Signed Upload URL
        const { data: uploadUrlData, error: uploadUrlErr } = await supabaseAdmin
          .storage
          .from(BUCKET_NAME)
          .createSignedUploadUrl(objectKey);

        if (uploadUrlErr || !uploadUrlData) {
          console.error("❌ Signed URL generation failed:", uploadUrlErr);

          // Rollback: delete created marketplace entry if image allocation fails
          await supabaseAdmin.from("SSP_Market_Place").delete().eq("id", marketPlaceId);

          return errorResponse(
            "Failed generating upload link for image '" + rawFileName + "': " + uploadUrlErr?.message,
            500,
          );
        }

        // Get public path for SSP_Document record
        const { data: urlInfo } = supabaseAdmin
          .storage
          .from(BUCKET_NAME)
          .getPublicUrl(objectKey);

        docsToInsert.push({
          name: rawFileName,
          file_name: uniqueFileName,
          file_type: f.fileType || null,
          file_size: f.fileSize ? parseFloat(String(f.fileSize)) : null,
          document_type: "market_place_image",
          s3_path: urlInfo.publicUrl,
          society: society.society_id,
          marketplace: marketPlaceId, // Connects document to marketplace item
          uploaded_by: resident.user_id, // Connects document to uploader
          uploaded_on: new Date().toISOString(),
        });

        signedUploadUrls.push({
          fileName: rawFileName,
          uploadUrl: uploadUrlData.signedUrl,
        });
      }

      // Safeguard: Log count & insert ONLY if documents exist
      console.log(`📌 Inserting exactly ${docsToInsert.length} document record(s) into SSP_Document...`);

      if (docsToInsert.length > 0) {
        const { data: insertedDocs, error: docInsertErr } = await supabaseAdmin
          .from("SSP_Document")
          .insert(docsToInsert)
          .select("document_id"); // Returns inserted rows to confirm actual inserted count

        if (docInsertErr) {
          console.error("❌ Document tracking record creation failed:", docInsertErr);

          // Rollback created marketplace listing
          await supabaseAdmin.from("SSP_Market_Place").delete().eq("id", marketPlaceId);

          return errorResponse(
            `Failed logging image documents into database: ${docInsertErr.message}`,
            500,
          );
        }

        console.log(`✅ Successfully inserted ${insertedDocs?.length || 0} row(s) into SSP_Document.`);
      }

      // ============================================
      // STEP 5: Success Response
      // ============================================
      return successResponse({
        marketPlaceId: marketPlaceId,
        isCreated: true,
        imageCount: signedUploadUrls.length,
        uploadUrls: signedUploadUrls,
      });

    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : "Failed to create marketplace item";
      console.error("❌ create-marketplace runtime error:", error);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: "SERVER_ERROR",
          message: errMessage,
          errorResponse: {
            errorCode: "SERVER_ERROR",
            message: errMessage,
            timestamp: new Date().toISOString(),
          },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  }),
);