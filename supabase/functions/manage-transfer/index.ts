// supabase/functions/manage-transfer/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import { ApiError, badRequest } from "../_shared/errors.ts";
import { serviceClient } from "../_shared/subscription-utils.ts";
import { logger } from "../_shared/logger.ts";
import { withRateLimit } from "../_shared/rate-limit.ts";

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
    action: "REQUEST" | "ACCEPT" | "CANCEL" | "LIST";
    transferType?: "SOCIETY" | "MEMBER" | "GIFT";
    toSocietyUser?: string;
    toSociety?: string;
    toTower?: string;
    toBlock?: string;
    toFlatNumber?: string;
    transferId?: string;
    reason?: string;
    filter?: "incoming" | "outgoing" | "all";
}

serve(requireAuth(
    withRateLimit(
        (userId: string) => `manage-transfer:${userId}`,
        20,
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
            let data: unknown;

            switch (action) {
                case "REQUEST": {
                    if (!body.transferType) {
                        throw badRequest(
                            "transferType is required for REQUEST",
                        );
                    }
                    const { data: d, error } = await supabase.rpc(
                        "transfer_request",
                        {
                            p_user_id: ctx.user.id,
                            p_transfer_type: body.transferType,
                            p_to_society_user: body.toSocietyUser ?? null,
                            p_to_society: body.toSociety ?? null,
                            p_to_tower: body.toTower ?? null,
                            p_to_block: body.toBlock ?? null,
                            p_to_flat_number: body.toFlatNumber ?? null,
                        },
                    );
                    if (error) throw new Error(error.message);
                    data = d;
                    break;
                }

                case "ACCEPT": {
                    if (!body.transferId) {
                        throw badRequest("transferId is required for ACCEPT");
                    }
                    const { data: d, error } = await supabase.rpc(
                        "transfer_accept",
                        {
                            p_user_id: ctx.user.id,
                            p_transfer_id: body.transferId,
                        },
                    );
                    if (error) throw new Error(error.message);
                    data = d;
                    break;
                }

                case "CANCEL": {
                    if (!body.transferId) {
                        throw badRequest("transferId is required for CANCEL");
                    }
                    const { data: d, error } = await supabase.rpc(
                        "transfer_cancel",
                        {
                            p_user_id: ctx.user.id,
                            p_transfer_id: body.transferId,
                            p_reason: body.reason ?? null,
                        },
                    );
                    if (error) throw new Error(error.message);
                    data = d;
                    break;
                }

                case "LIST": {
                    const { data: d, error } = await supabase.rpc(
                        "transfer_list",
                        {
                            p_user_id: ctx.user.id,
                            p_filter: body.filter ?? "all",
                        },
                    );
                    if (error) throw new Error(error.message);
                    data = d;
                    break;
                }

                default:
                    throw badRequest(
                        `Unknown action '${body.action}'. Valid: REQUEST, ACCEPT, CANCEL, LIST`,
                    );
            }

            if (!data?.success) {
                const reason = data?.reason ?? "Transfer operation failed";
                const status = reason.toLowerCase().includes("not found")
                    ? 404
                    : reason.toLowerCase().includes("only")
                    ? 403
                    : 400;
                return errorResponse(reason, status);
            }

            return successResponse(toCamel(data));
        } catch (err) {
            if (err instanceof ApiError) return err.toResponse();
            logger.error({
                action: "manage-transfer",
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
