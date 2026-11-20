/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// Helper to get current ISO string with +05:30 IST offset
function getISTISOString(date: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  const formatter = new Intl.DateTimeFormat("en-CA", options);
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));

  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${map.get("hour")}:${map.get("minute")}:${map.get("second")}+05:30`;
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
    const { societyRegistrationNumber, category } = requestObj

    // 1. Input Parameter Validation Guard
    if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === '') {
      return buildErrorResponse('BAD_REQUEST', 'societyRegistrationNumber is mandatory.', 400)
    }

    // 2. Resolve Target Society UUID Reference
    const { data: society, error: societyErr } = await supabase
      .from('SSP_Society')
      .select('society_id')
      .eq('registration_number', societyRegistrationNumber.trim())
      .maybeSingle()

    if (societyErr || !society) {
      return buildErrorResponse('NOT_FOUND', 'Target society context mapping missing.', 404)
    }

    // 3. Build Query for Marketplace Records Joined With Resident & Contact Metadata
    let query = supabase
      .from('SSP_Market_Place')
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
          SSP_Contact (
            name,
            phone
          )
        )
      `)
      .eq('SSP_Society_User.society', society.society_id)

    // 4. Apply Case-Insensitive Category Filter if provided
    if (category && String(category).trim() !== '' && String(category).trim().toLowerCase() !== 'all') {
      query = query.ilike('category', String(category).trim())
    }

    // 5. Execute Query Ordered by Recency
    const { data: records, error: fetchErr } = await query.order('created_at', { ascending: false })

    if (fetchErr) {
      throw new Error(`Database query trace execution failed: ${fetchErr.message}`)
    }

    const listingRecords = records ?? []

    // 6. Map Output Data Structure
    const mappedMarketplaces = listingRecords.map(mp => {
      const societyUser = Array.isArray(mp.SSP_Society_User)
        ? mp.SSP_Society_User[0]
        : mp.SSP_Society_User

      const contact = Array.isArray(societyUser?.SSP_Contact)
        ? societyUser.SSP_Contact[0]
        : societyUser?.SSP_Contact

      return {
        marketPlaceId: mp.id,
        title: mp.title || '',
        category: mp.category || '',
        price: mp.price ? Number(mp.price) : 0,
        priceType: mp.price_type || '',
        status: mp.status || '',
        description: mp.description || '',
        postedBy: contact?.name || 'Resident',
        sellerPhone: contact?.phone || 'N/A'
      }
    })

    // 7. Return Success Response Payload Envelope
    return new Response(
      JSON.stringify({
        marketPlaces: mappedMarketplaces,
        errorResponse: null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return buildErrorResponse('SERVER_ERROR', error.message || 'Unable to fetch marketplace records.', 500)
  }
})

function buildErrorResponse(code: string, message: string, statusCode: number) {
  return new Response(
    JSON.stringify({
      marketPlaces: null,
      errorResponse: {
        errorCode: code,
        message: message,
        timestamp: getISTISOString()
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

const BUCKET_NAME = "society-documents"; // ✅ must match create-marketplace

// ============================================
// TYPES
// ============================================
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
  images: MarketplaceImage[];      // ← Rich array (recommended)
  imageUrls: string[];             // ← Flat string array (convenience)
}

// ============================================
// HELPERS
// ============================================
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) {
    return arr.length > 0 ? arr[0] : null;
  }
  return arr;
}

/**
 * Resolves the public URL for a marketplace document.
 * - In create-marketplace, `s3_path` stores the FULL public URL already
 *   (`getPublicUrl(...).publicUrl`), so most of the time this is a passthrough.
 * - Fallback reconstructs the URL for legacy rows that only stored a key.
 */
function resolveStorageUrl(supabaseUrl: string, s3Path: string | null): string {
  if (!s3Path) return "";
  const raw = String(s3Path).trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw; // already a full public URL
  }
  const cleanPath = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${cleanPath}`;
}

// ============================================
// MAIN HANDLER
// ============================================
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    // Handle CORS preflight
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

      // ============================================
      // STEP 1: Resolve Society Context
      // ============================================
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
        return errorResponse(
          "Target society context not found for provided registration number.",
          404,
        );
      }

      // ============================================
      // STEP 2: Build Query with SSP_Document relation
      // ============================================
      let query = supabaseAdmin
        .from("SSP_Market_Place")
        .select(
          `
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
            SSP_Contact (
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
        `,
          { count: "exact" },
        )
        .eq("SSP_Society_User.society", society.society_id);

      // Category filter
      if (categoryFilter.toLowerCase() !== "all") {
        query = query.ilike("category", categoryFilter);
      }

      // Status filter
      if (statusFilter.toLowerCase() !== "all") {
        query = query.eq("status", statusFilter);
      }

      // Search across title, description, category
      if (searchTerm) {
        query = query.or(
          `title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`,
        );
      }

      const from = (pageNum - 1) * limitNum;
      const to = from + limitNum - 1;

      const { data: records, count, error: fetchErr } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (fetchErr) {
        console.error("❌ Marketplace fetch error:", fetchErr);
        return errorResponse(
          `Failed to fetch marketplace records: ${fetchErr.message}`,
          500,
        );
      }

      const listingRecords = records ?? [];
      const totalCount = count ?? 0;

      // ============================================
      // STEP 3: Map Output DTO (with images attached)
      // ============================================
      const mappedMarketplaces: MarketplaceListingResponse[] = listingRecords.map(
        (mp: any) => {
          const societyUser = firstOrNull(mp.SSP_Society_User);
          const contact = firstOrNull(societyUser?.SSP_Contact);

          // Normalize SSP_Document relation to array
          const rawDocs: any[] = Array.isArray(mp.SSP_Document)
            ? mp.SSP_Document
            : mp.SSP_Document
            ? [mp.SSP_Document]
            : [];

          // Keep only marketplace image docs (defensive: filter by document_type)
          const imageDocs = rawDocs.filter(
            (d) =>
              !d.document_type ||
              String(d.document_type).toLowerCase().includes("market"),
          );

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
            .filter((img) => !!img.url); // drop empty URLs

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
            createdAt: mp.created_at,
            imageCount: images.length,
            images,        // full image metadata
            imageUrls,     // just URLs (easy for FE carousels)
          };
        },
      );

      console.log(
        `✅ Returned ${mappedMarketplaces.length} of ${totalCount} marketplace items ` +
          `(with ${mappedMarketplaces.reduce((a, m) => a + m.imageCount, 0)} images total)`,
      );

      // ============================================
      // STEP 4: Response
      // ============================================
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
    } catch (error: any) {
      console.error("❌ get-marketplace error:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: "SERVER_ERROR",
          message: error.message || "Failed to fetch marketplace items",
          errorResponse: {
            errorCode: "SERVER_ERROR",
            message: error.message || "Failed to fetch marketplace items",
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