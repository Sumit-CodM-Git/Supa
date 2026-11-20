-- Only unfinished OTP drafts are unique; separate completed visits remain separate records.
CREATE UNIQUE INDEX IF NOT EXISTS ssp_visitor_otp_draft_unique
ON public."SSP_Non_Society_User" (hosted_by,phone_number)
WHERE role='visitor' AND name='Unknown Visitor' AND visitor_status='otp_pending';
