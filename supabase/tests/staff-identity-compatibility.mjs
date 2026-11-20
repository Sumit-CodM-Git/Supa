import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {resolveVendorProfile} from '../functions/_shared/staff-identity.ts';
import {runComplaintOtpCycle} from '../functions/_shared/complaint-otp-cycle.ts';
let tables={},storageCalls=0;
class Query {
 constructor(t){this.t=t;this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this}
 ilike(k,v){this.filters.push(r=>String(r[k]??'').toLowerCase()===v.toLowerCase());return this}
 in(){return this}order(){return this}update(p){this.patch=p;return this}
 result(single=false){const rows=(tables[this.t]??[]).filter(r=>this.filters.every(f=>f(r)));if(this.patch)rows.forEach(r=>Object.assign(r,this.patch));return {data:single?(rows[0]??null):rows,error:null}}
 async maybeSingle(){return this.result(true)}then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
}
const client={from:t=>new Query(t),auth:{admin:{getUserById:async()=>({data:{user:null},error:null})}},storage:{from:()=>({createSignedUploadUrl:async key=>{storageCalls++;return{data:{signedUrl:'https://test/'+key},error:null}}})}};
const read=name=>stripTypeScriptTypes(readFileSync('supabase/functions/'+name,'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const resolve=new Function('Deno','createClient',read('_shared/staff.ts').replace(/^export /gm,'')+';return resolveComplaintAssignee;')({env:{get:()=>''}},()=>client);
class Validator{validateRequired(){return this}isValid(){return true}}
function load(name){let handler;new Function('Deno','createClient','requireAuth','corsHeaders','logger','sanitizeString','Validator','resolveComplaintAssignee','runComplaintOtpCycle','contactParkingSlot','errorResponse','successResponse',read(name+'/index.ts'))({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{}, {info(){},warn(){},error(){}},s=>String(s).trim(),Validator,resolve,runComplaintOtpCycle,()=>null,(m,status=400)=>Response.json({success:false,message:m},{status}),d=>Response.json({success:true,data:d}));return handler}
const workflow=load('staff-complaint-workflow'),images=load('staff-complaint-images');
async function call(handler,id,body){const r=await handler(new Request('https://test',{method:'POST',body:JSON.stringify(body)}),{user:{id,authId:'separate-auth-id'}});return{status:r.status,body:await r.json()}}
function setup(n,role='vendor',direct=false){const member='member-'+n,vendor='vendor-'+n,owner='owner-'+n,society='society-'+n;
 const contact={name:'Account '+n,phone:'+91 90000 0000'+n};
 tables={SSP_Society:[{society_id:society,registration_number:'TEST'}],SSP_Society_User:[{user_id:member,society,role:['resident','service_agent'],deleted_at:null,contact,society_data:{registration_number:'TEST'}},{user_id:owner,society}],SSP_Non_Society_User:[{non_society_user_id:vendor,society,role:'vendor',phone_number:'900000000'+n,deleted_at:null,society_data:{registration_number:'TEST'}}],SSP_Complaint:[{complaint_id:'complaint',society_user:owner,assigned_agent:role==='agent'?member:null,non_society_user:role==='vendor'?vendor:null,status:'assigned',deleted_at:null,start_otp:null,start_otp_generated_at:null,start_otp_verified_at:null,end_otp:null,end_otp_generated_at:null,end_otp_verified_at:null}]};
 return {member,vendor,society,caller:direct?vendor:member};
}
for(const n of [1,2])for(const role of ['agent','vendor'])for(const direct of (role==='vendor'?[false,true]:[false])){
 const f=setup(n,role,direct);
 if(role==='vendor'){assert.equal((await resolveVendorProfile(client,f.member,f.society)).data.non_society_user_id,f.vendor);assert.equal((await resolveVendorProfile(client,f.vendor,f.society)).data.non_society_user_id,f.vendor)}
 const upload=await call(images,f.caller,{operation:'UPLOAD',societyRegistrationNumber:'TEST',complaintId:'complaint',documentType:'BEFORE',files:[{fileName:'before.jpg',fileType:'image/jpeg'}],isUploaded:false});assert.equal(upload.status,200,JSON.stringify(upload));assert.equal(upload.body.data.uploadUrls.length,1);
 for(const [action,field]of [['START_OTP',null],['VERIFY_START','start_otp'],['END_OTP',null],['VERIFY_END','end_otp']]){
  const r=await call(workflow,f.caller,{action,complaintId:'complaint',...(field?{otp:tables.SSP_Complaint[0][field]}:{})});assert.equal(r.status,200,JSON.stringify(r));
 }
 assert.equal(tables.SSP_Complaint[0].status,'resolved');
}
let f=setup(1);tables.SSP_Non_Society_User.push({...tables.SSP_Non_Society_User[0],non_society_user_id:'duplicate'});assert.match((await resolveVendorProfile(client,f.member,f.society)).error,/Multiple/);assert.equal((await resolveVendorProfile(client,f.vendor,f.society)).data.non_society_user_id,f.vendor);
f=setup(1);tables.SSP_Society_User[0].deleted_at='removed';assert.equal((await resolveVendorProfile(client,f.member,f.society)).data,null);
f=setup(1);tables.SSP_Society_User[0].contact.phone='9111111111';assert.equal((await resolveVendorProfile(client,f.member,f.society)).data,null);
for(const handler of [workflow,images]){const bad=await call(handler,f.member,{action:'START_OTP',operation:'UPLOAD',complaintId:'complaint',societyRegistrationNumber:'TEST',documentType:'BEFORE',files:[{fileName:'before.jpg',fileType:'image/jpeg'}]});assert.equal(bad.status,403)}
assert.equal(storageCalls,6);
console.log('Shared staff compatibility passed: two independent accounts, service-agent/multi-role/direct-vendor sessions, canonical list IDs, legacy image upload URLs, START→END resolution, duplicate vendor ambiguity, deleted profiles, phone mismatch and cross-account access rejection.');

f=setup(1);tables.SSP_Non_Society_User[0].non_society_user_id=f.member;tables.SSP_Complaint[0].non_society_user=f.member;
assert.equal((await call(workflow,f.member,{action:'START_OTP',complaintId:'complaint'})).status,200);
f=setup(1);tables.SSP_Society_User[0].society='other';assert.equal((await resolveVendorProfile(client,f.member,f.society)).data,null);
console.log('Legacy same-ID agent/vendor profiles and foreign-society rejection passed.');
