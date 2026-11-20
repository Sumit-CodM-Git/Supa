/** Request-scoped billing lookups, shared by residents in the same flat.
 * A billing outage must not prevent security from selecting a resident.
 */
export function createResidentPlanLookup(client: any, societyId: string) {
  const cache = new Map<string,Promise<string|null>>();
  return (row: Record<string,unknown>): Promise<string|null> => {
    const tower = row.subscription_tower ?? null;
    const block = row.subscription_block ?? null;
    const flat = row.unit_flat_number ?? null;
    const key = JSON.stringify([tower,block,String(flat??"").trim().toUpperCase()]);
    if (!cache.has(key)) {
      cache.set(key,(async()=>{
        try {
          const {data,error} = await client.rpc("get_current_plan_code",{
            p_society:societyId,p_tower:tower,p_block:block,p_flat:flat,
          });
          if (error || (data!=null && typeof data!=="string")) throw new Error("Plan lookup failed");
          return String(data??"FREE").trim().toUpperCase() || "FREE";
        } catch {
          console.warn("Resident subscription plan unavailable; resident details are preserved.");
          return null;
        }
      })());
    }
    return cache.get(key)!;
  };
}
