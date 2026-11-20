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
//   const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
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
//     // Inline Auth Verification
//     const cleanRegNum = String(registrationNumber).trim();
//     const cleanPhone = String(adminPhone).replace(/\D/g, '');
//     const { data: society } = await supabase.from('SSP_Society').select('society_id').eq('registration_number', cleanRegNum).maybeSingle();
//     if (!society) return new Response(JSON.stringify({
//       status: "FAILURE",
//       message: "Society not found."
//     }), {
//       status: 404,
//       headers: corsHeaders
//     });
//     const { data: admins } = await supabase.from('SSP_Society_User').select('role, SSP_Contact!contact (phone)').eq('society', society.society_id);
//     const isAuthorized = (admins || []).some((user)=>{
//       let roles = Array.isArray(user.role) ? user.role.map((r)=>String(r).toLowerCase()) : String(user.role || '').toLowerCase().replace(/[{}]/g, '').split(',');
//       const dbPhone = user.SSP_Contact?.phone ? String(user.SSP_Contact.phone).replace(/\D/g, '') : '';
//       return roles.includes('admin') && dbPhone !== '' && (cleanPhone.includes(dbPhone) || dbPhone.includes(cleanPhone));
//     });
//     if (!isAuthorized) return new Response(JSON.stringify({
//       status: "FAILURE",
//       message: "Unauthorized Admin Access."
//     }), {
//       status: 403,
//       headers: corsHeaders
//     });
//     let result;
//     const act = String(action).toUpperCase();
//     if (act === 'CREATE') {
//       // FORCE OPTIONAL: Handle tower value conversions cleanly
//       const towerId = payload?.tower && String(payload.tower).trim() !== '' ? payload.tower : null;
//       const insertPayload = {
//         ...payload,
//         society: society.society_id,
//         tower: towerId
//       };
//       result = await supabase.from('SSP_Block').insert(insertPayload).select();
//     } else if (act === 'UPDATE') {
//       if (!id) throw new Error("ID parameter is required for UPDATE operation.");
//       let updatePayload = {
//         ...payload
//       };
//       // Allow clearing out or modifying the tower linking on update
//       if (payload && 'tower' in payload) {
//         updatePayload.tower = payload.tower && String(payload.tower).trim() !== '' ? payload.tower : null;
//       }
//       result = await supabase.from('SSP_Block').update(updatePayload).eq('block_id', id).eq('society', society.society_id).select();
//     } else if (act === 'DELETE') {
//       if (!id) throw new Error("ID parameter is required for DELETE operation.");
//       result = await supabase.from('SSP_Block').delete().eq('block_id', id).eq('society', society.society_id);
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
// crud-block - Society Block CRUD
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface CrudBlockRequest {
  societyRegistrationNumber: string;
  adminId: string;
  action: "VIEW" | "CREATE" | "UPDATE" | "DELETE";
  search?: string;
  filters?: {
    tower?: string | string[];
    active?: boolean | string;
  };
  sort?: {
    field?: string;
    order?: "asc" | "desc";
  };
  page?: number;
  limit?: number;
  blockId?: string;
  payload?: {
    block_name?: string;
    tower?: string | null;
    active?: boolean;
  };
}

interface BlockRow {
  block_id: string;
  created_at: string;
  active: boolean | null;
  society: string | null;
  tower: string | null;
  block_name: string | null;
}

interface FormattedBlock {
  blockId: string;
  blockName: string | null;
  tower: string | null;
  active: boolean;
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
const VALID_SORT_FIELDS = ["block_name", "created_at", "active"] as const;
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

function formatBlock(row: BlockRow): FormattedBlock {
  return {
    blockId: row.block_id,
    blockName: row.block_name,
    tower: row.tower,
    active: row.active ?? true,
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
  req: CrudBlockRequest,
  societyId: string,
): Promise<Response> {
  const page = Math.max(1, Number(req.page) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  let query = supabase
    .from("SSP_Block")
    .select("block_id,created_at,active,society,tower,block_name", {
      count: "exact",
    })
    .eq("society", societyId);

  if (req.search && req.search.trim() !== "") {
    query = query.ilike("block_name", `%${req.search.trim()}%`);
  }

  if (req.filters) {
    const towers = normalizeArray(req.filters.tower);
    if (towers && towers.length > 0) {
      query = query.in("tower", towers);
    }

    if (req.filters.active !== undefined && req.filters.active !== null) {
      const activeVal = typeof req.filters.active === "boolean"
        ? req.filters.active
        : String(req.filters.active).toLowerCase() === "true";
      query = query.eq("active", activeVal);
    }
  }

  const requestedSortField = req.sort?.field || "created_at";
  const sortField = VALID_SORT_FIELDS.includes(
      requestedSortField as typeof VALID_SORT_FIELDS[number],
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

  const blocks = ((data || []) as BlockRow[]).map(formatBlock);
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return respond({
    blocks,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      tower: req.filters?.tower ?? null,
      active: req.filters?.active ?? null,
    },
    search: req.search ?? null,
    sort: { field: sortField, order: ascending ? "asc" : "desc" },
  });
}

async function handleCreate(
  req: CrudBlockRequest,
  societyId: string,
): Promise<Response> {
  const p = req.payload;
  if (!p || !p.block_name || String(p.block_name).trim() === "") {
    return fail("payload.block_name is required.", 400, "MISSING_PARAMETERS");
  }

  const towerId = p.tower && String(p.tower).trim() !== "" ? p.tower : null;

  const insertPayload = {
    society: societyId,
    tower: towerId,
    block_name: String(p.block_name).trim(),
    active: p.active !== undefined ? Boolean(p.active) : true,
  };

  const { data, error } = await supabase
    .from("SSP_Block")
    .insert(insertPayload)
    .select("block_id,created_at,active,society,tower,block_name")
    .single();

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }

  return respond({ block: formatBlock(data as BlockRow) }, 201);
}

async function handleUpdate(
  req: CrudBlockRequest,
  societyId: string,
): Promise<Response> {
  if (!req.blockId || String(req.blockId).trim() === "") {
    return fail("blockId is required for UPDATE.", 400, "MISSING_PARAMETERS");
  }
  if (!req.payload || Object.keys(req.payload).length === 0) {
    return fail("payload cannot be empty.", 400, "MISSING_PARAMETERS");
  }

  const updatePayload: Record<string, unknown> = {};

  if (req.payload.block_name !== undefined) {
    updatePayload.block_name = String(req.payload.block_name).trim();
  }
  if (req.payload.tower !== undefined) {
    updatePayload.tower =
      req.payload.tower && String(req.payload.tower).trim() !== ""
        ? req.payload.tower
        : null;
  }
  if (req.payload.active !== undefined) {
    updatePayload.active = Boolean(req.payload.active);
  }

  if (Object.keys(updatePayload).length === 0) {
    return fail("No valid fields to update.", 400, "MISSING_PARAMETERS");
  }

  const { data, error } = await supabase
    .from("SSP_Block")
    .update(updatePayload as never)
    .eq("block_id", String(req.blockId).trim())
    .eq("society", societyId)
    .select("block_id,created_at,active,society,tower,block_name")
    .maybeSingle();

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!data) {
    return fail("Block not found in this society.", 404, "NOT_FOUND");
  }

  return respond({ block: formatBlock(data as BlockRow) });
}

async function handleDelete(
  req: CrudBlockRequest,
  societyId: string,
): Promise<Response> {
  if (!req.blockId || String(req.blockId).trim() === "") {
    return fail("blockId is required for DELETE.", 400, "MISSING_PARAMETERS");
  }

  const { error, count } = await supabase
    .from("SSP_Block")
    .delete({ count: "exact" })
    .eq("block_id", String(req.blockId).trim())
    .eq("society", societyId);

  if (error) {
    return fail(error.message, 500, "DATABASE_ERROR");
  }
  if (!count || count === 0) {
    return fail("Block not found in this society.", 404, "NOT_FOUND");
  }

  return respond({
    blockId: req.blockId,
    message: "Block deleted successfully.",
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
      | CrudBlockRequest
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
    console.error("❌ crud-block error:", msg);
    return fail(msg, 500, "SERVER_ERROR");
  }
});
