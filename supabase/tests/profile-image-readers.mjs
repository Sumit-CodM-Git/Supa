import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {residentFlatTypeFields} from '../functions/_shared/resident-flat-type.ts';
import {contactParkingSlot} from '../functions/_shared/contact.ts';
import {parkingCounts} from '../functions/_shared/parking-counts.ts';
const quiet={log(){},info(){},warn(){},error(){}};
const strip=source=>stripTypeScriptTypes(source.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const source=name=>readFileSync(new URL(`../functions/${name}/index.ts`,import.meta.url),'utf8');
const old=name=>execFileSync('git',['show',`HEAD:supabase/functions/${name}/index.ts`],{encoding:'utf8'});
const id='3096f2ea-dba7-46fa-9b56-00add869b034',society='74628c82-7e11-4f5a-952a-d062193b3fb9';
let imageReads=0;
const images=async(_client,actor,_society,owners)=>{
 imageReads++;assert.equal(actor,id);assert.equal(_society,society);
 return new Map(owners.map(o=>[`${o.ownerType}:${o.ownerId}`,'https://storage.test/avatar']));
};
class Query {
 constructor(table){this.table=table;}
 select(){return this;}eq(){return this;}ilike(){return this;}order(){return this;}limit(){return this;}range(){return this;}in(){return this;}gte(){return this;}
 rows(){
  if(this.table==='SSP_Society')return [{society_id:society,registration_number:'TEST',society_name:'Test'}];
  if(this.table==='SSP_Contact')return [{contact_id:'contact',name:'Resident',phone:'9000000000'}];
  if(this.table==='SSP_Society_User')return [{user_id:id,society,role:['resident'],status:true,unit_flat_number:'101'}];
  if(this.table==='SSP_Non_Society_User')return [{non_society_user_id:id,society,role:'vendor',name:'Vendor',phone_number:'9000000000'}];
  return [];
 }
 async maybeSingle(){return {data:this.rows()[0]??null,error:null};}
 then(resolve,reject){return Promise.resolve({data:this.rows(),count:this.rows().length,error:null}).then(resolve,reject);}
}
const client={from:table=>new Query(table),auth:{getUser:async()=>({data:{user:{id:'auth-id',user_metadata:{user_id:id}}},error:null})}};
class Validator {validateRequired(){return this;}isValid(){return true;}}
class ApiError extends Error {constructor(code,message,status){super(message);this.status=status;}}
function loadProfile(js){
 let handler;
 new Function('Deno','createClient','Validator','sanitizeString','sanitizePagination','corsHeaders','ApiError','handleError','createLogger','residentFlatTypeFields','contactParkingSlot','authorizedProfileImageUrls',strip(js))(
  {env:{get:()=>''},serve:fn=>handler=fn},()=>client,Validator,v=>v,()=>({}),{},ApiError,e=>Response.json({message:e.message},{status:e.status??500}),()=>quiet,residentFlatTypeFields,contactParkingSlot,images,
 );
 return async extra=>{const response=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({phoneNumber:'9000000000',registrationNumber:'TEST',role:'resident',...extra})}));assert.equal(response.status,200);return await response.json();};
}
const oldProfile=loadProfile(old('get-profile')),newProfile=loadProfile(source('get-profile'));
for(const role of ['resident','admin','security','service_agent','vendor']){
 const baseline=await oldProfile({role}),unchanged=await newProfile({role});assert.deepEqual(unchanged,baseline);assert.equal(imageReads,0);
 const withImage=await newProfile({role,includeProfileImage:true});assert.equal(withImage.profileImageUrl,'https://storage.test/avatar');delete withImage.profileImageUrl;assert.deepEqual(withImage,baseline);imageReads=0;
}

// Full dashboard response stays identical except for the explicitly requested avatar.
const dashClient={from:()=>({select(){return this},eq(){return this},in(){return this},gte(){return this},then(resolve,reject){return Promise.resolve({data:[],count:0,error:null}).then(resolve,reject)}})};
const build=new Function('Deno','createClient','requireAuth','corsHeaders','parkingCounts','contactParkingSlot','profileImageUrl',strip(source('get-dashboard'))+'\nreturn buildDashboardResponse;')(
 {env:{get:()=>''},serve(){}},()=>dashClient,fn=>fn,{},parkingCounts,contactParkingSlot,async()=>{imageReads++;return 'https://storage.test/avatar'},
);
const user={user_id:id,role:['resident'],society:{society_id:society,total_unit:1},contact:null,tower:null,block:null};
const base=await (await build(user,[],false)).json();assert.equal(imageReads,0);
const opt=await (await build(user,[],false,true)).json();assert.equal(opt.data.user.profileImageUrl,'https://storage.test/avatar');delete opt.data.user.profileImageUrl;assert.deepEqual(opt,base);assert.equal(imageReads,1);
console.log('Reader compatibility passed: resident/admin/security/service-agent/vendor profiles keep exact default payloads; opt-in adds only profileImageUrl; dashboard keeps existing fields.');
