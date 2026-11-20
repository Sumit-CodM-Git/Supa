import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(
  new URL("../functions/_shared/receipt-storage.ts", import.meta.url),
  "utf8",
).replace(/^export /gm, "");
const { resolveReceiptImage } = new Function(
  "Deno",
  `${stripTypeScriptTypes(source)}\nreturn { resolveReceiptImage };`,
)({
  env: { get: (name) => name === "SUPABASE_URL" ? "https://project.test" : "" },
});

let files = [{ name: "proof.jpg", id: "object-id", metadata: { size: 12 } }];
let storageError = null;
let signingCalls = 0;
const client = {
  storage: {
    from(bucket) {
      assert.equal(bucket, "society-documents");
      return {
        async list(folder, options) {
          assert.equal(folder, "GZB-1234/Financial");
          assert.equal(options.search, "proof.jpg");
          return { data: files, error: storageError };
        },
        async createSignedUrl(path, expiresIn) {
          signingCalls++;
          assert.equal(path, "GZB-1234/Financial/proof.jpg");
          assert.equal(expiresIn, 900);
          return { data: { signedUrl: "https://project.test/signed/proof.jpg" }, error: null };
        },
      };
    },
  },
};

const objectPath = "GZB-1234/Financial/proof.jpg";
assert.deepEqual(await resolveReceiptImage(client, [objectPath]), {
  receiptImageUrl: "https://project.test/signed/proof.jpg",
  receiptUploadStatus: "uploaded",
});
assert.equal(signingCalls, 1);

files = [];
assert.deepEqual(await resolveReceiptImage(client, [objectPath]), {
  receiptImageUrl: null,
  receiptUploadStatus: "missing",
});
assert.equal(signingCalls, 1, "missing objects must not receive image links");

assert.deepEqual(await resolveReceiptImage(client, []), {
  receiptImageUrl: null,
  receiptUploadStatus: "not_provided",
});
assert.deepEqual(await resolveReceiptImage(client, ["https://legacy.example/proof.jpg"]), {
  receiptImageUrl: "https://legacy.example/proof.jpg",
  receiptUploadStatus: "unverified",
});

storageError = { message: "Storage unavailable" };
await assert.rejects(resolveReceiptImage(client, [objectPath]), /Receipt verification failed: Storage unavailable/);

console.log("Facility booking receipt image checks passed: existing proofs use signed URLs, missing uploads stay absent, legacy URLs are preserved, and storage errors surface.");
