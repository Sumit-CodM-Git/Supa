import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Point PGLITE_MODULE at an installed @electric-sql/pglite module.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA storage;
  CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);
  CREATE TABLE public."SSP_Payment" (pay_rec_id text PRIMARY KEY, payment_status text, receipt_url text);
  CREATE TABLE public."SSP_Document" (payment text, s3_path text);
`);
const ref = key => `https://project.test/storage/v1/object/public/society-documents/${key}`;
const payment = async (id, status, reference) => db.query(
  'INSERT INTO public."SSP_Payment" VALUES ($1,$2,$3)', [id, status, reference],
);
const upload = async (key, size = 100, bucket = 'society-documents') => db.query(
  'INSERT INTO storage.objects VALUES ($1,$2,$3)', [bucket, key, JSON.stringify({ size })],
);
const status = async id => (await db.query(
  'SELECT payment_status FROM public."SSP_Payment" WHERE pay_rec_id=$1', [id],
)).rows[0].payment_status;

await payment('existing', 'unpaid', ref('soc/financial/old.jpg'));
await payment('rejected-old', 'REJECTED', ref('soc/financial/rejected.jpg'));
await payment('missing', 'UNPAID', ref('soc/financial/missing.jpg'));
await payment('empty', 'UNPAID', ref('soc/financial/empty.jpg'));
await upload('soc/financial/old.jpg');
await upload('soc/financial/rejected.jpg');
await upload('soc/financial/empty.jpg', 0);
await db.exec(readFileSync(new URL('../migrations/20261118100000_receipt_upload_payment_review.sql', import.meta.url), 'utf8'));
assert.equal(await status('existing'), 'UNDER REVIEW');
assert.equal(await status('rejected-old'), 'REJECTED');
assert.equal(await status('missing'), 'UNPAID');
assert.equal(await status('empty'), 'UNPAID');

await payment('new', 'unpaid', ref('soc/financial/new.jpg'));
assert.equal(await status('new'), 'unpaid', 'preparing a URL must not submit payment');
await upload('soc/financial/new.jpg');
assert.equal(await status('new'), 'UNDER REVIEW', 'upload must submit without confirmation');
await payment('doc-only', 'UNPAID', null);
await db.query('INSERT INTO public."SSP_Document" VALUES ($1,$2)', ['doc-only', ref('soc/financial/doc.pdf')]);
await upload('soc/financial/doc.pdf');
assert.equal(await status('doc-only'), 'UNDER REVIEW');
await payment('paid', 'PAID', ref('soc/financial/paid.jpg'));
await upload('soc/financial/paid.jpg');
assert.equal(await status('paid'), 'PAID');
await payment('resubmit', 'REJECTED', ref('soc/financial/resubmit.jpg'));
await upload('soc/financial/resubmit.jpg');
assert.equal(await status('resubmit'), 'UNDER REVIEW');
await payment('other-bucket', 'UNPAID', ref('soc/financial/other.jpg'));
await upload('soc/financial/other.jpg', 100, 'other-bucket');
assert.equal(await status('other-bucket'), 'UNPAID');
await db.query('UPDATE storage.objects SET metadata=$1 WHERE name=$2', [JSON.stringify({size:100}), 'soc/financial/empty.jpg']);
assert.equal(await status('empty'), 'UNDER REVIEW');
await db.query('UPDATE storage.objects SET metadata=$1 WHERE name=$2', [JSON.stringify({size:200}), 'soc/financial/rejected.jpg']);
assert.equal(await status('rejected-old'), 'REJECTED', 'metadata maintenance cannot reverse rejection');
await db.close();
console.log('Payment review SQL checks passed: upload, repair, document fallback, incomplete upload, bucket isolation, and terminal status preservation.');
