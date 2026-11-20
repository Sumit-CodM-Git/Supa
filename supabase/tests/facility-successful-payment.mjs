import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA storage;
 CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
 CREATE TABLE public."SSP_Payment"(pay_rec_id uuid PRIMARY KEY,society_user uuid,payment_type text,payment_status text,receipt_url text,rejection_reason text);
 CREATE TABLE public."SSP_Document"(payment uuid,s3_path text);
 CREATE TABLE public."SSP_Facility_Booking_Request"(request_id uuid,payment uuid,status text,rejection_reason text,rejected_at timestamptz);
 CREATE TABLE public."SSP_Facility_Booking"(payment uuid,approval_status text,booking_status text);
`);
// Install the two deployed predecessors before applying the new semantics.
for(const file of ['20261118100000_receipt_upload_payment_review.sql','20261118120000_sync_facility_payment_review.sql'])
 await db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
const user='00000000-0000-4000-8000-000000000001';
const ids=Array.from({length:7},(_,i)=>`00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`);
async function seed(id,type,status,key,booking='waiting_payment'){
 await db.query('INSERT INTO public."SSP_Payment" VALUES($1,$2,$3,$4,$5,NULL)',[id,user,type,status,key]);
 if(type==='facility_booking')await db.query('INSERT INTO public."SSP_Facility_Booking_Request" VALUES($1,$1,$2,NULL,NULL)',[id,booking]);
}
async function state(id){return (await db.query('SELECT p.payment_status,r.status FROM public."SSP_Payment" p LEFT JOIN public."SSP_Facility_Booking_Request" r ON r.payment=p.pay_rec_id WHERE p.pay_rec_id=$1',[id])).rows[0]}
await seed(ids[0],'facility_booking','UNDER REVIEW','soc/financial/old.jpg');
await db.query('INSERT INTO storage.objects VALUES($1,$2,$3)',['society-documents','soc/financial/old.jpg','{"size":100}']);
await db.exec(readFileSync(new URL('../migrations/20261118140000_successful_facility_payment_pending_approval.sql',import.meta.url),'utf8'));
assert.deepEqual(await state(ids[0]),{payment_status:'Successful',status:'pending_verification'});
await seed(ids[1],'facility_booking','unpaid','soc/financial/new.jpg');
const confirm=async(id,owner=user)=>(await db.query('SELECT public.confirm_resident_payment_proof($1,$2) AS result',[id,owner])).rows[0].result;
assert.equal((await confirm(ids[1])).http_status,409);
assert.equal((await confirm(ids[1],ids[2])).http_status,404);
assert.equal((await state(ids[1])).payment_status,'unpaid');
await db.query('INSERT INTO storage.objects VALUES($1,$2,$3)',['society-documents','soc/financial/new.jpg','{"size":100}']);
assert.deepEqual(await state(ids[1]),{payment_status:'Successful',status:'pending_verification'});
assert.deepEqual(await confirm(ids[1]),{payment_status:'Successful',approval_status:'pending_verification'});
await seed(ids[2],'Maintenance','UNPAID','soc/financial/maintenance.jpg');
await db.query('INSERT INTO storage.objects VALUES($1,$2,$3)',['society-documents','soc/financial/maintenance.jpg','{"size":100}']);
assert.equal((await state(ids[2])).payment_status,'UNDER REVIEW');
await db.query('UPDATE public."SSP_Payment" SET payment_status=$1,rejection_reason=$2 WHERE pay_rec_id=$3',['Rejected','Unclear proof',ids[1]]);
assert.deepEqual(await state(ids[1]),{payment_status:'Rejected',status:'rejected'});
assert.equal((await confirm(ids[1])).payment_status,'Rejected','old proof must not reverse admin rejection');
await db.query('UPDATE storage.objects SET metadata=$1 WHERE name=$2',['{"size":200}','soc/financial/new.jpg']);
assert.equal((await state(ids[1])).payment_status,'Rejected');
await seed(ids[3],'facility_booking','Paid','soc/financial/paid.jpg','BOOKED');
await db.query('INSERT INTO storage.objects VALUES($1,$2,$3)',['society-documents','soc/financial/paid.jpg','{"size":100}']);
assert.equal((await state(ids[3])).payment_status,'Paid');
await seed(ids[4],'facility_booking','unpaid','soc/financial/cancelled.jpg','cancelled');
await db.query('INSERT INTO storage.objects VALUES($1,$2,$3)',['society-documents','soc/financial/cancelled.jpg','{"size":100}']);
assert.deepEqual(await state(ids[4]),{payment_status:'unpaid',status:'cancelled'});
await db.close();
for(const ep of ['resident-payments-console','make-resident-payment','view-resident-payments','get-payments-list','admin-payments-console','resident-facility-booking'])stripTypeScriptTypes(readFileSync(new URL('../functions/'+ep+'/index.ts',import.meta.url),'utf8'));
console.log('Facility Successful/pending approval SQL checks passed: upload, confirmation, ownership, missing proof, non-facility review, rejection synchronization, terminal preservation. Updated handlers parse.');
// Confirmed booking approval takes precedence over its historical request.
const helper=stripTypeScriptTypes(readFileSync(new URL('../functions/_shared/facility-payment-status.ts',import.meta.url),'utf8')).replace(/^export /gm,'');
const {facilityPaymentApprovals}=new Function(helper+'; return {facilityPaymentApprovals};')();
const approvals=await facilityPaymentApprovals({from(table){return {select(){return {in:async()=>({data:table==='SSP_Facility_Booking_Request'?[{payment:'p',status:'BOOKED'},{payment:'q',status:'pending_verification'}]:[{payment:'p',approval_status:'Approved',booking_status:'Approved'}],error:null})}}}}},['p','q']);
assert.equal(approvals.get('p'),'Approved');assert.equal(approvals.get('q'),'pending_verification');
console.log('Separate payment approval mapping passed.');
