# Society configuration for app filters

`POST /functions/v1/get-picklists`

```json
{
  "societyRegistrationNumber": "GZB-1234-ab",
  "requesterId": "LOGGED-IN-SOCIETY-USER-ID",
  "scope": ["SSP_Society_User", "SSP_Flat_Type"]
}
```

Active residents, admins, and security users receive the same configured values
for their society. Admin-only settings remain in `get-society-settings`.

Use `societyConfiguration.towers`, `.blocks`, and `.flatTypes` as the common
filter source on every screen. These arrays are included even for a scoped
request such as `scope: ["SSP_Contact"]`. Towers expose `towerId`, `name`, and
`blockId`; blocks expose `blockId`, `blockName`, and `towerId`; flat types expose
`flatTypeId` and `flatType`. Use the parent IDs for dependent dropdowns.

Existing metadata clients can continue using `picklistsByTable.SSP_Society`:

| Field | Option value |
| --- | --- |
| `tower` | Tower UUID |
| `block` | Block UUID |
| `tower_name` | Tower name |
| `block_name` | Block name |
| `flat_type` | Configured flat-type value |
| `flat_type_id` | Flat-type UUID |

Corresponding configured options are also supplied for scoped
`SSP_Society_User`, `SSP_Tower`, `SSP_Block`, and `SSP_Flat_Type` metadata.
`flatTypeCatalog` preserves global choices for configuring a *new* flat type;
it is not the source for society filters.

## Refresh behavior

- Fetch when opening filters and refresh after configuration edits, society
  switches, or returning to a screen with cached state.
- Key client caches by society, language, and scope. Never reuse a global list
  or derive options only from currently occupied flats or filtered results.
- Responses use `Cache-Control: private, no-cache, must-revalidate`.
- Send the returned `ETag` in `If-None-Match`. HTTP 304 means retain the previous
  response; HTTP 200 means replace it, including arrays that are now empty.
- `configurationVersion` is shared with `get-society-settings` and changes when
  configured names, IDs, or parent relationships change.

Validation: `node supabase/tests/society-configuration.mjs`.
Live role/edit checks: `supabase/tests/live-society-configuration.py` (creates
and cleans up temporary tower/block records).

## Add New Member and parent assignments

Populate Add New Member from this endpoint, not from `get-members`,
`search-resident`, bookings, or visitor records. Those endpoints return existing
records, so an unoccupied tower will not appear in their results.

When filtering towers by a selected block, use
`societyConfiguration.towers[].blockId`. An unassigned tower has `blockId: null`
and does not belong to any block-specific list. Configure the actual parent
block before expecting it in that block's tower dropdown.

`crud-tower` CREATE/UPDATE accepts `payload.block`, `payload.blockId`, or
`payload.blockName`. `crud-block` accepts `payload.tower`, `payload.towerId`, or
`payload.towerName`, and either `block_name` or `blockName`. IDs and names are
validated against active configuration in the same society; conflicting
references return HTTP 400. Tower and block responses retain the original
reference fields and also expose `blockId` and `towerId` respectively.
