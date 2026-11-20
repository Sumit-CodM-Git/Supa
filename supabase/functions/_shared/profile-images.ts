export const PROFILE_BUCKET = "profile-images";
export const PROFILE_IMAGE_TTL = 900;
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_OWNERS = {
  society_user: { table: "SSP_Society_User", id: "user_id", society: "society" },
  non_society_user: { table: "SSP_Non_Society_User", id: "non_society_user_id", society: "society" },
  servant: { table: "SSP_Servant", id: "servant_id", society: "society" },
  society_staff: { table: "SSP_Society_Staff", id: "staff_id", society: "society_id" },
} as const;
export type ProfileOwnerType = keyof typeof PROFILE_OWNERS;
export interface ProfileOwner { ownerType: ProfileOwnerType; ownerId: string }
export class ProfileImageError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const extensions: Record<string,string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export function profileOwner(input: any): ProfileOwner {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_OWNERS,input?.ownerType) ||
      typeof input?.ownerId !== "string" || !uuid.test(input.ownerId)) {
    throw new ProfileImageError("Valid ownerType and ownerId UUID are required.");
  }
  return { ownerType: input.ownerType, ownerId: input.ownerId.toLowerCase() };
}
export function profileOwnerKey(owner: ProfileOwner): string { return `${owner.ownerType}:${owner.ownerId}`; }
function fileName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length>255 || /[\\/\x00-\x1f]/.test(value)) {
    throw new ProfileImageError("fileName must be a filename of 1–255 characters without folder separators.");
  }
  return value.trim();
}
function prefix(society: string, owner: ProfileOwner): string { return `${society}/${owner.ownerType}/${owner.ownerId}/`; }

export async function profileImageUrls(client: any, society: string | null | undefined,
  owners: ProfileOwner[], tolerateErrors = true): Promise<Map<string,string>> {
  const urls = new Map<string,string>();
  owners = owners.filter(o=>typeof o.ownerId === "string" && uuid.test(o.ownerId));
  if (!society || !owners.length) return urls;
  try {
    const requested = new Set(owners.map(profileOwnerKey));
    const { data, error } = await client.from("SSP_Profile_Image")
      .select("owner_type,owner_id,object_key").eq("society",society)
      .in("owner_type",[...new Set(owners.map(o=>o.ownerType))])
      .in("owner_id",[...new Set(owners.map(o=>o.ownerId))]);
    if (error) throw error;
    let rows = (data ?? []).filter((row: any) => requested.has(`${row.owner_type}:${row.owner_id}`) &&
      typeof row.object_key === "string" && row.object_key.startsWith(prefix(society,{ownerType:row.owner_type,ownerId:row.owner_id})));
    if (!rows.length) return urls;
    // Recheck current ownership: a person may have moved society or been soft-deleted
    // since their avatar was saved. Batch by identity type rather than per image.
    const visible = new Set<string>();
    for (const type of Object.keys(PROFILE_OWNERS) as ProfileOwnerType[]) {
      const ids = rows.filter((r:any)=>r.owner_type===type).map((r:any)=>r.owner_id);
      if (!ids.length) continue;
      const descriptor = PROFILE_OWNERS[type];
      const {data: ownersNow,error: ownerError} = await client.from(descriptor.table)
        .select("*").eq(descriptor.society,society).in(descriptor.id,ids);
      if (ownerError) throw ownerError;
      for (const ownerNow of ownersNow ?? []) {
        if (!ownerNow.deleted_at) visible.add(`${type}:${ownerNow[descriptor.id]}`);
      }
    }
    rows = rows.filter((row:any)=>visible.has(`${row.owner_type}:${row.owner_id}`));
    if (!rows.length) return urls;
    const { data: signed, error: signError } = await client.storage.from(PROFILE_BUCKET)
      .createSignedUrls([...new Set(rows.map((r:any)=>r.object_key))],PROFILE_IMAGE_TTL);
    if (signError) throw signError;
    const byPath = new Map((signed ?? []).filter((s:any)=>!s.error && s.signedUrl).map((s:any)=>[s.path,s.signedUrl]));
    for (const row of rows) {
      const url = byPath.get(row.object_key);
      if (typeof url === "string") urls.set(`${row.owner_type}:${row.owner_id}`,url);
    }
  } catch {
    if (!tolerateErrors) throw new ProfileImageError("Unable to fetch profile images.",503);
    console.warn("Optional profile images unavailable; existing profile data is preserved.");
  }
  return urls;
}
export async function profileImageUrl(client: any, society: string | null | undefined,
  ownerType: ProfileOwnerType, ownerId: string): Promise<string|null> {
  const owner = {ownerType,ownerId};
  return (await profileImageUrls(client,society,[owner])).get(profileOwnerKey(owner)) ?? null;
}

async function actorContext(client: any, actorId: string) {
  for (const [kind,descriptor] of Object.entries(PROFILE_OWNERS)) {
    const {data,error} = await client.from(descriptor.table).select("*").eq(descriptor.id,actorId).maybeSingle();
    if (error) throw new ProfileImageError("Unable to verify image permissions.",503);
    if (data) {
      if (data.deleted_at || data.status === false) throw new ProfileImageError("Account is inactive.",403);
      const roles = (Array.isArray(data.role) ? data.role : [data.role ?? data.staff_role ?? kind])
        .map((r:any)=>String(r).replace(/[\s_-]/g,"").toLowerCase());
      return {id:actorId,kind,society:data[descriptor.society] as string,roles};
    }
  }
  throw new ProfileImageError("Authenticated application user not found.",403);
}
export async function authorizedProfileImageUrls(client:any,actorId:string,society:string,
  owners:ProfileOwner[]):Promise<Map<string,string>> {
  try {
    const actor=await actorContext(client,actorId);
    if(actor.society!==society)return new Map();
    return await profileImageUrls(client,society,owners);
  } catch {
    console.warn("Optional profile image permissions unavailable; existing profile data is preserved.");
    return new Map();
  }
}
async function authorizeWrite(client:any, actor:Awaited<ReturnType<typeof actorContext>>, owner:ProfileOwner) {
  const descriptor=PROFILE_OWNERS[owner.ownerType];
  const {data,error}=await client.from(descriptor.table).select("*").eq(descriptor.id,owner.ownerId).maybeSingle();
  if(error)throw new ProfileImageError("Unable to verify profile owner.",503);
  if(!data || data.deleted_at)throw new ProfileImageError("Profile owner not found.",404);
  if(!actor.society || data[descriptor.society]!==actor.society)throw new ProfileImageError("Profile owner belongs to a different society.",403);
  const self=actor.kind===owner.ownerType && actor.id===owner.ownerId;
  const admin=actor.kind==="society_user" && actor.roles.some((r:string)=>["admin","societyadmin"].includes(r));
  const security=actor.kind==="society_user" && actor.roles.includes("security") &&
    (owner.ownerType==="servant" || (owner.ownerType==="non_society_user" && String(data.role).toLowerCase()==="visitor"));
  if(!self && !admin && !security)throw new ProfileImageError("You cannot change this profile image.",403);
  return data;
}
function imageSignature(bytes:Uint8Array,mime:string):boolean {
  if(mime==="image/jpeg")return bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if(mime==="image/png")return bytes.length>=8 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  return mime==="image/webp" && bytes.length>=12 && new TextDecoder().decode(bytes.slice(0,4))==="RIFF" && new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
}
export async function handleProfileImages(req:Request,actorId:string,client:any):Promise<Response> {
  const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};
  const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(req.method!=="POST")return reply({success:false,error:"ERROR",message:"Only POST method is allowed."},405);
  try {
    let body:any;
    try {body=await req.json();} catch {throw new ProfileImageError("Invalid JSON request body.");}
    if(!body || typeof body!=="object" || Array.isArray(body))throw new ProfileImageError("A JSON object is required.");
    if(!["PREPARE_UPLOAD","CONFIRM_UPLOAD","FETCH"].includes(body.action))throw new ProfileImageError("action must be PREPARE_UPLOAD, CONFIRM_UPLOAD, or FETCH.");
    const actor=await actorContext(client,actorId);
    if(!actor.society)throw new ProfileImageError("Account society is not configured.",403);
    if(body.action==="FETCH") {
      const inputs=body.owners ?? [body];
      if(!Array.isArray(inputs) || inputs.length<1 || inputs.length>50)throw new ProfileImageError("Provide 1–50 owners.");
      const owners=inputs.map(profileOwner);
      const urls=await profileImageUrls(client,actor.society,owners,false);
      return reply({success:true,data:{images:owners.map(o=>({...o,profileImageUrl:urls.get(profileOwnerKey(o))??null})),expiresIn:PROFILE_IMAGE_TTL}});
    }
    const owner=profileOwner(body);
    const ownerRecord=await authorizeWrite(client,actor,owner);
    fileName(body.fileName);
    const imageId=typeof ownerRecord.contact==="string" && uuid.test(ownerRecord.contact)
      ? ownerRecord.contact.toLowerCase() : owner.ownerId;
    const storedName=(extension:string)=>`${imageId}_profileImage.${extension}`;
    if(body.action==="PREPARE_UPLOAD") {
      if(!Object.prototype.hasOwnProperty.call(extensions,body.fileType))throw new ProfileImageError("fileType must be image/jpeg, image/png, or image/webp.");
      if(body.fileSize!=null && (!Number.isInteger(body.fileSize) || body.fileSize<1 || body.fileSize>PROFILE_IMAGE_MAX_BYTES))throw new ProfileImageError("fileSize must be between 1 and 5242880 bytes.");
      const objectKey=prefix(actor.society,owner)+crypto.randomUUID()+"/"+storedName(extensions[body.fileType]);
      const {data,error}=await client.storage.from(PROFILE_BUCKET).createSignedUploadUrl(objectKey);
      if(error || !data?.signedUrl)throw new ProfileImageError("Unable to prepare image upload.",503);
      return reply({success:true,data:{...owner,uploadStatus:"pending_upload",upload:{bucket:PROFILE_BUCKET,objectKey,uploadUrl:data.signedUrl,method:"PUT",headers:{"Content-Type":body.fileType}}}});
    }
    const objectKey=body.objectKey;
    const expected=prefix(actor.society,owner);
    const relativeKey=typeof objectKey==="string" && objectKey.startsWith(expected)
      ? objectKey.slice(expected.length) : "";
    const parts=relativeKey.split("/");
    // Accept legacy UUID filenames for uploads prepared before this rollout.
    const legacy=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(relativeKey);
    const named=parts.length===2 && uuid.test(parts[0]) &&
      ["jpg","png","webp"].some(ext=>parts[1]===storedName(ext));
    if(!legacy && !named)throw new ProfileImageError("objectKey does not belong to this profile.");
    const slash=objectKey.lastIndexOf("/");
    const storage=client.storage.from(PROFILE_BUCKET);
    const {data:files,error:listError}=await storage.list(objectKey.slice(0,slash),{search:objectKey.slice(slash+1),limit:100});
    if(listError)throw new ProfileImageError("Unable to verify image upload.",503);
    const object=(files??[]).find((f:any)=>f.name===objectKey.slice(slash+1) && f.id);
    if(!object)throw new ProfileImageError("Upload the image before confirming.",409);
    const size=Number(object.metadata?.size),mime=object.metadata?.mimetype;
    if(!Number.isInteger(size) || size<1 || size>PROFILE_IMAGE_MAX_BYTES || !Object.prototype.hasOwnProperty.call(extensions,mime) || !objectKey.endsWith("."+extensions[mime]))throw new ProfileImageError("Uploaded file must be a JPEG, PNG, or WebP image of at most 5 MB.");
    const {data:blob,error:downloadError}=await storage.download(objectKey);
    if(downloadError || !blob)throw new ProfileImageError("Unable to read uploaded image.",503);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length!==size || !imageSignature(bytes,mime))throw new ProfileImageError("Uploaded file does not have a valid image signature.");
    const {data:signed,error:signError}=await storage.createSignedUrl(objectKey,PROFILE_IMAGE_TTL);
    if(signError || !signed?.signedUrl)throw new ProfileImageError("Unable to prepare image display URL.",503);
    const name=storedName(extensions[mime]);
    const {data:saved,error:saveError}=await client.rpc("replace_profile_image",{p_image:{
      owner_type:owner.ownerType,owner_id:owner.ownerId,society:actor.society,object_key:objectKey,
      file_name:name,file_type:mime,file_size:size,uploaded_by:actorId,
    }});
    if(saveError?.code==="22023")throw new ProfileImageError(saveError.message,409);
    if(saveError || !saved)throw new ProfileImageError("Unable to save profile image.",503);
    const cleanupKeys=(saved.cleanup_keys??[]).filter((key:unknown):key is string=>
      typeof key==="string" && key!==objectKey);
    if(cleanupKeys.length) {
      const {error:removeError}=await storage.remove(cleanupKeys);
      if(removeError)throw new ProfileImageError("New image saved, but the previous image could not be deleted. Retry CONFIRM_UPLOAD with the same objectKey.",503);
      const {error:cleanupError}=await client.from("SSP_Profile_Image_Cleanup").delete()
        .eq("owner_type",owner.ownerType).eq("owner_id",owner.ownerId).in("object_key",cleanupKeys);
      if(cleanupError)throw new ProfileImageError("New image saved, but cleanup could not be completed. Retry CONFIRM_UPLOAD with the same objectKey.",503);
    }
    return reply({success:true,data:{...owner,uploadStatus:"uploaded",profileImageUrl:signed.signedUrl,expiresIn:PROFILE_IMAGE_TTL,
      image:{bucket:PROFILE_BUCKET,objectKey,fileName:name,fileType:mime,fileSize:size,updatedAt:saved.updated_at}}});
  } catch(error) {
    if(error instanceof ProfileImageError)return reply({success:false,error:"ERROR",message:error.message},error.status);
    console.error("Profile image operation failed.");
    return reply({success:false,error:"ERROR",message:"Unable to process profile image."},500);
  }
}
