// Run with Node 26: node supabase/tests/facility-booking-cancellation.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { releaseUnpaidReservation } from '../functions/_shared/facility-reservations.ts';
const source = stripTypeScriptTypes(readFileSync(new URL('../functions/resident-facility-booking/index.ts', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, ''));
async function run(action, { owner = 'resident', paymentStatus = 'unpaid', requestStatus = 'waiting_payment', rpcError = null, rpcRefuse = false } = {}) {
  let handler;
  const calls = [];
  const oldRequest = { request_id: 'old', status: requestStatus, requested_by: owner, facility: 'facility', payment: 'old-pay',
    created_at: new Date().toISOString(), booking_start_date: '2090-01-01T06:30:00.000Z', booking_end_date: '2090-01-01T07:30:00.000Z', is_all_day: false };
  const oldPayment = { pay_rec_id: 'old-pay', payment_id: 'PAY-OLD', payment_status: paymentStatus, amount: 500 };
  const payments = [oldPayment];
  const requests = [oldRequest];
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value || (key.includes('date') && Date.parse(row[key]) === Date.parse(value))); return this; }
    ilike(key, value) { this.filters.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return this; }
    lt(key, value) { this.filters.push(row => Date.parse(row[key]) < Date.parse(value)); return this; }
    gt(key, value) { this.filters.push(row => Date.parse(row[key]) > Date.parse(value)); return this; }
    or() { this.filters.push(row => ['waiting_payment','pending_verification','approved','requested'].includes(row.status.toLowerCase())); return this; }
    order() { return this; }
    limit() { return this; }
    insert(value) { this.inserted = value; return this; }
    async single() {
      if (this.table === 'SSP_Payment') { const row = { ...this.inserted, pay_rec_id: 'new-pay' }; payments.push(row); return { data: row, error: null }; }
      const row = { ...this.inserted, request_id: 'new' }; requests.push(row); return { data: row, error: null };
    }
    async maybeSingle() {
      if (this.table === 'SSP_Society_User') return { data: { user_id: 'resident', SSP_Society: { society_id: 'society', registration_number: 'GZB-1234-ab' } }, error: null };
      return { data: this.rows()[0] ?? null, error: null };
    }
    rows() {
      if (this.table === 'SSP_Facility') return [{ id: 'facility', name: 'Court', base_price: 500, booking_mode: 'hourly', closed_days: '', on_maintenance: false }];
      return requests.filter(row => this.filters.every(filter => filter(row))).map(row => ({ ...row, payment: payments.find(pay => pay.pay_rec_id === row.payment) }));
    }
    then(resolve, reject) { return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject); }
  }
  const client = { from: table => new Query(table), rpc: async (name, args) => {
    calls.push(args);
    if (rpcError) return { data: null, error: { message: rpcError } };
    if (rpcRefuse || args.p_resident_id !== oldRequest.requested_by || !['unpaid','pending','waiting_payment'].includes(oldPayment.payment_status.toLowerCase())) return { data: false, error: null };
    oldRequest.status = 'cancelled'; oldPayment.payment_status = 'cancelled'; return { data: true, error: null };
  }};
  const deno = { env: { get: () => 'development' }, serve: fn => handler = fn };
  const success = data => new Response(JSON.stringify({ success: true, data }));
  const failure = (message, status = 400) => new Response(JSON.stringify({ success: false, message }), { status });
  new Function('Deno','requireAuth','createClient','corsHeaders','successResponse','errorResponse','createLogger','releaseUnpaidReservation','loadResidentFacilityBookings', source)
    (deno, fn => fn, () => client, {}, success, failure, () => ({ info() {}, error() {} }), releaseUnpaidReservation, async () => []);
  const body = { action, residentId: 'resident', societyRegistrationNumber: 'GZB-1234-ab', facilityName: 'Court',
    bookingStartDateTime: '2090-01-01T12:00:00+05:30', bookingEndDateTime: '2090-01-01T13:00:00+05:30' };
  if (['cancel_booking','abort_pending_booking'].includes(action)) body.bookingRequestId = 'old';
  const result = await handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) }), { user: { id: 'resident' } });
  return { status: result.status, body: await result.json(), calls, oldRequest, requests };
}
for (const action of ['cancel_booking','abort_pending_booking']) {
  assert.equal((await run(action)).status, 200);
  assert.equal((await run(action, { rpcError: 'database unavailable' })).status, 500);
  assert.equal((await run(action, { rpcRefuse: true })).status, 409);
  assert.equal((await run(action, { owner: 'other' })).status, 404);
}
assert.equal((await run('abort_pending_booking', { paymentStatus: 'paid' })).status, 409);
assert.equal((await run('abort_pending_booking', { paymentStatus: 'UNDER REVIEW' })).status, 409);
const retry = await run('book');
assert.equal(retry.status, 200, JSON.stringify(retry.body));
assert.equal(retry.oldRequest.status, 'cancelled');
assert.equal(retry.body.data.facilityBooking.amount, 500);
assert.equal((await run('book', { requestStatus: 'WAITING_PAYMENT' })).status, 200);
assert.equal((await run('book', { paymentStatus: 'UNDER REVIEW' })).status, 409);
assert.equal((await run('book', { paymentStatus: 'paid' })).status, 409);
assert.equal((await run('book', { owner: 'other' })).status, 409);
assert.equal((await run('book', { rpcError: 'database unavailable' })).status, 500);
assert.deepEqual((await run('get_blocked_slots')).body.data.blockedSlots, []);
assert.equal((await run('get_blocked_slots', { owner: 'other' })).body.data.blockedSlots.length, 1);
assert.equal((await run('get_blocked_slots', { paymentStatus: 'UNDER REVIEW' })).body.data.blockedSlots.length, 1);
console.log('Cancellation, exact-slot retry, payment protection, ownership, error propagation and blocked-slot regression checks passed.');
