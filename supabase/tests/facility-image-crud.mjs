// Run: node supabase/tests/facility-image-crud.mjs
import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import assert from 'node:assert/strict';
import {facilityImageInputs,createFacilityImageUploads} from '../functions/_shared/facility-images.ts';
let handler,documents=[],removed=[],facilityUpdates=0;
const facility={id:'facility',society:'society',name:'Court'};
class Query {
 constructor(table){this.table=table;this.filters=[];this.op='read'}
 select(){return this}eq(key,value){this.filters.push(row=>row[key]===value);return this}in(key,values){this.filters.push(row=>values.includes(row[key]));return this}
 order(){return this}range(){return this}
 insert(rows){this.op='insert';this.value=rows;return this}update(value){this.op='update';this.value=value;return this}delete(){this.op='delete';return this}
 async maybeSingle(){return {data:this.table==='SSP_Society'?{society_id:'society',society_name:'Society'}:facility,error:null}}
 then(resolve,reject){
  let data=[];
  if(this.table==='SSP_Society_User') data=[{role:['admin'],SSP_Contact:{phone:'9999999999'}}];
  if(this.table==='SSP_Facility') {data=[facility];if(this.op==='update') {facilityUpdates++;Object.assign(facility,this.value)}}
  if(this.table==='SSP_Document') {
   data=documents.filter(row=>this.filters.every(fn=>fn(row)));
   if(this.op==='delete') documents=documents.filter(row=>!data.includes(row));
   if(this.op==='insert') {data=this.value.map(row=>({...row,document_id:crypto.randomUUID()}));documents.push(...data)}
  }
  return Promise.resolve({data,count:data.length,error:null}).then(resolve,reject);
 }
}
const client={from:table=>new Query(table),storage:{from:()=>({createSignedUploadUrl:async key=>({data:{signedUrl:'https://upload/'+key}}),getPublicUrl:key=>({data:{publicUrl:'https://image/'+key}}),remove:async keys=>{removed.push(...keys);return{error:null}}})}};
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/crud-facility/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','createClient','requireAuth','corsHeaders','errorResponse','successResponse','createLogger','facilityImageInputs','createFacilityImageUploads',source)
 ({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},(message,status=400)=>new Response(JSON.stringify({message}),{status}),data=>new Response(JSON.stringify({success:true,data})),()=>({info(){},warn(){},error(){}}),facilityImageInputs,createFacilityImageUploads);
async function call(action,payload={}) {const result=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({registrationNumber:'REG',adminPhone:'9999999999',action,id:'facility',payload})}));return{status:result.status,body:await result.json()}}
const image={fileName:'Court.jpg',fileType:'image/jpeg'};
const created=await call('CREATE',{name:'Court',images:Array(5).fill(image)});
assert.equal(created.status,200);assert.equal(created.body.data.uploads.length,5);assert.equal(created.body.data.data[0].images.length,5);assert.equal(removed.length,0);
const denied=await call('UPDATE',{name:'Do not change',...image});assert.equal(denied.status,400);assert.equal(facilityUpdates,0);assert.equal(documents.length,5);
const replaced=await call('UPDATE',{deleteImageIds:[documents[0].document_id],...image});assert.equal(replaced.status,200);assert.equal(documents.length,5);assert.equal(removed.length,1);assert.ok(replaced.body.data.uploadUrl);assert.equal(replaced.body.data.uploads.length,1);
const viewed=await call('VIEW');assert.equal(viewed.body.data.data[0].images.length,5);assert.equal(viewed.body.data.data[0].imageDocuments.length,5);assert.equal(viewed.body.data.data[0].imageUrl,viewed.body.data.data[0].images[0]);
const deleted=await call('DELETE');assert.equal(deleted.status,200);assert.equal(documents.length,0);assert.equal(removed.length,6);
console.log('Facility CREATE/VIEW/UPDATE/DELETE image regression checks passed, including legacy upload fields and cap rejection before facility updates.');
