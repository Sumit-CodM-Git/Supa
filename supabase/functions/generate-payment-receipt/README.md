# Resident receipt download

`POST /functions/v1/generate-payment-receipt`

```http
Authorization: Bearer RESIDENT_LOGIN_TOKEN
Content-Type: application/json
```

```json
{
  "paymentId": "PAYMENT-RECORD-UUID-OR-PAYMENT-ID"
}
```

Success is a direct file response, not JSON:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="Receipt_PAYMENT-ID.pdf"
Cache-Control: private, no-store
X-Receipt-Source: generated
```

The body contains PDF bytes. The app's download handler must receive bytes and
save/open them as a PDF; do not JSON-decode a successful file response. A browser
fetch likewise needs a Blob/download action in the client. The server exposes
Content-Disposition and Content-Length through CORS.

For an existing client that needs a JSON URL instead, send:

```json
{
  "paymentId": "PAYMENT-RECORD-UUID-OR-PAYMENT-ID",
  "responseFormat": "url"
}
```

That returns `downloadUrl` at the JSON root, valid for 300 seconds. Downloading
the URL is a second HTTP request. Direct mode requires no second request and
does not upload/cache a generated file or modify the payment's receipt/proof
URL. Optional URL mode may cache the generated PDF separately in storage.

`{"list":true}` continues to return a JSON receipt list scoped to the verified
resident's application user ID. Authentication does not require auth.users.phone.
Only the resident's own paid payments can be downloaded. Error responses remain
JSON with HTTP 400, 401, 403, 404, or 500 as appropriate.

Validation: `node supabase/tests/payment-receipt-download.mjs` and
`python3 supabase/tests/live-payment-receipt-check.py`. Live checks use existing
paid payments and confirm payment status/proof links remain unchanged.
