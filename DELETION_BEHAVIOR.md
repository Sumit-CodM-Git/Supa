# Data deletion and related cleanup

This document describes what the application currently removes when a delete action is used, what it retains, and which related data requires separate cleanup. It is based on source code in this repository, not a live database schema inspection. Database foreign key cascades and triggers are therefore **not verified**; check the deployed schema before relying on them.

## Important: delete does not always mean physical removal

`POST /functions/v1/delete-members` handles both society members and vendors:

| Target | Direct operation | Related data | What remains / follow-up |
| --- | --- | --- | --- |
| Society member (`SSP_Society_User`) | Soft delete: sets `deleted_at`, `status=false`, clears `one_time_password_otp` | Contact (`SSP_Contact`), visitor rows (`SSP_Non_Society_User`), complaints, bookings, payments and other references are intentionally retained | No physical row or contact is deleted. Historical references remain valid. Existing access tokens are not revoked by this function and expire normally. |
| Vendor (`SSP_Non_Society_User`) | Physically deletes the vendor row | The function does not explicitly remove documents, complaints, assignments, or other linked rows | Any dependent rows or storage objects must be reviewed and cleaned up separately if policy requires it. FK behavior is unknown from repository migrations. |

The endpoint checks that the caller is an active `admin` and that target and caller belong to the same society. It does not delete data belonging to other societies. See [delete-members/index.ts](supabase/functions/delete-members/index.ts) and [delete-members/README.md](supabase/functions/delete-members/README.md).

## Other explicit delete flows found in Edge Functions

This is an inventory of application code paths found by searching `supabase/functions`. It is not a guarantee that these are the only deletion routes in clients, SQL, dashboard tooling, or deployed functions.

| Data/action | Directly deleted | Related objects/rows | Follow-up / retention |
| --- | --- | --- | --- |
| Marketplace listing (`resident-marketplace-console`, `resident-marketplace`) | Linked `SSP_Document` rows, then `SSP_Market_Place` listing | Attempts to remove linked files from `society-documents` storage before deleting document rows | Storage removal failure is logged and processing may continue, so orphaned files may need cleanup. Some creation rollback paths delete a listing only. |
| Marketplace listing images | Selected linked `SSP_Document` rows | Attempts to remove selected storage objects | A storage deletion error is logged as a warning; check for orphaned files. Minimum-image rules may block the delete. |
| Society documents (`crud-document`, `crud-resident-document`) | Document metadata row | Attempts to remove corresponding storage object | Inspect the function result/logs; storage failures may be warnings and may leave an orphaned object. Related payment/member records are not implicitly removed. |
| Complaint/staff complaint images (`staff-complaint-images`, `staff-complaint-workflow`) | Image/document metadata row | Attempts to remove the storage file | Storage deletion can fail separately; verify bucket contents if complete erasure is required. Complaint records are retained. |
| Society block / tower / flat type (`crud-block`, `crud-tower`, `crud-flat-type`) | Selected configuration row | No explicit child cleanup in the delete handler | A database constraint may reject deletion or database cascade behavior may apply; repository migrations do not define/verify these foreign keys. Flat types also support deactivation, which retains the row. |
| Vendor management DELETE (`vendor-management`) | `SSP_Non_Society_User` row for that society | No explicit cleanup is visible in these handlers | Review linked files and references; FK effects are not verified. This route physically deletes, unlike member archival. |
| Resident facility cancellation (`resident-facility-booking`) | All cancellations retain booking requests, confirmed bookings and payment records marked `cancelled`, including unpaid bookings without uploaded proof. | Cancelled statuses release the slot. Receipt documents remain linked. Abort remains restricted to unpaid bookings without submitted proof. | No refund is issued. Verification: artifacts/facility-cancellation-retain-all. |
| Resident wishlist | Matching wishlist row | No explicit related cleanup | Only the selected wishlist row is removed. |
| Servant/family/complaint assignment and other CRUD flows | Specific selected rows (for example, family delete removes device/service links before the member) | Varies by handler | Review that function’s delete branch for exact child rows; no global cascade policy is established here. |
| FCM token cleanup (`cleanup-fcm-tokens`) | Stale `SSP_User_Device` rows that satisfy its cleanup filters | No other user or profile rows | This is scheduled/maintenance cleanup, not member deletion. |

### Data and files to check when complete erasure is required

Before permanently removing a person, vendor, or entity, inventory references by its primary key and storage paths. Depending on the target, inspect:

- `SSP_Society_User`, `SSP_Non_Society_User`, and linked `SSP_Contact` rows.
- Visitor host/approver links, bookings and booking requests, payment records, complaints and assignments, documents, notifications/alerts, device tokens, servant links, marketplace listings, and audit/history data.
- Objects in Supabase Storage buckets referenced by `SSP_Document.s3_path` or payment/image URL columns. Deleting a database row does not itself prove that its storage object was removed.
- External systems (for example payment provider records, push notification providers, or logs) where applicable; these are not removed by the database delete functions reviewed here.

Do not remove shared contacts or shared history solely because one member was archived. Confirm ownership and all references first. For legal or privacy erasure, define retention requirements and use an audited, transactional cleanup procedure with a recoverable backup and explicit scope.

## Deletion test coverage and how to run it

### Local automated deletion test (run)

Command:

```sh
node supabase/tests/delete-member-history.mjs
```

Result for this review: **passed**. It exercises the `delete-members` handler with in-memory tables and verifies that a society member is archived, status is disabled, OTP is cleared, linked visitor/contact/payment/complaint history is unchanged, retries preserve the original deletion timestamp, non-admin/cross-society/mismatched-type requests are rejected, and missing-member/database-error paths are handled. It also makes an unexpected physical delete fail the test.

This is a mocked unit test, not a database-wide proof. It does not cover every table or every delete handler listed above.

### Live integration test (not run in this review)

`python3 supabase/tests/live-member-deletion.py` creates a temporary contact, member, and visitor in a configured Supabase project, calls live OTP/member endpoints, verifies preserved visitor history and disabled login, and then attempts cleanup in `finally`. It writes a report under `artifacts/member-deletion/`.

Run this only against an explicitly designated test project with valid test credentials and after confirming that the fixture society is safe for test data. It changes live database state during the test. It covers the member archive path only; it is not a test of every table's cascade/delete behavior.

### Full data/cascade verification still needed

The repository does not contain a complete schema dump or migration history defining all foreign keys. To verify every table, inspect the deployed catalog (foreign keys, triggers, RLS and storage buckets), then build isolated-database tests for each delete handler and assert both row counts and storage object absence. Never run broad deletion tests against production data.

Unpaid facility booking requests are now created and stored with status `cancelled` and do not hold a slot. The payment remains `unpaid` until proof submission or explicit cancellation. Valid receipt upload can submit an unpaid booking for approval; explicitly cancelled payments stay cancelled. Existing unpaid pending requests were corrected on 2026-11-19.
