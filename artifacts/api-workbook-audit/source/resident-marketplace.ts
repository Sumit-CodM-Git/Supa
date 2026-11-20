import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
const BUCKET_NAME = "society-documents";
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: any) => {
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
        const { operation, societyRegistrationNumber, marketPlaceId, title, category, price, priceType, status, description, page = 1, limit = 10, search, files, documentIds, } = body;
        if (!operation || !societyRegistrationNumber) {
            return errorResponse("operation and societyRegistrationNumber are mandatory.", 400);
        }
        const opUpper = String(operation).toUpperCase();
        const regNum = String(societyRegistrationNumber).trim();
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
            return errorResponse("Authenticated user profile not matching resident context.", 403);
        }
        if (opUpper === "FETCH") {
            const pageNum = Math.max(1, parseInt(String(page)) || 1);
            const limitNum = Math.min(50, Math.max(1, parseInt(String(limit)) || 10));
            const offset = (pageNum - 1) * limitNum;
            let countQuery = supabaseAdmin
                .from("SSP_Market_Place")
                .select("id", { count: "exact", head: true })
                .eq("society_user", resident.user_id);
            let dataQuery = supabaseAdmin
                .from("SSP_Market_Place")
                .select("id, title, category, price, price_type, status, description, created_at")
                .eq("society_user", resident.user_id);
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
                countQuery = countQuery.or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`);
                dataQuery = dataQuery.or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`);
            }
            const { count: totalCount, error: countErr } = await countQuery;
            if (countErr) {
                console.error("❌ Count query failed:", countErr);
                throw countErr;
            }
            const { data: records, error: fetchErr } = await dataQuery
                .order("created_at", { ascending: false })
                .range(offset, offset + limitNum - 1);
            if (fetchErr) {
                console.error("❌ Data query failed:", fetchErr);
                throw fetchErr;
            }
            const listingIds = (records ?? []).map((r: any) => r.id);
            const imagesByListing: Record<number, any[]> = {};
            if (listingIds.length > 0) {
                const { data: docs, error: docsErr } = await supabaseAdmin
                    .from("SSP_Document")
                    .select("document_id, name, file_name, file_type, document_type, s3_path, uploaded_on, marketplace")
                    .eq("society", society.society_id)
                    .eq("document_type", "Market Place Image")
                    .in("marketplace", listingIds);
                if (docsErr) {
                    console.error("❌ Failed to fetch SSP_Document rows:", docsErr);
                    throw docsErr;
                }
                (docs ?? []).forEach((doc: any) => {
                    const mpId = Number(doc.marketplace);
                    if (!mpId)
                        return;
                    if (!imagesByListing[mpId])
                        imagesByListing[mpId] = [];
                    imagesByListing[mpId].push({
                        documentId: doc.document_id,
                        fileName: doc.name || doc.file_name || "",
                        fileType: doc.file_type || "image/jpeg",
                        url: doc.s3_path || "",
                        uploadedOn: doc.uploaded_on,
                    });
                });
            }
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
                    images: imgs,
                    imageUrls: imgs.map((i: any) => i.url).filter(Boolean),
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
        if (!marketPlaceId) {
            return errorResponse("marketPlaceId is mandatory for this operation.", 400);
        }
        const { data: currentItem, error: checkErr } = await supabaseAdmin
            .from("SSP_Market_Place")
            .select("id")
            .eq("id", marketPlaceId)
            .eq("society_user", resident.user_id)
            .maybeSingle();
        if (checkErr || !currentItem) {
            return errorResponse("Target Marketplace record not found or access denied.", 404);
        }
        if (opUpper === "UPDATE") {
            const updatePayload: Record<string, any> = {};
            if (title !== undefined)
                updatePayload.title = String(title).trim();
            if (category !== undefined)
                updatePayload.category = String(category).trim();
            if (price !== undefined)
                updatePayload.price = parseFloat(String(price)) || 0;
            if (priceType !== undefined)
                updatePayload.price_type = String(priceType).trim();
            if (status !== undefined)
                updatePayload.status = String(status).trim();
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
        if (opUpper === "ADD_IMAGES") {
            if (!files || !Array.isArray(files) || files.length === 0) {
                return errorResponse("At least one file object is required in 'files'.", 400);
            }
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
                return errorResponse(`You can have a maximum of 5 images per listing. Currently ${existingCount || 0}, trying to add ${files.length}.`, 400);
            }
            const docsToInsert: any[] = [];
            const uploadUrls: {
                fileName: string;
                uploadUrl: string;
            }[] = [];
            for (const f of files) {
                if (!f || !f.fileName || String(f.fileName).trim() === "") {
                    return errorResponse("Each file must include a non-empty 'fileName'.", 400);
                }
                const rawName = String(f.fileName).trim();
                const baseName = rawName.split("/").pop()?.split("\\").pop() || "image.jpg";
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
                    return errorResponse(`Failed generating upload URL for '${rawName}': ${uploadUrlErr?.message}`, 500);
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
                    marketplace: marketPlaceId,
                    uploaded_by: resident.user_id,
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
        if (opUpper === "DELETE_IMAGES") {
            if (!documentIds ||
                !Array.isArray(documentIds) ||
                documentIds.length === 0) {
                return errorResponse("Array of 'documentIds' is required for deleting images.", 400);
            }
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
                return errorResponse("No matching images found to delete for this listing.", 404);
            }
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
                .in("document_id", docsToDelete.map((d: any) => d.document_id));
            if (dbDeleteErr) {
                console.error("❌ Document delete failed:", dbDeleteErr);
                throw dbDeleteErr;
            }
            return successResponse({
                success: true,
                message: `${docsToDelete.length} image(s) deleted successfully.`,
            });
        }
        if (opUpper === "DELETE") {
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
                    .in("document_id", linkedDocs.map((d: any) => d.document_id));
                if (docDelErr) {
                    console.error("❌ Document delete failed:", docDelErr);
                    throw docDelErr;
                }
            }
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
    }
    catch (error: any) {
        console.error("❌ resident-marketplace runtime error:", error);
        return errorResponse(error.message || "Unable to process request.", 500);
    }
}));
