export const MAX_FACILITY_IMAGES = 5;
export interface FacilityImageInput { fileName: string; fileType: string; fileSize?: number }

export function facilityImageInputs(payload: any): FacilityImageInput[] {
  if (!payload) return [];
  const legacy = !!payload.fileName || !!payload.fileType;
  if (legacy && payload.images !== undefined) throw new Error("Use images or fileName/fileType, not both.");
  const files = payload.images !== undefined ? payload.images : legacy ? [payload] : [];
  if (!Array.isArray(files)) throw new Error("images must be an array.");
  if (files.length > MAX_FACILITY_IMAGES) throw new Error("A facility can have a maximum of 5 images.");
  return files.map((file: any) => {
    if (typeof file?.fileName !== "string" || !file.fileName.trim() ||
        typeof file?.fileType !== "string" || !file.fileType.trim()) {
      throw new Error("Each image requires fileName and fileType.");
    }
    return { fileName: file.fileName.trim(), fileType: file.fileType.trim(), fileSize: file.fileSize };
  });
}

export async function createFacilityImageUploads(
  client: any, facilityId: string, societyId: string, registration: string,
  files: FacilityImageInput[],
): Promise<{ uploadUrl: string; documentId: string }[]> {
  if (!files.length) return [];
  const { count, error: countError } = await client.from("SSP_Document")
    .select("document_id", { count: "exact", head: true }).eq("facility", facilityId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) + files.length > MAX_FACILITY_IMAGES) {
    throw new Error("A facility can have a maximum of 5 images. Remove an existing image before adding another.");
  }
  const prepared = await Promise.all(files.map(async file => {
    const name = file.fileName.replace(/[\\/\s]+/g, "_");
    const key = `${registration}/facilities/${facilityId}/${crypto.randomUUID()}_${name}`;
    const { data, error } = await client.storage.from("society-documents").createSignedUploadUrl(key);
    if (error || !data?.signedUrl) throw new Error(`Signed URL creation failed: ${error?.message ?? "No URL returned"}`);
    const { data: url } = client.storage.from("society-documents").getPublicUrl(key);
    return { uploadUrl: data.signedUrl, document: {
      name: file.fileName, file_name: key, file_type: file.fileType,
      file_size: file.fileSize != null ? Number(file.fileSize) : null,
      document_type: "facility_attachment", s3_path: url.publicUrl,
      society: societyId, facility: facilityId, uploaded_on: new Date().toISOString(),
    } };
  }));
  // One insert reserves the whole batch; the database also enforces the cap under concurrency.
  const { data: documents, error } = await client.from("SSP_Document")
    .insert(prepared.map(file => file.document)).select("document_id,file_name");
  if (error) throw new Error(error.message);
  return prepared.map(file => {
    const document = documents?.find((row: any) => row.file_name === file.document.file_name);
    if (!document) throw new Error("Image document registration returned no matching record.");
    return { uploadUrl: file.uploadUrl, documentId: document.document_id };
  });
}
