export class VisitorDraftError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Placeholder labels are draft state, never a visitor's identity. */
export function hasVisitorName(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() &&
    !["unknown", "unknown visitor", "unknown user"].includes(value.trim().toLowerCase());
}

/** Accept the name fields used by security clients without masking a real name with a placeholder. */
export function readVisitorName(input: Record<string, unknown>): string | null {
  const names: string[] = [];
  // Pre-approved clients already use visitorData; accept that envelope for
  // walk-in security/OTP clients too instead of silently ignoring its name.
  const sources = [input];
  if (input.visitorData != null) {
    if (typeof input.visitorData !== "object" || Array.isArray(input.visitorData)) {
      throw new VisitorDraftError("visitorData must be an object.");
    }
    sources.push(input.visitorData as Record<string, unknown>);
  }
  for (const source of sources) {
    for (const key of ["visitorName", "name", "fullName", "Name", "visitor_name"]) {
      const value = source[key];
      if (value == null) continue;
      if (typeof value !== "string") throw new VisitorDraftError(`${key} must be text.`);
      if (hasVisitorName(value)) names.push(value.trim());
    }
  }
  if (new Set(names).size > 1) throw new VisitorDraftError("Conflicting visitor names were supplied.");
  return names[0] ?? null;
}

export function isVisitorOtpDraft(row: any): boolean {
  return row?.role === "visitor" &&
    ["otp_pending", "pending"].includes(String(row.visitor_status ?? "").toLowerCase()) &&
    !row.check_in && !row.check_out && !row.pre_approved &&
    ["", "pending"].includes(String(row.visitor_approval_status ?? "").toLowerCase());
}

// A resident may decide before security finishes the name/details form.
export function canCompleteVisitorDetails(row: any): boolean {
  const status = String(row?.visitor_status ?? "").toLowerCase();
  // Named, decided visits are submitted records. Only unnamed legacy requests
  // may receive their first details after a resident decision.
  return row?.role === "visitor" && row.is_otp_verified === true &&
    !row.check_in && !row.check_out &&
    (["otp_pending", "pending"].includes(status) ||
      (!hasVisitorName(row.name) && ["approved", "rejected"].includes(status)));
}

export async function findVisitorDraft(client: any, residentId: string, societyId: string,
  phone: string | null, visitorId?: string | null): Promise<any | null> {
  let query = client.from("SSP_Non_Society_User").select("*")
    .eq("hosted_by", residentId).eq("society", societyId);
  if (visitorId) {
    const { data, error } = await query.eq("non_society_user_id", visitorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new VisitorDraftError("Visitor does not belong to the selected resident and society.", 403);
    if (phone && data.phone_number !== phone) throw new VisitorDraftError("Phone number does not match the selected visitor.");
    return data;
  }
  if (!phone) return null;
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await query.eq("phone_number", phone).eq("role", "visitor")
    .is("check_in", null).is("check_out", null)
    .or(`and(pre_approved.eq.false,or(visitor_status.eq.otp_pending,and(visitor_status.ilike.pending,created_at.gte.${cutoff}))),and(is_otp_verified.eq.true,visitor_status.in.(pending,Pending,approved,Approved,rejected,Rejected))`)
    .order("created_at", { ascending: false }).limit(2);
  if (error) throw new Error(error.message);
  const drafts = (data ?? []).filter((row: any) => isVisitorOtpDraft(row) || canCompleteVisitorDetails(row));
  const canonical = drafts.filter((row: any) => row.visitor_status === "otp_pending");
  if (canonical.length === 1) return canonical[0];
  if (drafts.length > 1) throw new VisitorDraftError("Multiple unfinished visitor requests exist. Please provide the visitorId returned by visitor-otp.", 409);
  return drafts[0] ?? null;
}

export function canVerifyVisitorOtp(row: any): boolean {
  return row?.role === "visitor" && !row.check_in && !row.check_out &&
    ["otp_pending", "pending", "expected", "approved"].includes(String(row.visitor_status ?? "").toLowerCase()) &&
    ["", "pending", "approved"].includes(String(row.visitor_approval_status ?? "").toLowerCase());
}

// Some app versions create the named visitor before opening the OTP screen.
export async function findPendingVisitorForOtp(client: any, residentId: string, societyId: string, phone: string) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await client.from("SSP_Non_Society_User").select("*")
    .eq("hosted_by", residentId).eq("society", societyId).eq("phone_number", phone)
    .eq("role", "visitor").eq("pre_approved", false).neq("name", "Unknown Visitor")
    .is("check_in", null).is("check_out", null).ilike("visitor_status", "pending")
    .gte("created_at", cutoff).order("created_at", { ascending: false }).limit(2);
  if (error) throw new Error(error.message);
  const visitors = (data ?? []).filter(canVerifyVisitorOtp);
  if (visitors.length > 1) throw new VisitorDraftError("Multiple pending visits exist. Provide the visitorId for this visit.", 409);
  return visitors[0] ?? null;
}

/** Only walk-in visitors for a known non-Premium resident may omit their phone. */
export async function canOmitVisitorPhone(client: any, residentId: string, societyId: string): Promise<boolean> {
  const { data: resident, error } = await client.from("SSP_Society_User")
    .select("user_id,society,tower,block,unit_flat_number,deleted_at")
    .eq("user_id", residentId).eq("society", societyId).maybeSingle();
  if (error || !resident || resident.deleted_at) {
    throw new VisitorDraftError("Unable to check resident's subscription plan.", 500);
  }
  const { data: plan, error: planError } = await client.rpc("get_current_plan_code", {
    p_society: resident.society, p_tower: resident.tower ?? null,
    p_block: resident.block ?? null, p_flat: resident.unit_flat_number ?? null,
  });
  if (planError || (plan != null && typeof plan !== "string")) {
    throw new VisitorDraftError("Unable to check resident's subscription plan.", 500);
  }
  return String(plan ?? "FREE").trim().toUpperCase() !== "PREMIUM";
}
