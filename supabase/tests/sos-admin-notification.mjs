import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const source = readFileSync(new URL('../functions/send-sos-push/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function notifySocietyAdmins(');
const end = source.indexOf('// ── Audit log helper', start);
const notify = new Function('CONCURRENCY', `${stripTypeScriptTypes(source.slice(start, end))}\nreturn notifySocietyAdmins;`)(20);
const calls = [];
let rows = [{ user_id: 'admin-1' }, { user_id: 'admin-1' }, { user_id: 'admin-2' }];
let queryError = null;
const query = {
  select(...args) { calls.push(['select', ...args]); return this; },
  eq(...args) { calls.push(['eq', ...args]); return this; },
  is(...args) { calls.push(['is', ...args]); return this; },
  overlaps(...args) { calls.push(['overlaps', ...args]); return Promise.resolve({ data: rows, error: queryError }); },
};
const client = { from(table) { calls.push(['from', table]); return query; } };
const sent = [];
const payload = { title: 'SOS', data: { alertType: 'stuck_in_lift', residentName: 'Aarav Sharma' } };
const send = async (...args) => { sent.push(args); return { totalTokens: 2, sent: 1, failed: 1, deactivated: 1 }; };
assert.deepEqual(await notify(client, 'society-1', payload, send), { adminCount: 2, totalDevices: 4, sent: 2, failed: 2, deactivated: 2 });
assert.deepEqual(calls, [['from', 'SSP_Society_User'], ['select', 'user_id'], ['eq', 'society', 'society-1'], ['eq', 'status', true], ['is', 'deleted_at', null], ['overlaps', 'role', ['admin', 'society_admin']]]);
assert.deepEqual(sent.map((args) => [args[1], args[2], args[3]]), [['admin-1', payload, 'society_user'], ['admin-2', payload, 'society_user']]);
rows = [];
assert.equal((await notify(client, 'society-1', payload, send)).adminCount, 0);
assert.equal(sent.length, 2);
queryError = new Error('Lookup failed');
await assert.rejects(notify(client, 'society-1', payload, send), /Lookup failed/);
assert.ok(source.indexOf('const adminDelivery = await notifySocietyAdmins') < source.indexOf('if (!staffList || staffList.length === 0)', source.indexOf('const adminDelivery = await notifySocietyAdmins')));
console.log('SOS admin routing passed: society, roles, active/non-deleted filters, deduplication, payload, delivery totals, empty recipients, and lookup errors.');
