/** Compare stored phone identities consistently, never a request-supplied phone. */
export function staffPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Accept a vendor profile ID or its linked society-user ID within one society.
 * A direct profile wins. Ambiguous linked profiles must not silently pick a vendor.
 */
export async function resolveVendorProfile(client: any, userId: string, societyId: string): Promise<{data: any; error?: string}> {
  const fields = "non_society_user_id, name, role, phone_number, vendor_rating, society, deleted_at";
  const direct = await client.from("SSP_Non_Society_User").select(fields)
    .eq("non_society_user_id", userId).eq("society", societyId).maybeSingle();
  if (direct.error) return {data:null,error:direct.error.message};
  if (direct.data) return !direct.data.deleted_at && String(direct.data.role).trim().toLowerCase() === "vendor"
    ? {data:direct.data} : {data:null};
  const member = await client.from("SSP_Society_User")
    .select("user_id, society, deleted_at, contact:SSP_Contact!contact(phone)")
    .eq("user_id", userId).eq("society", societyId).maybeSingle();
  if (member.error) return {data:null,error:member.error.message};
  const contact = Array.isArray(member.data?.contact) ? member.data.contact[0] : member.data?.contact;
  const phone = staffPhone(contact?.phone);
  if (!member.data || member.data.deleted_at || !phone) return {data:null};
  const vendors = await client.from("SSP_Non_Society_User").select(fields)
    .eq("society", societyId).ilike("role", "vendor").is("deleted_at", null);
  if (vendors.error) return {data:null,error:vendors.error.message};
  const matches = (vendors.data ?? []).filter((row: any) => staffPhone(row.phone_number) === phone);
  if (matches.length > 1) return {data:null,error:"Multiple vendor profiles match this account. Use the assigned vendor profile ID."};
  return {data:matches[0] ?? null};
}
