export function sanitizeString(input: string): string {
    if (!input) return "";
    return input.trim().replace(/[<>]/g, "");
}

/**
 * Sanitize a phone number by removing all non-digit characters
 */
export function sanitizePhone(input: string): string {
    if (!input) return "";
    return input.replace(/\D/g, "");
}

/**
 * Sanitize an email address
 */
export function sanitizeEmail(input: string): string {
    if (!input) return "";
    return input.trim().toLowerCase();
}

/**
 * Sanitize a name (capitalize first letter of each word)
 */
export function sanitizeName(input: string): string {
    if (!input) return "";
    return input.trim().replace(/\s+/g, " ").split(" ")
        .map((word) =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(" ");
}

/**
 * Sanitize an ID proof number (uppercase, remove spaces)
 */
export function sanitizeIdProofNumber(input: string): string {
    if (!input) return "";
    return input.trim().toUpperCase().replace(/\s/g, "");
}

/**
 * Sanitize a status value
 */
export function sanitizeStatus(input: string | boolean): string | boolean {
    if (typeof input === "boolean") return input;
    if (!input) return false;
    const trimmed = input.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "active") return true;
    if (trimmed === "false" || trimmed === "inactive") return false;
    return trimmed;
}

/**
 * Sanitize pagination parameters
 */
export function sanitizePagination(
    page: any,
    limit: any,
): { page: number; limit: number } {
    const parsedPage = parseInt(String(page), 10);
    const parsedLimit = parseInt(String(limit), 10);

    return {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: Math.min(
            isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit,
            100,
        ),
    };
}

/**
 * Sanitize an object by applying a sanitizer function to each string field
 */
export function sanitizeObject<T extends Record<string, any>>(
    obj: T,
    fields: Array<keyof T>,
    sanitizer: (value: string) => string,
): T {
    const result = { ...obj };
    for (const field of fields) {
        if (result[field] && typeof result[field] === "string") {
            result[field] = sanitizer(result[field]) as any;
        }
    }
    return result;
}
