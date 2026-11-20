export function visitorApprovalState(visitor: {
  visitor_status?: string | null;
  visitor_approval_status?: string | null;
  pre_approved?: boolean | null;
  check_in?: string | null;
  check_out?: string | null;
}) {
  const status = String(visitor.visitor_status ?? "").trim().toLowerCase();
  const stored = String(visitor.visitor_approval_status ?? "").trim().toLowerCase();
  const approvalStatus = stored || (status === "pending" ? "pending" : null);
  const requiresApproval = approvalStatus === "pending" && !visitor.pre_approved &&
    !visitor.check_in && !visitor.check_out && ["pending", "expected", ""].includes(status);
  return { approvalStatus, requiresApproval, canApprove: requiresApproval, canReject: requiresApproval };
}
