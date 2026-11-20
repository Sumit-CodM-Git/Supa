"""Verify Add Member configuration and apply the user's explicit Beeta assignment."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("api", Path(__file__).with_name("live-visitor-name-check.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
TOWER = "5d77ab28-98c8-4e10-8880-ac673950b4cb"
BLOCK = "63dcfde8-8c75-4ab4-9ec9-571f3d575a87"
REGISTRATION = "GZB-1234-ab"
report = {"checks": []}
TOKEN = None


def call(label, endpoint, payload):
    status, body = api.post(endpoint, payload, TOKEN, record=False)
    report["checks"].append({"case": label, "endpoint": endpoint, "http_status": status})
    print(label + ": HTTP " + str(status), flush=True)
    assert status == 200, {"case": label, "response": body}
    return body


try:
    credentials_row = api.db('SELECT c.phone,s.registration_number FROM public."SSP_Society_User" u '
        'JOIN public."SSP_Contact" c ON c.contact_id=u.contact '
        'JOIN public."SSP_Society" s ON s.society_id=u.society '
        f"WHERE u.user_id='{api.HOST}';")[0]
    credentials = {"phoneNumber": str(credentials_row["phone"]), "registrationNumber": credentials_row["registration_number"]}
    status, generated = api.post("get-otp", credentials, record=False)
    assert status == 200
    status, authenticated = api.post("verify-otp", {**credentials, "otp": generated["otp"]}, record=False)
    assert status == 200 and "admin" in authenticated["user"]["roles"]
    TOKEN = authenticated["token"]
    # User explicitly identified Beeta as the intended block for this existing tower.
    updated = call("assign Test new tower to Beeta", "crud-tower", {
        "action": "UPDATE", "societyRegistrationNumber": REGISTRATION,
        "adminId": api.HOST, "towerId": TOWER, "payload": {"blockId": BLOCK},
    })
    assert updated["data"]["tower"]["block"] == BLOCK
    assert updated["data"]["tower"]["blockId"] == BLOCK
    configurations = []
    for role, requester in [("admin", api.HOST), ("resident", "41526542-03fa-42e3-b63a-62a4947496f6"), ("security", api.GUARD)]:
        response = call(role + " all picklists", "get-picklists", {
            "societyRegistrationNumber": REGISTRATION, "requesterId": requester,
        })
        configuration = response["societyConfiguration"]
        tower = next(row for row in configuration["towers"] if row["towerId"] == TOWER)
        assert tower["name"] == "Test new tower" and tower["blockId"] == BLOCK
        assert any(row["value"] == TOWER for row in response["picklistsByTable"]["SSP_Society"]["tower"]["options"])
        assert {row["value"] for row in response["picklistsByTable"]["SSP_Flat_Type"]["flat_type"]["options"]} == {row["flatType"] for row in configuration["flatTypes"]}
        configurations.append(configuration)
    assert configurations[0] == configurations[1] == configurations[2]
    configuration = configurations[0]
    for scope in ["SSP_Contact", "SSP_Society_User", "SSP_Tower", "SSP_Block", "SSP_Flat_Type", "SSP_Complaint", "SSP_Non_Society_User", "SSP_Facility_Booking"]:
        response = call("picklist scope " + scope, "get-picklists", {
            "societyRegistrationNumber": REGISTRATION, "requesterId": api.GUARD, "scope": [scope],
        })
        assert response["societyConfiguration"] == configuration
        assert any(row["value"] == TOWER for row in response["picklistsByTable"]["SSP_Society"]["tower"]["options"])
    settings = call("admin settings parent mapping", "get-society-settings", {
        "societyRegistrationNumber": REGISTRATION, "adminId": api.HOST,
    })["data"]
    assert settings["societyConfiguration"] == configuration
    assert next(row for row in settings["towers"] if row["towerId"] == TOWER)["blockId"] == BLOCK
    common = {"action": "VIEW", "societyRegistrationNumber": REGISTRATION, "adminId": api.HOST, "limit": 100}
    towers = call("Beeta-filtered tower list", "crud-tower", {**common, "filters": {"block": BLOCK, "active": True}})["data"]["towers"]
    assert any(row["towerId"] == TOWER for row in towers)
    blocks = call("configured block list", "crud-block", {**common, "filters": {"active": True}})["data"]["blocks"]
    assert {row["blockId"] for row in blocks} == {row["blockId"] for row in configuration["blocks"]}
    flat_types = call("configured flat-type list", "crud-flat-type", common)["data"]["flatTypes"]
    assert {row["flatTypeId"] for row in flat_types} == {row["flatTypeId"] for row in configuration["flatTypes"]}
    saved = api.db('SELECT t.tower_id,t.name,t.block,COUNT(u.user_id) AS assigned_members '
                   'FROM public."SSP_Tower" t LEFT JOIN public."SSP_Society_User" u ON u.tower=t.tower_id '
                   f"WHERE t.tower_id='{TOWER}' GROUP BY t.tower_id;")
    assert saved[0]["block"] == BLOCK
    report.update({"result": "passed", "saved_tower": saved[0], "counts": {key: len(value) for key, value in configuration.items()},
                   "note": "A tower is available in configuration even when it has no assigned members."})
except Exception as error:
    report.update({"result": "failed", "error": str(error)})
finally:
    Path("artifacts/location-options-audit/result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key != "checks"}))
raise SystemExit(0 if report["result"] == "passed" else 1)
