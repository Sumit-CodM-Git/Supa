// Run: node supabase/tests/society-location-references.mjs
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
import{parseConfigurationActiveFilter,resolveSocietyLocation,SocietyConfigurationInputError}from'../functions/_shared/society-configuration.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const society=uuid(1),other=uuid(2),admin=uuid(3),beeta=uuid(4),delta=uuid(5),otherBlock=uuid(6);
const tables={SSP_Society:[{society_id:society,registration_number:'TEST'}],SSP_Society_User:[{user_id:admin,society,role:['admin']}],SSP_Block:[{block_id:beeta,society,active:true,block_name:'Beeta'},{block_id:delta,society,active:true,block_name:'Delta'},{block_id:otherBlock,society:other,active:true,block_name:'Other'}],SSP_Tower:[]};
class Query{
 constructor(table){this.table=table;this.filters=[]}
 select(){return this}eq(k,v){this.filters.push(row=>row[k]===v);return this}contains(k,vs){this.filters.push(row=>vs.every(v=>row[k].includes(v)));return this}
 ilike(k,v){this.filters.push(row=>String(row[k]).toLowerCase()===v.toLowerCase());return this}
 insert(v){this.value=v;this.op='insert';return this}update(v){this.value=v;this.op='update';return this}
 async maybeSingle(){
  if(this.op==='insert'){const row={...this.value,[this.table==='SSP_Tower'?'tower_id':'block_id']:crypto.randomUUID()};tables[this.table].push(row);return{data:{...row},error:null}}
  const row=tables[this.table].find(row=>this.filters.every(fn=>fn(row)));
  if(row&&this.op==='update')Object.assign(row,this.value);
  return{data:row?{...row}:null,error:null};
 }
 async single(){return this.maybeSingle()}
}
const client={from:table=>new Query(table)};
function load(name){let handler;const src=stripTypeScriptTypes(readFileSync(new URL('../functions/'+name+'/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
 new Function('Deno','serve','createClient','resolveSocietyLocation','SocietyConfigurationInputError','parseConfigurationActiveFilter',src)({env:{get:()=>''}},fn=>handler=fn,()=>client,resolveSocietyLocation,SocietyConfigurationInputError,parseConfigurationActiveFilter);
 return async(action,payload={},ids={})=>{const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({societyRegistrationNumber:'TEST',adminId:admin,action,payload,...ids})}));return{status:response.status,body:await response.json()}};
}
const tower=load('crud-tower'),block=load('crud-block');
for(const input of [{block:beeta},{blockId:beeta},{blockName:'  bEeTa  '},{block:beeta,blockName:'Beeta'}]){
 const result=await tower('CREATE',{name:'New Tower',active:true,floors:2,flats_per_floor:3,...input});assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.data.tower.block,beeta);assert.equal(result.body.data.tower.blockId,beeta);
}
const towerId=tables.SSP_Tower[0].tower_id;
let result=await tower('UPDATE',{blockId:delta},{towerId});assert.equal(result.status,200);assert.equal(result.body.data.tower.blockId,delta);
result=await tower('UPDATE',{blockName:'Beeta'},{towerId});assert.equal(result.status,200);assert.equal(result.body.data.tower.blockId,beeta);
for(const input of [{blockId:otherBlock},{blockName:'Missing'},{block:beeta,blockId:delta},{blockId:123}]){
 const count=tables.SSP_Tower.length;result=await tower('CREATE',{name:'Invalid',active:true,...input});assert.equal(result.status,400,JSON.stringify(result.body));assert.equal(tables.SSP_Tower.length,count);
}
result=await tower('UPDATE',{blockId:null},{towerId});assert.equal(result.status,200);assert.equal(result.body.data.tower.blockId,null);
for(const input of [{block_name:'Snake Block',tower:towerId},{blockName:'Camel Block',towerId},{blockName:'Named Tower Block',towerName:'New Tower'}]){
 result=await block('CREATE',input);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.data.block.towerId,towerId);
}
const blockId=result.body.data.block.blockId;
result=await block('UPDATE',{blockName:'Renamed Block',towerId:null},{blockId});assert.equal(result.status,200);assert.equal(result.body.data.block.blockName,'Renamed Block');assert.equal(result.body.data.block.towerId,null);
result=await block('CREATE',{block_name:'A',blockName:'B'});assert.equal(result.status,400);
console.log('Location references passed: block/blockId/blockName, tower/towerId/towerName, camelCase block names, create/update/clear, conflicts, invalid types and cross-society rejection.');
