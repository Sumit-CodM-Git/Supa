import {resolveResidentFlatType,residentFlatTypeFields,ResidentFlatTypeError} from '../functions/_shared/resident-flat-type.ts';
// Run: node supabase/tests/update-member-parking.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {CONTACT_PHONE_DUPLICATE_MESSAGE,contactPhoneAlreadyExists,normalizeParkingSlot} from '../functions/_shared/contact.ts';
const flatId='00000000-0000-4000-8000-000000000001';
const memberId='41526542-03fa-42e3-b63a-62a4947496f6';
const member={user_id:memberId,contact:'contact',society:'society'};
const contact={contact_id:'contact',name:'Parking testing',phone:'9000000000',parking_slot:'OLD',society:'society'};
const otherContacts=[
 {contact_id:'other-contact',phone:'9000000001',society:'society'},
 {contact_id:'other-society-contact',phone:'9000000002',society:'another-society'},
];
let handler,fail=false,transform=false,writes=0;
class Query {
 constructor(table){this.table=table;this.filters=[]}
 select(){return this} eq(key,value){this.filters.push(row=>row[key]===value);return this}
 in(key,values){this.isPhoneLookup=true;this.filters.push(row=>values.includes(row[key]));return this}
 neq(key,value){this.filters.push(row=>row[key]!==value);return this}
 limit(){return this}
 update(value){this.value=value;return this}
 execute(){
  if(this.table==='SSP_Contact'&&this.isPhoneLookup) return {data:[contact,...otherContacts].filter(row=>this.filters.every(fn=>fn(row))).map(row=>({...row})),error:null};
  const row=this.table==='SSP_Flat_Type'?{flat_type_id:flatId,flat_type:'2 BHK',society:'society',active:true}:this.table==='SSP_Society_User'?member:contact;
  if(!this.filters.every(fn=>fn(row))) return {data:null,error:null};
  if(this.value){
   if(fail) return {data:null,error:{message:'Simulated database failure'}};
   writes++;Object.assign(row,this.value);
   if(transform && this.value.parking_slot) row.parking_slot='DB-'+this.value.parking_slot;
  }
  return {data:{...row},error:null};
 }
 async single(){return this.execute()} async maybeSingle(){return this.execute()}
 then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject)}
}
const client={from:table=>new Query(table),auth:{admin:{listUsers:async()=>({data:{users:[]}})}}};
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/update-member/index.ts',import.meta.url),'utf8').replace('constructor(message: string, public field?: string) {\n    super(message);', 'constructor(message: string, field?: string) {\n    super(message); this.field = field;').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','createClient','requireAuth','corsHeaders','errorResponse','successResponse','parseRequestBody','normalizeParkingSlot','resolveResidentFlatType','residentFlatTypeFields','ResidentFlatTypeError','CONTACT_PHONE_DUPLICATE_MESSAGE','contactPhoneAlreadyExists',source)
 ({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},
 (message,status=400)=>new Response(JSON.stringify({message}),{status}),
 data=>new Response(JSON.stringify({success:true,data})),req=>req.json(),normalizeParkingSlot,resolveResidentFlatType,residentFlatTypeFields,ResidentFlatTypeError,CONTACT_PHONE_DUPLICATE_MESSAGE,contactPhoneAlreadyExists);
async function run(updatedData){
 const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({memberId,updatedData})}),{user:{id:'admin'}});
 return {status:response.status,body:await response.json()};
}
let response=await run({parkingSlot:'  DEMO-P-00009  '});
assert.equal(response.status,200);assert.equal(contact.parking_slot,'DEMO-P-00009');
assert.equal(response.body.data.updatedMember.updatedData.parkingSlot,contact.parking_slot);
response=await run({parking_slot:'P-2'});
assert.equal(contact.parking_slot,'P-2');assert.equal(response.body.data.updatedMember.updatedData.parkingSlot,'P-2');
response=await run({fullName:'Renamed'});assert.equal(response.status,200);assert.equal(contact.parking_slot,'P-2');
response=await run({phone:'9000000000'});assert.equal(response.status,200);assert.equal(contact.phone,'9000000000');
const beforeDuplicatePhone=writes;
response=await run({phone:'9000000001',status:true});
assert.equal(response.status,200);assert.equal(contact.phone,'9000000001');
assert.ok(writes>beforeDuplicatePhone);assert.equal(member.status,true);
response=await run({phone:'9000000002'});assert.equal(response.status,200);
for(const value of [null,' ']){response=await run({parkingSlot:value});assert.equal(response.status,200);assert.equal(contact.parking_slot,null);assert.equal(response.body.data.updatedMember.updatedData.parkingSlot,null)}
const before=writes;response=await run({parkingSlot:123,status:true});assert.equal(response.status,400);assert.equal(writes,before);
member.contact=null;response=await run({parkingSlot:'X',status:true});assert.equal(response.status,400);assert.equal(writes,before);member.contact='contact';
fail=true;response=await run({parkingSlot:'FAIL'});assert.equal(response.status,500);assert.notEqual(response.body.success,true);assert.equal(contact.parking_slot,null);fail=false;
transform=true;response=await run({parkingSlot:'P-3'});assert.equal(response.status,200);assert.equal(response.body.data.updatedMember.updatedData.parkingSlot,'DB-P-3');
console.log('Update-member parking tests passed: database writes, saved-value response, aliases, preserve/clear, invalid input, missing contact and database failure.');

response=await run({flatTypeId:flatId});assert.equal(response.status,200);assert.equal(member.flat_type_id,flatId);assert.equal(response.body.data.updatedMember.updatedData.flatType,'2 BHK');
response=await run({flatTypeId:null});assert.equal(response.status,200);assert.equal(member.flat_type_id,null);assert.equal(response.body.data.updatedMember.updatedData.flatType,null);
const beforeFlatError=writes;response=await run({flatTypeId:'00000000-0000-4000-8000-000000000099'});assert.equal(response.status,400);assert.equal(writes,beforeFlatError);
member.flat_type_id=flatId;
response=await run({fullName:'Legacy update without new fields'});
assert.equal(response.status,200);assert.equal(member.flat_type_id,flatId);
console.log('Legacy member update preserves an existing flat-type assignment when new fields are omitted.');
