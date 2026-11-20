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
        const body = await req.json().catch(() => null);
        if (!body) {
            return errorResponse("Request body is required.", 400);
        }
        const { societyRegistrationNumber, status, paymentType, search, page = 1, limit = 10, } = body;
        if (!societyRegistrationNumber || String(societyRegistrationNumber).trim() === "") {
            return errorResponse("societyRegistrationNumber is mandatory.", 400);
        }
        const cleanRegNo = String(societyRegistrationNumber).trim();
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));
        const offset = (pageNum - 1) * limitNum;
        const { data: societyContext, error: socError } = await supabaseAdmin
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNo)
            .maybeSingle();
        if (socError)
            throw new Error(`SSP_Society verification failed: ${socError.message}`);
        if (!societyContext) {
            return errorResponse("Society not found.", 404);
        }
        const { data: resident, error: residentError } = await supabaseAdmin
            .from("SSP_Society_User")
            .select("user_id")
            .eq("user_id", authCtx.user.id)
            .eq("society", societyContext.society_id)
            .maybeSingle();
        if (residentError)
            throw new Error(`Resident lookup failed: ${residentError.message}`);
        if (!resident) {
            return errorResponse("Authenticated user is not an active resident of this society.", 403);
        }
        const targetUserId = resident.user_id;
        const { data: allLedger, error: ledgerErr } = await supabaseAdmin
            .from("SSP_Payment")
            .select("amount, payment_status")
            .eq("society_user", targetUserId);
        if (ledgerErr)
            throw ledgerErr;
        const rawLedger = allLedger ?? [];
        const totalDues = rawLedger.reduce((acc: number, p: any) => {
            const st = (p.payment_status ?? "").trim().toLowerCase();
            if (["pending", "due", "unpaid", "overdue"].includes(st)) {
                return acc + Number(p.amount ?? 0);
            }
            return acc;
        }, 0);
        const totalPaidAmount = rawLedger.reduce((acc: number, p: any) => {
            const st = (p.payment_status ?? "").trim().toLowerCase();
            if (["paid", "completed", "success"].includes(st)) {
                return acc + Number(p.amount ?? 0);
            }
            return acc;
        }, 0);
        let countQuery = supabaseAdmin
            .from("SSP_Payment")
            .select("pay_rec_id", { count: "exact", head: true })
            .eq("society_user", targetUserId);
        let dataQuery = supabaseAdmin
            .from("SSP_Payment")
            .select(`
          pay_rec_id,
          amount,
          due_date,
          month_period,
          payment_id,
          payment_status,
          payment_type,
          facility:SSP_Facility(id)
        `)
            .eq("society_user", targetUserId);
        if (status && String(status).trim() !== "") {
            const cleanStatus = String(status).trim();
            countQuery = countQuery.ilike("payment_status", cleanStatus);
            dataQuery = dataQuery.ilike("payment_status", cleanStatus);
        }
        if (paymentType && String(paymentType).trim() !== "") {
            const cleanType = String(paymentType).trim();
            countQuery = countQuery.ilike("payment_type", cleanType);
            dataQuery = dataQuery.ilike("payment_type", cleanType);
        }
        if (search && String(search).trim() !== "") {
            const searchTerm = `%${String(search).trim()}%`;
            const searchFilter = `payment_id.ilike.${searchTerm},payment_type.ilike.${searchTerm},month_period.ilike.${searchTerm},payment_status.ilike.${searchTerm}`;
            countQuery = countQuery.or(searchFilter);
            dataQuery = dataQuery.or(searchFilter);
        }
        const { count: filteredTotal, error: countErr } = await countQuery;
        if (countErr)
            throw countErr;
        const { data: pendingList, error: paymentError } = await dataQuery
            .order("due_date", { ascending: false })
            .range(offset, offset + limitNum - 1);
        if (paymentError)
            throw new Error(`Payments query failed: ${paymentError.message}`);
        const rawPayments = pendingList ?? [];
        const mappedPayments = rawPayments.map((p: any) => {
            const descriptionText = p.payment_type === "Facility Booking" && p.facility
                ? `Booking for Facility Context ID: ${p.facility.id}`
                : (p.payment_type ?? "").trim();
            return {
                customPaymentId: (p.pay_rec_id ?? "").trim(),
                paymentRecordName: (p.payment_id ?? "N/A").trim(),
                amount: p.amount ? Number(p.amount) : 0,
                dueDate: p.due_date ?? "",
                monthPeriod: (p.month_period ?? "").trim(),
                status: (p.payment_status ?? "").trim(),
                type: (p.payment_type ?? "").trim(),
                description: descriptionText,
            };
        });
        return successResponse({
            totalDues,
            totalPaidAmount,
            pagination: {
                totalCount: filteredTotal || 0,
                currentPage: pageNum,
                limit: limitNum,
                totalPages: Math.ceil((filteredTotal || 0) / limitNum),
            },
            payments: mappedPayments,
        });
    }
    catch (error: any) {
        console.error("❌ view-resident-payments error:", error);
        return errorResponse(error.message || "Unable to process payment ledger request.", 500);
    }
}));
