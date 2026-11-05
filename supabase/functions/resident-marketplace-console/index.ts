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
const DOCUMENT_TYPE_MARKETPLACE = "market_place_image";
const MIN_IMAGES_PER_LISTING = 1;   // <-- NEW: minimum images required to create a post
const MAX_IMAGES_PER_LISTING = 5;
const SIGNED_URL_EXPIRY = 900;

const logger = createLogger("resident-marketplace-console");

// ============================================
// TYPES
// ============================================
type ActionType =
  | "CREATE"
  | "FETCH_OWN"
  | "UPDATE"
  | "ADD_IMAGES"
  | "DELETE_IMAGES"
  | "DELETE";

interface FileInput {
  fileName: string;
  fileType?: string;
  fileSize?: number | string;
}

interface MergedRequest {
  actionType: ActionType;
  societyRegistrationNumber: string;

  // CREATE / UPDATE
  title?: string;
  category?: string;
  price?: number | string;
  priceType?: string;
  status?: string;
  description?: string;
  files?: FileInput[];

  // FETCH_OWN / ADD_IMAGES / DELETE_IMAGES / DELETE
  marketPlaceId?: number | string;
  documentIds?: (string | number)[];

  // FETCH_OWN pagination/filters
  page?: number | string;
  limit?: number | string;
  search?: string;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

interface RawDocument {
  document_id: string | number;
  name: string | null;
  file_name: string | null;
  file_type: string | null;
  document_type: string | null;
  s3_path: string | null;
  uploaded_on: string | null;
  marketplace?: string | number | null;
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
// deno-lint-ignore no-explicit-any
function asPayload(obj: Record<string, unknown>): any {
  return obj;
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

function buildObjectKey(
  regNum: string,
  marketPlaceId: number | string,
  rawName: string,
  index: number,
): string {
  const safeRegNum = regNum.replace(/[^a-zA-Z0-9_-]/g, "");
  const baseName = rawName.split("/").pop()?.split("\\").pop() || "image.jpg";
  const cleanName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueToken = `${Date.now()}_${index}_${crypto.randomUUID().slice(0, 8)}`;
  const uniqueFileName = `${uniqueToken}_${cleanName}`;
  return `${safeRegNum}/marketplace/${marketPlaceId}/${uniqueFileName}`;
}

function buildDocumentRows(
  files: FileInput[],
  objectKeys: string[],
  marketPlaceId: number | string,
  societyId: string,
  userId: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const objectKey = objectKeys[i];

    const { data: urlInfo } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(objectKey);

    const lastSlash = objectKey.lastIndexOf("/");
    const storedName = lastSlash >= 0
      ? objectKey.substring(lastSlash + 1)
      : objectKey;

    rows.push({
      name: String(f.fileName).trim(),
      file_name: storedName,
      file_type: f.fileType || null,
      file_size: f.fileSize ? parseFloat(String(f.fileSize)) : null,
      document_type: DOCUMENT_TYPE_MARKETPLACE,
      s3_path: urlInfo.publicUrl,
      society: societyId,
      marketplace: marketPlaceId,
      uploaded_by: userId,
      uploaded_on: now,
    });
  }

  return rows;
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
        action: "resident_marketplace_console_start",
        userId,
        method: req.method,
        message: "Resident marketplace console request received",
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

      const { actionType, societyRegistrationNumber } = body;

      if (!actionType || String(actionType).trim() === "") {
        return errorResponse("actionType is mandatory.", 400);
      }
      if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
        return errorResponse("societyRegistrationNumber is mandatory.", 400);
      }

      const cleanAction = String(actionType).trim().toUpperCase() as ActionType;
      const ALLOWED: ActionType[] = [
        "CREATE",
        "FETCH_OWN",
        "UPDATE",
        "ADD_IMAGES",
        "DELETE_IMAGES",
        "DELETE",
      ];
      if (!ALLOWED.includes(cleanAction)) {
        return errorResponse(
          `Invalid actionType: ${actionType}. Allowed: ${ALLOWED.join(", ")}.`,
          400,
        );
      }

      const regNum = String(societyRegistrationNumber).trim();

      // ---- Resolve society (case-insensitive) ----
      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number")
        .ilike("registration_number", regNum)
        .maybeSingle();

      if (socErr) {
        logger.error({
          level: "error",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_society_lookup_error",
          error: socErr.message,
        });
        return errorResponse("Failed to verify society context.", 500);
      }
      if (!society) {
        return errorResponse("Target society context not found.", 404);
      }

      // ---- Society-membership gate ----
      const { data: resident } = await supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id")
        .eq("user_id", userId)
        .eq("society", society.society_id)
        .maybeSingle();

      if (!resident) {
        logger.warn({
          level: "warn",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_membership_denied",
          userId,
          societyId: society.society_id,
        });
        return errorResponse(
          "Authenticated user is not an active resident of this society.",
          403,
        );
      }

      // =====================================================================
      // ACTION 1: CREATE
      //  1. Enforce MIN/MAX image count
      //  2. Insert SSP_Market_Place
      //  3. Generate signed upload URLs
      //  4. Insert SSP_Document rows immediately (no CONFIRM step)
      //  Rollback: if any step fails, remove the listing
      // =====================================================================
      if (cleanAction === "CREATE") {
        const {
          title,
          category,
          price,
          priceType,
          status,
          description,
          files,
        } = body;

        const trimmedTitle = title ? String(title).trim() : "";
        const trimmedCategory = category ? String(category).trim() : "";
        const trimmedPriceType = priceType ? String(priceType).trim() : "Fixed";

        const isPriceMissing =
          trimmedPriceType.toLowerCase() !== "free" &&
          (price === undefined || price === null || String(price).trim() === "");

        if (!trimmedTitle || !trimmedCategory || isPriceMissing) {
          return errorResponse(
            "title, category, and price are mandatory (unless priceType is 'Free').",
            400,
          );
        }

        // ---------- MIN/MAX IMAGE VALIDATION ----------
        if (!files || !Array.isArray(files) || files.length === 0) {
          return errorResponse(
            `At least ${MIN_IMAGES_PER_LISTING} image is required to create a post.`,
            400,
          );
        }
        if (files.length < MIN_IMAGES_PER_LISTING) {
          return errorResponse(
            `You must upload at least ${MIN_IMAGES_PER_LISTING} image(s) to create a post. Received ${files.length}.`,
            400,
          );
        }
        if (files.length > MAX_IMAGES_PER_LISTING) {
          return errorResponse(
            `You can upload a maximum of ${MAX_IMAGES_PER_LISTING} images per listing.`,
            400,
          );
        }

        // Validate each file entry has required properties
        for (const [i, f] of files.entries()) {
          if (!f || !f.fileName || String(f.fileName).trim() === "") {
            return errorResponse(
              `File item at index ${i} is missing 'fileName'. All images must have a valid file name.`,
              400,
            );
          }
          if (!f.fileType || String(f.fileType).trim() === "") {
            return errorResponse(
              `File item at index ${i} is missing 'fileType'. All images must specify a valid image type.`,
              400,
            );
          }
          if (!String(f.fileType).toLowerCase().startsWith("image/")) {
            return errorResponse(
              `File item at index ${i} ('${f.fileName}') is not a valid image. Only image files are allowed.`,
              400,
            );
          }
        }
        // ------------------------------------------------

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

        // ---- Insert listing ----
        const { data: newListing, error: insertErr } = await supabaseAdmin
          .from("SSP_Market_Place")
          .insert({
            title: trimmedTitle,
            category: trimmedCategory,
            price: calculatedPrice,
            price_type: trimmedPriceType,
            status: status ? String(status).trim() : "Active",
            description: description ? String(description).trim() : null,
            society_user: resident.user_id,
          })
          .select("id")
          .single();

        if (insertErr || !newListing) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_create_insert_error",
            error: insertErr?.message,
          });
          return errorResponse(
            `Database listing insertion failed: ${insertErr?.message}`,
            500,
          );
        }

        const marketPlaceId = newListing.id;

        // ---- Generate signed upload URLs (one per file) ----
        const uploadUrls: Array<{
          fileName: string;
          uploadUrl: string;
          objectKey: string;
        }> = [];
        const objectKeys: string[] = [];

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const rawFileName = String(f.fileName).trim();
          const objectKey = buildObjectKey(regNum, marketPlaceId, rawFileName, i);

          const { data: uploadUrlData, error: uploadUrlErr } = await supabaseAdmin
            .storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey);

          if (uploadUrlErr || !uploadUrlData) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_marketplace_console_create_signed_url_error",
              error: uploadUrlErr?.message,
            });

            // Rollback: delete the listing
            await supabaseAdmin
              .from("SSP_Market_Place")
              .delete()
              .eq("id", marketPlaceId);

            return errorResponse(
              `Failed generating upload link for image '${rawFileName}': ${uploadUrlErr?.message}`,
              500,
            );
          }

          uploadUrls.push({
            fileName: rawFileName,
            uploadUrl: uploadUrlData.signedUrl,
            objectKey,
          });
          objectKeys.push(objectKey);
        }

        // ---- Insert SSP_Document rows immediately ----
        const docsToInsert = buildDocumentRows(
          files,
          objectKeys,
          marketPlaceId,
          society.society_id,
          resident.user_id,
        );

        const { data: insertedDocs, error: docInsertErr } = await supabaseAdmin
          .from("SSP_Document")
          .insert(docsToInsert)
          .select("document_id");

        if (docInsertErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_create_docs_error",
            error: docInsertErr.message,
          });

          // Rollback: delete the listing
          await supabaseAdmin
            .from("SSP_Market_Place")
            .delete()
            .eq("id", marketPlaceId);

          return errorResponse(
            `Failed logging image documents into database: ${docInsertErr.message}`,
            500,
          );
        }

        const documentIds = (insertedDocs ?? []).map(
          (d: { document_id: string | number }) => d.document_id,
        );

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_create_end",
          userId,
          marketPlaceId,
          imageCount: uploadUrls.length,
          documentIds: documentIds.join(","),
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            marketPlaceId,
            isCreated: true,
            imageCount: uploadUrls.length,
            documentIds,
            uploadUrls,
            message:
              "Listing created. PUT each binary to the corresponding uploadUrl to finalize the image.",
          }),
        );
      }

      // =====================================================================
      // ACTION 2: FETCH_OWN
      // =====================================================================
      if (cleanAction === "FETCH_OWN") {
        const { category, status, priceType, search } = body;
        const pageNum = Math.max(1, parseInt(String(body.page ?? 1)) || 1);
        const limitNum = Math.min(
          50,
          Math.max(1, parseInt(String(body.limit ?? 10)) || 10),
        );
        const offset = (pageNum - 1) * limitNum;

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

        const applyFilters = <T>(q: T): T => {
          let qq = q as unknown as {
            eq: (col: string, val: unknown) => unknown;
            or: (filter: string) => unknown;
          };
          if (category) {
            qq = qq.eq("category", String(category).trim()) as typeof qq;
          }
          if (status) {
            qq = qq.eq("status", String(status).trim()) as typeof qq;
          }
          if (priceType) {
            qq = qq.eq("price_type", String(priceType).trim()) as typeof qq;
          }
          if (search) {
            const term = `%${String(search).trim()}%`;
            qq = qq.or(
              `title.ilike.${term},description.ilike.${term}`,
            ) as typeof qq;
          }
          return qq as unknown as T;
        };

        countQuery = applyFilters(countQuery);
        dataQuery = applyFilters(dataQuery);

        const { count: totalCount, error: countErr } = await countQuery;
        if (countErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_fetch_count_error",
            error: countErr.message,
          });
          throw countErr;
        }

        const total = totalCount ?? 0;
        if (total === 0 || offset >= total) {
          logger.info({
            level: "info",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_fetch_empty",
            userId,
            total,
            page: pageNum,
          });
          return successResponse(
            asPayload({
              marketPlaces: [],
              pagination: {
                totalCount: total,
                currentPage: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
              },
            }),
          );
        }

        const { data: records, error: fetchErr } = await dataQuery
          .order("created_at", { ascending: false })
          .range(offset, offset + limitNum - 1);

        if (fetchErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_fetch_error",
            error: fetchErr.message,
          });
          throw fetchErr;
        }

        const listingIds = (records ?? []).map(
          (r: { id: string | number }) => r.id,
        );
        const imagesByListing: Record<string, RawDocument[]> = {};

        if (listingIds.length > 0) {
          const { data: docs, error: docsErr } = await supabaseAdmin
            .from("SSP_Document")
            .select(
              "document_id, name, file_name, file_type, document_type, s3_path, uploaded_on, marketplace",
            )
            .eq("society", society.society_id)
            .eq("document_type", DOCUMENT_TYPE_MARKETPLACE)
            .in("marketplace", listingIds);

          if (docsErr) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_marketplace_console_fetch_docs_error",
              error: docsErr.message,
            });
            throw docsErr;
          }

          for (const doc of (docs ?? []) as unknown as RawDocument[]) {
            const mpId = String(doc.marketplace ?? "");
            if (!mpId) continue;
            if (!imagesByListing[mpId]) imagesByListing[mpId] = [];
            imagesByListing[mpId].push(doc);
          }
        }

        const allPaths: string[] = [];
        for (const list of Object.values(imagesByListing)) {
          for (const d of list) if (d.s3_path) allPaths.push(d.s3_path);
        }
        const signedMap = await signMany(supabaseAdmin, allPaths);

        const mappedListings = (records ?? []).map(
          (mp: Record<string, unknown>) => {
            const id = String(mp.id);
            const docs = imagesByListing[id] ?? [];

            const images: MarketplaceImage[] = docs
              .map((doc): MarketplaceImage => {
                const signed =
                  (doc.s3_path && signedMap.get(doc.s3_path)) ||
                  doc.s3_path ||
                  "";
                return {
                  documentId: doc.document_id,
                  fileName: doc.name || doc.file_name || "",
                  fileType: doc.file_type || "image/jpeg",
                  s3Path: doc.s3_path || "",
                  url: signed,
                  uploadedOn: doc.uploaded_on,
                };
              })
              .filter((img) => !!img.url);

            const imageUrls = images.map((i) => i.url);

            return {
              marketPlaceId: mp.id,
              title: mp.title || "",
              category: mp.category || "",
              price: mp.price ? Number(mp.price) : 0,
              priceType: mp.price_type || "",
              status: mp.status || "",
              description: mp.description || "",
              createdAt: mp.created_at,
              imageCount: images.length,
              images,
              imageUrls,
            };
          },
        );

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_fetch_end",
          userId,
          returned: mappedListings.length,
          total,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            marketPlaces: mappedListings,
            pagination: {
              totalCount: total,
              currentPage: pageNum,
              limit: limitNum,
              totalPages: Math.ceil(total / limitNum),
            },
          }),
        );
      }

      // =====================================================================
      // Remaining actions require marketPlaceId + ownership
      // =====================================================================
      const { marketPlaceId } = body;
      if (!marketPlaceId) {
        return errorResponse(
          "marketPlaceId is mandatory for this action.",
          400,
        );
      }

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

      // =====================================================================
      // ACTION 3: UPDATE
      // =====================================================================
      if (cleanAction === "UPDATE") {
        const { title, category, price, priceType, status, description } = body;

        const updatePayload: Record<string, unknown> = {};
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
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_update_error",
            error: updateErr.message,
          });
          throw updateErr;
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_update_end",
          userId,
          marketPlaceId,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            success: true,
            message: "Marketplace record updated successfully.",
          }),
        );
      }

      // =====================================================================
      // ACTION 4: ADD_IMAGES
      //  1. Enforce 5-image cap
      //  2. Generate signed upload URLs
      //  3. Insert SSP_Document rows immediately
      // =====================================================================
      if (cleanAction === "ADD_IMAGES") {
        const { files } = body;
        if (!files || !Array.isArray(files) || files.length === 0) {
          return errorResponse(
            "At least one file object is required in 'files'.",
            400,
          );
        }

        const { count: existingCount, error: existingErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id", { count: "exact", head: true })
          .eq("marketplace", marketPlaceId)
          .eq("document_type", DOCUMENT_TYPE_MARKETPLACE);

        if (existingErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_add_count_error",
            error: existingErr.message,
          });
          throw existingErr;
        }

        const totalAfter = (existingCount ?? 0) + files.length;
        if (totalAfter > MAX_IMAGES_PER_LISTING) {
          return errorResponse(
            `You can have a maximum of ${MAX_IMAGES_PER_LISTING} images per listing. Currently ${existingCount ?? 0}, trying to add ${files.length}.`,
            400,
          );
        }

        const uploadUrls: Array<{
          fileName: string;
          uploadUrl: string;
          objectKey: string;
        }> = [];
        const objectKeys: string[] = [];

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (!f?.fileName || String(f.fileName).trim() === "") {
            return errorResponse(
              `File at index ${i} is missing 'fileName'.`,
              400,
            );
          }

          const rawName = String(f.fileName).trim();
          const objectKey = buildObjectKey(regNum, marketPlaceId, rawName, i);

          const { data: uploadUrlData, error: uploadUrlErr } = await supabaseAdmin
            .storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(objectKey);

          if (uploadUrlErr || !uploadUrlData) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_marketplace_console_add_signed_url_error",
              error: uploadUrlErr?.message,
            });
            return errorResponse(
              `Failed generating upload URL for '${rawName}': ${uploadUrlErr?.message}`,
              500,
            );
          }

          uploadUrls.push({
            fileName: rawName,
            uploadUrl: uploadUrlData.signedUrl,
            objectKey,
          });
          objectKeys.push(objectKey);
        }

        // ---- Insert SSP_Document rows immediately ----
        const docsToInsert = buildDocumentRows(
          files,
          objectKeys,
          marketPlaceId,
          society.society_id,
          resident.user_id,
        );

        const { data: insertedDocs, error: docInsertErr } = await supabaseAdmin
          .from("SSP_Document")
          .insert(docsToInsert)
          .select("document_id");

        if (docInsertErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_add_docs_error",
            error: docInsertErr.message,
          });
          return errorResponse(
            `Failed logging image documents into database: ${docInsertErr.message}`,
            500,
          );
        }

        const documentIds = (insertedDocs ?? []).map(
          (d: { document_id: string | number }) => d.document_id,
        );

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_add_end",
          userId,
          marketPlaceId,
          imageCount: uploadUrls.length,
          documentIds: documentIds.join(","),
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            success: true,
            message: `${uploadUrls.length} image(s) added. PUT each binary to the corresponding uploadUrl to finalize.`,
            documentIds,
            uploadUrls,
          }),
        );
      }

      // =====================================================================
      // ACTION 5: DELETE_IMAGES
      // =====================================================================
      if (cleanAction === "DELETE_IMAGES") {
        const { documentIds } = body;
        if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
          return errorResponse(
            "Array of 'documentIds' is required for deleting images.",
            400,
          );
        }

        const { data: docsToDelete, error: docFetchErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id, s3_path")
          .in("document_id", documentIds)
          .eq("marketplace", marketPlaceId)
          .eq("document_type", DOCUMENT_TYPE_MARKETPLACE);

        if (docFetchErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_delete_images_fetch_error",
            error: docFetchErr.message,
          });
          throw docFetchErr;
        }

        if (!docsToDelete || docsToDelete.length === 0) {
          return errorResponse(
            "No matching images found to delete for this listing.",
            404,
          );
        }

        // ---------- NEW: Prevent deleting below MIN images ----------
        const { count: totalImages, error: totalErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id", { count: "exact", head: true })
          .eq("marketplace", marketPlaceId)
          .eq("document_type", DOCUMENT_TYPE_MARKETPLACE);

        if (totalErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_delete_images_total_error",
            error: totalErr.message,
          });
          throw totalErr;
        }

        const remainingAfterDelete = (totalImages ?? 0) - docsToDelete.length;
        if (remainingAfterDelete < MIN_IMAGES_PER_LISTING) {
          return errorResponse(
            `Cannot delete these image(s). A listing must retain at least ${MIN_IMAGES_PER_LISTING} image(s).`,
            400,
          );
        }
        // -------------------------------------------------------------

        const storagePaths = docsToDelete
          .map((d: { s3_path: string | null }) => {
            const key = d.s3_path ? extractStorageKey(d.s3_path) : null;
            return key || null;
          })
          .filter((k): k is string => !!k);

        if (storagePaths.length > 0) {
          const { error: storageErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .remove(storagePaths);
          if (storageErr) {
            logger.warn({
              level: "warn",
              timestamp: new Date().toISOString(),
              action: "resident_marketplace_console_delete_images_storage_warn",
              error: storageErr.message,
            });
          }
        }

        const { error: dbDeleteErr } = await supabaseAdmin
          .from("SSP_Document")
          .delete()
          .in(
            "document_id",
            docsToDelete.map(
              (d: { document_id: string | number }) => d.document_id,
            ),
          );

        if (dbDeleteErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_delete_images_db_error",
            error: dbDeleteErr.message,
          });
          throw dbDeleteErr;
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_delete_images_end",
          userId,
          marketPlaceId,
          deletedCount: docsToDelete.length,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            success: true,
            message: `${docsToDelete.length} image(s) deleted successfully.`,
          }),
        );
      }

      // =====================================================================
      // ACTION 6: DELETE (listing + all images)
      // =====================================================================
      if (cleanAction === "DELETE") {
        const { data: linkedDocs, error: linkedErr } = await supabaseAdmin
          .from("SSP_Document")
          .select("document_id, s3_path")
          .eq("marketplace", marketPlaceId);

        if (linkedErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_delete_fetch_docs_error",
            error: linkedErr.message,
          });
          throw linkedErr;
        }

        if (linkedDocs && linkedDocs.length > 0) {
          const storagePaths = linkedDocs
            .map((d: { s3_path: string | null }) => {
              const key = d.s3_path ? extractStorageKey(d.s3_path) : null;
              return key || null;
            })
            .filter((k): k is string => !!k);

          if (storagePaths.length > 0) {
            const { error: storageErr } = await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .remove(storagePaths);
            if (storageErr) {
              logger.warn({
                level: "warn",
                timestamp: new Date().toISOString(),
                action: "resident_marketplace_console_delete_storage_warn",
                error: storageErr.message,
              });
            }
          }

          const { error: docDelErr } = await supabaseAdmin
            .from("SSP_Document")
            .delete()
            .in(
              "document_id",
              linkedDocs.map(
                (d: { document_id: string | number }) => d.document_id,
              ),
            );

          if (docDelErr) {
            logger.error({
              level: "error",
              timestamp: new Date().toISOString(),
              action: "resident_marketplace_console_delete_docs_error",
              error: docDelErr.message,
            });
            throw docDelErr;
          }
        }

        const { error: deleteErr } = await supabaseAdmin
          .from("SSP_Market_Place")
          .delete()
          .eq("id", marketPlaceId);

        if (deleteErr) {
          logger.error({
            level: "error",
            timestamp: new Date().toISOString(),
            action: "resident_marketplace_console_delete_error",
            error: deleteErr.message,
          });
          throw deleteErr;
        }

        logger.info({
          level: "info",
          timestamp: new Date().toISOString(),
          action: "resident_marketplace_console_delete_end",
          userId,
          marketPlaceId,
          durationMs: Date.now() - startTime,
        });

        return successResponse(
          asPayload({
            success: true,
            message: "Marketplace record and all linked images deleted successfully.",
          }),
        );
      }

      return errorResponse("Unhandled actionType.", 400);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error({
        level: "error",
        timestamp: new Date().toISOString(),
        action: "resident_marketplace_console_error",
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - startTime,
        message: "Resident marketplace console request failed",
      });

      return errorResponse(
        err.message || "Unable to process request.",
        500,
        Deno.env.get("DENO_ENV") === "development" ? err.stack : null,
      );
    }
  }),
);