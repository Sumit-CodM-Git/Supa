export async function releaseUnpaidReservation(
  client: any,
  requestId: string,
  residentId: string,
  expiredBefore: string | null = null,
): Promise<boolean> {
  const { data, error } = await client.rpc("release_unpaid_facility_request", {
    p_request_id: requestId,
    p_resident_id: residentId,
    p_expired_before: expiredBefore,
  });
  if (error) throw new Error(`Failed to release booking: ${error.message}`);
  return data === true;
}
