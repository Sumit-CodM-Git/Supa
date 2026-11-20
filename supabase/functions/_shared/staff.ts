// supabase/functions/_shared/staff.ts
// Single source of truth for "who is this caller and can they touch this complaint?"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

export const COMPLAINT_STATUS = {
  NEW: "new",
  PENDING: "pending",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  RESOLVED: "resolved",
} as const;

export const OTP_STAGE = {
  START: "START",
  END: "END",
} as const;

export type ComplaintStatus =
  typeof COMPLAINT_STATUS[keyof typeof COMPLAINT_STATUS];
export type OtpStage = typeof OTP_STAGE[keyof typeof OTP_STAGE];
export type StaffType = "SERVICE_AGENT" | "VENDOR";

/**
 * Normalize a phone number to its last 10 digits.
 * Handles: "+919876543212", "919876543212", "09876543212", "9876543212".
 * Returns null for empty/invalid input.
 */
export function normalizePhone(
  p: string | null | undefined,
): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return digits.slice(-10);
}

/**
 * Return the caller's normalized phone number.
 * Prefers the JWT claim if present; otherwise fetches from auth.users.
 */
export async function getCallerPhone(params: {
  userId: string;
  jwtPhone?: string | null;
}): Promise<string | null> {
  if (params.jwtPhone) return normalizePhone(params.jwtPhone);

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(
    params.userId,
  );
  if (error || !data?.user) return null;
  return normalizePhone(data.user.phone);
}

/**
 * True if the caller's phone matches the vendor assigned to this complaint.
 * Requires both the complaint's vendor id and the caller's normalized phone.
 */
export async function isAssignedVendor(params: {
  complaintVendorId: string;
  callerPhone: string | null;
}): Promise<boolean> {
  if (!params.callerPhone) return false;

  const { data, error } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .select("non_society_user_id, role, phone_number, deleted_at")
    .eq("non_society_user_id", params.complaintVendorId)
    .maybeSingle();

  if (error) return false;
  const callerPhone = normalizePhone(params.callerPhone);
  return Boolean(
    data &&
      !data.deleted_at &&
      String(data.role ?? "").trim().toLowerCase() === "vendor" &&
      callerPhone?.length === 10 &&
      normalizePhone(data.phone_number) === callerPhone,
  );
}

/**
 * Determine if a user is a service agent or vendor.
 * Service agents: role[] on SSP_Society_User includes "service_agent".
 * Vendors: matched in SSP_Non_Society_User by phone (auth uses phone OTP).
 */
export async function getStaffType(
  userId: string,
  callerPhone?: string | null,
): Promise<StaffType | null> {
  const { data: userRole, error: roleErr } = await supabaseAdmin
    .from("SSP_Society_User")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!roleErr && userRole?.role?.includes("service_agent")) {
    return "SERVICE_AGENT";
  }

  // Vendor path — resolve by phone (vendors log in with phone + OTP)
  const phone = normalizePhone(callerPhone);
  if (phone) {
    const { data: vendor } = await supabaseAdmin
      .from("SSP_Non_Society_User")
      .select("non_society_user_id")
      .eq("phone_number", phone)
      .maybeSingle();
    if (vendor) return "VENDOR";
  }

  return null;
}

/**
 * Resolve whether the caller is the assignee of a complaint.
 *
 * - Service agent: complaint.assigned_agent === callerAuthId
 * - Vendor:        complaint.non_society_user matches a vendor record
 *                  whose phone_number equals the caller's phone
 *
 * Returns the resolved role plus the complaint row (minimal fields).
 */
export async function resolveComplaintAssignee(params: {
  complaintId: string;
  callerAuthId: string;
  callerAuthUserId?: string;
  callerPhone?: string | null;
  select?: string;
}): Promise<
  | {
    ok: true;
    complaint: Record<string, unknown>;
    role: StaffType;
  }
  | { ok: false; code: number; message: string }
> {
  const select = params.select ??
    "complaint_id, status, assigned_agent, non_society_user";

  const { data, error } = await supabaseAdmin
    .from("SSP_Complaint")
    .select(select)
    .eq("complaint_id", params.complaintId)
    .maybeSingle();

  if (error) {
    return { ok: false, code: 500, message: error.message };
  }
  if (!data) {
    return { ok: false, code: 404, message: "Complaint not found" };
  }

  // Agent path — direct match on auth id
  if (data.assigned_agent && data.assigned_agent === params.callerAuthId) {
    return { ok: true, complaint: data, role: "SERVICE_AGENT" };
  }

  // Vendor assignments use the vendor profile ID, while multi-role logins use
  // SSP_Society_User.user_id. Resolve through the caller's stored profile first.
  if (data.non_society_user) {
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("SSP_Non_Society_User")
      .select("non_society_user_id, society, role, phone_number, deleted_at")
      .eq("non_society_user_id", data.non_society_user)
      .maybeSingle();
    if (vendorError) return { ok: false, code: 500, message: "Failed to load assigned vendor." };
    if (!vendor || vendor.deleted_at || String(vendor.role).toLowerCase() !== "vendor") {
      return { ok: false, code: 403, message: "Not assigned to you" };
    }
    if (vendor.non_society_user_id === params.callerAuthId) {
      return { ok: true, complaint: data, role: "VENDOR" };
    }

    const { data: caller, error: callerError } = await supabaseAdmin
      .from("SSP_Society_User")
      .select("society, deleted_at, contact:SSP_Contact!contact(phone)")
      .eq("user_id", params.callerAuthId)
      .maybeSingle();
    if (callerError) return { ok: false, code: 500, message: "Failed to load caller profile." };
    const contact = Array.isArray(caller?.contact) ? caller.contact[0] : caller?.contact;
    if (caller) {
      const phone = normalizePhone(contact?.phone);
      if (!caller.deleted_at && caller.society === vendor.society && phone &&
          phone.length === 10 && phone === normalizePhone(vendor.phone_number)) {
        return { ok: true, complaint: data, role: "VENDOR" };
      }
      // An existing application profile must match both society and phone.
      return { ok: false, code: 403, message: "Not assigned to you" };
    }

    // Legacy phone-auth sessions may have only an auth.users record.
    const callerPhone = await getCallerPhone({
      userId: params.callerAuthUserId ?? params.callerAuthId,
      jwtPhone: params.callerPhone ?? null,
    });

    const vendorOk = await isAssignedVendor({
      complaintVendorId: data.non_society_user as string,
      callerPhone,
    });

    if (vendorOk) {
      return { ok: true, complaint: data, role: "VENDOR" };
    }
  }

  return { ok: false, code: 403, message: "Not assigned to you" };
}

/**
 * Backwards-compatible wrapper. Prefer resolveComplaintAssignee.
 */
export async function assertComplaintAssignee(params: {
  complaintId: string;
  callerId: string;
  callerPhone?: string | null;
  select?: string;
}): Promise<
  | { ok: true; complaint: Record<string, unknown> }
  | { ok: false; code: number; message: string }
> {
  const result = await resolveComplaintAssignee({
    complaintId: params.complaintId,
    callerAuthId: params.callerId,
    callerPhone: params.callerPhone,
    select: params.select,
  });

  if (!result.ok) return result;
  return { ok: true, complaint: result.complaint };
}
