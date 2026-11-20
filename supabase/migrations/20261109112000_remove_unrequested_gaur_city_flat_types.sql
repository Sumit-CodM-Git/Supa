-- Undo only the unused configured entries created during dropdown diagnosis.
-- The global flat-type picklist remains available for the admin Add Flat flow.
DELETE FROM public."SSP_Flat_Type" f
WHERE f.society='74628c82-7e11-4f5a-952a-d062193b3fb9'
  AND f.flat_type_id IN (
    '36197af4-392e-411b-9846-04cd601ef45e','74bd9531-e9b3-4b01-bceb-dfa72a3b174a',
    '0b9fd840-dad5-4052-8b64-531e7425c7c3','fcfc2b45-ca36-4069-b24a-ae0f0569cead',
    'bbab6f4d-d2cb-40f5-8db1-496245b8dee3','4da50112-f36a-4f35-9fd0-c9c6fb088682',
    'a110b4bf-2cad-44bc-a43c-a71defcb7266','d2cf74ff-5604-4caf-9ccd-6c9595121ae3',
    'bdd24026-40d1-46ee-b6ea-829f59aeb072','57abeebb-eaef-41ca-a5b1-05b81e49cbe9'
  )
  AND f.maintenance_charges IS NULL
  AND NOT EXISTS (SELECT 1 FROM public."SSP_Society_User" u WHERE u.flat_type_id=f.flat_type_id)
RETURNING flat_type;
