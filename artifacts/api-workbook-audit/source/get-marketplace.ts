import { contactParkingSlot } from "../_shared/contact.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
const BUCKET_NAME = "society-documents";
interface GetMarketplaceRequest {
    registrationNumber: string;
    category?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
}
interface MarketplaceImage {
    documentId: number | string;
    fileName: string;
    fileType: string;
    s3Path: string;
    url: string;
    uploadedOn: string | null;
}
interface MarketplaceListingResponse {
    marketPlaceId: number;
    title: string;
    category: string;
    price: number;
    priceType: string;
    status: string;
    description: string;
    postedBy: string;
    sellerPhone: string;
    createdAt: string;
    imageCount: number;
    images: MarketplaceImage[];
    imageUrls: string[];
}
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
    if (!arr)
        return null;
    if (Array.isArray(arr)) {
        return arr.length > 0 ? arr[0] : null;
    }
    return arr;
}
function resolveStorageUrl(supabaseUrl: string, s3Path: string | null): string {
    if (!s3Path)
        return "";
    const raw = String(s3Path).trim();
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
        return raw;
    }
    const cleanPath = raw.startsWith("/") ? raw.slice(1) : raw;
    return `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${cleanPath}`;
}
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
Deno.serve(requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        console.log("🛒 get-marketplace called");
        console.log(`👤 Authenticated user (Auth ID): ${authCtx.user.id}`);
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }
        const body: GetMarketplaceRequest = await req.json().catch(() => null);
        if (!body) {
            return errorResponse("Request body is required.", 400);
        }
        const { registrationNumber, category, status, search, page, limit } = body;
        if (!registrationNumber || String(registrationNumber).trim() === "") {
            return errorResponse("registrationNumber is mandatory.", 400);
        }
        const regNum = String(registrationNumber).trim();
        const categoryFilter = category ? String(category).trim() : "all";
        const statusFilter = status ? String(status).trim() : "all";
        const searchTerm = search ? String(search).trim() : "";
        const pageNum = Number(page) || 1;
        const limitNum = Math.min(Number(limit) || 20, 100);
        console.log(`🔍 Fetching marketplace items for society: ${regNum}`);
        console.log(`📄 Pagination: page=${pageNum}, limit=${limitNum}`);
        const { data: society, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", regNum)
            .maybeSingle();
        if (socErr) {
            console.error("❌ Society fetch error:", socErr);
            return errorResponse("Failed to fetch society data.", 500);
        }
        if (!society) {
            return errorResponse("Target society context not found for provided registration number.", 404);
        }
        let query = supabaseAdmin
            .from("SSP_Market_Place")
            .select(`
          id,
          title,
          category,
          price,
          price_type,
          status,
          description,
          created_at,
          SSP_Society_User!inner (
            user_id,
            society,
            SSP_Contact (parking_slot,
              name,
              phone
            )
          ),
          SSP_Document (
            document_id,
            name,
            file_name,
            file_type,
            file_size,
            document_type,
            s3_path,
            uploaded_on
          )
        `, { count: "exact" })
            .eq("SSP_Society_User.society", society.society_id);
        if (categoryFilter.toLowerCase() !== "all") {
            query = query.ilike("category", categoryFilter);
        }
        if (statusFilter.toLowerCase() !== "all") {
            query = query.eq("status", statusFilter);
        }
        if (searchTerm) {
            query = query.or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`);
        }
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;
        const { data: records, count, error: fetchErr } = await query
            .order("created_at", { ascending: false })
            .range(from, to);
        if (fetchErr) {
            console.error("❌ Marketplace fetch error:", fetchErr);
            return errorResponse(`Failed to fetch marketplace records: ${fetchErr.message}`, 500);
        }
        const listingRecords = records ?? [];
        const totalCount = count ?? 0;
        const mappedMarketplaces: MarketplaceListingResponse[] = listingRecords.map((mp: any) => {
            const societyUser = firstOrNull(mp.SSP_Society_User);
            const contact = firstOrNull(societyUser?.SSP_Contact);
            const rawDocs: any[] = Array.isArray(mp.SSP_Document)
                ? mp.SSP_Document
                : mp.SSP_Document
                    ? [mp.SSP_Document]
                    : [];
            const imageDocs = rawDocs.filter((d) => !d.document_type ||
                String(d.document_type).toLowerCase().includes("market"));
            const images: MarketplaceImage[] = imageDocs
                .map((doc: any) => {
                const url = resolveStorageUrl(supabaseUrl, doc.s3_path);
                return {
                    documentId: doc.document_id,
                    fileName: doc.file_name || doc.name || "",
                    fileType: doc.file_type || "image/jpeg",
                    s3Path: doc.s3_path || "",
                    url,
                    uploadedOn: doc.uploaded_on || null,
                };
            })
                .filter((img) => !!img.url);
            const imageUrls = images.map((img) => img.url);
            return {
                marketPlaceId: Number(mp.id),
                title: mp.title || "",
                category: mp.category || "",
                price: mp.price ? Number(mp.price) : 0,
                priceType: mp.price_type || "",
                status: mp.status || "",
                description: mp.description || "",
                postedBy: contact?.name || "Resident",
                sellerPhone: contact?.phone || "N/A",
                parkingSlot: contactParkingSlot(contact),
                createdAt: mp.created_at,
                imageCount: images.length,
                images,
                imageUrls,
            };
        });
        console.log(`✅ Returned ${mappedMarketplaces.length} of ${totalCount} marketplace items ` +
            `(with ${mappedMarketplaces.reduce((a, m) => a + m.imageCount, 0)} images total)`);
        return successResponse({
            total: totalCount,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalCount / limitNum),
            marketPlaces: mappedMarketplaces,
            filters: {
                category: categoryFilter,
                status: statusFilter,
            },
            search: searchTerm || null,
        });
    }
    catch (error: any) {
        console.error("❌ get-marketplace error:", error);
        return new Response(JSON.stringify({
            success: false,
            error: "SERVER_ERROR",
            message: error.message || "Failed to fetch marketplace items",
            errorResponse: {
                errorCode: "SERVER_ERROR",
                message: error.message || "Failed to fetch marketplace items",
                timestamp: new Date().toISOString(),
            },
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
}));
