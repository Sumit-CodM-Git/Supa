"""Read-only verification of the deployed facility-name filter."""
import json
import subprocess
import uuid
from pathlib import Path

URL = "https://isrqhkshygauaehwfycw.supabase.co/functions/v1/get-facility-bookings"
checks = []


def call(label, **fields):
    payload = {"societyRegistrationNumber": "GZB-1234-ab", "limit": 100, **fields}
    config = "\n".join([
        "url = " + json.dumps(URL), 'request = "POST"',
        'header = "Content-Type: application/json"',
        "data = " + json.dumps(json.dumps(payload)), 'write-out = "\\n%{http_code}"',
    ])
    process = subprocess.run(["/usr/bin/curl", "--silent", "--show-error", "--max-time", "45", "--config", "-"],
                             input=config, capture_output=True, text=True, timeout=50)
    if process.returncode:
        raise RuntimeError("Live request failed: " + label)
    raw, status = process.stdout.rsplit("\n", 1)
    response, status = json.loads(raw), int(status)
    checks.append({"case": label, "request": payload, "http_status": status,
                   "total": response.get("total"), "returned": len(response.get("bookings", [])),
                   "amenities": sorted({row["amenity"] for row in response.get("bookings", [])}),
                   "record_types": sorted({row["recordType"] for row in response.get("bookings", [])}),
                   "pagination": response.get("pagination"), "error": response.get("errorResponse")})
    print(label + ": HTTP " + str(status) + ", total=" + str(response.get("total")), flush=True)
    assert status == (400 if label == "invalid name type" else 200), checks[-1]
    return response


try:
    canonical = call("exact name", facilityName="Party Hall")
    assert canonical["total"] > 0
    assert all(row["amenity"] == "Party Hall" for row in canonical["bookings"])
    ids = [row["bookingId"] for row in canonical["bookings"]]
    for label, name in [("lowercase", "party hall"), ("uppercase", "PARTY HALL"), ("surrounding spaces", "  Party Hall  ")]:
        response = call(label, facilityName=name)
        assert response["total"] == canonical["total"]
        assert [row["bookingId"] for row in response["bookings"]] == ids
    response = call("second facility", facilityName="Badminton Club")
    assert response["total"] > 0 and all(row["amenity"] == "Badminton Club" for row in response["bookings"])
    assert call("unknown name", facilityName="NONEXISTENT-" + str(uuid.uuid4()))["total"] == 0
    assert call("literal wildcard characters", facilityName='NONEXISTENT%_ (East), "A"')["total"] == 0
    assert call("partial name stays exact", facilityName="Party")["total"] == 0
    all_rows = call("no name filter")
    assert call("all facilities", facilityName="all")["total"] == all_rows["total"]
    assert call("blank name", facilityName="  ")["total"] == all_rows["total"]
    call("invalid name type", facilityName=123)
    response = call("name overrides stale id", facilityName="Party Hall", facilityId=str(uuid.uuid4()))
    assert response["total"] == canonical["total"]
    facility_ids = {row["facilityId"] for row in canonical["bookings"]}
    if len(facility_ids) == 1:
        response = call("legacy id", facilityId=next(iter(facility_ids)))
        assert response["total"] == canonical["total"]
    response = call("status combination", facilityName="Party Hall", status="approved")
    assert all(row["approvalStatus"].lower() in ["approved", "booked"] for row in response["bookings"])
    response = call("search combination", facilityName="Party Hall", searchQuery="party")
    assert response["total"] == canonical["total"]
    assert call("nonmatching search", facilityName="Party Hall", searchQuery="NONEXISTENT-" + str(uuid.uuid4()))["total"] == 0
    response = call("date combination", facilityName="Party Hall", startDate="1900-01-01", endDate="2999-12-31")
    assert response["total"] == canonical["total"]
    assert call("date exclusion", facilityName="Party Hall", startDate="2999-01-01")["total"] == 0
    first = call("first page", facilityName="Party Hall", page=1, limit=2)
    second = call("second page", facilityName="Party Hall", page=2, limit=2)
    assert first["total"] == second["total"] == canonical["total"]
    assert [row["bookingId"] for row in first["bookings"] + second["bookings"]] == ids[:4]
    report = {"result": "passed", "read_only": True, "checks": checks}
except Exception as error:
    report = {"result": "failed", "error": str(error), "read_only": True, "checks": checks}
finally:
    Path("artifacts/facility-booking-filter/result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"result": report["result"], "cases": len(checks), "error": report.get("error")}))
raise SystemExit(0 if report["result"] == "passed" else 1)
