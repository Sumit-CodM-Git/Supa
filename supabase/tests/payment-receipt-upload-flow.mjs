import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const receiptSource = readFileSync(
  new URL("../functions/_shared/receipt-storage.ts", import.meta.url),
  "utf8",
).replace(/^export /gm, "");
const receiptHelpers = stripTypeScriptTypes(receiptSource);
const { createReceiptSignedUrl } = new Function(
  "Deno",
  `${receiptHelpers}\nreturn { createReceiptSignedUrl };`,
)({
  env: { get: (name) => name === "SUPABASE_URL" ? "https://project.test" : "" },
});

let storedFiles = [{ name: "receipt.jpg", id: "object-id", metadata: { size: 12 } }];
let signedUrlCalls = 0;
let signingError = null;
const client = {
  storage: {
    from(bucket) {
      assert.equal(bucket, "society-documents");
      return {
        async list(folder, options) {
          assert.equal(folder, "GZB-1234/financial");
          assert.equal(options.search, "receipt.jpg");
          return { data: storedFiles, error: null };
        },
        async createSignedUrl(key, expiresIn) {
          signedUrlCalls++;
          assert.equal(key, "GZB-1234/financial/receipt.jpg");
          assert.equal(expiresIn, 900);
          if (signingError) return { data: null, error: { message: signingError } };
          return { data: { signedUrl: "https://project.test/signed/receipt.jpg" }, error: null };
        },
      };
    },
  },
};

const storedPath =
  "https://project.test/storage/v1/object/public/society-documents/GZB-1234/financial/receipt.jpg";
assert.equal(
  await createReceiptSignedUrl(client, storedPath),
  "https://project.test/signed/receipt.jpg",
);
assert.equal(signedUrlCalls, 1);

storedFiles = [];
assert.equal(await createReceiptSignedUrl(client, storedPath), null);
assert.equal(signedUrlCalls, 1, "missing objects must not produce view URLs");

assert.equal(
  await createReceiptSignedUrl(client, "https://old-project.test/receipt.jpg"),
  null,
  "external public URLs must not bypass signed receipt access",
);

storedFiles = [{ name: "receipt.jpg", id: "object-id", metadata: { size: 12 } }];
signingError = "Storage unavailable";
await assert.rejects(
  createReceiptSignedUrl(client, storedPath),
  /Receipt signing failed: Storage unavailable/,
);
signingError = null;

const residentSource = readFileSync(
  new URL("../functions/resident-payments-console/index.ts", import.meta.url),
  "utf8",
);
const residentConfirm = residentSource.indexOf(
  'if (cleanAction === "CONFIRM_RECEIPT_UPLOAD")',
);
const residentSubmit = residentSource.indexOf(
  'if (cleanAction === "SUBMIT_PAYMENT")',
);
const residentFetch = residentSource.indexOf('if (cleanAction === "FETCH_OWN")');
assert.ok(residentConfirm >= 0 && residentSubmit > residentConfirm && residentFetch > residentSubmit);
assert.match(residentSource.slice(residentConfirm, residentSubmit), /confirmResidentPaymentProof/);
assert.match(residentSource.slice(residentConfirm, residentSubmit), /status: confirmed.payment_status/);
assert.match(residentSource.slice(residentConfirm, residentSubmit), /approvalStatus: confirmed.approval_status/);
assert.doesNotMatch(
  residentSource.slice(residentSubmit, residentFetch),
  /update\(\{ payment_status: "UNDER REVIEW" \}\)/,
);
assert.match(residentSource.slice(residentSubmit, residentFetch), /receiptUploadStatus: uploadPresignedUrl \? "pending_upload"/);
assert.match(residentSource, /\.eq\("society_user", targetResidentId\)/);

// Execute the submission completion log: a missing variable here used to throw
// after upload preparation, preventing the signed URL from reaching the client.
const submissionSource = residentSource.slice(residentSubmit, residentFetch);
const completionLog = submissionSource.match(/logger\.info\(\{[\s\S]*?action: "resident_payments_console_submit_end",[\s\S]*?\}\);/);
assert.ok(completionLog, "submission must log completion");
let completion;
new Function("logger", "userId", "paymentRecordUuid", "statusVal", "uploadPresignedUrl", "startTime", completionLog[0])(
  { info: (entry) => { completion = entry; } },
  "resident-id", "payment-uuid", "UNPAID", "https://project.test/upload", Date.now(),
);
assert.equal(completion.status, "UNPAID");
assert.equal(completion.hasUpload, true);

const legacySource = readFileSync(
  new URL("../functions/make-resident-payment/index.ts", import.meta.url),
  "utf8",
);
assert.match(legacySource, /\.eq\("society_user", cleanResidentId\)/);
assert.match(legacySource, /actionType === "CONFIRM_RECEIPT_UPLOAD"/);
assert.match(legacySource, /receiptUploadStatus: uploadPresignedUrl \? "pending_upload"/);

const getPaymentsSource = readFileSync(
  new URL("../functions/get-payments-list/index.ts", import.meta.url),
  "utf8",
);
assert.match(getPaymentsSource, /isPaymentStaffRole\(membership\.role\)/);
assert.doesNotMatch(getPaymentsSource, /GZB-1234-ab/);
assert.match(getPaymentsSource, /createReceiptSignedUrl/);

// Exercise both response contracts. Legacy clients read uploadUrl directly;
// merged clients read data.uploadUrl. Both must receive the same signed URL.
const uploadResponseStart = residentSource.indexOf("function paymentUploadResponse(");
assert.ok(uploadResponseStart >= 0);
const uploadResponseSource = residentSource.slice(
  uploadResponseStart,
  residentSource.indexOf("// ============================================", uploadResponseStart),
);
const paymentUploadResponse = new Function("corsHeaders", `${stripTypeScriptTypes(uploadResponseSource)}; return paymentUploadResponse;`)(
  { "Access-Control-Allow-Origin": "*" },
);
const submissionPayload = {
  paymentSubmission: { submitted: true, status: "UNPAID", receiptUploadStatus: "pending_upload" },
  uploadUrl: "https://project.test/upload?token=test",
  documentId: "document-id",
  pagination: { page: 1, limit: 10, retrievedRecords: 1, totalRecords: 1 },
};
const submissionResponse = paymentUploadResponse(submissionPayload);
assert.equal(submissionResponse.status, 200);
assert.equal(submissionResponse.headers.get("Access-Control-Allow-Origin"), "*");
const submissionJson = await submissionResponse.json();
assert.deepEqual(submissionJson.data, submissionPayload);
assert.equal(submissionJson.uploadUrl, submissionJson.data.uploadUrl);
assert.equal(submissionJson.documentId, submissionJson.data.documentId);
assert.deepEqual(submissionJson.paymentSubmission, submissionJson.data.paymentSubmission);
assert.equal(submissionJson.errorResponse, null);
const confirmedPayload = { paymentSubmission: { status: "UNDER REVIEW", receiptUploadStatus: "uploaded" } };
const confirmedJson = await paymentUploadResponse(confirmedPayload).json();
assert.deepEqual(confirmedJson.data, confirmedPayload);
assert.deepEqual(confirmedJson.paymentSubmission, confirmedPayload.paymentSubmission);
assert.equal(confirmedJson.errorResponse, null);
assert.equal("uploadUrl" in confirmedJson, false);
const noFile = await paymentUploadResponse({ ...submissionPayload, uploadUrl: null, documentId: null }).json();
assert.equal(noFile.uploadUrl, null);
assert.equal(noFile.data.uploadUrl, null);
stripTypeScriptTypes(residentSource); // Parse the complete updated handler.

console.log("Payment receipt flow checks passed: legacy/merged response compatibility, explicit confirmation, stored-image verification, and scoped admin retrieval.");
