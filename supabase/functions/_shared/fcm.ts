// deno-lint-ignore-file no-import-prefix
// ============================================
// _shared/fcm.ts - Firebase Cloud Messaging Helper
// ============================================
// Provides:
//   • sendFcmToUser()      → society_user tokens (residents, admins)
//   • sendFcmToStaff()     → staff tokens (guards, technicians)
//   • sendFcmToVendor()    → vendor tokens (future-ready)
//   • sendFcmToTokens()    → arbitrary token list
//   • Auto-cleanup: marks tokens inactive on FCM errors
//   • Retry: transient network errors are retried with backoff
//
// Usage:
//   import { sendFcmToUser, sendFcmToStaff } from "../_shared/fcm.ts";
//   await sendFcmToUser(supabase, userId, { title, body });
//   await sendFcmToStaff(supabase, staffId, { title, body });
// ============================================

import * as DJWT from "https://deno.land/x/djwt@v2.8/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================

export type FcmUserType = "society_user" | "staff" | "vendor";

export interface FcmNotification {
    title: string;
    body: string;
    data?: Record<string, string>; // custom payload
    imageUrl?: string; // rich notification
    /** High priority for emergencies (SOS, alerts). Default: normal. */
    highPriority?: boolean;
}

export interface FcmSendResult {
    token: string;
    ok: boolean;
    messageId?: string;
    errorCode?: string;
    errorMessage?: string;
    /** true if the token was found to be stale and marked inactive */
    deactivated?: boolean;
}

export interface FcmUserSendSummary {
    userId: string;
    userType: FcmUserType;
    totalTokens: number;
    sent: number;
    failed: number;
    deactivated: number;
    results: FcmSendResult[];
}

interface DeviceRow {
    id: string;
    fcm_token: string;
}

interface ServiceAccount {
    project_id: string;
    client_email: string;
    private_key: string;
}

interface FcmErrorResponse {
    error?: {
        status?: string;
        message?: string;
        details?: Array<{ errorCode?: string }>;
    };
}

// ============================================
// CONSTANTS
// ============================================

/**
 * FCM error codes that indicate the token is permanently dead.
 * We should mark these tokens inactive (auto-cleanup).
 */
const STALE_TOKEN_CODES = new Set([
    "UNREGISTERED",
    "SENDER_ID_MISMATCH",
    "NOT_FOUND",
]);

/**
 * HTTP status codes from FCM that are worth retrying (transient).
 * 429 Too Many Requests, 500 Internal, 502/503/504 gateway issues.
 */
const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// Cache the Google access token in memory (per function instance)
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

// ============================================
// RETRY HELPER
// ============================================

/**
 * Retry an async function with exponential backoff.
 * Default: 3 attempts total, delays of 250ms and 1s between them.
 *
 * Only the throwing path is retried. If `fn` returns normally (even with
 * an error inside the response), it is NOT retried — the caller decides.
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    attempts = 3,
    baseDelayMs = 250,
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) {
                const delay = baseDelayMs * Math.pow(4, i); // 250ms → 1s
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

/**
 * Fetch a URL with retry on transient network errors.
 * Returns the Response on success (HTTP 4xx/5xx are still returned —
 * caller decides whether to retry based on status).
 */
async function fetchWithRetry(
    url: string,
    init: RequestInit,
    attempts = 3,
): Promise<Response> {
    return await withRetry(async () => {
        const res = await fetch(url, init);
        // Retry on transient server errors
        if (RETRYABLE_HTTP_STATUS.has(res.status) && attempts > 1) {
            throw new Error(`Transient HTTP ${res.status}`);
        }
        return res;
    }, attempts);
}

// ============================================
// GOOGLE OAUTH TOKEN (cached)
// ============================================

async function getGoogleAccessToken(
    serviceAccount: ServiceAccount,
): Promise<string> {
    // Return cached token if still valid (with 5-min buffer)
    if (
        cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 300_000
    ) {
        return cachedAccessToken.token;
    }

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;

    const jwtPayload = {
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        exp,
        iat,
    };

    const pemContents = serviceAccount.private_key
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace(/\s+/g, "");

    const binaryDer = Uint8Array.from(
        atob(pemContents),
        (c) => c.charCodeAt(0),
    );

    const cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
    );

    const jwtAssertion = await DJWT.create(
        { alg: "RS256", typ: "JWT" },
        jwtPayload,
        cryptoKey,
    );

    const response = await fetchWithRetry(
        "https://oauth2.googleapis.com/token",
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: jwtAssertion,
            }),
        },
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Google OAuth failed: ${response.status} ${err}`);
    }

    const data = await response.json();
    const accessToken = data.access_token as string;

    // Cache until 55 minutes from now (5-min buffer before expiry)
    cachedAccessToken = {
        token: accessToken,
        expiresAt: Date.now() + 55 * 60 * 1000,
    };

    return accessToken;
}

// ============================================
// SERVICE ACCOUNT LOADER
// ============================================

function loadServiceAccount(): ServiceAccount {
    const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret.");
    }
    try {
        return JSON.parse(raw) as ServiceAccount;
    } catch (e) {
        throw new Error(
            `Failed to parse FIREBASE_SERVICE_ACCOUNT: ${
                e instanceof Error ? e.message : "unknown"
            }`,
        );
    }
}

// ============================================
// SEND TO SINGLE TOKEN
// ============================================

async function sendToSingleToken(
    fcmEndpoint: string,
    accessToken: string,
    fcmToken: string,
    notification: FcmNotification,
): Promise<FcmSendResult> {
    const isHighPriority = notification.highPriority === true;

    const message: Record<string, unknown> = {
        token: fcmToken,
        notification: {
            title: notification.title,
            body: notification.body,
        },
    };

    if (notification.imageUrl) {
        (message.notification as Record<string, unknown>).image =
            notification.imageUrl;
    }

    if (notification.data && Object.keys(notification.data).length > 0) {
        message.data = notification.data;
    }

    // Android-specific
    message.android = {
        priority: isHighPriority ? "HIGH" : "NORMAL",
        notification: {
            sound: "default",
            channel_id: isHighPriority ? "emergency" : "default",
        },
    };

    // iOS-specific
    message.apns = {
        headers: {
            "apns-priority": isHighPriority ? "10" : "5",
        },
        payload: {
            aps: {
                sound: "default",
                badge: 1,
                "content-available": 1,
            },
        },
    };

    try {
        const res = await fetchWithRetry(fcmEndpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ message }),
        });

        const json = (await res.json()) as FcmErrorResponse & { name?: string };

        if (!res.ok) {
            return {
                token: fcmToken,
                ok: false,
                errorCode: json?.error?.details?.[0]?.errorCode ??
                    json?.error?.status ?? "UNKNOWN",
                errorMessage: json?.error?.message ?? "FCM rejected the token",
            };
        }

        return {
            token: fcmToken,
            ok: true,
            messageId: json?.name,
        };
    } catch (error: unknown) {
        return {
            token: fcmToken,
            ok: false,
            errorCode: "NETWORK_ERROR",
            errorMessage: error instanceof Error ? error.message : "Unknown",
        };
    }
}

// ============================================
// PUBLIC: sendFcmToTokens
// ============================================

/**
 * Send a notification to a specific list of tokens (with auto-cleanup).
 * For each stale token, its row is marked inactive.
 */
export async function sendFcmToTokens(
    supabase: SupabaseClient,
    tokens: string[],
    notification: FcmNotification,
): Promise<FcmSendResult[]> {
    if (!tokens || tokens.length === 0) return [];

    const serviceAccount = loadServiceAccount();
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const fcmEndpoint =
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    // Send to all tokens in parallel
    const results = await Promise.all(
        tokens.map((token) =>
            sendToSingleToken(fcmEndpoint, accessToken, token, notification)
        ),
    );

    // ── Auto-cleanup: deactivate stale tokens in one batch update ──
    const staleTokens: string[] = [];
    for (const r of results) {
        if (!r.ok && r.errorCode && STALE_TOKEN_CODES.has(r.errorCode)) {
            staleTokens.push(r.token);
            r.deactivated = true;
        }
    }

    if (staleTokens.length > 0) {
        const { error: cleanupErr } = await supabase
            .from("SSP_User_Device")
            .update({
                is_active: false,
                updated_at: new Date().toISOString(),
            })
            .in("fcm_token", staleTokens);

        if (cleanupErr) {
            console.error(
                `⚠️ Auto-cleanup failed for ${staleTokens.length} tokens: ${cleanupErr.message}`,
            );
        } else {
            console.log(
                `🧹 Auto-cleanup: deactivated ${staleTokens.length} stale token(s).`,
            );
        }
    }

    return results;
}

// ============================================
// PUBLIC: sendFcmToUser
// ============================================

/**
 * Fetch all active tokens for a user/staff/vendor and send the
 * notification to each of their devices.
 * Includes built-in auto-cleanup of stale tokens.
 *
 * @param userType default: 'society_user'
 */
export async function sendFcmToUser(
    supabase: SupabaseClient,
    userId: string,
    notification: FcmNotification,
    userType: FcmUserType = "society_user",
): Promise<FcmUserSendSummary> {
    const summary: FcmUserSendSummary = {
        userId,
        userType,
        totalTokens: 0,
        sent: 0,
        failed: 0,
        deactivated: 0,
        results: [],
    };

    if (!userId) return summary;

    // Fetch active tokens for this user + type
    const { data: devices, error: fetchErr } = await supabase
        .from("SSP_User_Device")
        .select("id, fcm_token")
        .eq("user_id", userId)
        .eq("user_type", userType)
        .eq("is_active", true);

    if (fetchErr) {
        console.error(
            `❌ Token fetch failed for ${userType}:${userId}: ${fetchErr.message}`,
        );
        return summary;
    }

    const rows = (devices ?? []) as DeviceRow[];
    summary.totalTokens = rows.length;

    if (rows.length === 0) {
        console.log(`📭 No active tokens for ${userType}:${userId}.`);
        return summary;
    }

    const tokens = rows.map((r) => r.fcm_token);
    const results = await sendFcmToTokens(supabase, tokens, notification);

    summary.results = results;
    for (const r of results) {
        if (r.ok) summary.sent++;
        else summary.failed++;
        if (r.deactivated) summary.deactivated++;
    }

    console.log(
        `📨 Notified ${userType}:${userId}: ${summary.sent}/${summary.totalTokens} sent, ` +
            `${summary.deactivated} deactivated.`,
    );

    return summary;
}

// ============================================
// PUBLIC: sendFcmToStaff (convenience wrapper)
// ============================================

/**
 * Send a notification to a staff member's devices.
 * Uses user_type = 'staff'.
 */
export async function sendFcmToStaff(
    supabase: SupabaseClient,
    staffId: string,
    notification: FcmNotification,
): Promise<FcmUserSendSummary> {
    return await sendFcmToUser(supabase, staffId, notification, "staff");
}

// ============================================
// PUBLIC: sendFcmToVendor (convenience wrapper)
// ============================================

/**
 * Send a notification to a vendor's devices.
 * Uses user_type = 'vendor'.
 */
export async function sendFcmToVendor(
    supabase: SupabaseClient,
    vendorId: string,
    notification: FcmNotification,
): Promise<FcmUserSendSummary> {
    return await sendFcmToUser(supabase, vendorId, notification, "vendor");
}
