// ============================================================
// supabase/functions/_shared/razorpay.ts
// ============================================================
// Thin, dependency-free Razorpay client using fetch().
// Uses Deno native crypto for HMAC — no external libraries.
//
// Env vars required (fall back to placeholders in dev):
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
//   RAZORPAY_WEBHOOK_SECRET
// ============================================================

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

// ─────────────────────────────────────────────
// Env accessors
// ─────────────────────────────────────────────
export function getKeyId(): string {
    return Deno.env.get("RAZORPAY_KEY_ID") ?? "rzp_test_PLACEHOLDER";
}

export function getKeySecret(): string {
    return Deno.env.get("RAZORPAY_KEY_SECRET") ?? "PLACEHOLDER_SECRET";
}

export function getWebhookSecret(): string {
    return Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ??
        "PLACEHOLDER_WEBHOOK_SECRET";
}

export function isTestMode(): boolean {
    const keyId = getKeyId();
    return keyId.includes("PLACEHOLDER") || keyId.startsWith("rzp_test_");
}

// ─────────────────────────────────────────────
// Basic auth header
// ─────────────────────────────────────────────
function basicAuthHeader(): string {
    const creds = `${getKeyId()}:${getKeySecret()}`;
    return "Basic " + btoa(creds);
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface RazorpayOrder {
    id: string;
    entity: string;
    amount: number; // paise
    amount_paid: number;
    amount_due: number;
    currency: string;
    receipt: string;
    status: "created" | "attempted" | "paid";
    attempts: number;
    notes: Record<string, string>;
    created_at: number;
}

export interface RazorpayPayment {
    id: string;
    entity: string;
    amount: number; // paise
    currency: string;
    status: "created" | "authorized" | "captured" | "refunded" | "failed";
    order_id: string;
    invoice_id: string | null;
    method: string;
    captured: boolean;
    description: string | null;
    email: string | null;
    contact: string | null;
    notes: Record<string, string>;
    fee: number | null;
    tax: number | null;
    error_code: string | null;
    error_description: string | null;
    created_at: number;
}

export interface CreateOrderInput {
    amount: number; // paise
    currency: string; // "INR"
    receipt: string;
    notes: Record<string, string>;
}

// ─────────────────────────────────────────────
// Create order
// ─────────────────────────────────────────────
export async function createOrder(
    input: CreateOrderInput,
): Promise<RazorpayOrder> {
    const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
        method: "POST",
        headers: {
            "Authorization": basicAuthHeader(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(
            `Razorpay createOrder failed (${res.status}): ${
                JSON.stringify(data)
            }`,
        );
    }

    return data as RazorpayOrder;
}

// ─────────────────────────────────────────────
// Fetch order
// ─────────────────────────────────────────────
export async function fetchOrder(orderId: string): Promise<RazorpayOrder> {
    const res = await fetch(`${RAZORPAY_API_BASE}/orders/${orderId}`, {
        method: "GET",
        headers: { "Authorization": basicAuthHeader() },
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(
            `Razorpay fetchOrder failed (${res.status}): ${
                JSON.stringify(data)
            }`,
        );
    }

    return data as RazorpayOrder;
}

// ─────────────────────────────────────────────
// Fetch payment
// ─────────────────────────────────────────────
export async function fetchPayment(
    paymentId: string,
): Promise<RazorpayPayment> {
    const res = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}`, {
        method: "GET",
        headers: { "Authorization": basicAuthHeader() },
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(
            `Razorpay fetchPayment failed (${res.status}): ${
                JSON.stringify(data)
            }`,
        );
    }

    return data as RazorpayPayment;
}

// ─────────────────────────────────────────────
// Verify payment signature (client checkout)
// HMAC-SHA256(orderId + "|" + paymentId, keySecret)
// ─────────────────────────────────────────────
export async function verifyPaymentSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
}): Promise<boolean> {
    const message = `${input.orderId}|${input.paymentId}`;
    const expected = await hmacSha256Hex(message, getKeySecret());
    // Constant-time-ish comparison
    if (expected.length !== input.signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ input.signature.charCodeAt(i);
    }
    return diff === 0;
}

// ─────────────────────────────────────────────
// Verify webhook signature
// HMAC-SHA256(rawBody, webhookSecret)
// ─────────────────────────────────────────────
export async function verifyWebhookSignature(input: {
    rawBody: string;
    signature: string;
}): Promise<boolean> {
    const expected = await hmacSha256Hex(input.rawBody, getWebhookSecret());
    if (expected.length !== input.signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ input.signature.charCodeAt(i);
    }
    return diff === 0;
}

// ─────────────────────────────────────────────
// HMAC-SHA256 → hex string
// ─────────────────────────────────────────────
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(message),
    );
    return Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
