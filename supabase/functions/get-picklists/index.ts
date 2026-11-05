// deno-lint-ignore-file no-import-prefix
// ============================================
// get-picklists - Unified Metadata Provider
// ============================================
// Returns all dropdown options + field metadata for a society.
// Supports: scoping, i18n, caching, 304 Not Modified.
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface GetPicklistsRequest {
    societyRegistrationNumber: string;
    requesterId: string;
    scope?: string[];
    language?: string;
}

interface PicklistOption {
    value: string;
    label: string;
}

interface FieldMeta {
    fieldLabel: string;
    fieldPlaceholder: string | null;
    fieldHelperText: string | null;
    inputType: string;
    isRequired: boolean;
    isVisible: boolean;
    defaultValue: string | null;
    validationRegex: string | null;
    sortOrder: number;
    options: PicklistOption[];
}

interface PicklistsByTable {
    [tableName: string]: {
        [fieldName: string]: FieldMeta;
    };
}

interface PicklistRow {
    table_name: string;
    field_name: string;
    value: string;
    label: string;
}

interface FieldMetaRow {
    table_name: string;
    field_name: string;
    field_label: string;
    field_placeholder: string | null;
    field_helper_text: string | null;
    input_type: string | null;
    is_required: boolean | null;
    is_visible: boolean | null;
    default_value: string | null;
    validation_regex: string | null;
    sort_order: number | null;
}

// ============================================
// CONSTANTS
// ============================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, if-none-match",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "ETag",
};

const DEFAULT_LANGUAGE = "en";
const CACHE_MAX_AGE_CLIENT = 300; // 5 min
const CACHE_MAX_AGE_CDN = 3600; // 1 hour

const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// RESPONSE HELPERS
// ============================================

function successResponse(
    data: unknown,
    version: string,
    status = 200,
): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control":
                `public, max-age=${CACHE_MAX_AGE_CLIENT}, s-maxage=${CACHE_MAX_AGE_CDN}`,
            "ETag": version,
        },
    });
}

function notModifiedResponse(version: string): Response {
    return new Response(null, {
        status: 304,
        headers: {
            ...corsHeaders,
            "Cache-Control":
                `public, max-age=${CACHE_MAX_AGE_CLIENT}, s-maxage=${CACHE_MAX_AGE_CDN}`,
            "ETag": version,
        },
    });
}

function failResponse(
    message: string,
    status = 400,
    code = "ERROR",
): Response {
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

// ============================================
// VALIDATION
// ============================================

function isValidUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(value);
}

function isValidScope(scope: unknown): scope is string[] {
    return (
        Array.isArray(scope) &&
        scope.length > 0 &&
        scope.every((s) => typeof s === "string" && s.trim() !== "")
    );
}

// ============================================
// AUTH
// ============================================

async function authorizeRequester(
    societyId: string,
    requesterId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
    const clean = String(requesterId).trim();

    if (!isValidUUID(clean)) {
        return {
            ok: false,
            response: failResponse(
                "requesterId must be a valid UUID.",
                400,
                "INVALID_PARAMETERS",
            ),
        };
    }

    const { data: member, error } = await supabase
        .from("SSP_Society_User")
        .select("user_id, status")
        .eq("user_id", clean)
        .eq("society", societyId)
        .maybeSingle();

    if (error) {
        return {
            ok: false,
            response: failResponse(error.message, 500, "DATABASE_ERROR"),
        };
    }

    // Fallback: staff table
    if (!member) {
        const { data: staff } = await supabase
            .from("SSP_Society_Staff")
            .select("staff_id")
            .eq("staff_id", clean)
            .eq("society_id", societyId)
            .maybeSingle();

        if (!staff) {
            return {
                ok: false,
                response: failResponse(
                    "Requester does not belong to this society.",
                    403,
                    "UNAUTHORIZED",
                ),
            };
        }
    } else if (member.status === false) {
        return {
            ok: false,
            response: failResponse(
                "Requester account is inactive.",
                403,
                "UNAUTHORIZED",
            ),
        };
    }

    return { ok: true };
}

// ============================================
// VERSION HASH
// ============================================

async function computeVersion(data: unknown): Promise<string> {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
}

// ============================================
// DATA FETCHERS
// ============================================

async function fetchPicklistOptions(
    scope: string[] | undefined,
    language: string,
): Promise<PicklistRow[]> {
    let query = supabase
        .from("SSP_Picklist_Config")
        .select("table_name,field_name,value,label")
        .eq("is_active", true)
        .eq("language", language);

    if (scope && scope.length > 0) {
        query = query.in("table_name", scope);
    }

    query = query
        .order("table_name", { ascending: true })
        .order("field_name", { ascending: true })
        .order("sort_order", { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as PicklistRow[];
}

async function fetchFieldMeta(
    scope: string[] | undefined,
    language: string,
): Promise<FieldMetaRow[]> {
    let query = supabase
        .from("SSP_Picklist_Field_Meta")
        .select(
            "table_name,field_name,field_label,field_placeholder,field_helper_text,input_type,is_required,is_visible,default_value,validation_regex,sort_order",
        )
        .eq("language", language)
        .eq("is_visible", true);

    if (scope && scope.length > 0) {
        query = query.in("table_name", scope);
    }

    query = query
        .order("table_name", { ascending: true })
        .order("sort_order", { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as FieldMetaRow[];
}

async function fetchBlocks(societyId: string) {
    const { data, error } = await supabase
        .from("SSP_Block")
        .select("block_id,block_name")
        .eq("society", societyId)
        .eq("active", true)
        .order("block_name", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

async function fetchTowers(societyId: string) {
    const { data, error } = await supabase
        .from("SSP_Tower")
        .select("tower_id,name")
        .eq("society", societyId)
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

// ============================================
// MERGE LOGIC
// ============================================

function buildResponse(
    options: PicklistRow[],
    meta: FieldMetaRow[],
    blocks: { block_id: string; block_name: string | null }[],
    towers: { tower_id: string; name: string | null }[],
): PicklistsByTable {
    const result: PicklistsByTable = {};

    // 1. Group options by table.field
    const optionsMap = new Map<string, PicklistOption[]>();
    for (const row of options) {
        const key = `${row.table_name}.${row.field_name}`;
        if (!optionsMap.has(key)) optionsMap.set(key, []);
        optionsMap.get(key)!.push({ value: row.value, label: row.label });
    }

    // 2. Build meta-driven structure
    for (const m of meta) {
        if (!result[m.table_name]) result[m.table_name] = {};

        const key = `${m.table_name}.${m.field_name}`;
        const options = optionsMap.get(key) ?? [];

        result[m.table_name][m.field_name] = {
            fieldLabel: m.field_label,
            fieldPlaceholder: m.field_placeholder,
            fieldHelperText: m.field_helper_text,
            inputType: m.input_type ?? "select",
            isRequired: m.is_required ?? false,
            isVisible: m.is_visible ?? true,
            defaultValue: m.default_value,
            validationRegex: m.validation_regex,
            sortOrder: m.sort_order ?? 0,
            options,
        };
    }

    // 3. Include fields that have options but no meta row (fallback)
    for (const [key, options] of optionsMap.entries()) {
        const [tableName, fieldName] = key.split(".");
        if (!result[tableName]) result[tableName] = {};
        if (!result[tableName][fieldName]) {
            result[tableName][fieldName] = {
                fieldLabel: fieldName,
                fieldPlaceholder: null,
                fieldHelperText: null,
                inputType: "select",
                isRequired: false,
                isVisible: true,
                defaultValue: null,
                validationRegex: null,
                sortOrder: 999,
                options,
            };
        }
    }

    // 4. Inject dynamic blocks & towers
    if (blocks.length > 0 || towers.length > 0) {
        if (!result["SSP_Society"]) result["SSP_Society"] = {};

        if (blocks.length > 0) {
            result["SSP_Society"]["block"] = {
                fieldLabel: "Block",
                fieldPlaceholder: "Select block",
                fieldHelperText: null,
                inputType: "select",
                isRequired: false,
                isVisible: true,
                defaultValue: null,
                validationRegex: null,
                sortOrder: 1,
                options: blocks.map((b) => ({
                    value: b.block_id,
                    label: b.block_name || "Unnamed Block",
                })),
            };
        }

        if (towers.length > 0) {
            result["SSP_Society"]["tower"] = {
                fieldLabel: "Tower",
                fieldPlaceholder: "Select tower",
                fieldHelperText: null,
                inputType: "select",
                isRequired: false,
                isVisible: true,
                defaultValue: null,
                validationRegex: null,
                sortOrder: 2,
                options: towers.map((t) => ({
                    value: t.tower_id,
                    label: t.name || "Unnamed Tower",
                })),
            };
        }
    }

    return result;
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return failResponse(
            "Only POST method is allowed.",
            405,
            "METHOD_NOT_ALLOWED",
        );
    }

    const startTime = Date.now();

    try {
        const body = (await req.json().catch(() => null)) as
            | GetPicklistsRequest
            | null;

        if (!body) {
            return failResponse(
                "Request body is required.",
                400,
                "BAD_REQUEST",
            );
        }

        const {
            societyRegistrationNumber,
            requesterId,
            scope,
            language = DEFAULT_LANGUAGE,
        } = body;

        // ── Validate ──
        if (
            !societyRegistrationNumber ||
            String(societyRegistrationNumber).trim() === ""
        ) {
            return failResponse(
                "societyRegistrationNumber is required.",
                400,
                "MISSING_PARAMETERS",
            );
        }

        if (!requesterId || String(requesterId).trim() === "") {
            return failResponse(
                "requesterId is required.",
                400,
                "MISSING_PARAMETERS",
            );
        }

        let cleanScope: string[] | undefined;
        if (scope !== undefined) {
            if (!isValidScope(scope)) {
                return failResponse(
                    "scope must be a non-empty array of table names.",
                    400,
                    "INVALID_PARAMETERS",
                );
            }
            cleanScope = scope.map((s) => String(s).trim());
        }

        const cleanLang = String(language).trim().toLowerCase() ||
            DEFAULT_LANGUAGE;

        // ── Resolve society ──
        const { data: society, error: socErr } = await supabase
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", String(societyRegistrationNumber).trim())
            .maybeSingle();

        if (socErr) throw socErr;
        if (!society) {
            return failResponse("Society not found.", 404, "NOT_FOUND");
        }

        const societyId = society.society_id;

        // ── Auth ──
        const auth = await authorizeRequester(societyId, String(requesterId));
        if (!auth.ok) return auth.response;

        // ── Parallel fetch ──
        const needsSocietyData = !cleanScope ||
            cleanScope.includes("SSP_Society");

        const [options, meta, blocks, towers] = await Promise.all([
            fetchPicklistOptions(cleanScope, cleanLang),
            fetchFieldMeta(cleanScope, cleanLang),
            needsSocietyData ? fetchBlocks(societyId) : Promise.resolve([]),
            needsSocietyData ? fetchTowers(societyId) : Promise.resolve([]),
        ]);

        // ── Build response ──
        const picklistsByTable = buildResponse(options, meta, blocks, towers);

        // ── Version hash ──
        const version = await computeVersion(picklistsByTable);

        // ── 304 support ──
        const clientETag = req.headers.get("if-none-match");
        if (clientETag && clientETag === version) {
            return notModifiedResponse(version);
        }

        const response = {
            status: "SUCCESS",
            version,
            generatedAt: new Date().toISOString(),
            language: cleanLang,
            societyId,
            scope: cleanScope ?? "all",
            picklistsByTable,
        };

        console.log(
            `✅ get-picklists: ${
                Object.keys(picklistsByTable).length
            } tables, ` +
                `${options.length} options, ${meta.length} fields, ` +
                `${blocks.length} blocks, ${towers.length} towers, ` +
                `v=${version}, ${Date.now() - startTime}ms`,
        );

        return successResponse(response, version, 200);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("❌ get-picklists error:", msg);
        return failResponse(msg, 500, "SERVER_ERROR");
    }
});
