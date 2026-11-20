// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'POST, OPTIONS'
// };
// serve(async (req)=>{
//   // Handle CORS preflight requests
//   if (req.method === 'OPTIONS') return new Response('ok', {
//     headers: corsHeaders
//   });
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     const bodyText = await req.text();
//     if (!bodyText || bodyText.trim() === '') {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         error: "Request body is empty."
//       }), {
//         status: 400,
//         headers: corsHeaders
//       });
//     }
//     const requestObj = JSON.parse(bodyText);
//     const { registrationNumber, adminPhone, action, id, payload } = requestObj;
//     // 1. Core Parameter Validation Guard
//     if (!registrationNumber || !adminPhone || !action) {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         error: "registrationNumber, adminPhone, and action are mandatory fields."
//       }), {
//         status: 400,
//         headers: corsHeaders
//       });
//     }
//     const cleanRegNum = String(registrationNumber).trim();
//     const cleanPhone = String(adminPhone).replace(/\D/g, '');
//     // 2. Resolve Parent Society Identity
//     const { data: society, error: socErr } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', cleanRegNum).maybeSingle();
//     if (socErr) return new Response(JSON.stringify({
//       status: "FAILURE",
//       error: socErr.message
//     }), {
//       status: 500,
//       headers: corsHeaders
//     });
//     if (!society) return new Response(JSON.stringify({
//       status: "FAILURE",
//       error: "Society context record missing."
//     }), {
//       status: 404,
//       headers: corsHeaders
//     });
//     // 3. Security Check: Verify requesting user is a verified Admin
//     const { data: adminCheck, error: adminErr } = await supabase.from('SSP_Society_User').select('user_id, role, SSP_Contact!contact (phone)').eq('society', society.society_id);
//     if (adminErr) return new Response(JSON.stringify({
//       status: "FAILURE",
//       error: adminErr.message
//     }), {
//       status: 500,
//       headers: corsHeaders
//     });
//     const parsePostgresArray = (roleField)=>{
//       if (!roleField) return [];
//       if (Array.isArray(roleField)) return roleField.map((r)=>String(r).trim().toLowerCase());
//       const str = String(roleField).trim();
//       if (str.startsWith('{') && str.endsWith('}')) {
//         return str.slice(1, -1).split(',').map((r)=>r.replace(/"/g, '').trim().toLowerCase());
//       }
//       return [
//         str.toLowerCase()
//       ];
//     };
//     const isAuthorizedAdmin = (adminCheck || []).some((user)=>{
//       const roles = parsePostgresArray(user.role);
//       const dbPhoneDigits = user.SSP_Contact?.phone ? String(user.SSP_Contact.phone).replace(/\D/g, '') : '';
//       return roles.includes('admin') && dbPhoneDigits !== '' && (cleanPhone.includes(dbPhoneDigits) || dbPhoneDigits.includes(cleanPhone));
//     });
//     if (!isAuthorizedAdmin) {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         error: "Access Denied: Requires active Admin verification privileges."
//       }), {
//         status: 403,
//         headers: corsHeaders
//       });
//     }
//     // 4. CRUD & Calculation Engine Router
//     const act = String(action).toUpperCase();
//     let databaseResult;
//     if (act === 'CREATE') {
//       // Maps directly to your updated table layout column naming format
//       databaseResult = await supabase.from('SSP_Flat_Type').insert({
//         ...payload,
//         society: society.society_id
//       }).select();
//     } else if (act === 'UPDATE') {
//       if (!id) throw new Error("The record primary uuid 'id' is required for UPDATE actions.");
//       databaseResult = await supabase.from('SSP_Flat_Type').update(payload).eq('flat_type_id', id).eq('society', society.society_id).select();
//     } else if (act === 'DELETE') {
//       if (!id) throw new Error("The record primary uuid 'id' is required for DELETE actions.");
//       databaseResult = await supabase.from('SSP_Flat_Type').delete().eq('flat_type_id', id).eq('society', society.society_id);
//     } else if (act === 'CALCULATE') {
//       if (!id) throw new Error("The 'id' (flat_type_id) is required to parse calculation parameters.");
//       // Pull charge rules dynamically from the table matching the validated society constraint
//       const { data: ruleset, error: ruleErr } = await supabase.from('SSP_Flat_Type').select('flat_type, maintenance_charges').eq('flat_type_id', id).eq('society', society.society_id).single();
//       if (ruleErr || !ruleset) throw new Error(`Could not track maintenance rules for this flat configuration ID.`);
//       const monthlyRate = Number(ruleset.maintenance_charges || 0);
//       const monthsMultiplier = payload?.numberOfMonths ? Number(payload.numberOfMonths) : 1;
//       const lateFeePenalty = payload?.penaltyCharges ? Number(payload.penaltyCharges) : 0;
//       const computedTotalPayable = monthlyRate * monthsMultiplier + lateFeePenalty;
//       return new Response(JSON.stringify({
//         status: "SUCCESS",
//         calculationSummary: {
//           flatType: ruleset.flat_type,
//           baseMonthlyRate: monthlyRate,
//           billingPeriodMonths: monthsMultiplier,
//           appliedSurchargePenalty: lateFeePenalty,
//           grandTotalPayable: computedTotalPayable
//         }
//       }), {
//         status: 200,
//         headers: {
//           ...corsHeaders,
//           'Content-Type': 'application/json'
//         }
//       });
//     } else {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         error: `Unsupported pipeline action rule: ${act}`
//       }), {
//         status: 400,
//         headers: corsHeaders
//       });
//     }
//     if (databaseResult?.error) throw databaseResult.error;
//     return new Response(JSON.stringify({
//       status: "SUCCESS",
//       data: databaseResult?.data || null
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (error) {
//     return new Response(JSON.stringify({
//       status: "FAILURE",
//       error: error.message
//     }), {
//       status: 400,
//       headers: corsHeaders
//     });
//   }
// });

// deno-lint-ignore-file no-import-prefix
// ============================================
// crud-flat-type - Society Flat Type CRUD
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

type Action = "VIEW" | "CREATE" | "UPDATE" | "DELETE";

interface CrudFlatTypeRequest {
  societyRegistrationNumber: string;
  adminId: string;
  action: Action;

  search?: string;
  filters?: {
    flatType?: string | string[];
  };
  sort?: {
    field?: string;
    order?: "asc" | "desc";
  };
  page?: number;
  limit?: number;

  flatTypeId?: string;
  payload?: {
    flatType?: string;
    /** undefined = skip, null = clear, "" = clear, number/string = set */
    maintenanceCharges?: number | string | null;
  };
}

interface FlatTypeRow {
  flat_type_id: string;
  created_at: string;
  flat_type: string | null;
  maintenance_charges: number | string | null;
  society: string | null;
}

interface FormattedFlatType {
  flatTypeId: string;
  flatType: string | null;
  maintenanceCharges: number;
  createdAt: string;
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;
const MAX_FLAT_TYPE_LENGTH = 100;

const VALID_ACTIONS = ["VIEW", "CREATE", "UPDATE", "DELETE"] as const;
const VALID_SORT_FIELDS = [
  "flat_type",
  "created_at",
  "maintenance_charges",
] as const;

const ADMIN_ROLE = "admin";
const FLAT_TYPE_SELECT_FIELDS =
  "flat_type_id,created_at,flat_type,maintenance_charges,society";

const PICKLIST_TABLE = "SSP_Flat_Type";
const PICKLIST_FIELD = "flat_type";

// Postgres error codes
const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION = "23503";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPERS
// ============================================

function respond(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ status: "SUCCESS", data }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function fail(message: string, status = 400, code = "ERROR"): Response {
  return new Response(
    JSON.stringify({
      status: "FAILURE",
      data: null,
      errorResponse: { errorCode: code, message },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function normalizeArray(input: string | string[] | undefined): string[] | null {
  if (!input) return null;
  if (Array.isArray(input)) {
    const cleaned = input.filter((x) => x && String(x).trim() !== "");
    return cleaned.length > 0 ? cleaned : null;
  }
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  return [trimmed];
}

/**
 * Classify `maintenanceCharges` input:
 *   - skip  → caller did not provide the field
 *   - set   → set to value (may be null to clear)
 *   - error → invalid input
 */
type MaintenanceParse =
  | { kind: "skip" }
  | { kind: "set"; value: number | null }
  | { kind: "error" };

function parseMaintenance(raw: unknown): MaintenanceParse {
  if (raw === undefined) return { kind: "skip" };
  if (raw === null) return { kind: "set", value: null };
  if (typeof raw === "string" && raw.trim() === "") {
    return { kind: "set", value: null }; // empty form input → clear
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { kind: "error" };
  return { kind: "set", value: n };
}

function formatFlatType(row: FlatTypeRow): FormattedFlatType {
  return {
    flatTypeId: row.flat_type_id,
    flatType: row.flat_type,
    maintenanceCharges: Number(row.maintenance_charges ?? 0),
    createdAt: row.created_at,
  };
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(value);
}

/**
 * Escape Postgres LIKE/ILIKE metacharacters so a literal value is matched
 * literally. Backslash is Postgres's default LIKE escape character.
 * Allows `_` as a legitimate character in flat type names (e.g. `6_bhk`).
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/**
 * Robust admin-role check — handles text[], scalar text, and Postgres
 * array-literal strings like `{admin,resident}` or `["admin"]`.
 * Case-insensitive.
 */
function hasAdminRole(role: unknown): boolean {
  if (role === null || role === undefined) return false;

  if (Array.isArray(role)) {
    return role.some(
      (r) => String(r).trim().toLowerCase() === ADMIN_ROLE.toLowerCase(),
    );
  }

  const s = String(role).trim();
  if (s === "") return false;

  if (s.startsWith("{") || s.startsWith("[")) {
    const inner = s.replace(/^[\[{]/, "").replace(/[\]}]$/, "");
    return inner
      .split(",")
      .map((r) => r.replace(/["']/g, "").trim().toLowerCase())
      .includes(ADMIN_ROLE.toLowerCase());
  }

  return s.toLowerCase() === ADMIN_ROLE.toLowerCase();
}

async function getValidFlatTypes(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("SSP_Picklist_Config")
    .select("value")
    .eq("table_name", PICKLIST_TABLE)
    .eq("field_name", PICKLIST_FIELD)
    .eq("language", "en")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load flat_type picklist: ${error.message}`);
  }

  const set = new Set<string>();
  for (const row of data ?? []) {
    const v = (row as { value?: string }).value;
    if (typeof v === "string" && v.trim() !== "") {
      set.add(v);
    }
  }
  return set;
}

/**
 * Validate a flat_type value.
 * - Fail-open (log warning) if picklist is empty — misconfiguration should
 *   not block users from creating rows; admins are warned in logs.
 * - Fail-closed if the value is not in a non-empty picklist.
 * - Rejects only `%` and `\` (ILIKE wildcards that are genuinely unusual in
 *   flat type names). `_` IS allowed — common in real names like `6_bhk`.
 */
function validateFlatType(
  value: string,
  validSet: Set<string>,
): string | null {
  const clean = String(value).trim();
  if (clean === "") return "flatType cannot be empty.";
  if (clean.length > MAX_FLAT_TYPE_LENGTH) {
    return `flatType must be ${MAX_FLAT_TYPE_LENGTH} characters or fewer.`;
  }
  // `%` is an ILIKE wildcard and `\` is its escape — unusual in real names,
  // reject to keep queries unambiguous. `_` is allowed and is escaped at the
  // query layer (see escapeLikePattern).
  if (/[%\\]/.test(clean)) {
    return "flatType cannot contain % or \\ characters.";
  }

  if (validSet.size === 0) {
    console.warn(
      "⚠️ flat_type picklist is empty — skipping validation (fail-open). " +
        "Populate SSP_Picklist_Config to enforce allowed values.",
    );
    return null;
  }

  if (!validSet.has(clean)) {
    const sorted = Array.from(validSet).sort();
    return `flatType "${clean}" is not allowed. Valid values: ${
      sorted.join(", ")
    }.`;
  }
  return null;
}

// ============================================
// AUTH
// ============================================

async function authorizeAdmin(
  societyRegistrationNumber: string,
  adminId: string,
): Promise<
  { ok: true; societyId: string } | { ok: false; response: Response }
> {
  const cleanRegNum = String(societyRegistrationNumber).trim();
  const cleanAdminId = String(adminId).trim();

  if (!cleanRegNum) {
    return {
      ok: false,
      response: fail(
        "societyRegistrationNumber is required.",
        400,
        "MISSING_PARAMETERS",
      ),
    };
  }

  if (!isValidUUID(cleanAdminId)) {
    return {
      ok: false,
      response: fail(
        "adminId must be a valid UUID.",
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

  const { data: admin, error: adminErr } = await supabase
    .from("SSP_Society_User")
    .select("user_id, role")
    .eq("user_id", cleanAdminId)
    .eq("society", society.society_id)
    .maybeSingle();

  if (adminErr) {
    return {
      ok: false,
      response: fail(adminErr.message, 500, "DATABASE_ERROR"),
    };
  }

  const role = (admin as { role?: unknown } | null)?.role;
  if (!admin || !hasAdminRole(role)) {
    console.warn(
      `⚠️ Unauthorized admin access — user=${cleanAdminId}, ` +
        `society=${society.society_id}, role=${JSON.stringify(role)}`,
    );
    return {
      ok: false,
      response: fail("Unauthorized Admin Access.", 403, "UNAUTHORIZED"),
    };
  }

  return { ok: true, societyId: society.society_id };
}

// ============================================
// ACTION HANDLERS
// ============================================

async function handleView(
  req: CrudFlatTypeRequest,
  societyId: string,
): Promise<Response> {
  const page = Math.max(1, Number(req.page) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  let query = supabase
    .from("SSP_Flat_Type")
    .select(FLAT_TYPE_SELECT_FIELDS, { count: "exact" })
    .eq("society", societyId);

  if (req.search && req.search.trim() !== "") {
    const term = req.search.trim();
    if (term.length > MAX_SEARCH_LENGTH) {
      return fail(
        `search is too long (max ${MAX_SEARCH_LENGTH} chars).`,
        400,
        "INVALID_PARAMETERS",
      );
    }
    // Escape metacharacters so a search for `6_bhk` doesn't match `6xbhk`.
    query = query.ilike("flat_type", `%${escapeLikePattern(term)}%`);
  }

  if (req.filters) {
    const flatTypes = normalizeArray(req.filters.flatType);
    if (flatTypes && flatTypes.length > 0) {
      query = query.in("flat_type", flatTypes);
    }
  }

  const requestedSortField = req.sort?.field || "created_at";
  const sortField = (VALID_SORT_FIELDS as readonly string[]).includes(
      requestedSortField,
    )
    ? requestedSortField
    : "created_at";
  const ascending = req.sort?.order === "asc";
  query = query.order(sortField, { ascending });

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  const flatTypes = ((data || []) as FlatTypeRow[]).map(formatFlatType);
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return respond({
    flatTypes,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      flatType: req.filters?.flatType ?? null,
    },
    search: req.search ?? null,
    sort: { field: sortField, order: ascending ? "asc" : "desc" },
  });
}

async function handleCreate(
  req: CrudFlatTypeRequest,
  societyId: string,
): Promise<Response> {
  const p = req.payload;
  if (!p) {
    return fail("payload is required.", 400, "MISSING_PARAMETERS");
  }

  if (!p.flatType || String(p.flatType).trim() === "") {
    return fail("payload.flatType is required.", 400, "MISSING_PARAMETERS");
  }

  // ── Picklist validation (fail-closed on load error) ──
  let validFlatTypes: Set<string>;
  try {
    validFlatTypes = await getValidFlatTypes();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Picklist load failed.";
    console.error("❌", msg);
    return fail(
      "Configuration error: unable to validate flat type. Please contact support.",
      500,
      "CONFIGURATION_ERROR",
    );
  }

  const cleanFlatType = String(p.flatType).trim();
  const flatTypeError = validateFlatType(cleanFlatType, validFlatTypes);
  if (flatTypeError) {
    return fail(flatTypeError, 400, "INVALID_PARAMETERS");
  }

  // ── Maintenance ──
  const maintenance = parseMaintenance(p.maintenanceCharges);
  if (maintenance.kind === "error") {
    return fail(
      "maintenanceCharges must be a non-negative number or empty.",
      400,
      "INVALID_PARAMETERS",
    );
  }

  // ── Duplicate check (case-insensitive, literal) ──
  // Escape LIKE metacharacters so `6_bhk` doesn't match `6xbhk`.
  const { data: existing, error: dupErr } = await supabase
    .from("SSP_Flat_Type")
    .select("flat_type_id")
    .eq("society", societyId)
    .ilike("flat_type", escapeLikePattern(cleanFlatType))
    .maybeSingle();

  if (dupErr) {
    return fail(dupErr.message, 500, "DATABASE_ERROR");
  }
  if (existing) {
    return fail(
      "A flat type with this name already exists.",
      409,
      "ALREADY_EXISTS",
    );
  }

  // ── Insert ──
  const insertPayload: Record<string, unknown> = {
    society: societyId,
    flat_type: cleanFlatType,
  };
  if (maintenance.kind === "set" && maintenance.value !== null) {
    insertPayload.maintenance_charges = maintenance.value;
  }

  const { data, error } = await supabase
    .from("SSP_Flat_Type")
    .insert(insertPayload)
    .select(FLAT_TYPE_SELECT_FIELDS)
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return fail(
        "A flat type with this name already exists.",
        409,
        "ALREADY_EXISTS",
      );
    }
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  return respond(
    {
      ...formatFlatType(data as FlatTypeRow),
      message: "Flat type created successfully.",
    },
    201,
  );
}

async function handleUpdate(
  req: CrudFlatTypeRequest,
  societyId: string,
): Promise<Response> {
  const targetId = String(req.flatTypeId ?? "").trim();
  if (!targetId) {
    return fail(
      "flatTypeId is required for UPDATE.",
      400,
      "MISSING_PARAMETERS",
    );
  }
  if (!isValidUUID(targetId)) {
    return fail("flatTypeId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }
  if (!req.payload || Object.keys(req.payload).length === 0) {
    return fail("payload cannot be empty.", 400, "MISSING_PARAMETERS");
  }

  const updatePayload: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  // ── flatType ──
  if (req.payload.flatType !== undefined) {
    let validFlatTypes: Set<string>;
    try {
      validFlatTypes = await getValidFlatTypes();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Picklist load failed.";
      console.error("❌", msg);
      return fail(
        "Configuration error: unable to validate flat type. Please contact support.",
        500,
        "CONFIGURATION_ERROR",
      );
    }

    const cleanFlatType = String(req.payload.flatType).trim();
    const flatTypeError = validateFlatType(cleanFlatType, validFlatTypes);
    if (flatTypeError) {
      return fail(flatTypeError, 400, "INVALID_PARAMETERS");
    }

    // Duplicate check — exclude self, case-insensitive, literal
    const { data: collision, error: dupErr } = await supabase
      .from("SSP_Flat_Type")
      .select("flat_type_id")
      .eq("society", societyId)
      .ilike("flat_type", escapeLikePattern(cleanFlatType))
      .neq("flat_type_id", targetId)
      .maybeSingle();

    if (dupErr) return fail(dupErr.message, 500, "DATABASE_ERROR");
    if (collision) {
      return fail(
        "A flat type with this name already exists.",
        409,
        "ALREADY_EXISTS",
      );
    }

    updatePayload.flat_type = cleanFlatType;
    updatedFields.push("flatType");
  }

  // ── maintenanceCharges ──
  const maintenance = parseMaintenance(req.payload.maintenanceCharges);
  if (maintenance.kind === "error") {
    return fail(
      "maintenanceCharges must be a non-negative number or empty.",
      400,
      "INVALID_PARAMETERS",
    );
  }
  if (maintenance.kind === "set") {
    updatePayload.maintenance_charges = maintenance.value;
    updatedFields.push("maintenanceCharges");
  }

  if (Object.keys(updatePayload).length === 0) {
    return fail("No valid fields to update.", 400, "MISSING_PARAMETERS");
  }

  const { data, error } = await supabase
    .from("SSP_Flat_Type")
    .update(updatePayload as never)
    .eq("flat_type_id", targetId)
    .eq("society", societyId)
    .select(FLAT_TYPE_SELECT_FIELDS)
    .maybeSingle();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return fail(
        "A flat type with this name already exists.",
        409,
        "ALREADY_EXISTS",
      );
    }
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!data) {
    return fail("Flat type not found in this society.", 404, "NOT_FOUND");
  }

  return respond({
    ...formatFlatType(data as FlatTypeRow),
    updatedFields,
    message: "Flat type updated successfully.",
  });
}

async function handleDelete(
  req: CrudFlatTypeRequest,
  societyId: string,
): Promise<Response> {
  const targetId = String(req.flatTypeId ?? "").trim();
  if (!targetId) {
    return fail(
      "flatTypeId is required for DELETE.",
      400,
      "MISSING_PARAMETERS",
    );
  }
  if (!isValidUUID(targetId)) {
    return fail("flatTypeId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }

  // Best-effort pre-check: friendly IN_USE message before attempting delete.
  // If the pre-check query fails (unknown table/column or RLS), fall through
  // to the actual delete and rely on the FK-violation catch below.
  try {
    const { count: usageCount, error: preErr } = await supabase
      .from("SSP_Flat")
      .select("*", { count: "exact", head: true })
      .eq("society", societyId)
      .eq("flat_type_id", targetId);

    if (!preErr && (usageCount ?? 0) > 0) {
      return fail(
        `Cannot delete: ${usageCount} flat(s) currently use this flat type. ` +
          `Reassign or remove them first.`,
        409,
        "IN_USE",
      );
    }
  } catch {
    // ignore — schema differs; FK catch below will handle it
  }

  const { error, count } = await supabase
    .from("SSP_Flat_Type")
    .delete({ count: "exact" })
    .eq("flat_type_id", targetId)
    .eq("society", societyId);

  if (error) {
    if (error.code === PG_FK_VIOLATION) {
      return fail(
        "Cannot delete: this flat type is in use by existing flats. " +
          "Reassign or remove them first.",
        409,
        "IN_USE",
      );
    }
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!count || count === 0) {
    return fail("Flat type not found in this society.", 404, "NOT_FOUND");
  }

  return respond({
    flatTypeId: targetId,
    message: "Flat type deleted successfully.",
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

  try {
    const body = (await req.json().catch(() => null)) as
      | CrudFlatTypeRequest
      | null;
    if (!body) {
      return fail("Request body is required.", 400, "BAD_REQUEST");
    }

    const { societyRegistrationNumber, adminId, action } = body;

    if (!societyRegistrationNumber || !adminId || !action) {
      return fail(
        "societyRegistrationNumber, adminId, and action are required.",
        400,
        "MISSING_PARAMETERS",
      );
    }

    const actionUpper = String(action).toUpperCase();
    if (!(VALID_ACTIONS as readonly string[]).includes(actionUpper)) {
      return fail(
        `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
        400,
        "INVALID_ACTION",
      );
    }

    const auth = await authorizeAdmin(societyRegistrationNumber, adminId);
    if (!auth.ok) return auth.response;

    switch (actionUpper) {
      case "VIEW":
        return await handleView(body, auth.societyId);
      case "CREATE":
        return await handleCreate(body, auth.societyId);
      case "UPDATE":
        return await handleUpdate(body, auth.societyId);
      case "DELETE":
        return await handleDelete(body, auth.societyId);
      default:
        return fail("Unhandled action.", 400, "INVALID_ACTION");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ crud-flat-type error:", msg);
    return fail(msg, 500, "SERVER_ERROR");
  }
});