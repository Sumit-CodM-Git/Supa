"""Compare live block/flat-type options with saved society configuration."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("api", Path(__file__).with_name("live-visitor-name-check.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
REG = "GZB-1234-ab"
SID = "74628c82-7e11-4f5a-952a-d062193b3fb9"
checks = []
token = None


def call(label, endpoint, payload):
    status, body = api.post(endpoint, payload, token, record=False)
    checks.append({"case": label, "endpoint": endpoint, "http_status": status})
    print(label + ": HTTP " + str(status), flush=True)
    assert status == 200, {"case": label, "error": body.get("errorResponse", body.get("message"))}
    return body


try:
    reference = api.db("SELECT jsonb_build_object('blocks',(SELECT jsonb_agg(jsonb_build_object('id',block_id,'name',block_name)) "
                       'FROM public."SSP_Block" '
                       f"WHERE society='{SID}' AND active=true),'flatTypes',(SELECT jsonb_agg(jsonb_build_object('id',flat_type_id,'name',flat_type)) "
                       f'FROM public."SSP_Flat_Type" WHERE society=\'{SID}\')) AS configuration;')[0]["configuration"]
    block_ids = {row["id"] for row in reference["blocks"]}
    block_names = {row["name"] for row in reference["blocks"]}
    flat_ids = {row["id"] for row in reference["flatTypes"]}
    flat_names = {row["name"] for row in reference["flatTypes"]}
    roles = [("admin", api.HOST), ("resident", "41526542-03fa-42e3-b63a-62a4947496f6"), ("security", api.GUARD)]
    for role, requester in roles:
        for scope in [None, ["SSP_Contact"], ["SSP_Society_User"], ["SSP_Block", "SSP_Flat_Type"]]:
            request = {"societyRegistrationNumber": REG, "requesterId": requester}
            if scope:
                request["scope"] = scope
            response = call(role + " " + str(scope or "all scopes"), "get-picklists", request)
            metadata = response["picklistsByTable"]["SSP_Society"]
            assert {row["value"] for row in metadata["block"]["options"]} == block_ids
            assert {row["value"] for row in metadata["block_name"]["options"]} == block_names
            assert {row["value"] for row in metadata["flat_type"]["options"]} == flat_names
            assert {row["value"] for row in metadata["flat_type_id"]["options"]} == flat_ids
            configuration = response["societyConfiguration"]
            assert {row["blockId"] for row in configuration["blocks"]} == block_ids
            assert {row["flatTypeId"] for row in configuration["flatTypes"]} == flat_ids
            if not scope or "SSP_Flat_Type" in scope:
                assert {row["value"] for row in response["picklistsByTable"]["SSP_Flat_Type"]["flat_type"]["options"]} == flat_names

    # Normal login for the private admin CRUD endpoint; never persist its token/OTP.
    actor = api.db('SELECT c.phone FROM public."SSP_Society_User" u JOIN public."SSP_Contact" c ON c.contact_id=u.contact '
                   f"WHERE u.user_id='{api.HOST}';")[0]
    credentials = {"phoneNumber": str(actor["phone"]), "registrationNumber": REG}
    status, otp = api.post("get-otp", credentials, record=False)
    assert status == 200
    status, authenticated = api.post("verify-otp", {**credentials, "otp": otp["otp"]}, record=False)
    assert status == 200 and "admin" in authenticated["user"]["roles"]
    token = authenticated["token"]
    common = {"societyRegistrationNumber": REG, "adminId": api.HOST}
    settings = call("admin settings", "get-society-settings", common)["data"]
    assert {row["blockId"] for row in settings["blocks"]} == block_ids
    assert {row["flatTypeId"] for row in settings["flatTypes"]} == flat_ids
    blocks = call("admin block list", "crud-block", {**common, "action": "VIEW", "limit": 100, "filters": {"active": True}})["data"]["blocks"]
    assert {row["blockId"] for row in blocks} == block_ids
    flat_types = call("admin flat-type list", "crud-flat-type", {**common, "action": "VIEW", "limit": 100})["data"]["flatTypes"]
    assert {row["flatTypeId"] for row in flat_types} == flat_ids
    report = {"result": "passed", "configuration_mutations": False, "checks": checks,
              "configured_blocks": sorted(block_names), "configured_flat_types": sorted(flat_names),
              "counts": {"blocks": len(block_ids), "flatTypes": len(flat_ids)}}
except Exception as error:
    report = {"result": "failed", "error": str(error), "checks": checks}
finally:
    Path("artifacts/location-options-audit/block-flat-type-result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key != "checks"}))
raise SystemExit(0 if report["result"] == "passed" else 1)
