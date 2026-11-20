import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { errorResponse, successResponse } from "../_shared/response.ts";
const INACTIVE_RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
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
        console.log(`Cleanup starting — cutoff=${cutoffIso} (${INACTIVE_RETENTION_DAYS}d)`);
        let totalDeleted = 0;
        while (true) {
            const { data: rows, error: selErr } = await supabase
                .from("SSP_User_Device")
                .select("id")
                .eq("is_active", false)
                .lt("updated_at", cutoffIso)
                .limit(BATCH_SIZE);
            if (selErr)
                throw new Error(`Select failed: ${selErr.message}`);
            if (!rows || rows.length === 0)
                break;
            const ids = rows.map((r) => (r as {
                id: string;
            }).id);
            const { error: delErr, count } = await supabase
                .from("SSP_User_Device")
                .delete({ count: "exact" })
                .in("id", ids);
            if (delErr)
                throw new Error(`Delete failed: ${delErr.message}`);
            totalDeleted += count ?? 0;
            if (rows.length < BATCH_SIZE)
                break;
        }
        console.log(`Cleanup done: deleted ${totalDeleted} row(s) in ${Date.now() - startTime}ms`);
        return successResponse({
            deleted: totalDeleted,
            retentionDays: INACTIVE_RETENTION_DAYS,
            cutoff: cutoffIso,
            durationMs: Date.now() - startTime,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("cleanup-fcm-tokens error:", msg);
        return errorResponse(msg, 500, { errorCode: "SERVER_ERROR" });
    }
});
