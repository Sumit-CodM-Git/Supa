// ============================================
// _shared/errors.ts - Fixed Version
// ============================================

import { corsHeaders } from "./response.ts";

export const ErrorCodes = {
    BAD_REQUEST: "BAD_REQUEST",
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    DUPLICATE_DATA: "DUPLICATE_DATA",
    ALREADY_OCCUPIED: "ALREADY_OCCUPIED",
    SERVER_ERROR: "SERVER_ERROR",
    METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
    INVALID_TOKEN: "INVALID_TOKEN",
    USER_NOT_FOUND: "USER_NOT_FOUND",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================
// Type for error details
// ============================================
export type ErrorDetails = Record<string, unknown> | string | null;

// ============================================
// ApiError Class
// ============================================
export class ApiError extends Error {
    public readonly code: ErrorCode;
    public readonly status: number;
    public readonly details: ErrorDetails;

    constructor(
        code: ErrorCode,
        message: string,
        status: number = 400,
        details: ErrorDetails = null,
    ) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
        Object.setPrototypeOf(this, ApiError.prototype);
    }

    toResponse(): Response {
        const body: Record<string, unknown> = {
            success: false,
            error: this.code,
            message: this.message,
            details: this.details || null,
            errorResponse: {
                errorCode: this.code,
                message: this.message,
                timestamp: new Date().toISOString(),
            },
        };

        return new Response(
            JSON.stringify(body),
            {
                status: this.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    }
}

// ============================================
// Factory functions for common errors
// ============================================
export function badRequest(
    message: string,
    details: ErrorDetails = null,
): ApiError {
    return new ApiError(ErrorCodes.BAD_REQUEST, message, 400, details);
}

export function unauthorized(message: string = "Unauthorized"): ApiError {
    return new ApiError(ErrorCodes.UNAUTHORIZED, message, 401);
}

export function notFound(message: string = "Not found"): ApiError {
    return new ApiError(ErrorCodes.NOT_FOUND, message, 404);
}

export function conflict(
    message: string,
    details: ErrorDetails = null,
): ApiError {
    return new ApiError(ErrorCodes.CONFLICT, message, 409, details);
}

export function serverError(
    message: string = "Internal server error",
): ApiError {
    return new ApiError(ErrorCodes.SERVER_ERROR, message, 500);
}

export function methodNotAllowed(
    message: string = "Method not allowed",
): ApiError {
    return new ApiError(ErrorCodes.METHOD_NOT_ALLOWED, message, 405);
}

export function userNotFound(message: string = "User not found"): ApiError {
    return new ApiError(ErrorCodes.USER_NOT_FOUND, message, 404);
}

export function duplicateData(message: string): ApiError {
    return new ApiError(ErrorCodes.DUPLICATE_DATA, message, 400);
}

export function alreadyOccupied(message: string): ApiError {
    return new ApiError(ErrorCodes.ALREADY_OCCUPIED, message, 400);
}

// ============================================
// Error handler middleware
// ============================================
export function handleError(error: unknown): Response {
    if (error instanceof ApiError) {
        return error.toResponse();
    }

    // Log unexpected errors
    console.error("Unhandled error:", error);

    const errorMessage = error instanceof Error
        ? error.message
        : "Internal server error";

    return new ApiError(
        ErrorCodes.SERVER_ERROR,
        errorMessage,
        500,
    ).toResponse();
}
