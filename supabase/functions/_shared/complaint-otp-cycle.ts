// Shared START/END cycle for both staff OTP endpoints. Authorization stays with callers.
export interface ComplaintOtpState {
  complaint_id: string;
  status: string | null;
  assigned_agent?: string | null;
  non_society_user?: string | null;
  start_otp: string | null;
  start_otp_generated_at: string | null;
  start_otp_verified_at: string | null;
  end_otp: string | null;
  end_otp_generated_at: string | null;
  end_otp_verified_at: string | null;
}

export async function runComplaintOtpCycle(
  client: any,
  c: ComplaintOtpState,
  stage: "START" | "END",
  otp: string | undefined,
  generatedOtp: string,
  now = new Date().toISOString(),
): Promise<{ status: number; data?: Record<string, unknown>; message?: string }> {
  const status = String(c.status ?? "").toLowerCase();
  const success = (verified: boolean) => ({ status: 200, data: {
    complaintId: c.complaint_id, stage, otpVerified: verified,
    status: verified ? (stage === "END" ? "resolved" : "in_progress") : status,
    nextStep: verified ? (stage === "END" ? "COMPLETED" : "END_OTP") : `VERIFY_${stage}`,
    message: verified ? (stage === "END" ? "Work completed successfully." : "Work started successfully.")
      : `${stage} OTP is ready. Ask the resident to share it. It is valid for 10 minutes.`,
  }});
  const fail = (message: string, code = 400) => ({ status: code, message });
  if (stage === "END" && ["resolved", "completed"].includes(status) && c.end_otp_verified_at) return success(true);
  const startEligible = ["assigned", "in_progress", "pending"].includes(status);
  if (stage === "START" ? !startEligible : !["assigned", "in_progress"].includes(status)) {
    return fail(`Cannot process ${stage} OTP for a complaint with status '${c.status}'.`);
  }
  // A completed cycle reopened without resetting its OTP fields must start fresh.
  const staleEnd = Boolean(c.end_otp_verified_at);
  if (stage === "START" && status === "in_progress" && c.start_otp_verified_at && !staleEnd) return success(true);
  if (stage === "END" && (status !== "in_progress" || !c.start_otp_verified_at)) return fail("Verify START OTP before requesting or verifying END OTP.");
  const prefix = stage === "START" ? "start" : "end";
  const storedOtp = c[`${prefix}_otp`];
  const generatedAt = c[`${prefix}_otp_generated_at`];
  const age = generatedAt ? Date.parse(now) - Date.parse(generatedAt) : NaN;
  const valid = Boolean(storedOtp) && Number.isFinite(age) && age >= 0 && age <= 600_000;
  const patch: Record<string, unknown> = {};
  if (otp !== undefined) {
    if (!/^\d{6}$/.test(otp)) return fail("OTP must be a 6-digit number.");
    if (staleEnd) return fail(`Request a new ${stage} OTP for this reopened complaint first.`);
    if (!storedOtp) return fail(`Request ${stage} OTP first.`);
    if (!valid) return fail(`${stage} OTP has expired. Request a new one.`);
    if (storedOtp.trim() !== otp.trim()) return fail("Invalid OTP. Please try again.");
    Object.assign(patch, {status: stage === "START" ? "in_progress" : "resolved", [`${prefix}_otp_verified_at`]: now});
    if (stage === "END") patch.completion_date_time = now;
  } else {
    if (valid && !staleEnd && !c[`${prefix}_otp_verified_at`]) return success(false);
    Object.assign(patch, {[`${prefix}_otp`]: generatedOtp, [`${prefix}_otp_generated_at`]: now, [`${prefix}_otp_verified_at`]: null});
    if (stage === "START") {
      Object.assign(patch, {start_otp_verified_at: null, end_otp: null, end_otp_generated_at: null, end_otp_verified_at: null, completion_date_time: null});
    } else if (staleEnd) Object.assign(patch, {end_otp_verified_at: null, completion_date_time: null});
  }
  let query = client.from("SSP_Complaint").update(patch).eq("complaint_id", c.complaint_id).is("deleted_at", null);
  // Compare the complete cycle snapshot so a concurrent verification/reassignment wins.
  for (const key of ["status", "start_otp", "start_otp_generated_at", "start_otp_verified_at", "end_otp", "end_otp_generated_at", "end_otp_verified_at"] as const) {
    query = c[key] == null ? query.is(key, null) : query.eq(key, c[key]);
  }
  for (const key of ["assigned_agent", "non_society_user"] as const) {
    if (key in c) query = c[key] == null ? query.is(key, null) : query.eq(key, c[key]);
  }
  const {data, error} = await query.select("complaint_id").maybeSingle();
  if (error) return fail("Failed to save complaint OTP state.", 500);
  if (!data) return fail("Complaint state changed. Please refresh and retry.", 409);
  return success(otp !== undefined);
}
