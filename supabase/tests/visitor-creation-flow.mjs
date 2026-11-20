import {visitorTimeISTISO} from '../functions/_shared/visitor-time.ts';
import {visitorDateOtp} from "../functions/_shared/visitor-otp-date.ts";
// Run: node supabase/tests/visitor-creation-flow.mjs
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
import {canOmitVisitorPhone,hasVisitorName,readVisitorName,findVisitorDraft,isVisitorOtpDraft,canCompleteVisitorDetails,VisitorDraftError,canVerifyVisitorOtp,findPendingVisitorForOtp} from '../functions/_shared/visitor-drafts.ts';
const rows=[];
let failWrites=false;
let residentPlan='PREMIUM',planLookupError=false;
// Evaluate the query expressions used by the real handlers rather than treating
// every OR as a pending-status filter (which hid approved-visit reuse bugs).
function splitFilter(value) {
 let depth=0,start=0;const parts=[];
 for(let i=0;i<value.length;i++){
  if(value[i]==='(')depth++;
  if(value[i]===')')depth--;
  if(value[i]===','&&depth===0){parts.push(value.slice(start,i));start=i+1}
 }
 parts.push(value.slice(start));return parts;
}
function matchesFilter(row,filter){
 for(const group of ['and','or'])if(filter.startsWith(group+'(')){
  const results=splitFilter(filter.slice(group.length+1,-1)).map(part=>matchesFilter(row,part));
  return group==='and'?results.every(Boolean):results.some(Boolean);
 }
 const [,field,op,raw]=filter.match(/^([^.]+)\.(eq|is|ilike|gte|in)\.(.*)$/)??[];
 assert.ok(field,'Unsupported mock filter '+filter);
 const value=raw==='true'?true:raw==='false'?false:raw==='null'?null:raw;
 if(op==='eq'||op==='is')return row[field]===value;
 if(op==='ilike')return String(row[field]).toLowerCase()===raw.toLowerCase();
 if(op==='gte')return Date.parse(row[field])>=Date.parse(raw);
 if(op==='in')return splitFilter(raw.slice(1,-1)).includes(String(row[field]));
}

class Query {
 constructor(table){this.table=table;this.filters=[];this.op='read';this.columns=''}
 select(columns=''){this.columns=columns;return this}
 neq(field,value){this.filters.push(row=>row[field]!==value);return this}
 eq(field,value){this.filters.push(row=>row[field]===value);return this}
 ilike(field,value){this.filters.push(row=>String(row[field]).toLowerCase()===value.toLowerCase());return this}
 gte(field,value){this.filters.push(row=>Date.parse(row[field])>=Date.parse(value));return this}
 is(field,value){this.filters.push(row=>row[field]==value);return this}
 or(expression){this.filters.push(row=>splitFilter(expression).some(part=>matchesFilter(row,part)));return this}
 order(field,{ascending=true}={}){this.sort={field,ascending};return this}limit(n){this.max=n;return this}in(field,values){this.filters.push(row=>values.includes(row[field]));return this}
 insert(value){this.op='insert';this.value=value;return this}update(value){this.op='update';this.value=value;return this}
 execute(){
  if(this.table==='SSP_Society')return[{society_id:'society'}];
  if(this.table==='SSP_Society_User')return[{user_id:'host',society:'society',unit_flat_number:'101'}];
  if(this.table==='SSP_Document')return[];
  if(this.op==='insert'){const row={check_in:new Date().toISOString(),...this.value,non_society_user_id:this.value.non_society_user_id??crypto.randomUUID(),created_at:new Date().toISOString()};rows.push(row);return[row]}
  let result=rows.filter(row=>this.filters.every(fn=>fn(row)));
  if(this.sort){const {field,ascending}=this.sort;result.sort((a,b)=>String(a[field]).localeCompare(String(b[field]))*(ascending?1:-1))}
  result=result.slice(0,this.max??1000);
  if(this.op==='update')result.forEach(row=>Object.assign(row,this.value));
  return result.map(row=>this.columns.includes('hosted_by:SSP_Society_User')?{...row,hosted_by:{user_id:row.hosted_by,unit_flat_number:'101',contact:{name:'Resident'}}}:{...row});
 }
 async single(){if(failWrites&&this.op==='update')return{data:null,error:{message:'Simulated database failure'}};const result=this.execute();return{data:result.length===1?result[0]:null,error:result.length===1?null:{message:'Expected one row',code:'PGRST116'}}}
 async maybeSingle(){if(failWrites&&this.op==='update')return{data:null,error:{message:'Simulated database failure'}};const result=this.execute();return{data:result[0]??null,error:result.length>1?{message:'Multiple rows',code:'PGRST116'}:null}}
 then(resolve,reject){return Promise.resolve({data:this.execute(),error:null}).then(resolve,reject)}
}
const client={from:table=>new Query(table),rpc:async(name)=>name==='get_current_plan_code'?({data:residentPlan,error:planLookupError?{message:'billing unavailable'}:null}):({data:{VISITOR_OTP:true},error:null})};
const success=data=>new Response(JSON.stringify({success:true,data}));
const failure=(message,status=400)=>new Response(JSON.stringify({message}),{status});
const logger={info(){},warn(){},error(){}};
class Validator{validateRequired(){return this}isValid(){return true}}
function load(name){let handler;const src=stripTypeScriptTypes(readFileSync(new URL(`../functions/${name}/index.ts`,import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
 new Function('Deno','createClient','requireAuth','corsHeaders','successResponse','errorResponse','createLogger','injectedLogger','sanitizeString','generateId','getCurrentTimestamp','Validator','findVisitorDraft','isVisitorOtpDraft','canCompleteVisitorDetails','VisitorDraftError','canVerifyVisitorOtp','findPendingVisitorForOtp','visitorDateOtp','contactParkingSlot','hasVisitorName','readVisitorName','visitorTimeISTISO','canOmitVisitorPhone',(name==='visitor-otp'?'const logger=injectedLogger;\n':'')+src)
 ({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},success,failure,()=>logger,logger,s=>String(s).trim(),()=>crypto.randomUUID(),()=>new Date().toISOString(),Validator,findVisitorDraft,isVisitorOtpDraft,canCompleteVisitorDetails,VisitorDraftError,canVerifyVisitorOtp,findPendingVisitorForOtp,visitorDateOtp,()=>null,hasVisitorName,readVisitorName,visitorTimeISTISO,canOmitVisitorPhone);
 return async body=>{const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify(body)}),{user:{id:'guard'}});return{status:response.status,body:await response.json()}};
}
const otp=load('visitor-otp'),security=load('visitor-pass-operations');
const base={phoneNumber:'6454548484',societyUserId:'host',visitorName:'Sumit Guest'};
assert.equal((await otp({...base,otp:'123456'})).status,404);assert.equal(rows.length,0);
const generated=await otp(base);assert.equal(generated.status,200);const id=generated.body.data.visitorId;assert.equal(rows.length,1);assert.equal(rows[0].visitor_status,'otp_pending');assert.equal(rows[0].check_in,null);assert.equal(rows[0].check_out,null);assert.equal(rows[0].is_otp_verified,false);assert.equal(rows[0].one_time_password,visitorDateOtp());
assert.equal((await otp(base)).body.data.visitorId,id);assert.equal(rows.length,1);
assert.equal((await otp({...base,otp:'000000'})).status,400);assert.equal(rows.length,1);
const todayOtp=rows[0].one_time_password;rows[0].one_time_password=visitorDateOtp(new Date(Date.now()-86400000));
assert.equal((await otp({...base,otp:rows[0].one_time_password})).status,400);assert.equal(rows[0].is_otp_verified,false);rows[0].one_time_password=todayOtp;
const verified=await otp({...base,visitorId:id,otp:rows[0].one_time_password});assert.equal(verified.body.data.otpVerified,true);assert.equal(verified.body.data.visitorId,id);assert.equal(rows.length,1);assert.equal(rows[0].is_otp_verified,true);assert.equal(rows[0].visitor_status,'Pending');assert.equal(rows[0].visitor_approval_status,'pending');
const request={actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorName:'Sumit Guest',phoneNumber:'6454548484',visitorId:id};
const submitted=await security(request);assert.equal(submitted.status,200,JSON.stringify(submitted.body));assert.equal(submitted.body.data.visitorId,id);assert.equal(rows.length,1);assert.equal(rows[0].name,'Sumit Guest');assert.equal(rows[0].phone_number,'6454548484');assert.equal(rows[0].visitor_approval_status,'pending');assert.equal(rows[0].is_otp_verified,true);
rows[0].visitor_approval_status='approved';rows[0].visitor_status='Approved';
assert.equal((await security(request)).status,200);assert.equal(rows.length,1);assert.equal(rows[0].visitor_approval_status,'approved');
assert.equal((await security({...request,phoneNumber:'9999999999'})).status,400);assert.equal(rows.length,1);
const next=await otp({...base,visitorName:'Next Visit'});assert.equal(rows.length,2);assert.notEqual(next.body.data.visitorId,id);
const noId={...request,visitorName:'Next Visit'};delete noId.visitorId;
assert.equal((await security(noId)).status,200);assert.equal(rows.length,2);assert.equal(rows[1].name,'Next Visit');
const missing={...noId};delete missing.phoneNumber;assert.equal((await security(missing)).status,400);assert.equal(rows.length,2);
assert.equal((await findVisitorDraft(client,'other-host','society',base.phoneNumber)),null);
console.log('OTP generation/resend/verification/final submission uses one record; phone aliases, retries, separate visits, validation and host scoping checks passed.');

const countBefore=rows.length;
const reversed={actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorName:'Named First',phoneNumber:'7743255412'};
const first=await security(reversed);assert.equal(first.status,200);assert.equal(rows.length,countBefore+1);
const laterOtp=await otp({societyUserId:'host',phoneNumber:'7743255412'});assert.equal(laterOtp.status,200);assert.equal(laterOtp.body.data.visitorId,first.body.data.visitorId);assert.equal(rows.length,countBefore+1);
const stored=rows.find(row=>row.non_society_user_id===first.body.data.visitorId);
assert.equal((await otp({societyUserId:'host',phoneNumber:'7743255412',otp:stored.one_time_password})).body.data.otpVerified,true);
assert.equal(rows.length,countBefore+1);
console.log('Visitor-first then OTP flow also reuses one named record.');

const invited={non_society_user_id:crypto.randomUUID(),hosted_by:'host',society:'society',name:'Preapproved Guest',phone_number:'9650245511',role:'visitor',visitor_status:'expected',visitor_approval_status:'approved',pre_approved:true,is_otp_verified:false,created_at:new Date().toISOString()};
rows.push(invited);const invitationCount=rows.length;
assert.equal((await otp({societyUserId:'host',phoneNumber:invited.phone_number,visitorId:invited.non_society_user_id})).status,200);
assert.equal((await otp({societyUserId:'host',phoneNumber:invited.phone_number,visitorId:invited.non_society_user_id,otp:invited.one_time_password})).body.data.otpVerified,true);
assert.equal(invited.is_otp_verified,true);assert.equal(rows.length,invitationCount);
console.log('Existing pre-approved visitors can verify OTP using their existing visitorId.');

const fastPhone='7777777777';
const fastOtp=await otp({societyUserId:'host',phoneNumber:fastPhone,visitorName:'Quick Approval'});
const fast=rows.find(row=>row.non_society_user_id===fastOtp.body.data.visitorId);
await otp({societyUserId:'host',phoneNumber:fastPhone,visitorId:fast.non_society_user_id,otp:fast.one_time_password});
fast.visitor_status='Approved';fast.visitor_approval_status='approved';fast.pre_approved=true;
const completed=await security({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:fast.non_society_user_id,visitorName:'Quick Approval',phoneNumber:fastPhone});
assert.equal(completed.status,200);assert.equal(fast.name,'Quick Approval');assert.equal(fast.visitor_approval_status,'approved');assert.equal(fast.visitor_status,'Approved');
console.log('Completing details after a resident decision preserves that decision.');

// A name supplied at OTP generation stays attached to the same visit everywhere.
const namedBase={societyUserId:'host',phoneNumber:'8888888888',visitorName:'  Consistent Guest  '};
const namedOtp=await otp(namedBase);
assert.equal(namedOtp.status,200);
assert.equal(namedOtp.body.data.name,'Consistent Guest');
assert.equal(namedOtp.body.data.visitorName,'Consistent Guest');
const namedId=namedOtp.body.data.visitorId;
const namedRow=rows.find(row=>row.non_society_user_id===namedId);
const namedCount=rows.length;
assert.equal((await otp(namedBase)).body.data.visitorId,namedId);
const namedVerified=await otp({...namedBase,visitorId:namedId,otp:namedRow.one_time_password});
assert.equal(namedVerified.body.data.name,'Consistent Guest');
const namedSubmit=await security({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:namedId});
assert.equal(namedSubmit.status,200,JSON.stringify(namedSubmit.body));
assert.equal(namedRow.name,'Consistent Guest');
assert.equal(rows.length,namedCount);
assert.equal((await otp({...namedBase,visitorId:namedId,visitorName:'Different Guest'})).status,409);
assert.equal((await security({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:namedId,name:'Different Guest'})).status,409);
assert.equal(namedRow.name,'Consistent Guest');
const aliasOtp=await otp({societyUserId:'host',phoneNumber:'8888888889',name:'Alias Guest'});
assert.equal(aliasOtp.body.data.visitorName,'Alias Guest');
assert.equal((await otp({societyUserId:'host',phoneNumber:'8888888889',visitorName:123})).status,400);
console.log('OTP names, name alias, resend, verification, submission and conflicting-name protection passed.');

const gate=load('security-gate-console');
const gateBase={societyUserId:'host',phoneNumber:'8888888890',visitorName:'chotu guest'};
const gateOtp=await otp(gateBase);
const gateRow=rows.find(row=>row.non_society_user_id===gateOtp.body.data.visitorId);
const gateCount=rows.length;
await otp({...gateBase,visitorId:gateRow.non_society_user_id,otp:gateRow.one_time_password});
const gateSubmit=await gate({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:gateRow.non_society_user_id});
assert.equal(gateSubmit.status,200,JSON.stringify(gateSubmit.body));
assert.equal(gateSubmit.body.data.visitorName,'chotu guest');
assert.equal(gateSubmit.body.data.visitorId,gateRow.non_society_user_id);
assert.equal(rows.length,gateCount);
for (const endpoint of [gate,security]) {
 for (const [newStatus,approval] of [['Accept','approved'],['Rejected','rejected']]) {
  const response=await endpoint({actionType:'UPDATE_STATUS',societyRegistrationNumber:'GZB-1234-ab',visitorId:gateRow.non_society_user_id,newStatus});
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(gateRow.visitor_approval_status,approval);
  assert.equal(gateRow.pre_approved,approval==='approved');
  assert.equal(gateRow.name,'chotu guest');
 }
}
console.log('Legacy gate console reuses named OTP visitors; both status routes synchronize resident decisions.');

// The app may submit the visitor's details only after OTP verification.
for (const [index,endpoint] of [security,gate].entries()) {
 const latePhone='888888889'+index;
 const generated=await otp({societyUserId:'host',phoneNumber:latePhone});
 assert.equal(generated.status,200,JSON.stringify(generated.body));
 assert.equal(generated.body.data.name,null);
 assert.equal(generated.body.data.requiresVisitorDetails,true);
 const draft=rows.find(row=>row.non_society_user_id===generated.body.data.visitorId);
 const verified=await otp({societyUserId:'host',phoneNumber:latePhone,visitorId:draft.non_society_user_id,otp:draft.one_time_password});
 assert.equal(verified.status,200,JSON.stringify(verified.body));
 assert.equal(verified.body.data.otpVerified,true);
 assert.equal(verified.body.data.requiresVisitorDetails,true);
 assert.equal(draft.visitor_status,'otp_pending');
 assert.equal(draft.visitor_approval_status,null);
 const count=rows.length;
 const submitted=await endpoint({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:draft.non_society_user_id,fullName:'chotu guest'});
 assert.equal(submitted.status,200,JSON.stringify(submitted.body));
 assert.equal(rows.length,count);
 assert.equal(draft.name,'chotu guest');
 assert.equal(draft.visitor_status,'Pending');
 assert.equal(draft.visitor_approval_status,'pending');
 assert.equal(draft.is_otp_verified,true);
}
for (const field of ['fullName','Name','visitor_name']) {
 const alias=await otp({societyUserId:'host',phoneNumber:'88888888'+String(92+['fullName','Name','visitor_name'].indexOf(field)),[field]:'chotu guest'});
 assert.equal(alias.status,200,JSON.stringify(alias.body));
 assert.equal(alias.body.data.name,'chotu guest');
}
const legacy={non_society_user_id:crypto.randomUUID(),hosted_by:'host',society:'society',name:'Unknown User',phone_number:'8888888896',role:'visitor',visitor_status:'otp_pending',visitor_approval_status:null,is_otp_verified:false,pre_approved:false,check_in:null,check_out:null,created_at:new Date().toISOString()};
rows.push(legacy);
assert.equal((await otp({societyUserId:'host',phoneNumber:legacy.phone_number,visitorId:legacy.non_society_user_id})).status,200);
const repaired=await otp({societyUserId:'host',phoneNumber:legacy.phone_number,visitorId:legacy.non_society_user_id,Name:'chotu guest'});
assert.equal(repaired.status,200,JSON.stringify(repaired.body));assert.equal(legacy.name,'chotu guest');assert.equal(repaired.body.data.name,legacy.name);
for (const endpoint of [security,gate]) {
 const old={...legacy,non_society_user_id:crypto.randomUUID(),phone_number:'8888888897',name:'Unknown user',is_otp_verified:true,visitor_status:'Pending'};
 rows.push(old);
 const repaired=await endpoint({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:old.non_society_user_id,fullName:'chotu guest'});
 assert.equal(repaired.status,200,JSON.stringify(repaired.body));assert.equal(old.name,'chotu guest');
 const updateOld={...old,non_society_user_id:crypto.randomUUID(),name:'Unknown Visitor'};rows.push(updateOld);
 const updated=await endpoint({actionType:'UPDATE_STATUS',societyRegistrationNumber:'GZB-1234-ab',visitorId:updateOld.non_society_user_id,newStatus:'Approved',Name:'chotu guest'});
 assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updateOld.name,'chotu guest');
}
assert.equal(readVisitorName({visitorName:'Unknown User',fullName:'chotu guest'}),'chotu guest');
assert.throws(()=>readVisitorName({visitorName:'Guest One',name:'Guest Two'}));
console.log('Phone-only OTP followed by named details submission reuses one record without premature approval; name aliases and legacy repairs pass.');

for (const endpoint of [security,gate]) {
 const badName=await endpoint({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',phoneNumber:'8888888898',visitorName:123});
 assert.equal(badName.status,400,JSON.stringify(badName.body));
 const placeholder=await endpoint({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',phoneNumber:'8888888898',visitorName:'Unknown User'});
 assert.equal(placeholder.status,400,JSON.stringify(placeholder.body));
}

let scenarioCounter=0;
const nameFields=['visitorName','name','fullName','Name','visitor_name'];
for(const endpoint of [security,gate]) {
 for(const nameField of nameFields) {
  const phone='700000'+String(++scenarioCounter).padStart(4,'0');
  const fullName='Abc Scenario '+scenarioCounter;
  const generated=await otp({societyUserId:'host',phoneNumber:phone});
  const row=rows.find(row=>row.non_society_user_id===generated.body.data.visitorId);
  assert.equal(generated.status,200);
  const verified=await otp({societyUserId:'host',phoneNumber:phone,visitorId:row.non_society_user_id,otp:row.one_time_password});
  assert.equal(verified.status,200);
  const before=rows.length;
  // Use only phone to exercise no-id draft lookup, then retry using its returned id.
  const body={actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',phoneNumber:phone,[nameField]:'  '+fullName+'  '};
  const submitted=await endpoint(body);
  assert.equal(submitted.status,200,JSON.stringify(submitted.body));
  assert.equal(submitted.body.data.visitorId,row.non_society_user_id);
  assert.equal(row.name,fullName);assert.equal(rows.length,before);
  assert.equal((await endpoint({...body,visitorId:row.non_society_user_id})).status,200);
  assert.equal(row.name,fullName);assert.equal(rows.length,before);
  assert.equal((await otp({societyUserId:'host',phoneNumber:phone,visitorId:row.non_society_user_id,visitorName:'Unknown User'})).status,200);
  assert.equal(row.name,fullName);
 }
}
for(const field of nameFields){
 const phone='700000'+String(++scenarioCounter).padStart(4,'0');
 const generated=await otp({societyUserId:'host',phoneNumber:phone});
 const row=rows.find(row=>row.non_society_user_id===generated.body.data.visitorId);
 const verified=await otp({societyUserId:'host',phoneNumber:phone,visitorId:row.non_society_user_id,otp:row.one_time_password,[field]:'Abc At Verification'});
 assert.equal(verified.status,200,JSON.stringify(verified.body));
 assert.equal(row.name,'Abc At Verification');assert.equal(row.visitor_status,'Pending');
}
// Nested visitorData is used by the pre-approved API and is now accepted
// consistently by OTP and both security submission routes.
for(const endpoint of [security,gate]){
 const phone='700000'+String(++scenarioCounter).padStart(4,'0');
 const nested=await otp({societyUserId:'host',phoneNumber:phone,visitorData:{fullName:'Abc Nested'}});
 assert.equal(nested.status,200,JSON.stringify(nested.body));
 assert.equal(nested.body.data.requiresVisitorDetails,false);
 const row=rows.find(row=>row.non_society_user_id===nested.body.data.visitorId);
 assert.equal(row.name,'Abc Nested');
 const submitted=await endpoint({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:row.non_society_user_id,visitorData:{name:'Abc Nested'}});
 assert.equal(submitted.status,200,JSON.stringify(submitted.body));assert.equal(row.name,'Abc Nested');
}
assert.throws(()=>readVisitorName({visitorData:'Abc Invalid'}));
assert.throws(()=>readVisitorName({visitorName:'Abc Root',visitorData:{name:'Different'}}));
console.log('17 Abc-name matrix cases passed: all aliases, both security routes, no-id lookup/retries, name at verification and nested visitorData.');

for(const endpoint of [security,gate]){
 const phone='700000'+String(++scenarioCounter).padStart(4,'0');
 const body={actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',phoneNumber:phone,visitorName:'Abc Before OTP'};
 const first=await endpoint(body);assert.equal(first.status,200);
 const before=rows.length;
 const retry=await endpoint(body);assert.equal(retry.status,200,JSON.stringify(retry.body));
 assert.equal(retry.body.data.visitorId,first.body.data.visitorId);
 assert.equal(rows.length,before);
 const denied=await endpoint({...body,societyUserId:'other-host',visitorId:first.body.data.visitorId});
 assert.equal(denied.status,403,JSON.stringify(denied.body));
}
console.log('Details-first duplicate submission and host-isolation scenarios passed for both security endpoints.');

for(const endpoint of [otp,security,gate]){
 const phone='700000'+String(++scenarioCounter).padStart(4,'0');
 const generated=await otp({societyUserId:'host',phoneNumber:phone});
 const row=rows.find(row=>row.non_society_user_id===generated.body.data.visitorId);
 failWrites=true;
 const response=endpoint===otp
  ?await endpoint({societyUserId:'host',phoneNumber:phone,visitorId:row.non_society_user_id,fullName:'Abc Write Failure'})
  :await endpoint({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorId:row.non_society_user_id,fullName:'Abc Write Failure'});
 failWrites=false;
 assert.equal(response.status,500,JSON.stringify(response.body));
 assert.equal(row.name,'Unknown Visitor');
 assert.notEqual(response.body.success,true);
}
console.log('Database name-save failures return errors in all three APIs; no false name-save success.');

// Both guard APIs accept omitted/blank phones only for known non-Premium walk-ins.
for (const endpoint of ['visitor-pass-operations','security-gate-console']) {
 const create=load(endpoint);
 for (const plan of ['FREE','STARTER','GROWTH','PREMIUM']) {
  residentPlan=plan;
  for (const missingPhone of [undefined,null,'','  ']) {
   const before=rows.length;
   const result=await create({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorName:'Optional phone guest',phoneNumber:missingPhone});
   assert.equal(result.status,plan==='PREMIUM'?400:200,endpoint+' '+plan+' '+JSON.stringify(result.body));
   assert.equal(rows.length,before+(plan==='PREMIUM'?0:1));
   if (plan!=='PREMIUM') {assert.equal(rows.at(-1).phone_number,null);assert.equal(rows.at(-1).is_otp_verified,false);}
  }
 }
 residentPlan='FREE';planLookupError=true;
 const before=rows.length;
 assert.equal((await create({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorName:'Billing failure'})).status,500);
 assert.equal(rows.length,before);planLookupError=false;
 assert.equal((await create({actionType:'REQUEST_APPROVAL',societyRegistrationNumber:'GZB-1234-ab',societyUserId:'host',visitorName:'Vendor',role:'vendor'})).status,400);
}
residentPlan='PREMIUM';
console.log('Both guard APIs: non-Premium phone omission/blank values accepted without OTP; Premium, vendor and billing-error validation preserved.');
