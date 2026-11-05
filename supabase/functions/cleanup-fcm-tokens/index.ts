// // deno-lint-ignore-file no-import-prefix
// // ============================================
// // cleanup-fcm-tokens - Deep Cleanup (Cron)
// // ============================================
// // Permanently deletes SSP_User_Device rows that:
// //   1. Are inactive (is_active = false)
// //   2. Were last updated more than N days ago
// //
// // Runs on schedule via pg_cron (see SQL below).
// //
// // Auth: optional CRON_SECRET header for protection.
// // ============================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// const corsHeaders = {
//     "Access-Control-Allow-Origin": "*",
//     "Access-Control-Allow-Headers":
//         "authorization, x-client-info, apikey, content-type",
//     "Access-Control-Allow-Methods": "POST, OPTIONS",
// };

// // ── Cleanup policy ──
// const INACTIVE_RETENTION_DAYS = 90;

// // ── Optional auth (set CRON_SECRET env var to enable) ──
// const CRON_SECRET = Deno.env.get("CRON_SECRET");

// const supabase = createClient(
//     Deno.env.get("SUPABASE_URL") ?? "",
//     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// serve(async (req: Request) => {
//     if (req.method === "OPTIONS") {
//         return new Response("ok", { headers: corsHeaders });
//     }

//     // Optional secret check
//     if (CRON_SECRET) {
//         const provided = req.headers.get("x-cron-secret") ??
//             req.headers.get("authorization")?.replace("Bearer ", "");
//         if (provided !== CRON_SECRET) {
//             return new Response(
//                 JSON.stringify({
//                     status: "FAILURE",
//                     errorResponse: {
//                         errorCode: "UNAUTHORIZED",
//                         message: "Invalid or missing cron secret.",
//                     },
//                 }),
//                 {
//                     status: 401,
//                     headers: {
//                         ...corsHeaders,
//                         "Content-Type": "application/json",
//                     },
//                 },
//             );
//         }
//     }

//     const startTime = Date.now();

//     try {
//         const cutoff = new Date();
//         cutoff.setDate(cutoff.getDate() - INACTIVE_RETENTION_DAYS);
//         const cutoffIso = cutoff.toISOString();

//         console.log(
//             `🧹 Cleanup starting — cutoff: ${cutoffIso} (${INACTIVE_RETENTION_DAYS} days)`,
//         );

//         // Count first (for logging)
//         const { count: candidates, error: countErr } = await supabase
//             .from("SSP_User_Device")
//             .select("id", { count: "exact", head: true })
//             .eq("is_active", false)
//             .lt("updated_at", cutoffIso);

//         if (countErr) {
//             throw new Error(`Count failed: ${countErr.message}`);
//         }

//         console.log(`📊 Found ${candidates ?? 0} stale token(s) to delete.`);

//         if (!candidates || candidates === 0) {
//             return new Response(
//                 JSON.stringify({
//                     status: "SUCCESS",
//                     data: {
//                         deleted: 0,
//                         retentionDays: INACTIVE_RETENTION_DAYS,
//                         cutoff: cutoffIso,
//                         durationMs: Date.now() - startTime,
//                     },
//                 }),
//                 {
//                     status: 200,
//                     headers: {
//                         ...corsHeaders,
//                         "Content-Type": "application/json",
//                     },
//                 },
//             );
//         }

//         // Delete
//         const { error: deleteErr, count: deleted } = await supabase
//             .from("SSP_User_Device")
//             .delete({ count: "exact" })
//             .eq("is_active", false)
//             .lt("updated_at", cutoffIso);

//         if (deleteErr) {
//             throw new Error(`Delete failed: ${deleteErr.message}`);
//         }

//         console.log(
//             `✅ Cleanup complete: deleted ${deleted ?? 0} row(s) in ${
//                 Date.now() - startTime
//             }ms`,
//         );

//         return new Response(
//             JSON.stringify({
//                 status: "SUCCESS",
//                 data: {
//                     deleted: deleted ?? 0,
//                     retentionDays: INACTIVE_RETENTION_DAYS,
//                     cutoff: cutoffIso,
//                     durationMs: Date.now() - startTime,
//                 },
//             }),
//             {
//                 status: 200,
//                 headers: { ...corsHeaders, "Content-Type": "application/json" },
//             },
//         );
//     } catch (error: unknown) {
//         const msg = error instanceof Error ? error.message : "Unknown error";
//         console.error("❌ cleanup-fcm-tokens error:", msg);
//         return new Response(
//             JSON.stringify({
//                 status: "FAILURE",
//                 errorResponse: {
//                     errorCode: "SERVER_ERROR",
//                     message: msg,
//                 },
//             }),
//             {
//                 status: 500,
//                 headers: { ...corsHeaders, "Content-Type": "application/json" },
//             },
//         );
//     }
// });

// deno-lint-ignore-file no-import-prefix
// ============================================
// cleanup-fcm-tokens — Deep Cleanup (Cron)
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { errorResponse, successResponse } from "../_shared/response.ts";

const INACTIVE_RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;

const CRON_SECRET = Deno.env.get("CRON_SECRET");

const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: { "Access-Control-Allow-Origin": "*" },
        });
    }

    if (CRON_SECRET) {
        const provided = req.headers.get("x-cron-secret") ??
            req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (provided !== CRON_SECRET) {
            return errorResponse("Invalid or missing cron secret.", 401, {
                errorCode: "UNAUTHORIZED",
            });
        }
    }

    const startTime = Date.now();

    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - INACTIVE_RETENTION_DAYS);
        const cutoffIso = cutoff.toISOString();

        console.log(
            `Cleanup starting — cutoff=${cutoffIso} (${INACTIVE_RETENTION_DAYS}d)`,
        );

        let totalDeleted = 0;

        while (true) {
            const { data: rows, error: selErr } = await supabase
                .from("SSP_User_Device")
                .select("id")
                .eq("is_active", false)
                .lt("updated_at", cutoffIso)
                .limit(BATCH_SIZE);

            if (selErr) throw new Error(`Select failed: ${selErr.message}`);
            if (!rows || rows.length === 0) break;

            const ids = rows.map((r) => (r as { id: string }).id);
            const { error: delErr, count } = await supabase
                .from("SSP_User_Device")
                .delete({ count: "exact" })
                .in("id", ids);

            if (delErr) throw new Error(`Delete failed: ${delErr.message}`);
            totalDeleted += count ?? 0;
            if (rows.length < BATCH_SIZE) break;
        }

        console.log(
            `Cleanup done: deleted ${totalDeleted} row(s) in ${
                Date.now() - startTime
            }ms`,
        );

        return successResponse({
            deleted: totalDeleted,
            retentionDays: INACTIVE_RETENTION_DAYS,
            cutoff: cutoffIso,
            durationMs: Date.now() - startTime,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("cleanup-fcm-tokens error:", msg);
        return errorResponse(msg, 500, { errorCode: "SERVER_ERROR" });
    }
});
