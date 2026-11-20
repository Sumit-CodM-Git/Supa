import {residentFlatTypeFields} from '../functions/_shared/resident-flat-type.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const admin='admin',member='member';let actor=admin,failUpdate=false;
let tables;
function reset(){tables={SSP_Society_User:[{user_id:admin,society:'society',role:['admin'],deleted_at:null},{user_id:member,society:'society',role:['resident'],contact:'contact',deleted_at:null,status:true,one_time_password_otp:'123456'}],SSP_Non_Society_User:[{non_society_user_id:'visitor',role:'visitor',hosted_by:member,approver:member}],SSP_Contact:[{contact_id:'contact',name:'Test'}],SSP_Payment:[{society_user:member}],SSP_Complaint:[{society_user:member}]};}
class Query{
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
 update(patch){this.patch=patch;return this;}delete(){throw new Error('Unexpected hard delete');}
 async maybeSingle(){if(this.patch&&failUpdate)return {error:{message:'DB failure'}};const row=(tables[this.table]??[]).find(r=>this.filters.every(f=>f(r)));if(row&&this.patch)Object.assign(row,this.patch);return {data:row?{...row}:null,error:null};}
}
let handler;
const source=stripTypeScriptTypes(readFileSync('supabase/functions/delete-members/index.ts','utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const success=data=>new Response(JSON.stringify({success:true,data}));
const error=(message,status)=>new Response(JSON.stringify({message}),{status});
new Function('Deno','requireAuth','corsHeaders','errorResponse','successResponse','parseRequestBody','createClient','console','residentFlatTypeFields',source)({env:{get:()=>''},serve:fn=>handler=fn},fn=>req=>fn(req,{user:{id:actor}}),{},error,success,req=>req.json(),()=>({from:t=>new Query(t)}),{log(){},error(){},warn(){}},residentFlatTypeFields);
async function call(body={memberId:member}){const res=await handler(new Request('https://test',{method:'POST',body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};}
reset();const history=JSON.stringify([tables.SSP_Non_Society_User,tables.SSP_Contact,tables.SSP_Payment,tables.SSP_Complaint]);
assert.equal((await call()).status,200);const deleted=tables.SSP_Society_User[1];assert.ok(deleted.deleted_at);assert.equal(deleted.status,false);assert.equal(deleted.one_time_password_otp,null);
assert.equal(JSON.stringify([tables.SSP_Non_Society_User,tables.SSP_Contact,tables.SSP_Payment,tables.SSP_Complaint]),history);
const when=deleted.deleted_at;assert.equal((await call()).status,200);assert.equal(deleted.deleted_at,when);
reset();actor=member;assert.equal((await call()).status,403);assert.equal(tables.SSP_Society_User[1].deleted_at,null);actor=admin;
reset();tables.SSP_Society_User[1].society='other';assert.equal((await call()).status,403);
reset();tables.SSP_Society_User[0].deleted_at='old';assert.equal((await call()).status,403);
reset();assert.equal((await call({memberId:member,memberType:'vendor'})).status,400);
assert.equal((await call({memberId:'missing'})).status,404);assert.equal((await call({})).status,400);
reset();failUpdate=true;assert.equal((await call()).status,500);assert.equal(tables.SSP_Society_User[1].deleted_at,null);
console.log('Member deletion passed: linked history preserved, archived/inactive, OTP cleared, retries, same-society admin authorization, missing member and DB errors.');
