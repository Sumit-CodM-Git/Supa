-- Named OTP drafts need the same concurrency protection as unnamed drafts.
-- Replacing this index is transactional: existing duplicate drafts cause the
-- migration to fail rather than silently choosing or deleting a visitor.
BEGIN;
DROP INDEX IF EXISTS public.ssp_visitor_otp_draft_unique;
CREATE UNIQUE INDEX ssp_visitor_otp_draft_unique
ON public."SSP_Non_Society_User" (hosted_by, phone_number)
WHERE role = 'visitor' AND visitor_status = 'otp_pending';
COMMIT;
