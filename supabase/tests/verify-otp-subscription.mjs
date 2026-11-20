import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const society={society_id:'society',society_name:'Example Society',registration_number:'TEST'};
const member={user_id:'member',role:['Resident'],one_time_password_otp:'123456',contact:{contact_id:'contact',name:'Resident',phone:'9000000000',email:'resident@example.com',parking_slot:'P1'},society};
const vendor={non_society_user_id:'vendor',vendor_id:'vendor-profile',name:'Vendor',phone_number:'9000000000',email:'vendor@example.com',one_time_password:'123456',society};
let vendorMode=false,plan='PREMIUM',failure=false,calls=0,updates=0,handler;
class Query {
 constructor(table){this.table=table;this.write=false}
 select(){return this} is(){return this} eq(){return this} ilike(){return this}
 update(){this.write=true;return this}
 result(){if(this.write){updates++;return {data:null,error:null}}return {data:this.table==='SSP_Society_User'?(vendorMode?[]:[member]):(vendorMode?[vendor]:[]),error:null}}
 then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
 async maybeSingle(){return {data:null,error:null}}
}
const client={from:t=>new Query(t),rpc:async(name,args)=>{calls++;assert.equal(name,'get_my_subscription_summary');assert.equal(args.p_user_id,'member');return {data:plan===null?null:{plan:{plan_code:plan}},error:failure?{message:'unavailable'}:null}}};
const source=stripTypeScriptTypes(readFileSync('supabase/functions/verify-otp/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','createClient','optionalAuth','corsHeaders','firstOrNull','parseRequestBody','console',source+'\ngenerateJwtToken = async () => "token"; getOrCreateAuthUser = async () => ({id:"auth"});')({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},v=>Array.isArray(v)?v[0]:v,r=>r.json(),{log(){},error(){}});
async function run(otp='123456'){calls=0;updates=0;const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({phoneNumber:'9000000000',registrationNumber:'TEST',otp})}));return {status:response.status,body:await response.json()}}
for(plan of ['PREMIUM','FREE',null]){const r=await run();assert.equal(r.status,200);assert.equal(r.body.user.subscriptionPlan,plan);assert.equal(r.body.token,'token');assert.equal(r.body.user.id,'member');assert.deepEqual(r.body.user.roles,['resident']);assert.equal(r.body.user.society.id,'society');assert.ok(!JSON.stringify(r.body).includes('parking'));assert.equal(calls,1);assert.equal(updates,1)}
assert.equal((await run('wrong')).status,401);assert.equal(calls,0);assert.equal(updates,0);
failure=true;assert.equal((await run()).status,500);assert.equal(updates,0);failure=false;
vendorMode=true;const result=await run();assert.equal(result.status,200);assert.equal(result.body.user.subscriptionPlan,null);assert.equal(result.body.user.vendorId,'vendor-profile');assert.deepEqual(result.body.user.roles,['vendor']);assert.equal(calls,0);assert.ok(!JSON.stringify(result.body).includes('parking'));
console.log('verify-otp passed: paid/free/missing plans, unchanged login fields, vendor login, parking removal, invalid OTP and subscription failure.');
