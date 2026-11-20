/** FCM requires string values. Keep existing routing keys and add explicit
 * complaint/staff identifiers for opening an assigned complaint from a push.
 */
export function notificationRoutingData(notification: Record<string, any>): Record<string, string> {
  const complaint = notification.reference_table === "SSP_Complaint";
  const recipient = String(notification.recipient_type ?? "").replace(/[\s_-]/g, "").toLowerCase();
  const staffType = recipient === "serviceagent" ? "SERVICE_AGENT" : recipient === "vendor" ? "VENDOR" : null;
  return {
    notificationId: String(notification.notification_id ?? ""),
    type: String(notification.notification_type ?? ""),
    screen: String(notification.navigation_screen || (complaint ? "/complaint-details" : "")),
    referenceId: String(notification.reference_id ?? ""),
    referenceTable: String(notification.reference_table ?? ""),
    title: String(notification.title ?? ""),
    body: String(notification.message ?? ""),
    ...(complaint ? { complaintId: String(notification.reference_id ?? notification.extra_data?.complaintId ?? "") } : {}),
    ...(complaint && staffType ? { staffId: String(notification.recipient_id ?? ""), staffType } : {}),
  };
}
