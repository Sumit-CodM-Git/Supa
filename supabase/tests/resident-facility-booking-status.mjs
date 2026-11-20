import assert from "node:assert/strict";
import { formatResidentFacilityBooking } from "../functions/_shared/resident-facility-bookings.ts";

const request = {
  recordType: "request",
  status: "pending_verification",
  booking_status: "pending_verification",
  payment_status: "Successful",
};

const awaitingDecision = formatResidentFacilityBooking(request);
assert.equal(awaitingDecision.bookingStatus, "requested");
assert.equal(awaitingDecision.approvalStatus, "requested");

const unpaid = formatResidentFacilityBooking({
  ...request,
  status: "waiting_payment",
  booking_status: "waiting_payment",
  payment_status: "unpaid",
});
assert.equal(unpaid.bookingStatus, "waiting_payment");
assert.equal(unpaid.approvalStatus, "waiting_payment");

const rejected = formatResidentFacilityBooking({
  ...request,
  status: "rejected",
  booking_status: "rejected",
  payment_status: "Rejected",
});
assert.equal(rejected.bookingStatus, "rejected");
assert.equal(rejected.approvalStatus, "rejected");

const approvedBooking = formatResidentFacilityBooking({
  ...request,
  recordType: "booking",
  status: "approved",
  booking_status: "approved",
  approval_status: "approved",
});
assert.equal(approvedBooking.bookingStatus, "approved");
assert.equal(approvedBooking.approvalStatus, "approved");

console.log("Resident facility booking status formatting tests passed.");
