# API documentation maintenance

Whenever a Supabase function is updated, update the corresponding API documentation in `Society Sync Pro 2.0 - APIs - Updated.xlsx` in the same task. This is the user's canonical workbook; update this exact file rather than only generating a differently named copy.

- Update every matching endpoint row in the first three worksheets. Add a row if a new function is not documented.
- Keep methods, authentication, descriptions, request headers, required/optional fields, enums, cURL, response details and review dates consistent with the actual change.
- Request Body and Response Structure cells must contain complete illustrative examples for each applicable operation, including nested objects and representative array items. Preserve the correct endpoint-specific response wrappers and non-JSON formats.
- Put comma-separated allowed values in inline `//` comments beside fields that accept multiple options. Label examples as JSONC and note that comments must be removed before sending JSON. Dynamic society-specific choices must reference their actual configuration rather than inventing fixed options.
- Preserve unrelated workbook contents and the remaining worksheets. Validate workbook integrity, cell size limits and examples after editing.
- Report workbook updates alongside function changes. Mark deployments and live verification accurately; source review alone is not a live API test.
