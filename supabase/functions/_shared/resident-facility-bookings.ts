export interface ResidentFacilityBooking {
  name: string;
  request_id: string | null;
  recordType: "booking" | "request";
  created_at: string | null;
  status: string | null;
  booking_status: string | null;
  booking_start_date: string | null;
  booking_end_date: string | null;
  payment_status: string | null;
  capacity: number | string | null;
  purpose_of_visit: string | null;
  is_all_day: boolean | null;
  facility: string | null;
  payment: string | null;
  SSP_Facility: Record<string, unknown> | null;
  SSP_Payment: Record<string, unknown> | null;
}

function first(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return first(value[0]);
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/** Both sources are scoped to the resident; confirmed bookings replace requests. */
export async function loadResidentFacilityBookings(
  // Supabase client versions vary between legacy endpoints.
  client: { from: (table: string) => any },
  residentId: string,
): Promise<ResidentFacilityBooking[]> {
  const relations = `
    SSP_Facility!facility(id,name,booking_mode),
    SSP_Payment!payment(pay_rec_id,payment_id,amount,payment_status,payment_method)
  `;
  async function load(table: string, select: string, id: string) {
    const rows: Record<string, any>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from(table).select(select)
        .eq("requested_by", residentId)
        .order("created_at", { ascending: false, nullsFirst: false })
        .order(id, { ascending: false }).range(offset, offset + 499);
      if (error) throw new Error(`Failed to retrieve resident bookings: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < 500) return rows;
    }
  }
  const [bookings, requests] = await Promise.all([
    load("SSP_Facility_Booking", `
      name,created_at,booking_status,approval_status,booking_start_date,booking_end_date,
      payment_status,capacity,purpose_of_visit,is_all_day,facility,payment,${relations}
    `, "name"),
    load("SSP_Facility_Booking_Request", `
      request_id,created_at,status,booking_start_date,booking_end_date,
      purpose_of_visit,is_all_day,facility,payment,${relations}
    `, "request_id"),
  ]);
  const confirmedPayments = new Set(bookings.map(row => row.payment).filter(Boolean));
  const rows: ResidentFacilityBooking[] = [
    ...bookings.map(row => ({ ...row, request_id: null, recordType: "booking", status: row.booking_status ?? row.approval_status })),
    ...requests.filter(row => !row.payment || !confirmedPayments.has(row.payment))
      .map(row => ({ ...row, name: row.request_id, recordType: "request", booking_status: row.status })),
  ].map((row: Record<string, any>) => {
    const payment = first(row.SSP_Payment);
    return {
      ...row,
      payment_status: payment?.payment_status ?? row.payment_status ?? null,
      capacity: row.capacity ?? null,
      SSP_Facility: first(row.SSP_Facility),
      SSP_Payment: payment,
    } as ResidentFacilityBooking;
  });
  return rows.sort((a, b) => {
    const aDate = a.created_at ? Date.parse(a.created_at) : NaN;
    const bDate = b.created_at ? Date.parse(b.created_at) : NaN;
    if (!Number.isFinite(aDate)) return Number.isFinite(bDate) ? 1 : 0;
    if (!Number.isFinite(bDate)) return -1;
    return bDate - aDate || b.name.localeCompare(a.name);
  });
}

/** Preserve the legacy resident list item fields and use each booking's payment. */
export function formatResidentFacilityBooking(row: ResidentFacilityBooking) {
  return {
    facilityName: row.SSP_Facility?.name ?? null,
    bookingStatus: row.booking_status ?? null,
    startDateTime: row.booking_start_date ?? null,
    endDateTime: row.booking_end_date ?? null,
    paymentStatus: row.payment_status ?? null,
    paymentMethod: row.SSP_Payment?.payment_method ?? null,
    capacity: row.capacity != null ? Number(row.capacity) : null,
    purpose: row.purpose_of_visit ?? null,
    facilityBookingId: row.name,
    payRecId: row.SSP_Payment?.pay_rec_id ?? row.payment ?? null,
    recordType: row.recordType,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}
