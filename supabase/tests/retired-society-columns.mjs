import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const societies=[{society_id:'A',society_name:'Alpha',registration_number:'REG-A'},{society_id:'B',society_name:'Beta',registration_number:'REG-B'}];
const memberships=[{user_id:'admin',society:'A',deleted_at:null},{user_id:'admin',society:'B',deleted_at:'2026-01-01'}];
const calls=[];
class Query {
 constructor(table){this.table=table;this.filters=[]}
 select(columns){assert.ok(!/subscription_plan|flat_type/.test(columns));calls.push({table:this.table,columns});return this}
 eq(k,v){assert.ok(!['id','created_by','subscription_plan','flat_type'].includes(k));this.filters.push(row=>row[k]===v);return this}
 in(k,v){this.filters.push(row=>v.includes(row[k]));return this}
 is(k,v){this.filters.push(row=>row[k]===v);return this}
 ilike(k,v){assert.ok(!/subscription|flat_type/.test(k));this.filters.push(row=>String(row[k]).toLowerCase().includes(v.replaceAll('%','').toLowerCase()));return this}
 range(a,b){this.slice=[a,b];return this}
 result(){let rows=(this.table==='SSP_Society'?societies:memberships).filter(row=>this.filters.every(f=>f(row)));const count=rows.length;if(this.slice)rows=rows.slice(this.slice[0],this.slice[1]+1);return {data:rows.map(row=>this.table==='SSP_Society'?{society_name:row.society_name,registration_number:row.registration_number}:{society:row.society}),count,error:null}}
 async single(){const r=this.result();return r.data.length?{...r,data:r.data[0]}:{data:null,error:{code:'PGRST116'}}}
 then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
}
let handler,auth=null;
const source=stripTypeScriptTypes(readFileSync('supabase/functions/get-societies/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','optionalAuth','corsHeaders','errorResponse','getPaginationParams','getSearchParams','createClient',source)({env:{get:()=>''},serve:fn=>handler=fn},fn=>req=>fn(req,auth),{},(message,status=400)=>new Response(JSON.stringify({message}),{status}),url=>{const page=Number(url.searchParams.get('page')||1),limit=Number(url.searchParams.get('limit')||20);return{page,limit,offset:(page-1)*limit}},url=>Object.fromEntries(url.searchParams),()=>({from:table=>new Query(table)}));
async function run(path=''){const response=await handler(new Request('https://test/get-societies'+path));return {status:response.status,body:await response.json()}}
let r=await run();assert.equal(r.status,200);assert.equal(r.body.societies.length,2);assert.deepEqual(r.body.societies[0],{society_name:'Alpha',registration_number:'REG-A'});
r=await run('?subscription_plan=premium&flat_type=old&subscriptionPlan=old&flatType=old&society_name=Alpha');assert.equal(r.status,200);assert.equal(r.body.societies.length,1);
r=await run('?page=2&limit=1');assert.equal(r.body.societies[0].society_name,'Beta');assert.equal(r.body.pagination.total,2);
assert.equal((await run('/me')).status,401);auth={user:{id:'admin',email:'admin@example.com'}};r=await run('/me');assert.equal(r.status,200);assert.deepEqual(r.body.societies,[{society_name:'Alpha',registration_number:'REG-A'}]);assert.equal(r.body.user.id,'admin');
assert.equal((await run('/A')).body.society.society_name,'Alpha');assert.equal((await run('/missing')).status,404);
auth={user:{id:'no-memberships'}};assert.deepEqual((await run('/me')).body.societies,[]);
console.log('Society column removal passed: list, legacy filters, supported filters, pagination, authenticated membership, single-ID lookup, missing record and empty membership.');
