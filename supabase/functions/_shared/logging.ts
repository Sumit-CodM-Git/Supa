// Note: Using bare specifier to satisfy the Deno linter. 
// Make sure your deno.json has: "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.48.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

/** Safely truncate JSON without breaking its structure */
function safeTruncate(payload: unknown, maxLength = 5000): unknown {
  if (!payload) return null;
  try {
    const str = JSON.stringify(payload);
    if (str.length <= maxLength) return payload;
    
    // If it's too large, return a safe metadata object instead of a broken string
    return {
      _truncated: true,
      original_size_chars: str.length,
      preview: str.substring(0, maxLength - 100) + "... [TRUNCATED]",
    };
  } catch {
    return { _error: "Failed to serialize payload" };
  }
}

export function withLogging(
  handler: (req: Request, ...args: unknown[]) => Promise<Response>
) {
  return async (req: Request, ...args: unknown[]): Promise<Response> => {
    // Skip logging for CORS preflight requests to save DB space
    if (req.method === "OPTIONS") {
      return handler(req, ...args);
    }

    const startTime = performance.now();
    
    // Extract function name from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const functionName = pathParts[pathParts.length - 1] || "unknown";

    // 1. Capture Request Body (Safely)
    let reqBody: Record<string, unknown> | null = null;
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      try {
        const rawBody = await req.clone().json();
        if (rawBody && typeof rawBody === "object") {
          reqBody = rawBody as Record<string, unknown>;
          
          // Redact sensitive info safely
          if ("password" in reqBody) reqBody.password = "[REDACTED]";
          if ("fileBase64" in reqBody) reqBody.fileBase64 = "[BASE64_TRUNCATED]";
        }
      } catch {
        /* ignore body parse errors */
      }
    }

    let statusCode = 200;
    let errorType: string | null = null;
    let errorMessage: string | null = null;
    let resBody: Record<string, unknown> | null = null;

    try {
      // 2. Execute the actual API handler
      const response = await handler(req, ...args);
      statusCode = response.status;

      // 3. Clone and parse response body
      try {
        const cloned = response.clone();
        const rawRes = await cloned.json();
        
        if (rawRes && typeof rawRes === "object") {
          resBody = rawRes as Record<string, unknown>;
          
          // Extract standard error formats used in your project
          if ("errorResponse" in resBody && resBody.errorResponse) {
            const errObj = resBody.errorResponse as Record<string, unknown>;
            errorType = (errObj.errorCode as string) || "ERROR";
            errorMessage = (errObj.message as string) || null;
          } else if ("error" in resBody) {
            errorType = String(resBody.error);
            errorMessage = resBody.message ? String(resBody.message) : null;
          }
        }
      } catch {
        /* ignore response parse errors (e.g. non-JSON responses) */
      }

      return response;

    } catch (err: unknown) {
      // 4. Catch Unhandled Exceptions
      statusCode = 500;
      errorType = "UNHANDLED_EXCEPTION";
      errorMessage = err instanceof Error ? err.message : String(err);

      return new Response(
        JSON.stringify({ success: false, error: errorType, message: errorMessage }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );

    } finally {
      // 5. Build and Write Log Payload
      const durationMs = Math.round(performance.now() - startTime);

      // Extract User ID from JWT
      let userId: string | null = null;
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const token = authHeader.split(" ")[1];
          const payload = JSON.parse(atob(token.split(".")[1])) as { sub?: string };
          userId = payload.sub || null;
        } catch {
          /* ignore jwt parse errors */
        }
      }

      const logPayload = {
        function_name: functionName,
        method: req.method,
        status_code: statusCode,
        execution_time_ms: durationMs,
        user_id: userId,
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"),
        user_agent: req.headers.get("user-agent"),
        error_type: errorType,
        error_message: errorMessage,
        request_body: safeTruncate(reqBody),
        response_body: safeTruncate(resBody),
      };

      // Wrap Supabase builder in async/await to allow proper error handling
      const logPromise = (async () => {
        try {
          await supabaseAdmin.from("SSP_Log_Table").insert(logPayload);
        } catch (dbErr: unknown) {
          console.error("Failed to write to SSP_Log_Table:", dbErr);
        }
      })();

      // Safely access Supabase's EdgeRuntime without TS errors
      const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
      
      if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
        edgeRuntime.waitUntil(logPromise);
      } else {
        await logPromise;
      }
    }
  };
}