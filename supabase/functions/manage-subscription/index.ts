// supabase/functions/manage-subscription/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import { ApiError, badRequest } from "../_shared/errors.ts";
import {
    getFlatForUser,
    serviceClient,
} from "../_shared/subscription-utils.ts";
import { logger } from "../_shared/logger.ts";
import { withRateLimit } from "../_shared/rate-limit.ts";

// ─────────────────────────────────────────────
// Inline snake → camel converter
// ─────────────────────────────────────────────
function toCamel<T = unknown>(input: unknown): T {
    if (input === null || input === undefined) return input as T;
    if (Array.isArray(input)) {
        return input.map((item) => toCamel(item)) as unknown as T;
    }
    if (typeof input === "object" && !(input instanceof Date)) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
            const camelKey = k.replace(
                /_([a-z0-9])/g,
                (_, c: string) => c.toUpperCase(),
            );
            out[camelKey] = toCamel(v);
        }
        return out as T;
    }
    return input as T;
}

interface RequestBody {
    action: "ACTIVATE_FREE" | "CANCEL";
    reason?: string;
}

serve(requireAuth(
    withRateLimit(
        (userId: string) => `manage-subscription:${userId}`,
        10,
        60,
    )(async (req, ctx) => {
        if (req.method !== "POST") {
            return errorResponse("Method not allowed", 405);
        }

        try {
            const body = await req.json() as RequestBody;
            if (!body.action) throw badRequest("action is required");

            const action = body.action.toUpperCase();
            const supabase = serviceClient();
            let data: Record<string, unknown>;

            switch (action) {
                // ─────────────────────────────────────────────
                // ACTIVATE_FREE — start Free plan (or idempotent if exists)
                // ─────────────────────────────────────────────
                case "ACTIVATE_FREE": {
                    const flat = await getFlatForUser(supabase, ctx.user.id);
                    if (!flat) {
                        throw badRequest(
                            "Your flat is not configured. Contact your society admin.",
                        );
                    }

                    const { data: d, error } = await supabase.rpc(
                        "activate_free_plan",
                        {
                            p_user_id: ctx.user.id,
                            p_society: flat.society,
                            p_tower: flat.tower,
                            p_block: flat.block,
                            p_flat: flat.flatNumber,
                        },
                    );

                    if (error) throw new Error(error.message);
                    if (!d?.success) {
                        return errorResponse(
                            d?.reason ?? "Could not activate free plan",
                            403,
                        );
                    }

                    data = {
                        ...d,
                        action: "ACTIVATE_FREE",
                    };
                    break;
                }

                // ─────────────────────────────────────────────
                // CANCEL — stop subscription
                // ─────────────────────────────────────────────
                case "CANCEL": {
                    let reason: string | null = null;
                    if (typeof body.reason === "string") {
                        const trimmed = body.reason.trim();
                        if (trimmed.length > 0) {
                            reason = trimmed.length > 500
                                ? trimmed.slice(0, 500)
                                : trimmed;
                        }
                    }

                    const { data: d, error } = await supabase.rpc(
                        "cancel_my_subscription",
                        {
                            p_user_id: ctx.user.id,
                            p_reason: reason,
                        },
                    );

                    if (error) throw new Error(error.message);
                    if (!d?.success) {
                        const reason_ = d?.reason ??
                            "Could not cancel subscription";
                        const status =
                            reason_.toLowerCase().includes("no subscription")
                                ? 404
                                : reason_.toLowerCase().includes(
                                        "only the subscription owner",
                                    )
                                ? 403
                                : 400;
                        return errorResponse(reason_, status);
                    }

                    data = {
                        ...d,
                        action: "CANCEL",
                    };
                    break;
                }

                default:
                    throw badRequest(
                        `Unknown action '${body.action}'. Valid: ACTIVATE_FREE, CANCEL`,
                    );
            }

            return successResponse(toCamel(data));
        } catch (err) {
            if (err instanceof ApiError) return err.toResponse();
            logger.error({
                action: "manage-subscription",
                userId: ctx.user.id,
                message: err instanceof Error ? err.message : "Unknown",
            });
            return errorResponse(
                err instanceof Error ? err.message : "Unknown",
                500,
            );
        }
    }),
));
