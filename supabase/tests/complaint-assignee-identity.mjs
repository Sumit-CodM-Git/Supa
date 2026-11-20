import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
let complaint={complaint_id:'c',assigned_agent:null,non_society_user:'vendor'};
let vendor={non_society_user_id:'vendor',society:'society',role:'vendor',phone_number:'+91 90000 00000',deleted_at:null};
let caller={user_id:'member',society:'society',deleted_at:null,contact:{phone:'+91 90000 00000'}};
let failTable=null,authReads=0,authLookupId;
class Query{constructor(t){this.t=t;this.filters=[]}select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}async maybeSingle(){if(failTable===this.t)return{data:null,error:{message:'DB error'}};const row=this.t==='SSP_Complaint'?complaint:this.t==='SSP_Non_Society_User'?vendor:caller;return{data:row&&this.filters.every(f=>f(row))?row:null,error:null}}}
const client={from:t=>new Query(t),auth:{admin:{getUserById:async id=>{authReads++;authLookupId=id;return{data:{user:{phone:'+919000000000'}},error:null}}}}};
const source=stripTypeScriptTypes(readFileSync('supabase/functions/_shared/staff.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export /gm,''));
const resolve=new Function('Deno','createClient',source+';return resolveComplaintAssignee;')({env:{get:()=>''}},()=>client);
const run=(id='member',extra={})=>resolve({complaintId:'c',callerAuthId:id,...extra});
assert.equal((await run()).role,'VENDOR');assert.equal(authReads,0);
assert.equal((await run('vendor')).role,'VENDOR');
caller.contact=[{phone:'9000000000'}];assert.equal((await run()).ok,true);
caller.society='other';assert.equal((await run()).code,403);caller.society='society';
caller.contact={phone:'9111111111'};assert.equal((await run()).code,403);caller.contact={phone:'9000000000'};
caller.deleted_at='deleted';assert.equal((await run()).code,403);caller.deleted_at=null;
vendor.deleted_at='deleted';assert.equal((await run()).code,403);vendor.deleted_at=null;
vendor.role='visitor';assert.equal((await run()).code,403);vendor.role='vendor';
for(failTable of ['SSP_Complaint','SSP_Non_Society_User','SSP_Society_User'])assert.equal((await run()).code,500);failTable=null;
const saved=caller;caller=null;assert.equal((await run('legacy',{callerAuthUserId:'auth-user'})).role,'VENDOR');assert.equal(authLookupId,'auth-user');caller=saved;
// Shared-contact / legacy vendor login accepts formatted stored phones by normalized digits,
// while still validating the exact vendor assigned to this complaint.
complaint={complaint_id:'c',assigned_agent:null,non_society_user:'vendor'};
assert.equal((await run('legacy',{callerAuthUserId:'auth-user',callerPhone:'919000000000'})).role,'VENDOR');
assert.equal((await run('legacy',{callerAuthUserId:'auth-user',callerPhone:'9000'})).code,403);
const previousPhone=vendor.phone_number;vendor.phone_number='9888888888';
assert.equal((await run('legacy',{callerAuthUserId:'auth-user',callerPhone:'919000000000'})).code,403);
vendor.phone_number=previousPhone;
complaint={complaint_id:'c',assigned_agent:'member',non_society_user:null};assert.equal((await run()).role,'SERVICE_AGENT');assert.equal((await run('foreign')).code,403);
complaint=null;assert.equal((await run()).code,404);
console.log('Complaint assignee identity passed: multi-role member/vendor IDs, direct vendor, normalized phones, relation arrays, foreign society/phone, removed profiles, roles, legacy auth ID, DB errors and service-agent isolation.');
