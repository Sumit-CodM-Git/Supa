// Local PostgreSQL test only; install @electric-sql/pglite in an isolated temp directory.
import {readFileSync,writeFileSync} from 'node:fs';
import {PGlite} from '/private/tmp/ssp-availability-sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public."SSP_Notification" (
 notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(),
 title text, message text, notification_type text, recipient_type text, recipient_id uuid,
 delivery_status text CHECK(delivery_status IN ('pending','sent','failed')),extra_data jsonb,
 dedup_key text,reference_table text,reference_id uuid
);
INSERT INTO public."SSP_Notification"(recipient_id,delivery_status,extra_data)
VALUES('3096f2ea-dba7-46fa-9b56-00add869b034','sent','{}');`);
await db.exec(readFileSync('supabase/migrations/20261116100000_user_availability.sql','utf8'));
await db.exec('BEGIN;');
await db.exec(readFileSync('supabase/tests/user-availability.sql','utf8'));
await db.exec('ROLLBACK;');
const {rows}=await db.query('SELECT count(*)::int AS remaining_test_availability FROM public."SSP_User_Availability"');
if(rows[0].remaining_test_availability!==0)throw Error('Test cleanup failed');
const report={engine:'local PostgreSQL (PGlite)',migration:'passed',database_trigger_tests:'passed',production_changed:false,push_sent:false};
writeFileSync('artifacts/user-availability/migration-test.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
await db.close();
