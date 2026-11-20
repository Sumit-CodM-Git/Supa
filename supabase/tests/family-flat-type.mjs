import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {resolveResidentFlatType,residentFlatTypeFields,ResidentFlatTypeError} from '../functions/_shared/resident-flat-type.ts';
import {CONTACT_PHONE_DUPLICATE_MESSAGE,contactParkingSlot,contactPhoneAlreadyExists,normalizeParkingSlot} from '../functions/_shared/contact.ts';
const id='00000000-0000-4000-8000-000000000001';
const tables={SSP_Flat_Type:[{flat_type_id:id,flat_type:'2 BHK',society:'A',active:true}],SSP_Contact:[],SSP_Society_User:[],SSP_Society:[{society_id:'A',society_name:'Alpha'}]};
class Query {
 constructor(table){this.table=table;this.filters=[]}
 select(columns){this.columns=columns;return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}neq(k,v){this.filters.push(r=>r[k]!==v);return this}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this}
 order(){return this}range(){return this}limit(){return this}in(k,values){this.filters.push(r=>values.includes(r[k]));return this}
 insert(value){this.value=value;this.op='insert';return this}update(value){this.value=value;this.op='update';return this}
 result(){
  let rows=tables[this.table]??[];
  if(this.op==='insert'){const row={...this.value,user_id:crypto.randomUUID(),contact_id:crypto.randomUUID()};rows.push(row);rows=[row]}
  else{rows=rows.filter(r=>this.filters.every(f=>f(r)));if(this.op==='update')rows.forEach(r=>Object.assign(r,this.value))}
  rows=rows.map(r=>({...r,contact:this.columns?.includes("contact:SSP_Contact")?(tables.SSP_Contact.find(c=>c.contact_id===r.contact)??r.contact):r.contact,flatTypeRecord:tables.SSP_Flat_Type.find(f=>f.flat_type_id===r.flat_type_id)??null}));
  return{data:rows,count:rows.length,error:null};
 }
 async single(){const r=this.result();return{...r,data:r.data[0]??null}}async maybeSingle(){return this.single()}
 then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
}
const client={from:t=>new Query(t)};
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/crud-family/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const handlers=new Function('serve','createClient','Deno','resolveResidentFlatType','residentFlatTypeFields','ResidentFlatTypeError','contactParkingSlot','normalizeParkingSlot','CONTACT_PHONE_DUPLICATE_MESSAGE','contactPhoneAlreadyExists',source+'\nreturn {handleCreate,handleView,handleUpdate};')(()=>{},()=>client,{env:{get:()=>''}},resolveResidentFlatType,residentFlatTypeFields,ResidentFlatTypeError,contactParkingSlot,normalizeParkingSlot,CONTACT_PHONE_DUPLICATE_MESSAGE,contactPhoneAlreadyExists);
const req=new Request('https://test',{method:'POST'});
const ctx={callerUserId:'primary',callerSocietyId:'A',callerFlat:'101',callerBlock:null,callerTower:null,callerOwnership:'primary',callerFlatTypeId:id,callerRoles:['resident']};
let r=await handlers.handleCreate(req,ctx,{memberName:'Family member',memberPhone:'9000000000',idProofType:'PAN',idProofNumber:'ABCDE1234F',relationship:'Brother'});
assert.equal(r.status,200);assert.equal(tables.SSP_Society_User[0].flat_type_id,id);assert.equal((await r.json()).data.familyUpdate.flatType,'2 BHK');
const contactCount=tables.SSP_Contact.length,userCount=tables.SSP_Society_User.length;
r=await handlers.handleCreate(req,ctx,{memberName:'Another family member',memberPhone:'9000000000',idProofType:'PAN',idProofNumber:'ABCDE1234G',relationship:'Sister'});
assert.equal(r.status,200);
assert.equal(tables.SSP_Contact.length,contactCount);assert.equal(tables.SSP_Society_User.length,userCount+1);
assert.equal(tables.SSP_Society_User[0].contact,tables.SSP_Society_User[1].contact);
r=await handlers.handleView(req,ctx,{});const viewed=(await r.json()).data.familyMembers[0];assert.equal(viewed.flatTypeId,id);assert.equal(viewed.flatType,'2 BHK');
const targetResidentId=tables.SSP_Society_User[0].user_id;
r=await handlers.handleUpdate(req,ctx,{targetResidentId,flatTypeId:null});assert.equal(r.status,200);assert.equal(tables.SSP_Society_User[0].flat_type_id,null);assert.equal((await r.json()).data.familyUpdate.flatType,null);
r=await handlers.handleUpdate(req,{...ctx,callerUserId:targetResidentId,callerOwnership:'secondary'},{targetResidentId,flatTypeId:id});assert.equal(r.status,403);assert.equal(tables.SSP_Society_User[0].flat_type_id,null);
console.log('Family flat type passed: inherited on create, included in view, clear assignment, secondary-member authorization.');
// Legacy clients can still add family when the primary's old type is inactive.
tables.SSP_Flat_Type[0].active=false;
r=await handlers.handleCreate(req,ctx,{memberName:'Legacy family',memberPhone:'9000000001',idProofType:'PAN',idProofNumber:'ABCDE1234G',relationship:'Brother'});
assert.equal(r.status,200);assert.equal(tables.SSP_Society_User.at(-1).flat_type_id,null);
const originalPhone=tables.SSP_Contact.find(c=>c.contact_id===tables.SSP_Society_User[0].contact).phone;
r=await handlers.handleUpdate(req,ctx,{targetResidentId,memberPhone:'9000000001'});
assert.equal(r.status,200);
assert.equal(tables.SSP_Contact.find(c=>c.contact_id===tables.SSP_Society_User[0].contact).phone,'9000000001');
await assert.rejects(()=>handlers.handleCreate(req,ctx,{memberName:'Explicit type',memberPhone:'9000000002',idProofType:'PAN',idProofNumber:'ABCDE1234H',relationship:'Brother',flatTypeId:id}),ResidentFlatTypeError);
// Existing secondary-member profile edits do not require new fields or clear assignments.
tables.SSP_Society_User[0].flat_type_id=id;
r=await handlers.handleUpdate(req,{...ctx,callerUserId:targetResidentId,callerOwnership:'secondary'},{targetResidentId,description:'Legacy profile edit'});
assert.equal(r.status,200);assert.equal(tables.SSP_Society_User[0].flat_type_id,id);
console.log('Legacy family requests passed: inactive inherited type does not block create; omitted fields preserve assignments on secondary profile edits.');
