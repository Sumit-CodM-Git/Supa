// Run: node supabase/tests/society-configuration.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {loadSocietyConfiguration,formatSocietyConfiguration,societyConfigurationVersion} from '../functions/_shared/society-configuration.ts';
import {parkingCounts} from '../functions/_shared/parking-counts.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=uuid(1),B=uuid(2),admin=uuid(3),resident=uuid(4),security=uuid(5),other=uuid(6);
const tables={
 SSP_Society:[{society_id:A,registration_number:'A',active:true,society_name:'Alpha'},{society_id:B,registration_number:'B',active:true,society_name:'Beta'}],
 SSP_Society_User:[{user_id:admin,society:A,status:true,role:['admin']},{user_id:resident,society:A,status:true,role:['resident']},{user_id:security,society:A,status:true,role:['security']},{user_id:other,society:B,status:true,role:['resident']}],
 SSP_Tower:[{tower_id:uuid(10),society:A,active:true,name:'Tower Current',block:uuid(11)},{tower_id:uuid(12),society:A,active:false,name:'Inactive Tower'},{tower_id:uuid(13),society:B,active:true,name:'Other Tower'}],
 SSP_Block:[{block_id:uuid(11),society:A,active:true,block_name:'Block Current',tower:uuid(10)},{block_id:uuid(14),society:B,active:true,block_name:'Other Block'}],
 SSP_Flat_Type:[{flat_type_id:uuid(15),society:A,active:true,flat_type:'2 BHK',maintenance_charges:500},{flat_type_id:uuid(16),society:B,active:true,flat_type:'Other Type'}],
 SSP_Picklist_Config:[{table_name:'SSP_Flat_Type',field_name:'flat_type',value:'GLOBAL TYPE',label:'GLOBAL TYPE',language:'en',is_active:true},{table_name:'SSP_Society',field_name:'block',value:'stale',label:'Stale Block',language:'en',is_active:true}],
 SSP_Picklist_Field_Meta:[],SSP_Society_Staff:[],SSP_Facility:[],
};
let failTable=null;
class Query {
 constructor(table){this.table=table;this.filters=[];this.orders=[]}
 select(){return this}eq(k,v){this.filters.push(row=>row[k]===v);return this}
 in(k,values){this.filters.push(row=>values.includes(row[k]));return this}
 contains(k,values){this.filters.push(row=>values.every(value=>(row[k]??[]).includes(value)));return this}
 order(k,{ascending}){this.orders.push({k,ascending});return this}
 range(start,end){this.slice=[start,end];return this}limit(n){this.slice=[0,n-1];return this}
 result(){
  if(this.table===failTable)return {data:null,error:{message:'Simulated configuration failure'}};
  let data=(tables[this.table]??[]).filter(row=>this.filters.every(fn=>fn(row)));
  data.sort((a,b)=>{for(const{k,ascending}of this.orders){const diff=String(a[k]).localeCompare(String(b[k]))*(ascending?1:-1);if(diff)return diff}return 0});
  if(this.slice)data=data.slice(this.slice[0],this.slice[1]+1);
  return {data:data.map(row=>({...row})),error:null};
 }
 async maybeSingle(){const result=this.result();return {...result,data:result.data?.[0]??null}}
 then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject)}
}
const client={from:table=>new Query(table)};
function load(name){let handler;const source=stripTypeScriptTypes(readFileSync(new URL('../functions/'+name+'/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
 new Function('serve','createClient','Deno','loadSocietyConfiguration','formatSocietyConfiguration','societyConfigurationVersion','parkingCounts',source)
 (fn=>handler=fn,()=>client,{env:{get:()=>''}},loadSocietyConfiguration,formatSocietyConfiguration,societyConfigurationVersion,parkingCounts);
 return async(payload,headers={})=>{const response=await handler(new Request('https://test',{method:'POST',headers,body:JSON.stringify(payload)}));return {status:response.status,headers:response.headers,body:response.status===304?null:await response.json()}};
}
const picklists=load('get-picklists'),settings=load('get-society-settings');
const request=(requesterId=admin,extras={})=>({societyRegistrationNumber:'A',requesterId,...extras});
const first=await picklists(request());assert.equal(first.status,200);
tables.SSP_Flat_Type.push({flat_type_id:uuid(18),society:A,active:false,flat_type:'Inactive Type'});
const retired=await picklists(request());
assert.deepEqual(retired.body.societyConfiguration.flatTypes,first.body.societyConfiguration.flatTypes);
assert.deepEqual(retired.body.flatTypeCatalog,first.body.flatTypeCatalog);
tables.SSP_Flat_Type.pop();
tables.SSP_Block.push({block_id:uuid(17),society:A,active:false,block_name:'Inactive Block'});
const withInactive=await picklists(request());
assert.deepEqual(withInactive.body.societyConfiguration.blocks.map(row=>row.blockId),[uuid(11),uuid(17)]);
assert.deepEqual(withInactive.body.picklistsByTable.SSP_Society.block.options.map(row=>row.value),[uuid(11),uuid(17)]);
assert.notEqual(withInactive.body.configurationVersion,first.body.configurationVersion);
const settingsWithInactive=await settings({societyRegistrationNumber:'A',adminId:admin});
assert.equal(settingsWithInactive.status,200);
assert.deepEqual(settingsWithInactive.body.data.blocks.map(row=>({id:row.blockId,active:row.active})),[
 {id:uuid(11),active:true},{id:uuid(17),active:false},
]);
assert.deepEqual(settingsWithInactive.body.data.societyConfiguration.blocks,withInactive.body.societyConfiguration.blocks);
tables.SSP_Block.pop();
assert.match(first.headers.get('cache-control'),/private.*no-cache/);assert.ok(!first.headers.get('cache-control').includes('public'));
assert.equal(first.body.societyConfiguration.towers.length,1);
assert.deepEqual(first.body.picklistsByTable.SSP_Flat_Type.flat_type.options,[{value:'2 BHK',label:'2 BHK'}]);
assert.equal(first.body.flatTypeCatalog[0].value,'GLOBAL TYPE');
for(const role of [resident,security]){
 const result=await picklists(request(role));assert.equal(result.status,200);
 assert.deepEqual(result.body.societyConfiguration,first.body.societyConfiguration);
 assert.equal(result.body.configurationVersion,first.body.configurationVersion);
}
for(const scope of [['SSP_Contact'],['SSP_Society_User'],['SSP_Tower'],['SSP_Block'],['SSP_Flat_Type']]){
 const result=await picklists(request(resident,{scope}));assert.equal(result.status,200);
 assert.deepEqual(result.body.societyConfiguration,first.body.societyConfiguration);
 assert.equal(result.body.picklistsByTable.SSP_Society.tower.options[0].label,'Tower Current');
}
let cached=await picklists(request(),{'if-none-match':first.headers.get('etag')});assert.equal(cached.status,304);
assert.equal((await picklists(request(),{'if-none-match':'W/'+first.headers.get('etag')})).status,304);
assert.equal((await picklists(request(),{'if-none-match':first.body.version})).status,304);
const adminSettings=await settings({societyRegistrationNumber:'A',adminId:admin});assert.equal(adminSettings.status,200);
assert.deepEqual(adminSettings.body.data.societyConfiguration,first.body.societyConfiguration);
assert.equal(adminSettings.body.data.configurationVersion,first.body.configurationVersion);
assert.equal((await settings({societyRegistrationNumber:'A',adminId:security})).status,403);
// Rename while a previous client ETag exists; all roles must get new labels.
tables.SSP_Tower[0].name='Renamed Tower';
tables.SSP_Block[0].block_name='Renamed Block';
tables.SSP_Flat_Type[0].flat_type='3 BHK';
const updated=await picklists(request(resident),{'if-none-match':first.headers.get('etag')});assert.equal(updated.status,200);
assert.notEqual(updated.body.configurationVersion,first.body.configurationVersion);
assert.equal(updated.body.picklistsByTable.SSP_Society.tower.options[0].label,'Renamed Tower');
assert.equal(updated.body.picklistsByTable.SSP_Flat_Type.flat_type.options[0].label,'3 BHK');
// Deactivation/deletion must clear stale options rather than restoring global defaults.
tables.SSP_Tower[0].active=false;tables.SSP_Block[0].active=false;tables.SSP_Flat_Type=tables.SSP_Flat_Type.filter(row=>row.society!==A);
const empty=await picklists(request(),{'if-none-match':updated.headers.get('etag')});assert.equal(empty.status,200);
for(const field of ['tower','flat_type'])assert.deepEqual(empty.body.picklistsByTable.SSP_Society[field].options,[]);
assert.deepEqual(empty.body.picklistsByTable.SSP_Society.block.options,[{value:uuid(11),label:'Renamed Block'}]);
assert.deepEqual(empty.body.societyConfiguration.blocks.map(row=>row.blockId),[uuid(11)]);
assert.deepEqual(empty.body.picklistsByTable.SSP_Flat_Type.flat_type.options,[]);
assert.equal((await picklists({...request(other),societyRegistrationNumber:'B'},{'if-none-match':empty.headers.get('etag')})).status,200);
assert.equal((await picklists(request(other))).status,403);
assert.equal((await picklists(request(resident,{scope:[]}))).status,400);
tables.SSP_Society_User.find(row=>row.user_id===resident).status=false;assert.equal((await picklists(request(resident))).status,403);
// More than one database response page must be loaded, including unoccupied towers.
for(let i=0;i<501;i++)tables.SSP_Tower.push({tower_id:uuid(1000+i),society:A,active:true,name:'Paged Tower '+String(i).padStart(3,'0')});
assert.equal((await picklists(request(security))).body.societyConfiguration.towers.length,501);
failTable='SSP_Flat_Type';assert.equal((await picklists(request(security))).status,500);
console.log('Society configuration passed: all roles/scopes, authoritative configured values, admin consistency, rename/create/deactivate/delete, empty options, ETags, cache policy, cross-society protection, inactive users, pagination and database failures.');
