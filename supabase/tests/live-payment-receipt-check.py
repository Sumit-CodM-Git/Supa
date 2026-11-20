"""Verify real PDF downloads and unchanged payment proof/status fields."""
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

spec = importlib.util.spec_from_file_location("api", Path(__file__).with_name("live-visitor-name-check.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
directory = Path("artifacts/receipt-download")
report = {"checks": []}


def download(label, payload, token, expected=200):
    output = directory / (label + ".pdf")
    header_file = directory / "response-headers.txt"
    config = ["url = " + json.dumps(api.BASE + "generate-payment-receipt"), 'request = "POST"',
              'header = "Content-Type: application/json"',
              "header = " + json.dumps("Authorization: Bearer " + token),
              "data = " + json.dumps(json.dumps(payload)), "output = " + json.dumps(str(output)),
              "dump-header = " + json.dumps(str(header_file)), 'write-out = "%{http_code}"']
    process = subprocess.run(["/usr/bin/curl", "--silent", "--show-error", "--max-time", "60", "--config", "-"],
                             input="\n".join(config), capture_output=True, text=True, timeout=65)
    assert process.returncode == 0, "Download transfer failed"
    status = int(process.stdout)
    headers = dict(line.split(":", 1) for line in header_file.read_text().splitlines() if ":" in line)
    headers = {key.strip().lower(): value.strip() for key, value in headers.items()}
    body = output.read_bytes()
    summary = {"case": label, "request": payload, "http_status": status,
               "content_type": headers.get("content-type"),
               "content_disposition": headers.get("content-disposition"),
               "source": headers.get("x-receipt-source"), "bytes": len(body)}
    if status != 200:
        summary["error"] = json.loads(body)
    report["checks"].append(summary)
    print(label + ": HTTP " + str(status) + ", " + str(headers.get("content-type")), flush=True)
    assert status == expected, summary
    if status == 200:
        assert headers.get("content-type", "").startswith("application/pdf"), summary
        assert headers.get("content-disposition", "").startswith("attachment;"), summary
        assert body.startswith(b"%PDF-") and b"%%EOF" in body[-100:], "Invalid PDF response"
        assert headers.get("cache-control") == "private, no-store"
        summary["sha256"] = hashlib.sha256(body).hexdigest()
        summary["valid_pdf_structure"] = True


try:
    actor = api.db('SELECT c.phone,NULLIF(trim(a.phone),\'\') IS NULL AS auth_phone_missing '
                   'FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '
                   "JOIN auth.users a ON a.raw_user_meta_data->>'user_id'=u.user_id::text "
                   f"WHERE u.user_id='{api.HOST}';")[0]
    report["auth_phone_missing"] = actor["auth_phone_missing"]
    credentials = {"phoneNumber": str(actor["phone"]), "registrationNumber": "GZB-1234-ab"}
    status, generated = api.post("get-otp", credentials, record=False)
    assert status == 200
    status, authenticated = api.post("verify-otp", {**credentials, "otp": generated["otp"]}, record=False)
    assert status == 200 and "resident" in authenticated["user"]["roles"]
    token = authenticated["token"]
    payments = api.db('SELECT pay_rec_id,payment_id,payment_type,payment_status,md5(coalesce(receipt_url,\'\')) AS proof_fingerprint '
                      'FROM public."SSP_Payment" '
                      f"WHERE society_user='{api.HOST}' AND lower(trim(payment_status))='paid' ORDER BY created_at DESC LIMIT 3;")
    assert payments, "No paid resident payment available"
    before = {row["pay_rec_id"]: (row["payment_status"], row["proof_fingerprint"]) for row in payments}
    for index, payment in enumerate(payments):
        label = "subscription" if payment["payment_type"] == "subscription" else "payment-" + str(index)
        download(label, {"paymentId": payment["pay_rec_id"]}, token)
        download(label + "-by-payment-id", {"paymentId": payment["payment_id"]}, token)
    others = api.db('SELECT pay_rec_id FROM public."SSP_Payment" '
                    f"WHERE society_user<>'{api.HOST}' LIMIT 1;")
    if others:
        download("wrong-owner-rejected", {"paymentId": others[0]["pay_rec_id"]}, token, 404)
    unpaid = api.db('SELECT pay_rec_id FROM public."SSP_Payment" '
                    f"WHERE society_user='{api.HOST}' AND lower(trim(payment_status))='unpaid' LIMIT 1;")
    if unpaid:
        download("unpaid-rejected", {"paymentId": unpaid[0]["pay_rec_id"]}, token, 400)
    status, listed = api.post("generate-payment-receipt", {"list": True, "filters": {"paymentStatus": "paid"}}, token, record=False)
    assert status == 200
    allowed = api.db('SELECT pay_rec_id FROM public."SSP_Payment" '
                     f"WHERE society_user='{api.HOST}';")
    assert {row["payRecId"] for row in listed["receipts"]}.issubset({row["pay_rec_id"] for row in allowed})
    report["checks"].append({"case": "own receipt list", "http_status": status, "ownership_scoped": True})
    current = api.db('SELECT pay_rec_id,payment_status,md5(coalesce(receipt_url,\'\')) AS proof_fingerprint '
                     'FROM public."SSP_Payment" '
                     f"WHERE society_user='{api.HOST}' AND lower(trim(payment_status))='paid' ORDER BY created_at DESC LIMIT 3;")
    assert {row["pay_rec_id"]: (row["payment_status"], row["proof_fingerprint"]) for row in current} == before
    report.update({"result": "passed", "payment_status_and_proof_unchanged": True})
except Exception as error:
    report.update({"result": "failed", "error": str(error)})
finally:
    (directory / "result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key != "checks"}))
raise SystemExit(0 if report["result"] == "passed" else 1)
