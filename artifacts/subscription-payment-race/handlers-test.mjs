import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {db,input,counts} from './database-test.mjs';
import {finalizeSubscriptionPayment} from '../../supabase/functions/_shared/subscription-payment.ts';
let rpcCalls=0;
const client={from(table){return new class{
 filters={};select(){return this}eq(k,v){this.filters[k]=v;return this}insert(){return this}
 async maybeSingle(){if(table==='SSP_Subscription_Plan')return{data:{plan_id:'00000000-0000-4000-8000-000000000002'},error:null};if(table==='SSP_Subscription_Payment'){const r=await db.query('SELECT subscription_id FROM "SSP_Subscription_Payment" WHERE provider_payment_id=$1',[this.filters.provider_payment_id]);return{data:r.rows[0]??null,error:null}}throw new Error('Unexpected table '+table)}
 then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}
 }},async rpc(name,{p_input}){rpcCalls++;assert.equal(name,'finalize_razorpay_subscription_payment');try{return{data:(await db.query('SELECT public.finalize_razorpay_subscription_payment($1::jsonb) AS result',[JSON.stringify(p_input)])).rows[0].result,error:null}}catch(err){return{data:null,error:{message:err.message}}}}};
let registered;
let signatureOk=true;
const i={...input,paymentId:'pay_handlers',orderId:'order_handlers',flatNumber:'105'};
const payment={id:i.paymentId,order_id:i.orderId,status:'captured',amount:i.amountPaise};
const order={id:i.orderId,amount:i.amountPaise,notes:{user_id:i.ownerUserId,society:i.society,tower:i.tower,block:'',flat_number:i.flatNumber,plan_code:'PREMIUM',validity_months:'1',billing_period:'monthly',payment_purpose:'new'}};
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status}toResponse(){return new Response(JSON.stringify({message:this.message}),{status:this.status})}}
const dependencies={serve:fn=>registered=fn,createClient:()=>client,requireAuth:fn=>fn,Deno:{env:{get:()=>''}},errorResponse:(message,status=400)=>new Response(JSON.stringify({message}),{status}),successResponse:data=>new Response(JSON.stringify({success:true,data})),ApiError,badRequest:m=>new ApiError(m),notFound:m=>new ApiError(m,404),serverError:m=>new ApiError(m,500),logger:{info(){},warn(){},error(){}},resolveBlockForOrder:async()=>null,finalizeSubscriptionPayment,fetchPayment:async()=>({...payment}),fetchOrder:async()=>({...order}),verifyPaymentSignature:async()=>signatureOk,verifyWebhookSignature:async()=>true};
function compile(ep,suffix=''){
 const source=stripTypeScriptTypes(readFileSync(`supabase/functions/${ep}/index.ts`,'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
 return new Function(...Object.keys(dependencies),source+suffix)(...Object.values(dependencies));
}
compile('verify-razorpay-payment');const verify=registered;
const webhook=compile('razorpay-webhook','\nreturn handlePaymentCaptured;');
const before=await counts();
const req=()=>new Request('https://test',{method:'POST',body:JSON.stringify({razorpay_payment_id:i.paymentId,razorpay_order_id:i.orderId,razorpay_signature:'valid_signature'})});
const [response]=await Promise.all([verify(req(),{user:{id:i.ownerUserId}}),webhook(client,payment,{},async()=>{})]);
assert.equal(response.status,200);const result=await response.json();
const after=await counts();assert.deepEqual(after,{payments:before.payments+1,subscriptions:before.subscriptions+1,links:before.links+1});
const replay=await verify(req(),{user:{id:i.ownerUserId}});assert.equal(replay.status,200);assert.equal((await replay.json()).data.alreadyProcessed,true);assert.deepEqual(await counts(),after);
const outsider=await verify(req(),{user:{id:crypto.randomUUID()}});assert.equal(outsider.status,400);assert.deepEqual(await counts(),after);
assert.ok(rpcCalls>=2);assert.equal(typeof result.data.subscriptionId,'string');
await assert.doesNotReject(()=>webhook(client,{...payment,amount:1},{},async()=>{}));
await assert.rejects(()=>webhook(client,{...payment,id:'pay_amount_bad',amount:1},{},async()=>{}),/match order amount/);
assert.deepEqual(await counts(),after);
signatureOk=false;
assert.equal((await verify(req(),{user:{id:i.ownerUserId}})).status,400);
signatureOk=true;
payment.status='authorized';assert.equal((await verify(req(),{user:{id:i.ownerUserId}})).status,400);payment.status='captured';
payment.order_id='another_order';assert.equal((await verify(req(),{user:{id:i.ownerUserId}})).status,400);payment.order_id=i.orderId;
payment.amount=1;assert.equal((await verify(req(),{user:{id:i.ownerUserId}})).status,400);payment.amount=i.amountPaise;
assert.deepEqual(await counts(),after);
console.log('Client verification and webhook integration passed: simultaneous callbacks return success, one payment/subscription/link, retry succeeds, unrelated caller rejected. No Razorpay requests or charges.');
await db.close();
