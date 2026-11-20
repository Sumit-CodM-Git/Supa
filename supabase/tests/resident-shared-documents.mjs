// Run with Node 26: node supabase/tests/resident-shared-documents.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../functions/crud-resident-document/index.ts', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, ''));
const id = '11111111-1111-4111-8111-111111111111';
function api(row = null) {
  const calls = [];
  let signed = 0;
  const client = { from: table => {
    let matches = true;
    const query = {};
    for (const method of ['select','eq','not','in','or','gte','lte','order','range']) query[method] = (...args) => {
      calls.push([method,...args]);
      if (method === 'eq' && row && row[args[0]] !== args[1]) matches = false;
      return query;
    };
    query.maybeSingle = async () => ({ data: matches ? row : null, error: null });
    query.then = (resolve,reject) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve,reject);
    return query;
  }, storage: { from: () => ({ createSignedUrl: async () => { signed++; return { data: { signedUrl: 'https://signed.example/doc' }, error: null }; } }) }};
  const functions = new Function('serve','createClient','Deno',source+'\nreturn {handleView,handleDownload,handleDelete,handleUpload,formatDocument};')
    (() => {}, () => client, { env: { get: () => 'https://project.supabase.co' } });
  return { ...functions, calls, signed: () => signed };
}
const shared = type => ({ document_id: id, society: 'society', society_user: null, document_type: type, s3_path: 'shared/doc.pdf' });
for (const type of ['bylaws','society_rules','legal','agreement']) {
  const endpoint = api(shared(type));
  assert.equal((await endpoint.handleDownload({ documentId: id },'society','resident')).status,200);
  assert.equal((await endpoint.handleDelete({ documentId: id },'society','resident')).status,403);
  const formatted = await endpoint.formatDocument(shared(type),'resident');
  assert.equal(formatted.canDelete,false); assert.equal(formatted.isShared,true);
  const upload = await endpoint.handleUpload({ phase:'request', payload: { documentType:type,fileName:'doc.pdf',fileType:'application/pdf',fileSize:10 } },'society','resident','REG');
  assert.equal(upload.status,400);
}
for (const row of [
  {...shared('aadhaar_card'),society_user:'other'},
  {...shared('bylaws'),society:'other-society'},
  {...shared('legal'),society_user:'other'},
  shared('financial'),
]) {
  const endpoint = api(row);
  assert.ok([403,404].includes((await endpoint.handleDownload({documentId:id},'society','resident')).status));
  assert.equal(endpoint.signed(),0);
}
const own = api({...shared('aadhaar_card'),society_user:'resident'});
assert.equal((await own.handleDownload({documentId:id},'society','resident')).status,200);
for (const scope of ['all','own','shared']) {
  const endpoint = api();
  const response = await endpoint.handleView({scope,search:'rules',filters:{documentType:['bylaws','aadhaar_card']}},'society','resident');
  assert.equal(response.status,200);
  assert.ok(endpoint.calls.some(([method,key,value])=>method==='eq'&&key==='society'&&value==='society'));
  const ors = endpoint.calls.filter(([method])=>method==='or');
  assert.equal(ors.length,1,'Search and visibility must share a single combined constraint');
  assert.ok(ors[0][1].includes('name.ilike.'));
  if(scope!=='shared') assert.ok(ors[0][1].includes('society_user.eq.resident'));
  if(scope!=='own') assert.ok(ors[0][1].includes('society_user.is.null'));
}
console.log('Shared document download, ownership, cross-society isolation, upload/delete protection, and view/search scope checks passed.');
