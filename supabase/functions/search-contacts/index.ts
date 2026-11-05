import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

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
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 100;
const MIN_DIGITS_FOR_PHONE_MATCH = 3;

// ============================================
// HELPERS
// ============================================

/**
 * Escape Postgres LIKE/ILIKE metacharacters (`%`, `_`, `\`) so a user
 * search like "50%" or "a_b" doesn't accidentally match everything.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/**
 * Mask ID proof numbers before returning them. Return only the last 4
 * characters, e.g. "****4567".
 */
function maskIdProof(value: string | null): string | null {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return s;
  return `****${s.slice(-4)}`;
}

function buildError(
  code: string,
  msg: string,
  status: number,
  startTime?: number,
): Response {
  const elapsed = startTime ? ` (${Date.now() - startTime}ms)` : "";
  console.error(`search-contacts FAIL [${code}]${elapsed}: ${msg}`);
  return new Response(
    JSON.stringify({
      contactList: [],
      pagination: null,
      errorResponse: {
        errorCode: code,
        message: msg,
        timestamp: new Date().toISOString(),
      },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

// ============================================
// MAIN HANDLER
// ============================================

serve(
  requireAuth(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return buildError("METHOD_NOT_ALLOWED", "Only POST is allowed.", 405);
    }

    const startTime = Date.now();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    try {
      // ── 1. Parse and validate body ──
      const body = await req.json().catch(() => null);
      if (!body) {
        return buildError("BAD_REQUEST", "Request body is required.", 400);
      }

      const {
        searchKey,
        registrationNumber,
        page,
        limit,
      }: {
        searchKey?: string;
        registrationNumber?: string;
        page?: number | string;
        limit?: number | string;
      } = body;

      if (!searchKey || String(searchKey).trim() === "") {
        return buildError("BAD_REQUEST", "searchKey is mandatory.", 400);
      }
      if (
        !registrationNumber ||
        String(registrationNumber).trim() === ""
      ) {
        return buildError(
          "BAD_REQUEST",
          "registrationNumber is mandatory — contacts must be searched within a single society.",
          400,
        );
      }

      const cleanSearchKey = String(searchKey).trim();

      if (cleanSearchKey.length > MAX_SEARCH_LENGTH) {
        return buildError(
          "BAD_REQUEST",
          `searchKey must be ${MAX_SEARCH_LENGTH} characters or fewer.`,
          400,
        );
      }

      // ── 2. Reject characters that break PostgREST .or() syntax ──
      if (/[(),"]/.test(cleanSearchKey)) {
        return buildError(
          "BAD_REQUEST",
          "searchKey must not contain ( ) , or \" characters.",
          400,
        );
      }

      // ── 3. Escape LIKE metacharacters so "50%" or "a_b" don't match everything ──
      const escapedKey = escapeLikePattern(cleanSearchKey);
      const digitsOnly = cleanSearchKey.replace(/\D/g, "");

      // ── 4. Resolve society ──
      const { data: society, error: socErr } = await supabase
        .from("SSP_Society")
        .select("society_id")
        .eq("registration_number", String(registrationNumber).trim())
        .maybeSingle();

      if (socErr) throw socErr;
      if (!society) {
        return buildError("NOT_FOUND", "Society not found.", 404, startTime);
      }
      const societyId = society.society_id;

      // ── 5. Pagination ──
      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(limit) || DEFAULT_LIMIT),
      );
      const offset = (pageNum - 1) * limitNum;

      // ── 6. Build the OR filter ──
      const orParts: string[] = [
        `name.ilike."%${escapedKey}%"`,
        `phone.ilike."%${escapedKey}%"`,
      ];
      if (
        digitsOnly.length >= MIN_DIGITS_FOR_PHONE_MATCH &&
        digitsOnly !== escapedKey
      ) {
        orParts.push(`phone.ilike."%${digitsOnly}%"`);
      }

      // ── 7. Query — scoped to society, paginated, ordered ──
      const {
        data: contacts,
        error: dbErr,
        count,
      } = await supabase
        .from("SSP_Contact")
        .select(
          // ✅ Added the requested fields to the select query
          "contact_id,name,phone,email,gender,id_proof_type,id_proof_number,society,created_at,emergency_phone,whatsapp_phone,occupation,vehicle_type,vehicle_registration_number",
          { count: "exact" },
        )
        .eq("society", societyId)
        .or(orParts.join(","))
        .order("name", { ascending: true, nullsFirst: false })
        .range(offset, offset + limitNum - 1);

      if (dbErr) throw dbErr;

      // ── 8. Map to camelCase ──
      const contactList = (contacts ?? []).map((c: Record<string, unknown>) => ({
        contactId: c.contact_id as string,
        name: (c.name as string | null) ?? "NA",
        mobileNumber: (c.phone as string | null) ?? "NA",
        email: c.email as string | null,
        gender: c.gender as string | null,
        
        // ✅ Newly added fields
        emergencyPhone: c.emergency_phone as string | null,
        whatsappPhone: c.whatsapp_phone as string | null,
        occupation: c.occupation as string | null,
        idProofType: c.id_proof_type as string | null,
        idProofNumber: c.id_proof_number as string | null,
        vehicleType: c.vehicle_type as string | null,
        vehicleRegistrationNumber: c.vehicle_registration_number as string | null,
        
        // Kept for backwards compatibility if your frontend still uses it
        maskedIdProofNumber: maskIdProof(c.id_proof_number as string | null),
        
        societyId: c.society as string | null,
        createdAt: c.created_at as string | null,
      }));

      const total = count ?? 0;
      const totalPages = Math.ceil(total / limitNum);

      console.log(
        `search-contacts OK: society=${societyId}, key="${cleanSearchKey}", ` +
          `${contactList.length}/${total} results in ${Date.now() - startTime}ms`,
      );

      return new Response(
        JSON.stringify({
          contactList,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1,
          },
          errorResponse: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("search-contacts error:", msg, error);
      return buildError(
        "SERVER_ERROR",
        `Search failed: ${msg}`,
        500,
        startTime,
      );
    }
  }),
);