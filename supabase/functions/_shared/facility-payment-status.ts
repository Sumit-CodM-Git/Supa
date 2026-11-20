/** Preserve payment status separately from the facility's approval decision. */
export async function facilityPaymentApprovals(client: any, paymentIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(paymentIds.filter(Boolean))];
  const approvals = new Map<string, string | null>();
  if (!ids.length) return approvals;
  const [requests, bookings] = await Promise.all([
    client.from("SSP_Facility_Booking_Request").select("payment,status").in("payment", ids),
    client.from("SSP_Facility_Booking").select("payment,approval_status,booking_status").in("payment", ids),
  ]);
  if (requests.error) throw requests.error;
  if (bookings.error) throw bookings.error;
  for (const row of requests.data ?? []) approvals.set(row.payment, row.status ?? null);
  for (const row of bookings.data ?? []) approvals.set(row.payment, row.approval_status ?? row.booking_status ?? null);
  return approvals;
}

export async function confirmResidentPaymentProof(client: any, paymentId: string, residentId: string) {
  const { data, error } = await client.rpc("confirm_resident_payment_proof", {
    p_payment_id: paymentId, p_resident_id: residentId,
  });
  if (error) throw new Error(`Payment proof confirmation failed: ${error.message}`);
  return data as { payment_status: string; approval_status: string | null; http_status?: number; message?: string };
}
