import { errorResponse, successResponse } from "./response.ts";

export const AVAILABILITY_STATUSES = ["active", "inactive", "away"] as const;

export async function isUserAway(client: any, userId: string): Promise<boolean> {
  const { data, error } = await client.from("SSP_User_Availability")
    .select("status").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Unable to check user availability: ${error.message}`);
  return data?.status === "away";
}

export async function handleUserAvailability(req: Request, userId: string, client: any): Promise<Response> {
  if (req.method !== "POST") return errorResponse("Only POST method is allowed.", 405);
  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON request body.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("A JSON object is required.", 400);
  if (body.userId != null && body.userId !== userId) return errorResponse("You can only manage your own availability.", 403);
  if (!["GET_STATUS", "SET_STATUS"].includes(body.action)) return errorResponse("action must be GET_STATUS or SET_STATUS.", 400);
  if (body.action === "SET_STATUS" && !AVAILABILITY_STATUSES.includes(body.status)) {
    return errorResponse("status must be active, inactive, or away.", 400);
  }
  try {
    const { data: societyUser, error: societyError } = await client.from("SSP_Society_User")
      .select("user_id").eq("user_id", userId).maybeSingle();
    if (societyError) throw societyError;
    if (!societyUser) {
      const { data: externalUser, error: externalError } = await client.from("SSP_Non_Society_User")
        .select("non_society_user_id").eq("non_society_user_id", userId).maybeSingle();
      if (externalError) throw externalError;
      if (!externalUser) return errorResponse("Authenticated application user not found.", 403);
    }
    const table = client.from("SSP_User_Availability");
    const query = body.action === "SET_STATUS"
      ? table.upsert({ user_id: userId, status: body.status }, { onConflict: "user_id" })
          .select("status,updated_at").single()
      : table.select("status,updated_at").eq("user_id", userId).maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    const status = data?.status ?? "active";
    return successResponse({ userId, status, notificationsEnabled: status !== "away", updatedAt: data?.updated_at ?? null });
  } catch {
    return errorResponse("Unable to read or update user availability.", 500);
  }
}
