import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createResidentPlanLookup} from '../functions/_shared/resident-subscription-plan.ts';
const quiet={info(){},warn(){},error(){}};
const society='society';
const rows=[
 {user_id:'p1',subscription_tower:'t1',subscription_block:'b1'},
 {user_id:'p2',subscription_tower:'t1',subscription_block:'b1'},
 {user_id:'g',subscription_tower:'t2',subscription_block:'b1'},
 {user_id:'f',subscription_tower:'t3',subscription_block:'b1'},
 {user_id:'s',subscription_tower:'t1',subscription_block:'b2'},
 {user_id:'outside',subscription_tower:'t1',subscription_block:'b1',society:'other'},
 {user_id:'secondary',subscription_tower:'t1',subscription_block:'b1',user_ownership_type:'secondary'},
].map((r,i)=>({society,unit_flat_number:'101',user_ownership_type:'primary',block:{block_name:'B'},tower:{name:'Shared label'},contact:{name:'Resident '+r.user_id,phone:'9000000000',parking_slot:'P1'},created_at:String(i),...r}));
let calls=[],failure=false;
const plans={'t1:b1':'PREMIUM','t2:b1':'growth','t3:b1':null,'t1:b2':'STARTER'};
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(text){if(this.table==='SSP_Society_User'){assert.match(text,/subscription_tower:tower/);assert.match(text,/subscription_block:block/);}return this;}
 eq(path,v){this.filters.push(r=>path.split('.').reduce((o,k)=>o?.[k],r)===v);return this;}
 order(){return this;}range(start,end){this.page=[start,end];return this;}
 async maybeSingle(){return {data:{society_id:society},error:null};}
 then(resolve,reject){const matching=rows.filter(r=>this.filters.every(f=>f(r)));return Promise.resolve({data:this.page?matching.slice(this.page[0],this.page[1]+1):matching,count:matching.length,error:null}).then(resolve,reject);}
}
const client={from:t=>new Query(t),rpc:async(name,args)=>{
 assert.equal(name,'get_current_plan_code');assert.equal(args.p_society,society);assert.equal(args.p_flat,'101');calls.push(args);
 return {data:plans[args.p_tower+':'+args.p_block],error:failure&&args.p_tower==='t2'?{message:'billing unavailable'}:null};
}};
let handler;
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/visitor-pass-operations/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','createClient','requireAuth','corsHeaders','successResponse','errorResponse','createLogger','contactParkingSlot','createResidentPlanLookup',source)(
 {env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},data=>Response.json({success:true,data}),(message,status=400)=>Response.json({success:false,message},{status}),()=>quiet,c=>c?.parking_slot??null,createResidentPlanLookup,
);
async function fetch(extra={}){
 const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({actionType:'FETCH_RESIDENTS_BY_FLAT',societyRegistrationNumber:'TEST',flatNumber:'101',page:1,limit:20,...extra})}),{user:{id:'guard'}});
 assert.equal(response.status,200);return (await response.json()).data;
}
let data=await fetch();assert.deepEqual(data.residents.map(r=>r.subscriptionPlan),['PREMIUM','PREMIUM','GROWTH','FREE','STARTER']);assert.equal(calls.length,4,'Co-residents share one lookup while different block/tower IDs remain distinct');
assert.deepEqual(data.residents[0],{subscriptionPlan:'PREMIUM',parkingSlot:'P1',phoneNumber:'9000000000',name:'Resident p1',flatNumber:'101',blockName:'B',towerNumber:'Shared label',societyUserId:'p1'});
assert.equal(data.pagination.totalRecords,5);assert.equal(data.residents.some(r=>['outside','secondary'].includes(r.societyUserId)),false);
calls=[];data=await fetch({page:2,limit:2});assert.deepEqual(data.residents.map(r=>r.societyUserId),['g','f']);assert.deepEqual(data.pagination,{currentPage:2,pageSize:2,totalRecords:5,totalPages:3});assert.equal(calls.length,2);
failure=true;data=await fetch();assert.equal(data.residents.find(r=>r.societyUserId==='g').subscriptionPlan,null);assert.equal(data.residents.find(r=>r.societyUserId==='p1').subscriptionPlan,'PREMIUM');failure=false;
calls=[];data=await fetch({flatNumber:'missing'});assert.deepEqual(data.residents,[]);assert.equal(calls.length,0);
let cachedCalls=0,current='PREMIUM';
const billing={rpc:async()=>{cachedCalls++;return {data:current,error:null};}};
const lookup=createResidentPlanLookup(billing,society);
assert.deepEqual(await Promise.all([lookup({unit_flat_number:' a-101 '}),lookup({unit_flat_number:'A-101'})]),['PREMIUM','PREMIUM']);assert.equal(cachedCalls,1);
current='FREE';assert.equal(await createResidentPlanLookup(billing,society)({unit_flat_number:'A-101'}),'FREE','New requests must see changed subscriptions');
console.log('Resident subscription field passed: all plan types, Free fallback, flat-scoped lookup/cache, distinct block/tower identities, pagination/ownership preservation, empty results, billing outage and fresh next-request plans.');
