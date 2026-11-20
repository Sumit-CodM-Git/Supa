import { optionalAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse } from "../_shared/response.ts";
import { getPaginationParams, getSearchParams } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(optionalAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        const url = new URL(req.url);
        const path = url.pathname.replace("/get-societies", "") || "/";
        if (req.method === "GET" && (path === "/" || path === "")) {
            const { page, limit, offset } = getPaginationParams(url);
            const filters = getSearchParams(url);
            let query = supabase
                .from("SSP_Society")
                .select("society_name, registration_number, subscription_plan", {
                count: "exact",
            });
            Object.entries(filters).forEach(([key, value]) => {
                if (value && key !== "page" && key !== "limit") {
                    query = query.ilike(key, `%${value}%`);
                }
            });
            if (limit && limit > 0) {
                query = query.range(offset, offset + limit - 1);
            }
            const { data, count, error } = await query;
            if (error) {
                console.error("Database error:", error);
                return errorResponse("Failed to fetch societies", 500);
            }
            const response: any = {
                societies: data || [],
            };
            if (limit && limit > 0) {
                response.pagination = {
                    total: count || 0,
                    page,
                    limit,
                    totalPages: Math.ceil((count || 0) / limit),
                };
            }
            if (authCtx) {
                response.user = {
                    id: authCtx.user.id,
                    email: authCtx.user.email,
                };
            }
            return new Response(JSON.stringify(response), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }
        if (req.method === "GET" && path === "/me") {
            if (!authCtx) {
                return errorResponse("Authentication required", 401);
            }
            const { page, limit, offset } = getPaginationParams(url);
            const { data, count, error } = await supabase
                .from("SSP_Society")
                .select("society_name, registration_number, subscription_plan", {
                count: "exact",
            })
                .eq("created_by", authCtx.user.id)
                .range(offset, offset + limit - 1);
            if (error) {
                console.error("Database error:", error);
                return errorResponse("Failed to fetch societies", 500);
            }
            return new Response(JSON.stringify({
                societies: data || [],
                pagination: {
                    total: count || 0,
                    page,
                    limit,
                    totalPages: Math.ceil((count || 0) / limit),
                },
                user: {
                    id: authCtx.user.id,
                    email: authCtx.user.email,
                },
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }
        if (req.method === "GET" && path.startsWith("/")) {
            const id = path.substring(1);
            if (id) {
                const { data, error } = await supabase
                    .from("SSP_Society")
                    .select("society_name, registration_number, subscription_plan")
                    .eq("id", id)
                    .single();
                if (error) {
                    if (error.code === "PGRST116") {
                        return new Response(JSON.stringify({
                            error: "NOT_FOUND",
                            message: "Society not found",
                        }), {
                            headers: {
                                ...corsHeaders,
                                "Content-Type": "application/json",
                            },
                            status: 404,
                        });
                    }
                    console.error("Database error:", error);
                    return errorResponse("Failed to fetch society", 500);
                }
                return new Response(JSON.stringify({ society: data }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                    status: 200,
                });
            }
        }
        return new Response(JSON.stringify({
            error: "NOT_FOUND",
            message: "Endpoint not found",
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 404,
        });
    }
    catch (err: any) {
        console.error("Unhandled error:", err);
        return new Response(JSON.stringify({
            error: "SERVER_ERROR",
            message: err.message || "Internal server error",
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
        });
    }
}));
