import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync('supabase/functions/process-csv-import/index.ts','utf8');
const fragment=source.slice(source.indexOf('            let reuseContact = false;'),source.indexOf('            // Resolve Tower & Block UUIDs',source.indexOf('            let reuseContact = false;')));
const run=new Function('supabaseAdmin','row','targetSocietyId','phoneClean','contactPayload','sanitizeString','return (async()=>{'+stripTypeScriptTypes(fragment)+';return contactData;})();');
for(const scenario of ['new','reuse','explicit','lookup-error','update-error']){
 const writes=[];
 const client={from(table){assert.equal(table,'SSP_Contact');return new class{
  filters={}; select(){return this}eq(k,v){this.filters[k]=v;return this}limit(){return this}
  insert(payload){writes.push({op:'insert',payload});return this}
  update(payload){writes.push({op:'update',payload,filters:this.filters});return this}
  async single(){return{data:{contact_id:scenario==='explicit'?'explicit-id':'new-id'},error:scenario==='update-error'?{message:'not found'}:null}}
  then(resolve,reject){assert.deepEqual(this.filters,{society:'society',phone:'9000000000'});return Promise.resolve({data:scenario==='reuse'?[{contact_id:'reused-id'}]:[],error:scenario==='lookup-error'?{message:'lookup failed'}:null}).then(resolve,reject)}
 }}};
 const row=['explicit','update-error'].includes(scenario)?{contact_id:'explicit-id'}:{};
 const result=run(client,row,'society','9000000000',{name:'Do not overwrite reused contact'},v=>v.trim());
 if(scenario.endsWith('error')){await assert.rejects(result);continue}
 const data=await result;
 if(scenario==='reuse'){assert.equal(data.contact_id,'reused-id');assert.equal(writes.length,0)}
 else{assert.equal(writes.length,1);assert.equal(writes[0].op,scenario==='explicit'?'update':'insert');if(scenario==='explicit')assert.deepEqual(writes[0].filters,{contact_id:'explicit-id',society:'society'})}
}
console.log('CSV contact tests passed: new insert, existing reuse without overwrite, explicit update, lookup/write failures.');
