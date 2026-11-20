import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(
  new URL("../functions/create-sos/index.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("function buildSosResponse(");
const end = source.indexOf("\nDeno.serve(", start);
assert.ok(start >= 0 && end > start, "SOS response builder is present");

const helperSource = stripTypeScriptTypes(source.slice(start, end));
const buildSosResponse = new Function(
  `${helperSource}\nreturn buildSosResponse;`,
)();

const row = {
  sos_id: "sos-123",
  status: "ACTIVE",
  category: "stuck_in_lift",
  resident_name: "Example Resident",
  resident_phone: "9000000000",
  flat_number: "B-204",
  tower_name: "Tower B",
  block_name: "Block B",
  note: "Tower B Lift 1",
  created_at: "2026-11-13T07:00:00.000Z",
};

assert.deepEqual(buildSosResponse(row, "trace-123", false), {
  sosId: "sos-123",
  status: "ACTIVE",
  category: "stuck_in_lift",
  alertType: "stuck_in_lift",
  residentName: "Example Resident",
  residentPhone: "9000000000",
  flatNumber: "B-204",
  towerName: "Tower B",
  blockName: "Block B",
  note: "Tower B Lift 1",
  createdAt: "2026-11-13T07:00:00.000Z",
  isDuplicate: false,
  message: "SOS raised. Emergency staff are being notified.",
  traceId: "trace-123",
});

const replay = buildSosResponse(row, "trace-456", true);
assert.equal(replay.isDuplicate, true);
assert.equal(replay.alertType, row.category);
assert.equal(replay.residentName, row.resident_name);
assert.equal(replay.residentPhone, row.resident_phone);
assert.equal(replay.flatNumber, row.flat_number);
assert.equal(replay.note, row.note);
assert.equal("message" in replay, false);

console.log("Create SOS response includes resident, location, alert type, and note.");
