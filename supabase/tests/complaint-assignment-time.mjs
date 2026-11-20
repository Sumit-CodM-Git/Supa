import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
import{parseComplaintAssignmentTime,complaintAssignmentISO,complaintAssignmentISTISO}from'../functions/_shared/complaint-time.ts';
for(const value of ['2026-11-11T14:47:00','2026-11-11 14:47:00','2026-11-11T14:47:00+05:30','2026-11-11T09:17:00Z'])assert.equal(complaintAssignmentISO(value),'2026-11-11T09:17:00.000Z');
assert.equal(complaintAssignmentISO('2026-11-11T13:44:00'),'2026-11-11T08:14:00.000Z');
for(const value of [null,undefined,'','invalid'])assert.equal(parseComplaintAssignmentTime(value),null);
for(const name of ['staff-complaints','resident-complaints','get-complaints']){
 const source=readFileSync('supabase/functions/'+name+'/index.ts','utf8');const start=source.indexOf('\nfunction formatToIST('),end=source.indexOf('\n}',start)+2;
 const formatter=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
 const fn=new Function('IST_FORMATTER',stripTypeScriptTypes(source.slice(start,end))+';return formatToIST;')(formatter);
 const expected=fn(new Date('2026-11-11T09:17:00Z'));
 assert.equal(fn(parseComplaintAssignmentTime('2026-11-11T14:47:00')),expected);
 assert.match(expected,/02:47:00/);
}
console.log('Assignment time passed: 2:47 pm stays 2:47 pm IST, not 8:17 pm; explicit UTC/IST offsets, legacy naive values, invalid/null values and all three display formatters.');

for (const value of ['2026-11-11 15:54:10', '2026-11-11T10:24:10.000Z', '2026-11-11T15:54:10+05:30', new Date('2026-11-11T10:24:10Z')]) {
 assert.equal(complaintAssignmentISTISO(value),'2026-11-11T15:54:10.000+05:30');
 assert.equal(new Date(complaintAssignmentISTISO(value)).toISOString(),'2026-11-11T10:24:10.000Z');
}
for (const value of [null, undefined, '', 'invalid']) assert.equal(complaintAssignmentISTISO(value),null);
assert.equal(complaintAssignmentISTISO('2026-11-11T23:30:00Z'),'2026-11-12T05:00:00.000+05:30');
console.log('IST response passed: local offset, same instant, UTC/IST/naive/Date inputs, nulls and date rollover.');
