import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {visitorTimeISTISO} from '../functions/_shared/visitor-time.ts';
const expected='2026-11-11T11:33:00.000+05:30';
for(const value of ['2026-11-11 06:03:00','2026-11-11T06:03:00','2026-11-11T06:03:00Z','2026-11-11T11:33:00+05:30',new Date('2026-11-11T06:03:00Z')]){assert.equal(visitorTimeISTISO(value),expected);assert.equal(new Date(visitorTimeISTISO(value)).toISOString(),'2026-11-11T06:03:00.000Z')}
for(const value of [null,undefined,'','invalid',new Date('invalid')])assert.equal(visitorTimeISTISO(value),null);
assert.equal(visitorTimeISTISO('2026-11-11T20:00:00Z'),'2026-11-12T01:30:00.000+05:30');
const raw={non_society_user_id:'visitor',role:'visitor',name:'Guest',check_in:'2026-11-11T06:03:00',check_out:'2026-11-11T07:03:00'};
const checkout='2026-11-11T12:33:00.000+05:30';
for(const name of ['get-visitors','my-visitors','resident-visitor','security-gate-console','visitor-pass-operations']){
 const source=readFileSync('supabase/functions/'+name+'/index.ts','utf8');
 const fnName=['get-visitors','my-visitors'].includes(name)?'normalizeVisitorData':name==='resident-visitor'?'toVisitorItem':'attachSignedURLsToVisitors';
 const start=source.lastIndexOf((fnName==='attachSignedURLsToVisitors'?'async ':'')+'function '+fnName+'(');const end=source.indexOf('\n}',start)+2;
 const fn=new Function('visitorTimeISTISO','contactParkingSlot','firstOrNull','visitorApprovalState',stripTypeScriptTypes(source.slice(start,end))+';return '+fnName)(visitorTimeISTISO,()=>null,v=>Array.isArray(v)?v[0]:v,()=>({}));
 const client={from:()=>({select(){return this},in(){return this},order(){return this},then(resolve){return Promise.resolve({data:[]}).then(resolve)}})};
 const out=fnName==='attachSignedURLsToVisitors'?(await fn(client,[raw],'TEST'))[0]:fn(raw,null);
 assert.equal(out.checkIn??out.checkInTime,expected,name);assert.equal(out.checkOut??out.checkOutTime,checkout,name);
}
const logs=readFileSync('supabase/functions/resident-visitor-logs/index.ts','utf8');assert.match(logs,/checkInTime: visitorTimeISTISO\(raw.check_in\)/);assert.match(logs,/checkOutTime: visitorTimeISTISO\(raw.check_out\)/);
console.log('Visitor local time passed across admin, resident and security formatters: 06:03 UTC = 11:33 IST; checkout, explicit offsets, UTC storage, nulls and midnight rollover.');
