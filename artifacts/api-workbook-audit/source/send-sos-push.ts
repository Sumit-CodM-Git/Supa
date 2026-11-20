import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { sendFcmToStaff, sendFcmToUser } from "../_shared/fcm.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
interface RawSosRecord {
    sosId?: string;
    sos_id?: string;
    society: string;
    raisedByUser?: string;
    raised_by_user?: string;
    category: string;
    status?: string;
    residentName?: string;
    resident_name?: string;
    residentPhone?: string;
    resident_phone?: string;
    flatNumber?: string | null;
    flat_number?: string | null;
    towerName?: string | null;
    tower_name?: string | null;
    blockName?: string | null;
    block_name?: string | null;
    createdAt?: string;
    created_at?: string;
}
interface SosRow {
    sos_id: string;
    society: string;
    raised_by_user: string | null;
    category: string;
    status: string;
    resident_name: string | null;
    resident_phone: string | null;
    flat_number: string | null;
    tower_name: string | null;
    block_name: string | null;
    created_at: string | null;
    push_attempts: number;
    push_completed_at: string | null;
}
interface StaffRow {
    staff_id: string;
    staff_name: string;
    staff_role: string;
    phone_number: string;
    alternate_phone: string | null;
    shift_timing: string | null;
    availability_status: string | null;
    emergency_category: string[] | null;
}
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const CONCURRENCY = 20;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_PER_MINUTE = 30;
const SEVERITY_MAP: Record<string, "critical" | "high"> = {
    gas_fire: "critical",
    medical_emergency: "critical",
    stuck_in_lift: "high",
    theft_other: "high",
};
function categoryLabel(c: string): string {
    return String(c).toUpperCase().replace(/_/g, " ");
}
function severityFor(cat: string): "critical" | "high" {
    return SEVERITY_MAP[cat] ?? "high";
}
function normalize(raw: RawSosRecord) {
    return {
        sosId: String(raw.sosId ?? raw.sos_id ?? "").trim(),
        society: String(raw.society ?? "").trim(),
        raisedByUser: String(raw.raisedByUser ?? raw.raised_by_user ?? "").trim(),
        category: String(raw.category ?? "").trim(),
        status: String(raw.status ?? "ACTIVE").trim().toUpperCase(),
    };
}
function buildStaffBody(sos: {
    residentName: string;
    flatNumber: string | null;
    towerName: string | null;
    blockName: string | null;
    residentPhone: string;
}): string {
    const lines: string[] = [];
    lines.push(sos.residentName || "Resident");
    const loc = [sos.flatNumber, sos.towerName, sos.blockName].filter(Boolean)
        .join(", ");
    if (loc)
        lines.push(loc);
    if (sos.residentPhone)
        lines.push(`Phone: ${sos.residentPhone}`);
    lines.push("Tap to respond");
    return lines.join("\n");
}
async function writeAuditLog(traceId: string, payload: {
    sosId: string;
    staffId: string | null;
    recipientType: "staff" | "resident";
    status: "SENT" | "FAILED" | "NO_DEVICE" | "DEACTIVATED" | "SKIPPED";
    totalDevices: number;
    sent: number;
    failed: number;
    deactivated: number;
    reason: string | null;
}): Promise<void> {
    const { error } = await supabase.rpc("log_sos_notification", {
        p_sos_id: payload.sosId,
        p_staff_id: payload.staffId,
        p_recipient_type: payload.recipientType,
        p_status: payload.status,
        p_total_devices: payload.totalDevices,
        p_sent_count: payload.sent,
        p_failed_count: payload.failed,
        p_deactivated_count: payload.deactivated,
        p_reason: payload.reason,
    });
    if (error) {
        console.error(`[${traceId}] log_sos_notification failed: ${error.message}`);
    }
}
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return errorResponse("Only POST is allowed.", 405, {
            errorCode: "METHOD_NOT_ALLOWED",
        });
    }
    const startTime = Date.now();
    const traceId = crypto.randomUUID();
    try {
        const payload = await req.json().catch(() => null);
        if (!payload) {
            return errorResponse("Invalid JSON body.", 400, {
                errorCode: "BAD_REQUEST",
                traceId,
            });
        }
        const rawRecord: RawSosRecord = payload?.record ?? payload;
        const sos = normalize(rawRecord);
        if (!sos.sosId) {
            return errorResponse("Missing sosId.", 400, {
                errorCode: "MISSING_PARAMETERS",
                traceId,
            });
        }
        if (!sos.society) {
            return errorResponse("Missing society.", 400, {
                errorCode: "MISSING_PARAMETERS",
                traceId,
            });
        }
        if (!sos.category) {
            return errorResponse("Missing category.", 400, {
                errorCode: "MISSING_PARAMETERS",
                traceId,
            });
        }
        console.log(`[${traceId}] SOS start id=${sos.sosId} society=${sos.society} category=${sos.category} status=${sos.status}`);
        const { data: dbRow, error: dbErr } = await supabase
            .from("SSP_SOS_Alert")
            .select("sos_id, society, raised_by_user, category, status, resident_name, resident_phone, flat_number, tower_name, block_name, created_at, push_attempts, push_completed_at")
            .eq("sos_id", sos.sosId)
            .maybeSingle();
        if (dbErr)
            throw dbErr;
        if (!dbRow) {
            return errorResponse("SOS not found.", 404, {
                errorCode: "NOT_FOUND",
                traceId,
            });
        }
        const row = dbRow as SosRow;
        if (row.society !== sos.society) {
            return errorResponse("Payload society does not match DB.", 409, {
                errorCode: "CONFLICT",
                traceId,
            });
        }
        if (row.category !== sos.category) {
            return errorResponse("Payload category does not match DB.", 409, {
                errorCode: "CONFLICT",
                traceId,
            });
        }
        const statusUpper = String(row.status || "").toUpperCase();
        if (statusUpper !== "ACTIVE") {
            console.log(`[${traceId}] Status=${statusUpper} — skipping dispatch`);
            await supabase.from("SSP_SOS_Alert")
                .update({ push_skipped_reason: `status=${statusUpper}` })
                .eq("sos_id", sos.sosId);
            return successResponse({
                sosId: sos.sosId,
                message: `Status ${statusUpper} — skipped.`,
            });
        }
        const { data: rateLimit, error: rlErr } = await supabase
            .rpc("sos_rate_limit_check", {
            p_society: row.society,
            p_window_seconds: 60,
            p_max: RATE_LIMIT_PER_MINUTE,
        })
            .maybeSingle();
        if (rlErr) {
            console.warn(`[${traceId}] Rate limit check failed: ${rlErr.message} — proceeding`);
        }
        else if (rateLimit && (rateLimit as {
            allowed: boolean;
        }).allowed === false) {
            console.warn(`[${traceId}] Rate limit exceeded`);
            await supabase.from("SSP_SOS_Alert")
                .update({
                push_skipped_reason: `rate_limited:${(rateLimit as {
                    current_count: number;
                }).current_count}/min`,
            })
                .eq("sos_id", sos.sosId);
            return errorResponse("Too many SOS alerts for this society.", 429, {
                errorCode: "RATE_LIMITED",
                traceId,
            });
        }
        const { data: claimRow, error: claimErr } = await supabase
            .rpc("claim_sos_push", {
            p_sos_id: sos.sosId,
            p_max_attempts: MAX_ATTEMPTS,
        })
            .maybeSingle();
        if (claimErr)
            throw claimErr;
        const claim = claimRow as {
            claimed: boolean;
            attempt: number;
            reason: string;
        } | null;
        if (!claim || claim.claimed === false) {
            const reason = claim?.reason ?? "unknown";
            console.log(`[${traceId}] Claim skipped: reason=${reason}`);
            return successResponse({
                sosId: sos.sosId,
                message: `Not dispatched: ${reason}`,
                attempt: claim?.attempt ?? 0,
            });
        }
        console.log(`[${traceId}] Claimed attempt=${claim.attempt}`);
        const residentName = row.resident_name ||
            String(rawRecord.residentName ?? rawRecord.resident_name ?? "") ||
            "Resident";
        const residentPhone = row.resident_phone ||
            String(rawRecord.residentPhone ?? rawRecord.resident_phone ?? "") || "";
        const flatNumber = row.flat_number ?? rawRecord.flatNumber ??
            rawRecord.flat_number ?? null;
        const towerName = row.tower_name ?? rawRecord.towerName ??
            rawRecord.tower_name ?? null;
        const blockName = row.block_name ?? rawRecord.blockName ??
            rawRecord.block_name ?? null;
        const { data: staffList, error: staffErr } = await supabase
            .from("SSP_Society_Staff")
            .select("staff_id, staff_name, staff_role, phone_number, alternate_phone, shift_timing, availability_status, emergency_category")
            .eq("society_id", row.society)
            .eq("is_emergency_contact", true)
            .contains("emergency_category", [row.category])
            .or("availability_status.is.null,availability_status.ilike.available");
        if (staffErr)
            throw staffErr;
        const severity = severityFor(row.category);
        const highPriority = severity === "critical";
        const title = `${highPriority ? "🚨" : "⚠️"} SOS — ${categoryLabel(row.category)}`;
        const body = buildStaffBody({
            residentName,
            residentPhone,
            flatNumber,
            towerName,
            blockName,
        });
        if (!staffList || staffList.length === 0) {
            console.log(`[${traceId}] No staff available`);
            let residentNotified = false;
            if (row.raised_by_user) {
                const resSummary = await sendFcmToUser(supabase, row.raised_by_user, {
                    title: "⚠️ No responders online",
                    body: "No emergency staff are currently available. Please call the society office immediately.",
                    highPriority: true,
                    data: {
                        sosId: row.sos_id,
                        type: "SOS_NO_STAFF",
                        deepLink: `app://sos/${row.sos_id}`,
                    },
                }, "society_user");
                residentNotified = resSummary.sent > 0;
                await writeAuditLog(traceId, {
                    sosId: row.sos_id,
                    staffId: null,
                    recipientType: "resident",
                    status: residentNotified
                        ? "SENT"
                        : (resSummary.totalTokens === 0 ? "NO_DEVICE" : "FAILED"),
                    totalDevices: resSummary.totalTokens,
                    sent: resSummary.sent,
                    failed: resSummary.failed,
                    deactivated: resSummary.deactivated,
                    reason: "no_staff_available",
                });
            }
            await supabase.from("SSP_SOS_Alert")
                .update({
                push_skipped_reason: "no_available_staff",
                resident_notified_at: residentNotified
                    ? new Date().toISOString()
                    : null,
                push_completed_at: new Date().toISOString(),
            })
                .eq("sos_id", row.sos_id);
            return successResponse({
                sosId: row.sos_id,
                category: row.category,
                staffCount: 0,
                residentNotified,
                message: "No staff available; resident notified.",
                traceId,
            });
        }
        console.log(`[${traceId}] Dispatching to ${staffList.length} staff`);
        const staffDetails: Array<Record<string, unknown>> = [];
        let totalDevices = 0, totalSent = 0, totalFailed = 0, totalDeactivated = 0;
        for (let i = 0; i < staffList.length; i += CONCURRENCY) {
            const chunk = (staffList as StaffRow[]).slice(i, i + CONCURRENCY);
            const results = await Promise.all(chunk.map(async (staff) => {
                const summary = await sendFcmToStaff(supabase, staff.staff_id, {
                    title,
                    body,
                    highPriority,
                    data: {
                        sosId: row.sos_id,
                        category: row.category,
                        severity,
                        residentPhone: residentPhone || "",
                        type: "SOS_ALERT",
                        deepLink: `app://sos/${row.sos_id}`,
                    },
                });
                const logStatus = summary.totalTokens === 0
                    ? "NO_DEVICE"
                    : summary.sent > 0
                        ? "SENT"
                        : summary.deactivated > 0
                            ? "DEACTIVATED"
                            : "FAILED";
                await writeAuditLog(traceId, {
                    sosId: row.sos_id,
                    staffId: staff.staff_id,
                    recipientType: "staff",
                    status: logStatus,
                    totalDevices: summary.totalTokens,
                    sent: summary.sent,
                    failed: summary.failed,
                    deactivated: summary.deactivated,
                    reason: null,
                });
                return { staff, summary };
            }));
            for (const { staff, summary } of results) {
                totalDevices += summary.totalTokens;
                totalSent += summary.sent;
                totalFailed += summary.failed;
                totalDeactivated += summary.deactivated;
                staffDetails.push({
                    staffId: staff.staff_id,
                    staffName: staff.staff_name,
                    staffRole: staff.staff_role,
                    phoneNumber: staff.phone_number,
                    alternatePhone: staff.alternate_phone,
                    shiftTiming: staff.shift_timing,
                    availabilityStatus: staff.availability_status,
                    emergencyCategory: staff.emergency_category,
                    delivery: {
                        totalDevices: summary.totalTokens,
                        sent: summary.sent,
                        failed: summary.failed,
                        deactivated: summary.deactivated,
                    },
                });
            }
        }
        let residentNotified = false;
        if (row.raised_by_user && totalSent > 0) {
            const resSummary = await sendFcmToUser(supabase, row.raised_by_user, {
                title: "✅ Responders notified",
                body: `${totalSent} device${totalSent === 1 ? "" : "s"} alerted. Help is on the way.`,
                highPriority: false,
                data: {
                    sosId: row.sos_id,
                    type: "SOS_ACK",
                    deepLink: `app://sos/${row.sos_id}`,
                },
            }, "society_user");
            residentNotified = resSummary.sent > 0;
            await writeAuditLog(traceId, {
                sosId: row.sos_id,
                staffId: null,
                recipientType: "resident",
                status: residentNotified
                    ? "SENT"
                    : (resSummary.totalTokens === 0 ? "NO_DEVICE" : "FAILED"),
                totalDevices: resSummary.totalTokens,
                sent: resSummary.sent,
                failed: resSummary.failed,
                deactivated: resSummary.deactivated,
                reason: "acknowledgment",
            });
        }
        const { error: completeErr } = await supabase.rpc("complete_sos_push", {
            p_sos_id: row.sos_id,
        });
        if (completeErr) {
            console.error(`[${traceId}] complete_sos_push failed: ${completeErr.message}`);
        }
        console.log(`[${traceId}] Done: ${totalSent}/${totalDevices} sent, ${totalDeactivated} deactivated, resident=${residentNotified}, ${Date.now() - startTime}ms`);
        return successResponse({
            sosId: row.sos_id,
            category: row.category,
            severity,
            staffCount: staffList.length,
            totalDevices,
            notificationsSent: totalSent,
            notificationsFailed: totalFailed,
            tokensDeactivated: totalDeactivated,
            residentNotified,
            staffDetails,
            traceId,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[${traceId}] send-sos-push fatal:`, msg);
        return errorResponse(msg, 500, { errorCode: "SERVER_ERROR", traceId });
    }
});
