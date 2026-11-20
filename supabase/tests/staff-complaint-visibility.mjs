import {resolveVendorProfile} from "../functions/_shared/staff-identity.ts";
import {parseComplaintAssignmentTime} from "../functions/_shared/complaint-time.ts";
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const complaintId='91ef1d16-06f3-4723-b4a1-c7c80f6f24cf';
const fixtures=[
 {complaint_id:complaintId,assigned_agent:'agent',non_society_user:'vendor',status:'assigned',complaint_type:'general',priority:'medium',name:'General complaint',description:'',assigned_date_time:'2026-11-11T16:17:52',created_at:'2026-11-11T10:45:00Z'},
 {complaint_id:'late',assigned_agent:'agent',non_society_user:'vendor',status:'assigned',complaint_type:'general',priority:'medium',name:'Evening',description:'',assigned_date_time:'2026-11-11T23:30:00',created_at:'2026-11-11T17:45:00Z'},
 {complaint_id:'other',assigned_agent:'other',non_society_user:'other',status:'assigned',complaint_type:'general',priority:'medium',name:'Other',description:'',assigned_date_time:'2026-11-11T16:17:52'}
];
let failCounts=false, handler;
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(fields,opts){this.head=opts?.head;return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 ilike(k,v){this.filters.push(r=>r[k].toLowerCase()===v.toLowerCase());return this;}
 update(patch){this.patch=patch;return this;}
 order(){return this;}in(){return this;}gte(k,v){this.filters.push(r=>r[k]>=v);return this;}lt(k,v){this.filters.push(r=>r[k]<v);return this;}
 async maybeSingle(){if(this.table==='SSP_Complaint')return {data:fixtures.find(r=>this.filters.every(f=>f(r)))};return {data:this.table==='SSP_Society'?{society_id:'society'}:this.table==='SSP_Society_User'?{user_id:'agent',role:['service_agent'],contact:{name:'Agent'}}:{non_society_user_id:'vendor',role:'vendor',name:'Vendor'}};}
 then(resolve,reject){if(this.patch)for(const row of fixtures.filter(r=>this.filters.every(f=>f(r))))Object.assign(row,this.patch);const rows=this.table==='SSP_Complaint'?fixtures.filter(r=>this.filters.every(f=>f(r))):[];return Promise.resolve(this.head?{data:null,count:rows.length,error:failCounts?{message:'failure'}:null}:{data:rows.slice(0,1000),error:null}).then(resolve,reject);}
}
const source=stripTypeScriptTypes(readFileSync('supabase/functions/staff-complaints/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const response=(data,status=200)=>new Response(JSON.stringify({success:status===200,data}),{status});
class Validator {validateRequired(){return this;}isValid(){return true;}}
new Function('Deno','requireAuth','corsHeaders','errorResponse','successResponse','logger','sanitizeString','Validator','createClient','contactParkingSlot','parseComplaintAssignmentTime','resolveVendorProfile',source)(
 {env:{get:()=>''},serve:fn=>handler=fn},fn=>req=>fn(req,{user:{id:'agent'}}),{},msg=>response(msg,400),response,{info(){},warn(){},error(){}},x=>x,Validator,()=>({from:t=>new Query(t)}),contact=>contact?.parking_slot??null,parseComplaintAssignmentTime,resolveVendorProfile);
async function call(options={}){const res=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({societyRegistrationNumber:'TEST',staffType:'SERVICE_AGENT',staffId:'agent',actionType:'FETCH',...options})}));return {status:res.status,body:await res.json()};}

for(const staffType of ['SERVICE_AGENT','Service Agent','service_agent','ServiceAgent','VENDOR','Vendor']){
 const r=await call({staffType,staffId:staffType.toLowerCase().includes('vendor')?'vendor':'agent',status:'Assigned',complaintType:'General',priority:'Medium',filterOption:'custom',fromDate:'2026-11-11',toDate:'2026-11-11'});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(new Set(r.body.data.complaints.map(c=>c.complaintId)),new Set([complaintId,'late']));
}
for(const staffType of ['SERVICE_AGENT','VENDOR']){
 const r=await call({staffType,staffId:staffType==='VENDOR'?'vendor':'agent',complaintId,status:'resolved',complaintType:'plumbing',priority:'high',search:'does not match',filterOption:'custom',page:99});
 assert.equal(r.status,200);assert.deepEqual(r.body.data.complaints.map(c=>c.complaintId),[complaintId]);assert.equal(r.body.data.pagination.page,1);
 const foreign=await call({complaintId:'other'});assert.equal(foreign.body.data.complaints.length,0);
}
assert.equal((await call({staffType:'unknown'})).status,400);
console.log('Staff visibility passed: supplied complaint fixture, agent/vendor aliases, General/Medium filters, full IST day including 11:30 pm, direct complaint opening despite list filters/page, and assignment isolation.');
