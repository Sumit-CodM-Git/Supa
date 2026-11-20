import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
const complaint={complaint_id:'complaint',complaint_type:'General',society_user_data:{society:'A'},deleted_at:null};
const tables={SSP_Society:[{society_id:'A',registration_number:'TEST'}],SSP_Complaint:[complaint],SSP_Society_User:[
 {user_id:'agent-general',society:'A',role:['service_agent'],service_agent_services:'General',contact:{name:'General Agent'}},
 {user_id:'agent-plumbing',society:'A',role:['service_agent'],service_agent_services:'Plumbing',contact:{name:'Plumber'}},
 {user_id:'agent-empty',society:'A',role:['service_agent'],service_agent_services:null,contact:{name:'No specialty'}},
 {user_id:'resident',society:'A',role:['resident'],service_agent_services:'General'},
 {user_id:'foreign-agent',society:'B',role:['service_agent'],service_agent_services:'General'},
],SSP_Non_Society_User:[
 {non_society_user_id:'vendor-general',society:'A',role:'vendor',service_type:'General',name:'General Vendor'},
 {non_society_user_id:'vendor-plumbing',society:'A',role:'vendor',service_type:'Plumbing',name:'Plumbing Vendor'},
 {non_society_user_id:'vendor-empty',society:'A',role:'vendor',service_type:null,name:'No specialty'},
 {non_society_user_id:'visitor',society:'A',role:'visitor',service_type:'General'},
 {non_society_user_id:'foreign-vendor',society:'B',role:'vendor',service_type:'General'},
]};
class Query{constructor(t){this.table=t;this.filters=[]}select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this}result(){return {data:(tables[this.table]??[]).filter(r=>this.filters.every(f=>f(r))),error:null}}async maybeSingle(){const r=this.result();return{...r,data:r.data[0]??null}}then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}}
const client={from:t=>new Query(t)},quiet={info(){},warn(){},error(){},log(){}};
function load(name){let handler;const source=stripTypeScriptTypes(readFileSync('supabase/functions/'+name+'/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
 const result=new Function('Deno','createClient','requireAuth','corsHeaders','errorResponse','successResponse','logger','sanitizeString','contactParkingSlot',source+(name==='manage-complaint-admin'?'\nreturn handleStaffList;':''))({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},(message,status=400)=>new Response(JSON.stringify({message}),{status}),data=>new Response(JSON.stringify({success:true,data})),quiet,v=>v,c=>c?.parking_slot??null);
 return async()=>{const req=new Request('https://test',{method:'POST',body:JSON.stringify({societyRegistrationNumber:'TEST',complaintId:'complaint'})});const r=name==='manage-complaint-admin'?await result(req,{callerSocietyId:'A',callerUserId:'admin'}, {complaintId:'complaint'}):await handler(req,{user:{id:'admin'}});assert.equal(r.status,200);return (await r.json()).data};
}
const expected=['agent-empty','agent-general','agent-plumbing','vendor-empty','vendor-general','vendor-plumbing'].sort();
for(const name of ['manage-complaint-admin','assign-complaint']){
 const run=load(name);
 for(const type of ['General','general',' GENERAL ']){complaint.complaint_type=type;const data=await run();assert.deepEqual(data.availableStaff.map(s=>s.id).sort(),expected);assert.equal(data.availableStaff[0].role,'service_agent')}
 complaint.complaint_type='Plumbing';const data=await run();assert.deepEqual(data.availableStaff.map(s=>s.id).sort(),['agent-plumbing','vendor-plumbing']);
 console.log(name+' passed: General includes every specialty and empty specialty, normalizes case/whitespace, excludes other societies/nonstaff, retains Plumbing matching.');
}
