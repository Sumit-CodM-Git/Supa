# Service agent complaint totals

`POST /functions/v1/staff-complaints` with a normal authenticated `FETCH` request returns `data.statusCounts`:

```json
{
  "assigned": 12,
  "inProgress": 4,
  "resolved": 25
}
```

These illustrative values are database totals for the validated staff member across all their complaints. Counts do not depend on `page`, `limit`, `status`, search, complaint type, priority, or date filters. Vendors receive totals for their own assignments as well.

Use these three fields for the summary cards; do not count or accumulate the paginated `data.complaints` array. `data.pagination.total` remains the number of complaints matching the selected list filters. List pagination and sorting are unchanged.

Count queries use exact database counts rather than fetching rows, so totals are not limited by the API's row limit. A failed count returns an error rather than misleading zero totals.
