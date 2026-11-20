import {PGlite} from '/private/tmp/ssp-availability-sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA storage;CREATE TABLE storage.objects(bucket_id text,name text,PRIMARY KEY(bucket_id,name));
CREATE TABLE "SSP_Society"(society_id uuid PRIMARY KEY);
CREATE TABLE "SSP_Society_User"(user_id uuid PRIMARY KEY,society uuid);
CREATE TABLE "SSP_Non_Society_User"(non_society_user_id uuid PRIMARY KEY,society uuid);
CREATE TABLE "SSP_Servant"(servant_id uuid PRIMARY KEY,society uuid);
CREATE TABLE "SSP_Society_Staff"(staff_id uuid PRIMARY KEY,society_id uuid);`);
let original=readFileSync('supabase/migrations/20261116120000_profile_images.sql','utf8');
await db.exec(original.slice(original.indexOf('CREATE TABLE public."SSP_Profile_Image"')).replace(/COMMIT;\s*$/,''));
await db.exec(readFileSync('supabase/migrations/20261117210000_replace_profile_image.sql','utf8'));
const society=crypto.randomUUID(),owner=crypto.randomUUID(),other=crypto.randomUUID();
await db.query('INSERT INTO "SSP_Society" VALUES ($1)',[society]);
await db.query('INSERT INTO "SSP_Society_User" VALUES ($1,$3),($2,$3)',[owner,other,society]);
async function image(ownerId=owner){const key=`${society}/society_user/${ownerId}/${crypto.randomUUID()}.png`;await db.query('INSERT INTO storage.objects VALUES (\'profile-images\',$1)',[key]);return{owner_type:'society_user',owner_id:ownerId,society,object_key:key,file_name:'avatar.png',file_type:'image/png',file_size:68,uploaded_by:owner}}
async function swap(i){return(await db.query('SELECT public.replace_profile_image($1) AS result',[i])).rows[0].result}
const first=await image();assert.deepEqual((await swap(first)).cleanup_keys,[]);
const second=await image();assert.deepEqual((await swap(second)).cleanup_keys,[first.object_key]);
assert.equal((await db.query('SELECT object_key FROM "SSP_Profile_Image" WHERE owner_id=$1',[owner])).rows[0].object_key,second.object_key);
await assert.rejects(()=>swap(first),err=>err.code==='22023');
await assert.rejects(()=>swap({...second,object_key:second.object_key.replace('.png','-missing.png')}),err=>err.code==='22023');
const foreign=await image(other);await swap(foreign);
await assert.rejects(()=>swap({...foreign,owner_id:owner}));
const more=await Promise.all([image(),image(),image()]);await Promise.all(more.map(swap));
const active=(await db.query('SELECT * FROM "SSP_Profile_Image" WHERE owner_id=$1',[owner])).rows[0];
const cleanup=(await db.query('SELECT object_key FROM "SSP_Profile_Image_Cleanup" WHERE owner_id=$1',[owner])).rows.map(r=>r.object_key);
assert.equal(cleanup.length,4);assert.ok(!cleanup.includes(active.object_key));assert.ok(!cleanup.includes(foreign.object_key));
await db.query('DELETE FROM storage.objects WHERE name=ANY($1::text[])',[cleanup]);
await db.query('DELETE FROM "SSP_Profile_Image_Cleanup" WHERE owner_id=$1',[owner]);
assert.deepEqual((await swap({...second,object_key:active.object_key})).cleanup_keys,[]);
// A confirmation that validated an old file before its deletion must not save a missing reference.
await assert.rejects(()=>swap(first),err=>err.code==='22023');
assert.equal((await db.query('SELECT count(*)::int AS n FROM "SSP_Profile_Image"')).rows[0].n,2);
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.replace_profile_image(jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);
console.log('Profile replacement database passed: atomic one-row replacement, retired key queue, concurrent swaps, same-key retries, owner isolation, missing/retired file rejection, cleanup and service-only permissions.');
await db.close();
