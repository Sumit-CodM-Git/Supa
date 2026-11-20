import { normalizeParkingSlot } from "../_shared/contact.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Papa from "https://esm.sh/papaparse@5.4.1";
import { requireAuth, AuthContext } from "../_shared/auth.ts";
import { successResponse } from "../_shared/response.ts";
import { ApiError, ErrorCodes, handleError } from "../_shared/errors.ts";
import { validateRequired } from "../_shared/validation.ts";
import { sanitizeString, sanitizePagination } from "../_shared/sanitizer.ts";
import { ArrayHandler } from "../_shared/array-handler.ts";
import { logger } from "../_shared/logger.ts";
type CsvRow = Record<string, string>;
interface ProcessingError {
    rowNumber: number;
    entityType?: string;
    data: CsvRow;
    reason: string;
}
interface ProcessedRow {
    rowNumber: number;
    entityType: string;
    identifier: string;
    status: "success";
    parkingSlot?: string | null;
}
interface FailedReportRow extends ProcessingError {
    status: "failed";
}
type ReportItem = ProcessedRow | FailedReportRow;
Deno.serve(requireAuth(async (req: Request, _ctx: AuthContext): Promise<Response> => {
    const startTime = Date.now();
    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const contentType = req.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) {
            throw new ApiError(ErrorCodes.BAD_REQUEST, "Invalid Content-Type. Expected 'multipart/form-data'.", 400);
        }
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        if (!file) {
            throw new ApiError(ErrorCodes.BAD_REQUEST, "No file uploaded under form key 'file'.", 400);
        }
        const pageParam = formData.get("page")?.toString() ?? "1";
        const limitParam = formData.get("limit")?.toString() ?? "10";
        const entityTypeFilter = formData.get("entityType")?.toString();
        const statusFilter = formData.get("status")?.toString();
        const searchQuery = formData.get("searchQuery")?.toString();
        const { page: pageNum, limit: limitNum } = sanitizePagination(pageParam, limitParam);
        const fileText = await file.text();
        if (!validateRequired(fileText)) {
            throw new ApiError(ErrorCodes.BAD_REQUEST, "Uploaded CSV file is empty.", 400);
        }
        const parseResult = Papa.parse(fileText, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_"),
        });
        const rows: CsvRow[] = parseResult.data;
        if (!rows || rows.length === 0) {
            throw new ApiError(ErrorCodes.BAD_REQUEST, "Parsed CSV contains no valid data rows.", 400);
        }
        const { data: societies } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id, registration_number");
        const { data: towers } = await supabaseAdmin
            .from("SSP_Tower")
            .select("tower_id, name, society");
        const { data: blocks } = await supabaseAdmin
            .from("SSP_Block")
            .select("block_id, block_name, society");
        const societyRegMap = new Map<string, string>((societies || []).map((s) => [
            String(s.registration_number).trim().toLowerCase(),
            String(s.society_id),
        ]));
        const failedRows: ProcessingError[] = [];
        const successfulRows: ProcessedRow[] = [];
        let processedSocietyUsers = 0;
        let processedNonSocietyUsers = 0;
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const rowNum = index + 2;
            try {
                if (!row.entity_type) {
                    throw new Error("Missing required field 'entity_type' ('society_user' or 'non_society_user')");
                }
                const entityType = sanitizeString(row.entity_type).toLowerCase();
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
                    const parkingSlot = normalizeParkingSlot(row.parking_slot !== undefined ? row.parking_slot : row.parkingSlot);
                    if (parkingSlot !== undefined)
                        contactPayload.parking_slot = parkingSlot;
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
                    let resolvedTowerId = row.tower_id ? sanitizeString(row.tower_id) : null;
                    if (!resolvedTowerId && row.tower_name) {
                        const cleanTowerName = sanitizeString(row.tower_name).toLowerCase();
                        const matchedTower = (towers || []).find((t) => String(t.name).trim().toLowerCase() === cleanTowerName &&
                            t.society === targetSocietyId);
                        resolvedTowerId = matchedTower ? matchedTower.tower_id : null;
                    }
                    let resolvedBlockId = row.block_id ? sanitizeString(row.block_id) : null;
                    if (!resolvedBlockId && row.block_name) {
                        const cleanBlockName = sanitizeString(row.block_name).toLowerCase();
                        const matchedBlock = (blocks || []).find((b) => String(b.block_name).trim().toLowerCase() === cleanBlockName &&
                            b.society === targetSocietyId);
                        resolvedBlockId = matchedBlock ? matchedBlock.block_id : null;
                    }
                    const rolesArray = row.role
                        ? ArrayHandler.toArray(row.role)
                        : ["resident"];
                    const rawStatus = sanitizeString(row.status || "true").toLowerCase();
                    const parsedStatus = rawStatus === "true" || rawStatus === "active" || rawStatus === "1";
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
                        ...(parkingSlot !== undefined ? { parkingSlot } : {}),
                        status: "success",
                    });
                }
                else if (entityType === "non_society_user") {
                    const phoneClean = sanitizeString(row.phone || "");
                    const nameClean = sanitizeString(row.name || "");
                    if (!phoneClean || !nameClean) {
                        throw new Error("Missing mandatory fields for non-society user: 'name' or 'phone'");
                    }
                    const recurringDaysArray = row.recurring_days
                        ? ArrayHandler.toArray(row.recurring_days)
                        : null;
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
                }
                else {
                    throw new Error(`Invalid entity_type '${row.entity_type}'. Expected 'society_user' or 'non_society_user'`);
                }
            }
            catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : "Unknown processing error";
                failedRows.push({
                    rowNumber: rowNum,
                    entityType: row.entity_type ? sanitizeString(row.entity_type) : undefined,
                    data: row,
                    reason: errorMessage,
                });
            }
        }
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
            reportItems = reportItems.filter((item: ReportItem) => item.entityType?.toLowerCase() === cleanEntityFilter);
        }
        if (searchQuery) {
            const cleanSearch = sanitizeString(searchQuery).toLowerCase();
            reportItems = reportItems.filter((item: ReportItem) => {
                const rowStr = JSON.stringify(item).toLowerCase();
                return rowStr.includes(cleanSearch);
            });
        }
        const totalReportItems = reportItems.length;
        const offset = (pageNum - 1) * limitNum;
        const paginatedReport = reportItems.slice(offset, offset + limitNum);
        logger.info({
            action: "processCsvImport",
            message: `Processed ${rows.length} CSV rows. Success: ${successfulRows.length}, Failed: ${failedRows.length}`,
        });
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
    }
    catch (err: unknown) {
        return handleError(err);
    }
}));
