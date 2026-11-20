import {resolveVendorProfile} from "../functions/_shared/staff-identity.ts";
import {parseComplaintAssignmentTime} from "../functions/_shared/complaint-time.ts";
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const fixtures = Array.from({length: 1250}, (_,i)=>({complaint_id:`c${i}`,assigned_agent:'agent',non_society_user:'vendor',status:i<1100?'assigned':i<1200?'in_progress':'resolved',name:'Test',description:'',created_at:'2026-11-10T00:00:00Z'}));
fixtures.push({complaint_id:'other',assigned_agent:'other',non_society_user:'other',status:'assigned'});
let failCounts=false, handler;
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(fields,opts){this.head=opts?.head;return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 ilike(k,v){this.filters.push(r=>r[k].toLowerCase()===v.toLowerCase());return this;}
 update(patch){this.patch=patch;return this;}
 order(){return this;}in(){return this;}gte(){return this;}lt(){return this;}
 async maybeSingle(){if(this.table==='SSP_Complaint')return {data:fixtures.find(r=>this.filters.every(f=>f(r)))};return {data:this.table==='SSP_Society'?{society_id:'society'}:this.table==='SSP_Society_User'?{user_id:'agent',role:['service_agent'],contact:{name:'Agent'}}:{non_society_user_id:'vendor',role:'vendor',name:'Vendor'}};}
 then(resolve,reject){if(this.patch)for(const row of fixtures.filter(r=>this.filters.every(f=>f(r))))Object.assign(row,this.patch);const rows=this.table==='SSP_Complaint'?fixtures.filter(r=>this.filters.every(f=>f(r))):[];return Promise.resolve(this.head?{data:null,count:rows.length,error:failCounts?{message:'failure'}:null}:{data:rows.slice(0,1000),error:null}).then(resolve,reject);}
}
const source=stripTypeScriptTypes(readFileSync('supabase/functions/staff-complaints/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const response=(data,status=200)=>new Response(JSON.stringify({success:status===200,data}),{status});
class Validator {validateRequired(){return this;}isValid(){return true;}}
new Function('Deno','requireAuth','corsHeaders','errorResponse','successResponse','logger','sanitizeString','Validator','createClient','contactParkingSlot','parseComplaintAssignmentTime','resolveVendorProfile',source)(
 {env:{get:()=>''},serve:fn=>handler=fn},fn=>req=>fn(req,{user:{id:'agent'}}),{},msg=>response(msg,400),response,{info(){},warn(){},error(){}},x=>x,Validator,()=>({from:t=>new Query(t)}),contact=>contact?.parking_slot??null,parseComplaintAssignmentTime,resolveVendorProfile);
async function call(options={}){const res=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({societyRegistrationNumber:'TEST',staffType:'SERVICE_AGENT',staffId:'agent',actionType:'FETCH',...options})}));return {status:res.status,body:await res.json()};}
for(const options of [{page:1,limit:1},{page:2,limit:20},{page:999,limit:100},{status:'resolved'},{status:'assigned',search:'no-match'},{staffType:'VENDOR',staffId:'vendor'}]){
 const result=await call(options);assert.equal(result.status,200,JSON.stringify(result.body));
 assert.deepEqual(result.body.data.statusCounts,{assigned:1100,inProgress:100,resolved:50});
 if(options.page===999||options.search)assert.equal(result.body.data.complaints.length,0);
}
const reopened=fixtures[0];
Object.assign(reopened,{status:'resolved',start_otp:'101126',start_otp_verified_at:'old-start',end_otp:'101126',end_otp_generated_at:'old-generation',end_otp_verified_at:'old-end'});
assert.equal((await call({actionType:'UPDATE',complaintId:reopened.complaint_id,newStatus:'in_progress'})).status,200);
assert.equal(reopened.end_otp_verified_at,null);assert.equal(reopened.end_otp,null);assert.equal(reopened.start_otp_verified_at,'old-start');
reopened.end_otp='active-end';
assert.equal((await call({actionType:'UPDATE',complaintId:reopened.complaint_id,newStatus:'in_progress'})).status,200);assert.equal(reopened.end_otp,'active-end');
assert.equal((await call({actionType:'UPDATE',complaintId:reopened.complaint_id,newStatus:'assigned'})).status,200);assert.equal(reopened.start_otp_verified_at,null);assert.equal(reopened.end_otp,null);
fixtures.length=0;
assert.deepEqual((await call()).body.data.statusCounts,{assigned:0,inProgress:0,resolved:0});
failCounts=true;assert.equal((await call()).status,400);
console.log('Staff counts passed: multiple pages, empty page, status/search filters, >1000 records, staff isolation, vendor, zero counts and database failure.');
