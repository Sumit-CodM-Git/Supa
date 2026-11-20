import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as DJWT from "https://deno.land/x/djwt@v2.8/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let notification: any = null;

  const _url = Deno.env.get("SUPABASE_URL") || "";
  const _key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // === DEBUG — env & key role ===
  console.log("DBG_ENV", JSON.stringify({
    has_url: !!_url,
    url_prefix: _url.substring(0, 40),
    key_len: _key.length,
    key_prefix: _key.substring(0, 24),
  }));

  let _role = "unparsed";
  try {
    const _p = JSON.parse(atob(_key.split(".")[1] || "e30="));
    _role = _p.role ?? "no-role-claim";
    console.log("DBG_JWT", JSON.stringify({
      role: _p.role,
      ref: _p.ref,
      iat: _p.iat,
      exp: _p.exp,
    }));
  } catch (e) {
    console.log("DBG_JWT_PARSE_FAIL", (e as Error).message);
  }
  // === END DEBUG ===

  const supabase = createClient(_url, _key);

  try {
    const body = await req.json();
    notification = body.record;

    if (!notification) throw new Error("Missing notification record.");

    if (notification.delivery_status !== "pending") {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "already processed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const notificationId = notification.notification_id;
    const recipientId = notification.recipient_id;
    const recipientType = notification.recipient_type;

    // === DEBUG — who do we think we're looking for? ===
    console.log("DBG_RECIPIENT", JSON.stringify({
      recipientId: recipientId,
      recipientId_type: typeof recipientId,
      recipientId_len: String(recipientId).length,
      recipientType: recipientType,
      notificationId: notificationId,
    }));

    // === DEBUG — can we see the table at all? ===
    const _raw = await supabase
      .from("SSP_User_Device")
      .select("id, user_id, is_active")
      .limit(5);

    console.log("DBG_RAW_QUERY", JSON.stringify({
      err: _raw.error?.message ?? null,
      row_count: _raw.data?.length ?? 0,
      rows: _raw.data,
    }));
    // === END DEBUG ===

    const recipientTypeNorm = String(recipientType).toLowerCase();
    switch (recipientTypeNorm) {
      case "resident":
      case "admin":
      case "security":
      case "serviceagent":
      case "service_agent":
      case "vendor":
        break;
      default:
        throw new Error(`Unsupported recipient type: ${recipientType}`);
    }

    //----------------------------------------------------
    // Fetch ALL active devices for the recipient
    //----------------------------------------------------
    const { data: devices, error: deviceErr } = await supabase
      .from("SSP_User_Device")
      .select("id, fcm_token, device_type")
      .eq("user_id", recipientId)
      .eq("is_active", true);

    // === DEBUG — the actual query result ===
    console.log("DBG_DEVICE_QUERY", JSON.stringify({
      err: deviceErr?.message ?? null,
      row_count: devices?.length ?? 0,
      recipientId_used: recipientId,
    }));
    // === END DEBUG ===

    if (deviceErr) throw deviceErr;

    if (!devices || devices.length === 0) {
      await supabase
        .from("SSP_Notification")
        .update({ delivery_status: "failed" })
        .eq("notification_id", notificationId);

      throw new Error(
        `Recipient ${recipientId} has no active devices in SSP_User_Device`
      );
    }

    //----------------------------------------------------
    // Get Firebase access token
    //----------------------------------------------------
    const rawSA = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!rawSA) {
      await supabase
        .from("SSP_Notification")
        .update({ delivery_status: "failed" })
        .eq("notification_id", notificationId);
      throw new Error("FIREBASE_SERVICE_ACCOUNT env var not set");
    }

    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(rawSA);
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is invalid JSON: ${err.message}`);
    }

    const accessToken = await getGoogleAccessToken(serviceAccount);
    if (!accessToken) {
      await supabase
        .from("SSP_Notification")
        .update({ delivery_status: "failed" })
        .eq("notification_id", notificationId);
      throw new Error("Unable to generate Google access token.");
    }

    //----------------------------------------------------
    // Send to each device (fan-out)
    //----------------------------------------------------
    const results: Array<{
      device_id: string;
      token: string;
      ok: boolean;
      error?: string;
      errorCode?: string;
    }> = [];

    for (const device of devices) {
      try {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: device.fcm_token,
                notification: {
                  title: notification.title ?? "",
                  body: notification.message ?? "",
                },
                data: {
                  notificationId: String(notification.notification_id ?? ""),
                  type: String(notification.notification_type ?? ""),
                  screen: String(notification.navigation_screen ?? ""),
                  referenceId: String(notification.reference_id ?? ""),
                  referenceTable: String(notification.reference_table ?? ""),
                  title: String(notification.title ?? ""),
                  body: String(notification.message ?? ""),
                },
                android: { priority: "high" },
                apns: { payload: { aps: { sound: "default" } } },
              },
            }),
          }
        );

        const result = await response.json();

        if (response.ok) {
          results.push({ device_id: device.id, token: device.fcm_token, ok: true });
        } else {
          const errCode =
            result?.error?.details?.[0]?.errorCode ||
            result?.error?.status ||
            null;

          console.error(
            `FCM failed for device ${device.id}:`,
            JSON.stringify(result)
          );

          // Deactivate unregistered/invalid tokens
          if (
            errCode === "UNREGISTERED" ||
            errCode === "NOT_FOUND" ||
            errCode === "INVALID_ARGUMENT"
          ) {
            await supabase
              .from("SSP_User_Device")
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("id", device.id);
            console.log(`Deactivated device ${device.id} (${errCode})`);
          }

          results.push({
            device_id: device.id,
            token: device.fcm_token,
            ok: false,
            error: result?.error?.message || "Firebase rejected",
            errorCode: errCode,
          });
        }
      } catch (e: any) {
        results.push({
          device_id: device.id,
          token: device.fcm_token,
          ok: false,
          error: e.message,
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    const failureCount = results.length - successCount;

    //----------------------------------------------------
    // Update delivery_status
    // - sent     → at least one device succeeded
    // - failed   → all devices failed
    //----------------------------------------------------
    const finalStatus = successCount > 0 ? "sent" : "failed";

    await supabase
      .from("SSP_Notification")
      .update({
        delivery_status: finalStatus,
        extra_data: {
          ...(notification.extra_data ?? {}),
          push_results: results, // audit trail per device
        },
      })
      .eq("notification_id", notificationId);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        devices_total: devices.length,
        success_count: successCount,
        failure_count: failureCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("send-notification error:", e);

    try {
      if (notification?.notification_id) {
        await supabase
          .from("SSP_Notification")
          .update({ delivery_status: "failed" })
          .eq("notification_id", notification.notification_id);
      }
    } catch (_) {
      // ignore
    }

    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

//----------------------------------------------------
// Google access token (unchanged)
//----------------------------------------------------
async function getGoogleAccessToken(serviceAccount: any): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const key = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");

  const binary = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const jwt = await DJWT.create(
    { alg: "RS256", typ: "JWT" },
    payload,
    cryptoKey
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(data);
    throw new Error(
      data.error_description || "Unable to obtain Google access token."
    );
  }

  return data.access_token;
}