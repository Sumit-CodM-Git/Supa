// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// search-resident - Security gate lookup with pagination, filters & sorting
// ============================================
// POST /functions/v1/search-resident
// Auth: Bearer <custom JWT from verify-otp>
//
// Purpose: Security guard types a flat number and gets the primary
//          residents of every matching flat in their society.
//          Multiple towers/blocks can share a flat number, so all
//          matches are returned with tower + block for disambiguation.
//
//          Each resident is enriched with `visitorOtpAvailable` and
//          `residentPlanCode` so the gatekeeper UI can decide whether
//          to show the Visitor OTP option.
//
// Roles allowed: security, admin
// Only active, non-deleted primary members are ever returned.
// ============================================

import { AuthContext, requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import {
  getPaginationParams,
  parseRequestBody,
  sanitizeString,
} from "../_shared/utils.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// CONFIG
// ============================================

const ALLOWED_ROLES = new Set(["security", "admin"]);
const MAX_PAGE_SIZE = 100;

const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// ============================================
// TYPES
// ============================================

interface SearchResidentRequest {
  societyRegistrationNumber: string;
  flatNumber: string;
  sortBy?: "towerName" | "blockName" | "name" | "createdAt";
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

interface ResidentRow {
  user_id: string;
  unit_flat_number: string | null;
  user_ownership_type: string | null;
  relationship: string | null;
  status: boolean | null;
  created_at: string | null;
  block: string | null;
  tower: string | null;
  SSP_Contact:
    | { name: string | null; phone: string | null; email: string | null }
    | { name: string | null; phone: string | null; email: string | null }[]
    | null;
}

// ============================================
// HELPERS
// ============================================

function buildErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return new Response(
    JSON.stringify({
      residents: [],
      errorResponse: {
        errorCode: code,
        message,
        timestamp: new Date().toISOString(),
      },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function pickContact(row: ResidentRow): {
  name: string;
  phone: string;
  email: string;
} {
  const raw = row.SSP_Contact;
  const contact = Array.isArray(raw) ? raw[0] : raw;
  return {
    name: contact?.name ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
  };
}

function hasAllowedRole(roles: string[]): boolean {
  return roles.some((r) => ALLOWED_ROLES.has(String(r).trim().toLowerCase()));
}

// ============================================
// ENTITLEMENT LOOKUP — bulk check VISITOR_OTP per flat
// ============================================

interface FlatOtpInfo {
  hasOtp: boolean;
  planCode: string;
}

async function bulkCheckVisitorOtp(
  society: string,
  flats: Array<{
    tower: string | null;
    block: string | null;
    flat_number: string;
  }>,
): Promise<Map<string, FlatOtpInfo>> {
  const result = new Map<string, FlatOtpInfo>();

  if (flats.length === 0) return result;

  // Build unique flat locator keys
  const uniqueKeys = new Set<string>();
  for (const f of flats) {
    const key = makeFlatKey(society, f.tower, f.block, f.flat_number);
    uniqueKeys.add(key);
  }

  // Fetch active subscriptions for this society
  // (filtering by flat is done client-side to keep the query simple)
  const { data: subs, error: subErr } = await supabaseAdmin
    .from("SSP_Subscription")
    .select(`
      society,
      tower,
      block,
      flat_number,
      status,
      end_date,
      plan:SSP_Subscription_Plan!plan_id ( plan_code )
    `)
    .eq("society", society)
    .in("status", ["active", "trial"]);

  if (subErr) {
    console.error(
      `[search-resident] subscription lookup failed: ${subErr.message}`,
    );
    // Fail-closed: no OTP for anyone
    for (const key of uniqueKeys) {
      result.set(key, { hasOtp: false, planCode: "FREE" });
    }
    return result;
  }

  // Build flatKey → plan_code
  const flatToPlan = new Map<string, string>();
  const now = new Date();

  for (const s of (subs ?? []) as any[]) {
    const endDate = s.end_date ? new Date(s.end_date) : null;
    const isActive = s.status === "active" || s.status === "trial";
    const notExpired = !endDate || endDate > now;
    if (!isActive || !notExpired) continue;

    const key = makeFlatKey(s.society, s.tower, s.block, s.flat_number);
    const planRel = Array.isArray(s.plan) ? s.plan[0] : s.plan;
    const planCode = planRel?.plan_code ?? "FREE";

    // Prefer non-FREE if there's any ambiguity
    if (!flatToPlan.has(key) || planCode !== "FREE") {
      flatToPlan.set(key, planCode);
    }
  }

  // Determine which plans include VISITOR_OTP
  const planCodes = Array.from(new Set(flatToPlan.values()));
  const planToHasOtp = new Map<string, boolean>();

  if (planCodes.length > 0) {
    const { data: planFeatures, error: pfErr } = await supabaseAdmin
      .from("SSP_Plan_Feature")
      .select(`
        enabled,
        plan:SSP_Subscription_Plan!plan_id ( plan_code ),
        feature:SSP_Feature!feature_id ( feature_code )
      `)
      .eq("enabled", true)
      .in("plan.plan_code", planCodes)
      .eq("feature.feature_code", "VISITOR_OTP");

    if (!pfErr && planFeatures) {
      for (const pf of planFeatures as any[]) {
        const planRel = Array.isArray(pf.plan) ? pf.plan[0] : pf.plan;
        const pc = planRel?.plan_code;
        if (pc) planToHasOtp.set(pc, true);
      }
    }

    // Default any plan not found to false
    for (const pc of planCodes) {
      if (!planToHasOtp.has(pc)) planToHasOtp.set(pc, false);
    }
  }

  // Populate result for every requested key
  for (const key of uniqueKeys) {
    const planCode = flatToPlan.get(key) ?? "FREE";
    const hasOtp = planToHasOtp.get(planCode) ?? false;
    result.set(key, { hasOtp, planCode });
  }

  return result;
}

function makeFlatKey(
  society: string,
  tower: string | null,
  block: string | null,
  flatNumber: string,
): string {
  return `${society}|${tower ?? "∅"}|${block ?? "∅"}|${
    String(flatNumber ?? "").trim().toUpperCase()
  }`;
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(
  requireAuth(async (req: Request, ctx: AuthContext) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const t0 = Date.now();

    try {
      // ----------------------------------------
      // 1. Parse + validate request
      // ----------------------------------------
      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await parseRequestBody<SearchResidentRequest>(req);
      if (!body) {
        return buildErrorResponse(
          "BAD_REQUEST",
          "Request body is required.",
          400,
        );
      }

      const {
        societyRegistrationNumber,
        flatNumber,
        sortBy,
        sortDir,
        page,
        limit,
      } = body;

      if (
        !societyRegistrationNumber || societyRegistrationNumber.trim() === ""
      ) {
        return buildErrorResponse(
          "BAD_REQUEST",
          "societyRegistrationNumber is mandatory.",
          400,
        );
      }

      if (!flatNumber || String(flatNumber).trim() === "") {
        return buildErrorResponse(
          "BAD_REQUEST",
          "flatNumber is mandatory.",
          400,
        );
      }

      const cleanRegNum = sanitizeString(societyRegistrationNumber);
      const cleanFlat = sanitizeString(String(flatNumber));

      // Pagination (same helper used by get-notices)
      const pagination = getPaginationParams(
        new URL(
          `http://localhost?page=${page || 1}&limit=${
            Math.min(limit || 50, MAX_PAGE_SIZE)
          }`,
        ),
      );

      // ----------------------------------------
      // 2. Load caller + verify role + society
      // ----------------------------------------
      const callerUserId = ctx.user.id;
      if (!callerUserId) {
        return buildErrorResponse(
          "UNAUTHORIZED",
          "Caller identity missing.",
          401,
        );
      }

      const { data: caller, error: callerErr } = await supabaseAdmin
        .from("SSP_Society_User")
        .select(`
          user_id,
          society,
          role,
          deleted_at,
          SSP_Society:SSP_Society!society (
            society_id,
            registration_number
          )
        `)
        .eq("user_id", callerUserId)
        .maybeSingle();

      if (callerErr) {
        return buildErrorResponse(
          "SERVER_ERROR",
          `Caller lookup failed: ${callerErr.message}`,
          500,
        );
      }

      if (!caller) {
        return buildErrorResponse("NOT_FOUND", "Caller record not found.", 404);
      }

      const c = caller as any;

      if (c.deleted_at) {
        return buildErrorResponse(
          "UNAUTHORIZED",
          "Caller account is deactivated.",
          401,
        );
      }

      if (!c.society) {
        return buildErrorResponse(
          "NOT_FOUND",
          "Caller has no society assigned.",
          404,
        );
      }

      // Society verification
      const callerSociety = Array.isArray(c.SSP_Society)
        ? c.SSP_Society[0]
        : c.SSP_Society;

      if (!callerSociety) {
        return buildErrorResponse(
          "NOT_FOUND",
          "Caller's society not found.",
          404,
        );
      }

      if (
        String(callerSociety.registration_number ?? "").trim() !== cleanRegNum
      ) {
        return buildErrorResponse(
          "FORBIDDEN",
          "You can only look up residents in your own society.",
          403,
        );
      }

      // Role check
      const roles = Array.isArray(c.role) ? c.role : (c.role ? [c.role] : []);
      if (!hasAllowedRole(roles)) {
        return buildErrorResponse(
          "FORBIDDEN",
          "Only security personnel can access this endpoint.",
          403,
        );
      }

      // ----------------------------------------
      // 3. Build the WHERE-clause condition set ONCE
      //    (mirrors get-notices pattern)
      // ----------------------------------------
      // Status is always "active" — the guard only needs reachable residents.
      const cleanStatus = true;

      const sortKey = (sortBy || "towerName").trim();
      const sortAsc = (sortDir || "asc").toLowerCase() !== "desc";

      const offset = pagination.offset;
      const rowLimit = pagination.limit;

      // ----------------------------------------
      // 4. Run count + data query IN PARALLEL
      // ----------------------------------------
      let dataQuery = supabaseAdmin
        .from("SSP_Society_User")
        .select(`
          user_id,
          unit_flat_number,
          user_ownership_type,
          relationship,
          status,
          created_at,
          block,
          tower,
          SSP_Contact:SSP_Contact!contact (
            name,
            phone,
            email
          )
        `)
        .eq("society", c.society)
        .eq("unit_flat_number", cleanFlat)
        .ilike("user_ownership_type", "primary")
        .is("deleted_at", null)
        .eq("status", cleanStatus);

      let countQuery = supabaseAdmin
        .from("SSP_Society_User")
        .select("*", { count: "exact", head: true })
        .eq("society", c.society)
        .eq("unit_flat_number", cleanFlat)
        .ilike("user_ownership_type", "primary")
        .is("deleted_at", null)
        .eq("status", cleanStatus);

      // Sorting
      if (sortKey === "name") {
        dataQuery = dataQuery.order("name", {
          ascending: sortAsc,
          foreignTable: "SSP_Contact",
        });
      } else if (sortKey === "createdAt") {
        dataQuery = dataQuery.order("created_at", { ascending: sortAsc });
      } else if (sortKey === "blockName") {
        dataQuery = dataQuery.order("block", {
          ascending: sortAsc,
          nullsFirst: false,
        });
      } else {
        // default: towerName
        dataQuery = dataQuery.order("tower", {
          ascending: sortAsc,
          nullsFirst: false,
        });
      }
      // Stable secondary sort
      dataQuery = dataQuery.order("created_at", { ascending: true });

      // Pagination
      dataQuery = dataQuery.range(offset, offset + rowLimit - 1);

      // Fire both queries in parallel
      const [dataResult, countResult] = await Promise.all([
        dataQuery,
        countQuery,
      ]);

      if (dataResult.error) {
        return buildErrorResponse(
          "SERVER_ERROR",
          `Database error: ${dataResult.error.message}`,
          500,
        );
      }

      const total = countResult.error ? 0 : countResult.count || 0;
      const rows = (dataResult.data || []) as ResidentRow[];

      // ----------------------------------------
      // 5. Resolve tower + block names in parallel
      // ----------------------------------------
      const towerIds = new Set<string>();
      const blockIds = new Set<string>();
      for (const row of rows) {
        if (row.tower) towerIds.add(row.tower);
        if (row.block) blockIds.add(row.block);
      }

      const towerMap = new Map<string, string>();
      const blockMap = new Map<string, string>();

      const [towersRes, blocksRes] = await Promise.all([
        towerIds.size > 0
          ? supabaseAdmin
            .from("SSP_Tower")
            .select("tower_id, name")
            .in("tower_id", [...towerIds])
          : Promise.resolve({ data: [], error: null }),
        blockIds.size > 0
          ? supabaseAdmin
            .from("SSP_Block")
            .select("block_id, block_name")
            .in("block_id", [...blockIds])
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!towersRes.error) {
        for (const t of (towersRes.data || []) as any[]) {
          towerMap.set(t.tower_id, t.name ?? "");
        }
      } else {
        console.warn(
          `[search-resident] tower lookup failed: ${towersRes.error.message}`,
        );
      }

      if (!blocksRes.error) {
        for (const b of (blocksRes.data || []) as any[]) {
          blockMap.set(b.block_id, b.block_name ?? "");
        }
      } else {
        console.warn(
          `[search-resident] block lookup failed: ${blocksRes.error.message}`,
        );
      }

      // ----------------------------------------
      // 6. Enrich with VISITOR_OTP availability per resident
      // ----------------------------------------
      const otpLookup = await bulkCheckVisitorOtp(
        c.society,
        rows.map((row) => ({
          tower: row.tower ?? null,
          block: row.block ?? null,
          flat_number: row.unit_flat_number ?? "",
        })),
      );

      // ----------------------------------------
      // 7. Format response
      // ----------------------------------------
      const residents = rows.map((row) => {
        const contact = pickContact(row);
        const flatKey = makeFlatKey(
          c.society,
          row.tower ?? null,
          row.block ?? null,
          row.unit_flat_number ?? "",
        );
        const otpInfo = otpLookup.get(flatKey) ?? {
          hasOtp: false,
          planCode: "FREE",
        };

        return {
          societyUserId: row.user_id ?? "",
          name: contact.name,
          phoneNumber: contact.phone,
          email: contact.email,
          flatNumber: row.unit_flat_number ?? "",
          towerId: row.tower ?? null,
          towerName: row.tower ? (towerMap.get(row.tower) ?? null) : null,
          blockId: row.block ?? null,
          blockName: row.block ? (blockMap.get(row.block) ?? null) : null,
          ownershipType: String(row.user_ownership_type ?? "").toLowerCase(),
          relationship: row.relationship ?? null,
          status: "active",
          createdAt: row.created_at ?? null,

          // ⭐ NEW — gatekeeper UI uses these to decide OTP flow
          visitorOtpAvailable: otpInfo.hasOtp,
          residentPlanCode: otpInfo.planCode,
        };
      });

      const totalPages = Math.ceil(total / pagination.limit);
      const hasMore = pagination.page < totalPages;

      console.log(
        `[search-resident] served ${residents.length}/${total} in ${
          Date.now() - t0
        }ms`,
      );

      // ----------------------------------------
      // 8. Success response
      // ----------------------------------------
      return successResponse({
        residents,
        count: residents.length,
        pagination: {
          total,
          page: pagination.page,
          limit: pagination.limit,
          totalPages,
          hasMore,
        },
        filters: {
          flatNumber: cleanFlat,
          societyRegistrationNumber: cleanRegNum,
          status: "active",
          sortBy: sortKey,
          sortDir: sortAsc ? "asc" : "desc",
        },
      });
    } catch (error) {
      const err = error as Error;
      console.error(`[search-resident] unhandled: ${err.message}`);
      return buildErrorResponse(
        "SERVER_ERROR",
        err.message || "Failed to search residents",
        500,
      );
    }
  }),
);
