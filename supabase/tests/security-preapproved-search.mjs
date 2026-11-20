// Run: node supabase/tests/security-preapproved-search.mjs
import {readFileSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../functions/visitor-pass-operations/index.ts',import.meta.url),'utf8');
stripTypeScriptTypes(source);
const start=source.indexOf('          const searchValue =',source.indexOf('if (currentAction === "FETCH_PRE_APPROVALS")'));
const end=source.indexOf('          const {\n            data: preApprovedRows',start);
const code=stripTypeScriptTypes(source.slice(start,end))+'\nreturn buildBaseQuery();';
function build(requestObj={}) {
 const params={};
 const query={select(value){params.select=value;return this},eq(key,value){params[key]='eq.'+value;return this},or(value){assert.equal(params.or,undefined);params.or='('+value+')';return this},ilike(key,value){params[key]='ilike.'+value;return this}};
 new Function('requestObj','searchTerm','supabaseAdmin','societyId',code)(requestObj,requestObj.searchTerm,{from:()=>query},'74628c82-7e11-4f5a-952a-d062193b3fb9');
 params.pre_approved='eq.true';params.limit='100';params.order='created_at.desc';
 return params;
}
const cases=[{}, {searchTerm:'Sumit Guest'},{searchTerm:'6454548484'},{searchTerm:'25046'},{flatNumber:'25046'},{searchTerm:'Sumit Guest',flatNumber:'25046'}];
const queries=cases.map(build);
for(const query of queries){assert.equal(query.society,'eq.74628c82-7e11-4f5a-952a-d062193b3fb9');assert.ok(query.or.includes('visitor_status.ilike.expected'));}
assert.ok(queries[1].select.includes('search_host:SSP_Society_User!hosted_by()'));
assert.ok(queries[1].or.startsWith('(and(or('));
assert.equal(queries[3]['search_host.unit_flat_number'],'ilike.%25046%');
assert.ok(queries[4].select.includes('!hosted_by!inner('));
assert.equal(queries[4]['hosted_by.unit_flat_number'],'eq.25046');
assert.equal(build({societyUserId:'owner'}).hosted_by,'eq.owner');
const special=build({searchTerm:'Guest, "Special"'});assert.ok(special.or.includes('\\"Special\\"'));
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(queries));
console.log('Security search syntax, expected-status inclusion, combined filters, flat search, host scoping, special-character and pagination-query checks passed.');
