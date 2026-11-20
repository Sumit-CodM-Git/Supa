import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(
  new URL("../functions/send-sos-push/index.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("function categoryLabel(");
const end = source.indexOf("// ── Audit log helper", start);
assert.ok(start >= 0 && end > start, "SOS notification helpers are present");

const helperSource = stripTypeScriptTypes(source.slice(start, end));
const buildStaffNotification = new Function(
  `${helperSource}\nreturn buildStaffNotification;`,
)();

const notification = buildStaffNotification({
  sosId: "sos-123",
  category: "medical_emergency",
  severity: "critical",
  residentName: "Example Resident",
  residentPhone: "9000000000",
  flatNumber: "A-101",
  towerName: "North",
  blockName: "A",
  note: "Please send help",
});

assert.equal(notification.title, "🚨 SOS — MEDICAL EMERGENCY");
assert.equal(
  notification.body,
  [
    "Resident: Example Resident",
    "Flat: A-101, North, A",
    "Phone: 9000000000",
    "Alert type: MEDICAL EMERGENCY",
    "Note: Please send help",
    "Tap to respond",
  ].join("\n"),
);
assert.deepEqual(notification.data, {
  sosId: "sos-123",
  sos_id: "sos-123",
  category: "medical_emergency",
  alertType: "medical_emergency",
  alert_type: "MEDICAL EMERGENCY",
  severity: "critical",
  residentName: "Example Resident",
  resident_name: "Example Resident",
  flatNumber: "A-101",
  flat_number: "A-101",
  towerName: "North",
  tower_name: "North",
  blockName: "A",
  block_name: "A",
  residentPhone: "9000000000",
  resident_phone: "9000000000",
  note: "Please send help",
  type: "SOS_ALERT",
  deepLink: "app://sos/sos-123",
});

const withoutNote = buildStaffNotification({
  sosId: "sos-124",
  category: "stuck_in_lift",
  severity: "high",
  residentName: "Example Resident",
  residentPhone: "",
  flatNumber: null,
  towerName: null,
  blockName: null,
  note: null,
});
assert.match(withoutNote.body, /Flat: Not provided/);
assert.match(withoutNote.body, /Phone: Not provided/);
assert.doesNotMatch(withoutNote.body, /Note:/);
assert.equal(withoutNote.data.note, "");
assert.equal(withoutNote.highPriority, false);

const liftAlert = buildStaffNotification({
  sosId: "sos-125",
  category: "stuck_in_lift",
  severity: "high",
  residentName: "Aarav Sharma",
  residentPhone: "9876543210",
  flatNumber: "B-1204",
  towerName: "Tower B",
  blockName: "Block B",
  note: "Tower B Lift 1",
});
for (const [key, value] of Object.entries({
  alertType: "stuck_in_lift",
  residentName: "Aarav Sharma",
  residentPhone: "9876543210",
  flatNumber: "B-1204",
  towerName: "Tower B",
  blockName: "Block B",
  note: "Tower B Lift 1",
})) {
  assert.equal(liftAlert.data[key], value);
}
assert.ok(Object.values(liftAlert.data).every((value) => typeof value === "string"));

console.log("SOS notification details passed: resident, location, phone, alert type, and note.");
