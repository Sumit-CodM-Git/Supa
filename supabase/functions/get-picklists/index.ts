import { loadSocietyConfiguration, formatSocietyConfiguration, societyConfigurationVersion, type SocietyConfigurationRows } from "../_shared/society-configuration.ts";
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
const CONFIGURATION_CACHE_CONTROL = "private, no-cache, must-revalidate";

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
                CONFIGURATION_CACHE_CONTROL,
            "ETag": `"${version}"`,
        },
    });
}

function notModifiedResponse(version: string): Response {
    return new Response(null, {
        status: 304,
        headers: {
            ...corsHeaders,
            "Cache-Control":
                CONFIGURATION_CACHE_CONTROL,
            "ETag": `"${version}"`,
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

// ============================================
// MERGE LOGIC
// ============================================

function buildResponse(
    options: PicklistRow[],
    meta: FieldMetaRow[],
    configuration: SocietyConfigurationRows,
    scope?: string[],
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

    // Always replace dynamic options, including empty arrays after the last deletion.
    const blocks = configuration.blocks.map(row => ({value: row.block_id, label: row.block_name || "Unnamed Block"}));
    const towers = configuration.towers.map(row => ({value: row.tower_id, label: row.name || "Unnamed Tower"}));
    const flatTypes = configuration.flatTypes.map(row => ({value: row.flat_type_id, label: row.flat_type || "Unnamed Flat Type"}));
    const labels = (options: PicklistOption[]) => options.map(option => ({value: option.label, label: option.label}));
    function set(table: string, field: string, label: string, options: PicklistOption[]) {
        if (scope && !scope.includes(table) && table !== "SSP_Society") return;
        result[table] ??= {};
        const existing = result[table][field];
        const defaultValue = existing?.defaultValue;
        result[table][field] = {
            fieldLabel: label, fieldPlaceholder: `Select ${label.toLowerCase()}`,
            fieldHelperText: null, inputType: "select", isRequired: false,
            isVisible: true, validationRegex: null, sortOrder: 999,
            ...existing,
            defaultValue: defaultValue && options.some(option => option.value === defaultValue) ? defaultValue : null,
            options,
        };
    }
    for (const table of ["SSP_Society", "SSP_Society_User"]) {
        set(table, "block", "Block", blocks);
        set(table, "tower", "Tower", towers);
        set(table, "block_name", "Block", labels(blocks));
        set(table, "tower_name", "Tower", labels(towers));
        set(table, "flat_type", "Flat type", labels(flatTypes));
        set(table, "flat_type_id", "Flat type", flatTypes);
    }
    set("SSP_Block", "block_id", "Block", blocks);
    set("SSP_Block", "block_name", "Block", labels(blocks));
    set("SSP_Block", "tower", "Tower", towers);
    set("SSP_Tower", "tower_id", "Tower", towers);
    set("SSP_Tower", "name", "Tower", labels(towers));
    set("SSP_Tower", "block", "Block", blocks);
    set("SSP_Flat_Type", "flat_type_id", "Flat type", flatTypes);
    set("SSP_Flat_Type", "flat_type", "Flat type", labels(flatTypes));

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
        const [options, meta, configuration] = await Promise.all([
            fetchPicklistOptions(cleanScope, cleanLang),
            fetchFieldMeta(cleanScope, cleanLang),
            loadSocietyConfiguration(supabase, societyId),
        ]);
        const societyConfiguration = formatSocietyConfiguration(configuration);
        const configurationVersion = await societyConfigurationVersion(societyId, societyConfiguration);
        const picklistsByTable = buildResponse(options, meta, configuration, cleanScope);
        // Include society and scope so an ETag from a different society cannot validate this response.
        const version = await computeVersion({societyId, language: cleanLang, scope: cleanScope ?? "all", picklistsByTable, societyConfiguration});
        const clientETag = req.headers.get("if-none-match");
        if (clientETag?.split(",").some(tag => tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "") === version)) {
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
            societyConfiguration,
            configurationVersion,
            // Global creation choices are separate from the society's configured filter values.
            flatTypeCatalog: options.filter(row => row.table_name === "SSP_Flat_Type" && row.field_name === "flat_type")
                .map(row => ({value: row.value, label: row.label})),
        };

        console.log(
            `✅ get-picklists: ${
                Object.keys(picklistsByTable).length
            } tables, ` +
                `${options.length} options, ${meta.length} fields, ` +
                `${configuration.blocks.length} blocks, ${configuration.towers.length} towers, ` +
                `v=${version}, ${Date.now() - startTime}ms`,
        );

        return successResponse(response, version, 200);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("❌ get-picklists error:", msg);
        return failResponse(msg, 500, "SERVER_ERROR");
    }
});
