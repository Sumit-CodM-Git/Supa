// Run with Node 26: node supabase/tests/subscription-orders.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const periods=['monthly','quarterly','half_yearly','yearly','three_year'];
async function run(name,billingPeriod,options={}) {
  let handler,orderInput,pricePeriod;
  class ApiError extends Error { constructor(message,status=400){super(message);this.status=status}toResponse(){return new Response(JSON.stringify({message:this.message}),{status:this.status})} }
  class Query {
    constructor(table){this.table=table;this.filters={}}
    select(){return this}eq(key,value){this.filters[key]=value;return this}in(){return this}order(){return this}limit(){return this}insert(){return this}
    async maybeSingle(){
      let data;
      if(this.table==='SSP_Society_User') data={society:'society',tower:null,block:null,unit_flat_number:options.noFlat?null:'101'};
      if(this.table==='SSP_Subscription') {
        if(options.lookupError) return {data:null,error:{message:'Lookup failed'}};
        data=options.missingSubscription?null:{subscription_id:'existing-sub',owner_society_user:options.otherOwner?'other':'user',plan:{plan_code:options.existingPlan??'FREE'}};
      }
      if(this.table==='SSP_Subscription_Plan') data=this.filters.plan_code?{plan_id:'premium',plan_code:'PREMIUM',plan_name:'Premium',sort_order:2}:{plan_id:'basic',plan_code:'BASIC',plan_name:'Basic',sort_order:1};
      if(this.table==='SSP_Subscription_Plan_Price') {
        pricePeriod=this.filters.billing_period;
        data=periods.includes(pricePeriod)?{plan_price_id:'price',amount:'199',currency:'INR',validity_months:1}:null;
      }
      return {data,error:null};
    }
    then(resolve,reject){return Promise.resolve({data:[{subscription_id:'sub',plan_id:'basic',tower:null,block:null,owner_society_user:options.otherOwner?'other':'user',status:'active'}],error:null}).then(resolve,reject)}
  }
  const client={from:table=>new Query(table),rpc:async()=>({data:options.denied?{allowed:false,reason:'Not eligible'}:options.existingPlan?{allowed:false,reason:'This flat already has an active subscription.',subscription_id:'existing-sub'}:{allowed:true},error:options.rpcError?{message:'Eligibility failed'}:null})};
  const source=stripTypeScriptTypes(readFileSync(new URL(`../functions/${name}/index.ts`,import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
  const fail=(message,status=400)=>new Response(JSON.stringify({message}),{status});
  const success=data=>new Response(JSON.stringify({success:true,data}));
  const flat=async()=>options.noFlat?null:{society:'society',tower:null,block:null,flatNumber:'101'};
  new Function('serve','requireAuth','withRateLimit','errorResponse','successResponse','ApiError','badRequest','notFound','serverError','isValidBillingPeriod','serviceClient','getFlatForUser','logger','createOrder','getKeyId','isTestMode',source)
    (fn=>handler=fn,fn=>fn,()=>fn=>fn,fail,success,ApiError,msg=>new ApiError(msg),msg=>new ApiError(msg,404),msg=>new ApiError(msg,500),value=>periods.map(p=>p.toUpperCase()).includes(value),()=>client,flat,{info(){},error(){}},async input=>{orderInput=input;return{id:'order_mock'}},()=> 'rzp_test_mock',()=>true);
  const response=await handler(new Request('https://test.example',{method:'POST',body:JSON.stringify({planCode:'PREMIUM',newPlanCode:'PREMIUM',action:'UPGRADE',billingPeriod})}),{user:{id:'user'}});
  return {status:response.status,body:await response.json(),orderInput,pricePeriod};
}
let scenarios=0;
for(const name of ['create-razorpay-order','upgrade-subscription','renew-subscription','manage-subscription-payment']) {
  for(const period of periods) for(const casing of [period,period.toUpperCase()]) {
    const result=await run(name,casing);
    assert.equal(result.status,200,`${name}: ${JSON.stringify(result.body)}`);
    assert.equal(result.pricePeriod,period);
    assert.equal(result.orderInput.amount,19900);
    assert.equal(result.body.data.orderId,'order_mock');
    assert.equal(result.body.data.amount,19900);
    scenarios++;
  }
  const invalid=await run(name,'invalid');assert.equal(invalid.status,400);assert.equal(invalid.orderInput,undefined);scenarios++;
  const missingFlat=await run(name,'monthly',{noFlat:true});assert.equal(missingFlat.status,400);assert.equal(missingFlat.orderInput,undefined);scenarios++;
  if(name!=='create-razorpay-order') {const other=await run(name,'monthly',{otherOwner:true});assert.equal(other.status,400);assert.equal(other.orderInput,undefined);scenarios++;}
}
console.log(`${scenarios} subscription order regression scenarios passed; no real Razorpay calls or charges made.`);

for(const options of [
  {existingPlan:'FREE'},
  {existingPlan:'FREE',otherOwner:true},
  {existingPlan:'PREMIUM'},
  {existingPlan:'STARTER'},
  {existingPlan:'FREE',missingSubscription:true},
  {existingPlan:'FREE',lookupError:true},
  {rpcError:true},
  {denied:true},
]) {
  const result=await run('create-razorpay-order','monthly',options);
  const allowed=options.existingPlan==='FREE' && Object.keys(options).length===1;
  assert.equal(result.status,allowed?200:(options.lookupError||options.rpcError)?500:403,JSON.stringify(options));
  if(allowed) {
    assert.equal(result.orderInput.notes.payment_purpose,'upgrade');
    assert.equal(result.orderInput.notes.renewing_subscription_id,'existing-sub');
    assert.equal(result.orderInput.notes.plan_code,'PREMIUM');
  } else assert.equal(result.orderInput,undefined);
}
const fresh=await run('create-razorpay-order','monthly');
assert.equal(fresh.orderInput.notes.payment_purpose,'new');
assert.equal(fresh.orderInput.notes.renewing_subscription_id,undefined);
console.log('9 FREE purchase routing and eligibility regression scenarios passed.');
