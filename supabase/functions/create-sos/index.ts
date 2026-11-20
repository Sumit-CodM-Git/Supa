// deno-lint-ignore-file no-import-prefix
// ============================================
// create-sos — SOS Alert Creation (JWT-based auth)
// ============================================
// Auth: requireAuth middleware verifies the caller's JWT and
//       provides ctx.user.id = SSP_Society_User.user_id.
//
// Flow:
//   1. requireAuth extracts user_id from JWT
//   2. Parse body (category, note?, idempotencyKey?)
//   3. Look up resident profile + contact + tower + block
//   4. Insert row into SSP_SOS_Alert (status=ACTIVE)
//   5. Return sos_id
//
// The DB trigger (send_sos_push_webhook) fires automatically.
// ============================================

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const VALID_CATEGORIES = [
    "medical_emergency",
    "stuck_in_lift",
    "gas_fire",
    "theft_other",
] as const;

const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

interface CreateSosRequest {
    category: string;
    note?: string;
    idempotencyKey?: string;
}

interface SosResponseRow {
    sos_id: string;
    status: string;
    category: string;
    resident_name: string | null;
    resident_phone: string | null;
    flat_number: string | null;
    tower_name: string | null;
    block_name: string | null;
    note: string | null;
    created_at: string;
}

function buildSosResponse(
    row: SosResponseRow,
    traceId: string,
    isDuplicate: boolean,
) {
    return {
        sosId: row.sos_id,
        status: row.status,
        category: row.category,
        alertType: row.category,
        residentName: row.resident_name ?? "Resident",
        residentPhone: row.resident_phone,
        flatNumber: row.flat_number,
        towerName: row.tower_name,
        blockName: row.block_name,
        note: row.note,
        createdAt: row.created_at,
        isDuplicate,
        ...(!isDuplicate
            ? { message: "SOS raised. Emergency staff are being notified." }
            : {}),
        traceId,
    };
}

Deno.serve(
    requireAuth(async (req: Request, authCtx) => {
        if (req.method !== "POST") {
            return errorResponse("Only POST is allowed.", 405, {
                errorCode: "METHOD_NOT_ALLOWED",
            });
        }

        const startTime = Date.now();
        const traceId = crypto.randomUUID();
        const userId = authCtx.user.id; // ← SSP_Society_User.user_id from JWT

        try {
            const body = (await req.json().catch(() => null)) as
                | CreateSosRequest
                | null;
            if (!body) {
                return errorResponse("Request body required.", 400, {
                    errorCode: "BAD_REQUEST",
                    traceId,
                });
            }

            const category = String(body.category ?? "").trim();
            if (!category) {
                return errorResponse("category is required.", 400, {
                    errorCode: "MISSING_PARAMETERS",
                    traceId,
                });
            }
            if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
                return errorResponse(
                    `category must be one of: ${VALID_CATEGORIES.join(", ")}.`,
                    400,
                    { errorCode: "INVALID_PARAMETERS", traceId },
                );
            }

            const note = body.note
                ? String(body.note).trim().slice(0, 500)
                : null;
            const idempotencyKey = body.idempotencyKey
                ? String(body.idempotencyKey).trim()
                : null;

            console.log(
                `[${traceId}] create-sos user=${userId} category=${category}`,
            );

            // ── Idempotency ──
            if (idempotencyKey) {
                const { data: existing } = await supabase
                    .from("SSP_SOS_Alert")
                    .select(
                        "sos_id, status, category, resident_name, resident_phone, flat_number, tower_name, block_name, note, created_at",
                    )
                    .eq("raised_by_user", userId)
                    .eq("idempotency_key", idempotencyKey)
                    .maybeSingle();

                if (existing) {
                    return successResponse(
                        buildSosResponse(existing as SosResponseRow, traceId, true),
                    );
                }
            }

            // ── Load resident profile ──
            const { data: userRow, error: userErr } = await supabase
                .from("SSP_Society_User")
                .select(
                    "user_id, society, unit_flat_number, tower, block, contact, role, status, deleted_at",
                )
                .eq("user_id", userId)
                .maybeSingle();

            if (userErr) throw userErr;
            if (!userRow) {
                return errorResponse("User not found.", 404, {
                    errorCode: "NOT_FOUND",
                    traceId,
                });
            }

            const user = userRow as {
                user_id: string;
                society: string | null;
                unit_flat_number: string | null;
                tower: string | null;
                block: string | null;
                contact: string | null;
                role: string[] | null;
                status: boolean | null;
                deleted_at: string | null;
            };

            if (!user.society) {
                return errorResponse(
                    "User does not belong to a society.",
                    400,
                    { errorCode: "INVALID_STATE", traceId },
                );
            }
            if (user.deleted_at) {
                return errorResponse("User account is deactivated.", 403, {
                    errorCode: "FORBIDDEN",
                    traceId,
                });
            }

            // ── Contact (name + phone) ──
            let residentName = "Resident";
            let residentPhone = "";

            if (user.contact) {
                const { data: contactRow } = await supabase
                    .from("SSP_Contact")
                    .select("parking_slot, name, phone, emergency_phone")
                    .eq("contact_id", user.contact)
                    .maybeSingle();

                if (contactRow) {
                    const c = contactRow as {
                        name: string | null;
                        phone: string | null;
                        emergency_phone: string | null;
                    };
                    if (c.name) residentName = c.name;
                    if (c.phone) residentPhone = c.phone;
                    else if (c.emergency_phone) {
                        residentPhone = c.emergency_phone;
                    }
                }
            }

            // ── Tower / block ──
            let towerName: string | null = null;
            let blockName: string | null = null;

            if (user.tower) {
                const { data: towerRow } = await supabase
                    .from("SSP_Tower").select("name").eq("tower_id", user.tower)
                    .maybeSingle();
                if (towerRow) {
                    towerName = (towerRow as { name: string | null }).name;
                }
            }

            if (user.block) {
                const { data: blockRow } = await supabase
                    .from("SSP_Block").select("block_name").eq(
                        "block_id",
                        user.block,
                    ).maybeSingle();
                if (blockRow) {
                    blockName =
                        (blockRow as { block_name: string | null }).block_name;
                }
            }

            // ── Insert ──
            const insertPayload: Record<string, unknown> = {
                society: user.society,
                raised_by_user: userId,
                category,
                status: "ACTIVE",
                resident_name: residentName,
                resident_phone: residentPhone,
                flat_number: user.unit_flat_number,
                tower_name: towerName,
                block_name: blockName,
            };
            if (note) insertPayload.note = note;
            if (idempotencyKey) insertPayload.idempotency_key = idempotencyKey;

            const { data: inserted, error: insertErr } = await supabase
                .from("SSP_SOS_Alert")
                .insert(insertPayload)
                .select(
                    "sos_id, status, category, resident_name, resident_phone, flat_number, tower_name, block_name, note, created_at",
                )
                .single();

            if (insertErr) {
                if (insertErr.code === "23505" && idempotencyKey) {
                    const { data: existing } = await supabase
                        .from("SSP_SOS_Alert")
                        .select(
                            "sos_id, status, category, resident_name, resident_phone, flat_number, tower_name, block_name, note, created_at",
                        )
                        .eq("raised_by_user", userId)
                        .eq("idempotency_key", idempotencyKey)
                        .maybeSingle();

                    if (existing) {
                        return successResponse(
                            buildSosResponse(
                                existing as SosResponseRow,
                                traceId,
                                true,
                            ),
                        );
                    }
                }
                throw insertErr;
            }

            const row = inserted as SosResponseRow;

            console.log(
                `[${traceId}] SOS created: ${row.sos_id} in ${
                    Date.now() - startTime
                }ms`,
            );

            return successResponse(
                buildSosResponse(row, traceId, false),
                201,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[${traceId}] create-sos error:`, msg);
            return errorResponse(msg, 500, {
                errorCode: "SERVER_ERROR",
                traceId,
            });
        }
    }),
);
