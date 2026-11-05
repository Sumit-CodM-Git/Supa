// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
//   'Access-Control-Allow-Methods': 'POST, OPTIONS'
// };
// serve(async (req)=>{
//   if (req.method === 'OPTIONS') return new Response('ok', {
//     headers: corsHeaders
//   });
//   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
//   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
//   const supabase = createClient(supabaseUrl, supabaseServiceKey);
//   try {
//     const { registrationNumber, adminPhone, action, id, payload } = await req.json();
//     if (!registrationNumber || !adminPhone || !action) {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         message: "Missing required auth or action parameters."
//       }), {
//         status: 400,
//         headers: corsHeaders
//       });
//     }
//     // 1. Inline Auth: Resolve Society and verify Admin status
//     const cleanRegNum = String(registrationNumber).trim();
//     const cleanPhone = String(adminPhone).replace(/\D/g, '');
//     const { data: society } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', cleanRegNum).maybeSingle();
//     if (!society) {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         message: "Society not found."
//       }), {
//         status: 404,
//         headers: corsHeaders
//       });
//     }
//     const { data: admins } = await supabase.from('SSP_Society_User').select('role, SSP_Contact!contact (phone)').eq('society', society.society_id);
//     const isAuthorized = (admins || []).some((user)=>{
//       let roles = [];
//       if (Array.isArray(user.role)) roles = user.role.map((r)=>String(r).toLowerCase());
//       else {
//         const s = String(user.role || '').trim();
//         roles = s.startsWith('{') ? s.slice(1, -1).split(',').map((r)=>r.replace(/"/g, '').trim().toLowerCase()) : [
//           s.toLowerCase()
//         ];
//       }
//       const dbPhone = user.SSP_Contact?.phone ? String(user.SSP_Contact.phone).replace(/\D/g, '') : '';
//       return roles.includes('admin') && dbPhone !== '' && (cleanPhone.includes(dbPhone) || dbPhone.includes(cleanPhone));
//     });
//     if (!isAuthorized) {
//       return new Response(JSON.stringify({
//         status: "FAILURE",
//         message: "Unauthorized Admin Access."
//       }), {
//         status: 403,
//         headers: corsHeaders
//       });
//     }
//     // 2. DML Operation Execution
//     let result;
//     const act = String(action).toUpperCase();
//     if (act === 'CREATE') {
//       // OPTIONAL BLOCK CHECK: If block is missing or empty string, force it to null
//       const blockId = payload?.block && String(payload.block).trim() !== '' ? payload.block : null;
//       const insertPayload = {
//         ...payload,
//         society: society.society_id,
//         block: blockId // Overwrite with our safe optional value
//       };
//       result = await supabase.from('SSP_Tower').insert(insertPayload).select();
//     } else if (act === 'UPDATE') {
//       if (!id) throw new Error("ID parameter is required for UPDATE operation.");
//       // Also allow updating the block field to null if requested
//       let updatePayload = {
//         ...payload
//       };
//       if (payload && 'block' in payload && (!payload.block || String(payload.block).trim() === '')) {
//         updatePayload.block = null;
//       }
//       result = await supabase.from('SSP_Tower').update(updatePayload).eq('tower_id', id).eq('society', society.society_id).select();
//     } else if (act === 'DELETE') {
//       if (!id) throw new Error("ID parameter is required for DELETE operation.");
//       result = await supabase.from('SSP_Tower').delete().eq('tower_id', id).eq('society', society.society_id);
//     }
//     if (result?.error) throw result.error;
//     return new Response(JSON.stringify({
//       status: "SUCCESS",
//       data: result?.data || null
//     }), {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         'Content-Type': 'application/json'
//       }
//     });
//   } catch (err) {
//     return new Response(JSON.stringify({
//       status: "FAILURE",
//       error: err.message
//     }), {
//       status: 400,
//       headers: corsHeaders
//     });
//   }
// });

// deno-lint-ignore-file no-import-prefix
// ============================================
// crud-tower - Society Tower CRUD
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface CrudTowerRequest {
  societyRegistrationNumber: string;
  adminId: string;
  action: "VIEW" | "CREATE" | "UPDATE" | "DELETE";

  // VIEW options
  search?: string;
  filters?: {
    block?: string | string[];
    active?: boolean | string;
  };
  sort?: {
    field?: string;
    order?: "asc" | "desc";
  };
  page?: number;
  limit?: number;

  // CREATE / UPDATE / DELETE
  towerId?: string;
  payload?: {
    name?: string;
    block?: string | null;
    active?: boolean;
    floors?: number;
    flatsPerFloor?: number;
  };
}

interface TowerRow {
  tower_id: string;
  created_at: string;
  active: boolean;
  society: string | null;
  block: string | null;
  name: string | null;
  floors: number | null;
  flats_per_floor: number | null;
}

interface FormattedTower {
  towerId: string;
  name: string | null;
  block: string | null;
  active: boolean;
  floors: number;
  flatsPerFloor: number;
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
const VALID_ACTIONS = ["VIEW", "CREATE", "UPDATE", "DELETE"] as const;
const VALID_SORT_FIELDS = ["name", "created_at", "active", "floors"] as const;
const ADMIN_ROLE = "admin";

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

function parseInteger(
  value: number | string | undefined | null,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function formatTower(row: TowerRow): FormattedTower {
  return {
    towerId: row.tower_id,
    name: row.name,
    block: row.block,
    active: row.active,
    floors: row.floors ?? 0,
    flatsPerFloor: row.flats_per_floor ?? 0,
    createdAt: row.created_at,
  };
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(value);
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
    .contains("role", [ADMIN_ROLE])
    .maybeSingle();

  if (adminErr) {
    return {
      ok: false,
      response: fail(adminErr.message, 500, "DATABASE_ERROR"),
    };
  }

  if (!admin) {
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
  req: CrudTowerRequest,
  societyId: string,
): Promise<Response> {
  const page = Math.max(1, Number(req.page) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  let query = supabase
    .from("SSP_Tower")
    .select(
      "tower_id,created_at,active,society,block,name,floors,flats_per_floor",
      { count: "exact" },
    )
    .eq("society", societyId);

  // Search
  if (req.search && req.search.trim() !== "") {
    query = query.ilike("name", `%${req.search.trim()}%`);
  }

  // Filters
  if (req.filters) {
    const blocks = normalizeArray(req.filters.block);
    if (blocks && blocks.length > 0) {
      query = query.in("block", blocks);
    }

    if (req.filters.active !== undefined && req.filters.active !== null) {
      const activeVal = typeof req.filters.active === "boolean"
        ? req.filters.active
        : String(req.filters.active).toLowerCase() === "true";
      query = query.eq("active", activeVal);
    }
  }

  // Sort
  const requestedSortField = req.sort?.field || "created_at";
  const sortField = VALID_SORT_FIELDS.includes(
      requestedSortField as typeof VALID_SORT_FIELDS[number],
    )
    ? requestedSortField
    : "created_at";
  const ascending = req.sort?.order === "asc";
  query = query.order(sortField, { ascending });

  // Pagination
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  const towers = ((data || []) as TowerRow[]).map(formatTower);
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return respond({
    towers,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      block: req.filters?.block ?? null,
      active: req.filters?.active ?? null,
    },
    search: req.search ?? null,
    sort: { field: sortField, order: ascending ? "asc" : "desc" },
  });
}

async function handleCreate(
  req: CrudTowerRequest,
  societyId: string,
): Promise<Response> {
  const p = req.payload;
  if (!p) {
    return fail("payload is required.", 400, "MISSING_PARAMETERS");
  }

  if (!p.name || String(p.name).trim() === "") {
    return fail("payload.name is required.", 400, "MISSING_PARAMETERS");
  }

  if (p.active === undefined || p.active === null) {
    return fail("payload.active is required.", 400, "MISSING_PARAMETERS");
  }

  const blockId = p.block && String(p.block).trim() !== "" ? p.block : null;
  const floors = parseInteger(p.floors) ?? 0;
  const flatsPerFloor = parseInteger(p.flatsPerFloor) ?? 0;

  // DB payload uses snake_case
  const insertPayload = {
    society: societyId,
    block: blockId,
    name: String(p.name).trim(),
    active: Boolean(p.active),
    floors,
    flats_per_floor: flatsPerFloor,
  };

  const { data, error } = await supabase
    .from("SSP_Tower")
    .insert(insertPayload)
    .select(
      "tower_id,created_at,active,society,block,name,floors,flats_per_floor",
    )
    .single();

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  return respond({ tower: formatTower(data as TowerRow) }, 201);
}

async function handleUpdate(
  req: CrudTowerRequest,
  societyId: string,
): Promise<Response> {
  if (!req.towerId || String(req.towerId).trim() === "") {
    return fail("towerId is required for UPDATE.", 400, "MISSING_PARAMETERS");
  }
  if (!isValidUUID(String(req.towerId).trim())) {
    return fail("towerId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }
  if (!req.payload || Object.keys(req.payload).length === 0) {
    return fail("payload cannot be empty.", 400, "MISSING_PARAMETERS");
  }

  const updatePayload: Record<string, unknown> = {};

  if (req.payload.name !== undefined) {
    updatePayload.name = String(req.payload.name).trim();
  }
  if (req.payload.block !== undefined) {
    updatePayload.block =
      req.payload.block && String(req.payload.block).trim() !== ""
        ? req.payload.block
        : null;
  }
  if (req.payload.active !== undefined) {
    updatePayload.active = Boolean(req.payload.active);
  }
  if (req.payload.floors !== undefined) {
    const floors = parseInteger(req.payload.floors);
    if (floors === null) {
      return fail(
        "floors must be a non-negative integer.",
        400,
        "INVALID_PARAMETERS",
      );
    }
    updatePayload.floors = floors;
  }
  if (req.payload.flatsPerFloor !== undefined) {
    const flats = parseInteger(req.payload.flatsPerFloor);
    if (flats === null) {
      return fail(
        "flatsPerFloor must be a non-negative integer.",
        400,
        "INVALID_PARAMETERS",
      );
    }
    // Request uses camelCase, DB uses snake_case
    updatePayload.flats_per_floor = flats;
  }

  if (Object.keys(updatePayload).length === 0) {
    return fail("No valid fields to update.", 400, "MISSING_PARAMETERS");
  }

  const { data, error } = await supabase
    .from("SSP_Tower")
    .update(updatePayload as never)
    .eq("tower_id", String(req.towerId).trim())
    .eq("society", societyId)
    .select(
      "tower_id,created_at,active,society,block,name,floors,flats_per_floor",
    )
    .maybeSingle();

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!data) {
    return fail("Tower not found in this society.", 404, "NOT_FOUND");
  }

  return respond({ tower: formatTower(data as TowerRow) });
}

async function handleDelete(
  req: CrudTowerRequest,
  societyId: string,
): Promise<Response> {
  if (!req.towerId || String(req.towerId).trim() === "") {
    return fail("towerId is required for DELETE.", 400, "MISSING_PARAMETERS");
  }
  if (!isValidUUID(String(req.towerId).trim())) {
    return fail("towerId must be a valid UUID.", 400, "INVALID_PARAMETERS");
  }

  const { error, count } = await supabase
    .from("SSP_Tower")
    .delete({ count: "exact" })
    .eq("tower_id", String(req.towerId).trim())
    .eq("society", societyId);

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!count || count === 0) {
    return fail("Tower not found in this society.", 404, "NOT_FOUND");
  }

  return respond({
    towerId: req.towerId,
    message: "Tower deleted successfully.",
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
      | CrudTowerRequest
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
    if (!VALID_ACTIONS.includes(actionUpper as typeof VALID_ACTIONS[number])) {
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
    console.error("❌ crud-tower error:", msg);
    return fail(msg, 500, "SERVER_ERROR");
  }
});
