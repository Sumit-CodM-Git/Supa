// Run with Node 26: node supabase/tests/crud-tower-counts.mjs
import assert from 'node:assert/strict';
import {parseConfigurationActiveFilter,resolveSocietyLocation,SocietyConfigurationInputError} from '../functions/_shared/society-configuration.ts';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../functions/crud-tower/index.ts', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, ''));
async function invoke(payload, { action = 'UPDATE', dbError = null, found = true } = {}) {
  let handler, saved;
  const filters = [];
  const row = { tower_id: '66047a4f-134e-48de-a410-bc67f960a03c', society: 'society', name: 'Tower', active: true, floors: 5, flats_per_floor: 4 };
  const client = { from(table) {
    return {
      select() { return this; },
      eq(key, value) { filters.push([table, key, value]); return this; },
      contains() { return this; },
      update(value) { saved = value; return this; },
      insert(value) { saved = value; return this; },
      async maybeSingle() {
        if (table === 'SSP_Society') return { data: { society_id: 'society' }, error: null };
        if (table === 'SSP_Society_User') return { data: { user_id: 'admin', role: ['admin'] }, error: null };
        return { data: found ? { ...row, ...saved } : null, error: dbError };
      },
      async single() { return this.maybeSingle(); },
    };
  }};
  new Function('Deno','serve','createClient','resolveSocietyLocation','SocietyConfigurationInputError','parseConfigurationActiveFilter',source)({ env: { get: () => '' } }, fn => handler = fn, () => client,resolveSocietyLocation,SocietyConfigurationInputError,parseConfigurationActiveFilter);
  const response = await handler(new Request('https://test.example', { method: 'POST', body: JSON.stringify({
    societyRegistrationNumber: 'GZB-1234-ab', adminId: '447b74fd-9c15-4497-a4cb-2e9a8b1e2379',
    towerId: row.tower_id, action, payload,
  }) }));
  return { status: response.status, body: await response.json(), saved, filters };
}
for (const field of ['flats_per_floor']) {
  const result = await invoke({ floors: 12, [field]: 8 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.saved, { floors: 12, flats_per_floor: 8 });
  assert.equal(result.body.data.tower.flatsPerFloor, 8);
  assert.equal(result.body.data.tower.totalFlats, 96);
  assert.ok(result.filters.some(([table,key,value]) => table === 'SSP_Tower' && key === 'society' && value === 'society'));
  assert.equal((await invoke({ [field]: '6' })).body.data.tower.flatsPerFloor, 6);
  assert.equal((await invoke({ [field]: 0 })).body.data.tower.flatsPerFloor, 0);
  const invalid = await invoke({ floors: 10, [field]: -1 });
  assert.equal(invalid.status, 400); assert.equal(invalid.saved, undefined);
  assert.equal((await invoke({ name: 'New', active: true, floors: 10, [field]: 7 }, { action: 'CREATE' })).body.data.tower.flatsPerFloor, 7);
}
assert.deepEqual((await invoke({ floors: 11 })).saved, { floors: 11 });
assert.deepEqual((await invoke({ flats_per_floor: 9 })).saved, { flats_per_floor: 9 });
assert.equal((await invoke({ flatsPerFloor: 5 })).status, 400);
assert.deepEqual((await invoke({ floors: 10, flatsPerFloor: 5 })).saved, { floors: 10 });
assert.equal((await invoke({ flats_per_floor: 8 }, { dbError: { message: 'database error' } })).status, 500);
assert.equal((await invoke({ flats_per_floor: 8 }, { found: false })).status, 404);
console.log('Tower create/update regression checks passed for the single flats_per_floor request field, returned counts, partial updates, zero, validation, society scoping and database errors.');
