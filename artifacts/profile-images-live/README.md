# Profile-image deployment fix — 2026-11-17

The profile-images edge function, SSP_Profile_Image table and private profile-images bucket were absent from the live project. This caused the gateway NOT_FOUND response before function code ran.

Applied migration 20261116120000_profile_images.sql and recorded it in migration history. Deployed profile-images ACTIVE v1 with gateway verify_jwt=false and the existing requireAuth middleware validating application JWTs.

Verified live: unauthenticated rejection 401; PREPARE_UPLOAD 200; confirm before bytes 409; signed binary PUT 200; CONFIRM_UPLOAD 200; FETCH 200; signed image download 200 with exact byte comparison. Confirmed metadata size and MIME. Removed the exact test storage object, temporary visitor owner and metadata. No real profile image was overwritten. Test credentials and signed URLs were held in memory and not written to artifacts.

Only the profile-images endpoint was deployed. Existing profile/dashboard/member image opt-in reader source was not deployed in this task. Flutter UI was not exercised. Canonical API workbook deployment/review status updated in place; existing complete JSONC examples and unrelated workbook contents preserved.

Evidence: verification.json, function.json; reproducible test: verify-live.py.
