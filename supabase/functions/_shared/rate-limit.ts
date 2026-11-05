// ============================================================
// supabase/functions/_shared/rate-limit.ts
// ============================================================
// Lightweight in-memory rate limiter.
// ⚠️ For production scale, swap for Upstash Redis or
//    the pg_rate_limit extension.
// ============================================================

interface Bucket {
    count: number;
    windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetInSeconds: number;
}

export function rateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
): RateLimitResult {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
        bucket = { count: 0, windowStart: now };
    }

    bucket.count++;
    buckets.set(key, bucket);

    // Cleanup occasionally
    if (buckets.size > 10000) {
        for (const [k, v] of buckets.entries()) {
            if (now - v.windowStart > windowMs) buckets.delete(k);
        }
    }

    const allowed = bucket.count <= maxRequests;
    const remaining = Math.max(0, maxRequests - bucket.count);
    const resetInSeconds = Math.ceil(
        (bucket.windowStart + windowMs - now) / 1000,
    );

    return { allowed, remaining, resetInSeconds };
}

// ─────────────────────────────────────────────
// Middleware wrapper — generic over context type T
// ─────────────────────────────────────────────
export function withRateLimit<T extends { user: { id: string } }>(
    keyFn: (userId: string) => string,
    maxRequests: number,
    windowSeconds: number,
) {
    return (
        handler: (req: Request, ctx: T) => Promise<Response>,
    ) =>
    async (req: Request, ctx: T): Promise<Response> => {
        const key = keyFn(ctx.user.id);
        const result = rateLimit(key, maxRequests, windowSeconds);

        if (!result.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "RATE_LIMITED",
                    message: "Too many requests. Try again later.",
                    retry_after: result.resetInSeconds,
                }),
                {
                    status: 429,
                    headers: {
                        "Content-Type": "application/json",
                        "Retry-After": String(result.resetInSeconds),
                        "X-RateLimit-Remaining": "0",
                    },
                },
            );
        }

        const response = await handler(req, ctx);
        const headers = new Headers(response.headers);
        headers.set("X-RateLimit-Remaining", String(result.remaining));
        headers.set("X-RateLimit-Reset", String(result.resetInSeconds));

        return new Response(response.body, {
            status: response.status,
            headers,
        });
    };
}
