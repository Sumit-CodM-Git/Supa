// //==========================================
// // _shared/auth.ts - Fast JWT-based Auth
// // ============================================

// export const corsHeaders = {
//     "Access-Control-Allow-Origin": "*",
//     "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
//     "Access-Control-Allow-Headers": "Authorization, Content-Type",
// };

// // ============================================
// // TYPES
// // ============================================

// export interface AuthUser {
//     id: string;
//     email: string;
//     role: string;
//     app_metadata: Record<string, unknown>;
//     user_metadata: Record<string, unknown>;
//     /** Supabase auth.users.id (the auth user, not the app user) */
//     authId: string;
// }

// export interface AuthContext {
//     user: AuthUser;
//     accessToken: string;
// }

// interface JwtPayload {
//     sub?: string;
//     email?: string;
//     role?: string;
//     exp?: number;
//     iat?: number;
//     app_metadata?: Record<string, unknown>;
//     user_metadata?: Record<string, unknown>;
//     [key: string]: unknown;
// }

// // ============================================
// // JWT DECODE (no verification — Supabase Gateway already verified)
// // ============================================
// // NOTE: Supabase's API Gateway (Kong) has ALREADY verified the JWT
// // signature before the request reaches this Edge Function.
// // Therefore we don't need to re-verify — just decode the payload.

// function decodeJwt(token: string): JwtPayload | null {
//     try {
//         const parts = token.split(".");
//         if (parts.length !== 3) return null;

//         // base64url → base64
//         const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
//         // pad
//         const padded = payloadB64.padEnd(
//             payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
//             "=",
//         );

//         const decoded = atob(padded);
//         return JSON.parse(decoded) as JwtPayload;
//     } catch (error) {
//         console.error("❌ Failed to decode JWT:", error);
//         return null;
//     }
// }

// function isTokenExpired(payload: JwtPayload): boolean {
//     if (!payload.exp) return false;
//     const now = Math.floor(Date.now() / 1000);
//     return payload.exp < now;
// }

// // ============================================
// // GET AUTH CONTEXT (fast — no network call)
// // ============================================
// export function getAuthContext(req: Request): AuthContext | null {
//     const authHeader = req.headers.get("Authorization");
//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//         console.log("❌ No Authorization header found");
//         return null;
//     }

//     const accessToken = authHeader.split(" ")[1];
//     const payload = decodeJwt(accessToken);
//     if (!payload) {
//         console.log("❌ Invalid JWT format");
//         return null;
//     }

//     if (isTokenExpired(payload)) {
//         console.log("❌ Token expired");
//         return null;
//     }

//     // Extract the app user_id — prefer metadata.user_id (your convention)
//     let actualUserId: string | null = null;

//     const userMetadata = (payload.user_metadata as Record<string, unknown>) ||
//         {};
//     if (typeof userMetadata.user_id === "string") {
//         actualUserId = userMetadata.user_id;
//     }

//     // Fallback: payload.user_id (if you set a custom claim)
//     if (!actualUserId && typeof payload.user_id === "string") {
//         actualUserId = payload.user_id;
//     }

//     // Fallback: use sub (auth.users.id) — may not match your app's user_id
//     if (!actualUserId && typeof payload.sub === "string") {
//         actualUserId = payload.sub;
//     }

//     if (!actualUserId) {
//         console.error("❌ No user_id found in JWT payload");
//         return null;
//     }

//     const authId = typeof payload.sub === "string" ? payload.sub : actualUserId;

//     return {
//         user: {
//             id: actualUserId,
//             authId,
//             email: typeof payload.email === "string" ? payload.email : "",
//             role: typeof payload.role === "string"
//                 ? payload.role
//                 : "authenticated",
//             app_metadata: (payload.app_metadata as Record<string, unknown>) ||
//                 {},
//             user_metadata: userMetadata,
//         },
//         accessToken,
//     };
// }

// // ============================================
// // MIDDLEWARE
// // ============================================
// export function requireAuth(
//     handler: (req: Request, ctx: AuthContext) => Promise<Response>,
// ) {
//     return async (req: Request): Promise<Response> => {
//         try {
//             if (req.method === "OPTIONS") {
//                 return new Response("ok", { headers: corsHeaders });
//             }

//             const authCtx = getAuthContext(req);
//             if (!authCtx) {
//                 return new Response(
//                     JSON.stringify({
//                         success: false,
//                         error: "UNAUTHORIZED",
//                         message:
//                             "Invalid or missing authentication token. Please login again.",
//                     }),
//                     {
//                         status: 401,
//                         headers: {
//                             ...corsHeaders,
//                             "Content-Type": "application/json",
//                         },
//                     },
//                 );
//             }

//             return await handler(req, authCtx);
//         } catch (error) {
//             console.error("❌ Auth middleware error:", error);
//             return new Response(
//                 JSON.stringify({
//                     success: false,
//                     error: "SERVER_ERROR",
//                     message: "Internal server error",
//                 }),
//                 {
//                     status: 500,
//                     headers: {
//                         ...corsHeaders,
//                         "Content-Type": "application/json",
//                     },
//                 },
//             );
//         }
//     };
// }

// export function optionalAuth(
//     handler: (req: Request, ctx: AuthContext | null) => Promise<Response>,
// ) {
//     return async (req: Request): Promise<Response> => {
//         try {
//             if (req.method === "OPTIONS") {
//                 return new Response("ok", { headers: corsHeaders });
//             }

//             const authCtx = getAuthContext(req);
//             return await handler(req, authCtx);
//         } catch (error) {
//             console.error("❌ Auth middleware error:", error);
//             return new Response(
//                 JSON.stringify({
//                     success: false,
//                     error: "SERVER_ERROR",
//                     message: "Internal server error",
//                 }),
//                 {
//                     status: 500,
//                     headers: {
//                         ...corsHeaders,
//                         "Content-Type": "application/json",
//                     },
//                 },
//             );
//         }
//     };
// }





// ============================================
// _shared/auth.ts - Secure JWT-based Auth
// ============================================
// JWT signatures are verified with SUPABASE_JWT_SECRET (HMAC-SHA256).
// Forged or tampered tokens are rejected before reaching any handler.
// ============================================

// export const corsHeaders = {
//     "Access-Control-Allow-Origin": "*",
//     "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
//     "Access-Control-Allow-Headers": "Authorization, Content-Type",
// };

// // ============================================
// // TYPES
// // ============================================

// export interface AuthUser {
//     id: string;
//     email: string;
//     role: string;
//     app_metadata: Record<string, unknown>;
//     user_metadata: Record<string, unknown>;
//     /** Supabase auth.users.id (the auth user, not the app user) */
//     authId: string;
// }

// export interface AuthContext {
//     user: AuthUser;
//     accessToken: string;
// }

// interface JwtPayload {
//     sub?: string;
//     email?: string;
//     role?: string;
//     exp?: number;
//     iat?: number;
//     app_metadata?: Record<string, unknown>;
//     user_metadata?: Record<string, unknown>;
//     user_id?: string;
//     [key: string]: unknown;
// }

// // ============================================
// // JWT VERIFY (HMAC-SHA256 against SUPABASE_JWT_SECRET)
// // ============================================

// async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
//     try {
//         const { verify } = await import("https://deno.land/x/djwt@v2.8/mod.ts");
//         const key = await crypto.subtle.importKey(
//             "raw",
//             new TextEncoder().encode(secret),
//             { name: "HMAC", hash: "SHA-256" },
//             false,
//             ["verify"],
//         );
//         const payload = await verify(token, key);
//         return payload as JwtPayload;
//     } catch (error) {
//         console.error("❌ JWT verification failed:", error);
//         return null;
//     }
// }

// function isTokenExpired(payload: JwtPayload): boolean {
//     if (!payload.exp) return false;
//     const now = Math.floor(Date.now() / 1000);
//     return payload.exp < now;
// }

// // ============================================
// // GET AUTH CONTEXT (async — verifies signature)
// // ============================================

// export async function getAuthContext(req: Request): Promise<AuthContext | null> {
//     const authHeader = req.headers.get("Authorization");
//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//         console.log("❌ No Authorization header found");
//         return null;
//     }

//     const accessToken = authHeader.split(" ")[1];
//     const secret = Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? "";
//     if (!secret) {
//         console.error("❌ SUPABASE_JWT_SECRET not configured — cannot verify tokens");
//         return null;
//     }

//     // ✅ Cryptographic verification
//     const payload = await verifyJwt(accessToken, secret);
//     if (!payload) {
//         console.log("❌ Invalid JWT signature or format");
//         return null;
//     }

//     if (isTokenExpired(payload)) {
//         console.log("❌ Token expired");
//         return null;
//     }

//     // Extract app user_id (existing convention)
//     let actualUserId: string | null = null;

//     const userMetadata = (payload.user_metadata as Record<string, unknown>) || {};
//     if (typeof userMetadata.user_id === "string") {
//         actualUserId = userMetadata.user_id;
//     }

//     // Fallback: payload.user_id (custom claim)
//     if (!actualUserId && typeof payload.user_id === "string") {
//         actualUserId = payload.user_id;
//     }

//     // Fallback: sub (auth.users.id)
//     if (!actualUserId && typeof payload.sub === "string") {
//         actualUserId = payload.sub;
//     }

//     if (!actualUserId) {
//         console.error("❌ No user_id found in JWT payload");
//         return null;
//     }

//     const authId = typeof payload.sub === "string" ? payload.sub : actualUserId;

//     return {
//         user: {
//             id: actualUserId,
//             authId,
//             email: typeof payload.email === "string" ? payload.email : "",
//             role: typeof payload.role === "string" ? payload.role : "authenticated",
//             app_metadata: (payload.app_metadata as Record<string, unknown>) || {},
//             user_metadata: userMetadata,
//         },
//         accessToken,
//     };
// }

// // ============================================
// // MIDDLEWARE
// // ============================================

// export function requireAuth(
//     handler: (req: Request, ctx: AuthContext) => Promise<Response>,
// ) {
//     return async (req: Request): Promise<Response> => {
//         try {
//             if (req.method === "OPTIONS") {
//                 return new Response("ok", { headers: corsHeaders });
//             }

//             const authCtx = await getAuthContext(req);
//             if (!authCtx) {
//                 return new Response(
//                     JSON.stringify({
//                         success: false,
//                         error: "UNAUTHORIZED",
//                         message: "Invalid or missing authentication token. Please login again.",
//                     }),
//                     {
//                         status: 401,
//                         headers: { ...corsHeaders, "Content-Type": "application/json" },
//                     },
//                 );
//             }

//             return await handler(req, authCtx);
//         } catch (error) {
//             console.error("❌ Auth middleware error:", error);
//             return new Response(
//                 JSON.stringify({
//                     success: false,
//                     error: "SERVER_ERROR",
//                     message: "Internal server error",
//                 }),
//                 {
//                     status: 500,
//                     headers: { ...corsHeaders, "Content-Type": "application/json" },
//                 },
//             );
//         }
//     };
// }

// export function optionalAuth(
//     handler: (req: Request, ctx: AuthContext | null) => Promise<Response>,
// ) {
//     return async (req: Request): Promise<Response> => {
//         try {
//             if (req.method === "OPTIONS") {
//                 return new Response("ok", { headers: corsHeaders });
//             }

//             const authCtx = await getAuthContext(req);
//             return await handler(req, authCtx);
//         } catch (error) {
//             console.error("❌ Auth middleware error:", error);
//             return new Response(
//                 JSON.stringify({
//                     success: false,
//                     error: "SERVER_ERROR",
//                     message: "Internal server error",
//                 }),
//                 {
//                     status: 500,
//                     headers: { ...corsHeaders, "Content-Type": "application/json" },
//                 },
//             );
//         }
//     };
// }

// ============================================
// _shared/auth.ts - Secure JWT-based Auth + Global Logging
// ============================================
// JWT signatures are verified with SUPABASE_JWT_SECRET (HMAC-SHA256).
// Forged or tampered tokens are rejected before reaching any handler.
// ALL requests are now automatically logged to SSP_Log_Table.
// ============================================

import { withLogging } from "./logging.ts"; // <-- Import the global logger

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// ============================================
// TYPES
// ============================================

export interface AuthUser {
    id: string;
    email: string;
    role: string;
    app_metadata: Record<string, unknown>;
    user_metadata: Record<string, unknown>;
    /** Supabase auth.users.id (the auth user, not the app user) */
    authId: string;
}

export interface AuthContext {
    user: AuthUser;
    accessToken: string;
}

interface JwtPayload {
    sub?: string;
    email?: string;
    role?: string;
    exp?: number;
    iat?: number;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    user_id?: string;
    [key: string]: unknown;
}

// ============================================
// JWT VERIFY (HMAC-SHA256 against SUPABASE_JWT_SECRET)
// ============================================

async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
    try {
        const { verify } = await import("https://deno.land/x/djwt@v2.8/mod.ts");
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"],
        );
        const payload = await verify(token, key);
        return payload as JwtPayload;
    } catch (error) {
        console.error("❌ JWT verification failed:", error);
        return null;
    }
}

function isTokenExpired(payload: JwtPayload): boolean {
    if (!payload.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
}

// ============================================
// GET AUTH CONTEXT (async — verifies signature)
// ============================================

export async function getAuthContext(req: Request): Promise<AuthContext | null> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        // Silently return null for logging middleware; the middleware will catch it
        return null;
    }

    const accessToken = authHeader.split(" ")[1];
    const secret = Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? "";
    if (!secret) {
        console.error("❌ SUPABASE_JWT_SECRET not configured — cannot verify tokens");
        return null;
    }

    // ✅ Cryptographic verification
    const payload = await verifyJwt(accessToken, secret);
    if (!payload) return null;

    if (isTokenExpired(payload)) return null;

    // Extract app user_id (existing convention)
    let actualUserId: string | null = null;

    const userMetadata = (payload.user_metadata as Record<string, unknown>) || {};
    if (typeof userMetadata.user_id === "string") {
        actualUserId = userMetadata.user_id;
    }

    // Fallback: payload.user_id (custom claim)
    if (!actualUserId && typeof payload.user_id === "string") {
        actualUserId = payload.user_id;
    }

    // Fallback: sub (auth.users.id)
    if (!actualUserId && typeof payload.sub === "string") {
        actualUserId = payload.sub;
    }

    if (!actualUserId) {
        console.error("❌ No user_id found in JWT payload");
        return null;
    }

    const authId = typeof payload.sub === "string" ? payload.sub : actualUserId;

    return {
        user: {
            id: actualUserId,
            authId,
            email: typeof payload.email === "string" ? payload.email : "",
            role: typeof payload.role === "string" ? payload.role : "authenticated",
            app_metadata: (payload.app_metadata as Record<string, unknown>) || {},
            user_metadata: userMetadata,
        },
        accessToken,
    };
}

// ============================================
// MIDDLEWARE
// ============================================

export function requireAuth(
    handler: (req: Request, ctx: AuthContext) => Promise<Response>,
) {
    // 1. Wrap the actual API logic in the auth check
    const authLogic = async (req: Request): Promise<Response> => {
        try {
            if (req.method === "OPTIONS") {
                return new Response("ok", { headers: corsHeaders });
            }

            const authCtx = await getAuthContext(req);
            if (!authCtx) {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "UNAUTHORIZED",
                        message: "Invalid or missing authentication token. Please login again.",
                    }),
                    {
                        status: 401,
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                    },
                );
            }

            return await handler(req, authCtx);
        } catch (error) {
            console.error("❌ Auth middleware error:", error);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "SERVER_ERROR",
                    message: "Internal server error",
                }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                },
            );
        }
    };

    // 2. Pass the fully wrapped auth logic into the global logging middleware
    return withLogging(authLogic);
}

export function optionalAuth(
    handler: (req: Request, ctx: AuthContext | null) => Promise<Response>,
) {
    // 1. Wrap the actual API logic in the optional auth check
    const authLogic = async (req: Request): Promise<Response> => {
        try {
            if (req.method === "OPTIONS") {
                return new Response("ok", { headers: corsHeaders });
            }

            const authCtx = await getAuthContext(req);
            return await handler(req, authCtx);
        } catch (error) {
            console.error("❌ Auth middleware error:", error);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "SERVER_ERROR",
                    message: "Internal server error",
                }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                },
            );
        }
    };

    // 2. Pass the fully wrapped auth logic into the global logging middleware
    return withLogging(authLogic);
}