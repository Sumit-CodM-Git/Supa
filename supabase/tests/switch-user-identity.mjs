import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
import{contactParkingSlot}from'../functions/_shared/contact.ts';import{parkingCounts}from'../functions/_shared/parking-counts.ts';
const memberId='00000000-0000-4000-8000-000000000001',authId='00000000-0000-4000-8000-000000000099',vendorId='00000000-0000-4000-8000-000000000002';
const society={society_id:'society',society_name:'Example',registration_number:'TEST',parking_slot:'100',covered_parking:20};
const user={user_id:memberId,society:'society',contact:{contact_id:'contact',name:'RPS Admin',phone:'9000000000'},role:['admin','resident'],deleted_at:null,status:true,unit_flat_number:'101'};
const vendor={non_society_user_id:vendorId,society:'society',phone_number:'9000000000',role:'vendor',name:'Example Vendor'};
let authUser={id:authId,user_metadata:{user_id:memberId}},lookupFailure=false;
class Query{
 constructor(table){this.table=table;this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this}ilike(){return this}not(){return this}gte(){return this}range(){return this}in(){return this}
 result(){if(lookupFailure&&this.table==='SSP_Society_User')return{data:null,error:{message:'DB error'}};const table=this.table==='SSP_Society'?[society]:this.table==='SSP_Society_User'?[user]:this.table==='SSP_Non_Society_User'?[vendor]:[];const data=table.filter(r=>this.filters.every(f=>f(r))).map(r=>({...r}));return{data,count:data.length,error:null}}
 async maybeSingle(){const r=this.result();return{...r,data:r.data?.[0]??null}}then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
}
let handler;const client={from:t=>new Query(t),auth:{getUser:async()=>({data:{user:authUser},error:null})}};
const source=stripTypeScriptTypes(readFileSync('supabase/functions/switch-user/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','createClient','contactParkingSlot','parkingCounts',source)({env:{get:()=>''},serve:fn=>handler=fn},()=>client,contactParkingSlot,parkingCounts);
async function run(role,phoneNumber='9000000000'){const r=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer verified-in-test'},body:JSON.stringify({phoneNumber,registrationNumber:'TEST',role})}));return{status:r.status,body:await r.json()}}
for(const role of ['Admin','Resident']){const r=await run(role);assert.equal(r.status,200);assert.equal(r.body.matched,true);assert.equal(r.body.userDetail.societyUserID,memberId);assert.equal(r.body.userDetail.role,role);assert.ok(r.body.roles.includes('Admin')&&r.body.roles.includes('Resident'));assert.ok(!('subscriptionPlan'in r.body.societyDetail))}
// Legacy sessions whose auth ID already equals the application ID remain supported.
authUser={id:memberId,user_metadata:{}};assert.equal((await run('Resident')).body.matched,true);
// A verified vendor can access their linked roles, but knowing a vendor phone does not authorize another account.
authUser={id:authId,user_metadata:{user_id:vendorId}};assert.equal((await run('Vendor')).body.matched,true);
authUser={id:'unrelated',user_metadata:{user_id:'unrelated'}};assert.equal((await run('Vendor')).status,403);
authUser={id:authId,user_metadata:{user_id:memberId}};assert.equal((await run('Resident','9111111111')).status,403);
lookupFailure=true;assert.equal((await run('Resident')).status,500);lookupFailure=false;
user.deleted_at='2026-11-11';assert.equal((await run('Resident')).status,403);user.deleted_at=null;
console.log('Role switching passed: distinct auth/app IDs, admin/resident switches, legacy sessions, vendor identity, foreign phone/account rejection, DB failures and removed members.');
