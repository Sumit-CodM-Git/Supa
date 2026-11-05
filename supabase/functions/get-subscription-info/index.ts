// supabase/functions/subscription/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { optionalAuth, requireAuth } from "../_shared/auth.ts";
import { errorResponse, successResponse } from "../_shared/response.ts";
import { ApiError, badRequest } from "../_shared/errors.ts";
import { serviceClient } from "../_shared/subscription-utils.ts";
import { logger } from "../_shared/logger.ts";

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

// ─────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────

async function handlePlans() {
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc("list_plans");
    if (error) throw new Error(error.message);
    return toCamel(data ?? []);
}

async function handleMyPlan(userId: string) {
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc(
        "get_my_subscription_summary",
        { p_user_id: userId },
    );
    if (error) throw new Error(error.message);
    return toCamel(data);
}

async function handleHistory(userId: string, page: number, limit: number) {
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc(
        "list_my_payments",
        {
            p_user_id: userId,
            p_page: page,
            p_limit: limit,
        },
    );
    if (error) throw new Error(error.message);
    return toCamel(data);
}

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

serve(optionalAuth(async (req, ctx) => {
    if (req.method !== "GET") {
        return errorResponse("Method not allowed", 405);
    }

    try {
        const url = new URL(req.url);
        const action = (url.searchParams.get("action") ?? "plans").trim();

        switch (action) {
            // ─────────────────────────────────────
            // action=plans (public)
            // ─────────────────────────────────────
            case "plans": {
                const data = await handlePlans();
                return successResponse(data);
            }

            // ─────────────────────────────────────
            // action=myPlan (auth required)
            // ─────────────────────────────────────
            case "myPlan": {
                if (!ctx?.user?.id) {
                    return errorResponse(
                        "Authentication required for action=myPlan",
                        401,
                    );
                }
                const data = await handleMyPlan(ctx.user.id);
                return successResponse(data);
            }

            // ─────────────────────────────────────
            // action=history (auth required)
            // ─────────────────────────────────────
            case "history": {
                if (!ctx?.user?.id) {
                    return errorResponse(
                        "Authentication required for action=history",
                        401,
                    );
                }

                const page = Math.max(
                    1,
                    parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
                );
                const limit = Math.min(
                    100,
                    Math.max(
                        1,
                        parseInt(url.searchParams.get("limit") ?? "20", 10) ||
                            20,
                    ),
                );

                const data = await handleHistory(ctx.user.id, page, limit);
                return successResponse(data);
            }

            // ─────────────────────────────────────
            // Unknown action
            // ─────────────────────────────────────
            default:
                throw badRequest(
                    `Unknown action '${action}'. Valid actions: plans, myPlan, history`,
                );
        }
    } catch (err) {
        if (err instanceof ApiError) return err.toResponse();
        logger.error({
            action: "subscription",
            userId: ctx?.user?.id ?? "anonymous",
            message: err instanceof Error ? err.message : "Unknown",
        });
        return errorResponse(
            err instanceof Error ? err.message : "Unknown",
            500,
        );
    }
}));
