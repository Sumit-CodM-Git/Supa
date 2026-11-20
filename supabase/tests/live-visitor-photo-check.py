"""Exercise actual guard upload, binary PUT, resident image retrieval, and retake."""
import base64
import hashlib
import json
import subprocess
import uuid
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location("api", Path(__file__).with_name("live-visitor-name-check.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
report = {"calls": api.results["calls"], "checks": []}
directory = Path("artifacts/visitor-api-test")
fixture = directory / "test-photo.png"
photo = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOu8AAAAASUVORK5CYII=")
fixture.write_bytes(photo)
documents = []
resident_token = None
visitor_id = None


def login(user_id):
    rows = api.db('SELECT c.phone,s.registration_number FROM public."SSP_Society_User" u '
                  'JOIN public."SSP_Contact" c ON c.contact_id=u.contact '
                  'JOIN public."SSP_Society" s ON s.society_id=u.society '
                  f"WHERE u.user_id='{uuid.UUID(user_id)}';")
    credentials = {"phoneNumber": str(rows[0]["phone"]), "registrationNumber": rows[0]["registration_number"]}
    status, generated = api.post("get-otp", credentials, record=False)
    api.require(status == 200, "Login OTP failed")
    status, authenticated = api.post("verify-otp", {**credentials, "otp": generated["otp"]}, record=False)
    api.require(status == 200 and authenticated.get("token"), "Login failed")
    return authenticated["token"], authenticated["user"]["roles"], credentials["registrationNumber"]


def binary_request(url, method="GET", upload=None):
    output = directory / "downloaded-photo.png"
    config = ["url = " + json.dumps(url), "request = " + json.dumps(method),
              "output = " + json.dumps(str(output)), 'write-out = "%{http_code}"']
    if upload:
        config.extend(['header = "Content-Type: image/png"', "data-binary = " + json.dumps("@" + str(upload))])
    result = subprocess.run(["/usr/bin/curl", "--silent", "--show-error", "--max-time", "40", "--config", "-"],
                            input="\n".join(config), capture_output=True, text=True, timeout=45)
    api.require(result.returncode == 0, "Image HTTPS transfer failed")
    return int(result.stdout), output.read_bytes()


def resident_image(token, search):
    status, response = api.post("resident-visitor", {"action": "VIEW", "search": search, "limit": 10}, token)
    api.require(status == 200, "Resident visitor fetch failed")
    rows = [v for v in response["data"]["visitors"] if v["visitorId"] == visitor_id]
    api.require(len(rows) == 1 and rows[0].get("imageUrl"), "Resident response has no visitor imageUrl")
    url = rows[0]["imageUrl"]
    status, downloaded = binary_request(url)
    api.require(status == 200 and downloaded == photo, "Resident photo URL does not return the uploaded PNG")
    report["checks"].append({"resident_image_http_status": status,
                             "download_sha256": hashlib.sha256(downloaded).hexdigest(), "bytes_match": True})
    return url


try:
    guard_token, roles, registration = login(api.GUARD)
    api.require("security" in roles, "Guard login is not security")
    resident_token, resident_roles, _ = login(api.HOST)
    report["authentication"] = {"guard_roles": roles, "resident_roles": resident_roles}
    suffix = str(uuid.uuid4().int)[-6:]
    name = "Abc Photo Test " + suffix
    visitor_id = api.create_draft("7005" + suffix, {"fullName": name}, guard_token)
    status, response = api.post("security-gate-console", {
        "actionType": "REQUEST_APPROVAL", "societyRegistrationNumber": registration,
        "societyUserId": api.HOST, "securityGuardId": api.GUARD,
        "visitorId": visitor_id, "fullName": name, "purpose": "Codex visitor photo test",
    }, guard_token)
    api.require(status == 200, "Test visitor details failed")
    # Existing mobile-camera flow: request upload URL, then PUT actual image bytes.
    payload = {"operation": "UPLOAD", "societyRegistrationNumber": registration,
               "visitorId": visitor_id, "fileName": "captured-" + suffix + ".png",
               "fileType": "image/png", "fileSize": len(photo)}
    status, response = api.post("security-guard-image", payload, guard_token)
    api.require(status == 200, "Camera upload preparation failed")
    document_id = response["data"]["documentId"]
    documents.append(document_id)
    status, _ = binary_request(response["data"]["fileUrl"], "PUT", fixture)
    api.require(status == 200, "Camera binary upload failed")
    first_url = resident_image(resident_token, name)
    # Legacy camera clients may already send base64 to security-guard-image.
    status, response = api.post("security-guard-image", {
        **payload, "fileName": "inline-" + suffix + ".png", "fileBase64": base64.b64encode(photo).decode(),
    }, guard_token)
    api.require(status == 200, "Legacy inline photo upload failed")
    documents.append(response["data"]["documentId"])
    api.require(response["data"].get("requiresUpload") is False and response["data"].get("imageUrl"),
                "Legacy endpoint did not save the inline image")
    inline_url = resident_image(resident_token, name)
    api.require("inline-" + suffix in inline_url, "Resident did not receive the inline camera photo")
    # Retake via the base64 upload path. Resident must receive this newer photo.
    status, response = api.post("visitor-pass-operations", {
        **payload, "fileName": "retake-" + suffix + ".png", "fileBase64": base64.b64encode(photo).decode(),
    }, guard_token)
    api.require(status == 200, "Base64 photo retake failed")
    documents.append(response["data"]["documentId"])
    latest_url = resident_image(resident_token, name)
    api.require("retake-" + suffix in latest_url and first_url != latest_url,
                "Resident did not receive the latest visitor photo")
    report["checks"].append({"latest_photo_selected": True})
    report["result"] = "passed"
except Exception as error:
    report["result"] = "failed"
    report["error"] = str(error)
finally:
    try:
        for document_id in documents:
            status, response = api.post("crud-document", {
                "action": "DELETE", "societyRegistrationNumber": "GZB-1234-ab",
                "adminId": api.HOST, "documentId": document_id,
            }, resident_token)
            api.require(status == 200, "Test photo cleanup failed")
        if visitor_id:
            api.db('WITH cleared AS (DELETE FROM public."SSP_Notification" '
                   f"WHERE reference_id='{uuid.UUID(visitor_id)}' RETURNING notification_id) "
                   'DELETE FROM public."SSP_Non_Society_User" '
                   f"WHERE non_society_user_id='{uuid.UUID(visitor_id)}';")
        report["cleanup"] = {"test_documents_removed": len(documents), "test_visitor_removed": bool(visitor_id)}
    except Exception as error:
        report["cleanup"] = {"error": str(error), "document_ids": documents, "visitor_id": visitor_id}
    # Signed URLs are temporary read/write credentials; redact their tokens in the artifact.
    def redact(value):
        if isinstance(value, dict):
            return {key: redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [redact(item) for item in value]
        if isinstance(value, str) and "?token=" in value:
            return value.split("?token=", 1)[0] + "?token=[REDACTED]"
        return value
    report = redact(report)
    (directory / "photo-result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key != "calls"}, indent=2))
raise SystemExit(0 if report["result"] == "passed" else 1)
