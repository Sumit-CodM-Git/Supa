import assert from 'node:assert/strict';
import {visitorDateOtp} from '../functions/_shared/visitor-otp-date.ts';
for (const [date,expected] of [
 ['2026-11-09T06:00:00Z','091126'],
 ['2026-11-08T18:29:59Z','081126'],
 ['2026-11-08T18:30:00Z','091126'],
 ['2026-12-31T18:30:00Z','010127'],
 ['2028-02-28T18:30:00Z','290228'],
]) assert.equal(visitorDateOtp(new Date(date)),expected);
console.log('DDMMYY OTP tests passed for India midnight, year rollover, and leap day.');
