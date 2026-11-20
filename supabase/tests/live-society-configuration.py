"""Check shared configuration for all roles, including temporary admin edits."""
import importlib.util
import json
import subprocess
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location("api", Path(__file__).with_name("live-visitor-name-check.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
ADMIN = api.HOST
RESIDENT = "41526542-03fa-42e3-b63a-62a4947496f6"
SECURITY = api.GUARD
REGISTRATION = "GZB-1234-ab"
directory = Path("artifacts/society-configuration")
checks = []
created = []


def call(label, endpoint, payload, etag=None, expected=200):
    headers_file = directory / "response-headers.txt"
    config = ["url = " + json.dumps(api.BASE + endpoint), 'request = "POST"',
              'header = "Content-Type: application/json"', "data = " + json.dumps(json.dumps(payload)),
              "dump-header = " + json.dumps(str(headers_file)), 'write-out = "\\n%{http_code}"']
    if etag:
        config.append("header = " + json.dumps("If-None-Match: " + etag))
    process = subprocess.run(["/usr/bin/curl", "--silent", "--show-error", "--max-time", "45", "--config", "-"],
                             input="\n".join(config), capture_output=True, text=True, timeout=50)
    assert process.returncode == 0, label + " HTTPS request failed"
    raw, status = process.stdout.rsplit("\n", 1)
    status = int(status)
    body = json.loads(raw) if raw else None
    headers = dict(line.split(":", 1) for line in headers_file.read_text().splitlines() if ":" in line)
    headers = {key.strip().lower(): value.strip() for key, value in headers.items()}
    summary = {"case": label, "endpoint": endpoint, "http_status": status}
    if body and body.get("societyConfiguration"):
        summary.update({"counts": {key: len(value) for key, value in body["societyConfiguration"].items()},
                        "configurationVersion": body["configurationVersion"], "etag": headers.get("etag"),
                        "cache_control": headers.get("cache-control")})
    checks.append(summary)
    print(label + ": HTTP " + str(status), flush=True)
    assert status == expected, {"case": label, "http_status": status, "error": body.get("errorResponse") if body else None}
    return body, headers


def pick(label, requester, scope=None, etag=None, expected=200):
    body = {"societyRegistrationNumber": REGISTRATION, "requesterId": requester}
    if scope:
        body["scope"] = scope
    return call(label, "get-picklists", body, etag, expected)


def edit(label, endpoint, action, **fields):
    return call(label, endpoint, {"societyRegistrationNumber": REGISTRATION,
                                 "adminId": ADMIN, "action": action, **fields}, expected=201 if action == "CREATE" else 200)[0]


try:
    initial, headers = pick("admin baseline", ADMIN)
    assert "private" in headers["cache-control"] and "no-cache" in headers["cache-control"]
    for role, member in [("resident", RESIDENT), ("security", SECURITY)]:
        body, _ = pick(role + " baseline", member)
        assert body["societyConfiguration"] == initial["societyConfiguration"]
        assert body["configurationVersion"] == initial["configurationVersion"]
    configured_types = {row["flatType"] for row in initial["societyConfiguration"]["flatTypes"]}
    assert {option["value"] for option in initial["picklistsByTable"]["SSP_Flat_Type"]["flat_type"]["options"]} == configured_types
    for scope in ["SSP_Contact", "SSP_Society_User", "SSP_Tower", "SSP_Block", "SSP_Flat_Type"]:
        body, _ = pick("scope " + scope, SECURITY, [scope])
        assert body["societyConfiguration"] == initial["societyConfiguration"]
        assert body["picklistsByTable"]["SSP_Society"]["tower"]["options"] == initial["picklistsByTable"]["SSP_Society"]["tower"]["options"]
    settings, _ = call("admin settings consistency", "get-society-settings", {
        "societyRegistrationNumber": REGISTRATION, "adminId": ADMIN})
    assert settings["data"]["societyConfiguration"] == initial["societyConfiguration"]
    assert settings["data"]["configurationVersion"] == initial["configurationVersion"]
    pick("unchanged ETag", SECURITY, etag=headers["etag"], expected=304)

    marker = "Codex Config Test " + str(uuid.uuid4())[:8]
    tower = edit("create temporary tower", "crud-tower", "CREATE", payload={
        "name": marker, "active": True, "floors": 0, "flats_per_floor": 0})["data"]["tower"]
    created.append(("crud-tower", "towerId", tower["towerId"]))
    block = edit("create temporary block", "crud-block", "CREATE", payload={
        "block_name": marker, "active": True, "tower": tower["towerId"]})["data"]["block"]
    created.append(("crud-block", "blockId", block["blockId"]))
    for role, member in [("admin", ADMIN), ("resident", RESIDENT), ("security", SECURITY)]:
        body, _ = pick(role + " sees additions", member, etag=headers["etag"])
        assert body["configurationVersion"] != initial["configurationVersion"]
        assert any(row["towerId"] == tower["towerId"] for row in body["societyConfiguration"]["towers"])
        assert any(row["blockId"] == block["blockId"] for row in body["societyConfiguration"]["blocks"])
    edit("rename temporary tower", "crud-tower", "UPDATE", towerId=tower["towerId"], payload={"name": marker + " Renamed"})
    edit("rename temporary block", "crud-block", "UPDATE", blockId=block["blockId"], payload={"block_name": marker + " Renamed"})
    for role, member in [("resident", RESIDENT), ("security", SECURITY)]:
        body, _ = pick(role + " sees renames", member)
        assert next(row["name"] for row in body["societyConfiguration"]["towers"] if row["towerId"] == tower["towerId"]) == marker + " Renamed"
        assert next(row["blockName"] for row in body["societyConfiguration"]["blocks"] if row["blockId"] == block["blockId"]) == marker + " Renamed"
    edit("deactivate temporary block", "crud-block", "UPDATE", blockId=block["blockId"], payload={"active": False})
    edit("deactivate temporary tower", "crud-tower", "UPDATE", towerId=tower["towerId"], payload={"active": False})
    for role, member in [("admin", ADMIN), ("resident", RESIDENT), ("security", SECURITY)]:
        body, _ = pick(role + " excludes inactive rows", member)
        assert body["societyConfiguration"] == initial["societyConfiguration"]
    other_society = api.db('SELECT registration_number FROM public."SSP_Society" '
                           "WHERE registration_number<>'GZB-1234-ab' AND active=true LIMIT 1;")
    if other_society:
        call("cross-society requester rejected", "get-picklists", {
            "societyRegistrationNumber": other_society[0]["registration_number"], "requesterId": SECURITY}, expected=403)
    report = {"result": "passed", "checks": checks}
except Exception as error:
    report = {"result": "failed", "error": str(error), "checks": checks}
finally:
    try:
        for endpoint, field, identifier in reversed(created):
            edit("remove temporary " + field, endpoint, "DELETE", **{field: identifier})
        report["cleanup"] = {"configuration_records_removed": len(created)}
    except Exception as error:
        report["cleanup"] = {"error": str(error), "records": created}
    (directory / "result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"result": report["result"], "cases": len(checks), "cleanup": report["cleanup"], "error": report.get("error")}))
raise SystemExit(0 if report["result"] == "passed" else 1)
