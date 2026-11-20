import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {residentFlatTypeFields} from '../functions/_shared/resident-flat-type.ts';
import {contactParkingSlot} from '../functions/_shared/contact.ts';
const quiet={log(){},warn(){},error(){}};
const original=n=>execFileSync('git',['show',`HEAD:supabase/functions/${n}/index.ts`],{encoding:'utf8'});
const current=n=>readFileSync(`supabase/functions/${n}/index.ts`,'utf8');
function withoutNewFields(value){if(Array.isArray(value))return value.map(withoutNewFields);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['flatType','flatTypeId','flatTypeRecord','flat_type_id'].includes(key)).map(([k,v])=>[k,withoutNewFields(v)]));return value;}
// Compare complete profile payloads with the pre-change implementation.
for(const name of ['get-residents-profile','resident-profile-console']){
 function build(source){const start=source.indexOf('function buildProfile('),end=source.indexOf('\nfunction matchesRole(',start);return new Function('residentFlatTypeFields','contactParkingSlot','firstOrNull','capitalizeName','mapVehicleToApp',stripTypeScriptTypes(source.slice(start,end))+';return buildProfile;')(residentFlatTypeFields,contactParkingSlot,v=>Array.isArray(v)?v[0]:v,v=>v,v=>v);}
 const old=build(original(name)),updated=build(current(name));
 for(const contact of [null,{name:'Resident',phone:'9000000000',parking_slot:'P1'},[{name:'Resident',phone:'9000000000'}]]){
  const row={user_id:'resident',unit_flat_number:'101',role:['resident'],status:true,contact,SSP_Block:{block_name:'A'},SSP_Tower:{name:'T'},flat_type_id:'type',flatTypeRecord:{flat_type:'2 BHK'}};
  assert.deepEqual(withoutNewFields(updated(row,{})),old(row,{}));
 }
}
const society={society_id:'society',registration_number:'TEST',society_name:'Test'};
const users=[{user_id:'r1',role:['resident'],society:'society',deleted_at:null,status:true,unit_flat_number:'101',block:'block',tower:'tower',created_at:'2026-01-02',SSP_Block:{block_name:'A'},SSP_Tower:{name:'T'},SSP_Contact:{contact_id:'c1',name:'Alpha',phone:'9000000000',parking_slot:'P1'},flat_type_id:null,flatTypeRecord:null},{user_id:'r2',role:['resident'],society:'society',deleted_at:null,status:false,unit_flat_number:'102',created_at:'2026-01-01',SSP_Contact:{name:'Beta',phone:'9000000001'},flat_type_id:'type',flatTypeRecord:{flat_type:'2 BHK'}}];
class Query {
 constructor(table){this.table=table;this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this}
 contains(k,vs){this.filters.push(r=>vs.every(v=>(r[k]??[]).includes(v)));return this}
 not(){return this}
 rows(){return (this.table==='SSP_Society'?[society]:this.table==='SSP_Society_User'?users:this.table==='SSP_Block'?[{society:'society',block_id:'block',block_name:'A'}]:this.table==='SSP_Tower'?[{society:'society',tower_id:'tower',name:'T'}]:[]).filter(r=>this.filters.every(f=>f(r)))}
 async maybeSingle(){return{data:this.rows()[0]??null,error:null}}then(resolve,reject){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject)}
}
function load(source){let handler;const js=stripTypeScriptTypes(source.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));new Function('Deno','createClient','requireAuth','corsHeaders','errorResponse','successResponse','contactParkingSlot','residentFlatTypeFields','console',js)({env:{get:()=>''},serve:fn=>handler=fn},()=>({from:t=>new Query(t)}),fn=>req=>fn(req,{user:{id:"admin"}}),{},(message,status=400)=>new Response(JSON.stringify({message}),{status}),data=>new Response(JSON.stringify({data})),contactParkingSlot,residentFlatTypeFields,quiet);return async input=>{const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify(input)}));return {status:response.status,body:await response.json()}};}
const old=load(original('get-members')),updated=load(current('get-members'));
for(const extras of [{},{flat:'101'},{search:'Beta'},{status:'active'},{page:2,limit:1},{role:'vendor'},{role:'resident',block:'A',tower:'T'}]){
 const payload={registrationNumber:'TEST',role:'resident',...extras};const before=await old(payload),after=await updated(payload);
 assert.equal(before.status,200,JSON.stringify(before));assert.equal(after.status,200,JSON.stringify(after));assert.deepEqual(withoutNewFields(after.body),before.body);
}
console.log('Legacy compatibility passed: pre-change profile payloads and member list/search/filter/pagination/vendor responses preserved, with only additive flat-type fields.');
