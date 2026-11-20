// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "POST, OPTIONS"
// };
// async function generateReceiptPDF(receipt) {
//   const pdfDoc = await PDFDocument.create();
//   const page = pdfDoc.addPage([
//     595,
//     842
//   ]); // A4 Size
//   const { height } = page.getSize();
//   const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
//   const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
//   // Title
//   page.drawText("INVOICE", {
//     x: 50,
//     y: height - 60,
//     size: 28,
//     font: boldFont,
//     color: rgb(0.9, 0, 0)
//   });
//   // Invoice No
//   page.drawText(`Invoice No: ${receipt.paymentId}`, {
//     x: 50,
//     y: height - 110,
//     size: 12,
//     font
//   });
//   // Date
//   page.drawText(`Payment Date: ${receipt.paymentDate ?? "-"}`, {
//     x: 50,
//     y: height - 130,
//     size: 12,
//     font
//   });
//   // Resident
//   page.drawText(`Resident: ${receipt.residentName ?? "-"}`, {
//     x: 50,
//     y: height - 170,
//     size: 12,
//     font
//   });
//   // Flat
//   page.drawText(`Flat: ${receipt.flat ?? "-"}`, {
//     x: 50,
//     y: height - 190,
//     size: 12,
//     font
//   });
//   // Payment Type
//   page.drawText(`Payment Type: ${receipt.paymentType ?? "-"}`, {
//     x: 50,
//     y: height - 230,
//     size: 12,
//     font
//   });
//   // Amount
//   page.drawText(`Amount: INR ${receipt.amount ?? 0}`, {
//     x: 50,
//     y: height - 250,
//     size: 12,
//     font: boldFont
//   });
//   // Status
//   page.drawText(`Status: ${receipt.paymentStatus ?? "-"}`, {
//     x: 50,
//     y: height - 270,
//     size: 12,
//     font: boldFont,
//     color: receipt.paymentStatus?.toLowerCase() === "paid" ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0)
//   });
//   return await pdfDoc.save();
// }
// serve(async (req)=>{
//   // Handle CORS
//   if (req.method === "OPTIONS") {
//     return new Response("ok", {
//       headers: corsHeaders
//     });
//   }
//   try {
//     const adminClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
//     // Read request body
//     const body = await req.json();
//     const { paymentId, societyUserId } = body;
//     if (!paymentId || !societyUserId) {
//       return new Response(JSON.stringify({
//         success: false,
//         message: "paymentId and societyUserId are required"
//       }), {
//         status: 400,
//         headers: {
//           ...corsHeaders,
//           "Content-Type": "application/json"
//         }
//       });
//     }
//     if (!paymentId) {
//       return new Response(JSON.stringify({
//         success: false,
//         message: "paymentId is required"
//       }), {
//         status: 400,
//         headers: {
//           ...corsHeaders,
//           "Content-Type": "application/json"
//         }
//       });
//     }
//     // Fetch payment with relational data
//     const { data: payment, error: paymentError } = await adminClient.from("SSP_Payment").select(`
//     pay_rec_id,
//     payment_id,
//     amount,
//     due_date,
//     payment_date,
//     payment_status,
//     payment_type,
//     payment_method,
//     transaction_id,
//     month_period,
//     receipt_url,
//     facility,

//     SSP_Society_User:society_user (
//       user_id,
//       unit_flat_number,

//       SSP_Contact:contact (
//         name,
//         email,
//         phone
//       ),

//       SSP_Block:block (
//         block_name
//       ),

//       SSP_Tower:tower (
//         name
//       ),

//       SSP_Society:society (
//         society_id,
//         society_name,
//         address_line1,
//         address_line2
//       )
//     )
//   `).eq("pay_rec_id", paymentId).eq("society_user", societyUserId).single();
//     if (paymentError || !payment) {
//       return new Response(JSON.stringify({
//         success: false,
//         message: "Payment not found"
//       }), {
//         status: 404,
//         headers: {
//           ...corsHeaders,
//           "Content-Type": "application/json"
//         }
//       });
//     }
//     // Verify payment status
//     if (!payment.payment_status || payment.payment_status.toLowerCase() !== "paid") {
//       return new Response(JSON.stringify({
//         success: false,
//         message: "Receipt can only be generated for paid payments."
//       }), {
//         status: 400,
//         headers: {
//           ...corsHeaders,
//           "Content-Type": "application/json"
//         }
//       });
//     }
//     // Fetch Facility Name (Only if needed)
//     let facilityName = null;
//     if (payment.payment_type && payment.payment_type.toLowerCase() === "facility booking") {
//       const { data: booking } = await adminClient.from("SSP_Facility_Booking").select(`
//           SSP_Facility:facility (
//             name
//           )
//         `).eq("payment", payment.pay_rec_id).maybeSingle();
//       facilityName = booking?.SSP_Facility?.name ?? null;
//     }
//     // Build the Receipt Object
//     const receipt = {
//       // Payment
//       paymentId: payment.payment_id,
//       amount: payment.amount,
//       paymentDate: payment.payment_date,
//       dueDate: payment.due_date,
//       paymentStatus: payment.payment_status,
//       paymentMethod: payment.payment_method,
//       transactionId: payment.transaction_id,
//       monthPeriod: payment.month_period,
//       paymentType: facilityName ? `${payment.payment_type} - ${facilityName}` : payment.payment_type,
//       // Resident
//       residentName: payment.SSP_Society_User?.SSP_Contact?.name,
//       email: payment.SSP_Society_User?.SSP_Contact?.email,
//       phone: payment.SSP_Society_User?.SSP_Contact?.phone,
//       // Flat
//       flat: payment.SSP_Society_User?.unit_flat_number,
//       block: payment.SSP_Society_User?.SSP_Block?.block_name,
//       tower: payment.SSP_Society_User?.SSP_Tower?.name,
//       // Society
//       societyId: payment.SSP_Society_User?.SSP_Society?.society_id,
//       societyName: payment.SSP_Society_User?.SSP_Society?.society_name,
//       societyAddr1: payment.SSP_Society_User?.SSP_Society?.address_line1,
//       societyAddr2: payment.SSP_Society_User?.SSP_Society?.address_line2
//     };
//     // Generate the PDF
//     const pdfBytes = await generateReceiptPDF(receipt);
//     // Return the generated PDF file directly
//     return new Response(pdfBytes, {
//       status: 200,
//       headers: {
//         ...corsHeaders,
//         "Content-Type": "application/pdf",
//         "Content-Disposition": `attachment; filename="${receipt.paymentId || "Receipt"}.pdf"`
//       }
//     });
//   } catch (err) {
//     return new Response(JSON.stringify({
//       success: false,
//       message: err instanceof Error ? err.message : "Unknown error"
//     }), {
//       status: 500,
//       headers: {
//         ...corsHeaders,
//         "Content-Type": "application/json"
//       }
//     });
//   }
// });

// // deno-lint-ignore-file no-import-prefix
// // ============================================
// // generate-payment-receipt — PDF Receipt Generator (PROD v5)
// // ============================================
// // POST /functions/v1/generate-payment-receipt
// // Auth: Bearer <custom JWT from verify-otp> — verified with SUPABASE_JWT_SECRET
// // Body: { "paymentId": "<SSP_Payment.pay_rec_id uuid>" }
// // Returns: application/pdf attachment
// //
// // Ownership: JWT.sub → auth.users.phone → matches payment owner's contact phone
// // Branding:  society logo (header left) + app logo (footer right)
// // ============================================

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
// import {
//     PDFDocument,
//     StandardFonts,
//     rgb,
//     PDFFont,
//     PDFPage,
//     PDFImage,
// } from "https://esm.sh/pdf-lib@1.17.1";

// // ============================================
// // CONFIG
// // ============================================

// const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// const SUPABASE_JWT_SECRET =
//     Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? "";
// const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
//     .split(",").map((s) => s.trim()).filter(Boolean);

// // App branding (footer)
// const APP_LOGO_URL = Deno.env.get("APP_LOGO_URL") ?? "";
// const APP_NAME = Deno.env.get("APP_NAME") ?? "";

// // ============================================
// // TYPES
// // ============================================

// interface GenerateReceiptRequest {
//     paymentId: string;
// }

// interface PaymentRow {
//     pay_rec_id: string;
//     payment_id: string | null;
//     amount: number | string | null;
//     due_date: string | null;
//     payment_date: string | null;
//     payment_status: string | null;
//     payment_method: string | null;
//     payment_type: string | null;
//     transaction_id: string | null;
//     month_period: string | null;
//     facility: string | null;
//     rejection_reason: string | null;
//     society_user: string | null;
// }

// interface SocietyUserRow {
//     user_id: string;
//     unit_flat_number: string | null;
//     contact: {
//         contact_id: string;
//         name: string | null;
//         email: string | null;
//         phone: string | null;
//     } | null;
//     block: { block_name: string | null } | null;
//     tower: { name: string | null } | null;
//     society: {
//         society_id: string;
//         society_name: string | null;
//         registration_number: string | null;
//         address_line1: string | null;
//         address_line2: string | null;
//         city: string | null;
//         state: string | null;
//         postal_code: string | null;
//         email: string | null;
//         phone_number: string | null;
//         logo_url: string | null;
//     } | null;
// }

// interface FacilityRow {
//     id: string;
//     name: string | null;
//     facility_type: string | null;
//     opening_time: string | null;
//     closing_time: string | null;
//     description: string | null;
// }

// interface ReceiptData {
//     receiptNo: string;
//     generatedAt: string;

//     societyName: string;
//     societyAddress: string;
//     societyRegNo: string | null;
//     societyEmail: string | null;
//     societyPhone: string | null;
//     societyLogoUrl: string | null;

//     residentName: string;
//     residentEmail: string | null;
//     residentPhone: string | null;
//     flatNumber: string;
//     towerName: string | null;
//     blockName: string | null;

//     paymentId: string;
//     amount: number;
//     paymentDate: string | null;
//     dueDate: string | null;
//     paymentStatus: string;
//     paymentMethodLabel: string;
//     transactionId: string | null;
//     monthPeriod: string | null;
//     paymentTypeLabel: string;
//     rejectionReason: string | null;

//     facilityName: string | null;
//     facilityType: string | null;
//     facilityTiming: string | null;
// }

// type Err = {
//     ok: false;
//     status: number;
//     code: string;
//     message: string;
// };

// // ============================================
// // CONSTANTS
// // ============================================

// const PAYMENT_TYPE_LABELS: Record<string, string> = {
//     facility: "Facility Charges",
//     facility_booking: "Booking Advance",
//     maintenance: "Monthly Maintenance",
//     parking_charges: "Parking Charges",
//     sinking_fund: "Sinking Fund",
//     water_charges: "Water Charges",
// };

// const PAYMENT_METHOD_LABELS: Record<string, string> = {
//     qr: "QR Code Scan",
//     cash: "Cash",
//     net_banking: "Net Banking",
//     upi: "UPI Gateway",
//     credit_card: "Credit Card",
//     debit_card: "Debit Card",
//     bank_transfer: "Bank Transfer",
//     wallet: "Wallet",
// };

// const ALLOWED_STATUSES = new Set(["paid"]);

// const COLOR_PRIMARY = rgb(0.06, 0.35, 0.65);
// const COLOR_TEXT = rgb(0.1, 0.1, 0.1);
// const COLOR_MUTED = rgb(0.45, 0.45, 0.45);
// const COLOR_LINE = rgb(0.85, 0.85, 0.85);
// const COLOR_SUCCESS = rgb(0.06, 0.55, 0.22);
// const COLOR_WHITE = rgb(1, 1, 1);

// const PAGE_WIDTH = 595;
// const PAGE_HEIGHT = 842;
// const MARGIN = 45;
// const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// const BOTTOM_LIMIT = MARGIN + 40;

// // ============================================
// // CLIENT
// // ============================================

// if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
//     console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
// }
// if (!SUPABASE_JWT_SECRET) {
//     console.error("Missing SUPABASE_JWT_SECRET / JWT_SECRET — JWT verification will fail");
// }

// const adminClient: SupabaseClient = createClient(
//     SUPABASE_URL,
//     SUPABASE_SERVICE_ROLE_KEY,
//     { auth: { persistSession: false } },
// );

// const LOGO_CACHE = new Map<string, Uint8Array | null>();

// // ============================================
// // CORS
// // ============================================

// function corsHeaders(origin: string | null): Record<string, string> {
//     let allow = "*";
//     if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS[0] !== "*") {
//         allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
//     }
//     return {
//         "Access-Control-Allow-Origin": allow,
//         "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
//         "Access-Control-Allow-Methods": "POST, OPTIONS",
//         "Vary": "Origin",
//     };
// }

// // ============================================
// // VALIDATION / FORMATTERS
// // ============================================

// function isValidUUID(v: string): boolean {
//     return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
// }

// function normalizePhone(p: string | null | undefined): string {
//     if (!p) return "";
//     const digits = String(p).replace(/\D/g, "");
//     return digits.slice(-10);
// }

// function formatAmount(n: number): string {
//     return "Rs. " + n.toLocaleString("en-IN", {
//         minimumFractionDigits: 2,
//         maximumFractionDigits: 2,
//     });
// }

// function formatDate(input: string | null): string {
//     if (!input) return "-";
//     try {
//         const d = new Date(input);
//         if (isNaN(d.getTime())) return input;
//         return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
//     } catch {
//         return input;
//     }
// }

// function formatDateTime(input: string | null): string {
//     if (!input) return "-";
//     try {
//         const d = new Date(input);
//         if (isNaN(d.getTime())) return input;
//         return d.toLocaleString("en-IN", {
//             day: "2-digit", month: "short", year: "numeric",
//             hour: "2-digit", minute: "2-digit", hour12: true,
//         });
//     } catch {
//         return input;
//     }
// }

// function formatTime(t: string | null): string {
//     if (!t) return "";
//     const m = /^(\d{1,2}):(\d{2})/.exec(t);
//     if (!m) return t;
//     let h = Number(m[1]);
//     const min = m[2];
//     const ampm = h >= 12 ? "PM" : "AM";
//     if (h === 0) h = 12;
//     else if (h > 12) h -= 12;
//     return `${String(h).padStart(2, "0")}:${min} ${ampm}`;
// }

// function typeLabel(type: string | null): string {
//     if (!type) return "Payment";
//     return PAYMENT_TYPE_LABELS[type.trim()] ?? type;
// }

// function methodLabel(method: string | null): string {
//     if (!method) return "-";
//     return PAYMENT_METHOD_LABELS[method.trim()] ?? method;
// }

// function sanitizeFilename(input: string): string {
//     const cleaned = input.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 80);
//     return cleaned || "receipt";
// }

// // ============================================
// // TEXT WRAPPING
// // ============================================

// function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
//     if (!text) return [];
//     const words = String(text).split(/\s+/).filter(Boolean);
//     const lines: string[] = [];
//     let line = "";
//     for (const w of words) {
//         const test = line ? `${line} ${w}` : w;
//         if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
//             lines.push(line);
//             line = w;
//         } else {
//             line = test;
//         }
//     }
//     if (line) lines.push(line);
//     return lines.length ? lines : [String(text)];
// }

// // ============================================
// // AUTH — verify custom JWT with SUPABASE_JWT_SECRET
// // ============================================

// type AuthResult = { ok: true; authUserId: string; authPhone: string } | Err;

// async function authenticate(req: Request): Promise<AuthResult> {
//     const authHeader = req.headers.get("Authorization") ?? "";
//     if (!authHeader.startsWith("Bearer ")) {
//         return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Missing bearer token." };
//     }

//     const token = authHeader.slice("Bearer ".length).trim();
//     if (!token) {
//         return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Missing bearer token." };
//     }

//     if (!SUPABASE_JWT_SECRET) {
//         return { ok: false, status: 500, code: "SERVER_ERROR", message: "Auth not configured." };
//     }

//     let payload: { sub?: string; exp?: number };
//     try {
//         const { verify } = await import("https://deno.land/x/djwt@v2.8/mod.ts");
//         const key = await crypto.subtle.importKey(
//             "raw",
//             new TextEncoder().encode(SUPABASE_JWT_SECRET),
//             { name: "HMAC", hash: "SHA-256" },
//             false,
//             ["verify"],
//         );
//         payload = await verify(token, key) as typeof payload;
//     } catch (e) {
//         console.warn("JWT verify failed:", e);
//         return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Invalid or expired token." };
//     }

//     const authUserId = String(payload.sub ?? "").trim();
//     if (!authUserId) {
//         return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Token missing subject." };
//     }

//     const { data: adminData, error: adminErr } = await adminClient.auth.admin.getUserById(authUserId);
//     if (adminErr || !adminData?.user) {
//         console.error("admin getUserById failed:", adminErr?.message);
//         return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Could not resolve account." };
//     }

//     const authPhone = normalizePhone(adminData.user.phone);
//     if (!authPhone) {
//         return {
//             ok: false,
//             status: 401,
//             code: "UNAUTHORIZED",
//             message: "Account has no phone number on record.",
//         };
//     }

//     return { ok: true, authUserId, authPhone };
// }

// // ============================================
// // LOGO (fetch + embed, with cold-start cache)
// // ============================================

// async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
//     if (LOGO_CACHE.has(url)) return LOGO_CACHE.get(url)!;
//     try {
//         const res = await fetch(url, { redirect: "follow" });
//         if (!res.ok) {
//             console.warn(`[logo] fetch failed: HTTP ${res.status} for ${url}`);
//             LOGO_CACHE.set(url, null);
//             return null;
//         }
//         const buf = new Uint8Array(await res.arrayBuffer());
//         if (buf.length > 3_000_000) {
//             console.warn(`[logo] too large (${buf.length} bytes) — skipping ${url}`);
//             LOGO_CACHE.set(url, null);
//             return null;
//         }
//         LOGO_CACHE.set(url, buf);
//         return buf;
//     } catch (e) {
//         console.warn("[logo] fetch exception:", e);
//         LOGO_CACHE.set(url, null);
//         return null;
//     }
// }

// async function embedLogo(pdfDoc: PDFDocument, url: string | null): Promise<PDFImage | null> {
//     if (!url) return null;
//     const bytes = await fetchLogoBytes(url);
//     if (!bytes) return null;

//     // Detect magic bytes so we can report clearly if it's WebP or something unsupported
//     const magic = bytes.slice(0, 12);
//     const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
//     const isJpg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
//     const isWebp =
//         magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46 &&
//         magic[8] === 0x57 && magic[9] === 0x45 && magic[10] === 0x42 && magic[11] === 0x50;

//     if (isWebp) {
//         console.error("[logo] WebP is not supported by pdf-lib — convert to PNG or JPEG");
//         return null;
//     }

//     try {
//         if (isPng) return await pdfDoc.embedPng(bytes);
//         if (isJpg) return await pdfDoc.embedJpg(bytes);
//         // Fall back to trying both
//         try {
//             return await pdfDoc.embedPng(bytes);
//         } catch {
//             return await pdfDoc.embedJpg(bytes);
//         }
//     } catch (e) {
//         console.warn("[logo] embed failed:", e);
//         return null;
//     }
// }

// // ============================================
// // DATA FETCHER
// // ============================================

// async function fetchReceiptData(
//     paymentRecordId: string,
//     authPhone: string,
// ): Promise<{ ok: true; data: ReceiptData } | Err> {
//     // 1. Fetch payment
//     const { data: payment, error: payErr } = await adminClient
//         .from("SSP_Payment")
//         .select(`
//             pay_rec_id, payment_id, amount, due_date, payment_date,
//             payment_status, payment_method, payment_type,
//             transaction_id, month_period, facility,
//             rejection_reason, society_user
//         `)
//         .eq("pay_rec_id", paymentRecordId)
//         .maybeSingle();

//     if (payErr) {
//         console.error("Payment fetch error:", payErr);
//         return { ok: false, status: 500, code: "DATABASE_ERROR", message: "Failed to fetch payment." };
//     }
//     if (!payment) {
//         return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
//     }

//     const p = payment as PaymentRow;

//     if (!p.society_user) {
//         return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
//     }

//     // 2. Status gate — only paid
//     const status = String(p.payment_status ?? "").trim().toLowerCase();
//     if (!ALLOWED_STATUSES.has(status)) {
//         return {
//             ok: false,
//             status: 400,
//             code: "INVALID_STATUS",
//             message:
//                 `Receipt is only available for paid payments. ` +
//                 `Current status: ${p.payment_status ?? "unknown"}.`,
//         };
//     }

//     // 3. Owner + society
//     const { data: resident, error: resErr } = await adminClient
//         .from("SSP_Society_User")
//         .select(`
//             user_id,
//             unit_flat_number,
//             contact:SSP_Contact!inner (
//                 contact_id, name, email, phone
//             ),
//             block:SSP_Block!left (
//                 block_name
//             ),
//             tower:SSP_Tower!left (
//                 name
//             ),
//             society:SSP_Society!inner (
//                 society_id, society_name, registration_number,
//                 address_line1, address_line2, city, state,
//                 postal_code, email, phone_number, logo_url
//             )
//         `)
//         .eq("user_id", p.society_user)
//         .maybeSingle();

//     if (resErr) {
//         console.error("Resident fetch error:", resErr);
//         return { ok: false, status: 500, code: "DATABASE_ERROR", message: "Failed to fetch resident." };
//     }
//     if (!resident) {
//         return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
//     }

//     const r = resident as unknown as SocietyUserRow;

//     if (!r.society || !r.contact) {
//         return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
//     }

//     // 4. 🔒 OWNERSHIP CHECK
//     const ownerPhone = normalizePhone(r.contact.phone);
//     if (!ownerPhone || ownerPhone !== authPhone) {
//         return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
//     }

//     // 5. Facility (optional)
//     let facility: FacilityRow | null = null;
//     if (p.facility) {
//         const { data: fac, error: facErr } = await adminClient
//             .from("SSP_Facility")
//             .select("id,name,facility_type,opening_time,closing_time,description")
//             .eq("id", p.facility)
//             .maybeSingle();
//         if (facErr) console.warn("Facility fetch failed (continuing):", facErr.message);
//         facility = (fac as FacilityRow) ?? null;
//     }

//     // 6. Amount
//     const amount = Number(p.amount);
//     if (!Number.isFinite(amount)) {
//         return {
//             ok: false,
//             status: 500,
//             code: "INVALID_AMOUNT",
//             message: `Invalid amount on payment: ${String(p.amount)}`,
//         };
//     }

//     // 7. Build data
//     const society = r.society;
//     const addressParts = [
//         society.address_line1,
//         society.address_line2,
//         society.city,
//         society.state,
//         society.postal_code,
//     ].filter((x): x is string => !!x && String(x).trim() !== "");
//     const fullAddress = addressParts.join(", ") || "-";

//     const facilityTiming =
//         facility?.opening_time && facility?.closing_time
//             ? `${formatTime(facility.opening_time)} - ${formatTime(facility.closing_time)}`
//             : null;

//     const receiptNo = p.payment_id && p.payment_id.trim() !== ""
//         ? p.payment_id
//         : `PAY-${p.pay_rec_id.slice(0, 8).toUpperCase()}`;

//     const data: ReceiptData = {
//         receiptNo,
//         generatedAt: new Date().toISOString(),

//         societyName: society.society_name ?? "Society",
//         societyAddress: fullAddress,
//         societyRegNo: society.registration_number,
//         societyEmail: society.email,
//         societyPhone: society.phone_number,
//         societyLogoUrl: society.logo_url,

//         residentName: r.contact.name ?? `Flat ${r.unit_flat_number ?? "N/A"}`,
//         residentEmail: r.contact.email ?? null,
//         residentPhone: r.contact.phone ?? null,
//         flatNumber: r.unit_flat_number ?? "N/A",
//         towerName: r.tower?.name ?? null,
//         blockName: r.block?.block_name ?? null,

//         paymentId: p.payment_id ?? p.pay_rec_id,
//         amount,
//         paymentDate: p.payment_date,
//         dueDate: p.due_date,
//         paymentStatus: status,
//         paymentMethodLabel: methodLabel(p.payment_method),
//         transactionId: p.transaction_id,
//         monthPeriod: p.month_period,
//         paymentTypeLabel: typeLabel(p.payment_type),
//         rejectionReason: p.rejection_reason,

//         facilityName: facility?.name ?? null,
//         facilityType: facility?.facility_type ?? null,
//         facilityTiming,
//     };

//     return { ok: true, data };
// }

// // ============================================
// // PDF BUILDER
// // ============================================

// interface Ctx {
//     doc: PDFDocument;
//     page: PDFPage;
//     font: PDFFont;
//     boldFont: PDFFont;
//     italicFont: PDFFont;
//     y: number;
// }

// function ensureSpace(ctx: Ctx, needed: number) {
//     if (ctx.y - needed < BOTTOM_LIMIT) {
//         ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
//         ctx.y = PAGE_HEIGHT - MARGIN;
//     }
// }

// function drawHorizontalLine(ctx: Ctx, color = COLOR_LINE) {
//     ctx.page.drawLine({
//         start: { x: MARGIN, y: ctx.y },
//         end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
//         thickness: 0.5,
//         color,
//     });
// }

// function drawLines(
//     ctx: Ctx,
//     text: string,
//     opts: {
//         x: number;
//         maxWidth: number;
//         size: number;
//         font: PDFFont;
//         color: ReturnType<typeof rgb>;
//         lineHeight?: number;
//     },
// ) {
//     const lh = opts.lineHeight ?? opts.size + 2;
//     for (const line of wrapText(text, opts.font, opts.size, opts.maxWidth)) {
//         ensureSpace(ctx, lh);
//         ctx.page.drawText(line, {
//             x: opts.x, y: ctx.y, size: opts.size,
//             font: opts.font, color: opts.color,
//         });
//         ctx.y -= lh;
//     }
// }

// function drawLabelValue(ctx: Ctx, label: string, value: string, labelWidth = 120) {
//     ensureSpace(ctx, 20);
//     ctx.page.drawText(label, {
//         x: MARGIN, y: ctx.y, size: 9,
//         font: ctx.boldFont, color: COLOR_MUTED,
//     });
//     const maxW = PAGE_WIDTH - (MARGIN + labelWidth) - MARGIN;
//     const lines = wrapText(value, ctx.font, 10, maxW);
//     let first = true;
//     for (const line of lines) {
//         ctx.page.drawText(line, {
//             x: MARGIN + labelWidth, y: ctx.y, size: 10,
//             font: ctx.font, color: COLOR_TEXT,
//         });
//         ctx.y -= first ? 16 : 12;
//         first = false;
//     }
// }

// async function generateReceiptPDF(data: ReceiptData): Promise<Uint8Array> {
//     const doc = await PDFDocument.create();
//     const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
//     const font = await doc.embedFont(StandardFonts.Helvetica);
//     const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
//     const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

//     const ctx: Ctx = { doc, page, font, boldFont, italicFont, y: PAGE_HEIGHT - MARGIN };

//     // ── HEADER — society logo top-left ──
//     const societyLogo = await embedLogo(doc, data.societyLogoUrl);
//     const logoBoxSize = 48;
//     const logoTopY = PAGE_HEIGHT - MARGIN - 4;
//     let headerTextX = MARGIN;
//     let headerMaxW = CONTENT_WIDTH - 180;

//     if (societyLogo) {
//         const scale = Math.min(logoBoxSize / societyLogo.width, logoBoxSize / societyLogo.height, 1);
//         const w = societyLogo.width * scale;
//         const h = societyLogo.height * scale;
//         const logoY = logoTopY - h;
//         page.drawImage(societyLogo, { x: MARGIN, y: logoY, width: w, height: h });
//         headerTextX = MARGIN + logoBoxSize + 12;
//         headerMaxW = CONTENT_WIDTH - 180 - (logoBoxSize + 12);
//     }

//     for (const line of wrapText(data.societyName, boldFont, 20, headerMaxW)) {
//         page.drawText(line, {
//             x: headerTextX, y: ctx.y - 4, size: 20,
//             font: boldFont, color: COLOR_PRIMARY,
//         });
//         ctx.y -= 24;
//     }

//     for (const line of wrapText(data.societyAddress, font, 9, headerMaxW)) {
//         page.drawText(line, { x: headerTextX, y: ctx.y, size: 9, font, color: COLOR_MUTED });
//         ctx.y -= 12;
//     }

//     if (data.societyRegNo) {
//         page.drawText(`Reg No: ${data.societyRegNo}`, {
//             x: headerTextX, y: ctx.y, size: 9, font, color: COLOR_MUTED,
//         });
//         ctx.y -= 12;
//     }

//     const contactLine = [
//         data.societyPhone ? `Phone: ${data.societyPhone}` : null,
//         data.societyEmail ? `Email: ${data.societyEmail}` : null,
//     ].filter(Boolean).join("   ");
//     if (contactLine) {
//         for (const line of wrapText(contactLine, font, 9, headerMaxW)) {
//             page.drawText(line, { x: headerTextX, y: ctx.y, size: 9, font, color: COLOR_MUTED });
//             ctx.y -= 12;
//         }
//     }

//     // Right: title + status badge
//     const receiptTitle = "PAYMENT RECEIPT";
//     const titleWidth = boldFont.widthOfTextAtSize(receiptTitle, 22);
//     page.drawText(receiptTitle, {
//         x: PAGE_WIDTH - MARGIN - titleWidth, y: PAGE_HEIGHT - MARGIN - 4,
//         size: 22, font: boldFont, color: COLOR_PRIMARY,
//     });

//     const statusText = "PAID";
//     const statusTextW = boldFont.widthOfTextAtSize(statusText, 11);
//     const pad = 8;
//     const badgeW = statusTextW + pad * 2;
//     const badgeX = PAGE_WIDTH - MARGIN - badgeW;
//     const badgeY = PAGE_HEIGHT - MARGIN - 40;
//     page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: 20, color: COLOR_SUCCESS });
//     page.drawText(statusText, {
//         x: badgeX + pad, y: badgeY + 6, size: 11, font: boldFont, color: COLOR_WHITE,
//     });

//     if (ctx.y > badgeY - 20) ctx.y = badgeY - 20;
//     ctx.y -= 8;

//     drawHorizontalLine(ctx, COLOR_PRIMARY);
//     ctx.y -= 20;

//     // ── META ──
//     ensureSpace(ctx, 40);
//     const metaRight = PAGE_WIDTH / 2 + 20;
//     ctx.page.drawText("Receipt No", { x: MARGIN, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
//     ctx.page.drawText(data.receiptNo, { x: MARGIN, y: ctx.y - 12, size: 11, font: boldFont, color: COLOR_TEXT });
//     ctx.page.drawText("Generated On", { x: metaRight, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
//     ctx.page.drawText(formatDateTime(data.generatedAt), { x: metaRight, y: ctx.y - 12, size: 11, font, color: COLOR_TEXT });
//     ctx.y -= 34;

//     // ── BILLED TO ──
//     drawLines(ctx, "BILLED TO", { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font: boldFont, color: COLOR_MUTED, lineHeight: 16 });
//     drawLines(ctx, data.residentName, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 13, font: boldFont, color: COLOR_TEXT, lineHeight: 16 });
//     drawLines(ctx, `Flat: ${data.flatNumber}`, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
//     if (data.towerName || data.blockName) {
//         const tb = [data.towerName, data.blockName].filter(Boolean).join(" - ");
//         drawLines(ctx, tb, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
//     }
//     if (data.residentPhone) {
//         drawLines(ctx, `Phone: ${data.residentPhone}`, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
//     }
//     if (data.residentEmail) {
//         drawLines(ctx, `Email: ${data.residentEmail}`, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
//     }
//     ctx.y -= 10;
//     drawHorizontalLine(ctx);
//     ctx.y -= 20;

//     // ── PAYMENT TABLE ──
//     ensureSpace(ctx, 40);
//     const colAmountX = PAGE_WIDTH - MARGIN - 100;
//     ctx.page.drawRectangle({
//         x: MARGIN, y: ctx.y - 6, width: CONTENT_WIDTH, height: 22,
//         color: rgb(0.95, 0.96, 0.98),
//     });
//     ctx.page.drawText("DESCRIPTION", { x: MARGIN + 8, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
//     ctx.page.drawText("AMOUNT", { x: colAmountX, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
//     ctx.y -= 30;

//     drawLines(ctx, data.paymentTypeLabel, {
//         x: MARGIN + 8, maxWidth: CONTENT_WIDTH - 130, size: 11,
//         font: boldFont, color: COLOR_TEXT, lineHeight: 16,
//     });
//     ctx.page.drawText(formatAmount(data.amount), {
//         x: colAmountX, y: ctx.y + 16, size: 11, font: boldFont, color: COLOR_TEXT,
//     });

//     const sublines: string[] = [];
//     if (data.monthPeriod) sublines.push(`Period: ${data.monthPeriod}`);
//     if (data.facilityName) {
//         sublines.push(
//             data.facilityType
//                 ? `Facility: ${data.facilityName} (${data.facilityType})`
//                 : `Facility: ${data.facilityName}`,
//         );
//     }
//     if (data.facilityTiming) sublines.push(`Timing: ${data.facilityTiming}`);
//     if (data.dueDate) sublines.push(`Due Date: ${formatDate(data.dueDate)}`);
//     for (const line of sublines) {
//         drawLines(ctx, line, {
//             x: MARGIN + 16, maxWidth: CONTENT_WIDTH - 130, size: 9,
//             font: italicFont, color: COLOR_MUTED, lineHeight: 13,
//         });
//     }

//     ctx.y -= 6;
//     drawHorizontalLine(ctx);
//     ctx.y -= 18;

//     // ── TOTAL ──
//     ensureSpace(ctx, 30);
//     ctx.page.drawText("TOTAL", { x: colAmountX - 60, y: ctx.y, size: 12, font: boldFont, color: COLOR_TEXT });
//     ctx.page.drawText(formatAmount(data.amount), { x: colAmountX, y: ctx.y, size: 14, font: boldFont, color: COLOR_PRIMARY });
//     ctx.y -= 24;

//     // ── PAYMENT DETAILS ──
//     drawLines(ctx, "PAYMENT DETAILS", { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font: boldFont, color: COLOR_MUTED, lineHeight: 16 });
//     drawLabelValue(ctx, "Method", data.paymentMethodLabel);
//     if (data.transactionId) drawLabelValue(ctx, "Transaction ID", data.transactionId);
//     if (data.paymentDate) drawLabelValue(ctx, "Paid On", formatDateTime(data.paymentDate));
//     ctx.y -= 10;
//     drawHorizontalLine(ctx);
//     ctx.y -= 18;

//     // ── NOTES ──
//     drawLines(ctx, "NOTES", { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font: boldFont, color: COLOR_MUTED, lineHeight: 14 });
//     const terms = [
//         "- This is a computer-generated receipt and does not require a signature.",
//         "- Keep this receipt for your records.",
//         "- For any queries, please contact the society office.",
//         "- Amounts are in Indian Rupees (INR).",
//     ];
//     for (const line of terms) {
//         drawLines(ctx, line, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font, color: COLOR_MUTED, lineHeight: 12 });
//     }

//     // ── FOOTER — generation info (left) + app branding (right) ──
//     ensureSpace(ctx, 45);
//     drawHorizontalLine(ctx);
//     ctx.y -= 12;

//     const footerText = `Generated on ${formatDateTime(data.generatedAt)} - Thank you!`;
//     ctx.page.drawText(footerText, {
//         x: MARGIN, y: ctx.y, size: 8, font: italicFont, color: COLOR_MUTED,
//     });

//     if (APP_LOGO_URL || APP_NAME) {
//         const appLogo = APP_LOGO_URL ? await embedLogo(doc, APP_LOGO_URL) : null;
//         const appLogoH = 14;
//         const appLogoMaxW = 90;
//         let rightEdge = PAGE_WIDTH - MARGIN;

//         // "Powered by <APP_NAME>" text — right-aligned
//         if (APP_NAME) {
//             const label = `Powered by ${APP_NAME}`;
//             const labelW = italicFont.widthOfTextAtSize(label, 8);
//             ctx.page.drawText(label, {
//                 x: rightEdge - labelW,
//                 y: ctx.y,
//                 size: 8,
//                 font: italicFont,
//                 color: COLOR_MUTED,
//             });
//             rightEdge -= labelW + 8;
//         }

//         // App logo to the left of the text
//         if (appLogo) {
//             const scale = appLogoH / appLogo.height;
//             const w = Math.min(appLogo.width * scale, appLogoMaxW);
//             const h = appLogoH;
//             ctx.page.drawImage(appLogo, {
//                 x: rightEdge - w,
//                 y: ctx.y - 3,     // align visually with italic text
//                 width: w,
//                 height: h,
//             });
//         }
//     }

//     return await doc.save();
// }

// // ============================================
// // RESPONSE
// // ============================================

// function jsonError(req: Request, message: string, status = 400, code = "ERROR"): Response {
//     return new Response(
//         JSON.stringify({ success: false, errorResponse: { errorCode: code, message } }),
//         {
//             status,
//             headers: {
//                 ...corsHeaders(req.headers.get("origin")),
//                 "Content-Type": "application/json",
//             },
//         },
//     );
// }

// // ============================================
// // MAIN
// // ============================================

// serve(async (req: Request) => {
//     const origin = req.headers.get("origin");

//     if (req.method === "OPTIONS") {
//         return new Response("ok", { headers: corsHeaders(origin) });
//     }
//     if (req.method !== "POST") {
//         return jsonError(req, "Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
//     }

//     const startTime = Date.now();

//     try {
//         const body = (await req.json().catch(() => null)) as GenerateReceiptRequest | null;
//         if (!body) return jsonError(req, "Request body is required.", 400, "BAD_REQUEST");

//         const paymentId = String(body.paymentId ?? "").trim();
//         if (!paymentId) return jsonError(req, "paymentId is required.", 400, "MISSING_PARAMETERS");
//         if (!isValidUUID(paymentId)) {
//             return jsonError(req, "paymentId must be a valid UUID.", 400, "INVALID_PARAMETERS");
//         }

//         const auth = await authenticate(req);
//         if (!auth.ok) return jsonError(req, auth.message, auth.status, auth.code);

//         const result = await fetchReceiptData(paymentId, auth.authPhone);
//         if (!result.ok) return jsonError(req, result.message, result.status, result.code);

//         const pdfBytes = await generateReceiptPDF(result.data);

//         const safeNo = sanitizeFilename(result.data.receiptNo);
//         const filename = `Receipt_${safeNo}.pdf`;

//         console.log(
//             `generate-payment-receipt OK paymentId=${paymentId} user=${auth.authUserId} ` +
//                 `bytes=${pdfBytes.length} ms=${Date.now() - startTime}`,
//         );

//         return new Response(pdfBytes, {
//             status: 200,
//             headers: {
//                 ...corsHeaders(origin),
//                 "Content-Type": "application/pdf",
//                 "Content-Disposition": `attachment; filename="${filename}"`,
//                 "Cache-Control": "no-store, no-cache, must-revalidate",
//                 "Content-Length": String(pdfBytes.length),
//             },
//         });
//     } catch (err: unknown) {
//         const msg = err instanceof Error ? err.message : "Unknown error";
//         console.error("generate-payment-receipt error:", msg);
//         return jsonError(req, "Internal server error.", 500, "SERVER_ERROR");
//     }
// });


// deno-lint-ignore-file no-import-prefix no-explicit-any
// ============================================
// generate-payment-receipt — Download + List + Generate (PROD v6)
// ============================================
// POST /functions/v1/generate-payment-receipt
//
// Auth: Bearer <custom JWT from verify-otp> — verified with SUPABASE_JWT_SECRET
// Ownership: JWT.sub → auth.users.phone → matches payment owner's contact phone
//
// Three modes (auto-detected from the body):
//   A. { "paymentId": "<uuid>" }          → download by pay_rec_id
//   B. { "paymentId": "PAY-..." }         → download by payment_id
//   C. { "list": true, ... }              → list caller's receipts
//
// Download behavior:
//   1. If a stored file exists (receipt_url OR SSP_Document.s3_path)
//      → normalize key, sign for 300s, return JSON { mode: "url", downloadUrl }
//   2. Else → generate PDF on the fly, return binary with X-Receipt-Source: generated
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
    PDFDocument,
    StandardFonts,
    rgb,
    PDFFont,
    PDFPage,
    PDFImage,
} from "https://esm.sh/pdf-lib@1.17.1";
// ✅ FIX 1: Moved djwt import to the top to resolve dynamic import TS error
import { verify } from "https://deno.land/x/djwt@v2.8/mod.ts";

// ============================================
// CONFIG
// ============================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_JWT_SECRET =
    Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
    .split(",").map((s) => s.trim()).filter(Boolean);

// App branding (footer)
const APP_LOGO_URL = Deno.env.get("APP_LOGO_URL") ?? "";
const APP_NAME = Deno.env.get("APP_NAME") ?? "";

const BUCKET_NAME = "society-documents";
const SIGNED_URL_EXPIRY = 300; // seconds

// ============================================
// TYPES
// ============================================

interface DownloadRequest {
    paymentId: string;
}

interface ListRequest {
    list: true;
    filters?: {
        paymentStatus?: string;
        startDate?: string;
        endDate?: string;
        searchQuery?: string;
    };
    pagination?: {
        page?: number;
        pageSize?: number;
    };
}

interface PaymentRow {
    pay_rec_id: string;
    payment_id: string | null;
    amount: number | string | null;
    due_date: string | null;
    payment_date: string | null;
    payment_status: string | null;
    payment_method: string | null;
    payment_type: string | null;
    transaction_id: string | null;
    month_period: string | null;
    facility: string | null;
    rejection_reason: string | null;
    society_user: string | null;
    receipt_url: string | null;
    created_at: string | null;
}

interface SocietyUserRow {
    user_id: string;
    unit_flat_number: string | null;
    contact: {
        contact_id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
    } | null;
    block: { block_name: string | null } | null;
    tower: { name: string | null } | null;
    society: {
        society_id: string;
        society_name: string | null;
        registration_number: string | null;
        address_line1: string | null;
        address_line2: string | null;
        city: string | null;
        state: string | null;
        postal_code: string | null;
        email: string | null;
        phone_number: string | null;
        logo_url: string | null;
    } | null;
}

interface FacilityRow {
    id: string;
    name: string | null;
    facility_type: string | null;
    opening_time: string | null;
    closing_time: string | null;
    description: string | null;
}

interface ReceiptData {
    receiptNo: string;
    generatedAt: string;

    societyName: string;
    societyAddress: string;
    societyRegNo: string | null;
    societyEmail: string | null;
    societyPhone: string | null;
    societyLogoUrl: string | null;

    residentName: string;
    residentEmail: string | null;
    residentPhone: string | null;
    flatNumber: string;
    towerName: string | null;
    blockName: string | null;

    paymentId: string;
    amount: number;
    paymentDate: string | null;
    dueDate: string | null;
    paymentStatus: string;
    paymentMethodLabel: string;
    transactionId: string | null;
    monthPeriod: string | null;
    paymentTypeLabel: string;
    rejectionReason: string | null;

    facilityName: string | null;
    facilityType: string | null;
    facilityTiming: string | null;
}

type Err = {
    ok: false;
    status: number;
    code: string;
    message: string;
};

// ✅ FIX 2: Explicit type definitions for proper TypeScript narrowing
type AuthSuccess = { ok: true; authUserId: string; authPhone: string };
type AuthResult = AuthSuccess | Err;

// ============================================
// CONSTANTS
// ============================================

const PAYMENT_TYPE_LABELS: Record<string, string> = {
    facility: "Facility Charges",
    facility_booking: "Booking Advance",
    maintenance: "Monthly Maintenance",
    parking_charges: "Parking Charges",
    sinking_fund: "Sinking Fund",
    water_charges: "Water Charges",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
    qr: "QR Code Scan",
    cash: "Cash",
    net_banking: "Net Banking",
    upi: "UPI Gateway",
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    bank_transfer: "Bank Transfer",
    wallet: "Wallet",
};

const ALLOWED_STATUSES = new Set(["paid"]);

const COLOR_PRIMARY = rgb(0.06, 0.35, 0.65);
const COLOR_TEXT = rgb(0.1, 0.1, 0.1);
const COLOR_MUTED = rgb(0.45, 0.45, 0.45);
const COLOR_LINE = rgb(0.85, 0.85, 0.85);
const COLOR_SUCCESS = rgb(0.06, 0.55, 0.22);
const COLOR_WHITE = rgb(1, 1, 1);

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 45;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = MARGIN + 40;

// ============================================
// CLIENT
// ============================================

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}
if (!SUPABASE_JWT_SECRET) {
    console.error("Missing SUPABASE_JWT_SECRET / JWT_SECRET — JWT verification will fail");
}

const adminClient: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
);

const LOGO_CACHE = new Map<string, Uint8Array | null>();

// ============================================
// CORS
// ============================================

function corsHeaders(origin: string | null): Record<string, string> {
    let allow = "*";
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS[0] !== "*") {
        allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    }
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}

// ============================================
// VALIDATION / FORMATTERS
// ============================================

function isValidUUID(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizePhone(p: string | null | undefined): string {
    if (!p) return "";
    const digits = String(p).replace(/\D/g, "");
    return digits.slice(-10);
}

function formatAmount(n: number): string {
    return "Rs. " + n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatDate(input: string | null): string {
    if (!input) return "-";
    try {
        const d = new Date(input);
        if (isNaN(d.getTime())) return input;
        return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
        return input;
    }
}

function formatDateTime(input: string | null): string {
    if (!input) return "-";
    try {
        const d = new Date(input);
        if (isNaN(d.getTime())) return input;
        return d.toLocaleString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: true,
        });
    } catch {
        return input;
    }
}

function formatTime(t: string | null): string {
    if (!t) return "";
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return t;
    let h = Number(m[1]);
    const min = m[2];
    const ampm = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${String(h).padStart(2, "0")}:${min} ${ampm}`;
}

function typeLabel(type: string | null): string {
    if (!type) return "Payment";
    return PAYMENT_TYPE_LABELS[type.trim()] ?? type;
}

function methodLabel(method: string | null): string {
    if (!method) return "-";
    return PAYMENT_METHOD_LABELS[method.trim()] ?? method;
}

function sanitizeFilename(input: string): string {
    const cleaned = input.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 80);
    return cleaned || "receipt";
}

// ============================================
// STORAGE KEY NORMALIZATION
// ============================================

function normalizeStorageKey(raw: string | null | undefined): string {
    if (!raw) return "";
    let key = String(raw).trim();

    // Strip query string
    const q = key.indexOf("?");
    if (q !== -1) key = key.substring(0, q);

    // Strip any supabase storage URL prefix
    const supabaseMarkers = [
        `/storage/v1/object/public/${BUCKET_NAME}/`,
        `/storage/v1/object/sign/${BUCKET_NAME}/`,
        `/storage/v1/object/authenticated/${BUCKET_NAME}/`,
    ];
    for (const m of supabaseMarkers) {
        const i = key.indexOf(m);
        if (i !== -1) {
            key = key.substring(i + m.length);
            break;
        }
    }

    // Strip S3-style URL
    const s3Marker = ".amazonaws.com/";
    const s3Idx = key.indexOf(s3Marker);
    if (s3Idx !== -1) {
        key = key.substring(s3Idx + s3Marker.length);
        // If first path segment matches bucket name, drop it
        if (key.startsWith(`${BUCKET_NAME}/`)) {
            key = key.substring(BUCKET_NAME.length + 1);
        }
    }

    // Strip leading slashes
    key = key.replace(/^\/+/, "");

    // Strip redundant bucket-name prefix (when stored as relative path with bucket)
    if (key.startsWith(`${BUCKET_NAME}/`)) {
        key = key.substring(BUCKET_NAME.length + 1);
    }

    return key;
}

// ============================================
// TEXT WRAPPING
// ============================================

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    if (!text) return [];
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
            lines.push(line);
            line = w;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [String(text)];
}

// ============================================
// AUTH
// ============================================

async function authenticate(req: Request): Promise<AuthResult> {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Missing bearer token." };
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Missing bearer token." };
    }

    if (!SUPABASE_JWT_SECRET) {
        return { ok: false, status: 500, code: "SERVER_ERROR", message: "Auth not configured." };
    }

    let payload: { sub?: string; exp?: number };
    try {
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(SUPABASE_JWT_SECRET),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"],
        );
        payload = await verify(token, key) as typeof payload;
    } catch (e) {
        console.warn("JWT verify failed:", e);
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Invalid or expired token." };
    }

    const authUserId = String(payload.sub ?? "").trim();
    if (!authUserId) {
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Token missing subject." };
    }

    const { data: adminData, error: adminErr } = await adminClient.auth.admin.getUserById(authUserId);
    if (adminErr || !adminData?.user) {
        console.error("admin getUserById failed:", adminErr?.message);
        return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Could not resolve account." };
    }

    const authPhone = normalizePhone(adminData.user.phone);
    if (!authPhone) {
        return {
            ok: false,
            status: 401,
            code: "UNAUTHORIZED",
            message: "Account has no phone number on record.",
        };
    }

    return { ok: true, authUserId, authPhone };
}

// ============================================
// LOGO
// ============================================

async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
    if (LOGO_CACHE.has(url)) return LOGO_CACHE.get(url)!;
    try {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) {
            console.warn(`[logo] fetch failed: HTTP ${res.status} for ${url}`);
            LOGO_CACHE.set(url, null);
            return null;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > 3_000_000) {
            console.warn(`[logo] too large (${buf.length} bytes) — skipping ${url}`);
            LOGO_CACHE.set(url, null);
            return null;
        }
        LOGO_CACHE.set(url, buf);
        return buf;
    } catch (e) {
        console.warn("[logo] fetch exception:", e);
        LOGO_CACHE.set(url, null);
        return null;
    }
}

async function embedLogo(pdfDoc: PDFDocument, url: string | null): Promise<PDFImage | null> {
    if (!url) return null;
    const bytes = await fetchLogoBytes(url);
    if (!bytes) return null;

    const magic = bytes.slice(0, 12);
    const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
    const isJpg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
    const isWebp =
        magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46 &&
        magic[8] === 0x57 && magic[9] === 0x45 && magic[10] === 0x42 && magic[11] === 0x50;

    if (isWebp) {
        console.error("[logo] WebP is not supported by pdf-lib — convert to PNG or JPEG");
        return null;
    }

    try {
        if (isPng) return await pdfDoc.embedPng(bytes);
        if (isJpg) return await pdfDoc.embedJpg(bytes);
        try {
            return await pdfDoc.embedPng(bytes);
        } catch {
            return await pdfDoc.embedJpg(bytes);
        }
    } catch (e) {
        console.warn("[logo] embed failed:", e);
        return null;
    }
}

// ============================================
// PAYMENT RESOLUTION (owner-scoped)
// ============================================

async function resolvePaymentForCaller(
    identifier: string,
    authPhone: string,
): Promise<{ ok: true; payment: PaymentRow } | Err> {
    const isUuid = isValidUUID(identifier);

    let query = adminClient
        .from("SSP_Payment")
        .select(`
            pay_rec_id, payment_id, amount, due_date, payment_date,
            payment_status, payment_method, payment_type,
            transaction_id, month_period, facility,
            rejection_reason, society_user, receipt_url, created_at
        `);

    if (isUuid) {
        query = query.eq("pay_rec_id", identifier);
    } else {
        query = query.eq("payment_id", identifier);
    }

    const { data: payment, error: payErr } = await query.maybeSingle();

    if (payErr) {
        console.error("Payment fetch error:", payErr);
        return { ok: false, status: 500, code: "DATABASE_ERROR", message: "Failed to fetch payment." };
    }
    if (!payment) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
    }

    const p = payment as PaymentRow;

    if (!p.society_user) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
    }

    // Ownership check via owner's contact phone
    const { data: owner, error: ownerErr } = await adminClient
        .from("SSP_Society_User")
        .select(`user_id, contact:SSP_Contact!inner( phone )`)
        .eq("user_id", p.society_user)
        .maybeSingle();

    if (ownerErr || !owner) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
    }

    const ownerAny = owner as any;
    const ownerPhone = normalizePhone(ownerAny.contact?.phone);
    if (!ownerPhone || ownerPhone !== authPhone) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Payment not found." };
    }

    return { ok: true, payment: p };
}

// ============================================
// STORED FILE RESOLUTION
// ============================================

async function trySignedUrl(
    payment: PaymentRow,
): Promise<{ ok: true; downloadUrl: string; fileName: string } | { ok: false }> {
    // 1. Prefer payment.receipt_url
    let rawUrl: string | null = payment.receipt_url ?? null;
    let fileLabel: string | null = null;

    // 2. Fall back to SSP_Document.s3_path
    if (!rawUrl) {
        const { data: doc } = await adminClient
            .from("SSP_Document")
            .select("s3_path, file_name")
            .eq("payment", payment.pay_rec_id)
            .not("s3_path", "is", null)
            .limit(1)
            .maybeSingle();

        if (doc?.s3_path) {
            rawUrl = doc.s3_path;
            fileLabel = (doc as any).file_name ?? null;
        }
    }

    if (!rawUrl) return { ok: false };

    const key = normalizeStorageKey(rawUrl);
    if (!key) return { ok: false };

    const fileName = fileLabel || key.split("/").pop() || `Receipt_${payment.payment_id ?? payment.pay_rec_id}.pdf`;

    const { data: signed, error: signErr } = await adminClient
        .storage
        .from(BUCKET_NAME)
        .createSignedUrl(key, SIGNED_URL_EXPIRY, { download: fileName });

    if (signErr || !signed?.signedUrl) {
        console.warn(`[storage] sign failed for key="${key}": ${signErr?.message ?? "no url"}`);
        return { ok: false };
    }

    return { ok: true, downloadUrl: signed.signedUrl, fileName };
}

// ============================================
// PDF GENERATION
// ============================================

interface Ctx {
    doc: PDFDocument;
    page: PDFPage;
    font: PDFFont;
    boldFont: PDFFont;
    italicFont: PDFFont;
    y: number;
}

function ensureSpace(ctx: Ctx, needed: number) {
    if (ctx.y - needed < BOTTOM_LIMIT) {
        ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        ctx.y = PAGE_HEIGHT - MARGIN;
    }
}

function drawHorizontalLine(ctx: Ctx, color = COLOR_LINE) {
    ctx.page.drawLine({
        start: { x: MARGIN, y: ctx.y },
        end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
        thickness: 0.5,
        color,
    });
}

function drawLines(
    ctx: Ctx,
    text: string,
    opts: {
        x: number;
        maxWidth: number;
        size: number;
        font: PDFFont;
        color: ReturnType<typeof rgb>;
        lineHeight?: number;
    },
) {
    const lh = opts.lineHeight ?? opts.size + 2;
    for (const line of wrapText(text, opts.font, opts.size, opts.maxWidth)) {
        ensureSpace(ctx, lh);
        ctx.page.drawText(line, {
            x: opts.x, y: ctx.y, size: opts.size,
            font: opts.font, color: opts.color,
        });
        ctx.y -= lh;
    }
}

function drawLabelValue(ctx: Ctx, label: string, value: string, labelWidth = 120) {
    ensureSpace(ctx, 20);
    ctx.page.drawText(label, {
        x: MARGIN, y: ctx.y, size: 9,
        font: ctx.boldFont, color: COLOR_MUTED,
    });
    const maxW = PAGE_WIDTH - (MARGIN + labelWidth) - MARGIN;
    const lines = wrapText(value, ctx.font, 10, maxW);
    let first = true;
    for (const line of lines) {
        ctx.page.drawText(line, {
            x: MARGIN + labelWidth, y: ctx.y, size: 10,
            font: ctx.font, color: COLOR_TEXT,
        });
        ctx.y -= first ? 16 : 12;
        first = false;
    }
}

async function buildReceiptDataFromPayment(payment: PaymentRow): Promise<{ ok: true; data: ReceiptData } | Err> {
    // Status gate
    const status = String(payment.payment_status ?? "").trim().toLowerCase();
    if (!ALLOWED_STATUSES.has(status)) {
        return {
            ok: false,
            status: 400,
            code: "INVALID_STATUS",
            message:
                `Receipt is only available for paid payments. ` +
                `Current status: ${payment.payment_status ?? "unknown"}.`,
        };
    }

    // Owner + society
    const { data: resident, error: resErr } = await adminClient
        .from("SSP_Society_User")
        .select(`
            user_id,
            unit_flat_number,
            contact:SSP_Contact!inner (
                contact_id, name, email, phone
            ),
            block:SSP_Block!left ( block_name ),
            tower:SSP_Tower!left ( name ),
            society:SSP_Society!inner (
                society_id, society_name, registration_number,
                address_line1, address_line2, city, state,
                postal_code, email, phone_number, logo_url
            )
        `)
        .eq("user_id", payment.society_user)
        .maybeSingle();

    if (resErr || !resident) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Resident not found." };
    }

    const r = resident as unknown as SocietyUserRow;
    if (!r.society || !r.contact) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Resident data incomplete." };
    }

    let facility: FacilityRow | null = null;
    if (payment.facility) {
        const { data: fac } = await adminClient
            .from("SSP_Facility")
            .select("id,name,facility_type,opening_time,closing_time,description")
            .eq("id", payment.facility)
            .maybeSingle();
        facility = (fac as FacilityRow) ?? null;
    }

    const amount = Number(payment.amount);
    if (!Number.isFinite(amount)) {
        return {
            ok: false,
            status: 500,
            code: "INVALID_AMOUNT",
            message: `Invalid amount on payment: ${String(payment.amount)}`,
        };
    }

    const society = r.society;
    const addressParts = [
        society.address_line1, society.address_line2, society.city,
        society.state, society.postal_code,
    ].filter((x): x is string => !!x && String(x).trim() !== "");
    const fullAddress = addressParts.join(", ") || "-";

    const facilityTiming =
        facility?.opening_time && facility?.closing_time
            ? `${formatTime(facility.opening_time)} - ${formatTime(facility.closing_time)}`
            : null;

    const receiptNo = payment.payment_id && payment.payment_id.trim() !== ""
        ? payment.payment_id
        : `PAY-${payment.pay_rec_id.slice(0, 8).toUpperCase()}`;

    const data: ReceiptData = {
        receiptNo,
        generatedAt: new Date().toISOString(),

        societyName: society.society_name ?? "Society",
        societyAddress: fullAddress,
        societyRegNo: society.registration_number,
        societyEmail: society.email,
        societyPhone: society.phone_number,
        societyLogoUrl: society.logo_url,

        residentName: r.contact.name ?? `Flat ${r.unit_flat_number ?? "N/A"}`,
        residentEmail: r.contact.email ?? null,
        residentPhone: r.contact.phone ?? null,
        flatNumber: r.unit_flat_number ?? "N/A",
        towerName: r.tower?.name ?? null,
        blockName: r.block?.block_name ?? null,

        paymentId: payment.payment_id ?? payment.pay_rec_id,
        amount,
        paymentDate: payment.payment_date,
        dueDate: payment.due_date,
        paymentStatus: status,
        paymentMethodLabel: methodLabel(payment.payment_method),
        transactionId: payment.transaction_id,
        monthPeriod: payment.month_period,
        paymentTypeLabel: typeLabel(payment.payment_type),
        rejectionReason: payment.rejection_reason,

        facilityName: facility?.name ?? null,
        facilityType: facility?.facility_type ?? null,
        facilityTiming,
    };

    return { ok: true, data };
}

async function generateReceiptPDF(data: ReceiptData): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

    const ctx: Ctx = { doc, page, font, boldFont, italicFont, y: PAGE_HEIGHT - MARGIN };

    const societyLogo = await embedLogo(doc, data.societyLogoUrl);
    const logoBoxSize = 48;
    const logoTopY = PAGE_HEIGHT - MARGIN - 4;
    let headerTextX = MARGIN;
    let headerMaxW = CONTENT_WIDTH - 180;

    if (societyLogo) {
        const scale = Math.min(logoBoxSize / societyLogo.width, logoBoxSize / societyLogo.height, 1);
        const w = societyLogo.width * scale;
        const h = societyLogo.height * scale;
        const logoY = logoTopY - h;
        page.drawImage(societyLogo, { x: MARGIN, y: logoY, width: w, height: h });
        headerTextX = MARGIN + logoBoxSize + 12;
        headerMaxW = CONTENT_WIDTH - 180 - (logoBoxSize + 12);
    }

    for (const line of wrapText(data.societyName, boldFont, 20, headerMaxW)) {
        page.drawText(line, {
            x: headerTextX, y: ctx.y - 4, size: 20,
            font: boldFont, color: COLOR_PRIMARY,
        });
        ctx.y -= 24;
    }

    for (const line of wrapText(data.societyAddress, font, 9, headerMaxW)) {
        page.drawText(line, { x: headerTextX, y: ctx.y, size: 9, font, color: COLOR_MUTED });
        ctx.y -= 12;
    }

    if (data.societyRegNo) {
        page.drawText(`Reg No: ${data.societyRegNo}`, {
            x: headerTextX, y: ctx.y, size: 9, font, color: COLOR_MUTED,
        });
        ctx.y -= 12;
    }

    const contactLine = [
        data.societyPhone ? `Phone: ${data.societyPhone}` : null,
        data.societyEmail ? `Email: ${data.societyEmail}` : null,
    ].filter(Boolean).join("   ");
    if (contactLine) {
        for (const line of wrapText(contactLine, font, 9, headerMaxW)) {
            page.drawText(line, { x: headerTextX, y: ctx.y, size: 9, font, color: COLOR_MUTED });
            ctx.y -= 12;
        }
    }

    const receiptTitle = "PAYMENT RECEIPT";
    const titleWidth = boldFont.widthOfTextAtSize(receiptTitle, 22);
    page.drawText(receiptTitle, {
        x: PAGE_WIDTH - MARGIN - titleWidth, y: PAGE_HEIGHT - MARGIN - 4,
        size: 22, font: boldFont, color: COLOR_PRIMARY,
    });

    const statusText = "PAID";
    const statusTextW = boldFont.widthOfTextAtSize(statusText, 11);
    const pad = 8;
    const badgeW = statusTextW + pad * 2;
    const badgeX = PAGE_WIDTH - MARGIN - badgeW;
    const badgeY = PAGE_HEIGHT - MARGIN - 40;
    page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: 20, color: COLOR_SUCCESS });
    page.drawText(statusText, {
        x: badgeX + pad, y: badgeY + 6, size: 11, font: boldFont, color: COLOR_WHITE,
    });

    if (ctx.y > badgeY - 20) ctx.y = badgeY - 20;
    ctx.y -= 8;

    drawHorizontalLine(ctx, COLOR_PRIMARY);
    ctx.y -= 20;

    ensureSpace(ctx, 40);
    const metaRight = PAGE_WIDTH / 2 + 20;
    ctx.page.drawText("Receipt No", { x: MARGIN, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
    ctx.page.drawText(data.receiptNo, { x: MARGIN, y: ctx.y - 12, size: 11, font: boldFont, color: COLOR_TEXT });
    ctx.page.drawText("Generated On", { x: metaRight, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
    ctx.page.drawText(formatDateTime(data.generatedAt), { x: metaRight, y: ctx.y - 12, size: 11, font, color: COLOR_TEXT });
    ctx.y -= 34;

    drawLines(ctx, "BILLED TO", { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font: boldFont, color: COLOR_MUTED, lineHeight: 16 });
    drawLines(ctx, data.residentName, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 13, font: boldFont, color: COLOR_TEXT, lineHeight: 16 });
    drawLines(ctx, `Flat: ${data.flatNumber}`, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
    if (data.towerName || data.blockName) {
        const tb = [data.towerName, data.blockName].filter(Boolean).join(" - ");
        drawLines(ctx, tb, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
    }
    if (data.residentPhone) {
        drawLines(ctx, `Phone: ${data.residentPhone}`, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
    }
    if (data.residentEmail) {
        drawLines(ctx, `Email: ${data.residentEmail}`, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 10, font, color: COLOR_TEXT, lineHeight: 12 });
    }
    ctx.y -= 10;
    drawHorizontalLine(ctx);
    ctx.y -= 20;

    ensureSpace(ctx, 40);
    const colAmountX = PAGE_WIDTH - MARGIN - 100;
    ctx.page.drawRectangle({
        x: MARGIN, y: ctx.y - 6, width: CONTENT_WIDTH, height: 22,
        color: rgb(0.95, 0.96, 0.98),
    });
    ctx.page.drawText("DESCRIPTION", { x: MARGIN + 8, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
    ctx.page.drawText("AMOUNT", { x: colAmountX, y: ctx.y, size: 9, font: boldFont, color: COLOR_MUTED });
    ctx.y -= 30;

    drawLines(ctx, data.paymentTypeLabel, {
        x: MARGIN + 8, maxWidth: CONTENT_WIDTH - 130, size: 11,
        font: boldFont, color: COLOR_TEXT, lineHeight: 16,
    });
    ctx.page.drawText(formatAmount(data.amount), {
        x: colAmountX, y: ctx.y + 16, size: 11, font: boldFont, color: COLOR_TEXT,
    });

    const sublines: string[] = [];
    if (data.monthPeriod) sublines.push(`Period: ${data.monthPeriod}`);
    if (data.facilityName) {
        sublines.push(
            data.facilityType
                ? `Facility: ${data.facilityName} (${data.facilityType})`
                : `Facility: ${data.facilityName}`,
        );
    }
    if (data.facilityTiming) sublines.push(`Timing: ${data.facilityTiming}`);
    if (data.dueDate) sublines.push(`Due Date: ${formatDate(data.dueDate)}`);
    for (const line of sublines) {
        drawLines(ctx, line, {
            x: MARGIN + 16, maxWidth: CONTENT_WIDTH - 130, size: 9,
            font: italicFont, color: COLOR_MUTED, lineHeight: 13,
        });
    }

    ctx.y -= 6;
    drawHorizontalLine(ctx);
    ctx.y -= 18;

    ensureSpace(ctx, 30);
    ctx.page.drawText("TOTAL", { x: colAmountX - 60, y: ctx.y, size: 12, font: boldFont, color: COLOR_TEXT });
    ctx.page.drawText(formatAmount(data.amount), { x: colAmountX, y: ctx.y, size: 14, font: boldFont, color: COLOR_PRIMARY });
    ctx.y -= 24;

    drawLines(ctx, "PAYMENT DETAILS", { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font: boldFont, color: COLOR_MUTED, lineHeight: 16 });
    drawLabelValue(ctx, "Method", data.paymentMethodLabel);
    if (data.transactionId) drawLabelValue(ctx, "Transaction ID", data.transactionId);
    if (data.paymentDate) drawLabelValue(ctx, "Paid On", formatDateTime(data.paymentDate));
    ctx.y -= 10;
    drawHorizontalLine(ctx);
    ctx.y -= 18;

    drawLines(ctx, "NOTES", { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font: boldFont, color: COLOR_MUTED, lineHeight: 14 });
    const terms = [
        "- This is a computer-generated receipt and does not require a signature.",
        "- Keep this receipt for your records.",
        "- For any queries, please contact the society office.",
        "- Amounts are in Indian Rupees (INR).",
    ];
    for (const line of terms) {
        drawLines(ctx, line, { x: MARGIN, maxWidth: CONTENT_WIDTH, size: 9, font, color: COLOR_MUTED, lineHeight: 12 });
    }

    ensureSpace(ctx, 45);
    drawHorizontalLine(ctx);
    ctx.y -= 12;

    const footerText = `Generated on ${formatDateTime(data.generatedAt)} - Thank you!`;
    ctx.page.drawText(footerText, {
        x: MARGIN, y: ctx.y, size: 8, font: italicFont, color: COLOR_MUTED,
    });

    if (APP_LOGO_URL || APP_NAME) {
        const appLogo = APP_LOGO_URL ? await embedLogo(doc, APP_LOGO_URL) : null;
        const appLogoH = 14;
        const appLogoMaxW = 90;
        let rightEdge = PAGE_WIDTH - MARGIN;

        if (APP_NAME) {
            const label = `Powered by ${APP_NAME}`;
            const labelW = italicFont.widthOfTextAtSize(label, 8);
            ctx.page.drawText(label, {
                x: rightEdge - labelW, y: ctx.y, size: 8,
                font: italicFont, color: COLOR_MUTED,
            });
            rightEdge -= labelW + 8;
        }

        if (appLogo) {
            const scale = appLogoH / appLogo.height;
            const w = Math.min(appLogo.width * scale, appLogoMaxW);
            const h = appLogoH;
            ctx.page.drawImage(appLogo, {
                x: rightEdge - w, y: ctx.y - 3,
                width: w, height: h,
            });
        }
    }

    return await doc.save();
}

// ============================================
// RESPONSE HELPERS
// ============================================

function jsonError(req: Request, message: string, status = 400, code = "ERROR"): Response {
    return new Response(
        JSON.stringify({ success: false, errorResponse: { errorCode: code, message, timestamp: new Date().toISOString() } }),
        {
            status,
            headers: {
                ...corsHeaders(req.headers.get("origin")),
                "Content-Type": "application/json",
            },
        },
    );
}

function jsonOk(req: Request, payload: Record<string, unknown>): Response {
    return new Response(
        JSON.stringify({ success: true, ...payload }),
        {
            status: 200,
            headers: {
                ...corsHeaders(req.headers.get("origin")),
                "Content-Type": "application/json",
            },
        },
    );
}

// ============================================
// MODE: LIST RECEIPTS
// ============================================

async function listReceipts(
    req: Request,
    authPhone: string,
    body: ListRequest,
): Promise<Response> {
    const page = Math.max(1, Number(body.pagination?.page ?? 1) | 0);
    const pageSize = Math.min(100, Math.max(1, Number(body.pagination?.pageSize ?? 10) | 0));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Find all SSP_Society_User ids whose contact phone matches caller
    const { data: myUsers, error: uErr } = await adminClient
        .from("SSP_Society_User")
        .select(`user_id, contact:SSP_Contact!inner( phone )`);

    if (uErr) {
        console.error("List: user lookup failed", uErr);
        return jsonError(req, "Failed to resolve account.", 500, "DATABASE_ERROR");
    }

    const myIds: string[] = (myUsers ?? [])
        .filter((u: any) => normalizePhone(u.contact?.phone) === authPhone)
        .map((u: any) => u.user_id);

    if (myIds.length === 0) {
        return jsonOk(req, {
            mode: "list",
            receipts: [],
            pagination: { page, pageSize, total: 0, totalPages: 1 },
        });
    }

    // Build query
    let q = adminClient
        .from("SSP_Payment")
        .select(`
            pay_rec_id, payment_id, payment_status, amount, created_at,
            receipt_url,
            document:SSP_Document( s3_path, file_name )
        `, { count: "exact" })
        .in("society_user", myIds);

    const f = body.filters ?? {};
    if (f.paymentStatus) {
        q = q.ilike("payment_status", String(f.paymentStatus).trim());
    } else {
        // Default to paid only? No — user can browse history. Leave unfiltered.
    }
    if (f.startDate) q = q.gte("created_at", String(f.startDate));
    if (f.endDate) q = q.lte("created_at", String(f.endDate));
    if (f.searchQuery) {
        const s = String(f.searchQuery).trim().replace(/[%_,()]/g, "");
        if (s) q = q.ilike("payment_id", `%${s}%`);
    }

    q = q.order("created_at", { ascending: false });
    q = q.range(from, to);

    const { data, error, count } = await q;
    if (error) {
        console.error("List: query failed", error);
        return jsonError(req, "Failed to fetch receipts.", 500, "DATABASE_ERROR");
    }

    const rows = (data ?? []) as any[];
    const total = count ?? rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const receipts = rows.map((row) => {
        const doc = Array.isArray(row.document) ? row.document[0] : row.document;
        const hasStoredUrl = Boolean(row.receipt_url || doc?.s3_path);
        const fileName = doc?.file_name
            ?? (row.receipt_url ? normalizeStorageKey(row.receipt_url).split("/").pop() : null)
            ?? (row.payment_id ? `Receipt_${row.payment_id}.pdf` : `Receipt_${row.pay_rec_id}.pdf`);

        return {
            payRecId: row.pay_rec_id,
            paymentId: row.payment_id,
            paymentStatus: row.payment_status,
            amount: row.amount,
            createdAt: row.created_at,
            hasReceipt: hasStoredUrl,
            source: hasStoredUrl ? "stored" : "generatable",
            fileName,
        };
    });

    return jsonOk(req, {
        mode: "list",
        receipts,
        pagination: { page, pageSize, total, totalPages },
    });
}

// ============================================
// MODE: DOWNLOAD
// ============================================

async function downloadReceipt(
    req: Request,
    authPhone: string,
    identifier: string,
): Promise<Response> {
    const resolved = await resolvePaymentForCaller(identifier, authPhone);
    if (resolved.ok === false) {
        return jsonError(req, resolved.message, resolved.status, resolved.code);
    }
    const payment = resolved.payment;

    // Status gate
    const status = String(payment.payment_status ?? "").trim().toLowerCase();
    if (!ALLOWED_STATUSES.has(status)) {
        return jsonError(
            req,
            `Receipt is only available for paid payments. Current status: ${payment.payment_status ?? "unknown"}.`,
            400,
            "INVALID_STATUS",
        );
    }

    // 1. Try stored file
    const stored = await trySignedUrl(payment);
    if (stored.ok) {
        return jsonOk(req, {
            mode: "url",
            source: "stored",
            payRecId: payment.pay_rec_id,
            paymentId: payment.payment_id,
            fileName: stored.fileName,
            downloadUrl: stored.downloadUrl,
            expiresIn: SIGNED_URL_EXPIRY,
        });
    }

    // 2. Fall back to generating PDF
    const built = await buildReceiptDataFromPayment(payment);
    if (built.ok === false) {
        return jsonError(req, built.message, built.status, built.code);
    }

    const pdfBytes = await generateReceiptPDF(built.data);
    const safeNo = sanitizeFilename(built.data.receiptNo);
    const filename = `Receipt_${safeNo}.pdf`;
    
    // ✅ SSP-0009 FIX: Upload the generated PDF to storage and return a signed URL
    // instead of sending raw bytes to the Flutter app (which breaks JSON parsing).
    const objectKey = `receipts/${payment.pay_rec_id}_${filename}`;
    
    const { error: uploadErr } = await adminClient
        .storage
        .from(BUCKET_NAME)
        .upload(objectKey, pdfBytes, {
            contentType: "application/pdf",
            upsert: true,
        });

    if (uploadErr) {
        console.error("Failed to upload generated PDF:", uploadErr);
        return jsonError(req, "Failed to generate receipt file.", 500, "STORAGE_ERROR");
    }

    // Save to DB so next time it uses the fast path
    await adminClient
        .from("SSP_Payment")
        .update({ receipt_url: objectKey })
        .eq("pay_rec_id", payment.pay_rec_id);

    // Generate signed URL for the newly uploaded file
    const { data: signed, error: signErr } = await adminClient
        .storage
        .from(BUCKET_NAME)
        .createSignedUrl(objectKey, SIGNED_URL_EXPIRY, { download: filename });

    if (signErr || !signed?.signedUrl) {
        return jsonError(req, "Failed to generate download URL.", 500, "STORAGE_ERROR");
    }

    // ✅ Now it always returns JSON! 
    return jsonOk(req, {
        mode: "url",
        source: "generated",
        payRecId: payment.pay_rec_id,
        paymentId: payment.payment_id,
        fileName: filename,
        downloadUrl: signed.signedUrl,
        expiresIn: SIGNED_URL_EXPIRY,
    });
}

// ============================================
// MAIN
// ============================================

serve(async (req: Request) => {
    const origin = req.headers.get("origin");

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders(origin) });
    }
    if (req.method !== "POST") {
        return jsonError(req, "Only POST method is allowed.", 405, "METHOD_NOT_ALLOWED");
    }

    const startTime = Date.now();

    try {
        const body = (await req.json().catch(() => null)) as any;
        if (!body) return jsonError(req, "Request body is required.", 400, "BAD_REQUEST");

        const auth = await authenticate(req);
        
        // ✅ FIX 2: Using === false for TypeScript narrowing
        if (auth.ok === false) {
            return jsonError(req, auth.message, auth.status, auth.code);
        }

        // Mode: list
        if (body.list === true) {
            return await listReceipts(req, auth.authPhone, body as ListRequest);
        }

        // Mode: download
        const paymentId = String(body.paymentId ?? "").trim();
        if (!paymentId) {
            return jsonError(req, "paymentId is required.", 400, "MISSING_PARAMETERS");
        }

        const response = await downloadReceipt(req, auth.authPhone, paymentId);

        console.log(
            `generate-payment-receipt OK paymentId=${paymentId} user=${auth.authUserId} ` +
                `status=${response.status} ms=${Date.now() - startTime}`,
        );

        return response;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("generate-payment-receipt error:", msg);
        return jsonError(req, "Internal server error.", 500, "SERVER_ERROR");
    }
});