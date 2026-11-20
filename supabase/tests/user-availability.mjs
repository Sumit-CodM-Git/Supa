import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const read = name => readFileSync(new URL(`../functions/${name}`,import.meta.url),'utf8');
const strip = s => stripTypeScriptTypes(s.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export /gm,''));
const {handleUserAvailability,isUserAway}=new Function(strip(read('_shared/response.ts')+'\n'+read('_shared/user-availability.ts'))+'\nreturn {handleUserAvailability,isUserAway};')();
let row=null,error=null,writes=[],deviceReads=0;
const client={from(table){
 if(table==='SSP_User_Device')deviceReads++;
 return {select(){return this},eq(k,v){if(table==='SSP_User_Availability')assert.equal(v,'me');return this},
 upsert(value){writes.push(value);row={status:value.status,updated_at:'2026-11-16T10:00:00Z'};return this},
 async maybeSingle(){return {data:table==='SSP_Society_User'?{user_id:'me'}:row,error}},
 async single(){return {data:row,error}},then(resolve,reject){return Promise.resolve({data:[],error}).then(resolve,reject)}};
}};
async function call(body,method='POST'){
 const res=await handleUserAvailability(new Request('https://test',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})}),'me',client);
 return {status:res.status,body:await res.json()};
}
assert.equal((await call({action:'GET_STATUS'})).body.data.status,'active');
for(const status of ['active','inactive','away']){
 const res=await call({action:'SET_STATUS',status});assert.equal(res.status,200);
 assert.equal(res.body.data.notificationsEnabled,status!=='away');
 assert.equal(await isUserAway(client,'me'),status==='away');
}
const count=writes.length;
assert.equal((await call({action:'SET_STATUS',status:'away',userId:'someone-else'})).status,403);
for(const status of ['offline',null,{},'AWAY'])assert.equal((await call({action:'SET_STATUS',status})).status,400);
assert.equal((await call({action:'DELETE'})).status,400);
assert.equal((await call({},'GET')).status,405);
assert.equal(writes.length,count);
error={message:'database unavailable'};
assert.equal((await call({action:'GET_STATUS'})).status,500);
await assert.rejects(isUserAway(client,'me'),/Unable to check/);error=null;

// Suppress direct push/SOS before looking up devices or requesting Firebase credentials.
const direct=new Function('isUserAway','DJWT','Deno','console',strip(read('_shared/fcm.ts'))+'\nreturn sendFcmToUser;')(isUserAway,{}, {env:{get(){throw Error('must not load Firebase')}}},{log(){},error(){}});
row={status:'away'};assert.equal((await direct(client,'me',{title:'test',body:'test'})).skippedReason,'user_away');assert.equal(deviceReads,0);
row={status:'inactive'};await direct(client,'me',{title:'test',body:'test'});assert.equal(deviceReads,1);
error={message:'unavailable'};assert.equal((await direct(client,'me',{title:'test',body:'test'})).skippedReason,'availability_check_failed');assert.equal(deviceReads,1);

// A stale queued webhook must use the persisted delivery status, not its old payload.
for(const persisted of ['pending','failed']){
 let handler,reads=0,updated=false;
 const deliveryClient={from(table){if(table==='SSP_User_Device')reads++;return {
  select(){return this},eq(){return this},async maybeSingle(){return {data:{notification_id:'n',recipient_id:'me',recipient_type:'Resident',delivery_status:persisted},error:null}},
  update(value){updated=value.extra_data.suppressedReason==='user_away';return this},then(resolve){return Promise.resolve({error:null}).then(resolve)}
 }}};
 new Function('serve','createClient','DJWT','Deno','console','isUserAway',strip(read('send-notification/index.ts')))(fn=>handler=fn,()=>deliveryClient,{}, {env:{get:()=>''}}, {log(){},error(){}},async()=>true);
 const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({record:{notification_id:'n',delivery_status:'pending'}})}));
 const body=await response.json();assert.equal(body.skipped,true);assert.equal(body.reason,persisted==='pending'?'user_away':'already processed');assert.equal(reads,0);assert.equal(updated,persisted==='pending');
}
console.log('Availability passed: all states, default, ownership, validation, fail-closed lookup, regular/SOS suppression, inactive delivery, and stale webhook handling.');
