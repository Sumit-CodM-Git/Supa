import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, successResponse, } from "../_shared/response.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(requireAuth(async (req: Request, authCtx: any) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        if (req.method !== "POST") {
            return errorResponse("Only POST method is allowed.", 405);
        }
        const bodyText = await req.text();
        if (!bodyText || bodyText.trim() === "") {
            return errorResponse("Request body is empty.", 400);
        }
        const requestObj = JSON.parse(bodyText);
        const { operation, societyRegistrationNumber, recordId, vendorId, name, phoneNumber, email, gender, role, serviceType, idProofType, idProofNumber, vehicleNumber, vehicleType, vendorRating, page, limit, search, } = requestObj;
        if (!operation || String(operation).trim() === "") {
            return errorResponse("Operation is mandatory.", 400);
        }
        if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
            return errorResponse("societyRegistrationNumber is required.", 400);
        }
        const cleanRegNum = String(societyRegistrationNumber).trim();
        const opUpper = String(operation).trim().toUpperCase();
        const { data: society, error: socErr } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNum)
            .maybeSingle();
        if (socErr)
            throw new Error(`Society lookup failed: ${socErr.message}`);
        if (!society) {
            return errorResponse("Society registration number matches no active record context.", 404);
        }
        if (opUpper === "FETCH") {
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
            const offset = (pageNum - 1) * limitNum;
            let countQuery = supabaseAdmin
                .from("SSP_Non_Society_User")
                .select("non_society_user_id", { count: "exact", head: true })
                .eq("society", society.society_id);
            let dataQuery = supabaseAdmin
                .from("SSP_Non_Society_User")
                .select(`
            non_society_user_id,
            vendor_id,
            name,
            phone_number,
            email,
            gender,
            role,
            service_type,
            id_proof_type,
            id_proof_number,
            vehicle_number,
            vehicle_type,
            vendor_rating
          `)
                .eq("society", society.society_id);
            if (role && String(role).trim() !== "") {
                countQuery = countQuery.ilike("role", String(role).trim());
                dataQuery = dataQuery.ilike("role", String(role).trim());
            }
            if (serviceType && String(serviceType).trim() !== "") {
                const serviceTerm = `%${String(serviceType).trim()}%`;
                countQuery = countQuery.ilike("service_type", serviceTerm);
                dataQuery = dataQuery.ilike("service_type", serviceTerm);
            }
            if (search && String(search).trim() !== "") {
                const term = `%${String(search).trim()}%`;
                const queryCond = `name.ilike.${term},phone_number.ilike.${term},vendor_id.ilike.${term},email.ilike.${term},service_type.ilike.${term},vehicle_number.ilike.${term},id_proof_number.ilike.${term}`;
                countQuery = countQuery.or(queryCond);
                dataQuery = dataQuery.or(queryCond);
            }
            const { count: totalCount, error: countErr } = await countQuery;
            if (countErr)
                throw countErr;
            const { data: records, error: fetchErr } = await dataQuery
                .order("non_society_user_id", { ascending: false })
                .range(offset, offset + limitNum - 1);
            if (fetchErr)
                throw fetchErr;
            const mappedVendors = (records ?? []).map((v: any) => ({
                recordId: v.non_society_user_id,
                vendorId: v.vendor_id || null,
                name: v.name || "",
                phoneNumber: v.phone_number || "",
                email: v.email || null,
                gender: v.gender || null,
                role: v.role || "",
                serviceType: v.service_type || null,
                idProofType: v.id_proof_type || null,
                idProofNumber: v.id_proof_number || null,
                vehicleNumber: v.vehicle_number || null,
                vehicleType: v.vehicle_type || null,
                vendorRating: v.vendor_rating || null,
            }));
            return successResponse({
                pagination: {
                    totalCount: totalCount || 0,
                    currentPage: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil((totalCount || 0) / limitNum),
                },
                vendors: mappedVendors,
            });
        }
        else if (opUpper === "CREATE") {
            if (!name || !phoneNumber || !role) {
                return errorResponse("name, phoneNumber, and role are required for CREATE.", 400);
            }
            const { data: newVendor, error: insertErr } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .insert({
                name: name,
                phone_number: phoneNumber,
                role: role,
                vendor_id: vendorId || null,
                email: email || null,
                gender: gender || null,
                service_type: serviceType || null,
                id_proof_type: idProofType || null,
                id_proof_number: idProofNumber || null,
                vehicle_number: vehicleNumber || null,
                vehicle_type: vehicleType || null,
                vendor_rating: vendorRating ?? null,
                society: society.society_id,
                hosted_by: null,
                approver: null,
            })
                .select(`
            non_society_user_id,
            vendor_id,
            name,
            phone_number,
            email,
            gender,
            role,
            service_type,
            id_proof_type,
            id_proof_number,
            vehicle_number,
            vehicle_type,
            vendor_rating
          `)
                .single();
            if (insertErr)
                throw new Error(`Insert failed: ${insertErr.message}`);
            return successResponse({
                vendor: {
                    recordId: newVendor.non_society_user_id,
                    vendorId: newVendor.vendor_id,
                    name: newVendor.name,
                    phoneNumber: newVendor.phone_number,
                    email: newVendor.email,
                    gender: newVendor.gender,
                    role: newVendor.role,
                    serviceType: newVendor.service_type,
                    idProofType: newVendor.id_proof_type,
                    idProofNumber: newVendor.id_proof_number,
                    vehicleNumber: newVendor.vehicle_number,
                    vehicleType: newVendor.vehicle_type,
                    vendorRating: newVendor.vendor_rating,
                    isSuccess: true,
                },
            });
        }
        else if (opUpper === "UPDATE") {
            if (!recordId) {
                return errorResponse("recordId is required for UPDATE.", 400);
            }
            const updatePayload: Record<string, any> = {};
            if (name !== undefined)
                updatePayload.name = name;
            if (phoneNumber !== undefined)
                updatePayload.phone_number = phoneNumber;
            if (vendorId !== undefined)
                updatePayload.vendor_id = vendorId;
            if (role !== undefined)
                updatePayload.role = role;
            if (email !== undefined)
                updatePayload.email = email;
            if (gender !== undefined)
                updatePayload.gender = gender;
            if (serviceType !== undefined)
                updatePayload.service_type = serviceType;
            if (idProofType !== undefined)
                updatePayload.id_proof_type = idProofType;
            if (idProofNumber !== undefined)
                updatePayload.id_proof_number = idProofNumber;
            if (vehicleNumber !== undefined)
                updatePayload.vehicle_number = vehicleNumber;
            if (vehicleType !== undefined)
                updatePayload.vehicle_type = vehicleType;
            if (vendorRating !== undefined)
                updatePayload.vendor_rating = vendorRating;
            const { data: updatedRecord, error: updateErr } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .update(updatePayload)
                .eq("non_society_user_id", recordId)
                .eq("society", society.society_id)
                .select(`
            non_society_user_id,
            vendor_id,
            name,
            phone_number,
            email,
            gender,
            role,
            service_type,
            id_proof_type,
            id_proof_number,
            vehicle_number,
            vehicle_type,
            vendor_rating
          `)
                .maybeSingle();
            if (updateErr)
                throw new Error(`Update failed: ${updateErr.message}`);
            if (!updatedRecord) {
                return errorResponse("Vendor record not found inside society limits.", 404);
            }
            return successResponse({
                vendor: {
                    recordId: updatedRecord.non_society_user_id,
                    vendorId: updatedRecord.vendor_id,
                    name: updatedRecord.name,
                    phoneNumber: updatedRecord.phone_number,
                    email: updatedRecord.email,
                    gender: updatedRecord.gender,
                    role: updatedRecord.role,
                    serviceType: updatedRecord.service_type,
                    idProofType: updatedRecord.id_proof_type,
                    idProofNumber: updatedRecord.id_proof_number,
                    vehicleNumber: updatedRecord.vehicle_number,
                    vehicleType: updatedRecord.vehicle_type,
                    vendorRating: updatedRecord.vendor_rating,
                    isSuccess: true,
                },
            });
        }
        else if (opUpper === "DELETE") {
            if (!recordId) {
                return errorResponse("recordId is required for DELETE.", 400);
            }
            const { data: checkData, error: deleteErr } = await supabaseAdmin
                .from("SSP_Non_Society_User")
                .delete()
                .eq("non_society_user_id", recordId)
                .eq("society", society.society_id)
                .select("non_society_user_id");
            if (deleteErr)
                throw new Error(`Delete failed: ${deleteErr.message}`);
            if (!checkData || checkData.length === 0) {
                return errorResponse("Record not found or invalid recordId.", 400);
            }
            return successResponse({
                vendor: {
                    recordId: recordId,
                    isSuccess: true,
                },
            });
        }
        return errorResponse("Invalid operation. Supported operations: FETCH, CREATE, UPDATE, DELETE.", 400);
    }
    catch (error: any) {
        console.error("❌ vendor-management error:", error);
        return errorResponse(error.message || "Execution Pipeline Interrupted.", 500);
    }
}));
