BEGIN;
DO $$
DECLARE v_request uuid := 'ea64a69b-3b37-4ceb-8ddc-a8a3d50cf4d7';
v_payment uuid := 'e8b22ac3-09ac-44f1-ae7c-cce9722a39c9';
v_resident uuid := '3096f2ea-dba7-46fa-9b56-00add869b034';
BEGIN
PERFORM 1 FROM public."SSP_Facility_Booking_Request" WHERE request_id=v_request AND payment=v_payment AND requested_by=v_resident AND purpose_of_visit='Sumit Test 1' AND lower(trim(status)) IN ('waiting_payment','cancelled') FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Booking changed; no update performed'; END IF;
PERFORM 1 FROM public."SSP_Payment" WHERE pay_rec_id=v_payment AND society_user=v_resident AND lower(trim(payment_status)) IN ('unpaid','cancelled') FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Payment changed; no update performed'; END IF;
UPDATE public."SSP_Facility_Booking_Request" SET status='cancelled' WHERE request_id=v_request;
UPDATE public."SSP_Facility_Booking" SET booking_status='cancelled',approval_status='cancelled',payment_status='cancelled' WHERE payment=v_payment AND requested_by=v_resident;
UPDATE public."SSP_Payment" SET payment_status='cancelled' WHERE pay_rec_id=v_payment;
END $$;
COMMIT;
SELECT r.request_id,r.purpose_of_visit,r.status AS booking_status,p.payment_status FROM public."SSP_Facility_Booking_Request" r JOIN public."SSP_Payment" p ON p.pay_rec_id=r.payment WHERE r.request_id='ea64a69b-3b37-4ceb-8ddc-a8a3d50cf4d7';
