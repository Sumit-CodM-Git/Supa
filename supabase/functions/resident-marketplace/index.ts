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
    const { 
      operation, 
      societyRegistrationNumber, 
      phoneNumber, 
      residentId,
      marketPlaceId,
      title,
      category,
      price,
      priceType,
      status,
      description
    } = requestObj

    // 1. Validate Mandatory Request Ground Rules
    if (!operation || !societyRegistrationNumber || !phoneNumber || !residentId) {
      return buildErrorResponse('BAD_REQUEST', 'operation, societyRegistrationNumber, phoneNumber and residentId are mandatory.', 400)
    }

    const opUpper = operation.toUpperCase()

    // 2. Resolve Target Context Society Row
    const { data: society, error: societyErr } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', societyRegistrationNumber.trim())
      .maybeSingle()

    if (societyErr || !society) {
      return buildErrorResponse('NOT_FOUND', 'Target society context reference missing.', 404)
    }

    // 3. Resolve Requesting Resident Context Profile (Omitting raw phone column to prevent schema errors)
    const { data: resident, error: residentErr } = await supabase
      .from('SSP_Society_User')
      .select('user_id')
      .eq('user_id', residentId.trim())
      .eq('society', society.society_id)
      .maybeSingle()

    if (residentErr || !resident) {
      return buildErrorResponse('NOT_FOUND', 'Society user profile not matching context identifiers.', 404)
    }

    // ==========================================
    // OPERATION LAYER 1: FETCH LISTINGS
    // ==========================================
    if (opUpper === 'FETCH') {
      const { data: records, error: fetchErr } = await supabase
        .from('SSP_Market_Place')
        .select('id, title, category, price, price_type, status, description')
        .eq('society_user', resident.user_id)
        .order('created_at', { ascending: false })

      if (fetchErr) throw fetchErr

      const mappedMarketplaces = (records ?? []).map(mp => ({
        marketPlaceId: mp.id,
        title: mp.title || '',
        category: mp.category || '',
        price: mp.price ? Number(mp.price) : 0,
        priceType: mp.price_type || '',
        status: mp.status || '',
        description: mp.description || ''
      }))

      return buildSuccessResponse({ marketPlaces: mappedMarketplaces })
    }

    // ==========================================
    // OPERATION LAYER 2: UPDATE LISTING
    // ==========================================
    else if (opUpper === 'UPDATE') {
      if (!marketPlaceId) {
        return buildErrorResponse('BAD_REQUEST', 'marketPlaceId is mandatory for update.', 400)
      }

      // First ensure the record actually belongs to this specific user context line item
      const { data: currentItem, error: checkErr } = await supabase
        .from('SSP_Market_Place')
        .select('id')
        .eq('id', marketPlaceId)
        .eq('society_user', resident.user_id)
        .maybeSingle()

      if (checkErr || !currentItem) {
        return buildErrorResponse('NOT_FOUND', 'Target Marketplace record not found or access privilege denied.', 404)
      }

      const updatePayload: any = {}
      if (title !== undefined) updatePayload.title = title.trim()
      if (category !== undefined) updatePayload.category = category.trim()
      if (price !== undefined) updatePayload.price = price ? parseFloat(price) : 0
      if (priceType !== undefined) updatePayload.price_type = priceType.trim()
      if (status !== undefined) updatePayload.status = status.trim()
      if (description !== undefined) updatePayload.description = description ? description.trim() : null

      const { error: updateErr } = await supabase
        .from('SSP_Market_Place')
        .update(updatePayload)
        .eq('id', marketPlaceId)

      if (updateErr) throw updateErr

      return buildSuccessResponse({
        success: true,
        message: 'Marketplace record updated successfully.'
      })
    }

    // ==========================================
    // OPERATION LAYER 3: DELETE LISTING
    // ==========================================
    else if (opUpper === 'DELETE') {
      if (!marketPlaceId) {
        return buildErrorResponse('BAD_REQUEST', 'marketPlaceId is mandatory for delete.', 400)
      }

      const { data: currentItem, error: checkErr } = await supabase
        .from('SSP_Market_Place')
        .select('id')
        .eq('id', marketPlaceId)
        .eq('society_user', resident.user_id)
        .maybeSingle()

      if (checkErr || !currentItem) {
        return buildErrorResponse('NOT_FOUND', 'Target Marketplace record not found or access privilege denied.', 404)
      }

      const { error: deleteErr } = await supabase
        .from('SSP_Market_Place')
        .delete()
        .eq('id', marketPlaceId)

      if (deleteErr) throw deleteErr

      return buildSuccessResponse({
        success: true,
        message: 'Marketplace record deleted successfully.'
      })
    }

    // ==========================================
    // CAPTURE UNKNOWN OPERATIONS
    // ==========================================
    else {
      return buildErrorResponse('BAD_REQUEST', 'Invalid operation.', 400)
    }

  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', error.message || 'Unable to process request.', 500)
  }
})

function buildSuccessResponse(payload: any) {
  return new Response(
    JSON.stringify({
      success: payload.success || null,
      message: payload.message || null,
      marketPlaces: payload.marketPlaces || null,
      errorResponse: null
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      success: null,
      message: null,
      marketPlaces: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: new Date().toISOString()
      }
    }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}*/

import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const BUCKET_NAME = "society-documents";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await req.json().catch(() => null);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const {
        operation,
        societyRegistrationNumber,
        marketPlaceId,
        title,
        category,
        price,
        priceType,
        status,
        description,
        // Pagination & Filters (for FETCH)
        page = 1,
        limit = 10,
        search,
        // Image management (for ADD_IMAGES & DELETE_IMAGES)
        files,
        documentIds,
      } = body;

      if (!operation || !societyRegistrationNumber) {
        return errorResponse(
          "operation and societyRegistrationNumber are mandatory.",
          400,
        );
      }

      const opUpper = String(operation).toUpperCase();
      const regNum = String(societyRegistrationNumber).trim();

      // ============================================
      // STEP 1: Resolve Context & Verify Ownership
      // ============================================
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", regNum)
        .maybeSingle();

      if (socErr || !society) {
        return errorResponse("Target society context reference missing.", 404);
      }

      const { data: resident, error: residentErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", authCtx.user.id)
        .eq("society", society.society_id)
        .maybeSingle();

      if (residentErr || !resident) {
        return errorResponse(
          "Authenticated user profile not matching resident context.",
          403,
        );
      }

      // ============================================
      // OPERATION 1: FETCH (WITH PAGINATION, FILTERS & IMAGES)
      // ============================================
      if (opUpper === "FETCH") {
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(String(limit)) || 10));
        const offset = (pageNum - 1) * limitNum;

        // ---- Base queries ----
        let countQuery = supabaseAdmin
          .from("SSP_Market_Place")
          .select("id", { count: "exact", head: true })
          .eq("society_user", resident.user_id);

        let dataQuery = supabaseAdmin
          .from("SSP_Market_Place")
          .select(
            "id, title, category, price, price_type, status, description, created_at",
          )
          .eq("society_user", resident.user_id);

        // ---- Apply filters ----
        if (category) {
          countQuery = countQuery.eq("category", String(category).trim());
          dataQuery = dataQuery.eq("category", String(category).trim());
        }
        if (status) {
          countQuery = countQuery.eq("status", String(status).trim());
          dataQuery = dataQuery.eq("status", String(status).trim());
        }
        if (priceType) {
          countQuery = countQuery.eq("price_type", String(priceType).trim());
          dataQuery = dataQuery.eq("price_type", String(priceType).trim());
        }
        if (search) {
          const searchTerm = `%${String(search).trim()}%`;
          countQuery = countQuery.or(
            `title.ilike.${searchTerm},description.ilike.${searchTerm}`,
          );
          dataQuery = dataQuery.or(
            `title.ilike.${searchTerm},description.ilike.${searchTerm}`,
          );
        }

        // ---- Total count ----
        const { count: totalCount, error: countErr } = await countQuery;
        if (countErr) {
          console.error("❌ Count query failed:", countErr);
          throw countErr;
        }

        // ---- Paginated rows ----
        const { data: records, error: fetchErr } = await dataQuery
          .order("created_at", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (fetchErr) {
          console.error("❌ Data query failed:", fetchErr);
          throw fetchErr;
        }

        // ============================================
        // Fetch associated images via `marketplace` FK
        // (matches what create-marketplace writes)
        // ============================================
        const listingIds = (records ?? []).map((r: any) => r.id);
        const imagesByListing: Record<number, any[]> = {};

        if (listingIds.length > 0) {
          const { data: docs, error: docsErr } = await supabaseAdmin
            .from("SSP_Document")
            .select(
              "document_id, name, file_name, file_type, document_type, s3_path, uploaded_on, marketplace",
            )
            .eq("society", society.society_id)
            .eq("document_type", "Market Place Image")
            .in("marketplace", listingIds);

          if (docsErr) {
            // Do NOT swallow this — silent failures make debugging impossible
            console.error("❌ Failed to fetch SSP_Document rows:", docsErr);
            throw docsErr;
          }

          (docs ?? []).forEach((doc: any) => {
            const mpId = Number(doc.marketplace);
            if (!mpId) return;
            if (!imagesByListing[mpId]) imagesByListing[mpId] = [];
            imagesByListing[mpId].push({
              documentId: doc.document_id,
              fileName: doc.name || doc.file_name || "",
              fileType: doc.file_type || "image/jpeg",
              url: doc.s3_path || "",
              uploadedOn: doc.uploaded_on,
            });
          });
        }

        // ---- Map listings ----
        const mappedListings = (records ?? []).map((mp: any) => {
          const imgs = imagesByListing[mp.id] || [];
          return {
            marketPlaceId: mp.id,
            title: mp.title || "",
            category: mp.category || "",
            price: mp.price ? Number(mp.price) : 0,
            priceType: mp.price_type || "",
            status: mp.status || "",
            description: mp.description || "",
            createdAt: mp.created_at,
            imageCount: imgs.length,
            images: imgs, // rich metadata
            imageUrls: imgs.map((i: any) => i.url).filter(Boolean), // convenience
          };
        });

        return successResponse({
          marketPlaces: mappedListings,
          pagination: {
            totalCount: totalCount || 0,
            currentPage: pageNum,
            limit: limitNum,
            totalPages: Math.ceil((totalCount || 0) / limitNum),
          },
        });
      }

      // ============================================
      // Ensure marketPlaceId for non-FETCH operations
      // ============================================
      if (!marketPlaceId) {
        return errorResponse("marketPlaceId is mandatory for this operation.", 400);
      }

      // Verify post ownership
      const { data: currentItem, error: checkErr } = await supabaseAdmin
        .from("SSP_Market_Place")
        .select("id")
        .eq("id", marketPlaceId)
        .eq("society_user", resident.user_id)
        .maybeSingle();

      if (checkErr || !currentItem) {
        return errorResponse(
          "Target Marketplace record not found or access denied.",
          404,
        );
      }

      // ============================================
      // OPERATION 2: UPDATE LISTING METADATA
      // ============================================
      if (opUpper === "UPDATE") {
        const updatePayload: Record<string, any> = {};
        if (title !== undefined) updatePayload.title = String(title).trim();
        if (category !== undefined) updatePayload.category = String(category).trim();
        if (price !== undefined) updatePayload.price = parseFloat(String(price)) || 0;
        if (priceType !== undefined) updatePayload.price_type = String(priceType).trim();
        if (status !== undefined) updatePayload.status = String(status).trim();
        if (description !== undefined) {
          updatePayload.description = description ? String(description).trim() : null;
        }

        if (Object.keys(updatePayload).length === 0) {
          return errorResponse("No updatable fields provided.", 400);
        }

        const { error: updateErr } = await supabaseAdmin
          .from("SSP_Market_Place")
          .update(updatePayload)
          .eq("id", marketPlaceId);

        if (updateErr) {
          console.error("❌ Update failed:", updateErr);
          throw updateErr;
        }

        return successResponse({
          success: true,
          message: "Marketplace record updated successfully.",
        });
      }

      // ============================================
      // OPERATION 3: ADD NEW IMAGES TO POST
      // ============================================
      if (opUpper === "ADD_IMAGES") {
        if (!files || !Array.isArray(files) || files.length === 0) {
          return errorResponse("At least one file object is required in 'files'.", 400);
        }

        // Enforce a maximum image count per listing (1..5, matching create-marketplace)
        const { count: existingCount, error: existingErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id", { count: "exact", head: true })
          .eq("marketplace", marketPlaceId)
          .eq("document_type", "Market Place Image");

        if (existingErr) {
          console.error("❌ Failed to count existing images:", existingErr);
          throw existingErr;
        }

        const totalAfter = (existingCount || 0) + files.length;
        if (totalAfter > 5) {
          return errorResponse(
            `You can have a maximum of 5 images per listing. Currently ${existingCount || 0}, trying to add ${files.length}.`,
            400,
          );
        }

        const docsToInsert: any[] = [];
        const uploadUrls: { fileName: string; uploadUrl: string }[] = [];

        for (const f of files) {
          if (!f || !f.fileName || String(f.fileName).trim() === "") {
            return errorResponse("Each file must include a non-empty 'fileName'.", 400);
          }

          const rawName = String(f.fileName).trim();
          const baseName =
            rawName.split("/").pop()?.split("\\").pop() || "image.jpg";
          const cleanName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const uniqueName = `${Date.now()}_${crypto
            .randomUUID()
            .slice(0, 8)}_${cleanName}`;
          const objectKey = `${regNum}/marketplace/${marketPlaceId}/${uniqueName}`;

          const { data: uploadUrlData, error: uploadUrlErr } = await supabaseAdmin
            .storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey);

          if (uploadUrlErr || !uploadUrlData) {
            console.error("❌ Signed URL generation failed:", uploadUrlErr);
            return errorResponse(
              `Failed generating upload URL for '${rawName}': ${uploadUrlErr?.message}`,
              500,
            );
          }

          const { data: urlInfo } = supabaseAdmin
            .storage
            .from(BUCKET_NAME)
            .getPublicUrl(objectKey);

          docsToInsert.push({
            name: rawName,
            file_name: uniqueName,
            file_type: f.fileType || null,
            file_size: f.fileSize ? parseFloat(String(f.fileSize)) : null,
            document_type: "Market Place Image",
            s3_path: urlInfo.publicUrl,
            society: society.society_id,
            marketplace: marketPlaceId, // ✅ FK — CRITICAL
            uploaded_by: resident.user_id, // ✅ consistency with create-marketplace
            uploaded_on: new Date().toISOString(),
          });

          uploadUrls.push({
            fileName: rawName,
            uploadUrl: uploadUrlData.signedUrl,
          });
        }

        const { error: docInsertErr } = await supabaseAdmin
          .from("SSP_Document")
          .insert(docsToInsert);

        if (docInsertErr) {
          console.error("❌ Document insert failed:", docInsertErr);
          throw docInsertErr;
        }

        return successResponse({
          success: true,
          message: `${uploadUrls.length} image upload URL(s) generated successfully.`,
          uploadUrls,
        });
      }

      // ============================================
      // OPERATION 4: DELETE SPECIFIC IMAGES
      // ============================================
      if (opUpper === "DELETE_IMAGES") {
        if (
          !documentIds ||
          !Array.isArray(documentIds) ||
          documentIds.length === 0
        ) {
          return errorResponse(
            "Array of 'documentIds' is required for deleting images.",
            400,
          );
        }

        // Only delete docs that (a) belong to this listing, (b) are marketplace images
        const { data: docsToDelete, error: docFetchErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id, s3_path")
          .in("document_id", documentIds)
          .eq("marketplace", marketPlaceId)
          .eq("document_type", "Market Place Image");

        if (docFetchErr) {
          console.error("❌ Failed to fetch docs for deletion:", docFetchErr);
          throw docFetchErr;
        }

        if (!docsToDelete || docsToDelete.length === 0) {
          return errorResponse(
            "No matching images found to delete for this listing.",
            404,
          );
        }

        // Extract storage keys from public URLs
        const storagePaths = docsToDelete
          .map((d: any) => {
            const parts = d.s3_path?.split(`${BUCKET_NAME}/`);
            return parts && parts[1] ? parts[1] : null;
          })
          .filter(Boolean) as string[];

        if (storagePaths.length > 0) {
          const { error: storageErr } = await supabaseAdmin
            .storage
            .from(BUCKET_NAME)
            .remove(storagePaths);
          if (storageErr) {
            console.warn("⚠️ Storage removal warning:", storageErr);
          }
        }

        const { error: dbDeleteErr } = await supabaseAdmin
          .from("SSP_Document")
          .delete()
          .in(
            "document_id",
            docsToDelete.map((d: any) => d.document_id),
          );

        if (dbDeleteErr) {
          console.error("❌ Document delete failed:", dbDeleteErr);
          throw dbDeleteErr;
        }

        return successResponse({
          success: true,
          message: `${docsToDelete.length} image(s) deleted successfully.`,
        });
      }

      // ============================================
      // OPERATION 5: DELETE ENTIRE POST & ALL IMAGES
      // ============================================
      if (opUpper === "DELETE") {
        // Fetch linked document records via FK
        const { data: linkedDocs, error: linkedErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id, s3_path")
          .eq("marketplace", marketPlaceId);

        if (linkedErr) {
          console.error("❌ Failed to fetch linked docs:", linkedErr);
          throw linkedErr;
        }

        if (linkedDocs && linkedDocs.length > 0) {
          const storagePaths = linkedDocs
            .map((d: any) => {
              const parts = d.s3_path?.split(`${BUCKET_NAME}/`);
              return parts && parts[1] ? parts[1] : null;
            })
            .filter(Boolean) as string[];

          if (storagePaths.length > 0) {
            const { error: storageErr } = await supabaseAdmin
              .storage
              .from(BUCKET_NAME)
              .remove(storagePaths);
            if (storageErr) {
              console.warn("⚠️ Storage removal warning:", storageErr);
            }
          }

          const { error: docDelErr } = await supabaseAdmin
            .from("SSP_Document")
            .delete()
            .in(
              "document_id",
              linkedDocs.map((d: any) => d.document_id),
            );

          if (docDelErr) {
            console.error("❌ Document delete failed:", docDelErr);
            throw docDelErr;
          }
        }

        // Delete parent marketplace row
        const { error: deleteErr } = await supabaseAdmin
          .from("SSP_Market_Place")
          .delete()
          .eq("id", marketPlaceId);

        if (deleteErr) {
          console.error("❌ Marketplace delete failed:", deleteErr);
          throw deleteErr;
        }

        return successResponse({
          success: true,
          message: "Marketplace record and all linked images deleted successfully.",
        });
      }

      return errorResponse("Invalid operation type.", 400);
    } catch (error: any) {
      console.error("❌ resident-marketplace runtime error:", error);
      return errorResponse(error.message || "Unable to process request.", 500);
    }
  }),
);