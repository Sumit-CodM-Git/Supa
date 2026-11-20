export class ResidentFlatTypeError extends Error {}

/** Omitted leaves the assignment unchanged; null/empty explicitly clears it. */
export async function resolveResidentFlatType(client: any, societyId: string, input: {flatTypeId?: unknown; flatType?: unknown}) {
  const values = [{value:input.flatTypeId,isId:true},{value:input.flatType,isId:false}].filter(item => item.value !== undefined);
  if (!values.length) return undefined;
  const resolved: {flatTypeId: string | null; flatType: string | null}[] = [];
  for (const {value,isId} of values) {
    if (value === null || value === "") { resolved.push({flatTypeId:null, flatType:null}); continue; }
    if (typeof value !== "string") throw new ResidentFlatTypeError("flatTypeId/flatType must be text or null.");
    const text = value.trim();
    if (!text) { resolved.push({flatTypeId:null, flatType:null}); continue; }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
    if (isId && !uuid) throw new ResidentFlatTypeError("flatTypeId must be a valid UUID.");
    let query = client.from("SSP_Flat_Type").select("flat_type_id,flat_type")
      .eq("society", societyId).eq("active", true);
    query = uuid ? query.eq("flat_type_id", text) : query.ilike("flat_type", text.replace(/[\\%_]/g,"\\$&"));
    const {data,error} = await query.maybeSingle();
    if (error) {
      if (error.code === "PGRST116") throw new ResidentFlatTypeError("Multiple flat types match; send flatTypeId.");
      throw new Error(error.message);
    }
    if (!data) throw new ResidentFlatTypeError("Active flat type not found in this society.");
    resolved.push({flatTypeId:data.flat_type_id,flatType:data.flat_type});
  }
  if (new Set(resolved.map(row=>row.flatTypeId)).size > 1) throw new ResidentFlatTypeError("Conflicting flatTypeId and flatType.");
  return resolved[0];
}

export function residentFlatTypeFields(row: any) {
  const related = Array.isArray(row.flatTypeRecord) ? row.flatTypeRecord[0] : row.flatTypeRecord;
  return {flatTypeId: row.flat_type_id ?? null, flatType: related?.flat_type ?? null};
}
