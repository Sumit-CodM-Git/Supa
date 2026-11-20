// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'POST, OPTIONS'
// };
// const BUCKET_NAME = 'society-documents';
// serve(async (req)=>{
//   if (req.method === 'OPTIONS') return new Response('ok', {
//     headers: corsHeaders
//   });
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return buildErrorResponse('BAD_REQUEST', 'Request body is empty.', 400);
//     }
//     const requestObj = JSON.parse(bodyText);
//     const { operation, societyRegistrationNumber, documentId } = requestObj;
//     if (!operation || !societyRegistrationNumber) {
//       return buildErrorResponse('BAD_REQUEST', 'operation and societyRegistrationNumber are required.', 400);
//     }
//     const normalizedOp = operation.toUpperCase().trim();
//     const cleanRegNum = societyRegistrationNumber.trim();
//     const responsePayload = {
//       documents: null,
//       fileUrl: null,
//       documentName: null,
//       errorResponse: null
//     };
//     const { data: society, error: socErr } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', cleanRegNum).maybeSingle();
//     if (socErr || !society) {
//       return buildErrorResponse('NOT_FOUND', 'Society registration entry not found.', 404);
//     }
//     // -------------------------------------------------------------------------
//     // OPERATION: FETCH
//     // -------------------------------------------------------------------------
//     if (normalizedOp === 'FETCH') {
//       const residentDocTypes = [
//         'Legal',
//         'Notice',
//         'Policy',
//         'Financial',
//         'Agreement'
//       ];
//       const { data: docs, error: fetchErr } = await supabase.from('SSP_Document').select('document_id, name, document_type, file_size, s3_path').eq('society', society.society_id).in('document_type', residentDocTypes).not('s3_path', 'is', null);
//       if (fetchErr) {
//         return buildErrorResponse('DATABASE_ERROR', `Failed to retrieve documents: ${fetchErr.message}`, 500);
//       }
//       if (!docs || docs.length === 0) {
//         return buildErrorResponse('NOT_FOUND', 'No documents found.', 404);
//       }
//       const documentWrapperList = await Promise.all(docs.map(async (doc)=>{
//         let viewUrl = '';
//         // Clean up the key and verify it includes the nested folder structure
//         let computedKey = extractStorageKey(doc.s3_path);
//         if (computedKey && !computedKey.startsWith(`${cleanRegNum}/`)) {
//           computedKey = `${cleanRegNum}/${computedKey}`;
//         }
//         if (computedKey) {
//           const { data: signedData } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(computedKey, 900);
//           if (signedData) viewUrl = signedData.signedUrl;
//         }
//         return {
//           documentId: doc.document_id,
//           documentName: doc.name,
//           documentType: doc.document_type,
//           fileUrl: viewUrl,
//           size: doc.file_size ? String(doc.file_size) : null
//         };
//       }));
//       responsePayload.documents = documentWrapperList;
//       return buildSuccessResponse(responsePayload);
//     } else if (normalizedOp === 'DOWNLOAD') {
//       if (!documentId) {
//         return buildErrorResponse('BAD_REQUEST', 'documentId is required.', 400);
//       }
//       const { data: doc, error: findErr } = await supabase.from('SSP_Document').select('name, s3_path').eq('document_id', documentId).eq('society', society.society_id).maybeSingle();
//       if (findErr || !doc || !doc.s3_path) {
//         return buildErrorResponse('NOT_FOUND', 'File not found.', 404);
//       }
//       let computedKey = extractStorageKey(doc.s3_path);
//       if (!computedKey) {
//         return buildErrorResponse('STORAGE_ERROR', 'Target file path extraction layout failed.', 500);
//       }
//       // Safeguard path resolution: Prepend folder if missing
//       if (!computedKey.startsWith(`${cleanRegNum}/`)) {
//         computedKey = `${cleanRegNum}/${computedKey}`;
//       }
//       const { data: signedData, error: downloadErr } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(computedKey, 900);
//       if (downloadErr || !signedData) {
//         return buildErrorResponse('STORAGE_ERROR', `Failed to generate download url: ${downloadErr?.message}`, 500);
//       }
//       responsePayload.fileUrl = signedData.signedUrl;
//       responsePayload.documentName = doc.name;
//       return buildSuccessResponse(responsePayload);
//     }
//     return buildErrorResponse('BAD_REQUEST', 'Invalid operation.', 400);
//   } catch (error) {
//     return buildErrorResponse('SERVER_ERROR', `Processing runtime exception: ${error.message}`, 500);
//   }
// });
// function extractStorageKey(fullUrl) {
//   if (!fullUrl) return null;
//   if (fullUrl.includes(`/${BUCKET_NAME}/`)) {
//     return fullUrl.split(`/${BUCKET_NAME}/`)[1].trim();
//   }
//   if (fullUrl.includes('.amazonaws.com/')) {
//     return fullUrl.split('.amazonaws.com/')[1].trim();
//   }
//   return fullUrl.trim();
// }
// function buildSuccessResponse(payload) {
//   return new Response(JSON.stringify(payload), {
//     status: 200,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }
// function buildErrorResponse(code, message, statusCode) {
//   return new Response(JSON.stringify({
//     documents: null,
//     fileUrl: null,
//     documentName: null,
//     errorResponse: {
//       errorCode: code,
//       message: message,
//       timestamp: new Date().toISOString()
//     }
//   }), {
//     status: statusCode,
//     headers: {
//       ...corsHeaders,
//       'Content-Type': 'application/json'
//     }
//   });
// }

// // deno-lint-ignore-file no-import-prefix
// // ============================================
// // crud-resident-document - Resident Document Management
// // ============================================
// // Actions:
// //   • VIEW      → list society-shared + own documents
// //   • UPLOAD    → two-phase upload (request signed URL → confirm)
// //   • DOWNLOAD  → get signed URL for one document
// //   • DELETE    → delete own document
// //
// // Auth: residentId (UUID) from SSP_Society_User
// // Society scoped. Max 25 MB. Max 10 docs per category per resident.
// //
// // Uploadable categories (image OR PDF):
// //   photo, aadhaar_card, pan_card, driving_license, rent_agreement
// //
// // Note: Complaint images and marketplace images are handled by
// //       separate APIs. This API covers KYC / identity documents.
// // ============================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================

// type Action = "VIEW" | "UPLOAD" | "DOWNLOAD" | "DELETE";
// type UploadPhase = "request" | "confirm";
// type ViewScope = "shared" | "own" | "all";

// interface CrudResidentDocumentRequest {
//   societyRegistrationNumber: string;
//   residentId: string;
//   action: Action;

//   // VIEW options
//   scope?: ViewScope;
//   search?: string;
//   filters?: {
//     documentType?: string | string[];
//     fileType?: string | string[];
//     dateFrom?: string;
//     dateTo?: string;
//   };
//   sort?: {
//     field?: string;
//     order?: "asc" | "desc";
//   };
//   page?: number;
//   limit?: number;

//   // UPLOAD
//   phase?: UploadPhase;
//   payload?: {
//     documentType?: string;
//     fileName?: string;
//     fileType?: string;
//     fileSize?: number | string;
//     objectKey?: string;
//   };

//   // DOWNLOAD / DELETE
//   documentId?: string;
// }

// interface DocumentRow {
//   document_id: string;
//   name: string | null;
//   file_name: string | null;
//   file_type: string | null;
//   file_size: number | null;
//   document_type: string | null;
//   uploaded_on: string | null;
//   s3_path: string | null;
//   society: string | null;
//   society_user: string | null;
// }

// interface MemberRow {
//   user_id: string;
//   role: string[] | string | null;
//   status: boolean | null;
//   society: string | null;
// }

// // ============================================
// // CONSTANTS
// // ============================================

// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers":
//     "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "POST, OPTIONS",
// };

// const BUCKET_NAME = "society-documents";
// const SIGNED_URL_EXPIRY = 900; // 15 min
// const DEFAULT_LIMIT = 20;
// const MAX_LIMIT = 100;
// const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
// const MAX_DOCS_PER_CATEGORY = 10;

// const VALID_ACTIONS: readonly Action[] = [
//   "VIEW",
//   "UPLOAD",
//   "DOWNLOAD",
//   "DELETE",
// ];
// const VALID_SCOPES: readonly ViewScope[] = ["shared", "own", "all"];
// const VALID_SORT_FIELDS = [
//   "name",
//   "file_name",
//   "uploaded_on",
//   "file_size",
//   "document_type",
// ] as const;

// // ── Society-shared categories (visible to everyone, uploaded by admin) ──
// const SHARED_CATEGORIES = [
//   "bylaws",
//   "financial",
//   "society_rules",
//   "identification",
// ] as const;

// // ── Resident-uploadable categories (KYC / identity documents) ──
// // All accept image OR PDF.
// // NOTE: Complaint images and marketplace images are handled by
// //       separate APIs — not here.
// const UPLOADABLE_CATEGORIES = [
//   "photo",
//   "aadhaar_card",
//   "pan_card",
//   "driving_license",
//   "rent_agreement",
// ] as const;

// // ── Valid file types (any of these accepted for any uploadable category) ──
// const VALID_FILE_TYPES = [
//   "application/pdf",
//   "image/avif",
//   "image/jpeg",
//   "image/png",
// ] as const;

// const DOC_SELECT_FIELDS =
//   "document_id,name,file_name,file_type,file_size,document_type," +
//   "uploaded_on,s3_path,society,society_user";

// const supabase = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// // ============================================
// // RESPONSE HELPERS
// // ============================================

// function respond(data: unknown, status = 200): Response {
//   return new Response(
//     JSON.stringify({ status: "SUCCESS", data }),
//     {
//       status,
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//     },
//   );
// }

// function fail(message: string, status = 400, code = "ERROR"): Response {
//   return new Response(
//     JSON.stringify({
//       status: "FAILURE",
//       errorResponse: { errorCode: code, message },
//     }),
//     {
//       status,
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//     },
//   );
// }

// // ============================================
// // VALIDATION HELPERS
// // ============================================

// function isValidUUID(value: string): boolean {
//   return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
//     .test(value);
// }

// function normalizeArray(input: string | string[] | undefined): string[] | null {
//   if (!input) return null;
//   if (Array.isArray(input)) {
//     const cleaned = input.filter((x) => x && String(x).trim() !== "");
//     return cleaned.length > 0 ? cleaned.map((x) => String(x).trim()) : null;
//   }
//   const trimmed = String(input).trim();
//   if (!trimmed) return null;
//   if (trimmed.includes(",")) {
//     const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
//     return parts.length > 0 ? parts : null;
//   }
//   return [trimmed];
// }

// function parseNumber(
//   value: number | string | undefined | null,
// ): number | null {
//   if (value === undefined || value === null || value === "") return null;
//   const n = Number(value);
//   if (!Number.isFinite(n) || n < 0) return null;
//   return n;
// }

// function isUploadable(c: string): boolean {
//   return (UPLOADABLE_CATEGORIES as readonly string[]).includes(c);
// }

// function isShared(c: string): boolean {
//   return (SHARED_CATEGORIES as readonly string[]).includes(c);
// }

// function isValidFileType(t: string): boolean {
//   return (VALID_FILE_TYPES as readonly string[]).includes(t);
// }

// /**
//  * Robustly extract the storage key from any URL format.
//  */
// function extractStorageKey(s3Path: string | null): string | null {
//   if (!s3Path) return null;
//   const trimmed = s3Path.trim();
//   if (!trimmed) return null;

//   const markers = [
//     `/storage/v1/object/public/${BUCKET_NAME}/`,
//     `/storage/v1/object/sign/${BUCKET_NAME}/`,
//     `/${BUCKET_NAME}/`,
//   ];

//   for (const marker of markers) {
//     const idx = trimmed.indexOf(marker);
//     if (idx >= 0) {
//       const key = trimmed.slice(idx + marker.length).split("?")[0].trim();
//       return key || null;
//     }
//   }

//   if (trimmed.includes(".amazonaws.com/")) {
//     const key = trimmed.split(".amazonaws.com/")[1].split("?")[0].trim();
//     return key || null;
//   }

//   const bare = trimmed.split("?")[0].trim();
//   return bare || null;
// }

// // ============================================
// // AUTH
// // ============================================

// async function authorizeResident(
//   societyRegistrationNumber: string,
//   residentId: string,
// ): Promise<
//   | { ok: true; societyId: string; memberId: string }
//   | { ok: false; response: Response }
// > {
//   const cleanRegNum = String(societyRegistrationNumber).trim();
//   const cleanResidentId = String(residentId).trim();

//   if (!isValidUUID(cleanResidentId)) {
//     return {
//       ok: false,
//       response: fail(
//         "residentId must be a valid UUID.",
//         400,
//         "INVALID_PARAMETERS",
//       ),
//     };
//   }

//   const { data: society, error: societyErr } = await supabase
//     .from("SSP_Society")
//     .select("society_id")
//     .eq("registration_number", cleanRegNum)
//     .maybeSingle();

//   if (societyErr) {
//     return {
//       ok: false,
//       response: fail(societyErr.message, 500, "DATABASE_ERROR"),
//     };
//   }
//   if (!society) {
//     return {
//       ok: false,
//       response: fail("Society not found.", 404, "NOT_FOUND"),
//     };
//   }

//   const { data: member, error: memberErr } = await supabase
//     .from("SSP_Society_User")
//     .select("user_id, role, status, society")
//     .eq("user_id", cleanResidentId)
//     .eq("society", society.society_id)
//     .maybeSingle();

//   if (memberErr) {
//     return {
//       ok: false,
//       response: fail(memberErr.message, 500, "DATABASE_ERROR"),
//     };
//   }

//   if (!member) {
//     return {
//       ok: false,
//       response: fail(
//         "Unauthorized. Member does not belong to this society.",
//         403,
//         "UNAUTHORIZED",
//       ),
//     };
//   }

//   const row = member as MemberRow;

//   if (row.status === false) {
//     return {
//       ok: false,
//       response: fail(
//         "Unauthorized. Member account is inactive.",
//         403,
//         "UNAUTHORIZED",
//       ),
//     };
//   }

//   return {
//     ok: true,
//     societyId: society.society_id,
//     memberId: row.user_id,
//   };
// }

// // ============================================
// // FORMATTERS
// // ============================================

// async function createSignedUrl(key: string): Promise<string | null> {
//   const { data, error } = await supabase.storage
//     .from(BUCKET_NAME)
//     .createSignedUrl(key, SIGNED_URL_EXPIRY);
//   if (error || !data) return null;
//   return data.signedUrl;
// }

// async function formatDocument(
//   row: DocumentRow,
//   memberId: string,
// ): Promise<Record<string, unknown>> {
//   const key = extractStorageKey(row.s3_path);
//   const signedUrl = key ? await createSignedUrl(key) : null;
//   const isOwner = row.society_user === memberId;

//   return {
//     documentId: row.document_id,
//     name: row.name,
//     fileName: row.file_name,
//     fileType: row.file_type,
//     fileSize: row.file_size != null ? String(row.file_size) : "0",
//     documentType: row.document_type,
//     uploadedOn: row.uploaded_on,
//     isOwnedByMe: isOwner,
//     canDelete: isOwner,
//     viewUrl: signedUrl,
//     downloadUrl: signedUrl,
//     expiresIn: SIGNED_URL_EXPIRY,
//   };
// }

// // ============================================
// // ACTION: VIEW
// // ============================================

// async function handleView(
//   req: CrudResidentDocumentRequest,
//   societyId: string,
//   memberId: string,
// ): Promise<Response> {
//   const page = Math.max(1, Number(req.page) || 1);
//   const limit = Math.min(
//     MAX_LIMIT,
//     Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
//   );
//   const offset = (page - 1) * limit;

//   const scope: ViewScope = VALID_SCOPES.includes(req.scope as ViewScope)
//     ? (req.scope as ViewScope)
//     : "all";

//   const requestedTypes = normalizeArray(req.filters?.documentType);

//   let query = supabase
//     .from("SSP_Document")
//     .select(DOC_SELECT_FIELDS, { count: "exact" })
//     .eq("society", societyId)
//     .not("s3_path", "is", null);

//   // ── Scope filter ──
//   if (scope === "shared") {
//     query = query
//       .in("document_type", SHARED_CATEGORIES)
//       .is("society_user", null);
//   } else if (scope === "own") {
//     query = query.eq("society_user", memberId);
//   } else {
//     // all = shared OR own
//     query = query.or(
//       `and(document_type.in.(${
//         SHARED_CATEGORIES.join(",")
//       }),society_user.is.null),` +
//         `society_user.eq.${memberId}`,
//     );
//   }

//   // ── Explicit category filter ──
//   if (requestedTypes && requestedTypes.length > 0) {
//     query = query.in("document_type", requestedTypes);
//   }

//   // ── Search ──
//   if (req.search && req.search.trim() !== "") {
//     const term = req.search.trim();
//     query = query.or(
//       `name.ilike.%${term}%,` +
//         `file_name.ilike.%${term}%,` +
//         `document_type.ilike.%${term}%,` +
//         `file_type.ilike.%${term}%`,
//     );
//   }

//   // ── Date filter ──
//   if (req.filters?.dateFrom) {
//     query = query.gte("uploaded_on", req.filters.dateFrom);
//   }
//   if (req.filters?.dateTo) {
//     query = query.lte(
//       "uploaded_on",
//       `${req.filters.dateTo}T23:59:59.999Z`,
//     );
//   }

//   // ── File type filter ──
//   const fileTypes = normalizeArray(req.filters?.fileType);
//   if (fileTypes && fileTypes.length > 0) {
//     query = query.in("file_type", fileTypes);
//   }

//   // ── Sort ──
//   const requestedSort = req.sort?.field || "uploaded_on";
//   const sortField = VALID_SORT_FIELDS.includes(
//       requestedSort as typeof VALID_SORT_FIELDS[number],
//     )
//     ? requestedSort
//     : "uploaded_on";
//   const ascending = req.sort?.order === "asc";
//   query = query.order(sortField, { ascending });

//   // ── Pagination ──
//   query = query.range(offset, offset + limit - 1);

//   const { data, error, count } = await query;

//   if (error) {
//     return fail(error.message, 500, "DATABASE_ERROR");
//   }

//   const rows = (data ?? []) as DocumentRow[];
//   const documents = await Promise.all(
//     rows.map((r) => formatDocument(r, memberId)),
//   );

//   const total = count ?? 0;
//   const totalPages = Math.ceil(total / limit);

//   return respond({
//     documents,
//     pagination: {
//       total,
//       page,
//       limit,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPrevPage: page > 1,
//     },
//     filters: {
//       documentType: req.filters?.documentType ?? null,
//       fileType: req.filters?.fileType ?? null,
//       dateFrom: req.filters?.dateFrom ?? null,
//       dateTo: req.filters?.dateTo ?? null,
//     },
//     search: req.search ?? null,
//     scope,
//     sort: { field: sortField, order: ascending ? "asc" : "desc" },
//   });
// }

// // ============================================
// // ACTION: UPLOAD
// // ============================================

// async function handleUpload(
//   req: CrudResidentDocumentRequest,
//   societyId: string,
//   memberId: string,
//   societyRegNo: string,
// ): Promise<Response> {
//   const p = req.payload;
//   if (!p) {
//     return fail(
//       "payload is required for UPLOAD.",
//       400,
//       "MISSING_PARAMETERS",
//     );
//   }

//   const phase = (req.phase || "request").toLowerCase();

//   // ── Required fields ──
//   const required = ["documentType", "fileName", "fileType"] as const;
//   for (const k of required) {
//     if (!p[k] || String(p[k]).trim() === "") {
//       return fail(
//         `payload.${k} is required for UPLOAD.`,
//         400,
//         "MISSING_PARAMETERS",
//       );
//     }
//   }

//   const cleanFileName = String(p.fileName).trim();
//   const cleanFileType = String(p.fileType).trim().toLowerCase();
//   const cleanCategory = String(p.documentType).trim().toLowerCase();
//   const fileSize = parseNumber(p.fileSize);

//   // ── Validate: category is uploadable ──
//   if (!isUploadable(cleanCategory)) {
//     return fail(
//       `Invalid documentType: "${cleanCategory}". Residents can upload: ${
//         UPLOADABLE_CATEGORIES.join(", ")
//       }`,
//       400,
//       "INVALID_PARAMETERS",
//     );
//   }

//   // ── Validate: file type ──
//   if (!isValidFileType(cleanFileType)) {
//     return fail(
//       `Invalid fileType: "${cleanFileType}". Valid: ${
//         VALID_FILE_TYPES.join(", ")
//       }`,
//       400,
//       "INVALID_PARAMETERS",
//     );
//   }

//   // ── Validate: file size ──
//   if (fileSize !== null && fileSize > MAX_FILE_SIZE) {
//     return fail(
//       `File too large. Max ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
//       400,
//       "FILE_TOO_LARGE",
//     );
//   }

//   // ── PHASE: request ──
//   if (phase === "request") {
//     const { count: existingCount } = await supabase
//       .from("SSP_Document")
//       .select("document_id", { count: "exact", head: true })
//       .eq("society_user", memberId)
//       .eq("document_type", cleanCategory);

//     if (existingCount !== null && existingCount >= MAX_DOCS_PER_CATEGORY) {
//       return fail(
//         `You have reached the limit of ${MAX_DOCS_PER_CATEGORY} documents for "${cleanCategory}". Delete old ones to upload more.`,
//         400,
//         "LIMIT_EXCEEDED",
//       );
//     }

//     const safeName = cleanFileName.replace(/\s+/g, "_");
//     const uniqueName = `${Date.now()}_${safeName}`;
//     const sanitizedFolder = cleanCategory.replace(/\s+/g, "_");
//     const objectKey =
//       `${societyRegNo}/${memberId}/${sanitizedFolder}/${uniqueName}`;

//     const { data, error } = await supabase.storage
//       .from(BUCKET_NAME)
//       .createSignedUploadUrl(objectKey);

//     if (error || !data) {
//       return fail(
//         `Failed to generate upload URL: ${error?.message ?? "unknown"}`,
//         500,
//         "STORAGE_ERROR",
//       );
//     }

//     return respond({
//       uploaded: false,
//       signedUrl: data.signedUrl,
//       objectKey,
//       expiresIn: SIGNED_URL_EXPIRY,
//       maxFileSize: MAX_FILE_SIZE,
//       remainingSlots: MAX_DOCS_PER_CATEGORY - (existingCount ?? 0) - 1,
//     });
//   }

//   // ── PHASE: confirm ──
//   if (phase === "confirm") {
//     if (!p.objectKey || String(p.objectKey).trim() === "") {
//       return fail(
//         "payload.objectKey is required for confirm phase.",
//         400,
//         "MISSING_PARAMETERS",
//       );
//     }

//     const objectKey = String(p.objectKey).trim();

//     const pathParts = objectKey.split("/");
//     const fileName = pathParts.pop() ?? "";
//     const folder = pathParts.join("/");

//     const { data: existsCheck } = await supabase.storage
//       .from(BUCKET_NAME)
//       .list(folder, { search: fileName });

//     const fileExists = Array.isArray(existsCheck) &&
//       existsCheck.some((f) => f.name === fileName);

//     if (!fileExists) {
//       return fail(
//         "Uploaded file not found in storage. Please re-upload.",
//         400,
//         "STORAGE_ERROR",
//       );
//     }

//     const { data: urlData } = supabase.storage
//       .from(BUCKET_NAME)
//       .getPublicUrl(objectKey);

//     const { data: inserted, error: insertErr } = await supabase
//       .from("SSP_Document")
//       .insert({
//         name: `${cleanCategory} - Resident Upload`,
//         file_name: cleanFileName,
//         file_type: cleanFileType,
//         file_size: fileSize,
//         document_type: cleanCategory,
//         s3_path: urlData.publicUrl,
//         society: societyId,
//         society_user: memberId,
//         uploaded_on: new Date().toISOString(),
//       })
//       .select("document_id")
//       .single();

//     if (insertErr || !inserted) {
//       return fail(
//         `Failed to save document: ${insertErr?.message ?? "unknown"}`,
//         500,
//         "DATABASE_ERROR",
//       );
//     }

//     return respond({
//       uploaded: true,
//       documentId: inserted.document_id,
//       objectKey,
//       message: "Document uploaded successfully.",
//     });
//   }

//   return fail(
//     `Invalid phase: "${phase}". Use "request" or "confirm".`,
//     400,
//     "INVALID_PARAMETERS",
//   );
// }

// // ============================================
// // ACTION: DOWNLOAD
// // ============================================

// async function handleDownload(
//   req: CrudResidentDocumentRequest,
//   societyId: string,
//   memberId: string,
// ): Promise<Response> {
//   if (!req.documentId || String(req.documentId).trim() === "") {
//     return fail("documentId is required.", 400, "MISSING_PARAMETERS");
//   }
//   if (!isValidUUID(String(req.documentId).trim())) {
//     return fail(
//       "documentId must be a valid UUID.",
//       400,
//       "INVALID_PARAMETERS",
//     );
//   }

//   const { data: doc, error: findErr } = await supabase
//     .from("SSP_Document")
//     .select(DOC_SELECT_FIELDS)
//     .eq("document_id", String(req.documentId).trim())
//     .eq("society", societyId)
//     .maybeSingle();

//   if (findErr) return fail(findErr.message, 500, "DATABASE_ERROR");
//   if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

//   const row = doc as DocumentRow;

//   const category = (row.document_type ?? "").toLowerCase();
//   const isSharedDoc = isShared(category) && !row.society_user;
//   const isOwnDoc = row.society_user === memberId;

//   if (!isSharedDoc && !isOwnDoc) {
//     return fail(
//       "Access denied. Document is not shared and does not belong to you.",
//       403,
//       "UNAUTHORIZED",
//     );
//   }

//   const storageKey = extractStorageKey(row.s3_path);
//   if (!storageKey) {
//     return fail(
//       "Document has no valid storage path.",
//       500,
//       "STORAGE_ERROR",
//     );
//   }

//   const signedUrl = await createSignedUrl(storageKey);
//   if (!signedUrl) {
//     return fail(
//       "Failed to generate download URL.",
//       500,
//       "STORAGE_ERROR",
//     );
//   }

//   return respond({
//     documentId: row.document_id,
//     name: row.name,
//     fileName: row.file_name,
//     fileType: row.file_type,
//     fileSize: row.file_size != null ? String(row.file_size) : "0",
//     documentType: row.document_type,
//     signedUrl,
//     expiresIn: SIGNED_URL_EXPIRY,
//   });
// }

// // ============================================
// // ACTION: DELETE
// // ============================================

// async function handleDelete(
//   req: CrudResidentDocumentRequest,
//   societyId: string,
//   memberId: string,
// ): Promise<Response> {
//   if (!req.documentId || String(req.documentId).trim() === "") {
//     return fail("documentId is required.", 400, "MISSING_PARAMETERS");
//   }
//   if (!isValidUUID(String(req.documentId).trim())) {
//     return fail(
//       "documentId must be a valid UUID.",
//       400,
//       "INVALID_PARAMETERS",
//     );
//   }

//   const { data: doc, error: findErr } = await supabase
//     .from("SSP_Document")
//     .select("document_id,s3_path,society,society_user")
//     .eq("document_id", String(req.documentId).trim())
//     .eq("society", societyId)
//     .maybeSingle();

//   if (findErr) return fail(findErr.message, 500, "DATABASE_ERROR");
//   if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

//   const row = doc as {
//     document_id: string;
//     s3_path: string | null;
//     society: string | null;
//     society_user: string | null;
//   };

//   if (row.society_user !== memberId) {
//     return fail(
//       "Access denied. You can only delete your own documents.",
//       403,
//       "UNAUTHORIZED",
//     );
//   }

//   const storageKey = extractStorageKey(row.s3_path);

//   if (storageKey) {
//     const { error: storageErr } = await supabase.storage
//       .from(BUCKET_NAME)
//       .remove([storageKey]);
//     if (storageErr) {
//       console.error(
//         `⚠️ Storage delete failed for ${storageKey}: ${storageErr.message}`,
//       );
//     }
//   }

//   const { error: dbErr } = await supabase
//     .from("SSP_Document")
//     .delete()
//     .eq("document_id", String(req.documentId).trim())
//     .eq("society", societyId)
//     .eq("society_user", memberId);

//   if (dbErr) return fail(dbErr.message, 500, "DATABASE_ERROR");

//   return respond({
//     documentId: req.documentId,
//     message: "Document deleted successfully.",
//   });
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// serve(async (req: Request) => {
//   if (req.method === "OPTIONS") {
//     return new Response("ok", { headers: corsHeaders });
//   }

//   if (req.method !== "POST") {
//     return fail("Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
//   }

//   const startTime = Date.now();

//   try {
//     const body = (await req.json().catch(() => null)) as
//       | CrudResidentDocumentRequest
//       | null;
//     if (!body) return fail("Request body is required.", 400, "BAD_REQUEST");

//     const { societyRegistrationNumber, residentId, action } = body;

//     if (!societyRegistrationNumber || !residentId || !action) {
//       return fail(
//         "societyRegistrationNumber, residentId, and action are required.",
//         400,
//         "MISSING_PARAMETERS",
//       );
//     }

//     const actionUpper = String(action).toUpperCase() as Action;
//     if (!VALID_ACTIONS.includes(actionUpper)) {
//       return fail(
//         `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
//         400,
//         "INVALID_ACTION",
//       );
//     }

//     const auth = await authorizeResident(
//       String(societyRegistrationNumber),
//       String(residentId),
//     );
//     if (!auth.ok) return auth.response;

//     const societyId = auth.societyId;
//     const memberId = auth.memberId;
//     const cleanRegNo = String(societyRegistrationNumber).trim();

//     let response: Response;

//     switch (actionUpper) {
//       case "VIEW":
//         response = await handleView(body, societyId, memberId);
//         break;
//       case "UPLOAD":
//         response = await handleUpload(
//           body,
//           societyId,
//           memberId,
//           cleanRegNo,
//         );
//         break;
//       case "DOWNLOAD":
//         response = await handleDownload(body, societyId, memberId);
//         break;
//       case "DELETE":
//         response = await handleDelete(body, societyId, memberId);
//         break;
//       default:
//         return fail("Unhandled action.", 400, "INVALID_ACTION");
//     }

//     console.log(
//       `✅ crud-resident-document: action=${actionUpper}, society=${societyId}, ` +
//         `${Date.now() - startTime}ms`,
//     );

//     return response;
//   } catch (err: unknown) {
//     console.error("❌ FULL ERROR:", err);

//     let msg = "Unknown error";
//     if (err instanceof Error) msg = err.message;
//     else if (typeof err === "string") msg = err;
//     else if (err && typeof err === "object" && "message" in err) {
//       msg = String((err as { message: unknown }).message);
//     } else if (err && typeof err === "object") {
//       try {
//         msg = JSON.stringify(err);
//       } catch {
//         msg = "Unserializable error";
//       }
//     }

//     console.error("❌ crud-resident-document error:", msg);
//     return fail(msg, 500, "SERVER_ERROR");
//   }
// });

// deno-lint-ignore-file no-import-prefix
// ============================================
// crud-resident-document - Resident Document Management
// ============================================
// Actions:
//   • VIEW      → list own resident documents
//   • UPLOAD    → two-phase upload (request signed URL → confirm)
//   • DOWNLOAD  → get signed URL for one of own documents
//   • DELETE    → delete own document
//
// Auth: residentId (UUID) from SSP_Society_User
// Society scoped. Max 25 MB. Max 10 docs per category per resident.
//
// Resident-visible & uploadable categories ONLY:
//   photo, aadhaar_card, pan_card, driving_license, rent_agreement
//
// Storage path:
//   <societyRegNo>/documents/residentDocuments/<documentId>/<fileName>
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

type Action = "VIEW" | "UPLOAD" | "DOWNLOAD" | "DELETE";
type UploadPhase = "request" | "confirm";
type ViewScope = "own" | "all";

interface CrudResidentDocumentRequest {
  societyRegistrationNumber: string;
  residentId: string;
  action: Action;

  // VIEW options
  scope?: ViewScope;
  search?: string;
  filters?: {
    documentType?: string | string[];
    fileType?: string | string[];
    dateFrom?: string;
    dateTo?: string;
  };
  sort?: { field?: string; order?: "asc" | "desc" };
  page?: number;
  limit?: number;

  // UPLOAD
  phase?: UploadPhase;
  payload?: {
    documentType?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number | string;
    objectKey?: string;
  };

  // DOWNLOAD / DELETE / UPLOAD-confirm
  documentId?: string;
}

interface DocumentRow {
  document_id: string;
  name: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  document_type: string | null;
  uploaded_on: string | null;
  s3_path: string | null;
  society: string | null;
  society_user: string | null;
}

interface MemberRow {
  user_id: string;
  role: string[] | string | null;
  status: boolean | null;
  society: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET_NAME = "society-documents";

// Resident docs live under: <societyRegNo>/documents/residentDocuments/<documentId>/<fileName>
const RESIDENT_DOCUMENTS_FOLDER = "documents/residentDocuments";

const SIGNED_URL_EXPIRY = 900; // 15 min
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_DOCS_PER_CATEGORY = 10;

const VALID_ACTIONS: readonly Action[] = [
  "VIEW",
  "UPLOAD",
  "DOWNLOAD",
  "DELETE",
];
const VALID_SCOPES: readonly ViewScope[] = ["own", "all"];
const VALID_SORT_FIELDS = [
  "name",
  "file_name",
  "uploaded_on",
  "file_size",
  "document_type",
] as const;

// ── Resident-visible & uploadable categories (ONLY these) ──
// KYC / identity docs. Shared society documents are NOT visible here.
const RESIDENT_CATEGORIES = [
  "photo",
  "aadhaar_card",
  "pan_card",
  "driving_license",
  "rent_agreement",
] as const;

// ── Valid file types (image OR PDF) ──
const VALID_FILE_TYPES = [
  "application/pdf",
  "image/avif",
  "image/jpeg",
  "image/png",
] as const;

const DOC_SELECT_FIELDS =
  "document_id,name,file_name,file_type,file_size,document_type," +
  "uploaded_on,s3_path,society,society_user";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// RESPONSE HELPERS
// ============================================

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ status: "SUCCESS", data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400, code = "ERROR"): Response {
  return new Response(
    JSON.stringify({
      status: "FAILURE",
      errorResponse: { errorCode: code, message },
    }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================
// VALIDATION HELPERS
// ============================================

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(value);
}

function normalizeArray(input: string | string[] | undefined): string[] | null {
  if (!input) return null;
  if (Array.isArray(input)) {
    const cleaned = input.filter((x) => x && String(x).trim() !== "");
    return cleaned.length > 0 ? cleaned.map((x) => String(x).trim()) : null;
  }
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  return [trimmed];
}

function parseNumber(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isResidentCategory(c: string): boolean {
  return (RESIDENT_CATEGORIES as readonly string[]).includes(c);
}

function isValidFileType(t: string): boolean {
  return (VALID_FILE_TYPES as readonly string[]).includes(t);
}

function extractStorageKey(s3Path: string | null): string | null {
  if (!s3Path) return null;
  const trimmed = s3Path.trim();
  if (!trimmed) return null;

  const markers = [
    `/storage/v1/object/public/${BUCKET_NAME}/`,
    `/storage/v1/object/sign/${BUCKET_NAME}/`,
    `/${BUCKET_NAME}/`,
  ];
  for (const marker of markers) {
    const idx = trimmed.indexOf(marker);
    if (idx >= 0) {
      const key = trimmed.slice(idx + marker.length).split("?")[0].trim();
      return key || null;
    }
  }
  if (trimmed.includes(".amazonaws.com/")) {
    const key = trimmed.split(".amazonaws.com/")[1].split("?")[0].trim();
    return key || null;
  }
  const bare = trimmed.split("?")[0].trim();
  return bare || null;
}

// ============================================
// AUTH
// ============================================

async function authorizeResident(
  societyRegistrationNumber: string,
  residentId: string,
): Promise<
  | { ok: true; societyId: string; memberId: string }
  | { ok: false; response: Response }
> {
  const cleanRegNum = String(societyRegistrationNumber).trim();
  const cleanResidentId = String(residentId).trim();

  if (!isValidUUID(cleanResidentId)) {
    return {
      ok: false,
      response: fail(
        "residentId must be a valid UUID.",
        400,
        "INVALID_PARAMETERS",
      ),
    };
  }

  const { data: society, error: societyErr } = await supabase
    .from("SSP_Society")
    .select("society_id")
    .eq("registration_number", cleanRegNum)
    .maybeSingle();

  if (societyErr) {
    return {
      ok: false,
      response: fail(societyErr.message, 500, "DATABASE_ERROR"),
    };
  }
  if (!society) {
    return {
      ok: false,
      response: fail("Society not found.", 404, "NOT_FOUND"),
    };
  }

  const { data: member, error: memberErr } = await supabase
    .from("SSP_Society_User")
    .select("user_id, role, status, society")
    .eq("user_id", cleanResidentId)
    .eq("society", society.society_id)
    .maybeSingle();

  if (memberErr) {
    return {
      ok: false,
      response: fail(memberErr.message, 500, "DATABASE_ERROR"),
    };
  }
  if (!member) {
    return {
      ok: false,
      response: fail(
        "Unauthorized. Member does not belong to this society.",
        403,
        "UNAUTHORIZED",
      ),
    };
  }

  const row = member as MemberRow;
  if (row.status === false) {
    return {
      ok: false,
      response: fail(
        "Unauthorized. Member account is inactive.",
        403,
        "UNAUTHORIZED",
      ),
    };
  }

  return { ok: true, societyId: society.society_id, memberId: row.user_id };
}

// ============================================
// FORMATTERS
// ============================================

async function createSignedUrl(key: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(key, SIGNED_URL_EXPIRY);
  if (error || !data) return null;
  return data.signedUrl;
}

async function formatDocument(
  row: DocumentRow,
  memberId: string,
): Promise<Record<string, unknown>> {
  const key = extractStorageKey(row.s3_path);
  const signedUrl = key ? await createSignedUrl(key) : null;
  const isOwner = row.society_user === memberId;

  return {
    documentId: row.document_id,
    name: row.name,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size != null ? String(row.file_size) : "0",
    documentType: row.document_type,
    uploadedOn: row.uploaded_on,
    isOwnedByMe: isOwner,
    canDelete: isOwner,
    viewUrl: signedUrl,
    downloadUrl: signedUrl,
    expiresIn: SIGNED_URL_EXPIRY,
  };
}

// ============================================
// ACTION: VIEW — only own resident docs
// ============================================

async function handleView(
  req: CrudResidentDocumentRequest,
  societyId: string,
  memberId: string,
): Promise<Response> {
  const page = Math.max(1, Number(req.page) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  const scope: ViewScope = VALID_SCOPES.includes(req.scope as ViewScope)
    ? (req.scope as ViewScope)
    : "all";

  // Explicit category filter (must be a subset of RESIDENT_CATEGORIES)
  const requestedTypes = normalizeArray(req.filters?.documentType);
  const categoryFilter = requestedTypes && requestedTypes.length > 0
    ? requestedTypes.filter((c) => isResidentCategory(c.toLowerCase()))
    : null;

  if (
    requestedTypes && requestedTypes.length > 0 &&
    (!categoryFilter || categoryFilter.length === 0)
  ) {
    return fail(
      `Invalid documentType filter. Residents can only view: ${
        RESIDENT_CATEGORIES.join(", ")
      }`,
      400,
      "INVALID_PARAMETERS",
    );
  }

  let query = supabase
    .from("SSP_Document")
    .select(DOC_SELECT_FIELDS, { count: "exact" })
    .eq("society", societyId)
    .not("s3_path", "is", null)
    // Resident API — always scoped to this resident's own docs
    .eq("society_user", memberId)
    // And only the resident-category set
    .in("document_type", RESIDENT_CATEGORIES);

  // scope === "own" is identical to the base query; "all" here = same (no shared docs)
  // Kept for request-shape compatibility.
  void scope;

  if (categoryFilter && categoryFilter.length > 0) {
    query = query.in(
      "document_type",
      categoryFilter.map((c) => c.toLowerCase()),
    );
  }

  if (req.search && req.search.trim() !== "") {
    const term = req.search.trim();
    query = query.or(
      `name.ilike.%${term}%,` +
        `file_name.ilike.%${term}%,` +
        `document_type.ilike.%${term}%,` +
        `file_type.ilike.%${term}%`,
    );
  }

  if (req.filters?.dateFrom) {
    query = query.gte("uploaded_on", req.filters.dateFrom);
  }
  if (req.filters?.dateTo) {
    query = query.lte("uploaded_on", `${req.filters.dateTo}T23:59:59.999Z`);
  }

  const fileTypes = normalizeArray(req.filters?.fileType);
  if (fileTypes && fileTypes.length > 0) {
    query = query.in("file_type", fileTypes);
  }

  const requestedSort = req.sort?.field || "uploaded_on";
  const sortField = VALID_SORT_FIELDS.includes(
      requestedSort as typeof VALID_SORT_FIELDS[number],
    )
    ? requestedSort
    : "uploaded_on";
  const ascending = req.sort?.order === "asc";
  query = query.order(sortField, { ascending });

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return fail(error.message, 500, "DATABASE_ERROR");

  const rows = (data ?? []) as DocumentRow[];
  const documents = await Promise.all(
    rows.map((r) => formatDocument(r, memberId)),
  );

  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return respond({
    documents,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      documentType: req.filters?.documentType ?? null,
      fileType: req.filters?.fileType ?? null,
      dateFrom: req.filters?.dateFrom ?? null,
      dateTo: req.filters?.dateTo ?? null,
    },
    search: req.search ?? null,
    scope,
    sort: { field: sortField, order: ascending ? "asc" : "desc" },
  });
}

// ============================================
// ACTION: UPLOAD
// ============================================

async function handleUpload(
  req: CrudResidentDocumentRequest,
  societyId: string,
  memberId: string,
  societyRegNo: string,
): Promise<Response> {
  const p = req.payload;
  if (!p) {
    return fail("payload is required for UPLOAD.", 400, "MISSING_PARAMETERS");
  }

  const phase = (req.phase || "request").toLowerCase();

  const required = ["documentType", "fileName", "fileType"] as const;
  for (const k of required) {
    if (!p[k] || String(p[k]).trim() === "") {
      return fail(
        `payload.${k} is required for UPLOAD.`,
        400,
        "MISSING_PARAMETERS",
      );
    }
  }

  const cleanFileName = String(p.fileName).trim();
  const cleanFileType = String(p.fileType).trim().toLowerCase();
  const cleanCategory = String(p.documentType).trim().toLowerCase();
  const fileSize = parseNumber(p.fileSize);

  // ── Path-traversal / shape guard ──
  if (/[\/\\]/.test(cleanFileName) || cleanFileName.includes("..")) {
    return fail(
      "payload.fileName must not contain slashes or '..'.",
      400,
      "INVALID_PARAMETERS",
    );
  }

  // ── Validate: category must be one of the resident categories ──
  if (!isResidentCategory(cleanCategory)) {
    return fail(
      `Invalid documentType: "${cleanCategory}". Residents can upload: ${
        RESIDENT_CATEGORIES.join(", ")
      }`,
      400,
      "INVALID_PARAMETERS",
    );
  }

  // ── Validate: file type ──
  if (!isValidFileType(cleanFileType)) {
    return fail(
      `Invalid fileType: "${cleanFileType}". Valid: ${
        VALID_FILE_TYPES.join(", ")
      }`,
      400,
      "INVALID_PARAMETERS",
    );
  }

  // ── Validate: file size ──
  if (fileSize !== null && fileSize > MAX_FILE_SIZE) {
    return fail(
      `File too large. Max ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
      400,
      "FILE_TOO_LARGE",
    );
  }

  // ── PHASE: request ──
  if (phase === "request") {
    const { count: existingCount } = await supabase
      .from("SSP_Document")
      .select("document_id", { count: "exact", head: true })
      .eq("society_user", memberId)
      .eq("document_type", cleanCategory);

    if (existingCount !== null && existingCount >= MAX_DOCS_PER_CATEGORY) {
      return fail(
        `You have reached the limit of ${MAX_DOCS_PER_CATEGORY} documents for "${cleanCategory}". Delete old ones to upload more.`,
        400,
        "LIMIT_EXCEEDED",
      );
    }

    // Pre-generate documentId so it can be the folder name in the path.
    const documentId = crypto.randomUUID();

    // Path: <societyRegNo>/documents/residentDocuments/<documentId>/<fileName>
    const objectKey =
      `${societyRegNo}/${RESIDENT_DOCUMENTS_FOLDER}/${documentId}/${cleanFileName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(objectKey);

    if (error || !data) {
      return fail(
        `Failed to generate upload URL: ${error?.message ?? "unknown"}`,
        500,
        "STORAGE_ERROR",
      );
    }

    return respond({
      uploaded: false,
      documentId, // client MUST echo this back in the confirm phase
      signedUrl: data.signedUrl,
      objectKey,
      expiresIn: SIGNED_URL_EXPIRY,
      maxFileSize: MAX_FILE_SIZE,
      remainingSlots: MAX_DOCS_PER_CATEGORY - (existingCount ?? 0) - 1,
    });
  }

  // ── PHASE: confirm ──
  if (phase === "confirm") {
    if (!p.objectKey || String(p.objectKey).trim() === "") {
      return fail(
        "payload.objectKey is required for confirm phase.",
        400,
        "MISSING_PARAMETERS",
      );
    }
    if (!req.documentId || String(req.documentId).trim() === "") {
      return fail(
        "documentId (returned by the request phase) is required for confirm phase.",
        400,
        "MISSING_PARAMETERS",
      );
    }
    if (!isValidUUID(String(req.documentId).trim())) {
      return fail(
        "documentId must be a valid UUID.",
        400,
        "INVALID_PARAMETERS",
      );
    }

    const objectKey = String(p.objectKey).trim();
    const documentId = String(req.documentId).trim();

    const expectedSegment =
      `${societyRegNo}/${RESIDENT_DOCUMENTS_FOLDER}/${documentId}/`;
    if (!objectKey.startsWith(expectedSegment)) {
      return fail(
        "objectKey does not match the provided documentId.",
        400,
        "INVALID_PARAMETERS",
      );
    }

    const pathParts = objectKey.split("/");
    const leafName = pathParts.pop() ?? "";
    const folder = pathParts.join("/");

    const { data: existsCheck } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folder, { search: leafName });

    const fileExists = Array.isArray(existsCheck) &&
      existsCheck.some((f) => `${folder}/${f.name}` === objectKey);

    if (!fileExists) {
      return fail(
        "Uploaded file not found in storage. Please re-upload.",
        400,
        "STORAGE_ERROR",
      );
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(objectKey);

    const { data: inserted, error: insertErr } = await supabase
      .from("SSP_Document")
      .insert({
        document_id: documentId, // use the pre-generated UUID
        name: `${cleanCategory} - Resident Upload`,
        file_name: cleanFileName,
        file_type: cleanFileType,
        file_size: fileSize,
        document_type: cleanCategory,
        s3_path: urlData.publicUrl,
        society: societyId,
        society_user: memberId,
        uploaded_on: new Date().toISOString(),
      })
      .select("document_id")
      .single();

    if (insertErr || !inserted) {
      return fail(
        `Failed to save document: ${insertErr?.message ?? "unknown"}`,
        500,
        "DATABASE_ERROR",
      );
    }

    return respond({
      uploaded: true,
      documentId: inserted.document_id,
      objectKey,
      message: "Document uploaded successfully.",
    });
  }

  return fail(
    `Invalid phase: "${phase}". Use "request" or "confirm".`,
    400,
    "INVALID_PARAMETERS",
  );
}

// ============================================
// ACTION: DOWNLOAD — own resident docs only
// ============================================

async function handleDownload(
  req: CrudResidentDocumentRequest,
  societyId: string,
  memberId: string,
): Promise<Response> {
  if (!req.documentId || String(req.documentId).trim() === "") {
    return fail("documentId is required.", 400, "MISSING_PARAMETERS");
  }
  if (!isValidUUID(String(req.documentId).trim())) {
    return fail("documentId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }

  const { data: doc, error: findErr } = await supabase
    .from("SSP_Document")
    .select(DOC_SELECT_FIELDS)
    .eq("document_id", String(req.documentId).trim())
    .eq("society", societyId)
    .maybeSingle();

  if (findErr) return fail(findErr.message, 500, "DATABASE_ERROR");
  if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

  const row = doc as DocumentRow;
  const category = (row.document_type ?? "").toLowerCase();

  // Must be an own document AND in the resident category set
  if (row.society_user !== memberId) {
    return fail(
      "Access denied. Document does not belong to you.",
      403,
      "UNAUTHORIZED",
    );
  }
  if (!isResidentCategory(category)) {
    return fail(
      "Access denied. Document is not a resident-uploadable category.",
      403,
      "UNAUTHORIZED",
    );
  }

  const storageKey = extractStorageKey(row.s3_path);
  if (!storageKey) {
    return fail("Document has no valid storage path.", 500, "STORAGE_ERROR");
  }

  const signedUrl = await createSignedUrl(storageKey);
  if (!signedUrl) {
    return fail("Failed to generate download URL.", 500, "STORAGE_ERROR");
  }

  return respond({
    documentId: row.document_id,
    name: row.name,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size != null ? String(row.file_size) : "0",
    documentType: row.document_type,
    signedUrl,
    expiresIn: SIGNED_URL_EXPIRY,
  });
}

// ============================================
// ACTION: DELETE (unchanged behaviour)
// ============================================

async function handleDelete(
  req: CrudResidentDocumentRequest,
  societyId: string,
  memberId: string,
): Promise<Response> {
  if (!req.documentId || String(req.documentId).trim() === "") {
    return fail("documentId is required.", 400, "MISSING_PARAMETERS");
  }
  if (!isValidUUID(String(req.documentId).trim())) {
    return fail("documentId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }

  const { data: doc, error: findErr } = await supabase
    .from("SSP_Document")
    .select("document_id,s3_path,society,society_user,document_type")
    .eq("document_id", String(req.documentId).trim())
    .eq("society", societyId)
    .maybeSingle();

  if (findErr) return fail(findErr.message, 500, "DATABASE_ERROR");
  if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

  const row = doc as {
    document_id: string;
    s3_path: string | null;
    society: string | null;
    society_user: string | null;
    document_type: string | null;
  };

  if (row.society_user !== memberId) {
    return fail(
      "Access denied. You can only delete your own documents.",
      403,
      "UNAUTHORIZED",
    );
  }
  if (!isResidentCategory((row.document_type ?? "").toLowerCase())) {
    return fail(
      "Access denied. Document is not a resident-uploadable category.",
      403,
      "UNAUTHORIZED",
    );
  }

  const storageKey = extractStorageKey(row.s3_path);
  if (storageKey) {
    const { error: storageErr } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([storageKey]);
    if (storageErr) {
      console.error(
        `⚠️ Storage delete failed for ${storageKey}: ${storageErr.message}`,
      );
    }
  }

  const { error: dbErr } = await supabase
    .from("SSP_Document")
    .delete()
    .eq("document_id", String(req.documentId).trim())
    .eq("society", societyId)
    .eq("society_user", memberId);

  if (dbErr) return fail(dbErr.message, 500, "DATABASE_ERROR");

  return respond({
    documentId: req.documentId,
    message: "Document deleted successfully.",
  });
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
  }

  const startTime = Date.now();

  try {
    const body = (await req.json().catch(() => null)) as
      | CrudResidentDocumentRequest
      | null;
    if (!body) return fail("Request body is required.", 400, "BAD_REQUEST");

    const { societyRegistrationNumber, residentId, action } = body;

    if (!societyRegistrationNumber || !residentId || !action) {
      return fail(
        "societyRegistrationNumber, residentId, and action are required.",
        400,
        "MISSING_PARAMETERS",
      );
    }

    const actionUpper = String(action).toUpperCase() as Action;
    if (!VALID_ACTIONS.includes(actionUpper)) {
      return fail(
        `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
        400,
        "INVALID_ACTION",
      );
    }

    const auth = await authorizeResident(
      String(societyRegistrationNumber),
      String(residentId),
    );
    if (!auth.ok) return auth.response;

    const societyId = auth.societyId;
    const memberId = auth.memberId;
    const cleanRegNo = String(societyRegistrationNumber).trim();

    let response: Response;

    switch (actionUpper) {
      case "VIEW":
        response = await handleView(body, societyId, memberId);
        break;
      case "UPLOAD":
        response = await handleUpload(body, societyId, memberId, cleanRegNo);
        break;
      case "DOWNLOAD":
        response = await handleDownload(body, societyId, memberId);
        break;
      case "DELETE":
        response = await handleDelete(body, societyId, memberId);
        break;
      default:
        return fail("Unhandled action.", 400, "INVALID_ACTION");
    }

    console.log(
      `✅ crud-resident-document: action=${actionUpper}, society=${societyId}, ` +
        `${Date.now() - startTime}ms`,
    );

    return response;
  } catch (err: unknown) {
    console.error("❌ FULL ERROR:", err);

    let msg = "Unknown error";
    if (err instanceof Error) msg = err.message;
    else if (typeof err === "string") msg = err;
    else if (err && typeof err === "object" && "message" in err) {
      msg = String((err as { message: unknown }).message);
    } else if (err && typeof err === "object") {
      try {
        msg = JSON.stringify(err);
      } catch {
        msg = "Unserializable error";
      }
    }

    console.error("❌ crud-resident-document error:", msg);
    return fail(msg, 500, "SERVER_ERROR");
  }
});
