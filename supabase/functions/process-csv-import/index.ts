/*import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Papa from "https://esm.sh/papaparse@5.4.1"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface CSVRow {
  entity_type: "society_user" | "non_society_user"
  
  // Identifiers / Foreign Keys
  user_id?: string
  non_society_user_id?: string
  contact_id?: string
  society_id?: string
  registration_number?: string
  tower_id?: string
  tower_name?: string
  block_id?: string
  block_name?: string
  flat_type_id?: string
  vendor_id?: string

  // Common Personal Data
  name?: string
  phone?: string
  email?: string
  gender?: string
  occupation?: string
  id_proof_number?: string
  id_proof_type?: string
  whatsapp_phone?: string

  // SSP_Society_User specific
  unit_flat_number?: string
  role?: string // e.g., "Resident" or "Resident, Admin"
  user_type?: string
  user_ownership_type?: string
  status?: string | boolean
  gate_number?: string
  security_guard_id?: string
  security_zone?: string
  shift?: string

  // SSP_Non_Society_User specific
  purpose?: string
  service_type?: string
  vehicle_number?: string
  vehicle_type?: string
  delivery_origin?: string
  gate_no?: string
  recurring_days?: string
}

interface RowError {
  rowNumber: number
  data: CSVRow
  reason: string
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // 1. Authorization Check (Handles User JWT or Admin API Key)
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return buildResponse({ error: "Missing Authorization header" }, 401)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    // Privileged admin client for upserts
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Token verification (Allows Service Role Key OR valid signed-in user)
    /*const token = authHeader.replace("Bearer ", "").trim()
    if (token !== serviceRoleKey) {
      const supabaseClient = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
      if (userError || !user) {
        return buildResponse({ error: "Unauthorized access: Invalid or expired token" }, 401)
      }
    }*/
    
// --- NEW FLEXIBLE TEST BLOCK ---
// Validates that ANY Supabase Authorization header is present
/*if (!authHeader.startsWith("Bearer ")) {
  return buildResponse({ error: "Invalid Authorization header format. Expected 'Bearer <token>'" }, 401)
}

    // 2. File Processing
    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return buildResponse({ error: "No file uploaded under form key 'file'" }, 400)
    }

    const fileText = await file.text()

    // 3. Parse CSV
    const parseResult = Papa.parse<CSVRow>(fileText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    })

    const rows = parseResult.data
    if (!rows || rows.length === 0) {
      return buildResponse({ error: "Uploaded CSV is empty" }, 400)
    }

    // 4. Cache Metadata Tables with Explicit Map Types
    const { data: societies } = await supabaseAdmin.from("SSP_Society").select("society_id, registration_number")
    const { data: towers } = await supabaseAdmin.from("SSP_Tower").select("tower_id, name, society")
    const { data: blocks } = await supabaseAdmin.from("SSP_Block").select("block_id, block_name, society")

    // Typed explicitly as Map<string, string> to resolve TypeScript error
    const societyRegMap = new Map<string, string>(
      (societies || []).map(s => [
        String(s.registration_number).trim().toLowerCase(), 
        String(s.society_id)
      ])
    )
    
    const failedRows: RowError[] = []
    let processedSocietyUsers = 0
    let processedNonSocietyUsers = 0

    // 5. Processing CSV Records Line-by-Line
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const rowNum = index + 2 // +2 accounts for 1-based index + CSV header line

      try {
        if (!row.entity_type) {
          throw new Error("Missing required field 'entity_type' ('society_user' or 'non_society_user')")
        }

        const entityType = String(row.entity_type).trim().toLowerCase()

        // Resolve Target Society UUID safely
        let targetSocietyId: string | null = row.society_id ? String(row.society_id).trim() : null
        if (!targetSocietyId && row.registration_number) {
          targetSocietyId = societyRegMap.get(String(row.registration_number).trim().toLowerCase()) || null
        }

        if (!targetSocietyId) {
          throw new Error("Unable to resolve valid 'society_id' or 'registration_number'")
        }

        if (entityType === "society_user") {
          const phoneClean = String(row.phone || "").trim()
          if (!phoneClean || !row.name) {
            throw new Error("Missing mandatory fields for society user: 'name' or 'phone'")
          }

          // A. Upsert SSP_Contact Record
          const contactPayload: Record<string, any> = {
            society: targetSocietyId,
            name: String(row.name).trim(),
            phone: phoneClean,
            email: row.email ? String(row.email).trim() : null,
            gender: row.gender ? String(row.gender).trim() : null,
            occupation: row.occupation ? String(row.occupation).trim() : null,
            id_proof_number: row.id_proof_number ? String(row.id_proof_number).trim() : null,
            id_proof_type: row.id_proof_type ? String(row.id_proof_type).trim() : 'Aadhaar Card',
            whatsapp_phone: row.whatsapp_phone ? String(row.whatsapp_phone).trim() : null
          }

          if (row.contact_id) {
            contactPayload.contact_id = row.contact_id
          }

          const { data: contactData, error: contactErr } = await supabaseAdmin
            .from("SSP_Contact")
            .upsert(contactPayload, { onConflict: "contact_id" })
            .select("contact_id")
            .single()

          if (contactErr) throw new Error(`SSP_Contact error: ${contactErr.message}`)

          // Resolve Tower UUID
          let resolvedTowerId = row.tower_id ? String(row.tower_id).trim() : null
          if (!resolvedTowerId && row.tower_name) {
            const matchedTower = (towers || []).find(
              t => String(t.name).trim().toLowerCase() === String(row.tower_name).trim().toLowerCase() &&
                   t.society === targetSocietyId
            )
            resolvedTowerId = matchedTower ? matchedTower.tower_id : null
          }

          // Resolve Block UUID
          let resolvedBlockId = row.block_id ? String(row.block_id).trim() : null
          if (!resolvedBlockId && row.block_name) {
            const matchedBlock = (blocks || []).find(
              b => String(b.block_name).trim().toLowerCase() === String(row.block_name).trim().toLowerCase() &&
                   b.society === targetSocietyId
            )
            resolvedBlockId = matchedBlock ? matchedBlock.block_id : null
          }

          // Process Role as Postgres text[] Array
          let rolesArray: string[] = ["Resident"]
          if (row.role) {
            rolesArray = String(row.role)
              .replace(/^\[|\]$/g, "")
              .split(",")
              .map(r => r.trim().replace(/^"|"$/g, ""))
              .filter(Boolean)
          }

          // Parse Boolean status safely
          const rawStatus = String(row.status || "true").toLowerCase()
          const parsedStatus = rawStatus === "true" || rawStatus === "active" || rawStatus === "1"

          // B. Upsert SSP_Society_User Record
          const userPayload: Record<string, any> = {
            society: targetSocietyId,
            contact: contactData.contact_id,
            tower: resolvedTowerId,
            block: resolvedBlockId,
            flat_type_id: row.flat_type_id ? String(row.flat_type_id).trim() : null,
            unit_flat_number: row.unit_flat_number ? String(row.unit_flat_number).trim() : null,
            role: rolesArray, // text[] array
            user_type: row.user_type ? String(row.user_type).trim() : "Primary",
            user_ownership_type: row.user_ownership_type ? String(row.user_ownership_type).trim() : "Owner",
            status: parsedStatus,
            gate_number: row.gate_number ? String(row.gate_number).trim() : null,
            security_guard_id: row.security_guard_id ? String(row.security_guard_id).trim() : null,
            security_zone: row.security_zone ? String(row.security_zone).trim() : null,
            shift: row.shift ? String(row.shift).trim() : null
          }

          if (row.user_id) {
            userPayload.user_id = row.user_id
          }

          const { error: userErr } = await supabaseAdmin
            .from("SSP_Society_User")
            .upsert(userPayload, { onConflict: "user_id" })

          if (userErr) throw new Error(`SSP_Society_User error: ${userErr.message}`)
          processedSocietyUsers++

        } else if (entityType === "non_society_user") {
          const phoneClean = String(row.phone || "").trim()
          if (!phoneClean || !row.name) {
            throw new Error("Missing mandatory fields for non-society user: 'name' or 'phone'")
          }

          // Process recurring_days text[]
          let recurringDaysArray: string[] | null = null
          if (row.recurring_days) {
            recurringDaysArray = String(row.recurring_days)
              .replace(/^\[|\]$/g, "")
              .split(",")
              .map(d => d.trim().replace(/^"|"$/g, ""))
              .filter(Boolean)
          }

          const nonSocietyPayload: Record<string, any> = {
            society: targetSocietyId,
            name: String(row.name).trim(),
            phone_number: phoneClean,
            email: row.email ? String(row.email).trim() : null,
            gender: row.gender ? String(row.gender).trim() : null,
            role: row.role ? String(row.role).trim() : "Visitor",
            id_proof_number: row.id_proof_number ? String(row.id_proof_number).trim() : null,
            id_proof_type: row.id_proof_type ? String(row.id_proof_type).trim() : null,
            purpose: row.purpose ? String(row.purpose).trim() : null,
            service_type: row.service_type ? String(row.service_type).trim() : null,
            vehicle_number: row.vehicle_number ? String(row.vehicle_number).trim() : null,
            vehicle_type: row.vehicle_type ? String(row.vehicle_type).trim() : null,
            delivery_origin: row.delivery_origin ? String(row.delivery_origin).trim() : null,
            gate_no: row.gate_no ? String(row.gate_no).trim() : null,
            vendor_id: row.vendor_id ? String(row.vendor_id).trim() : null,
            recurring_days: recurringDaysArray,
            hosted_by: row.hosted_by ? String(row.hosted_by).trim() : null // <--- ADD THIS LINE
          }

          if (row.non_society_user_id) {
            nonSocietyPayload.non_society_user_id = row.non_society_user_id
          }

          const { error: vendorErr } = await supabaseAdmin
            .from("SSP_Non_Society_User")
            .upsert(nonSocietyPayload, { onConflict: "non_society_user_id" })

          if (vendorErr) throw new Error(`SSP_Non_Society_User error: ${vendorErr.message}`)
          processedNonSocietyUsers++

        } else {
          throw new Error(`Invalid entity_type '${row.entity_type}'. Expected 'society_user' or 'non_society_user'`)
        }

      } catch (err: any) {
        failedRows.push({
          rowNumber: rowNum,
          data: row,
          reason: err.message || "Unknown processing error"
        })
      }
    }

    // 6. Summary Output Response
    return buildResponse({
      success: true,
      executionTimeMs: Date.now() - startTime,
      summary: {
        totalRowsInCSV: rows.length,
        societyUsersProcessed: processedSocietyUsers,
        nonSocietyUsersProcessed: processedNonSocietyUsers,
        totalFailedRows: failedRows.length
      },
      failedRowsReport: failedRows
    }, 200)

  } catch (err: any) {
    console.error("Fatal Processing Failure:", err)
    return buildResponse({ error: err.message || "Internal server error" }, 500)
  }
})

function buildResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}*/
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Papa from "https://esm.sh/papaparse@5.4.1";

// Shared standard imports
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import { successResponse } from "../_shared/response.ts";
import { ApiError, ErrorCodes, handleError } from "../_shared/errors.ts";
import { validateRequired } from "../_shared/validation.ts";
import { sanitizeString, sanitizePagination } from "../_shared/sanitizer.ts";
import { ArrayHandler } from "../_shared/array-handler.ts";
import { logger } from "../_shared/logger.ts";

/** One parsed CSV row: header keys are lowercased + snake_cased by transformHeader. */
type CsvRow = Record<string, string>;

interface ProcessingError {
  rowNumber: number;
  entityType?: string;
  data: CsvRow; // ✅ FIX 1: was `Record`
  reason: string;
}

interface ProcessedRow {
  rowNumber: number;
  entityType: string;
  identifier: string;
  status: "success";
}

interface FailedReportRow extends ProcessingError {
  status: "failed";
}

type ReportItem = ProcessedRow | FailedReportRow;

Deno.serve(
  requireAuth(async (req: Request, _ctx: AuthContext): Promise<Response> => {
    const startTime = Date.now();
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // 1. Content-Type and Payload Extraction
      const contentType = req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data")) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          "Invalid Content-Type. Expected 'multipart/form-data'.",
          400
        );
      }

      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          "No file uploaded under form key 'file'.",
          400
        );
      }

      // 2. Read Pagination & Filter Parameters from Form Data
      const pageParam = formData.get("page")?.toString() ?? "1";
      const limitParam = formData.get("limit")?.toString() ?? "10";
      const entityTypeFilter = formData.get("entityType")?.toString();
      const statusFilter = formData.get("status")?.toString(); // "success" | "failed" | "all"
      const searchQuery = formData.get("searchQuery")?.toString();

      const { page: pageNum, limit: limitNum } = sanitizePagination(pageParam, limitParam);

     // 3. Read & Parse CSV Content
const fileText = await file.text();
if (!validateRequired(fileText)) {
  throw new ApiError(ErrorCodes.BAD_REQUEST, "Uploaded CSV file is empty.", 400);
}

// Use Papa.parse instead of direct parse call
const parseResult = Papa.parse(fileText, {
  header: true,
  skipEmptyLines: true,
  transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_"),
});

      // ✅ FIX 3: now typed correctly (was inferring boolean because generic was broken)
      const rows: CsvRow[] = parseResult.data;
      if (!rows || rows.length === 0) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          "Parsed CSV contains no valid data rows.",
          400
        );
      }

      // 4. Pre-fetch Metadata Caches
      const { data: societies } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, registration_number");
      const { data: towers } = await supabaseAdmin
        .from("SSP_Tower")
        .select("tower_id, name, society");
      const { data: blocks } = await supabaseAdmin
        .from("SSP_Block")
        .select("block_id, block_name, society");

      const societyRegMap = new Map<string, string>(
        (societies || []).map((s) => [
          String(s.registration_number).trim().toLowerCase(),
          String(s.society_id),
        ])
      );

      const failedRows: ProcessingError[] = [];
      const successfulRows: ProcessedRow[] = [];
      let processedSocietyUsers = 0;
      let processedNonSocietyUsers = 0;

      // 5. Line-by-Line CSV Processing
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const rowNum = index + 2; // Line 1 is header

        try {
          if (!row.entity_type) {
            throw new Error(
              "Missing required field 'entity_type' ('society_user' or 'non_society_user')"
            );
          }

          const entityType = sanitizeString(row.entity_type).toLowerCase();

          // Resolve Target Society UUID
          let targetSocietyId = row.society_id ? sanitizeString(row.society_id) : null;
          if (!targetSocietyId && row.registration_number) {
            targetSocietyId =
              societyRegMap.get(sanitizeString(row.registration_number).toLowerCase()) ||
              null;
          }

          if (!targetSocietyId) {
            throw new Error("Unable to resolve valid 'society_id' or 'registration_number'");
          }

          if (entityType === "society_user") {
            const phoneClean = sanitizeString(row.phone || "");
            const nameClean = sanitizeString(row.name || "");

            if (!phoneClean || !nameClean) {
              throw new Error("Missing mandatory fields for society user: 'name' or 'phone'");
            }

            // A. Upsert SSP_Contact Record
            // ✅ FIX 4: was `Record`
            const contactPayload: Record<string, unknown> = {
              society: targetSocietyId,
              name: nameClean,
              phone: phoneClean,
              email: row.email ? sanitizeString(row.email) : null,
              gender: row.gender ? sanitizeString(row.gender) : null,
              occupation: row.occupation ? sanitizeString(row.occupation) : null,
              id_proof_number: row.id_proof_number ? sanitizeString(row.id_proof_number) : null,
              id_proof_type: row.id_proof_type ? sanitizeString(row.id_proof_type) : null,
              whatsapp_phone: row.whatsapp_phone ? sanitizeString(row.whatsapp_phone) : null,
            };

            if (row.contact_id) {
              contactPayload.contact_id = sanitizeString(row.contact_id);
            }

            const { data: contactData, error: contactErr } = await supabaseAdmin
              .from("SSP_Contact")
              .upsert(contactPayload, { onConflict: "contact_id" })
              .select("contact_id")
              .single();

            if (contactErr) {
              throw new Error(`SSP_Contact error: ${contactErr.message}`);
            }

            // Resolve Tower & Block UUIDs
            let resolvedTowerId = row.tower_id ? sanitizeString(row.tower_id) : null;
            if (!resolvedTowerId && row.tower_name) {
              const cleanTowerName = sanitizeString(row.tower_name).toLowerCase();
              const matchedTower = (towers || []).find(
                (t) =>
                  String(t.name).trim().toLowerCase() === cleanTowerName &&
                  t.society === targetSocietyId
              );
              resolvedTowerId = matchedTower ? matchedTower.tower_id : null;
            }

            let resolvedBlockId = row.block_id ? sanitizeString(row.block_id) : null;
            if (!resolvedBlockId && row.block_name) {
              const cleanBlockName = sanitizeString(row.block_name).toLowerCase();
              const matchedBlock = (blocks || []).find(
                (b) =>
                  String(b.block_name).trim().toLowerCase() === cleanBlockName &&
                  b.society === targetSocietyId
              );
              resolvedBlockId = matchedBlock ? matchedBlock.block_id : null;
            }

            // Parse Role Array
            const rolesArray = row.role
              ? ArrayHandler.toArray(row.role)
              : ["resident"];

            const rawStatus = sanitizeString(row.status || "true").toLowerCase();
            const parsedStatus =
              rawStatus === "true" || rawStatus === "active" || rawStatus === "1";

            // B. Upsert SSP_Society_User Record
            // ✅ FIX 5: was `Record`
            const userPayload: Record<string, unknown> = {
              society: targetSocietyId,
              contact: contactData.contact_id,
              tower: resolvedTowerId,
              block: resolvedBlockId,
              flat_type_id: row.flat_type_id ? sanitizeString(row.flat_type_id) : null,
              unit_flat_number: row.unit_flat_number
                ? sanitizeString(row.unit_flat_number)
                : null,
              role: rolesArray,
              user_type: row.user_type ? sanitizeString(row.user_type) : "owner",
              user_ownership_type: row.user_ownership_type
                ? sanitizeString(row.user_ownership_type)
                : "primary",
              status: parsedStatus,
              gate_number: row.gate_number ? sanitizeString(row.gate_number) : null,
              security_guard_id: row.security_guard_id
                ? sanitizeString(row.security_guard_id)
                : null,
              security_zone: row.security_zone ? sanitizeString(row.security_zone) : null,
              shift: row.shift ? sanitizeString(row.shift) : null,
            };

            if (row.user_id) {
              userPayload.user_id = sanitizeString(row.user_id);
            }

            const { error: userErr } = await supabaseAdmin
              .from("SSP_Society_User")
              .upsert(userPayload, { onConflict: "user_id" });

            if (userErr) {
              throw new Error(`SSP_Society_User error: ${userErr.message}`);
            }

            processedSocietyUsers++;
            successfulRows.push({
              rowNumber: rowNum,
              entityType: "society_user",
              identifier: phoneClean,
              status: "success",
            });
          } else if (entityType === "non_society_user") {
            const phoneClean = sanitizeString(row.phone || "");
            const nameClean = sanitizeString(row.name || "");

            if (!phoneClean || !nameClean) {
              throw new Error("Missing mandatory fields for non-society user: 'name' or 'phone'");
            }

            const recurringDaysArray = row.recurring_days
              ? ArrayHandler.toArray(row.recurring_days)
              : null;

            // ✅ FIX 6: was `Record`
            const nonSocietyPayload: Record<string, unknown> = {
              society: targetSocietyId,
              name: nameClean,
              phone_number: phoneClean,
              email: row.email ? sanitizeString(row.email) : null,
              gender: row.gender ? sanitizeString(row.gender) : null,
              role: row.role ? sanitizeString(row.role) : "visitor",
              id_proof_number: row.id_proof_number
                ? sanitizeString(row.id_proof_number)
                : null,
              id_proof_type: row.id_proof_type ? sanitizeString(row.id_proof_type) : null,
              purpose: row.purpose ? sanitizeString(row.purpose) : null,
              service_type: row.service_type ? sanitizeString(row.service_type) : null,
              vehicle_number: row.vehicle_number ? sanitizeString(row.vehicle_number) : null,
              vehicle_type: row.vehicle_type ? sanitizeString(row.vehicle_type) : null,
              delivery_origin: row.delivery_origin
                ? sanitizeString(row.delivery_origin)
                : null,
              gate_no: row.gate_no ? sanitizeString(row.gate_no) : null,
              vendor_id: row.vendor_id ? sanitizeString(row.vendor_id) : null,
              recurring_days: recurringDaysArray,
              hosted_by: row.hosted_by ? sanitizeString(row.hosted_by) : null,
            };

            if (row.non_society_user_id) {
              nonSocietyPayload.non_society_user_id = sanitizeString(row.non_society_user_id);
            }

            const { error: vendorErr } = await supabaseAdmin
              .from("SSP_Non_Society_User")
              .upsert(nonSocietyPayload, { onConflict: "non_society_user_id" });

            if (vendorErr) {
              throw new Error(`SSP_Non_Society_User error: ${vendorErr.message}`);
            }

            processedNonSocietyUsers++;
            successfulRows.push({
              rowNumber: rowNum,
              entityType: "non_society_user",
              identifier: phoneClean,
              status: "success",
            });
          } else {
            throw new Error(
              `Invalid entity_type '${row.entity_type}'. Expected 'society_user' or 'non_society_user'`
            );
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : "Unknown processing error";
          failedRows.push({
            rowNumber: rowNum,
            entityType: row.entity_type ? sanitizeString(row.entity_type) : undefined,
            data: row,
            reason: errorMessage,
          });
        }
      }

      // 6. Apply Filtering on Response Details
      // ✅ FIX 7: was `Array`
      let reportItems: ReportItem[] = [
        ...successfulRows,
        ...failedRows.map((f): FailedReportRow => ({ ...f, status: "failed" })),
      ];

      if (statusFilter && statusFilter !== "all") {
        const cleanStatus = sanitizeString(statusFilter).toLowerCase();
        reportItems = reportItems.filter((item: ReportItem) => item.status === cleanStatus);
      }

      if (entityTypeFilter) {
        const cleanEntityFilter = sanitizeString(entityTypeFilter).toLowerCase();
        reportItems = reportItems.filter(
          (item: ReportItem) => item.entityType?.toLowerCase() === cleanEntityFilter
        );
      }

      if (searchQuery) {
        const cleanSearch = sanitizeString(searchQuery).toLowerCase();
        reportItems = reportItems.filter((item: ReportItem) => {
          const rowStr = JSON.stringify(item).toLowerCase();
          return rowStr.includes(cleanSearch);
        });
      }

      // 7. Paginate the Combined Processing Report
      const totalReportItems = reportItems.length;
      const offset = (pageNum - 1) * limitNum;
      const paginatedReport = reportItems.slice(offset, offset + limitNum);

      // ✅ FIX 8: was `\(...\){...}` — broken interpolation
      logger.info({
        action: "processCsvImport",
        message: `Processed ${rows.length} CSV rows. Success: ${successfulRows.length}, Failed: ${failedRows.length}`,
      });

      // 8. Construct Success Response Payload
      return successResponse({
        executionTimeMs: Date.now() - startTime,
        summary: {
          totalRowsInCSV: rows.length,
          societyUsersProcessed: processedSocietyUsers,
          nonSocietyUsersProcessed: processedNonSocietyUsers,
          totalFailedRows: failedRows.length,
        },
        report: paginatedReport,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalRecords: totalReportItems,
          totalPages: Math.ceil(totalReportItems / limitNum),
        },
      });
    } catch (err: unknown) {
      return handleError(err);
    }
  })
);