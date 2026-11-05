export interface ValidationError {
    field: string;
    message: string;
}

export function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function validateRequired(value: any): boolean {
    return value !== null && value !== undefined && value !== "";
}

export function validateString(value: any): boolean {
    return typeof value === "string";
}

export function validateNumber(value: any): boolean {
    return typeof value === "number" && !isNaN(value);
}

export function validateMinLength(value: string, min: number): boolean {
    return value.length >= min;
}

export function validateMaxLength(value: string, max: number): boolean {
    return value.length <= max;
}

export function validateRange(
    value: number,
    min: number,
    max: number,
): boolean {
    return value >= min && value <= max;
}

export class Validator {
    private errors: ValidationError[] = [];

    validateField(
        value: any,
        fieldName: string,
        validators: ((value: any) => boolean)[],
        errorMessage: string,
    ): this {
        for (const validator of validators) {
            if (!validator(value)) {
                this.errors.push({ field: fieldName, message: errorMessage });
                break;
            }
        }
        return this;
    }

    validateEmail(value: string, fieldName: string): this {
        if (!validateEmail(value)) {
            this.errors.push({
                field: fieldName,
                message: "Invalid email format",
            });
        }
        return this;
    }

    validateRequired(value: any, fieldName: string): this {
        if (!validateRequired(value)) {
            this.errors.push({
                field: fieldName,
                message: "Field is required",
            });
        }
        return this;
    }

    validateMinLength(value: string, fieldName: string, min: number): this {
        if (!validateMinLength(value, min)) {
            this.errors.push({
                field: fieldName,
                message: `Must be at least ${min} characters`,
            });
        }
        return this;
    }

    getErrors(): ValidationError[] {
        return this.errors;
    }

    isValid(): boolean {
        return this.errors.length === 0;
    }
}

// Validation schemas for specific use cases
export const validationSchemas = {
    alert: {
        create: (data: any) => {
            const validator = new Validator();
            validator
                .validateRequired(data.message, "message")
                .validateMinLength(data.message, "message", 3)
                .validateRequired(data.type, "type")
                .validateRequired(data.severity, "severity");
            return validator;
        },
    },
    user: {
        update: (data: any) => {
            const validator = new Validator();
            if (data.email) {
                validator.validateEmail(data.email, "email");
            }
            if (data.full_name) {
                validator.validateMinLength(data.full_name, "full_name", 2);
            }
            return validator;
        },
    },
};
