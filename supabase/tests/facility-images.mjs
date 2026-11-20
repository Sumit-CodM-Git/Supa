// Run: node supabase/tests/facility-images.mjs
import assert from 'node:assert/strict';
import {facilityImageInputs,createFacilityImageUploads} from '../functions/_shared/facility-images.ts';
const image={fileName:'Court.jpg',fileType:'image/jpeg'};
assert.deepEqual(facilityImageInputs({fileName:null,fileType:null}),[]);
assert.equal(facilityImageInputs(image).length,1);
assert.equal(facilityImageInputs({images:Array(5).fill(image)}).length,5);
assert.throws(()=>facilityImageInputs({images:Array(6).fill(image)}),/maximum of 5/);
assert.throws(()=>facilityImageInputs({...image,images:[image]}),/not both/);
assert.throws(()=>facilityImageInputs({images:[{fileName:'missing-type.jpg'}]}),/fileName and fileType/);
function mock({existing=0,signError=false,dbError=null}={}){
 let inserted,deleted=false,signs=0;
 const client={from:()=>({select(){return this},eq(){return this},then(resolve,reject){return Promise.resolve({count:existing,error:null}).then(resolve,reject)},insert(rows){inserted=rows;return {select:async()=>({data:rows.map((row,index)=>({document_id:String(index),file_name:row.file_name})),error:dbError})}},delete(){deleted=true;throw Error('Existing images must not be deleted')}}),storage:{from:()=>({createSignedUploadUrl:async key=>{signs++;return signError?{error:{message:'storage unavailable'}}:{data:{signedUrl:'https://upload.example/'+key}}},getPublicUrl:key=>({data:{publicUrl:'https://image.example/'+key}})})}};
 return {client,inserted:()=>inserted,deleted:()=>deleted,signs:()=>signs};
}
for(const [existing,added] of [[0,5],[4,1],[2,3]]){
 const m=mock({existing});const result=await createFacilityImageUploads(m.client,'facility','society','REG',Array(added).fill(image));
 assert.equal(result.length,added);assert.equal(m.deleted(),false);assert.equal(m.inserted().length,added);
 assert.equal(new Set(m.inserted().map(row=>row.file_name)).size,added);
 assert.ok(m.inserted().every(row=>row.facility==='facility'&&row.society==='society'));
}
const full=mock({existing:5});await assert.rejects(createFacilityImageUploads(full.client,'facility','society','REG',[image]),/maximum of 5/);assert.equal(full.signs(),0);assert.equal(full.inserted(),undefined);
const batch=mock({existing:4});await assert.rejects(createFacilityImageUploads(batch.client,'facility','society','REG',[image,image]),/maximum of 5/);assert.equal(batch.inserted(),undefined);
const failed=mock({signError:true});await assert.rejects(createFacilityImageUploads(failed.client,'facility','society','REG',[image]),/storage unavailable/);assert.equal(failed.inserted(),undefined);
const race=mock({dbError:{message:'A facility can have a maximum of 5 images.'}});await assert.rejects(createFacilityImageUploads(race.client,'facility','society','REG',[image]),/maximum of 5/);
console.log('Single/batch uploads, five-image cap, no replacement, unique storage keys, scope, and failure-path tests passed.');
