/** undefined preserves an existing slot; null or blank explicitly clears it. */
export function normalizeParkingSlot(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    throw new TypeError("parkingSlot must be text or null.");
  }
  return value.trim() || null;
}

export const CONTACT_PHONE_DUPLICATE_MESSAGE =
  "Contact record already present, use a different phone.";

export async function contactPhoneAlreadyExists(
  supabase: any,
  societyId: string,
  phone: string | string[],
  excludeContactId?: string,
): Promise<boolean> {
  const phones = (Array.isArray(phone) ? phone : [phone]).filter(Boolean);
  if (phones.length === 0) return false;

  let query = supabase
    .from("SSP_Contact")
    .select("contact_id")
    .eq("society", societyId)
    .in("phone", phones);
  if (excludeContactId) {
    query = query.neq("contact_id", excludeContactId);
  }

  const { data, error } = await query.limit(1);
  if (error) {
    throw new Error(`Failed to check contact phone: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

/** Read nullable contact data without confusing it with society parking capacity. */
export function contactParkingSlot(contact: unknown): string | null {
  if (Array.isArray(contact)) return contactParkingSlot(contact[0]);
  if (!contact || typeof contact !== "object") return null;
  const row = contact as { parking_slot?: unknown; parkingSlot?: unknown };
  const value = row.parking_slot !== undefined ? row.parking_slot : row.parkingSlot;
  return typeof value === "string" ? value : null;
}
