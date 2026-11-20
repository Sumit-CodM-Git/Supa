import {visitorTimeISTISO} from '../functions/_shared/visitor-time.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const records=[
 {non_society_user_id:'a',created_at:'2026-11-10T09:00:00Z',check_in:'2026-11-15T09:00:00Z',purpose:'Guest'},
 {non_society_user_id:'b',created_at:'2026-11-11T09:00:00Z',check_in:null,purpose:'Delivery'},
 {non_society_user_id:'c',created_at:'2026-11-11T10:00:00Z',check_in:'2026-11-11T10:00:00Z',purpose:'Visitor'},
 {non_society_user_id:'d',created_at:'2026-11-11T10:00:00Z',check_in:null,purpose:'Guest'},
 {non_society_user_id:'e',created_at:null,check_in:'2026-11-16T09:00:00Z',purpose:'Legacy'}
].map(r=>({...r,society:'society',role:'visitor',name:r.purpose,phone_number:'9000000000',visitor_status:'pending',visitor_approval_status:'pending'}));
let handler;
class Query{
 constructor(table){this.table=table;this.orders=[];this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}in(){return this}not(){return this}or(){return this}
 order(key,options){this.orders.push([key,options]);return this}
 async maybeSingle(){return {data:{society_id:'society'},error:null}}
 then(resolve,reject){const data=this.table==='SSP_Non_Society_User'?records.filter(r=>this.filters.every(f=>f(r))).sort((a,b)=>{for(const [k,o]of this.orders){if(a[k]===b[k])continue;if(a[k]==null)return o.nullsFirst? -1:1;if(b[k]==null)return o.nullsFirst?1:-1;return (a[k]<b[k]?-1:1)*(o.ascending?1:-1)}return 0}):[];return Promise.resolve({data,error:null}).then(resolve,reject)}
}
const source=stripTypeScriptTypes(readFileSync('supabase/functions/get-visitors/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
class Validator{validateRequired(){return this}isValid(){return true}}
new Function('Deno','createClient','requireAuth','corsHeaders','errorResponse','successResponse','logger','sanitizeString','Validator','contactParkingSlot','visitorTimeISTISO',source)({env:{get:()=>''},serve:fn=>handler=fn},()=>({from:t=>new Query(t)}),fn=>req=>fn(req,{user:{id:'admin'}}),{},m=>Response.json({error:m},{status:400}),v=>Response.json({success:true,data:v}),{info(){},warn(){},error(){}},s=>s,Validator,()=>null,visitorTimeISTISO);
async function run(page,extra={}){const r=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({societyRegistrationNumber:'TEST',page,limit:2,...extra})}));assert.equal(r.status,200);return (await r.json()).data}
const first=await run(1);assert.equal(first.total,5);assert.deepEqual(first.visitors.map(v=>v.visitorId),['d','c']);assert.equal(first.visitors[0].checkIn,null);
assert.deepEqual((await run(2)).visitors.map(v=>v.visitorId),['b','a']);
assert.deepEqual((await run(3)).visitors.map(v=>v.visitorId),['e']);
assert.deepEqual((await run(1,{search:'Delivery'})).visitors.map(v=>v.visitorId),['b']);
console.log('Admin visitor ordering passed: newest additions, pending delivery/guest, future check-ins, stable ties, null dates, pagination and search.');
