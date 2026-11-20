# Complaint START and END OTP

`POST /functions/v1/staff-complaint-workflow` requires the normal staff bearer token.

Send the same complaint ID through this sequence:

1. `{"action":"START_OTP","complaintId":"<uuid>"}`
2. Resident retrieves the START OTP using `FETCH_OTP`.
3. `{"action":"VERIFY_START","complaintId":"<uuid>","otp":"<resident OTP>"}`
4. `{"action":"END_OTP","complaintId":"<uuid>"}`
5. Resident retrieves the END OTP using `FETCH_OTP`.
6. `{"action":"VERIFY_END","complaintId":"<uuid>","otp":"<resident OTP>"}`

START verification sets `in_progress`. END verification sets `resolved` and the completion timestamp. END requires a verified START.

Requesting an unexpired OTP again reuses it. Repeating a completed stage returns success with `otpVerified: true` and `nextStep`, without resetting verification. The app should follow `nextStep` rather than always reopening an OTP-entry dialog. Expired codes must be requested again.

For old active complaints that still contain a previous END verification, requesting a new OTP resets stale cycle state rather than returning “END OTP already verified.” Reopening through `staff-complaints` to `assigned` resets both stages; changing back to `in_progress` clears the old END stage. Repeating the same status update preserves a pending OTP.

`complaint-otp` uses the same implementation: send `{"complaintId":"<uuid>","stage":"START"}` or `"END"` to request, and include `"otp"` to verify. Its END requests now record generation time, allowing verification through either endpoint.

Ownership checks remain on both endpoints. Concurrent changes cause HTTP 409 with a refresh/retry message. OTP validity remains 10 minutes.
