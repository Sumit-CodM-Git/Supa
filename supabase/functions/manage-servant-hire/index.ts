// ============================================
// manage-servant-hire - Hire/Layoff Servant with Role Support
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

interface ManageServantHireRequest {
    societyRegistrationNumber: string;
    residentId: string;
    servantId: string;
    action: "hire" | "layoff";
    roles?: string | string[];
    isRecurring?: boolean;
    recurringDays?: string[];
}

interface HireData {
    servantId: string;
    servantName: string;
    residentId: string;
    hiredRoles: string[];
    allRoles: string[];
    isRecurring: boolean | null;
    recurringDays: string[] | null;
    hired: boolean;
}

interface HireResponse {
    status: "SUCCESS" | "FAILURE";
    message: string;
    operation: "hire" | "layoff" | "none";
    data: HireData | null;
    errorResponse: {
        errorCode: string;
        message: string;
        timestamp: string;
    } | null;
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

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Validate UUID format
 */
function isValidUUID(uuid: string): boolean {
    const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

/**
 * Normalize roles to array
 */
function normalizeRoles(roles: string | string[] | undefined): string[] {
    if (!roles) return [];

    if (Array.isArray(roles)) {
        return roles.filter((r) => r && r.trim() !== "");
    }

    if (typeof roles === "string") {
        return roles.split(/[;,]/).map((r) => r.trim()).filter((r) => r !== "");
    }

    return [];
}

/**
 * Normalize recurring days to array
 */
function normalizeRecurringDays(
    recurringDays: string | string[] | undefined,
): string[] {
    if (!recurringDays) return [];

    if (Array.isArray(recurringDays)) {
        return recurringDays.filter((day) => day && day.trim() !== "");
    }

    if (typeof recurringDays === "string") {
        return recurringDays.split(/[;,]/).map((day) => day.trim()).filter(
            (day) => day !== "",
        );
    }

    return [];
}

/**
 * Parse array field from string or JSON
 */
function parseArrayField(
    value: string | string[] | null | undefined,
): string[] {
    if (!value) return [];

    if (Array.isArray(value)) {
        return value.filter((item) => item && item.trim() !== "");
    }

    if (typeof value === "string") {
        try {
            if (value.startsWith("[") && value.endsWith("]")) {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.filter((item) => item && item.trim() !== "");
                }
            }
            return value.split(/[;,]/).map((item) => item.trim()).filter(
                (item) => item !== "",
            );
        } catch {
            return value.split(/[;,]/).map((item) => item.trim()).filter(
                (item) => item !== "",
            );
        }
    }

    return [];
}

/**
 * Get resident by ID or contact
 */
async function getResident(societyId: string, residentId: string) {
    let query = supabaseAdmin
        .from("SSP_Society_User")
        .select("user_id, role, unit_flat_number")
        .eq("society", societyId);

    if (isValidUUID(residentId)) {
        query = query.eq("user_id", residentId);
    } else {
        query = query.or(
            `contact.eq.${residentId},unit_flat_number.eq.${residentId}`,
        );
    }

    const { data, error } = await query.maybeSingle();
    return { data, error };
}

/**
 * Get servant by ID or ID proof number
 */
async function getServant(societyId: string, servantId: string) {
    let query = supabaseAdmin
        .from("SSP_Servant")
        .select("servant_id, servant_name, phone_number, role")
        .eq("society", societyId);

    if (isValidUUID(servantId)) {
        query = query.eq("servant_id", servantId);
    } else {
        query = query.eq("id_proof_number", servantId);
    }

    const { data, error } = await query.maybeSingle();
    return { data, error };
}

/**
 * Check existing relationship between resident and servant
 */
async function getExistingRelationship(residentId: string, servantId: string) {
    const { data, error } = await supabaseAdmin
        .from("SSP_Society_Servant")
        .select(
            "society_servant_id, hired, is_recurring, recurring_days, hired_roles",
        )
        .eq("society_user", residentId)
        .eq("servant_id", servantId)
        .maybeSingle();

    return { data, error };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Only allow POST method
        if (req.method !== "POST") {
            return buildErrorResponse(
                "METHOD_NOT_ALLOWED",
                "Only POST method is allowed.",
                405,
            );
        }

        // Parse request body
        const bodyText = await req.text();
        if (!bodyText || bodyText.trim() === "") {
            return buildErrorResponse(
                "BAD_REQUEST",
                "Request body is empty.",
                400,
            );
        }

        const requestData: ManageServantHireRequest = JSON.parse(bodyText);

        console.log(
            "📥 Request received:",
            JSON.stringify(requestData, null, 2),
        );

        // Validate required fields
        if (
            !requestData.societyRegistrationNumber ||
            requestData.societyRegistrationNumber.trim() === ""
        ) {
            return buildErrorResponse(
                "MISSING_PARAMETERS",
                "societyRegistrationNumber is required.",
                400,
            );
        }

        if (!requestData.residentId || requestData.residentId.trim() === "") {
            return buildErrorResponse(
                "MISSING_PARAMETERS",
                "residentId is required.",
                400,
            );
        }

        if (!requestData.servantId || requestData.servantId.trim() === "") {
            return buildErrorResponse(
                "MISSING_PARAMETERS",
                "servantId is required.",
                400,
            );
        }

        if (
            !requestData.action ||
            !["hire", "layoff"].includes(requestData.action)
        ) {
            return buildErrorResponse(
                "MISSING_PARAMETERS",
                'action must be either "hire" or "layoff".',
                400,
            );
        }

        const cleanRegNo = requestData.societyRegistrationNumber.trim();
        const cleanResidentId = requestData.residentId.trim();
        const cleanServantId = requestData.servantId.trim();
        const action = requestData.action;
        const rolesToHire = normalizeRoles(requestData.roles);

        // ============================================
        // STEP 1: Verify Society
        // ============================================
        console.log(`🔍 Verifying society: ${cleanRegNo}`);

        const { data: society, error: societyError } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id, registration_number, society_name")
            .eq("registration_number", cleanRegNo)
            .maybeSingle();

        if (societyError) {
            console.error("❌ Society verification error:", societyError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                `Society verification failed: ${societyError.message}`,
                500,
            );
        }

        if (!society) {
            return buildErrorResponse(
                "NOT_FOUND",
                `Society not found with registration number: ${cleanRegNo}`,
                404,
            );
        }

        console.log(
            `✅ Society found: ${society.society_name} (${society.society_id})`,
        );

        // ============================================
        // STEP 2: Verify Resident
        // ============================================
        console.log(`🔍 Verifying resident: ${cleanResidentId}`);

        const { data: resident, error: residentError } = await getResident(
            society.society_id,
            cleanResidentId,
        );

        if (residentError) {
            console.error("❌ Resident verification error:", residentError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                `Resident verification failed: ${residentError.message}`,
                500,
            );
        }

        if (!resident) {
            return buildErrorResponse(
                "NOT_FOUND",
                `Resident not found with ID: ${cleanResidentId}`,
                404,
            );
        }

        // Verify resident has 'Resident' role
        const roles = Array.isArray(resident.role)
            ? resident.role
            : [resident.role];
        if (!roles.some((r) => r?.toLowerCase() === "resident")) {
            return buildErrorResponse(
                "UNAUTHORIZED",
                "User is not a resident.",
                403,
            );
        }

        console.log(`✅ Resident found: ${resident.user_id}`);

        // ============================================
        // STEP 3: Verify Servant and Get All Roles
        // ============================================
        console.log(`🔍 Verifying servant: ${cleanServantId}`);

        const { data: servant, error: servantError } = await getServant(
            society.society_id,
            cleanServantId,
        );

        if (servantError) {
            console.error("❌ Servant verification error:", servantError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                `Servant verification failed: ${servantError.message}`,
                500,
            );
        }

        if (!servant) {
            return buildErrorResponse(
                "NOT_FOUND",
                `Servant not found with ID: ${cleanServantId}`,
                404,
            );
        }

        // Get servant's all roles
        const allServantRoles = parseArrayField(servant.role);
        console.log(`✅ Servant found: ${servant.servant_name}`);
        console.log(`📋 All servant roles: ${allServantRoles.join(", ")}`);

        // ============================================
        // STEP 4: Check Existing Relationship
        // ============================================
        console.log(`🔍 Checking existing relationship`);

        const { data: existingJunction, error: junctionError } =
            await getExistingRelationship(
                resident.user_id,
                servant.servant_id,
            );

        if (junctionError) {
            console.error("❌ Junction check error:", junctionError);
            return buildErrorResponse(
                "DATABASE_ERROR",
                `Failed to check existing relationship: ${junctionError.message}`,
                500,
            );
        }

        // Get existing hired roles
        const existingHiredRoles = parseArrayField(
            existingJunction?.hired_roles,
        );
        console.log(
            `📋 Existing hired roles: ${existingHiredRoles.join(", ")}`,
        );

        // ============================================
        // STEP 5: Perform Action
        // ============================================
        let operationMessage = "";
        const isRecurring = requestData.isRecurring || false;
        const recurringDays = normalizeRecurringDays(requestData.recurringDays);

        let updatedHiredRoles: string[] = [];

        if (action === "hire") {
            // Validate roles
            if (rolesToHire.length === 0) {
                return buildErrorResponse(
                    "MISSING_PARAMETERS",
                    "At least one role must be specified for hiring.",
                    400,
                );
            }

            // Validate requested roles are valid for this servant
            const invalidRoles = rolesToHire.filter(
                (r) => !allServantRoles.includes(r),
            );
            if (invalidRoles.length > 0) {
                return buildErrorResponse(
                    "INVALID_ROLES",
                    `Invalid roles for this servant: ${
                        invalidRoles.join(", ")
                    }. Available roles: ${allServantRoles.join(", ")}`,
                    400,
                );
            }

            // Validate recurring days if isRecurring is true
            if (isRecurring && recurringDays.length === 0) {
                return buildErrorResponse(
                    "MISSING_PARAMETERS",
                    "recurringDays is required when isRecurring is true.",
                    400,
                );
            }

            // Check if roles are already hired
            const alreadyHiredRoles = rolesToHire.filter((r) =>
                existingHiredRoles.includes(r)
            );
            if (alreadyHiredRoles.length > 0) {
                return buildErrorResponse(
                    "ALREADY_EXISTS",
                    `Roles already hired: ${alreadyHiredRoles.join(", ")}`,
                    400,
                );
            }

            // Add new roles to existing hired roles
            updatedHiredRoles = [...existingHiredRoles, ...rolesToHire];

            if (!existingJunction) {
                // Create new relationship
                console.log(`📝 Creating new hire relationship`);

                const { error: insertError } = await supabaseAdmin
                    .from("SSP_Society_Servant")
                    .insert({
                        society_user: resident.user_id,
                        servant_id: servant.servant_id,
                        hired: true,
                        hired_roles: updatedHiredRoles,
                        is_recurring: isRecurring,
                        recurring_days: recurringDays.length > 0
                            ? recurringDays
                            : null,
                    });

                if (insertError) {
                    console.error("❌ Insert error:", insertError);
                    return buildErrorResponse(
                        "DATABASE_ERROR",
                        `Failed to hire servant: ${insertError.message}`,
                        500,
                    );
                }

                operationMessage =
                    `Servant '${servant.servant_name}' hired for roles: ${
                        rolesToHire.join(", ")
                    }`;
                console.log(`✅ ${operationMessage}`);
            } else {
                // Update existing relationship
                console.log(`📝 Updating existing relationship`);

                const { error: updateError } = await supabaseAdmin
                    .from("SSP_Society_Servant")
                    .update({
                        hired: true,
                        hired_roles: updatedHiredRoles,
                        is_recurring: isRecurring,
                        recurring_days: recurringDays.length > 0
                            ? recurringDays
                            : null,
                    })
                    .eq(
                        "society_servant_id",
                        existingJunction.society_servant_id,
                    );

                if (updateError) {
                    console.error("❌ Update error:", updateError);
                    return buildErrorResponse(
                        "DATABASE_ERROR",
                        `Failed to update servant: ${updateError.message}`,
                        500,
                    );
                }

                operationMessage =
                    `Servant '${servant.servant_name}' hired for roles: ${
                        rolesToHire.join(", ")
                    }`;
                console.log(`✅ ${operationMessage}`);
            }

            // Build final data
            const finalData: HireData = {
                servantId: servant.servant_id,
                servantName: servant.servant_name,
                residentId: resident.user_id,
                hiredRoles: updatedHiredRoles,
                allRoles: allServantRoles,
                isRecurring: isRecurring,
                recurringDays: recurringDays.length > 0 ? recurringDays : null,
                hired: true,
            };

            // Return Response
            const response: HireResponse = {
                status: "SUCCESS",
                message: operationMessage,
                operation: action,
                data: finalData,
                errorResponse: null,
            };

            return new Response(JSON.stringify(response), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        } else if (action === "layoff") {
            if (!existingJunction) {
                return buildErrorResponse(
                    "NOT_FOUND",
                    `Servant '${servant.servant_name}' is not hired.`,
                    404,
                );
            }

            // If no specific roles provided, layoff all
            const rolesToLayoff = rolesToHire.length > 0
                ? rolesToHire
                : existingHiredRoles;

            // Check if roles are actually hired
            const notHiredRoles = rolesToLayoff.filter((r) =>
                !existingHiredRoles.includes(r)
            );
            if (notHiredRoles.length > 0) {
                return buildErrorResponse(
                    "NOT_FOUND",
                    `Roles not hired: ${
                        notHiredRoles.join(", ")
                    }. Hired roles: ${existingHiredRoles.join(", ")}`,
                    404,
                );
            }

            // Remove layoff roles from hired roles
            updatedHiredRoles = existingHiredRoles.filter((r) =>
                !rolesToLayoff.includes(r)
            );

            if (updatedHiredRoles.length === 0) {
                // No roles left, delete the relationship
                console.log(`📝 Deleting relationship (no roles left)`);

                const { error: deleteError } = await supabaseAdmin
                    .from("SSP_Society_Servant")
                    .delete()
                    .eq(
                        "society_servant_id",
                        existingJunction.society_servant_id,
                    );

                if (deleteError) {
                    console.error("❌ Delete error:", deleteError);
                    return buildErrorResponse(
                        "DATABASE_ERROR",
                        `Failed to layoff servant: ${deleteError.message}`,
                        500,
                    );
                }

                const layedOffRoles = rolesToLayoff.join(", ");
                operationMessage =
                    `Servant '${servant.servant_name}' laid off for all roles: ${layedOffRoles}`;
                console.log(`✅ ${operationMessage}`);

                const finalData: HireData = {
                    servantId: servant.servant_id,
                    servantName: servant.servant_name,
                    residentId: resident.user_id,
                    hiredRoles: [],
                    allRoles: allServantRoles,
                    isRecurring: null,
                    recurringDays: null,
                    hired: false,
                };

                const response: HireResponse = {
                    status: "SUCCESS",
                    message: operationMessage,
                    operation: action,
                    data: finalData,
                    errorResponse: null,
                };

                return new Response(JSON.stringify(response), {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                });
            } else {
                // Update with remaining roles
                console.log(`📝 Updating relationship (remaining roles)`);

                const { error: updateError } = await supabaseAdmin
                    .from("SSP_Society_Servant")
                    .update({
                        hired_roles: updatedHiredRoles,
                        is_recurring: existingJunction.is_recurring || false,
                        recurring_days: existingJunction.recurring_days || null,
                    })
                    .eq(
                        "society_servant_id",
                        existingJunction.society_servant_id,
                    );

                if (updateError) {
                    console.error("❌ Update error:", updateError);
                    return buildErrorResponse(
                        "DATABASE_ERROR",
                        `Failed to update servant: ${updateError.message}`,
                        500,
                    );
                }

                const layedOffRoles = rolesToLayoff.join(", ");
                operationMessage =
                    `Servant '${servant.servant_name}' laid off for roles: ${layedOffRoles}. Remaining roles: ${
                        updatedHiredRoles.join(", ")
                    }`;
                console.log(`✅ ${operationMessage}`);

                const finalData: HireData = {
                    servantId: servant.servant_id,
                    servantName: servant.servant_name,
                    residentId: resident.user_id,
                    hiredRoles: updatedHiredRoles,
                    allRoles: allServantRoles,
                    isRecurring: existingJunction.is_recurring || false,
                    recurringDays: existingJunction.recurring_days || null,
                    hired: true,
                };

                const response: HireResponse = {
                    status: "SUCCESS",
                    message: operationMessage,
                    operation: action,
                    data: finalData,
                    errorResponse: null,
                };

                return new Response(JSON.stringify(response), {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                });
            }
        }

        // Fallback response
        return buildErrorResponse(
            "SERVER_ERROR",
            "Unknown action performed.",
            500,
        );
    } catch (error) {
        console.error("❌ Server error:", error);
        return buildErrorResponse(
            "SERVER_ERROR",
            error instanceof Error ? error.message : "Internal server error",
            500,
        );
    }
});

// ============================================
// ERROR RESPONSE BUILDER
// ============================================

function buildErrorResponse(
    code: string,
    message: string,
    statusCode: number,
): Response {
    const response: HireResponse = {
        status: "FAILURE",
        message: message,
        operation: "none",
        data: null,
        errorResponse: {
            errorCode: code,
            message: message,
            timestamp: new Date().toISOString(),
        },
    };

    return new Response(JSON.stringify(response), {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
