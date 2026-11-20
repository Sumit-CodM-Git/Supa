# Profile images

New, isolated profile-image storage for existing application identities. No existing
`SSP_Document` records, visitor capture photos, servant images, or payment uploads
are changed or migrated.

## Identity and permissions

| ownerType | ownerId | Who may upload |
| --- | --- | --- |
| `society_user` | `SSP_Society_User.user_id` | Self or an admin in the same society |
| `non_society_user` | `SSP_Non_Society_User.non_society_user_id` | Self or a same-society admin; security may manage visitors |
| `servant` | `SSP_Servant.servant_id` | Self, same-society admin or security |
| `society_staff` | `SSP_Society_Staff.staff_id` | Self or same-society admin |

Admin, resident, security and service-agent roles on one society-user identity share
one profile image. Use canonical UUIDs, not phone numbers, contact IDs or custom vendor IDs.
Authenticated users may fetch profile avatars within their own society. Cross-society
batch entries return a null URL. Missing avatars also return null.

## API

`POST /functions/v1/profile-images`, `Authorization: Bearer <JWT>`, JSON body.

1. `PREPARE_UPLOAD`: send `ownerType`, `ownerId`, `fileName`, `fileType` and optional
   integer `fileSize`. Supported types: `image/jpeg`, `image/png`, `image/webp`; maximum
   size: 5 MiB. The response contains `data.upload.uploadUrl`, `objectKey`, method `PUT`
   and the required `Content-Type` header. No profile metadata is saved yet.
2. PUT the raw file bytes to that exact signed URL. Do not send JSON, a local path or
   a multipart wrapper to the signed upload URL.
3. `CONFIRM_UPLOAD`: send the same owner, `fileName`, and returned `objectKey`.
   The backend verifies the object's existence, size, MIME and image signature before
   saving the profile reference. Missing uploads return HTTP 409. Only confirmed
   uploads replace the current avatar. Confirmation retries are idempotent.
4. `FETCH`: send `owners: [{ownerType, ownerId}, ...]` (1–50 entries), or one
   `ownerType`/`ownerId` pair. Read `data.images[].profileImageUrl`.

The private `profile-images` bucket stores immutable keys:

```text
<society UUID>/<ownerType>/<owner UUID>/<random UUID>.<jpg|png|webp>
```

`SSP_Profile_Image` stores the current key and validated ownership links. Signed
display URLs expire after 900 seconds; refresh through the API rather than storing
the signed URL as a permanent value. Previous objects are retained so concurrent
replacements and existing signed URLs do not break; retention cleanup is separate.

## Existing API integration

Existing requests and responses are unchanged by default. Explicitly opt in:

| Endpoint | Request | Returned field |
| --- | --- | --- |
| `get-profile` | JSON `includeProfileImage: true` | Root `profileImageUrl` |
| `get-dashboard` | GET query `includeProfileImage=true` | `data.user.profileImageUrl` |
| `resident-profile-console` | JSON flag on `FETCH_ONE` / `FETCH_ALL` | `data.profiles[].profileImageUrl` / `data.residents[].profileImageUrl` |
| `get-members` | JSON `includeProfileImage: true` | `data.members[].profileImageUrl` |
| `vendor-management` | JSON flag on `FETCH` | `data.vendors[].profileImageUrl` |

For servant, visitor and separate staff cards, use the batch `FETCH` API. Existing
`imageUrl` values keep their original meaning (for example, a captured visitor photo).
The Flutter app must request these fields and display the download URL with its normal
avatar placeholder/error fallback. No Flutter source project is present in this repository.

## Rollout and validation

Apply `20261116120000_profile_images.sql`, deploy `profile-images`, then deploy only
the five updated readers. The profile read enrichment fails soft if the new store is
temporarily unavailable; it never prevents existing profile data from loading.

Local checks:

```sh
node supabase/tests/profile-images.mjs
node supabase/tests/profile-image-readers.mjs
node supabase/tests/resident-legacy-compatibility.mjs
node supabase/tests/parking-consistency.mjs
```

The migration was also tested with local PostgreSQL/PGlite using
`artifacts/profile-images/check-migration-local.mjs`. No production migration, upload
or deployment is implied by these local tests. The canonical API workbook contains
complete request and response examples.
