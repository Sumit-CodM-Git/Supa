// ============================================
// _shared/utils.ts - Fixed Version (Complete)
// ============================================

// ============================================
// ENVIRONMENT
// ============================================
export function getEnv(key: string): string {
    const value = Deno.env.get(key);
    if (!value) {
        throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
}

// ============================================
// REQUEST PARSING
// ============================================
export async function parseRequestBody<T = Record<string, unknown>>(
    req: Request,
): Promise<T | null> {
    try {
        const body = await req.json();
        return body as T;
    } catch (error) {
        console.error("Failed to parse request body:", error);
        return null;
    }
}

// ============================================
// PAGINATION
// ============================================
export function getPaginationParams(url: URL): {
    page: number;
    limit: number;
    offset: number;
} {
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = Math.min(
        parseInt(url.searchParams.get("limit") || "20", 10),
        100,
    );
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

export function getSearchParams(url: URL): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
        if (key !== "page" && key !== "limit") {
            params[key] = value;
        }
    }
    return params;
}

// ============================================
// ID & TIMESTAMP
// ============================================
export function generateId(): string {
    return crypto.randomUUID();
}

export function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

// ============================================
// DATA EXTRACTION
// ============================================
export function firstOrNull<T>(arr: T | T[] | null | undefined): T | null {
    if (!arr) return null;
    if (Array.isArray(arr)) {
        return arr.length > 0 ? arr[0] : null;
    }
    return arr;
}

export function extractRelation<T>(
    relation: T | T[] | null | undefined,
): T | null {
    if (!relation) return null;
    if (Array.isArray(relation)) {
        return relation.length > 0 ? relation[0] : null;
    }
    return relation;
}

// ============================================
// SANITIZATION
// ============================================
export function sanitizeString(input: string): string {
    if (!input) return "";
    return input.trim().replace(/[<>]/g, "");
}

export function sanitizePhone(input: string): string {
    if (!input) return "";
    return input.replace(/\D/g, "");
}

export function sanitizeEmail(input: string): string {
    if (!input) return "";
    return input.trim().toLowerCase();
}

// ============================================
// ROLE PARSING - Fixed
// ============================================
export function parseRoleArray(role: unknown): string[] {
    if (Array.isArray(role)) {
        return role.filter((item): item is string => typeof item === "string");
    }
    if (typeof role === "string") {
        const cleaned = role.replace(/[{}"]/g, "");
        if (cleaned.includes(",")) {
            return cleaned.split(",").map((r: string) => r.trim()).filter(
                Boolean,
            );
        }
        return [cleaned.trim()];
    }
    return [];
}

// ============================================
// SEARCH QUERY BUILDER - Fixed
// ============================================
export function buildSearchQuery<T>(
    baseQuery: T,
    searchTerm: string,
    fields: string[],
): T {
    if (!searchTerm || searchTerm.trim() === "") {
        return baseQuery;
    }

    const term = searchTerm.trim();
    // ✅ FIX: Use type assertion with proper typing
    let query = baseQuery as {
        or: (condition: string) => typeof baseQuery;
    };

    for (const field of fields) {
        query = query.or(`${field}.ilike.%${term}%`);
    }

    return query as T;
}

// ============================================
// PAGINATED RESPONSE BUILDER - Fixed
// ============================================
export type FilterObject = Record<string, unknown>;

export function buildPaginatedResponse<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
    filters?: FilterObject | null,
    search?: string | null,
): {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    items: T[];
    filters?: FilterObject;
    search?: string | null;
} {
    const result: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        items: T[];
        filters?: FilterObject;
        search?: string | null;
    } = {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items,
    };

    if (filters) {
        result.filters = filters;
    }

    if (search !== undefined) {
        result.search = search;
    }

    return result;
}

// ============================================
// ✅ EXPORT ArrayHandler (so it's available)
// ============================================
export { ArrayHandler } from "./array-handler.ts";

// ============================================
// ✅ EXPORT Logger
// ============================================
export { createLogger, logger } from "./logger.ts";
