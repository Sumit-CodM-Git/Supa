/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shared utilities matching system architecture
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import { successResponse } from "../_shared/response.ts";
import { ApiError, ErrorCodes, handleError } from "../_shared/errors.ts";
import { validateRequired } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { logger } from "../_shared/logger.ts";

interface WishlistRow {
  id: string;
  created_at: string;
  marketplace_item: string;
  SSP_Market_Place: {
    id: string;
    title: string;
    description: string;
    price: number;
    price_type: string;
    category: string;
    status: string;
    created_at: string;
  };
}

serve(
  requireAuth(async (req: Request, _ctx: AuthContext) => {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // 1. Request Body Extraction
      const bodyText = await req.text();
      if (!validateRequired(bodyText)) {
        throw new ApiError(ErrorCodes.BAD_REQUEST, "Request body is empty.", 400);
      }

      const payload = JSON.parse(bodyText);
      const { action = "LIST", societyUserId, marketplaceItemId, page = 1, limit = 10 } = payload;

      if (!validateRequired(societyUserId)) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          "Missing mandatory parameter: societyUserId.",
          400
        );
      }

      // 2. TOGGLE ACTION (Add if missing, Remove if present)
      if (action.toUpperCase() === "TOGGLE") {
        if (!marketplaceItemId) {
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            "Missing mandatory parameter: marketplaceItemId.",
            400
          );
        }

        // Check item existence in marketplace
        const { data: itemExists, error: itemErr } = await supabase
          .from("SSP_Market_Place")
          .select("id, status")
          .eq("id", marketplaceItemId)
          .maybeSingle();

        if (itemErr || !itemExists) {
          throw new ApiError(ErrorCodes.NOT_FOUND, "Marketplace item not found.", 404);
        }

        // Check current wishlist status
        const { data: existingWish } = await supabase
          .from("SSP_Market_Wishlist")
          .select("id")
          .eq("society_user", societyUserId)
          .eq("marketplace_item", marketplaceItemId)
          .maybeSingle();

        if (existingWish) {
          // Remove item from wishlist
          const { error: removeErr } = await supabase
            .from("SSP_Market_Wishlist")
            .delete()
            .eq("id", existingWish.id);

          if (removeErr) {
            throw new ApiError(ErrorCodes.SERVER_ERROR, `Failed removing item: ${removeErr.message}`, 500);
          }

          return successResponse({
            isWishlisted: false,
            marketplaceItemId,
            message: "Item removed from wishlist.",
          });
        } else {
          // Add item to wishlist
          const { error: addErr } = await supabase
            .from("SSP_Market_Wishlist")
            .insert({
              society_user: societyUserId,
              marketplace_item: marketplaceItemId,
            });

          if (addErr) {
            throw new ApiError(ErrorCodes.SERVER_ERROR, `Failed adding item: ${addErr.message}`, 500);
          }

          return successResponse({
            isWishlisted: true,
            marketplaceItemId,
            message: "Item added to wishlist successfully.",
          });
        }
      }

      // 3. LIST ACTION (Fetch Wishlisted Items with Details)
      if (action.toUpperCase() === "LIST") {
        const { page: pageNum, limit: limitNum } = sanitizePagination(page, limit);
        const offset = (pageNum - 1) * limitNum;

        const { data: wishlistData, count: totalCount, error: listErr } = await supabase
          .from("SSP_Market_Wishlist")
          .select(
            `
            id,
            created_at,
            marketplace_item,
            SSP_Market_Place!inner (
              id,
              title,
              description,
              price,
              price_type,
              category,
              status,
              created_at
            )
          `,
            { count: "exact" }
          )
          .eq("society_user", societyUserId)
          .order("created_at", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (listErr) {
          logger.error({
            action: "getWishlist",
            message: `Wishlist fetch error: ${listErr.message}`,
          });
          throw new ApiError(ErrorCodes.SERVER_ERROR, `Failed fetching wishlist: ${listErr.message}`, 500);
        }

        const items = ((wishlistData as unknown as WishlistRow[]) ?? []).map((row) => ({
          wishlistId: row.id,
          addedAt: row.created_at,
          item: row.SSP_Market_Place,
        }));

        const total = totalCount ?? 0;

        return successResponse({
          wishlist: items,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        });
      }

      throw new ApiError(ErrorCodes.BAD_REQUEST, "Invalid action specified.", 400);

    } catch (err: unknown) {
      return handleError(err);
    }
  })
);*/
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shared utilities matching system architecture
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import { successResponse } from "../_shared/response.ts";
import { ApiError, ErrorCodes, handleError } from "../_shared/errors.ts";
import { validateRequired } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { logger } from "../_shared/logger.ts";

// ============================================
// TYPES
// ============================================
interface DatabaseDocument {
  document_id: string;
  name: string | null;
  file_name: string | null;
  file_type: string | null;
  s3_path: string | null;
  uploaded_on: string | null;
}

interface WishlistRow {
  id: string;
  created_at: string;
  marketplace_item: string;
  SSP_Market_Place: {
    id: string;
    title: string;
    description: string;
    price: number;
    price_type: string;
    category: string;
    status: string;
    created_at: string;
    SSP_Document?: DatabaseDocument | DatabaseDocument[] | null;
  };
}

interface MarketplaceDocument {
  documentId: string;
  fileName: string;
  fileType: string;
  s3Path: string;
  url: string;
}

// ============================================
// HELPERS
// ============================================
function resolveStorageUrl(supabaseUrl: string, s3Path: string | null): string {
  if (!s3Path) return "";
  
  if (s3Path.startsWith("http://") || s3Path.startsWith("https://")) {
    return s3Path;
  }
  
  const cleanPath = s3Path.startsWith("/") ? s3Path.slice(1) : s3Path;
  return `\({supabaseUrl}/storage/v1/object/public/society-documents/\){cleanPath}`;
}

// ============================================
// MAIN HANDLER
// ============================================
serve(
  requireAuth(async (req: Request, _ctx: AuthContext) => {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // 1. Request Body Extraction
      const bodyText = await req.text();
      if (!validateRequired(bodyText)) {
        throw new ApiError(ErrorCodes.BAD_REQUEST, "Request body is empty.", 400);
      }

      const payload = JSON.parse(bodyText);
      const { action = "LIST", societyUserId, marketplaceItemId, page = 1, limit = 10 } = payload;

      if (!validateRequired(societyUserId)) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          "Missing mandatory parameter: societyUserId.",
          400
        );
      }

      // 2. TOGGLE ACTION (Add if missing, Remove if present)
      if (action.toUpperCase() === "TOGGLE") {
        if (!marketplaceItemId) {
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            "Missing mandatory parameter: marketplaceItemId.",
            400
          );
        }

        // Check item existence in marketplace
        const { data: itemExists, error: itemErr } = await supabase
          .from("SSP_Market_Place")
          .select("id, status")
          .eq("id", marketplaceItemId)
          .maybeSingle();

        if (itemErr || !itemExists) {
          throw new ApiError(ErrorCodes.NOT_FOUND, "Marketplace item not found.", 404);
        }

        // Check current wishlist status
        const { data: existingWish } = await supabase
          .from("SSP_Market_Wishlist")
          .select("id")
          .eq("society_user", societyUserId)
          .eq("marketplace_item", marketplaceItemId)
          .maybeSingle();

        if (existingWish) {
          // Remove item from wishlist
          const { error: removeErr } = await supabase
            .from("SSP_Market_Wishlist")
            .delete()
            .eq("id", existingWish.id);

          if (removeErr) {
            throw new ApiError(ErrorCodes.SERVER_ERROR, `Failed removing item: ${removeErr.message}`, 500);
          }

          return successResponse({
            isWishlisted: false,
            marketplaceItemId,
            message: "Item removed from wishlist.",
          });
        } else {
          // Add item to wishlist
          const { error: addErr } = await supabase
            .from("SSP_Market_Wishlist")
            .insert({
              society_user: societyUserId,
              marketplace_item: marketplaceItemId,
            });

          if (addErr) {
            throw new ApiError(ErrorCodes.SERVER_ERROR, `Failed adding item: ${addErr.message}`, 500);
          }

          return successResponse({
            isWishlisted: true,
            marketplaceItemId,
            message: "Item added to wishlist successfully.",
          });
        }
      }

      // 3. LIST ACTION (Fetch Wishlisted Items with Details & Images)
      if (action.toUpperCase() === "LIST") {
        const { page: pageNum, limit: limitNum } = sanitizePagination(page, limit);
        const offset = (pageNum - 1) * limitNum;

        const { data: wishlistData, count: totalCount, error: listErr } = await supabase
          .from("SSP_Market_Wishlist")
          .select(
            `
            id,
            created_at,
            marketplace_item,
            SSP_Market_Place!inner (
              id,
              title,
              description,
              price,
              price_type,
              category,
              status,
              created_at,
              SSP_Document (
                document_id,
                name,
                file_name,
                file_type,
                s3_path,
                uploaded_on
              )
            )
          `,
            { count: "exact" }
          )
          .eq("society_user", societyUserId)
          .order("created_at", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (listErr) {
          logger.error({
            action: "getWishlist",
            message: `Wishlist fetch error: ${listErr.message}`,
          });
          throw new ApiError(ErrorCodes.SERVER_ERROR, `Failed fetching wishlist: ${listErr.message}`, 500);
        }

        const items = ((wishlistData as unknown as WishlistRow[]) ?? []).map((row) => {
          const mp = row.SSP_Market_Place;

          // Process document and image relationships
          const rawDocs = Array.isArray(mp.SSP_Document)
            ? mp.SSP_Document
            : mp.SSP_Document
            ? [mp.SSP_Document]
            : [];

          const documents: MarketplaceDocument[] = rawDocs.map((doc) => {
            const url = resolveStorageUrl(supabaseUrl, doc.s3_path);
            return {
              documentId: doc.document_id,
              fileName: doc.file_name || doc.name || "",
              fileType: doc.file_type || "image/jpeg",
              s3Path: doc.s3_path || "",
              url,
            };
          });

          const imageUrls = documents.map((doc) => doc.url).filter(Boolean);

          return {
            wishlistId: row.id,
            addedAt: row.created_at,
            item: {
              id: mp.id,
              title: mp.title,
              description: mp.description,
              price: mp.price,
              priceType: mp.price_type,
              category: mp.category,
              status: mp.status,
              createdAt: mp.created_at,
              images: imageUrls,
              documents,
            },
          };
        });

        const total = totalCount ?? 0;

        return successResponse({
          wishlist: items,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        });
      }

      throw new ApiError(ErrorCodes.BAD_REQUEST, "Invalid action specified.", 400);

    } catch (err: unknown) {
      return handleError(err);
    }
  })
);