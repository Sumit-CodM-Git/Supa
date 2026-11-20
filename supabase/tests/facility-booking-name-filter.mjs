// Run: node supabase/tests/facility-booking-name-filter.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const society='TEST-REG';
function row(id,name,facilityId,status,payment,time,reg=society,request=false){return {
 name:id,request_id:request?id:undefined,status,approval_status:status,payment,
 booking_start_date:'2026-11-10T10:00:00Z',booking_end_date:'2026-11-10T11:00:00Z',created_at:time,
 booking_facility:{id:facilityId,name},
 booking_resident:{SSP_Society:{registration_number:reg},SSP_Contact:{name:'Resident One',phone:'9000000000'}},
}}
const bookings=[
 row('b1','Party Hall','hall','approved','p1','2026-11-10T10:00:00Z'),
 row('b2','Party Hall','hall','requested',null,'2026-11-10T09:00:00Z'),
 row('b3','Swimming Pool','pool','approved','p3','2026-11-09T08:00:00Z'),
 row('b4','Party Hall','other-hall','approved','p4','2026-11-10T10:00:00Z','OTHER-REG'),
 row('b5','Pool 100%_ (East), "A"','special','approved',null,'2026-11-11T10:00:00Z'),
 row('b6','Pool 100XX (East), "A"','different','approved',null,'2026-11-11T10:00:00Z'),
];
const requests=[
 row('r1','Party Hall','hall','pending_verification','p1','2026-11-09T07:00:00Z',society,true),
 row('r2','Party Hall','hall','waiting_payment','p2','2026-11-10T11:00:00Z',society,true),
 row('r3','Swimming Pool','pool','waiting_payment','p5','2026-11-09T11:00:00Z',society,true),
];
const get=(row,path)=>path.split('.').reduce((value,key)=>value?.[key],row);
function like(value,pattern){
 let regex='^';
 const literal=c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(let i=0;i<pattern.length;i++){
  if(pattern[i]==='\\'&&i+1<pattern.length)regex+=literal(pattern[++i]);
  else if(pattern[i]==='%')regex+='.*';
  else if(pattern[i]==='_')regex+='.';
  else regex+=literal(pattern[i]);
 }
 return new RegExp(regex+'$','iu').test(String(value??''));
}
const calls=[];
class Query {
 constructor(table){this.table=table;this.filters=[];this.search=[];this.orders=[];calls.push(this)}
 select(value){this.columns=value;return this}
 eq(path,value){this.filters.push(row=>get(row,path)===value);return this}
 in(path,values){this.filters.push(row=>values.includes(get(row,path)));return this}
 gte(path,value){this.filters.push(row=>Date.parse(get(row,path))>=Date.parse(value));return this}
 lte(path,value){this.filters.push(row=>Date.parse(get(row,path))<=Date.parse(value));return this}
 ilike(path,value){
  if(path.startsWith('search_'))this.search.push(row=>like(path==='search_facility.name'?row.booking_facility.name:row.booking_resident.SSP_Contact.name,value));
  else this.filters.push(row=>like(get(row,path),value));
  return this;
 }
 or(value){assert.equal(value,'search_facility.not.is.null,search_resident.not.is.null');this.filters.push(row=>this.search.some(fn=>fn(row)));return this}
 order(field,{ascending}){this.orders.push({field,ascending});return this}
 range(start,end){this.slice=[start,end];return this}
 then(resolve,reject){
  let rows=(this.table==='SSP_Facility_Booking'?bookings:requests).filter(row=>this.filters.every(fn=>fn(row)));
  rows.sort((a,b)=>{for(const {field,ascending} of this.orders){const comparison=String(a[field]).localeCompare(String(b[field]))*(ascending?1:-1);if(comparison)return comparison}return 0});
  if(this.slice)rows=rows.slice(this.slice[0],this.slice[1]+1);
  return Promise.resolve({data:rows,error:null}).then(resolve,reject);
 }
}
let handler;
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/get-facility-bookings/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
new Function('serve','createClient','Deno','resolveFacilityReceiptImage',source)
 (fn=>handler=fn,()=>({from:table=>new Query(table)}),{env:{get:()=>''}},async()=>({receiptImageUrl:null,receiptUploadStatus:'not_provided'}));
async function run(payload={}){
 const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({societyRegistrationNumber:society,...payload})}));
 return {status:response.status,body:await response.json()};
}
for(const facilityName of ['Party Hall','party hall','PARTY HALL','  Party Hall  ']){
 const {status,body}=await run({facilityName});assert.equal(status,200);assert.equal(body.total,3);assert.deepEqual(body.bookings.map(row=>row.bookingId),['r2','b1','b2']);assert.ok(body.bookings.every(row=>row.amenity==='Party Hall'));assert.equal(body.pending,2);assert.equal(body.approved,1);
}
assert.equal((await run({facilityName:'Party'})).body.total,0);
assert.equal((await run({facilityName:'Does Not Exist'})).body.total,0);
for(const facilityName of [undefined,null,'','  ','all',' ALL '])assert.equal((await run({facilityName})).body.total,7);
for(const facilityName of [1,{},[]])assert.equal((await run({facilityName})).status,400);
assert.equal((await run({facilityId:'hall'})).body.total,3);
assert.equal((await run({facilityName:'Party Hall',facilityId:'pool'})).body.total,3);
assert.equal((await run({facilityName:'all',facilityId:'hall'})).body.total,7);
let response=await run({facilityName:'Party Hall',status:'approved'});assert.equal(response.body.total,1);assert.equal(response.body.bookings[0].bookingId,'b1');
response=await run({facilityName:'Party Hall',status:'requested'});assert.equal(response.body.total,2);
response=await run({facilityName:'Party Hall',page:2,limit:1});assert.equal(response.body.total,3);assert.equal(response.body.bookings[0].bookingId,'b1');assert.equal(response.body.pagination.totalPages,3);
response=await run({facilityName:'Party Hall',page:10,limit:1});assert.equal(response.body.bookings.length,0);assert.equal(response.body.total,3);
assert.equal((await run({facilityName:'Party Hall',startDate:'2026-11-10T09:00:00Z',endDate:'2026-11-10T12:00:00Z'})).body.total,3);
assert.equal((await run({facilityName:'Party Hall',startDate:'2026-11-11T00:00:00Z'})).body.total,0);
assert.equal((await run({facilityName:'Party Hall',searchQuery:'Resident One'})).body.total,3);
assert.equal((await run({facilityName:'Party Hall',searchQuery:'Swimming Pool'})).body.total,0);
assert.equal((await run({facilityName:'Pool 100%_ (East), "A"'})).body.total,1);
assert.ok(calls.some(query=>query.table==='SSP_Facility_Booking_Request'));
requests.push(row('r4','Party Hall','hall','pending_verification','p6','2026-11-12T10:00:00Z',society,true));
response=await run({facilityName:'Party Hall',status:'requested'});
assert.equal(response.body.total,3);
assert.equal(response.body.pending,3);
const paymentPendingRequest=response.body.bookings.find(row=>row.bookingId==='r4');
assert.equal(paymentPendingRequest.approvalStatus,'requested');
assert.equal(paymentPendingRequest.bookingStatus,'requested');
console.log('Facility-name filter passed: exact/case/space matching, both record sources, deduplication, society isolation, status, dates, search, pagination, wildcard literals, unknown/empty/all/invalid values and legacy ID compatibility.');
