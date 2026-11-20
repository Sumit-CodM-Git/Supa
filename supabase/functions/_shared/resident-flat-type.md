# Resident flat-type fields

Resident create/update requests accept either `flatTypeId` (society configuration UUID) or `flatType` (configured display name). When both are supplied they must identify the same active flat type in the resident's society.

| Endpoint | Request field location | Response field location |
| --- | --- | --- |
| add-members | memberData[] | data.memberCreated[] |
| update-member | updatedData | data.updatedMember.updatedData |
| crud-family | Top level for CREATE/UPDATE | data.familyUpdate or data.familyMembers[] |
| resident-profile-console | Top level for UPDATE | profileUpdate, residents[], or profile.residentialInformation inside the existing response wrapper |
| update-residents-profile | Top level for UPDATE | profileUpdate or data.residents[] |
| get-residents-profile | Read only | profile.residentialInformation inside the existing response wrapper |
| get-members | Read only | data.members[] |
| search-resident | Read only | Each returned resident |
| get-profile | Read only | societyUser |
| delete-members | Existing memberId only | data.deletedMember (society members) |

Both response fields are nullable: `{"flatTypeId":"<UUID>","flatType":"2 BHK"}`. Profile endpoints place them beside the existing flat number in residentialInformation.

Omitting both request fields preserves the assignment on update. Explicit null or empty text clears it. New family members inherit the primary resident's assignment when both fields are omitted. Existing permissions apply; family assignment updates require the primary resident, and resident-profile-console treats these as staff-only fields.

Use active entries in societyConfiguration.flatTypes to populate choices. Global flatTypeCatalog entries alone do not identify a society assignment. Deleting a society flat type clears its assignments, so subsequent resident reads return null for both fields.
