import assert from 'node:assert/strict';
import {runComplaintOtpCycle} from '../functions/_shared/complaint-otp-cycle.ts';
const now='2026-11-10T09:00:00Z';
const fresh=()=>({complaint_id:'test',status:'assigned',deleted_at:null,start_otp:null,start_otp_generated_at:null,start_otp_verified_at:null,end_otp:null,end_otp_generated_at:null,end_otp_verified_at:null,completion_date_time:null});
let row=fresh(),writes=0,fail=false,race=false;
const client={from:()=>({update(patch){const predicates=[];return {eq(k,v){predicates.push(r=>r[k]===v);return this},is(k,v){predicates.push(r=>(r[k]??null)===v);return this},select(){return this},async maybeSingle(){if(fail)return {error:{message:'DB failure'}};if(race||!predicates.every(p=>p(row)))return {data:null};Object.assign(row,patch);writes++;return {data:{complaint_id:row.complaint_id}};}}}})};
const call=(stage,otp,t=now)=>runComplaintOtpCycle(client,{...row},stage,otp,'101126',t);
assert.equal((await call('END')).status,400);
assert.equal((await call('START')).status,200);const firstGenerated=row.start_otp_generated_at;
assert.equal((await call('START',undefined,'2026-11-10T09:01:00Z')).status,200);assert.equal(row.start_otp_generated_at,firstGenerated);
assert.equal((await call('START','000000')).status,400);
assert.equal((await call('START','bad')).status,400);
assert.equal((await call('START','101126','2026-11-10T09:11:00Z')).status,400);
assert.equal((await call('START',undefined,'2026-11-10T09:11:00Z')).status,200);
assert.equal((await call('START','101126','2026-11-10T09:12:00Z')).data.otpVerified,true);
assert.equal(row.status,'in_progress');const startVerified=row.start_otp_verified_at;
assert.equal((await call('START')).data.otpVerified,true);assert.equal(row.start_otp_verified_at,startVerified);
assert.equal((await call('START','101126')).data.otpVerified,true);
assert.equal((await call('END')).status,200);
assert.equal((await call('END')).status,200);
assert.equal((await call('END','000000')).status,400);
assert.equal((await call('END','101126')).data.otpVerified,true);
assert.equal(row.status,'resolved');assert.ok(row.completion_date_time);
const completedWrites=writes;assert.equal((await call('END')).data.nextStep,'COMPLETED');assert.equal((await call('END','101126')).status,200);assert.equal(writes,completedWrites);
assert.equal((await call('START')).status,400);
// Reproduce the exact broken database state: old END verification, active work.
row.status='in_progress';row.completion_date_time=null;
assert.equal((await call('END','101126')).status,400);
assert.equal((await call('END')).status,200);assert.equal(row.end_otp_verified_at,null);
assert.equal((await call('END','101126')).status,200);assert.equal(row.status,'resolved');
// Restart stale work from START and ensure the old END is removed.
row.status='assigned';assert.equal((await call('START')).status,200);assert.equal(row.start_otp_verified_at,null);assert.equal(row.end_otp_verified_at,null);
assert.equal((await call('END')).status,400);
assert.equal((await call('START','101126')).status,200);assert.equal((await call('END')).status,200);assert.equal((await call('END','101126')).status,200);
// A previously verified START left in Pending can begin a fresh work cycle.
row={...fresh(),status:'Pending',start_otp:'101126',start_otp_generated_at:'2026-11-10T08:00:00Z',start_otp_verified_at:'2026-11-10T08:01:00Z'};
assert.equal((await call('START')).status,200);assert.equal(row.start_otp_verified_at,null);assert.equal(row.status,'Pending');
assert.equal((await call('START','101126')).data.status,'in_progress');assert.equal(row.status,'in_progress');
assert.equal((await call('END')).status,200);assert.equal((await call('END','101126')).data.status,'resolved');
for(const status of ['cancelled','rejected','new']){row={...fresh(),status};assert.equal((await call('START')).status,400);assert.equal((await call('END')).status,400);}
row=fresh();fail=true;assert.equal((await call('START')).status,500);fail=false;race=true;assert.equal((await call('START')).status,409);race=false;
console.log('Complaint OTP cycle passed: START→END, required start, retries, wrong/expired OTP, completed retries, stale reopened state, restart, closed states, DB failures, races.');
