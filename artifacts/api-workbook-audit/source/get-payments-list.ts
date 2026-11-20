import { contactParkingSlot } from "../_shared/contact.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Validator } from "../_shared/validation.ts";
import { sanitizePagination } from "../_shared/sanitizer.ts";
import { corsHeaders } from "../_shared/response.ts";
import { getEnv, parseRequestBody, sanitizeString, logger, } from "../_shared/utils.ts";
import { ApiError, handleError } from "../_shared/errors.ts";
interface GetPaymentsPayload {
    societyRegistrationNumber?: string;
    paymentStatus?: string;
    paymentType?: string;
    searchText?: string;
}
interface PaymentRecord {
    payment_id: string;
    amount: number | string | null;
    due_date: string | null;
    month_period: string | null;
    payment_date: string | null;
    payment_method: string | null;
    payment_status: string | null;
    payment_type: string | null;
    receipt_information: string | null;
    receipt_url: string | null;
    transaction_id: string | null;
    rejection_reason: string | null;
    created_at: string;
    society_user?: {
        unit_flat_number: string | null;
        society: string;
        contact?: {
            name: string | null;
        };
    };
}
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const action = "POST /get-payments-list";
    try {
        const supabaseUrl = getEnv("SUPABASE_URL");
        const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
        }
        const token = authHeader.replace("Bearer ", "");
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authUser) {
            throw new ApiError("UNAUTHORIZED", "Invalid or expired session token", 401);
        }
        const body = await parseRequestBody(req);
        if (!body) {
            throw new ApiError("BAD_REQUEST", "Request body is empty.", 400);
        }
        const validator = new Validator();
        validator.validateRequired(body.societyRegistrationNumber, "societyRegistrationNumber");
        if (!validator.isValid()) {
            throw new ApiError("BAD_REQUEST", "Invalid input parameters", 422, validator.getErrors());
        }
        const url = new URL(req.url);
        const pageStr = url.searchParams.get("page") || "1";
        const limitStr = url.searchParams.get("limit") || "10";
        const { page, limit } = sanitizePagination(pageStr, limitStr);
        const offset = (page - 1) * limit;
        const cleanRegNum = sanitizeString(String(body.societyRegistrationNumber));
        const paymentStatus = body.paymentStatus ? sanitizeString(String(body.paymentStatus)) : null;
        const paymentType = body.paymentType ? sanitizeString(String(body.paymentType)) : null;
        const searchText = body.searchText ? sanitizeString(String(body.searchText)) : null;
        logger.info({ message: `Starting execution for ${action}` });
        const { data: societyRecord, error: societyError } = await supabase
            .from("SSP_Society")
            .select("society_id")
            .eq("registration_number", cleanRegNum)
            .maybeSingle();
        if (societyError)
            throw new ApiError("SERVER_ERROR", `SSP_Society lookup failure: ${societyError.message}`, 500);
        if (!societyRecord) {
            throw new ApiError("NOT_FOUND", "No society registration found matching the identifier provided.", 404);
        }
        let query = supabase
            .from("SSP_Payment")
            .select(`
        *,
        receipt_url,
        society_user:SSP_Society_User!inner(
          unit_flat_number,
          society,
          contact:SSP_Contact(parking_slot,
            name
          )
        )
      `, { count: "exact" })
            .eq("society_user.society", societyRecord.society_id);
        if (paymentStatus && paymentStatus.toUpperCase() !== "ALL") {
            query = query.ilike("payment_status", paymentStatus);
        }
        if (paymentType && paymentType.toUpperCase() !== "ALL") {
            query = query.ilike("payment_type", paymentType);
        }
        if (searchText && searchText.trim() !== "") {
            const cleanSearch = searchText.trim();
            const { data: matchedUsers, error: matchedUsersError } = await supabase
                .from("SSP_Society_User")
                .select(`
      user_id,
      unit_flat_number,
      contact:SSP_Contact(parking_slot,
        name
      )
    `)
                .eq("society", societyRecord.society_id);
            if (matchedUsersError) {
                throw new ApiError("SERVER_ERROR", `Society user search failed: ${matchedUsersError.message}`, 500);
            }
            const searchLower = cleanSearch.toLowerCase();
            const matchedUserIds = (matchedUsers || [])
                .filter((user) => {
                const flatNumber = String(user.unit_flat_number ?? "").toLowerCase();
                const residentName = String(user.contact?.name ?? "").toLowerCase();
                return (flatNumber.includes(searchLower) ||
                    residentName.includes(searchLower));
            })
                .map((user) => user.user_id)
                .filter(Boolean);
            const { data: matchedPayments, error: matchedPaymentsError } = await supabase
                .from("SSP_Payment")
                .select("payment_id")
                .ilike("payment_id", `%${cleanSearch}%`);
            if (matchedPaymentsError) {
                throw new ApiError("SERVER_ERROR", `Payment search failed: ${matchedPaymentsError.message}`, 500);
            }
            const matchedPaymentIds = (matchedPayments || [])
                .map((p) => p.payment_id)
                .filter(Boolean);
            if (matchedUserIds.length > 0 && matchedPaymentIds.length > 0) {
                query = query.or(`society_user.in.(${matchedUserIds.join(",")}),payment_id.in.(${matchedPaymentIds.join(",")})`);
            }
            else if (matchedUserIds.length > 0) {
                query = query.in("society_user", matchedUserIds);
            }
            else if (matchedPaymentIds.length > 0) {
                query = query.in("payment_id", matchedPaymentIds);
            }
            else {
                query = query.eq("payment_id", "__NO_MATCH__");
            }
        }
        query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
        const { data: paymentRecords, count: totalCount, error: paymentError } = await query;
        if (paymentError)
            throw new ApiError("SERVER_ERROR", `SSP_Payment processing lookup failed: ${paymentError.message}`, 500);
        const formattedRecords = (paymentRecords as unknown as PaymentRecord[] || []).map((p) => {
            const userContext = p.society_user;
            const contactContext = userContext?.contact;
            let clickableImageUrl = "N/A";
            if (p.receipt_url && p.receipt_url.trim() !== "") {
                const cleanPath = p.receipt_url.trim();
                if (cleanPath.startsWith("http")) {
                    clickableImageUrl = cleanPath;
                }
                else {
                    const finalPath = cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath;
                    clickableImageUrl = `${supabaseUrl}/storage/v1/object/public/society-documents/GZB-1234-ab/financial/${finalPath}`;
                }
            }
            return {
                parkingSlot: contactParkingSlot(contactContext),
                paymentName: p.payment_id ?? "N/A",
                amount: p.amount != null ? String(p.amount) : "0",
                dueDate: p.due_date ? String(p.due_date) : null,
                monthPeriod: p.month_period ?? "N/A",
                paymentDate: p.payment_date ? String(p.payment_date) : null,
                paymentID: p.payment_id ?? "N/A",
                paymentMethod: p.payment_method ?? "N/A",
                paymentStatus: p.payment_status ?? "N/A",
                paymentType: p.payment_type ?? "N/A",
                receiptInfo: p.receipt_information ?? "N/A",
                transactionID: p.transaction_id ?? "N/A",
                residentName: contactContext?.name ?? "N/A",
                flatNumber: userContext?.unit_flat_number ?? "N/A",
                imageUrl: clickableImageUrl,
                rejectionReason: p.rejection_reason ?? null,
            };
        });
        logger.info({ message: `Successfully completed ${action}` });
        return new Response(JSON.stringify({
            payments: {
                payments: formattedRecords,
                pagination: {
                    page,
                    limit,
                    totalRecords: totalCount ?? 0,
                    totalPages: totalCount ? Math.ceil(totalCount / limit) : 0,
                },
            },
            errorResponse: null,
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    catch (err) {
        logger.error({ message: `Error executing ${action}`, details: String(err) });
        return handleError(err);
    }
});
