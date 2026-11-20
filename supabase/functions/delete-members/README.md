# Member deletion

`POST /functions/v1/delete-members`, with the normal admin bearer token:

```json
{"memberId":"<society member UUID>","memberType":"society"}
```

`memberType` can be omitted. Only a nondeleted admin from the target member's society can delete the member.

Society members are archived by setting `SSP_Society_User.deleted_at` and `status=false`, and clearing their pending login OTP. The endpoint retains its existing success response. Repeated deletion succeeds without changing the original deletion timestamp.

The member disappears from `get-members`, is excluded from new OTP requests and OTP verification, cannot be updated through `update-member`, and no longer occupies a flat for `add-members`. Their row and contact remain to preserve visitor hosts/approvers, complaints, bookings, payments and other linked history. This is an archive, not a physical SQL DELETE. Existing bearer tokens retain their normal expiry; this change does not revoke already issued tokens across all APIs.

Vendor deletion retains its existing behavior. No database constraint is removed or changed. Historical members are not deleted automatically; admins choose which member to delete.
