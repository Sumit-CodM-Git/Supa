// Run: node supabase/tests/resident-visitor-approval.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {visitorApprovalState} from '../functions/_shared/visitor-approval.ts';
for (const visitor of [
  {visitor_status:'Pending',visitor_approval_status:null},
  {visitor_status:'pending',visitor_approval_status:'pending'},
]) {const state=visitorApprovalState(visitor);assert.equal(state.approvalStatus,'pending');assert.equal(state.canApprove,true);assert.equal(state.canReject,true);}
for (const visitor of [
  {visitor_status:'expected',visitor_approval_status:'approved',pre_approved:true},
  {visitor_status:'Inside',visitor_approval_status:'pending'},
  {visitor_status:'Pending',check_in:'2026-11-09',visitor_approval_status:'pending'},
  {visitor_status:'Rejected',visitor_approval_status:'rejected'},
]) assert.equal(visitorApprovalState(visitor).requiresApproval,false);
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/update-approval-status/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
async function run(action,caller='host',options={}) {
 let handler,update;
 class ApiError extends Error {constructor(code,message,status){super(message);this.status=status}}
 const visitor={non_society_user_id:'visitor',hosted_by:'host',society:'society',visitor_status:options.status??'Pending',visitor_approval_status:null};
 class Query {
  constructor(table){this.table=table}
  select(){return this}eq(){return this}ilike(){return this}order(){return this}range(){return this}or(){return this}
  update(value){update=value;return this}
  async maybeSingle(){return {data:this.table==='SSP_Non_Society_User'?visitor:{user_id:caller,role:options.security?['security']:['resident']},error:null}}
  then(resolve,reject){return Promise.resolve({data:[],count:0,error:null}).then(resolve,reject)}
 }
 const client={from:table=>new Query(table)};
 new Function('serve','requireAuth','createClient','Deno','validateRequired','ApiError','ErrorCodes','sanitizeString','ArrayHandler','logger','successResponse','handleError',source)
  (fn=>handler=fn,fn=>fn,()=>client,{env:{get:()=>''}},value=>!!value,ApiError,{FORBIDDEN:'FORBIDDEN',BAD_REQUEST:'BAD_REQUEST',CONFLICT:'CONFLICT',SERVER_ERROR:'SERVER_ERROR'},value=>String(value).trim(),{toArray:value=>Array.isArray(value)?value:[value]},{info(){},error(){},warn(){}},data=>new Response(JSON.stringify({data})),error=>new Response(JSON.stringify({message:error.message}),{status:error.status??500}));
 const response=await handler(new Request('https://test.example',{method:'POST',body:JSON.stringify({actionType:action,societyRegistrationNumber:'GZB-1234-ab',visitorId:'visitor'})}),{user:{id:caller}});
 return {status:response.status,body:await response.json(),update};
}
for(const [action,approval,status] of [['Approved','approved','Approved'],['Accept','approved','Approved'],['Approve','approved','Approved'],['Reject','rejected','Rejected'],['Rejected','rejected','Rejected']]) {
 const allowed=await run(action);assert.equal(allowed.status,200);assert.equal(allowed.update.visitor_approval_status,approval);assert.equal(allowed.update.visitor_status,status);
 const other=await run(action,'other');assert.equal(other.status,403);assert.equal(other.update,undefined);
 const inside=await run(action,'host',{status:'Inside'});assert.equal(inside.status,409);assert.equal(inside.update,undefined);
}
assert.equal((await run('SendForApproval','guard',{security:true})).status,200);
assert.equal((await run('SendForApproval','other')).status,403);
console.log('Pending action flags, legacy null approvals, host-only allow/reject, consistent state updates, checked-in protection and security-only approval requests passed.');
