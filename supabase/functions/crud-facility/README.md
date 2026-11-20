Facility images support up to five document records per facility, including uploads not yet completed.

Existing `payload.fileName`, `payload.fileType`, and `payload.fileSize` requests still work. Each upload appends an image rather than replacing previous images. The response retains `uploadUrl`, `documentId`, and the first `imageUrl`.

For a batch, supply `payload.images` instead of the legacy file fields:

```json
{
  "registrationNumber": "GZB-1234-ab",
  "adminPhone": "<admin phone>",
  "action": "UPDATE",
  "id": "<facility UUID>",
  "payload": {
    "images": [
      { "fileName": "court-front.jpg", "fileType": "image/jpeg", "fileSize": 120000 },
      { "fileName": "court-side.jpg", "fileType": "image/jpeg", "fileSize": 110000 }
    ]
  }
}
```

The response adds `data.uploads`, containing one `{uploadUrl, documentId}` per file. The client must upload each file to its corresponding signed upload URL. Facility records include `images` (URL strings) and `imageDocuments` (`{documentId, imageUrl}` objects).

To remove specific images, submit `payload.deleteImageIds: ["<document UUID>"]`. This can be combined with new uploads. The existing `payload.deleteImage: true` option still removes all images.

The database trigger rejects a sixth linked document, including concurrent inserts. API preflight checks also reject an oversized update before changing facility fields. Abandoned upload records occupy a slot until explicitly removed.
