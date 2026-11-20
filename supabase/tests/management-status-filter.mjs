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
 order(){return this}in(k,vs){this.filters.push(row=>vs.includes(row[k]));return this}range(start,end){this.bounds=[start,end];return this}
 then(resolve,reject){const rows=tables[this.table].filter(row=>this.filters.every(fn=>fn(row)));return Promise.resolve({data:this.bounds?rows.slice(this.bounds[0],this.bounds[1]+1):rows,error:null,count:rows.length}).then(resolve,reject)}
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

for(const [endpoint,table,idKey,nameKey,listKey] of [
 ['crud-tower','SSP_Tower','tower_id','name','towers'],
 ['crud-block','SSP_Block','block_id','block_name','blocks'],
]) {
 tables[table]=[true,false].map((active,i)=>({[idKey]:uuid(20+i),[nameKey]:'Status '+i,society,active}));
 tables[table].push({[idKey]:uuid(30),[nameKey]:'Other society',society:other,active:false});
 const call=load(endpoint);
 for(const active of [undefined,null,'','all',' ALL ',true,'true','active',false,'false','inactive']) {
  const result=await call('VIEW',{}, {filters:active===undefined?{}:{active}});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const expected=parseConfigurationActiveFilter(active);
  const rows=result.body.data[listKey];
  assert.equal(rows.length,expected===null?2:1);
  assert.equal(result.body.data.pagination.total,rows.length);
  assert.ok(rows.every(row=>expected===null||row.active===expected));
 }
 const paged=await call('VIEW',{}, {limit:1,page:2,filters:{active:'all'}});
 assert.equal(paged.body.data[listKey].length,1);assert.equal(paged.body.data.pagination.total,2);
 for(const active of ['bad',1,{},[]])assert.equal((await call('VIEW',{}, {filters:{active}})).status,400);
}
console.log('Tower/block management status tests passed: default/all, active/inactive aliases, pagination, society isolation, invalid input.');
