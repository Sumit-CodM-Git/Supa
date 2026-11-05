// ============================================
// _shared/response.ts - Fixed Version
// ============================================

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// ============================================
// Type for error details
// ============================================
export type ErrorDetails = Record<string, unknown> | string | null;

// ============================================
// Type for filter object in paginated response
// ============================================
export type FilterObject = Record<string, unknown>;

// ============================================
// Success Response
// ============================================
export function successResponse<T>(data: T, status: number = 200): Response {
    return new Response(
        JSON.stringify({
            success: true,
            data,
        }),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

// ============================================
// Error Response
// ============================================
export function errorResponse(
    message: string,
    status: number = 400,
    details: ErrorDetails = null,
): Response {
    const response: Record<string, unknown> = {
        success: false,
        error: "ERROR",
        message,
    };

    if (details) {
        response.details = details;
    }

    return new Response(
        JSON.stringify(response),
        {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}

// ============================================
// Paginated Response
// ============================================
export function paginatedResponse<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
    filters: FilterObject | null = null,
    search: string | null = null,
): Response {
    const data: Record<string, unknown> = {
        items,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };

    if (filters) {
        data.filters = filters;
    }

    if (search !== undefined && search !== null) {
        data.search = search;
    }

    return new Response(
        JSON.stringify({
            success: true,
            data,
        }),
        {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
    );
}
