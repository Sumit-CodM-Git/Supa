// The configured society rows, rather than global picklists or occupied flats,
// are the source for location and flat-type dropdowns for every member role.
export interface SocietyConfigurationRows {
  towers: any[];
  blocks: any[];
  flatTypes: any[];
}

export class SocietyConfigurationInputError extends Error {}

/** null means do not constrain management lists by active status. */
export function parseConfigurationActiveFilter(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "" || text === "all") return null;
    if (text === "true" || text === "active") return true;
    if (text === "false" || text === "inactive") return false;
  }
  throw new SocietyConfigurationInputError("filters.active must be all, active, inactive, true, or false.");
}

/** Normalize UI IDs/names to a valid reference in the same society. */
export async function resolveSocietyLocation(
  client: any, societyId: string, kind: "tower" | "block", values: unknown[],
): Promise<string | null | undefined> {
  const supplied = values.filter(value => value !== undefined);
  if (!supplied.length) return undefined;
  const table = kind === "tower" ? "SSP_Tower" : "SSP_Block";
  const id = kind === "tower" ? "tower_id" : "block_id";
  const label = kind === "tower" ? "name" : "block_name";
  const resolved: (string | null)[] = [];
  for (const value of supplied) {
    if (value === null || value === "") { resolved.push(null); continue; }
    if (typeof value !== "string") throw new SocietyConfigurationInputError(`${kind} must be an ID, name, or null.`);
    const text = value.trim();
    if (!text) { resolved.push(null); continue; }
    let query = client.from(table).select(id).eq("society", societyId).eq("active", true);
    query = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
      ? query.eq(id, text) : query.ilike(label, text.replace(/[\\%_]/g, "\\$&"));
    const { data, error } = await query.maybeSingle();
    if (error) {
      if (error.code === "PGRST116") throw new SocietyConfigurationInputError(`Multiple ${kind}s match this name. Send its ID.`);
      throw new Error(error.message);
    }
    if (!data) throw new SocietyConfigurationInputError(`Active ${kind} not found in this society.`);
    resolved.push(data[id]);
  }
  if (new Set(resolved).size > 1) throw new SocietyConfigurationInputError(`Conflicting ${kind} references supplied.`);
  return resolved[0];
}

export async function loadSocietyConfiguration(client: any, societyId: string): Promise<SocietyConfigurationRows> {
  async function all(table: string, columns: string, name: string, id: string, active = false) {
    const rows: any[] = [];
    const size = 500;
    for (let offset = 0; ; offset += size) {
      let query = client.from(table).select(columns).eq("society", societyId);
      if (active) query = query.eq("active", true);
      const { data, error } = await query.order(name, { ascending: true })
        .order(id, { ascending: true }).range(offset, offset + size - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < size) return rows;
    }
  }
  const [towers, blocks, flatTypes] = await Promise.all([
    all("SSP_Tower", "tower_id,created_at,active,society,block,name,floors,flats_per_floor", "name", "tower_id", true),
    all("SSP_Block", "block_id,created_at,active,society,tower,block_name", "block_name", "block_id"),
    all("SSP_Flat_Type", "flat_type_id,created_at,flat_type,maintenance_charges,society", "flat_type", "flat_type_id", true),
  ]);
  return { towers, blocks, flatTypes };
}

export function formatSocietyConfiguration(rows: SocietyConfigurationRows) {
  return {
    towers: rows.towers.map(row => ({ towerId: row.tower_id, name: row.name, blockId: row.block ?? null })),
    blocks: rows.blocks.map(row => ({ blockId: row.block_id, blockName: row.block_name, towerId: row.tower ?? null })),
    flatTypes: rows.flatTypes.map(row => ({ flatTypeId: row.flat_type_id, flatType: row.flat_type })),
  };
}

export async function societyConfigurationVersion(societyId: string, configuration: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify({ societyId, configuration }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
