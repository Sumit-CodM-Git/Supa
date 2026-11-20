const PAYMENT_STAFF_ROLES = [
  "society_admin",
  "admin",
  "facility_manager",
  "facility_admin",
  "committee",
  "committee_member",
  "secretary",
  "manager",
  "treasurer",
  "accounts",
];

export function isPaymentStaffRole(role: unknown): boolean {
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((value) =>
    typeof value === "string" && PAYMENT_STAFF_ROLES.includes(value.toLowerCase().trim())
  );
}
