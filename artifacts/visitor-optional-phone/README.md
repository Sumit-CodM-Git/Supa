# Optional phone for non-Premium walk-in visitors

Current replacement for the broader visitor rule deployed earlier on 2026-11-17.

Security REQUEST_APPROVAL in visitor-pass-operations and security-gate-console accepts omitted, null or blank phone for non-Premium walk-in visitor role. Stored phone is null and is_otp_verified stays false. Premium residents, vendor roles and pre-approved visitors keep phone requirements. Optional supplied phone keeps existing visibility.

The replacement migration restores verified-only pre-approved arrival and check-in/out notification behavior. Only non-Premium walk-in approval requests receive the OTP exception needed to complete this flow. Earlier applied migration remains historical and is superseded rather than deleted.

Deployed: security-gate-console v37, visitor-pass-operations v42, send-notification v37. Existing verify_jwt=false settings preserved. Migration 20261117160000 applied and recorded in live migration history.

Validation: both guard handlers tested locally with all four plans and missing/null/blank phone; vendor and billing-failure checks preserved. Live FREE/PREMIUM rollback-only database checks verified phone-less creation, resident approval notification creation, deduplication, phone reset and pre-approved OTP preservation. Notification HTTP smoke passed. Postman collection subsequently executed against both live guard APIs through Newman: 16 requests and 37 assertions passed; eight phone-less and two supplied-phone visitors verified in the database, then all ten test visitors and their notifications removed. Postman CLI required sign-in; the same collection ran through Newman. No real device push delivery test. Live SQL fixtures were rolled back.

Canonical API workbook updated in place; every matching row in its first three sheets updated, with JSONC examples and endpoint-specific response wrappers. Unrelated cells and remaining worksheet ZIP parts preserved.
