import assert from 'node:assert/strict';
import {handleProfileImages,profileImageUrls,profileImageUrl,authorizedProfileImageUrls,PROFILE_BUCKET,PROFILE_IMAGE_MAX_BYTES} from '../functions/_shared/profile-images.ts';
const id=()=>crypto.randomUUID();
const contactId=id();
const society=id(),otherSociety=id(),self=id(),admin=id(),guard=id(),other=id(),outside=id(),vendor=id(),visitor=id(),servant=id(),staff=id();
const tables={
 SSP_Society_User:[
  {user_id:self,contact:contactId,society,role:['resident'],status:true},
  {user_id:admin,society,role:['admin','resident'],status:true},
  {user_id:guard,society,role:['security'],status:true},
  {user_id:other,society,role:['resident'],status:true},
  {user_id:outside,society:otherSociety,role:['resident'],status:true},
 ],
 SSP_Non_Society_User:[{non_society_user_id:vendor,society,role:'vendor'},{non_society_user_id:visitor,society,role:'visitor'}],
 SSP_Servant:[{servant_id:servant,society}],SSP_Society_Staff:[{staff_id:staff,society_id:society,staff_role:'security'}],
 SSP_Profile_Image:[],
};
const cleanupRows=[];
let dbFailure=false,cleanupDbFailure=false,storageFailure=false,removeFailure=false,signedReads=0,writes=0;
const files=new Map();
class Query {
 constructor(table){assert.ok(table in tables||table==='SSP_Profile_Image_Cleanup','No legacy document table may be touched');this.table=table;this.filters=[];}
 select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,values){this.filters.push(r=>values.includes(r[k]));return this;}
 delete(){this.deleting=true;return this;}
 result(){
  if(this.deleting){
   if(cleanupDbFailure)return {data:null,error:{message:'unavailable'}};
   const deleted=cleanupRows.filter(r=>this.filters.every(f=>f(r)));
   for(const row of deleted)cleanupRows.splice(cleanupRows.indexOf(row),1);
   return {data:deleted,error:null};
  }
  if(dbFailure&&this.table==='SSP_Profile_Image')return {data:null,error:{message:'unavailable'}};
  const rows=this.table==='SSP_Profile_Image_Cleanup'?cleanupRows:tables[this.table];
  return {data:rows.filter(r=>this.filters.every(f=>f(r))),error:null};
 }
 async maybeSingle(){const r=this.result();return {...r,data:r.data?.[0]??null};}
 async single(){return this.result();}
 then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);}
}
const client={from:table=>new Query(table),async rpc(name,{p_image:image}){
 assert.equal(name,'replace_profile_image');
 if(dbFailure)return {data:null,error:{message:'unavailable'}};
 if(!files.has(image.object_key)||cleanupRows.some(row=>row.object_key===image.object_key))return {data:null,error:{code:'22023',message:'This image was already replaced. Upload a new image.'}};
 writes++;
 const list=tables.SSP_Profile_Image;
 const existing=list.find(row=>row.owner_type===image.owner_type&&row.owner_id===image.owner_id);
 if(existing&&existing.object_key!==image.object_key&&!cleanupRows.some(row=>row.object_key===existing.object_key)){
  cleanupRows.push({object_key:existing.object_key,owner_type:existing.owner_type,owner_id:existing.owner_id,society:existing.society});
 }
 if(existing)Object.assign(existing,image,{updated_at:'2026-11-16T10:00:00Z'});else list.push({...image,updated_at:'2026-11-16T10:00:00Z'});
 return {data:{updated_at:'2026-11-16T10:00:00Z',cleanup_keys:cleanupRows.filter(row=>row.owner_type===image.owner_type&&row.owner_id===image.owner_id&&row.object_key!==image.object_key).map(row=>row.object_key)},error:null};
},storage:{from(bucket){
 assert.equal(bucket,PROFILE_BUCKET,'Profile storage must be isolated from existing uploads');
 return {
  async createSignedUploadUrl(key){return {data:{signedUrl:'https://storage.test/upload/'+key},error:null};},
  async list(folder,{search}){return {data:[...files].filter(([key])=>key===folder+'/'+search).map(([key,f])=>({id:'object',name:key.split('/').at(-1),metadata:{size:f.bytes.length,mimetype:f.mime}})),error:storageFailure?{message:'unavailable'}:null};},
  async download(key){return {data:new Blob([files.get(key).bytes]),error:null};},
  async createSignedUrl(key,ttl){assert.equal(ttl,900);return {data:{signedUrl:'https://storage.test/display/'+key},error:null};},
  async createSignedUrls(keys,ttl){signedReads++;assert.equal(ttl,900);return {data:keys.map(path=>({path,...(files.has(path)?{signedUrl:'https://storage.test/display/'+path}:{error:'Object not found'})})),error:storageFailure?{message:'unavailable'}:null};},
  async remove(keys){if(removeFailure)return {data:null,error:{message:'unavailable'}};for(const key of keys)files.delete(key);return {data:keys.map(name=>({name})),error:null};},
 };
}}};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=','base64');
async function call(actor,body){const res=await handleProfileImages(new Request('https://test',{method:'POST',body:JSON.stringify(body)}),actor,client);return {status:res.status,body:await res.json()};}
const prepare=(ownerType,ownerId,extra={})=>({action:'PREPARE_UPLOAD',ownerType,ownerId,fileName:'avatar.png',fileType:'image/png',fileSize:png.length,...extra});
let result=await call(self,prepare('society_user',self));assert.equal(result.status,200);assert.equal(result.body.data.uploadStatus,'pending_upload');
const key=result.body.data.upload.objectKey;assert.ok(key.startsWith(`${society}/society_user/${self}/`));assert.ok(key.endsWith('/'+contactId+'_profileImage.png'));assert.equal(result.body.data.upload.method,'PUT');assert.equal(writes,0);
const confirm={action:'CONFIRM_UPLOAD',ownerType:'society_user',ownerId:self,objectKey:key,fileName:'avatar.png'};
assert.equal((await call(self,confirm)).status,409);assert.equal(writes,0,'Preparing or missing uploads must not save a reference');
files.set(key,{bytes:png,mime:'image/png'});
result=await call(self,confirm);assert.equal(result.status,200);assert.equal(result.body.data.uploadStatus,'uploaded');assert.ok(result.body.data.profileImageUrl.includes('/display/'));assert.equal(result.body.data.image.fileSize,png.length);assert.equal(result.body.data.image.fileName,contactId+'_profileImage.png');assert.equal(tables.SSP_Profile_Image[0].file_name,contactId+'_profileImage.png');
assert.equal(tables.SSP_Profile_Image.length,1);
assert.equal((await call(self,confirm)).status,200);assert.equal(tables.SSP_Profile_Image.length,1,'Confirmation retries must not duplicate profiles');
const foreignKey=`${otherSociety}/society_user/${outside}/${id()}.png`;
files.set(foreignKey,{bytes:png,mime:'image/png'});
tables.SSP_Profile_Image.push({owner_type:'society_user',owner_id:outside,society:otherSociety,object_key:foreignKey});
result=await call(self,{action:'FETCH',owners:[{ownerType:'society_user',ownerId:self},{ownerType:'society_user',ownerId:outside}]});
assert.equal(result.status,200);assert.ok(result.body.data.images[0].profileImageUrl);assert.equal(result.body.data.images[1].profileImageUrl,null);
assert.equal((await authorizedProfileImageUrls(client,self,otherSociety,[{ownerType:'society_user',ownerId:outside}])).size,0,'Legacy readers must not sign cross-society images');
const selfRecord=tables.SSP_Society_User.find(r=>r.user_id===self);
selfRecord.deleted_at='2026-11-16T10:00:00Z';
assert.equal((await call(admin,{action:'FETCH',ownerType:'society_user',ownerId:self})).body.data.images[0].profileImageUrl,null);
delete selfRecord.deleted_at;
selfRecord.society=otherSociety;
assert.equal(await profileImageUrl(client,society,'society_user',self),null,'Moved users must not expose their image to their former society');
selfRecord.society=society;

assert.equal((await call(self,prepare('society_user',other))).status,403);
assert.equal((await call(admin,prepare('society_user',outside))).status,403);
for(const [type,owner] of [['society_user',other],['non_society_user',vendor],['non_society_user',visitor],['servant',servant],['society_staff',staff]])assert.equal((await call(admin,prepare(type,owner))).status,200);
assert.equal((await call(guard,prepare('non_society_user',visitor))).status,200);
assert.equal((await call(guard,prepare('servant',servant))).status,200);
assert.equal((await call(guard,prepare('non_society_user',vendor))).status,403);
assert.equal((await call(vendor,prepare('non_society_user',vendor))).status,200);
assert.equal((await call(servant,prepare('servant',servant))).status,200);
assert.equal((await call(staff,prepare('society_staff',staff))).status,200);
assert.equal((await call(id(),prepare('society_user',self))).status,403);
for(const extra of [{fileType:'image/svg+xml'},{fileSize:0},{fileSize:PROFILE_IMAGE_MAX_BYTES+1},{fileSize:'123'},{fileName:'../avatar.png'}])assert.equal((await call(self,prepare('society_user',self,extra))).status,400);
assert.equal((await call(self,{...confirm,ownerId:other})).status,403);
assert.equal((await call(self,{...confirm,objectKey:key.replace(self,other)})).status,400);
assert.equal((await call(self,{...confirm,objectKey:key+'/../photo.png'})).status,400);
const previous={...tables.SSP_Profile_Image[0]},beforeWrites=writes;
files.set(key,{bytes:Buffer.from('not an image'),mime:'image/png'});assert.equal((await call(self,confirm)).status,400);assert.equal(writes,beforeWrites);assert.deepEqual(tables.SSP_Profile_Image[0],previous);
files.set(key,{bytes:png,mime:'image/jpeg'});assert.equal((await call(self,confirm)).status,400);
files.set(key,{bytes:png,mime:'image/png'});storageFailure=true;assert.equal((await call(self,confirm)).status,503);storageFailure=false;

// New profile photo lookup must never use legacy visitor/servant attachments.
assert.ok(await profileImageUrl(client,society,'society_user',self));
files.delete(key);assert.equal(await profileImageUrl(client,society,'society_user',self),null);
dbFailure=true;assert.equal((await profileImageUrls(client,society,[{ownerType:'society_user',ownerId:self}])).size,0);
assert.equal((await call(self,{action:'FETCH',ownerType:'society_user',ownerId:self})).status,503);dbFailure=false;
const count=signedReads;assert.equal((await profileImageUrls(client,society,[])).size,0);assert.equal(signedReads,count);
assert.equal((await call(self,{action:'FETCH',owners:[]})).status,400);
assert.equal((await call(self,{action:'FETCH',owners:Array(51).fill({ownerType:'society_user',ownerId:self})})).status,400);
files.set(key,{bytes:png,mime:'image/png'});
const replacement=await call(self,prepare('society_user',self));assert.equal(replacement.status,200);
const replacementKey=replacement.body.data.upload.objectKey;
files.set(replacementKey,{bytes:png,mime:'image/png'});
dbFailure=true;assert.equal((await call(self,{...confirm,objectKey:replacementKey})).status,503);dbFailure=false;
assert.equal(tables.SSP_Profile_Image.find(row=>row.owner_id===self).object_key,key);assert.ok(files.has(key));
result=await call(self,{...confirm,objectKey:replacementKey});
assert.equal(result.status,200);assert.equal(tables.SSP_Profile_Image.filter(row=>row.owner_id===self).length,1);
assert.equal(tables.SSP_Profile_Image.find(row=>row.owner_id===self).object_key,replacementKey,'Only the new image remains referenced for the user');
assert.equal(files.has(key),false,'The previous storage object is deleted after replacement');
assert.equal(files.has(replacementKey),true);assert.notEqual(key,replacementKey);assert.equal(key.split('/').at(-1),replacementKey.split('/').at(-1));assert.equal(cleanupRows.length,0);

const retryReplacement=await call(self,prepare('society_user',self));assert.equal(retryReplacement.status,200);
const retryKey=retryReplacement.body.data.upload.objectKey;
files.set(retryKey,{bytes:png,mime:'image/png'});removeFailure=true;
assert.equal((await call(self,{...confirm,objectKey:retryKey})).status,503);
assert.equal(tables.SSP_Profile_Image.find(row=>row.owner_id===self).object_key,retryKey,'New reference is saved even if storage cleanup needs a retry');
assert.equal(files.has(replacementKey),true);assert.equal(cleanupRows.some(row=>row.object_key===replacementKey),true);
assert.equal((await call(self,{...confirm,objectKey:replacementKey})).status,409,'Retired files cannot be reactivated while cleanup is pending');
removeFailure=false;
assert.equal((await call(self,{...confirm,objectKey:retryKey})).status,200);
assert.equal(files.has(replacementKey),false);assert.equal(cleanupRows.length,0);

const databaseRetry=await call(self,prepare('society_user',self));assert.equal(databaseRetry.status,200);
const databaseRetryKey=databaseRetry.body.data.upload.objectKey;
files.set(databaseRetryKey,{bytes:png,mime:'image/png'});cleanupDbFailure=true;
assert.equal((await call(self,{...confirm,objectKey:databaseRetryKey})).status,503);
assert.equal(tables.SSP_Profile_Image.find(row=>row.owner_id===self).object_key,databaseRetryKey);
assert.equal(files.has(retryKey),false);assert.equal(cleanupRows.some(row=>row.object_key===retryKey),true);
cleanupDbFailure=false;
assert.equal((await call(self,{...confirm,objectKey:databaseRetryKey})).status,200);
assert.equal(cleanupRows.length,0);
console.log('Profile images passed: upload/confirm/fetch, replacement and old-object cleanup, cleanup retries, all identities, tenant and write permissions, missing/corrupt files, MIME/size/path checks, isolated storage, and fail-soft optional reads.');

const fallback=await call(vendor,prepare('non_society_user',vendor));
assert.ok(fallback.body.data.upload.objectKey.endsWith('/'+vendor+'_profileImage.png'));
const forged=databaseRetryKey.replace(contactId,other);
assert.equal((await call(self,{...confirm,objectKey:forged})).status,400);
const legacyKey=`${society}/society_user/${self}/${id()}.png`;
files.set(legacyKey,{bytes:png,mime:'image/png'});
const legacyConfirm=await call(self,{...confirm,objectKey:legacyKey});
assert.equal(legacyConfirm.status,200);assert.equal(legacyConfirm.body.data.image.fileName,contactId+'_profileImage.png');
console.log('Contact-based filenames passed: actual contact UUID, unique version folders, stored filename, owner fallback, forged name rejection and legacy in-flight uploads.');
