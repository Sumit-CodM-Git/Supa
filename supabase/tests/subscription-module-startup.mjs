// Run: node --experimental-vm-modules supabase/tests/subscription-module-startup.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = new URL('../functions/', import.meta.url);
for (const name of ['create-razorpay-order','upgrade-subscription','manage-subscription-payment','renew-subscription']) {
  let registered = 0;
  const context = vm.createContext({ console, Date, Map, Headers, Response, Request, URL, crypto: globalThis.crypto,
    Deno: { env: { get: () => 'test-config' } }, fetch: () => { throw new Error('Startup must not call external services'); } });
  const modules = new Map();
  async function moduleFor(url) {
    if (modules.has(url)) return modules.get(url);
    let module;
    if (url.startsWith('https://')) {
      const exports = url.includes('/http/server.ts') ? ['serve'] : ['createClient'];
      module = new vm.SyntheticModule(exports, function() {
        for (const key of exports) this.setExport(key,key === 'serve' ? () => registered++ : () => ({}));
      }, { context, identifier: url });
    } else {
      module = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8')), { context, identifier: url });
    }
    modules.set(url,module);
    return module;
  }
  const entry = await moduleFor(new URL(name+'/index.ts',root).href);
  await entry.link((specifier,parent) => moduleFor(new URL(specifier,parent.identifier).href));
  await entry.evaluate();
  assert.equal(registered,1,`${name} must register a request handler`);
  console.log(`${name}: module linking and startup passed`);
}
