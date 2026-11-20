// Run: node supabase/tests/payment-receipt-download.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {contactParkingSlot} from '../functions/_shared/contact.ts';
const me='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const paymentId='00000000-0000-4000-8000-000000000003';
const bytes=new TextEncoder().encode('%PDF-1.4\nTest PDF fixture\n%%EOF');
const member={user_id:me,status:true,deleted_at:null,unit_flat_number:'101',contact:{name:'Resident',phone:'9000000000',email:'resident@test'},society:{society_name:'Test Society',registration_number:'TEST'},tower:{name:'Tower'},block:{block_name:'Block'}};
const payment={pay_rec_id:paymentId,payment_id:'PAY-TEST',society_user:me,payment_status:'paid',amount:1000,receipt_url:null};
const payments=[payment,{...payment,pay_rec_id:other,payment_id:'PAY-OTHER',society_user:other}];
let metadataId=me,claimedId=me,invalidJwt=false,uploads=0,updates=0,uploadFailure=false,storageFailure=false,pdfFailure=false;
const files=new Map(),documents=[];
class Query{
 constructor(table){this.table=table;this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(row=>row[k]===v);return this}in(k,vs){this.filters.push(row=>vs.includes(row[k]));return this}
 not(k,op,v){this.filters.push(row=>row[k]!==v);return this}order(){return this}range(){return this}gte(){return this}lte(){return this}ilike(){return this}
 update(){updates++;throw new Error('Payment records must not be modified by receipt downloads')}
 rows(){return(this.table==='SSP_Payment'?payments:this.table==='SSP_Society_User'?[member]:this.table==='SSP_Document'?documents:[]).filter(row=>this.filters.every(fn=>fn(row))).map(row=>({...row}))}
 async maybeSingle(){return{data:this.rows()[0]??null,error:null}}
 then(resolve,reject){const rows=this.rows();return Promise.resolve({data:rows,error:null,count:rows.length}).then(resolve,reject)}
}
const storage={
 download:async key=>{if(storageFailure)throw new Error('Storage offline');return files.has(key)?{data:new Blob([files.get(key)]),error:null}:{data:null,error:{message:'Not found'}}},
 upload:async(key,value)=>{uploads++;if(uploadFailure)return{error:{message:'Upload failed'}};files.set(key,value);return{data:{path:key},error:null}},
 createSignedUrl:async key=>({data:{signedUrl:'https://download.test/'+key},error:null}),
};
const client={from:table=>new Query(table),auth:{admin:{getUserById:async()=>({data:{user:{id:'auth-id',phone:null,user_metadata:{user_id:metadataId}}},error:null})}},storage:{from:()=>storage}};
const font={widthOfTextAtSize:text=>text.length*4};
const page={drawText(){},drawRectangle(){},drawLine(){},drawImage(){}};
const pdf={create:async()=>{if(pdfFailure)throw new Error('PDF failed');return{addPage:()=>page,embedFont:async()=>font,save:async()=>bytes}}};
let handler;
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/generate-payment-receipt/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('Deno','createClient','rgb','verify','serve','PDFDocument','StandardFonts','contactParkingSlot',source)
 ({env:{get:key=>key==='SUPABASE_URL'?'https://project.test':key.includes('SECRET')?'test-secret-32-bytes-long-enough':''}},()=>client,()=>({}),async()=>{if(invalidJwt)throw new Error('Invalid JWT');return{sub:'auth-id',user_id:claimedId}},fn=>handler=fn,pdf,{Helvetica:'h',HelveticaBold:'b',HelveticaOblique:'i'},contactParkingSlot);
async function call(body={paymentId:'PAY-TEST'},headers={Authorization:'Bearer verified-fixture'},method='POST'){
 const response=await handler(new Request('https://test',{method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 const data=response.headers.get('content-type')?.includes('application/pdf')?new Uint8Array(await response.arrayBuffer()):await response.json();return{status:response.status,headers:response.headers,data};
}
let result=await call();assert.equal(result.status,200);assert.deepEqual(result.data,bytes);assert.equal(result.headers.get('content-type'),'application/pdf');assert.match(result.headers.get('content-disposition'),/attachment; filename="Receipt_PAY-TEST.pdf"/);assert.equal(result.headers.get('x-receipt-source'),'generated');assert.equal(uploads,0);assert.equal(updates,0);
result=await call({paymentId});assert.equal(result.status,200);
result=await call({paymentId:'PAY-OTHER'});assert.equal(result.status,404);
result=await call({list:true});assert.equal(result.status,200);assert.equal(result.data.receipts.length,1);assert.equal(result.data.receipts[0].paymentId,'PAY-TEST');
metadataId=other;result=await call();assert.equal(result.status,401);metadataId=me;
claimedId=undefined;result=await call();assert.equal(result.status,200);claimedId=me;
invalidJwt=true;assert.equal((await call()).status,401);invalidJwt=false;
assert.equal((await call({},{})).status,401);
member.status=false;assert.equal((await call()).status,403);member.status=true;
member.deleted_at='2026-01-01';assert.equal((await call()).status,403);member.deleted_at=null;
for(const status of ['unpaid','pending','rejected','under review','cancelled']){payment.payment_status=status;assert.equal((await call()).status,400)}payment.payment_status='Paid';assert.equal((await call()).status,200);payment.payment_status='paid';
assert.equal((await call({})).status,400);assert.equal((await call({paymentId:'PAY-TEST',responseFormat:'bad'})).status,400);assert.equal((await call({},undefined,'GET')).status,405);
payment.receipt_url='proof.png';files.set('proof.png',new Uint8Array([137,80,78,71]));result=await call();assert.equal(result.status,200);assert.equal(result.headers.get('x-receipt-source'),'generated');assert.equal(payment.receipt_url,'proof.png');assert.equal(updates,0);
payment.receipt_url='https://project.test/storage/v1/object/public/society-documents/old.pdf';files.set('old.pdf',bytes);result=await call();assert.equal(result.headers.get('x-receipt-source'),'stored');
payment.receipt_url='missing.pdf';documents.push({payment:paymentId,s3_path:'linked.pdf'});files.set('linked.pdf',bytes);result=await call();assert.equal(result.headers.get('x-receipt-source'),'stored');
files.clear();documents.length=0;payment.receipt_url=null;storageFailure=true;result=await call();assert.equal(result.status,200);assert.equal(result.headers.get('x-receipt-source'),'generated');storageFailure=false;
result=await call({paymentId:'PAY-TEST',responseFormat:'url'});assert.equal(result.status,200);assert.equal(result.data.mode,'url');assert.ok(result.data.downloadUrl);assert.equal(uploads,1);assert.equal(payment.receipt_url,null);assert.equal(updates,0);
result=await call();assert.equal(result.headers.get('x-receipt-source'),'stored');
files.clear();uploadFailure=true;assert.equal((await call({paymentId:'PAY-TEST',responseFormat:'url'})).status,500);uploadFailure=false;
pdfFailure=true;assert.equal((await call()).status,500);pdfFailure=false;
assert.equal(updates,0);
console.log('Receipt tests passed: phone-less login, identity fallback/mismatch, direct PDF/headers, UUID/display IDs, ownership/list isolation, paid status, stored/missing/image/document cases, storage fallback, optional JSON mode and error handling. Payment proof metadata is never overwritten. JWT verification and PDF encoding are stubbed here; live tests cover the real runtime.');
