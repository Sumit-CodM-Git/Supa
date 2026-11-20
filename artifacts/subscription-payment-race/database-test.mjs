import {PGlite} from '/private/tmp/ssp-availability-sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export const db=new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE "SSP_Subscription_Plan"(plan_id uuid PRIMARY KEY,plan_code text UNIQUE);
CREATE TABLE "SSP_Payment"(pay_rec_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now(),amount numeric,payment_status text,payment_type text,payment_method text,payment_id text,transaction_id text,society_user uuid,payment_date timestamp,receipt_information text);
CREATE TABLE "SSP_Subscription"(subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),society uuid NOT NULL,tower uuid NOT NULL,block uuid,flat_number text NOT NULL,owner_society_user uuid,plan_id uuid REFERENCES "SSP_Subscription_Plan",plan_price_id uuid,status text NOT NULL,start_date timestamptz NOT NULL DEFAULT now(),end_date timestamptz,auto_renew boolean DEFAULT false,payment_provider text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uq_active_flat_subscription ON "SSP_Subscription"(society,coalesce(tower::text,'∅'),coalesce(block::text,'∅'),upper(trim(flat_number))) WHERE status IN ('trial','active');
CREATE TABLE "SSP_Subscription_Payment"(subscription_payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subscription_id uuid NOT NULL REFERENCES "SSP_Subscription",payment uuid NOT NULL REFERENCES "SSP_Payment",provider text NOT NULL,provider_order_id text NOT NULL,provider_payment_id text,provider_signature_verified boolean,payment_purpose text NOT NULL,captured_at timestamptz);
CREATE UNIQUE INDEX uq_subscription_payment_provider_payment_id ON "SSP_Subscription_Payment"(provider,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
`);
await db.exec(readFileSync('supabase/migrations/20261117200000_atomic_subscription_payment.sql','utf8'));
const free='00000000-0000-4000-8000-000000000001',premium='00000000-0000-4000-8000-000000000002';
await db.query('INSERT INTO "SSP_Subscription_Plan" VALUES ($1,\'FREE\'),($2,\'PREMIUM\')',[free,premium]);
export const input={paymentId:'pay_test',orderId:'order_test',ownerUserId:'00000000-0000-4000-8000-000000000003',society:'00000000-0000-4000-8000-000000000004',tower:'00000000-0000-4000-8000-000000000005',block:null,flatNumber:'101',planCode:'PREMIUM',planPriceId:null,validityMonths:1,amountPaise:19900,paymentPurpose:'new',targetSubscriptionId:null};
export async function finalize(i){return (await db.query('SELECT public.finalize_razorpay_subscription_payment($1::jsonb) AS result',[JSON.stringify(i)])).rows[0].result}
export async function counts(){return (await db.query('SELECT (SELECT count(*)::int FROM "SSP_Payment") AS payments,(SELECT count(*)::int FROM "SSP_Subscription") AS subscriptions,(SELECT count(*)::int FROM "SSP_Subscription_Payment") AS links')).rows[0]}
const first=await finalize(input);assert.equal(first.alreadyProcessed,false);
const concurrent=await Promise.all(Array.from({length:8},()=>finalize(input)));
assert.ok(concurrent.every(r=>r.alreadyProcessed && r.subscriptionId===first.subscriptionId));
assert.deepEqual(await counts(),{payments:1,subscriptions:1,links:1});
for(const changes of [{ownerUserId:crypto.randomUUID()},{orderId:'wrong_order'}])await assert.rejects(()=>finalize({...input,...changes}),/does not belong/);
const before=await counts();await assert.rejects(()=>finalize({...input,paymentId:'pay_other',orderId:'order_other'}),/active paid subscription/);assert.deepEqual(await counts(),before);
const freeSub=(await db.query('INSERT INTO "SSP_Subscription"(society,tower,flat_number,owner_society_user,plan_id,status) VALUES ($1,$2,\'102\',$3,$4,\'active\') RETURNING subscription_id',[input.society,input.tower,input.ownerUserId,free])).rows[0].subscription_id;
const upgraded=await finalize({...input,paymentId:'pay_free_legacy',orderId:'order_free',flatNumber:'102'});assert.equal(upgraded.subscriptionId,freeSub);assert.equal(upgraded.paymentPurpose,'upgrade');
const renewal={...input,paymentId:'pay_renewal',orderId:'order_renewal',paymentPurpose:'renewal',targetSubscriptionId:first.subscriptionId};
const renewed=await finalize(renewal);assert.ok(new Date(renewed.endDate)>new Date(first.endDate));assert.equal((await finalize(renewal)).endDate,renewed.endDate);
const explicit={...input,paymentId:'pay_upgrade',orderId:'order_upgrade',paymentPurpose:'upgrade',targetSubscriptionId:first.subscriptionId};
const explicitResult=await finalize(explicit);assert.equal(explicitResult.subscriptionId,first.subscriptionId);assert.equal((await finalize(explicit)).endDate,explicitResult.endDate);
await assert.rejects(()=>finalize({...explicit,paymentId:'pay_foreign',flatNumber:'999'}),/does not belong/);
// An old failed verifier may have committed a payment but not its subscription/link.
const orphan=(await db.query('INSERT INTO "SSP_Payment"(payment_id,payment_type,amount,society_user) VALUES (\'pay_orphan\',\'subscription\',199,$1) RETURNING pay_rec_id',[input.ownerUserId])).rows[0].pay_rec_id;
assert.equal((await finalize({...input,paymentId:'pay_orphan',orderId:'order_orphan',flatNumber:'103'})).paymentRecordId,orphan);
// Force failure on the last write: payment and subscription must both roll back.
await db.exec(`CREATE FUNCTION fail_test_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_payment_id='pay_rollback' THEN RAISE EXCEPTION 'test link failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_test_link BEFORE INSERT ON "SSP_Subscription_Payment" FOR EACH ROW EXECUTE FUNCTION fail_test_link();`);
const beforeFailure=await counts();await assert.rejects(()=>finalize({...input,paymentId:'pay_rollback',flatNumber:'104'}),/test link failure/);assert.deepEqual(await counts(),beforeFailure);
const recoveryEnd=renewed.endDate;
const recovered=await finalize({...renewal,paymentId:'pay_saved_progress',orderId:'order_saved_progress',recoverySubscriptionId:first.subscriptionId});
assert.equal(recovered.endDate,explicitResult.endDate);
const recoveredDates=await finalize({...renewal,paymentId:'pay_saved_end',orderId:'order_saved_end',recoveryEndDate:recoveryEnd});
assert.equal(recoveredDates.endDate,recoveryEnd);
const permission=(await db.query("SELECT has_function_privilege('authenticated','public.finalize_razorpay_subscription_payment(jsonb)','EXECUTE') AS client,has_function_privilege('service_role','public.finalize_razorpay_subscription_payment(jsonb)','EXECUTE') AS service")).rows[0];assert.equal(permission.client,false);assert.equal(permission.service,true);
console.log('Atomic payment database checks passed: replay/concurrent submissions, ownership/order/flat validation, paid-plan protection, legacy FREE upgrade, renewal once, upgrade once, orphan reuse, rollback on link failure, service-only access.');
if(process.argv[1].endsWith('database-test.mjs'))await db.close();
