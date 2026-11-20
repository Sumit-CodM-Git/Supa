"""Authenticated live visitor API check. Credentials remain in memory."""
import json
import subprocess
import sys
import uuid
from pathlib import Path

PROJECT = "isrqhkshygauaehwfycw"
BASE = f"https://{PROJECT}.supabase.co/functions/v1/"
REPORT = Path("artifacts/visitor-api-test/result.json")
GUARD = "516b517f-40c3-4fab-906a-c9da736ce24d"
HOST = "3096f2ea-dba7-46fa-9b56-00add869b034"
created = []
results = {"authentication": {}, "calls": [], "database_checks": []}


def db(sql):
    process = subprocess.run(
        ["supabase", "db", "query", "--linked", "--project-ref", PROJECT, sql],
        capture_output=True, text=True, timeout=45,
    )
    if process.returncode:
        raise RuntimeError("Database query failed; raw credential-bearing output withheld")
    output = process.stdout
    parsed = json.loads(output[output.index("{"):output.rindex("}") + 1])
    return parsed["rows"]


def post(endpoint, payload, token=None, record=True):
    # Use macOS curl's system trust store. Pass credentials via stdin, never argv.
    config = ["url = " + json.dumps(BASE + endpoint), 'request = "POST"',
              'header = "Content-Type: application/json"',
              "data = " + json.dumps(json.dumps(payload)),
              'write-out = "\\n%{http_code}"']
    if token:
        config.append("header = " + json.dumps("Authorization: Bearer " + token))
    process = subprocess.run(["/usr/bin/curl", "--silent", "--show-error", "--max-time", "40", "--config", "-"],
                             input="\n".join(config), capture_output=True, text=True, timeout=45)
    if process.returncode:
        raise RuntimeError("HTTPS request failed: " + process.stderr.strip())
    raw, status = process.stdout.rsplit("\n", 1)
    status, body = int(status), json.loads(raw)
    if record:
        results["calls"].append({"endpoint": endpoint, "request": payload,
                                  "http_status": status, "response": body})
    return status, body


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def check_saved(visitor_id, name):
    rows = db('SELECT non_society_user_id,name,visitor_status,visitor_approval_status,'
              'is_otp_verified FROM public."SSP_Non_Society_User" '
              f"WHERE non_society_user_id='{uuid.UUID(visitor_id)}';")
    results["database_checks"].append(rows)
    require(len(rows) == 1 and rows[0]["name"] == name,
            "The saved visitor name differs from the submitted name")


def create_draft(phone, name_fields, token):
    request = {"societyUserId": HOST, "phoneNumber": phone, **name_fields}
    status, response = post("visitor-otp", request, token)
    require(status == 200, "Visitor OTP generation failed")
    visitor_id = str(uuid.UUID(response["data"]["visitorId"]))
    created.append(visitor_id)
    return visitor_id


def verify(visitor_id, phone, token):
    rows = db('SELECT one_time_password FROM public."SSP_Non_Society_User" '
              f"WHERE non_society_user_id='{uuid.UUID(visitor_id)}';")
    otp = rows[0]["one_time_password"]
    payload = {"societyUserId": HOST, "phoneNumber": phone,
               "visitorId": visitor_id, "otp": otp}
    # Do not persist the OTP in artifacts or output.
    status, response = post("visitor-otp", payload, token, record=False)
    results["calls"].append({"endpoint": "visitor-otp", "request": {**payload, "otp": "[REDACTED]"},
                              "http_status": status, "response": response})
    require(status == 200 and response["data"]["otpVerified"], "Visitor OTP verification failed")



def main():
    try:
        guard = db('SELECT u.user_id,u.role,c.phone,s.registration_number FROM public."SSP_Society_User" u '
                   'JOIN public."SSP_Contact" c ON c.contact_id=u.contact '
                   'JOIN public."SSP_Society" s ON s.society_id=u.society '
                   f"WHERE u.user_id='{GUARD}' AND 'security'=ANY(u.role);")
        require(len(guard) == 1, "Security test account is unavailable")
        guard = guard[0]
        credentials = {"phoneNumber": str(guard["phone"]), "registrationNumber": guard["registration_number"]}
        status, login_otp = post("get-otp", credentials, record=False)
        require(status == 200 and login_otp.get("otp"), "Security login OTP request failed")
        status, login = post("verify-otp", {**credentials, "otp": login_otp["otp"]}, record=False)
        require(status == 200 and login.get("token"), "Security login failed")
        require("security" in login["user"]["roles"], "Authenticated account is not security")
        token = login["token"]
        results["authentication"] = {"user_id": login["user"]["id"], "roles": login["user"]["roles"],
                                      "method": "get-otp followed by verify-otp", "http_status": status}
        registration = guard["registration_number"]
        common = {"actionType": "REQUEST_APPROVAL", "societyRegistrationNumber": registration,
                  "societyUserId": HOST, "securityGuardId": GUARD,
                  "purpose": "Codex visitor-name API test", "role": "visitor"}
        suffix = str(uuid.uuid4().int)[-6:]

        # Actual authenticated requests, using three unique synthetic visitor phones.
        phone = "7001" + suffix
        visitor_id = create_draft(phone, {"fullName": "Abc Live Early Name"}, token)
        check_saved(visitor_id, "Abc Live Early Name")
        verify(visitor_id, phone, token)
        status, response = post("visitor-pass-operations", {**common, "visitorId": visitor_id,
                                 "visitorName": "Abc Live Early Name"}, token)
        require(status == 200, "Early-name approval submission failed")
        check_saved(visitor_id, "Abc Live Early Name")

        phone = "7002" + suffix
        visitor_id = create_draft(phone, {}, token)
        verify(visitor_id, phone, token)
        status, response = post("security-gate-console", {**common, "visitorId": visitor_id,
                                 "fullName": "Abc Live Late Name"}, token)
        require(status == 200, "Late-name approval submission failed")
        require(response["data"]["visitorName"] == "Abc Live Late Name", "Response name mismatch")
        check_saved(visitor_id, "Abc Live Late Name")

        phone = "7003" + suffix
        visitor_id = create_draft(phone, {"visitorData": {"fullName": "Abc Live Nested Name"}}, token)
        check_saved(visitor_id, "Abc Live Nested Name")
        status, response = post("visitor-pass-operations", {**common, "visitorId": visitor_id,
                                 "visitorData": {"name": "Abc Live Nested Name"}}, token)
        require(status == 200, "Nested-name approval submission failed")
        check_saved(visitor_id, "Abc Live Nested Name")

        phone = "7004" + suffix
        visitor_id = create_draft(phone, {}, token)
        status, response = post("visitor-pass-operations", {**common, "visitorId": visitor_id}, token)
        require(status == 400, "Missing-name details submission must return HTTP 400")
        results["result"] = "passed"
    except Exception as error:
        results["result"] = "failed"
        results["error"] = str(error)
    finally:
        try:
            if created:
                ids = ",".join("'" + str(uuid.UUID(value)) + "'" for value in created)
                db('WITH cleared AS (DELETE FROM public."SSP_Notification" '
                   f"WHERE reference_table='SSP_Non_Society_User' AND reference_id IN ({ids}) RETURNING notification_id) "
                   'DELETE FROM public."SSP_Non_Society_User" '
                   f"WHERE non_society_user_id IN ({ids}) RETURNING non_society_user_id;")
            results["cleanup"] = {"test_visitors_removed": len(created)}
        except Exception:
            results["cleanup"] = {"error": "Cleanup failed", "test_visitor_ids": created}
        REPORT.write_text(json.dumps(results, indent=2))
        print(json.dumps(results, indent=2))

    sys.exit(0 if results["result"] == "passed" else 1)


if __name__ == "__main__":
    main()
