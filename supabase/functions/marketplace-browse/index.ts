import { requireAuth, type AuthContext } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// CONSTANTS & LOGGER
// ============================================
const BUCKET_NAME = "society-documents";
const SIGNED_URL_EXPIRY = 900;
const MAX_LIMIT = 100;

const logger = createLogger("marketplace-browse");

// ============================================
// TYPES
// ============================================
type ActionType = "BROWSE" | "TOGGLE_WISHLIST" | "FETCH_WISHLIST";

interface MergedRequest {
  actionType?: ActionType;
  action?: string;

  registrationNumber?: string;
  societyRegistrationNumber?: string;
  category?: string;
  status?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;

  marketplaceItemId?: string | number;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

// ---- Supabase raw row shapes (avoid `any`) ----
interface RawContact {
  name: string | null;
  phone: string | null;
}

interface RawSocietyUser {
  user_id: string;
  society: string;
  SSP_Contact?: RawContact | RawContact[] | null;
}

interface RawDocument {
  document_id: string | number;
  name: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size?: number | null;
  document_type: string | null;
  s3_path: string | null;
  uploaded_on: string | null;
}

interface RawMarketplaceRow {
  id: string | number;
  title: string | null;
  category: string | null;
  price: number | string | null;
  price_type: string | null;
  status: string | null;
  description: string | null;
  created_at: string | null;
  SSP_Society_User?: RawSocietyUser | RawSocietyUser[] | null;
  SSP_Document?: RawDocument | RawDocument[] | null;
}

interface RawWishlistMarketplace {
  id: string | number;
  title: string | null;
  description: string | null;
  price: number | string | null;
  price_type: string | null;
  category: string | null;
  status: string | null;
  created_at: string | null;
  SSP_Document?: RawDocument | RawDocument[] | null;
}

interface RawWishlistRow {
  id: string | number;
  created_at: string | null;
  marketplace_item: string | number;
  SSP_Market_Place:
    | RawWishlistMarketplace
    | RawWishlistMarketplace[];
}

interface WishlistRowMin {
  marketplace_item: string | number | null;
}

interface MembershipRow {
  user_id: string;
  society: string;
  SSP_Society?:
    | { registration_number: string | null }
    | Array<{ registration_number: string | null }>
    | null;
}

interface MarketplaceImage {
  documentId: string | number;
  fileName: string;
  fileType: string;
  s3Path: string;
  url: string;
  uploadedOn: string | null;
}

// ============================================
// INIT
// ============================================
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================
function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
  if (!arr) return null;
  if (Array.isArray(arr)) return arr.length > 0 ? arr[0] : null;
  return arr;
}

function extractStorageKey(path: string): string | null {
  if (!path) return null;
  const raw = path.trim();
  const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
  const signedMarker = `/storage/v1/object/sign/${BUCKET_NAME}/`;
  if (raw.includes(publicMarker)) return raw.split(publicMarker)[1].split("?")[0];
  if (raw.includes(signedMarker)) return raw.split(signedMarker)[1].split("?")[0];
  if (raw.includes(".amazonaws.com/")) return raw.split(".amazonaws.com/")[1].split("?")[0];
  return raw.split("?")[0];
}

async function signStorageUrl(
  supabase: SupabaseClient,
  s3Path: string | null,
): Promise<string> {
  if (!s3Path) return "";
  const raw = String(s3Path).trim();
  if (!raw) return "";

  const key = extractStorageKey(raw);
  if (!key) return raw;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(key, SIGNED_URL_EXPIRY);
    if (error || !data?.signedUrl) return raw;
    return data.signedUrl;
  } catch {
    return raw;
  }
}

async function signMany(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const unique = Array.from(new Set(paths.filter(Boolean)));
  const signed = await Promise.all(
    unique.map(async (p) => {
      const url = await signStorageUrl(supabase, p);
      return [p, url] as const;
    }),
  );
  for (const [orig, url] of signed) result.set(orig, url);
  return result;
}

/**
 * Cast helper to satisfy successResponse's value-type constraint.
 * Runtime identity — only the type assertion changes.
 */
function asPayload(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return obj;
}

// ============================================
// MAIN HANDLER
// ============================================
Deno.serve(
  requireAuth(async (req: Request, authCtxFromParam?: AuthContext) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authCtx =
      authCtxFromParam ?? (req as AuthenticatedRequest).authContext;

    if (!authCtx?.user?.id) {
      return errorResponse("Authentication context missing.", 401);
    }

    const userId = authCtx.user.id;
    const startTime = Date.now();

    try {
      logger.info({
        level: "info",
        timestamp: new Date().toISOString(),
        action: "marketplace_browse_start",
        userId,
        method: req.method,
        message: "Marketplace browse request received",
      });

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const bodyText = await req.text().catch(() => "");
      if (!bodyText || bodyText.trim() === "") {
        return errorResponse("Request body is required.", 400);
      }

      let body: MergedRequest;
      try {
        body = JSON.parse(bodyText) as MergedRequest;
      } catch {
        return errorResponse("Invalid JSON in request body.", 400);
      }

      // ---- Resolve actionType (accept legacy `action` too) ----
      const legacyAction = body.action ? String(body.action).toUpperCase() : "";
      const rawActionType =
        body.actionType ??
        (legacyAction === "TOGGLE"
          ? "TOGGLE_WISHLIST"
          : legacyAction === "LIST"
          ? "FETCH_WISHLIST"
          : undefined);

      if (!rawActionType) {
        return errorResponse(
          "actionType is mandatory. Allowed: BROWSE, TOGGLE_WISHLIST, FETCH_WISHLIST.",
          400,
        );
      }

      const cleanAction = String(rawActionType).trim().toUpperCase() as ActionType;
      const ALLOWED: ActionType[] = ["BROWSE", "TOGGLE_WISHLIST", "FETCH_WISHLIST"];
      if (!ALLOWED.includes(cleanAction)) {
        return errorResponse(
          `Invalid actionType: ${rawActionType}. Allowed: ${ALLOWED.join(", ")}.`,
          400,
        );
      }

      // ---- Resolve society ----
      const rawRegNum =
        body.registrationNumber ?? body.societyRegistrationNumber ?? "";

      let society: { society_id: string; registration_number: string } | null = null;

      if (rawRegNum && String(rawRegNum).trim() !== "") {
        const { data, error: socErr } = await supabaseAdmin
          .from("SSP_Society")
          .select("society_id, registration_number")
          .ilike("registration_number", String(rawRegNum).trim())
          .maybeSingle();

        if (socErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "marketplace_browse_society_lookup_error",
            error: socErr.message,
          });
          return errorResponse("Failed to fetch society data.", 500);
        }
        society = data;
      }

      if (cleanAction === "BROWSE" && !society) {
        return errorResponse("registrationNumber is mandatory.", 400);
      }

      // If no society provided (wishlist without reg num), derive from membership
      if (!society) {
        const { data: membership } = await supabaseAdmin
          .from("SSP_Society_User")
          .select("user_id, society, SSP_Society ( registration_number )")
          .eq("user_id", userId)
          .maybeSingle();

        if (!membership) {
          return errorResponse("User is not associated with any society.", 403);
        }

        const mem = membership as unknown as MembershipRow;
        const socObj = firstOrNull(mem.SSP_Society);

        society = {
          society_id: mem.society,
          registration_number: socObj?.registration_number ?? "",
        };
      }

      const societyId = society.society_id;

      // ---- Membership gate ----
      const { data: membershipCheck } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", userId)
        .eq("society", societyId)
        .maybeSingle();

      if (!membershipCheck) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "marketplace_browse_membership_denied",
          userId,
          societyId,
        });
        return errorResponse("You are not a member of this society.", 403);
      }

      // ============================================
      // ACTION 1: BROWSE
      // ============================================
      if (cleanAction === "BROWSE") {
        const categoryFilter = body.category ? String(body.category).trim() : "all";
        const statusFilter = body.status ? String(body.status).trim() : "all";
        const searchTerm = body.search ? String(body.search).trim() : "";

        const pageNum = Math.max(1, Number(body.page) || 1);
        const limitNum = Math.min(Math.max(1, Number(body.limit) || 20), MAX_LIMIT);

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
          .eq("SSP_Society_User.society", societyId);

        if (categoryFilter.toLowerCase() !== "all") {
          query = query.ilike("category", categoryFilter);
        }
        if (statusFilter.toLowerCase() !== "all") {
          query = query.eq("status", statusFilter);
        }
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
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "marketplace_browse_fetch_error",
            error: fetchErr.message,
          });
          return errorResponse(
            `Failed to fetch marketplace records: ${fetchErr.message}`,
            500,
          );
        }

        const listingRecords = (records ?? []) as unknown as RawMarketplaceRow[];
        const totalCount = count ?? 0;

        // ---- Wishlist IDs for caller ----
        const wishlistSet = new Set<string>();
        if (listingRecords.length > 0) {
          const itemIds = listingRecords.map((r) => r.id);
          const { data: wishRows } = await supabaseAdmin
            .from("SSP_Market_Wishlist")
            .select("marketplace_item")
            .eq("society_user", userId)
            .in("marketplace_item", itemIds);

          ((wishRows ?? []) as unknown as WishlistRowMin[]).forEach((w) => {
            if (w?.marketplace_item != null) {
              wishlistSet.add(String(w.marketplace_item));
            }
          });
        }

        // ---- Batch-sign all image paths ----
        const allPaths: string[] = [];
        for (const mp of listingRecords) {
          const rawDocs = Array.isArray(mp.SSP_Document)
            ? mp.SSP_Document
            : mp.SSP_Document
            ? [mp.SSP_Document]
            : [];
          const imageDocs = rawDocs.filter(
            (d) =>
              !d.document_type ||
              String(d.document_type).toLowerCase().includes("market"),
          );
          for (const d of imageDocs) {
            if (d.s3_path) allPaths.push(d.s3_path);
          }
        }
        const signedMap = await signMany(supabaseAdmin, allPaths);

        // ---- Map output ----
        const mappedMarketplaces = listingRecords.map((mp) => {
          const societyUser = firstOrNull(mp.SSP_Society_User);
          const contact = firstOrNull(societyUser?.SSP_Contact ?? null);

          const rawDocs = Array.isArray(mp.SSP_Document)
            ? mp.SSP_Document
            : mp.SSP_Document
            ? [mp.SSP_Document]
            : [];

          const imageDocs = rawDocs.filter(
            (d) =>
              !d.document_type ||
              String(d.document_type).toLowerCase().includes("market"),
          );

          const images: MarketplaceImage[] = imageDocs
            .map((doc): MarketplaceImage => {
              const signed = (doc.s3_path && signedMap.get(doc.s3_path)) ?? doc.s3_path ?? "";
              return {
                documentId: doc.document_id,
                fileName: doc.file_name || doc.name || "",
                fileType: doc.file_type || "image/jpeg",
                s3Path: doc.s3_path || "",
                url: signed,
                uploadedOn: doc.uploaded_on || null,
              };
            })
            .filter((img) => !!img.url);

          const imageUrls: string[] = images.map((i) => i.url);

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
            images,
            imageUrls,
            isWishlisted: wishlistSet.has(String(mp.id)),
          };
        });

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "marketplace_browse_browse_success",
          userId,
          returned: mappedMarketplaces.length,
          total: totalCount,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            total: totalCount,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalCount / limitNum),
            marketPlaces: mappedMarketplaces,
            filters: { category: categoryFilter, status: statusFilter },
            search: searchTerm || null,
          }),
        );
      }

      // ============================================
      // ACTION 2: TOGGLE_WISHLIST
      // ============================================
      if (cleanAction === "TOGGLE_WISHLIST") {
        const marketplaceItemId = body.marketplaceItemId;
        if (!marketplaceItemId) {
          return errorResponse(
            "Missing mandatory parameter: marketplaceItemId.",
            400,
          );
        }

        const itemIdForDb = marketplaceItemId;
        const itemIdForResponse = String(marketplaceItemId);
        const societyUserId = userId;

        const { data: itemExists, error: itemErr } = await supabaseAdmin
          .from("SSP_Market_Place")
          .select(
            `
            id,
            status,
            SSP_Society_User!inner ( society )
          `,
          )
          .eq("id", itemIdForDb)
          .eq("SSP_Society_User.society", societyId)
          .maybeSingle();

        if (itemErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "marketplace_browse_toggle_lookup_error",
            error: itemErr.message,
          });
          return errorResponse("Failed to verify marketplace item.", 500);
        }
        if (!itemExists) {
          return errorResponse("Marketplace item not found.", 404);
        }

        const { data: existingWish } = await supabaseAdmin
          .from("SSP_Market_Wishlist")
          .select("id")
          .eq("society_user", societyUserId)
          .eq("marketplace_item", itemIdForDb)
          .maybeSingle();

        if (existingWish) {
          const { error: removeErr } = await supabaseAdmin
            .from("SSP_Market_Wishlist")
            .delete()
            .eq("id", existingWish.id);

          if (removeErr) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "marketplace_browse_toggle_remove_error",
              error: removeErr.message,
            });
            return errorResponse(`Failed removing item: ${removeErr.message}`, 500);
          }

          logger.info({
            level: "info",
            timestamp: new Date().toISOString(),
            action: "marketplace_browse_toggle_success",
            userId,
            marketplaceItemId: itemIdForResponse,
            isWishlisted: false,
            durationMs: Date.now() - startTime,
          });

          return successResponse(
            asPayload({
              isWishlisted: false,
              marketplaceItemId: itemIdForResponse,
              message: "Item removed from wishlist.",
            }),
          );
        }

        const { error: addErr } = await supabaseAdmin
          .from("SSP_Market_Wishlist")
          .insert({
            society_user: societyUserId,
            marketplace_item: itemIdForDb,
          });

        if (addErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "marketplace_browse_toggle_add_error",
            error: addErr.message,
          });
          return errorResponse(`Failed adding item: ${addErr.message}`, 500);
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "marketplace_browse_toggle_success",
          userId,
          marketplaceItemId: itemIdForResponse,
          isWishlisted: true,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            isWishlisted: true,
            marketplaceItemId: itemIdForResponse,
            message: "Item added to wishlist successfully.",
          }),
        );
      }

      // ============================================
      // ACTION 3: FETCH_WISHLIST
      // ============================================
      if (cleanAction === "FETCH_WISHLIST") {
        const societyUserId = userId;
        const pageNum = Math.max(1, Number(body.page) || 1);
        const limitNum = Math.min(Math.max(1, Number(body.limit) || 10), MAX_LIMIT);
        const offset = (pageNum - 1) * limitNum;

        const { data: wishlistData, count: totalCount, error: listErr } =
          await supabaseAdmin
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
              { count: "exact" },
            )
            .eq("society_user", societyUserId)
            .order("created_at", { ascending: false })
            .range(offset, offset + limitNum - 1);

        if (listErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "marketplace_browse_wishlist_error",
            error: listErr.message,
          });
          return errorResponse(
            `Failed fetching wishlist: ${listErr.message}`,
            500,
          );
        }

        const rows = (wishlistData ?? []) as unknown as RawWishlistRow[];

        // ---- Batch-sign all image paths ----
        const allPaths: string[] = [];
        for (const row of rows) {
          const mp = firstOrNull(row.SSP_Market_Place);
          if (!mp) continue;
          const rawDocs = Array.isArray(mp.SSP_Document)
            ? mp.SSP_Document
            : mp.SSP_Document
            ? [mp.SSP_Document]
            : [];
          for (const d of rawDocs) {
            if (d?.s3_path) allPaths.push(d.s3_path);
          }
        }
        const signedMap = await signMany(supabaseAdmin, allPaths);

        // ---- Map output ----
        const items = rows.map((row) => {
          const mp = firstOrNull(row.SSP_Market_Place);

          const rawDocs = mp
            ? Array.isArray(mp.SSP_Document)
              ? mp.SSP_Document
              : mp.SSP_Document
              ? [mp.SSP_Document]
              : []
            : [];

          const documents = rawDocs.map((doc) => {
            const signed =
              (doc.s3_path && signedMap.get(doc.s3_path)) ?? doc.s3_path ?? "";
            return {
              documentId: doc.document_id,
              fileName: doc.file_name || doc.name || "",
              fileType: doc.file_type || "image/jpeg",
              s3Path: doc.s3_path || "",
              url: signed,
            };
          });

          const imageUrls: string[] = documents
            .map((d) => d.url)
            .filter(Boolean);

          return {
            wishlistId: row.id,
            addedAt: row.created_at,
            item: {
              id: mp?.id ?? null,
              title: mp?.title ?? "",
              description: mp?.description ?? "",
              price: mp?.price != null ? Number(mp.price) : 0,
              priceType: mp?.price_type ?? "",
              category: mp?.category ?? "",
              status: mp?.status ?? "",
              createdAt: mp?.created_at ?? null,
              images: imageUrls,
              documents,
            },
          };
        });

        const total = totalCount ?? 0;

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "marketplace_browse_wishlist_success",
          userId,
          returned: items.length,
          total,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            wishlist: items,
            pagination: {
              page: pageNum,
              limit: limitNum,
              total,
              totalPages: Math.ceil(total / limitNum),
            },
          }),
        );
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "marketplace_browse_error",
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - startTime,
      });

      return errorResponse(
        err.message || "Failed to process marketplace browse request.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);