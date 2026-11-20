# Live Postman collection test

Result: 16 requests, 37 assertions passed on 2026-11-17. Both deployed guard APIs accepted omitted/null/empty/blank phone for a FREE resident without OTP; optional supplied phones were preserved. PREMIUM missing-phone, vendor missing-phone and missing-name cases returned HTTP 400.

Postman CLI was installed but required account login. The same Postman v2.1 collection ran locally through Newman without cloud reporting. The initial run reused one optional phone across endpoints and correctly encountered existing duplicate-visitor protection; its fixtures were removed, then the final collection used distinct numbers and passed. No API code was changed during testing.

The final run created ten test visitors, verified eight stored null phones and OTP verification false for all ten, then removed all test visitors and their notifications. The test resident had no active push devices. No real device push delivery was tested.

Import visitor-optional-phone.postman_collection.json and environment.template.postman_environment.json into Postman to review or repeat. Fill the environment with a valid security token and same-society resident/guard IDs. Successful creation requests create real visitors; clean them up after running. Use distinct synthetic optional phone numbers for the two endpoints.

result.json is the concise final result; run.json contains redacted request/response details and assertion results. No login token is saved in the collection or environment template. run-live.py obtains credentials in memory, runs Newman, and performs cleanup automatically.
