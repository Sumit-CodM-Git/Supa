// // deno-lint-ignore-file no-explicit-any no-unused-vars prefer-const
// import { requireAuth } from "../_shared/auth.ts";
// import {
//   corsHeaders,
//   errorResponse,
//   successResponse,
// } from "../_shared/response.ts";
// import { parseRequestBody } from "../_shared/utils.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// // ============================================
// // TYPES
// // ============================================
// interface MemberData {
//   fullName: string;
//   phone: string;
//   idProofType: string;
//   idProofNumber: string;
//   blockId?: string;
//   towerId?: string;
//   unitFlatNumber?: string;
//   moveInDate?: string;
//   moveOutDate?: string;
//   userType?: string;
//   userOwnershipType?: string;
//   status?: string;
//   shift?: string;
//   securityGuardId?: string;
//   gateNumber?: string;
//   securityZone?: string;
//   securityGuardStatus?: string;
//   serviceAgentRating?: number;
//   agentAvailabilityStatus?: string;
//   serviceAgentServices?: string[] | string;
//   email?: string;
//   gender?: string;
//   occupation?: string;
//   whatsappPhone?: string;
//   emergencyPhone?: string;
//   vehicleType?: string;
//   vehicleRegistrationNumber?: string;
//   vendorName?: string;
//   vendorServiceType?: string;
//   vendorRating?: string;
// }

// interface AddMemberRequest {
//   registrationNumber: string;
//   memberType: string;
//   memberData: MemberData[];
// }

// // ============================================
// // PICKLIST NORMALIZER
// // ============================================

// type PicklistMap = Map<string, Set<string>>;

// function normalizeKey(input: unknown): string {
//   if (input === null || input === undefined) return "";
//   return String(input).toLowerCase().replace(/[^a-z0-9]/g, "");
// }

// async function loadPicklists(
//   supabaseAdmin: any,
//   keys: string[],
// ): Promise<PicklistMap> {
//   const map: PicklistMap = new Map();
//   for (const k of keys) map.set(k, new Set());

//   if (keys.length === 0) return map;

//   const tables = new Set<string>();
//   for (const k of keys) {
//     const [t] = k.split(".");
//     tables.add(t);
//   }

//   const { data, error } = await supabaseAdmin
//     .from("SSP_Picklist_Config")
//     .select("table_name, field_name, value")
//     .eq("is_active", true)
//     .eq("language", "en")
//     .in("table_name", Array.from(tables));

//   if (error) {
//     console.error("❌ Failed to load picklists:", error.message);
//     return map;
//   }

//   const normLookup: Map<string, Map<string, string>> = new Map();
//   for (const row of data ?? []) {
//     const key = `${row.table_name}.${row.field_name}`;
//     if (!normLookup.has(key)) normLookup.set(key, new Map());
//     normLookup.get(key)!.set(normalizeKey(row.value), row.value);
//     map.get(key)?.add(row.value);
//   }

//   (map as any).__norm = normLookup;
//   return map;
// }

// function resolvePicklistValue(
//   map: PicklistMap,
//   table: string,
//   field: string,
//   input: unknown,
//   fallbackIfInvalid: string | null = null,
// ): string | null {
//   if (input === null || input === undefined) return fallbackIfInvalid;
//   const raw = String(input).trim();
//   if (raw === "") return fallbackIfInvalid;

//   const key = `${table}.${field}`;
//   const values = map.get(key);
//   const normLookup: Map<string, string> | undefined = (map as any).__norm?.get(
//     key,
//   );

//   if (!values || values.size === 0) {
//     return raw;
//   }

//   if (values.has(raw)) return raw;

//   if (normLookup) {
//     const canon = normLookup.get(normalizeKey(raw));
//     if (canon) return canon;
//   }

//   console.warn(
//     `⚠️  add-members: value "${raw}" not in picklist for ${key}. Storing NULL.`,
//   );
//   return fallbackIfInvalid;
// }

// const PICKLIST_KEYS = [
//   "SSP_Contact.gender",
//   "SSP_Contact.id_proof_type",
//   "SSP_Contact.vehicle_type",
//   "SSP_Society_User.role",
//   "SSP_Society_User.user_type",
//   "SSP_Society_User.user_ownership_type",
//   "SSP_Society_User.shift",
//   "SSP_Society_User.security_zone",
//   "SSP_Society_User.security_guard_status",
//   "SSP_Society_User.agent_availability_status",
//   "SSP_Non_Society_User.role",
//   "SSP_Non_Society_User.gender",
//   "SSP_Non_Society_User.id_proof_type",
//   "SSP_Non_Society_User.vehicle_type",
//   "SSP_Non_Society_User.service_type",
// ];

// // ============================================
// // HELPER: ID Proof Validator
// // ============================================
// function validateIdProof(type: string, number: string): string | null {
//   if (!type || !number) {
//     return "idProofType and idProofNumber are mandatory.";
//   }

//   const cleanType = String(type).trim().toLowerCase();
//   const cleanNum = String(number).trim().toUpperCase();

//   if (
//     cleanType.includes("adhar") || cleanType.includes("aadhar") ||
//     cleanType.includes("aadhaar")
//   ) {
//     if (!/^\d{12}$/.test(cleanNum)) {
//       return "Aadhaar Card must be exactly 12 numeric digits.";
//     }
//   } else if (cleanType.includes("pan")) {
//     if (!/^[A-Z]{5}\d{4}[A-Z]{1}$/.test(cleanNum)) {
//       return "PAN Card must be 10 characters formatted as 5 letters, 4 digits, and 1 letter.";
//     }
//   } else if (cleanType.includes("dl") || cleanType.includes("driving")) {
//     if (!/^[A-Z0-9]{15}$/.test(cleanNum)) {
//       return "Driving License must be 15 alphanumeric characters.";
//     }
//   } else if (cleanType.includes("voter") || cleanType.includes("epic")) {
//     if (!/^[A-Z]{3}\d{7}$/.test(cleanNum) && !/^[A-Z0-9]{10}$/.test(cleanNum)) {
//       return "Voter ID must be 10 alphanumeric characters.";
//     }
//   } else {
//     return "Invalid ID proof type. Supported: Aadhaar, PAN, Driving License, Voter ID.";
//   }
//   return null;
// }

// // ============================================
// // HELPER: Validate Member Data
// // ============================================
// function validateMemberData(
//   memberData: MemberData[],
//   memberType: string,
// ): string | null {
//   for (let i = 0; i < memberData.length; i++) {
//     const m = memberData[i];

//     if (
//       !m.fullName || typeof m.fullName !== "string" || m.fullName.trim() === ""
//     ) {
//       return `Member [index ${i}]: 'fullName' is required.`;
//     }

//     if (!m.phone || !/^\d+$/.test(String(m.phone).trim())) {
//       return `Member [index ${i}]: 'phone' is required and must contain numeric digits only.`;
//     }

//     const idError = validateIdProof(m.idProofType || "", m.idProofNumber || "");
//     if (idError) {
//       return `Member [index ${i}]: ${idError}`;
//     }

//     if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m.email).trim())) {
//       return `Member [index ${i}]: Invalid 'email' format.`;
//     }

//     if (memberType.toLowerCase() === "vendor") {
//       if (!m.vendorName) {
//         return `Member [index ${i}]: 'vendorName' is required for vendor.`;
//       }
//       if (!m.vendorServiceType) {
//         return `Member [index ${i}]: 'vendorServiceType' is required for vendor.`;
//       }
//     }
//   }
//   return null;
// }

// // ============================================
// // HELPER: Create or Get Contact (For Non-Vendors Only)
// // ============================================
// async function createOrGetContact(
//   supabaseAdmin: any,
//   data: MemberData,
//   societyId: string,
//   existingContactMap: Map<string, any>,
//   picklists: PicklistMap,
// ): Promise<{
//   contactId: string;
//   isNew: boolean;
//   normalized: {
//     gender: string | null;
//     idProofType: string | null;
//     vehicleType: string | null;
//   };
// }> {
//   const namePhoneKey = `${data.fullName}_${data.phone}`;
//   const idProofKey = data.idProofNumber
//     ? String(data.idProofNumber).trim().toUpperCase()
//     : "";
//   const phoneOnlyKey = data.phone ? String(data.phone).trim() : "";

//   const normGender = resolvePicklistValue(
//     picklists,
//     "SSP_Contact",
//     "gender",
//     data.gender,
//   );
//   const normIdProofType = resolvePicklistValue(
//     picklists,
//     "SSP_Contact",
//     "id_proof_type",
//     data.idProofType,
//   );
//   const normVehicleType = resolvePicklistValue(
//     picklists,
//     "SSP_Contact",
//     "vehicle_type",
//     data.vehicleType,
//   );

//   const normalized = {
//     gender: normGender,
//     idProofType: normIdProofType,
//     vehicleType: normVehicleType,
//   };

//   const matchedContact = existingContactMap.get(namePhoneKey) ||
//     (idProofKey ? existingContactMap.get(idProofKey) : null) ||
//     (phoneOnlyKey ? existingContactMap.get(phoneOnlyKey) : null);

//   if (matchedContact) {
//     console.log(`📝 Updating existing contact: ${matchedContact.contact_id}`);

//     const updatePayload: any = {};
//     if (data.email) updatePayload.email = data.email;
//     if (normGender) updatePayload.gender = normGender;
//     if (data.occupation) updatePayload.occupation = data.occupation;
//     if (data.whatsappPhone) updatePayload.whatsapp_phone = data.whatsappPhone;
//     if (data.emergencyPhone) {
//       updatePayload.emergency_phone = data.emergencyPhone;
//     }
//     if (normIdProofType) updatePayload.id_proof_type = normIdProofType;
//     if (data.idProofNumber) {
//       updatePayload.id_proof_number = data.idProofNumber.trim().toUpperCase();
//     }
//     if (normVehicleType) updatePayload.vehicle_type = normVehicleType;
//     if (data.vehicleRegistrationNumber) {
//       updatePayload.vehicle_registration_number =
//         data.vehicleRegistrationNumber;
//     }
//     if (data.fullName) updatePayload.name = data.fullName;
//     if (data.phone) updatePayload.phone = data.phone;
//     updatePayload.society = societyId;

//     const { error: updateErr } = await supabaseAdmin
//       .from("SSP_Contact")
//       .update(updatePayload)
//       .eq("contact_id", matchedContact.contact_id);

//     if (updateErr) {
//       console.error("❌ Failed to update contact:", updateErr);
//       throw new Error(`Failed to update contact: ${updateErr.message}`);
//     }

//     return { contactId: matchedContact.contact_id, isNew: false, normalized };
//   }

//   const newContactPayload = {
//     name: data.fullName,
//     phone: phoneOnlyKey || null,
//     email: data.email || null,
//     gender: normGender,
//     occupation: data.occupation || null,
//     id_proof_type: normIdProofType,
//     id_proof_number: data.idProofNumber
//       ? data.idProofNumber.trim().toUpperCase()
//       : null,
//     society: societyId,
//     whatsapp_phone: data.whatsappPhone || null,
//     emergency_phone: data.emergencyPhone || null,
//     vehicle_type: normVehicleType,
//     vehicle_registration_number: data.vehicleRegistrationNumber || null,
//   };

//   const { data: insertedContact, error: insertErr } = await supabaseAdmin
//     .from("SSP_Contact")
//     .insert(newContactPayload)
//     .select("contact_id")
//     .single();

//   if (insertErr) {
//     throw new Error(`Failed to create contact: ${insertErr.message}`);
//   }

//   return { contactId: insertedContact.contact_id, isNew: true, normalized };
// }

// // ============================================
// // HELPER: Create Society User (Non-Vendor)
// // ============================================
// async function createSocietyUser(
//   supabaseAdmin: any,
//   data: MemberData,
//   contactId: string,
//   societyId: string,
//   memberType: string,
//   picklists: PicklistMap,
// ): Promise<{
//   user_id: string;
//   contact: string;
//   normalized: {
//     role: string | null;
//     userType: string | null;
//     ownershipType: string | null;
//     shift: string | null;
//     securityZone: string | null;
//     guardStatus: string | null;
//     agentStatus: string | null;
//   };
// }> {
//   const normRole = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "role",
//     memberType,
//   );
//   const normUserType = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "user_type",
//     data.userType,
//   );
//   const normOwnership = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "user_ownership_type",
//     data.userOwnershipType,
//   );
//   const normShift = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "shift",
//     data.shift,
//   );
//   const normSecurityZone = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "security_zone",
//     data.securityZone,
//   );
//   const normGuardStatus = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "security_guard_status",
//     data.securityGuardStatus,
//   );
//   const normAgentStatus = resolvePicklistValue(
//     picklists,
//     "SSP_Society_User",
//     "agent_availability_status",
//     data.agentAvailabilityStatus,
//   );

//   const junctionRecord = {
//     contact: contactId,
//     society: societyId,
//     role: normRole ? [normRole] : [memberType.toLowerCase()],
//     block: data.blockId || null,
//     tower: data.towerId || null,
//     unit_flat_number: data.unitFlatNumber
//       ? String(data.unitFlatNumber).trim()
//       : null,
//     move_in_date: data.moveInDate || null,
//     move_out_date: data.moveOutDate || null,
//     user_type: normUserType,
//     user_ownership_type: normOwnership,
//     status: String(data.status || "active").trim().toLowerCase() === "active" ||
//       String(data.status || "active").trim().toLowerCase() === "true",
//     shift: normShift,
//     security_guard_id: data.securityGuardId || null,
//     gate_number: data.gateNumber || null,
//     security_zone: normSecurityZone,
//     security_guard_status: normGuardStatus,
//     service_agent_rating: data.serviceAgentRating != null
//       ? Number(Number(data.serviceAgentRating).toFixed(2))
//       : null,
//     agent_availability_status: normAgentStatus,
//     service_agent_services: Array.isArray(data.serviceAgentServices)
//       ? data.serviceAgentServices.join(", ")
//       : data.serviceAgentServices || null,
//   };

//   const { data: insertedMember, error: insertErr } = await supabaseAdmin
//     .from("SSP_Society_User")
//     .insert(junctionRecord)
//     .select("user_id, contact")
//     .single();

//   if (insertErr) {
//     throw new Error(`Failed to create society user: ${insertErr.message}`);
//   }

//   return {
//     ...insertedMember,
//     normalized: {
//       role: normRole,
//       userType: normUserType,
//       ownershipType: normOwnership,
//       shift: normShift,
//       securityZone: normSecurityZone,
//       guardStatus: normGuardStatus,
//       agentStatus: normAgentStatus,
//     },
//   };
// }

// // ============================================
// // HELPER: Generate Vendor ID
// // ============================================
// async function generateVendorId(
//   supabaseAdmin: any,
//   societyRegistrationNumber: string,
// ): Promise<string> {
//   const { count, error } = await supabaseAdmin
//     .from("SSP_Non_Society_User")
//     .select("non_society_user_id", { count: "exact", head: true })
//     .eq("role", "vendor");

//   if (error) {
//     console.error("❌ Failed to get vendor count:", error);
//     return `VENDOR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
//   }

//   const societyCode = societyRegistrationNumber.split("-")[0] || "SOC";
//   const nextNumber = (count || 0) + 1;
//   const paddedNumber = String(nextNumber).padStart(4, "0");

//   return `VND-${societyCode}-${paddedNumber}`;
// }

// // ============================================
// // HELPER: Create Vendor User
// // ============================================
// async function createVendorUser(
//   supabaseAdmin: any,
//   data: MemberData,
//   societyId: string,
//   societyRegistrationNumber: string,
//   picklists: PicklistMap,
// ): Promise<{
//   non_society_user_id: string;
//   vendor_id: string;
//   name: string;
//   phone_number: string;
//   normalized: {
//     role: string | null;
//     idProofType: string | null;
//     vehicleType: string | null;
//     gender: string | null;
//     serviceType: string | null;
//   };
// }> {
//   const vendorId = await generateVendorId(
//     supabaseAdmin,
//     societyRegistrationNumber,
//   );

//   const { data: existingVendor, error: checkError } = await supabaseAdmin
//     .from("SSP_Non_Society_User")
//     .select("non_society_user_id")
//     .eq("society", societyId)
//     .eq("phone_number", String(data.phone).trim())
//     .maybeSingle();

//   if (checkError) throw checkError;

//   if (existingVendor) {
//     throw new Error(`Vendor with phone number ${data.phone} already exists.`);
//   }

//   if (data.email) {
//     const { data: existingEmailVendor, error: emailCheckError } =
//       await supabaseAdmin
//         .from("SSP_Non_Society_User")
//         .select("non_society_user_id")
//         .eq("society", societyId)
//         .eq("email", String(data.email).trim())
//         .maybeSingle();

//     if (emailCheckError) throw emailCheckError;

//     if (existingEmailVendor) {
//       throw new Error(`Vendor with email ${data.email} already exists.`);
//     }
//   }

//   const normRole = resolvePicklistValue(
//     picklists,
//     "SSP_Non_Society_User",
//     "role",
//     "vendor",
//   ) ?? "vendor";
//   const normIdProofType = resolvePicklistValue(
//     picklists,
//     "SSP_Non_Society_User",
//     "id_proof_type",
//     data.idProofType,
//   );
//   const normVehicleType = resolvePicklistValue(
//     picklists,
//     "SSP_Non_Society_User",
//     "vehicle_type",
//     data.vehicleType,
//   );
//   const normGender = resolvePicklistValue(
//     picklists,
//     "SSP_Non_Society_User",
//     "gender",
//     data.gender,
//   );
//   const normServiceType = resolvePicklistValue(
//     picklists,
//     "SSP_Non_Society_User",
//     "service_type",
//     data.vendorServiceType,
//   );

//   const vendorRecord = {
//     society: societyId,
//     name: data.vendorName || data.fullName,
//     phone_number: String(data.phone).trim(),
//     email: data.email || null,
//     role: normRole,
//     vendor_id: vendorId,
//     service_type: normServiceType,
//     vendor_rating: data.vendorRating || null,
//     id_proof_type: normIdProofType,
//     id_proof_number: data.idProofNumber || null,
//     gender: normGender,
//     vehicle_number: data.vehicleRegistrationNumber || null,
//     vehicle_type: normVehicleType,
//     hosted_by: null,
//     approver: null,
//     created_at: new Date().toISOString(),
//   };

//   const { data: insertedVendor, error: insertErr } = await supabaseAdmin
//     .from("SSP_Non_Society_User")
//     .insert(vendorRecord)
//     .select("non_society_user_id, vendor_id, name, phone_number")
//     .single();

//   if (insertErr) {
//     throw new Error(`Failed to create vendor: ${insertErr.message}`);
//   }

//   return {
//     ...insertedVendor,
//     normalized: {
//       role: normRole,
//       idProofType: normIdProofType,
//       vehicleType: normVehicleType,
//       gender: normGender,
//       serviceType: normServiceType,
//     },
//   };
// }

// // ============================================
// // MAIN HANDLER
// // ============================================

// const supabaseAdmin = createClient(
//   Deno.env.get("SUPABASE_URL") ?? "",
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
// );

// Deno.serve(
//   requireAuth(async (req: Request, authCtx: any) => {
//     if (req.method === "OPTIONS") {
//       return new Response("ok", { headers: corsHeaders });
//     }

//     const startTime = Date.now();

//     try {
//       console.log("📝 add-members called");

//       if (req.method !== "POST") {
//         return errorResponse("Only POST method is allowed.", 405);
//       }

//       const body = await parseRequestBody<AddMemberRequest>(req);
//       if (!body) {
//         return errorResponse("Request body is required.", 400);
//       }

//       const { registrationNumber, memberType, memberData } = body;

//       if (!registrationNumber) {
//         return errorResponse("registrationNumber is mandatory.", 400);
//       }

//       if (!memberType) {
//         return errorResponse("memberType is mandatory.", 400);
//       }

//       if (!Array.isArray(memberData) || memberData.length === 0) {
//         return errorResponse("memberData must be a non-empty array.", 400);
//       }

//       const validationError = validateMemberData(memberData, memberType);
//       if (validationError) {
//         return errorResponse(validationError, 400);
//       }

//       const searchRegNum = String(registrationNumber).trim();
//       const memberTypeLower = memberType.toLowerCase();

//       const { data: society, error: socErr } = await supabaseAdmin
//         .from("SSP_Society")
//         .select("society_id, society_name, registration_number")
//         .eq("registration_number", searchRegNum)
//         .maybeSingle();

//       if (socErr) throw socErr;
//       if (!society) {
//         return errorResponse("No such registrationNumber.", 400);
//       }

//       const societyId = society.society_id;

//       const picklists = await loadPicklists(supabaseAdmin, PICKLIST_KEYS);

//       // VENDOR
//       if (memberTypeLower === "vendor") {
//         console.log("🏪 Creating vendor(s) - NO contact creation");

//         const results: any[] = [];

//         for (const data of memberData) {
//           const vendorResult = await createVendorUser(
//             supabaseAdmin,
//             data,
//             societyId,
//             society.registration_number,
//             picklists,
//           );

//           results.push({
//             recordId: vendorResult.non_society_user_id,
//             vendorId: vendorResult.vendor_id,
//             fullName: vendorResult.name || data.fullName,
//             phone: vendorResult.phone_number || data.phone,
//             role: vendorResult.normalized.role ?? "vendor", // ✅ normalized
//             serviceType: vendorResult.normalized.serviceType, // ✅ normalized
//             gender: vendorResult.normalized.gender, // ✅ normalized
//             idProofType: vendorResult.normalized.idProofType, // ✅ normalized
//             vehicleType: vendorResult.normalized.vehicleType, // ✅ normalized
//             society: society.society_name,
//             registrationNumber: society.registration_number,
//           });
//         }

//         console.log(
//           `✅ ${results.length} vendor(s) created in ${
//             Date.now() - startTime
//           }ms`,
//         );

//         return successResponse({
//           memberCreated: results,
//           memberType: "vendor",
//           total: results.length,
//           errorResponse: null,
//         });
//       }

//       // NON-VENDOR
//       console.log(`👥 Creating ${memberType}(s) with contact`);

//       const phoneSet: string[] = [];
//       const fullNameSet: string[] = [];

//       for (const m of memberData) {
//         if (m.phone) phoneSet.push(String(m.phone).trim());
//         if (m.fullName) fullNameSet.push(String(m.fullName).trim());
//       }

//       const { data: existingContacts, error: contactFetchErr } =
//         await supabaseAdmin
//           .from("SSP_Contact")
//           .select("contact_id, name, phone, id_proof_number")
//           .in("name", fullNameSet)
//           .in("phone", phoneSet);

//       if (contactFetchErr) throw contactFetchErr;

//       const existingContactMap = new Map();
//       if (existingContacts) {
//         for (const c of existingContacts) {
//           existingContactMap.set(`${c.name}_${c.phone}`, c);
//           if (c.id_proof_number) {
//             existingContactMap.set(
//               String(c.id_proof_number).trim().toUpperCase(),
//               c,
//             );
//           }
//           if (c.phone) existingContactMap.set(String(c.phone).trim(), c);
//         }
//       }

//       const results: any[] = [];

//       for (const data of memberData) {
//         if (data.blockId && data.towerId && data.unitFlatNumber) {
//           const { data: existingResidents, error: residentErr } =
//             await supabaseAdmin
//               .from("SSP_Society_User")
//               .select("user_id")
//               .eq("block", data.blockId)
//               .eq("tower", data.towerId)
//               .eq("unit_flat_number", String(data.unitFlatNumber).trim())
//               .is("move_out_date", null)
//               .limit(1);

//           if (residentErr) throw residentErr;
//           if (existingResidents && existingResidents.length > 0) {
//             return errorResponse(
//               `Unit ${data.unitFlatNumber} is already occupied.`,
//               400,
//             );
//           }
//         }

//         const { contactId, isNew, normalized: contactNorm } =
//           await createOrGetContact(
//             supabaseAdmin,
//             data,
//             societyId,
//             existingContactMap,
//             picklists,
//           );

//         const memberResult = await createSocietyUser(
//           supabaseAdmin,
//           data,
//           contactId,
//           societyId,
//           memberType,
//           picklists,
//         );

//         // ✅ Return NORMALIZED values (what's actually in DB)
//         results.push({
//           memberId: memberResult.user_id,
//           contactId: contactId,
//           fullName: data.fullName,
//           phone: data.phone,
//           role: memberResult.normalized.role ?? memberType.toLowerCase(),
//           society: society.society_name,
//           registrationNumber: society.registration_number,
//           isNewContact: isNew,
//           vehicleType: contactNorm.vehicleType,
//           idProofType: contactNorm.idProofType,
//           idProofNumber: data.idProofNumber,
//           emergencyPhone: data.emergencyPhone || null,
//           // ✅ Additional normalized fields
//           gender: contactNorm.gender,
//           userType: memberResult.normalized.userType,
//           userOwnershipType: memberResult.normalized.ownershipType,
//         });
//       }

//       console.log(
//         `✅ ${results.length} ${memberType}(s) created in ${
//           Date.now() - startTime
//         }ms`,
//       );

//       return successResponse({
//         memberCreated: results,
//         memberType: memberType,
//         total: results.length,
//         errorResponse: null,
//       });
//     } catch (error: any) {
//       console.error("❌ add-members error:", error);
//       return new Response(
//         JSON.stringify({
//           success: false,
//           error: "SERVER_ERROR",
//           message: error.message || "Failed to add members",
//           memberCreated: null,
//           errorResponse: {
//             errorCode: "SERVER_ERROR",
//             message: error.message || "Failed to add members",
//             timestamp: new Date().toISOString(),
//           },
//         }),
//         {
//           status: 500,
//           headers: { ...corsHeaders, "Content-Type": "application/json" },
//         },
//       );
//     }
//   }),
// );

// deno-lint-ignore-file no-explicit-any no-unused-vars prefer-const
import { requireAuth } from "../_shared/auth.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { parseRequestBody } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ============================================
// TYPES
// ============================================
interface MemberData {
  fullName: string;
  phone: string;
  idProofType: string;
  idProofNumber: string;
  blockId?: string;
  towerId?: string;
  unitFlatNumber?: string;
  moveInDate?: string;
  moveOutDate?: string;
  userType?: string;
  userOwnershipType?: string;
  relationship?: string;
  status?: string;
  shift?: string;
  securityGuardId?: string;
  gateNumber?: string;
  securityZone?: string;
  securityGuardStatus?: string;
  serviceAgentRating?: number;
  agentAvailabilityStatus?: string;
  serviceAgentServices?: string[] | string;
  email?: string;
  gender?: string;
  occupation?: string;
  whatsappPhone?: string;
  emergencyPhone?: string;
  vehicleType?: string;
  vehicleRegistrationNumber?: string;
  vendorName?: string;
  vendorServiceType?: string;
  vendorRating?: string;
}

interface AddMemberRequest {
  registrationNumber: string;
  memberType: string;
  memberData: MemberData[];
}

// ============================================
// PICKLIST NORMALIZER
// ============================================

type PicklistMap = Map<string, Set<string>>;

function normalizeKey(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadPicklists(
  supabaseAdmin: any,
  keys: string[],
): Promise<PicklistMap> {
  const map: PicklistMap = new Map();
  for (const k of keys) map.set(k, new Set());

  if (keys.length === 0) return map;

  const tables = new Set<string>();
  for (const k of keys) {
    const [t] = k.split(".");
    tables.add(t);
  }

  const { data, error } = await supabaseAdmin
    .from("SSP_Picklist_Config")
    .select("table_name, field_name, value")
    .eq("is_active", true)
    .eq("language", "en")
    .in("table_name", Array.from(tables));

  if (error) {
    console.error("❌ Failed to load picklists:", error.message);
    return map;
  }

  const normLookup: Map<string, Map<string, string>> = new Map();
  for (const row of data ?? []) {
    const key = `${row.table_name}.${row.field_name}`;
    if (!normLookup.has(key)) normLookup.set(key, new Map());
    normLookup.get(key)!.set(normalizeKey(row.value), row.value);
    map.get(key)?.add(row.value);
  }

  (map as any).__norm = normLookup;
  return map;
}

function resolvePicklistValue(
  map: PicklistMap,
  table: string,
  field: string,
  input: unknown,
  fallbackIfInvalid: string | null = null,
): string | null {
  if (input === null || input === undefined) return fallbackIfInvalid;
  const raw = String(input).trim();
  if (raw === "") return fallbackIfInvalid;

  const key = `${table}.${field}`;
  const values = map.get(key);
  const normLookup: Map<string, string> | undefined = (map as any).__norm?.get(
    key,
  );

  if (!values || values.size === 0) {
    return raw;
  }

  if (values.has(raw)) return raw;

  if (normLookup) {
    const canon = normLookup.get(normalizeKey(raw));
    if (canon) return canon;
  }

  console.warn(
    `⚠️  add-members: value "${raw}" not in picklist for ${key}. Storing NULL.`,
  );
  return fallbackIfInvalid;
}

const PICKLIST_KEYS = [
  "SSP_Contact.gender",
  "SSP_Contact.id_proof_type",
  "SSP_Contact.vehicle_type",
  "SSP_Society_User.role",
  "SSP_Society_User.user_type",
  "SSP_Society_User.user_ownership_type",
  "SSP_Society_User.relationship",
  "SSP_Society_User.shift",
  "SSP_Society_User.security_zone",
  "SSP_Society_User.security_guard_status",
  "SSP_Society_User.agent_availability_status",
  "SSP_Non_Society_User.role",
  "SSP_Non_Society_User.gender",
  "SSP_Non_Society_User.id_proof_type",
  "SSP_Non_Society_User.vehicle_type",
  "SSP_Non_Society_User.service_type",
];

// ============================================
// HELPER: ID Proof Validator
// ============================================
function validateIdProof(type: string, number: string): string | null {
  if (!type || !number) {
    return "idProofType and idProofNumber are mandatory.";
  }

  const cleanType = String(type).trim().toLowerCase();
  const cleanNum = String(number).trim().toUpperCase();

  if (
    cleanType.includes("adhar") || cleanType.includes("aadhar") ||
    cleanType.includes("aadhaar")
  ) {
    if (!/^\d{12}$/.test(cleanNum)) {
      return "Aadhaar Card must be exactly 12 numeric digits.";
    }
  } else if (cleanType.includes("pan")) {
    if (!/^[A-Z]{5}\d{4}[A-Z]{1}$/.test(cleanNum)) {
      return "PAN Card must be 10 characters formatted as 5 letters, 4 digits, and 1 letter.";
    }
  } else if (cleanType.includes("dl") || cleanType.includes("driving")) {
    if (!/^[A-Z0-9]{15}$/.test(cleanNum)) {
      return "Driving License must be 15 alphanumeric characters.";
    }
  } else if (cleanType.includes("voter") || cleanType.includes("epic")) {
    if (!/^[A-Z]{3}\d{7}$/.test(cleanNum) && !/^[A-Z0-9]{10}$/.test(cleanNum)) {
      return "Voter ID must be 10 alphanumeric characters.";
    }
  } else {
    return "Invalid ID proof type. Supported: Aadhaar, PAN, Driving License, Voter ID.";
  }
  return null;
}

// ============================================
// HELPER: Validate Member Data
// ============================================
function validateMemberData(
  memberData: MemberData[],
  memberType: string,
): string | null {
  for (let i = 0; i < memberData.length; i++) {
    const m = memberData[i];

    if (
      !m.fullName || typeof m.fullName !== "string" || m.fullName.trim() === ""
    ) {
      return `Member [index ${i}]: 'fullName' is required.`;
    }

    if (!m.phone || !/^\d+$/.test(String(m.phone).trim())) {
      return `Member [index ${i}]: 'phone' is required and must contain numeric digits only.`;
    }

    const idError = validateIdProof(m.idProofType || "", m.idProofNumber || "");
    if (idError) {
      return `Member [index ${i}]: ${idError}`;
    }

    if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m.email).trim())) {
      return `Member [index ${i}]: Invalid 'email' format.`;
    }

    // ✅ Conditional relationship validation: required ONLY for secondary members
    const ownershipLower = String(m.userOwnershipType ?? "").trim()
      .toLowerCase();
    const isSecondary = ownershipLower === "secondary";

    if (isSecondary) {
      if (
        !m.relationship ||
        typeof m.relationship !== "string" ||
        m.relationship.trim() === ""
      ) {
        return `Member [index ${i}]: 'relationship' is required when userOwnershipType is 'secondary'.`;
      }
    }

    if (memberType.toLowerCase() === "vendor") {
      if (!m.vendorName) {
        return `Member [index ${i}]: 'vendorName' is required for vendor.`;
      }
      if (!m.vendorServiceType) {
        return `Member [index ${i}]: 'vendorServiceType' is required for vendor.`;
      }
    }
  }
  return null;
}

// ============================================
// HELPER: Create or Get Contact (For Non-Vendors Only)
// ============================================
async function createOrGetContact(
  supabaseAdmin: any,
  data: MemberData,
  societyId: string,
  existingContactMap: Map<string, any>,
  picklists: PicklistMap,
): Promise<{
  contactId: string;
  isNew: boolean;
  normalized: {
    gender: string | null;
    idProofType: string | null;
    vehicleType: string | null;
  };
}> {
  const namePhoneKey = `${data.fullName}_${data.phone}`;
  const idProofKey = data.idProofNumber
    ? String(data.idProofNumber).trim().toUpperCase()
    : "";
  const phoneOnlyKey = data.phone ? String(data.phone).trim() : "";

  const normGender = resolvePicklistValue(
    picklists,
    "SSP_Contact",
    "gender",
    data.gender,
  );
  const normIdProofType = resolvePicklistValue(
    picklists,
    "SSP_Contact",
    "id_proof_type",
    data.idProofType,
  );
  const normVehicleType = resolvePicklistValue(
    picklists,
    "SSP_Contact",
    "vehicle_type",
    data.vehicleType,
  );

  const normalized = {
    gender: normGender,
    idProofType: normIdProofType,
    vehicleType: normVehicleType,
  };

  const matchedContact = existingContactMap.get(namePhoneKey) ||
    (idProofKey ? existingContactMap.get(idProofKey) : null) ||
    (phoneOnlyKey ? existingContactMap.get(phoneOnlyKey) : null);

  if (matchedContact) {
    console.log(`📝 Updating existing contact: ${matchedContact.contact_id}`);

    const updatePayload: any = {};
    if (data.email) updatePayload.email = data.email;
    if (normGender) updatePayload.gender = normGender;
    if (data.occupation) updatePayload.occupation = data.occupation;
    if (data.whatsappPhone) updatePayload.whatsapp_phone = data.whatsappPhone;
    if (data.emergencyPhone) {
      updatePayload.emergency_phone = data.emergencyPhone;
    }
    if (normIdProofType) updatePayload.id_proof_type = normIdProofType;
    if (data.idProofNumber) {
      updatePayload.id_proof_number = data.idProofNumber.trim().toUpperCase();
    }
    if (normVehicleType) updatePayload.vehicle_type = normVehicleType;
    if (data.vehicleRegistrationNumber) {
      updatePayload.vehicle_registration_number =
        data.vehicleRegistrationNumber;
    }
    if (data.fullName) updatePayload.name = data.fullName;
    if (data.phone) updatePayload.phone = data.phone;
    updatePayload.society = societyId;

    const { error: updateErr } = await supabaseAdmin
      .from("SSP_Contact")
      .update(updatePayload)
      .eq("contact_id", matchedContact.contact_id);

    if (updateErr) {
      console.error("❌ Failed to update contact:", updateErr);
      throw new Error(`Failed to update contact: ${updateErr.message}`);
    }

    return { contactId: matchedContact.contact_id, isNew: false, normalized };
  }

  const newContactPayload = {
    name: data.fullName,
    phone: phoneOnlyKey || null,
    email: data.email || null,
    gender: normGender,
    occupation: data.occupation || null,
    id_proof_type: normIdProofType,
    id_proof_number: data.idProofNumber
      ? data.idProofNumber.trim().toUpperCase()
      : null,
    society: societyId,
    whatsapp_phone: data.whatsappPhone || null,
    emergency_phone: data.emergencyPhone || null,
    vehicle_type: normVehicleType,
    vehicle_registration_number: data.vehicleRegistrationNumber || null,
  };

  const { data: insertedContact, error: insertErr } = await supabaseAdmin
    .from("SSP_Contact")
    .insert(newContactPayload)
    .select("contact_id")
    .single();

  if (insertErr) {
    throw new Error(`Failed to create contact: ${insertErr.message}`);
  }

  return { contactId: insertedContact.contact_id, isNew: true, normalized };
}

// ============================================
// HELPER: Create Society User (Non-Vendor)
// ============================================
async function createSocietyUser(
  supabaseAdmin: any,
  data: MemberData,
  contactId: string,
  societyId: string,
  memberType: string,
  picklists: PicklistMap,
): Promise<{
  user_id: string;
  contact: string;
  normalized: {
    role: string | null;
    userType: string | null;
    ownershipType: string | null;
    relationship: string | null;
    shift: string | null;
    securityZone: string | null;
    guardStatus: string | null;
    agentStatus: string | null;
  };
}> {
  const normRole = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "role",
    memberType,
  );
  const normUserType = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "user_type",
    data.userType,
  );
  const normOwnership = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "user_ownership_type",
    data.userOwnershipType,
  );
  const normRelationship = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "relationship",
    data.relationship,
  );
  const normShift = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "shift",
    data.shift,
  );
  const normSecurityZone = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "security_zone",
    data.securityZone,
  );
  const normGuardStatus = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "security_guard_status",
    data.securityGuardStatus,
  );
  const normAgentStatus = resolvePicklistValue(
    picklists,
    "SSP_Society_User",
    "agent_availability_status",
    data.agentAvailabilityStatus,
  );

  // ✅ Primary owners never have a relationship — force NULL
  const finalRelationship = normOwnership === "primary"
    ? null
    : normRelationship;

  const junctionRecord = {
    contact: contactId,
    society: societyId,
    role: normRole ? [normRole] : [memberType.toLowerCase()],
    block: data.blockId || null,
    tower: data.towerId || null,
    unit_flat_number: data.unitFlatNumber
      ? String(data.unitFlatNumber).trim()
      : null,
    move_in_date: data.moveInDate || null,
    move_out_date: data.moveOutDate || null,
    user_type: normUserType,
    user_ownership_type: normOwnership,
    relationship: finalRelationship,
    status: String(data.status || "active").trim().toLowerCase() === "active" ||
      String(data.status || "active").trim().toLowerCase() === "true",
    shift: normShift,
    security_guard_id: data.securityGuardId || null,
    gate_number: data.gateNumber || null,
    security_zone: normSecurityZone,
    security_guard_status: normGuardStatus,
    service_agent_rating: data.serviceAgentRating != null
      ? Number(Number(data.serviceAgentRating).toFixed(2))
      : null,
    agent_availability_status: normAgentStatus,
    service_agent_services: Array.isArray(data.serviceAgentServices)
      ? data.serviceAgentServices.join(", ")
      : data.serviceAgentServices || null,
  };

  const { data: insertedMember, error: insertErr } = await supabaseAdmin
    .from("SSP_Society_User")
    .insert(junctionRecord)
    .select("user_id, contact")
    .single();

  if (insertErr) {
    throw new Error(`Failed to create society user: ${insertErr.message}`);
  }

  return {
    ...insertedMember,
    normalized: {
      role: normRole,
      userType: normUserType,
      ownershipType: normOwnership,
      relationship: finalRelationship,
      shift: normShift,
      securityZone: normSecurityZone,
      guardStatus: normGuardStatus,
      agentStatus: normAgentStatus,
    },
  };
}

// ============================================
// HELPER: Generate Vendor ID
// ============================================
async function generateVendorId(
  supabaseAdmin: any,
  societyRegistrationNumber: string,
): Promise<string> {
  const { count, error } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .select("non_society_user_id", { count: "exact", head: true })
    .eq("role", "vendor");

  if (error) {
    console.error("❌ Failed to get vendor count:", error);
    return `VENDOR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }

  const societyCode = societyRegistrationNumber.split("-")[0] || "SOC";
  const nextNumber = (count || 0) + 1;
  const paddedNumber = String(nextNumber).padStart(4, "0");

  return `VND-${societyCode}-${paddedNumber}`;
}

// ============================================
// HELPER: Create Vendor User
// ============================================
async function createVendorUser(
  supabaseAdmin: any,
  data: MemberData,
  societyId: string,
  societyRegistrationNumber: string,
  picklists: PicklistMap,
): Promise<{
  non_society_user_id: string;
  vendor_id: string;
  name: string;
  phone_number: string;
  normalized: {
    role: string | null;
    idProofType: string | null;
    vehicleType: string | null;
    gender: string | null;
    serviceType: string | null;
  };
}> {
  const vendorId = await generateVendorId(
    supabaseAdmin,
    societyRegistrationNumber,
  );

  const { data: existingVendor, error: checkError } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .select("non_society_user_id")
    .eq("society", societyId)
    .eq("phone_number", String(data.phone).trim())
    .maybeSingle();

  if (checkError) throw checkError;

  if (existingVendor) {
    throw new Error(`Vendor with phone number ${data.phone} already exists.`);
  }

  if (data.email) {
    const { data: existingEmailVendor, error: emailCheckError } =
      await supabaseAdmin
        .from("SSP_Non_Society_User")
        .select("non_society_user_id")
        .eq("society", societyId)
        .eq("email", String(data.email).trim())
        .maybeSingle();

    if (emailCheckError) throw emailCheckError;

    if (existingEmailVendor) {
      throw new Error(`Vendor with email ${data.email} already exists.`);
    }
  }

  const normRole = resolvePicklistValue(
    picklists,
    "SSP_Non_Society_User",
    "role",
    "vendor",
  ) ?? "vendor";
  const normIdProofType = resolvePicklistValue(
    picklists,
    "SSP_Non_Society_User",
    "id_proof_type",
    data.idProofType,
  );
  const normVehicleType = resolvePicklistValue(
    picklists,
    "SSP_Non_Society_User",
    "vehicle_type",
    data.vehicleType,
  );
  const normGender = resolvePicklistValue(
    picklists,
    "SSP_Non_Society_User",
    "gender",
    data.gender,
  );
  const normServiceType = resolvePicklistValue(
    picklists,
    "SSP_Non_Society_User",
    "service_type",
    data.vendorServiceType,
  );

  const vendorRecord = {
    society: societyId,
    name: data.vendorName || data.fullName,
    phone_number: String(data.phone).trim(),
    email: data.email || null,
    role: normRole,
    vendor_id: vendorId,
    service_type: normServiceType,
    vendor_rating: data.vendorRating || null,
    id_proof_type: normIdProofType,
    id_proof_number: data.idProofNumber || null,
    gender: normGender,
    vehicle_number: data.vehicleRegistrationNumber || null,
    vehicle_type: normVehicleType,
    hosted_by: null,
    approver: null,
    created_at: new Date().toISOString(),
  };

  const { data: insertedVendor, error: insertErr } = await supabaseAdmin
    .from("SSP_Non_Society_User")
    .insert(vendorRecord)
    .select("non_society_user_id, vendor_id, name, phone_number")
    .single();

  if (insertErr) {
    throw new Error(`Failed to create vendor: ${insertErr.message}`);
  }

  return {
    ...insertedVendor,
    normalized: {
      role: normRole,
      idProofType: normIdProofType,
      vehicleType: normVehicleType,
      gender: normGender,
      serviceType: normServiceType,
    },
  };
}

// ============================================
// MAIN HANDLER
// ============================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(
  requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      console.log("📝 add-members called");

      if (req.method !== "POST") {
        return errorResponse("Only POST method is allowed.", 405);
      }

      const body = await parseRequestBody<AddMemberRequest>(req);
      if (!body) {
        return errorResponse("Request body is required.", 400);
      }

      const { registrationNumber, memberType, memberData } = body;

      if (!registrationNumber) {
        return errorResponse("registrationNumber is mandatory.", 400);
      }

      if (!memberType) {
        return errorResponse("memberType is mandatory.", 400);
      }

      if (!Array.isArray(memberData) || memberData.length === 0) {
        return errorResponse("memberData must be a non-empty array.", 400);
      }

      const validationError = validateMemberData(memberData, memberType);
      if (validationError) {
        return errorResponse(validationError, 400);
      }

      const searchRegNum = String(registrationNumber).trim();
      const memberTypeLower = memberType.toLowerCase();

      const { data: society, error: socErr } = await supabaseAdmin
        .from("SSP_Society")
        .select("society_id, society_name, registration_number")
        .eq("registration_number", searchRegNum)
        .maybeSingle();

      if (socErr) throw socErr;
      if (!society) {
        return errorResponse("No such registrationNumber.", 400);
      }

      const societyId = society.society_id;

      const picklists = await loadPicklists(supabaseAdmin, PICKLIST_KEYS);

      // VENDOR
      if (memberTypeLower === "vendor") {
        console.log("🏪 Creating vendor(s) - NO contact creation");

        const results: any[] = [];

        for (const data of memberData) {
          const vendorResult = await createVendorUser(
            supabaseAdmin,
            data,
            societyId,
            society.registration_number,
            picklists,
          );

          results.push({
            recordId: vendorResult.non_society_user_id,
            vendorId: vendorResult.vendor_id,
            fullName: vendorResult.name || data.fullName,
            phone: vendorResult.phone_number || data.phone,
            role: vendorResult.normalized.role ?? "vendor",
            serviceType: vendorResult.normalized.serviceType,
            gender: vendorResult.normalized.gender,
            idProofType: vendorResult.normalized.idProofType,
            vehicleType: vendorResult.normalized.vehicleType,
            society: society.society_name,
            registrationNumber: society.registration_number,
          });
        }

        console.log(
          `✅ ${results.length} vendor(s) created in ${
            Date.now() - startTime
          }ms`,
        );

        return successResponse({
          memberCreated: results,
          memberType: "vendor",
          total: results.length,
          errorResponse: null,
        });
      }

      // NON-VENDOR
      console.log(`👥 Creating ${memberType}(s) with contact`);

      const phoneSet: string[] = [];
      const fullNameSet: string[] = [];

      for (const m of memberData) {
        if (m.phone) phoneSet.push(String(m.phone).trim());
        if (m.fullName) fullNameSet.push(String(m.fullName).trim());
      }

      const { data: existingContacts, error: contactFetchErr } =
        await supabaseAdmin
          .from("SSP_Contact")
          .select("contact_id, name, phone, id_proof_number")
          .in("name", fullNameSet)
          .in("phone", phoneSet);

      if (contactFetchErr) throw contactFetchErr;

      const existingContactMap = new Map();
      if (existingContacts) {
        for (const c of existingContacts) {
          existingContactMap.set(`${c.name}_${c.phone}`, c);
          if (c.id_proof_number) {
            existingContactMap.set(
              String(c.id_proof_number).trim().toUpperCase(),
              c,
            );
          }
          if (c.phone) existingContactMap.set(String(c.phone).trim(), c);
        }
      }

      const results: any[] = [];

      for (const data of memberData) {
        if (data.blockId && data.towerId && data.unitFlatNumber) {
          const { data: existingResidents, error: residentErr } =
            await supabaseAdmin
              .from("SSP_Society_User")
              .select("user_id")
              .eq("block", data.blockId)
              .eq("tower", data.towerId)
              .eq("unit_flat_number", String(data.unitFlatNumber).trim())
              .is("move_out_date", null)
              .limit(1);

          if (residentErr) throw residentErr;
          if (existingResidents && existingResidents.length > 0) {
            return errorResponse(
              `Unit ${data.unitFlatNumber} is already occupied.`,
              400,
            );
          }
        }

        const { contactId, isNew, normalized: contactNorm } =
          await createOrGetContact(
            supabaseAdmin,
            data,
            societyId,
            existingContactMap,
            picklists,
          );

        const memberResult = await createSocietyUser(
          supabaseAdmin,
          data,
          contactId,
          societyId,
          memberType,
          picklists,
        );

        // ✅ Response uses NORMALIZED values (what's actually in DB)
        results.push({
          memberId: memberResult.user_id,
          contactId: contactId,
          fullName: data.fullName,
          phone: data.phone,
          role: memberResult.normalized.role ?? memberType.toLowerCase(),
          society: society.society_name,
          registrationNumber: society.registration_number,
          isNewContact: isNew,
          vehicleType: contactNorm.vehicleType,
          idProofType: contactNorm.idProofType,
          idProofNumber: data.idProofNumber,
          emergencyPhone: data.emergencyPhone || null,
          gender: contactNorm.gender,
          userType: memberResult.normalized.userType,
          userOwnershipType: memberResult.normalized.ownershipType,
          relationship: memberResult.normalized.relationship,
        });
      }

      console.log(
        `✅ ${results.length} ${memberType}(s) created in ${
          Date.now() - startTime
        }ms`,
      );

      return successResponse({
        memberCreated: results,
        memberType: memberType,
        total: results.length,
        errorResponse: null,
      });
    } catch (error: any) {
      console.error("❌ add-members error:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: "SERVER_ERROR",
          message: error.message || "Failed to add members",
          memberCreated: null,
          errorResponse: {
            errorCode: "SERVER_ERROR",
            message: error.message || "Failed to add members",
            timestamp: new Date().toISOString(),
          },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  }),
);
