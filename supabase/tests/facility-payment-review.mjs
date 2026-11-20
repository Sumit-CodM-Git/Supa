import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public."SSP_Payment" (pay_rec_id text PRIMARY KEY, payment_status text);
  CREATE TABLE public."SSP_Facility_Booking_Request" (request_id text PRIMARY KEY, payment text, status text);
  INSERT INTO public."SSP_Payment" VALUES ('old','under review'),('new','unpaid'),('paid','Paid'),('rejected','Rejected');
  INSERT INTO public."SSP_Facility_Booking_Request" VALUES
    ('old','old','waiting_payment'),('new','new','waiting_payment'),
    ('cancelled','old','cancelled'),('approved','old','approved'),
    ('rejected-booking','old','rejected'),('paid','paid','waiting_payment'),
    ('rejected-payment','rejected','waiting_payment');
`);
await db.exec(readFileSync(new URL('../migrations/20261118120000_sync_facility_payment_review.sql', import.meta.url),'utf8'));
const status = async id => (await db.query('SELECT status FROM public."SSP_Facility_Booking_Request" WHERE request_id=$1',[id])).rows[0].status;
assert.equal(await status('old'),'pending_verification');
assert.equal(await status('new'),'waiting_payment');
for (const value of ['cancelled','approved','rejected']) {
  assert.equal(await status(value === 'rejected' ? 'rejected-booking' : value),value);
}
assert.equal(await status('paid'),'waiting_payment');
assert.equal(await status('rejected-payment'),'waiting_payment');
await db.exec(`UPDATE public."SSP_Payment" SET payment_status='UNDER REVIEW' WHERE pay_rec_id='new';`);
assert.equal(await status('new'),'pending_verification');
await db.exec(`UPDATE public."SSP_Payment" SET payment_status='Paid' WHERE pay_rec_id='new';`);
assert.equal(await status('new'),'pending_verification','approval workflow owns final booking approval');
await db.close();
console.log('Facility review synchronization passed: new submissions, backfill, terminal status preservation, and approval separation.');
