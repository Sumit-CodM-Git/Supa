// Run: node supabase/tests/visitor-photo-flow.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const documents=[];
let uploadedBytes=null;
let storageError=null;
class Query {
 constructor(table){this.table=table;this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(row=>row[k]===v);return this}
 in(k,v){this.filters.push(row=>v.includes(row[k]));return this}
 not(k,op,v){assert.equal(op,'is');this.filters.push(row=>row[k]!==v);return this}
 order(k,{ascending}){this.sort={k,ascending};return this}
 insert(value){this.value=value;return this}
 async single(){return this.result()}async maybeSingle(){return this.result()}
 result(){
  if(this.table==='SSP_Non_Society_User')return {data:{non_society_user_id:'visitor',society:'society'},error:null};
  if(this.table==='SSP_Society')return {data:{society_id:'society'},error:null};
  assert.equal(this.table,'SSP_Document');
  if(this.value){assert.equal(this.value.document_type,'security_guard_image','Must match live chk_document_type constraint');const row={document_id:'doc-'+documents.length,...this.value};documents.push(row);return {data:row,error:null}}
  let rows=documents.filter(row=>this.filters.every(fn=>fn(row)));
  if(this.sort){const{k,ascending}=this.sort;rows.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(ascending?1:-1))}
  return {data:rows,error:null};
 }
 then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
}
const storage={
 createSignedUploadUrl:async key=>({data:{signedUrl:'https://upload.test/'+key},error:null}),
 getPublicUrl:key=>({data:{publicUrl:'https://project.supabase.co/storage/v1/object/public/society-documents/'+key}}),
 upload:async (key,bytes)=>{uploadedBytes=bytes;return {data:storageError?null:{path:key},error:storageError}},
 createSignedUrl:async key=>({data:{signedUrl:'https://view.test/'+key},error:null}),
 createSignedUrls:async keys=>({data:keys.map(path=>({path,signedUrl:'https://view.test/'+path})),error:null}),
 list:async()=>({data:[{name:'photo.png'}],error:null}),
 remove:async()=>({error:null}),
};
const client={from:table=>new Query(table),storage:{from:()=>storage}};
const log={info(){},warn(){},error(){}};
function load(name,returned=''){
 let handler;
 const src=stripTypeScriptTypes(readFileSync(new URL('../functions/'+name+'/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
 const extra=new Function('Deno','createClient','requireAuth','corsHeaders','successResponse','errorResponse','createLogger','injectedLogger',(name==='resident-visitor'?'const logger=injectedLogger;\n':'')+src+returned)
 ({env:{get:()=>''},serve:fn=>handler=fn},()=>client,fn=>fn,{},data=>new Response(JSON.stringify({data})),(message,status=400)=>new Response(JSON.stringify({message}),{status}),()=>log,log);
 return {extra,call:async body=>{const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify(body)}),{user:{id:'guard'}});return {status:response.status,body:await response.json()}}};
}
const base={societyRegistrationNumber:'TEST',visitorId:'visitor',fileName:'photo.png',fileType:'image/png'};
let response=await load('security-guard-image').call({...base,operation:'UPLOAD'});
assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(documents.at(-1).non_society_user,'visitor');
assert.equal(response.body.data.requiresUpload,true);
assert.ok(response.body.data.uploadUrl);
const camera=load('security-guard-image');
for(const fileBase64 of ['aGVsbG8=','data:image/png;base64,aGVsbG8=']){
 response=await camera.call({...base,operation:'UPLOAD',fileBase64});
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.equal(response.body.data.requiresUpload,false);
 assert.equal(response.body.data.uploadUrl,null);
 assert.ok(response.body.data.imageUrl.startsWith('https://view.test/'));
 assert.equal(new TextDecoder().decode(uploadedBytes),'hello');
 assert.equal(documents.at(-1).file_size,5);
}
for(const fileBase64 of ['',123,'invalid!']){
 const count=documents.length;
 response=await camera.call({...base,operation:'UPLOAD',fileBase64});
 assert.equal(response.status,400);assert.equal(documents.length,count);
}
storageError={message:'Simulated failure'};
response=await camera.call({...base,operation:'UPLOAD',fileBase64:'aGVsbG8='});
assert.equal(response.status,500);storageError=null;
const pass=load('visitor-pass-operations');
response=await pass.call({...base,operation:'UPLOAD',fileBase64:'iVBORw0KGgo='});
assert.equal(response.status,200,JSON.stringify(response.body));
response=await pass.call({...base,operation:'CONFIRM_UPLOAD',objectKey:'TEST/securityGuard/photo.png'});
assert.equal(response.status,200,JSON.stringify(response.body));
documents.length=0;
documents.push(
 {non_society_user:'visitor',society:'society',document_type:'security_guard_image',s3_path:'old.png',created_at:'2026-01-01'},
 {non_society_user:'visitor',society:'society',document_type:'security_guard_image',s3_path:'latest.png',created_at:'2026-11-10'},
 {non_society_user:'visitor',society:'society',document_type:'aadhaar_card',s3_path:'id.pdf',created_at:'2026-11-11'},
 {non_society_user:'visitor',society:'other',document_type:'visitor_image',s3_path:'wrong-society.png',created_at:'2026-11-12'},
 {non_society_user:'legacy',society:'society',document_type:'visitor_image',s3_path:'legacy.png',created_at:'2026-11-10'},
);
const fetchImages=load('resident-visitor','\nreturn fetchImageMap;').extra;
const images=await fetchImages(['visitor','legacy'],'society');
assert.equal(images.get('visitor'),'https://view.test/latest.png');
assert.equal(images.get('legacy'),'https://view.test/legacy.png');
assert.equal((await fetchImages([],'society')).size,0);
console.log('Visitor photos passed: legacy upload, base64 upload, confirm upload, valid document types, newest photo, ID-proof exclusion and society isolation.');
