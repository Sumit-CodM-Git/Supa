import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = (name) => readFileSync(new URL(`../functions/_shared/${name}.ts`, import.meta.url), "utf8");
const code = [read("receipt-storage"), read("facility-receipt")].join("\n")
  .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const resolve = new Function("Deno", `${stripTypeScriptTypes(code)}\nreturn resolveFacilityReceiptImage;`)(
  { env: { get: () => "https://project.test" } },
);
const original = "SOCIETY/Financial/proof.jpg";
const alternate = "SOCIETY/financial/proof.jpg";
let existing = new Set([alternate]);
let signed = [];
const client = { storage: { from(bucket) {
  assert.equal(bucket, "society-documents");
  return {
    async list(folder, { search }) {
      return { data: existing.has(`${folder}/${search}`)
        ? [{ name: search, id: "object", metadata: { size: 12 } }] : [], error: null };
    },
    async createSignedUrl(key) {
      signed.push(key);
      return { data: { signedUrl: `https://project.test/signed/${key}` }, error: null };
    },
  };
} } };
assert.equal((await resolve(client, [original])).receiptImageUrl, `https://project.test/signed/${alternate}`);
assert.equal((await resolve(client, [`https://project.test/storage/v1/object/public/society-documents/${original}`])).receiptUploadStatus, "uploaded");
existing = new Set([original]);
assert.equal((await resolve(client, [alternate])).receiptImageUrl, `https://project.test/signed/${original}`);
existing = new Set([original, alternate]);
assert.equal((await resolve(client, [original])).receiptImageUrl, `https://project.test/signed/${original}`);
existing.clear();
signed = [];
assert.equal((await resolve(client, [original])).receiptUploadStatus, "missing");
assert.equal((await resolve(client, [])).receiptUploadStatus, "not_provided");
assert.equal(signed.length, 0);
assert.deepEqual(await resolve(client, ["https://external.test/SOCIETY/Financial/proof.jpg"]), {
  receiptImageUrl: "https://external.test/SOCIETY/Financial/proof.jpg", receiptUploadStatus: "unverified",
});
console.log("Facility receipt folder fallback passed: both directions, absolute URLs, original priority, missing files, and external URL handling.");
