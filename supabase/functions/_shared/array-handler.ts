export class ArrayHandler {
    /**
     * Convert various input formats to a clean string array
     */
    static toArray(
        input: string | string[] | null | undefined,
        options?: {
            trim?: boolean;
            removeEmpty?: boolean;
            unique?: boolean;
            lowercase?: boolean;
        },
    ): string[] {
        if (!input) return [];

        const opts = {
            trim: true,
            removeEmpty: true,
            unique: false,
            lowercase: false,
            ...options,
        };

        let result: string[] = [];

        if (Array.isArray(input)) {
            result = input
                .filter((item: string | null | undefined) =>
                    item !== null && item !== undefined
                )
                .map(String);
        } else if (typeof input === "string") {
            const trimmed = input.trim();

            if (!trimmed) return [];

            // PostgreSQL array format: {value1,value2}
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                const content = trimmed.slice(1, -1);
                if (content === "") return [];
                result = content.split(",").map((s: string) => s.trim());
            } // Comma-separated string
            else if (trimmed.includes(",")) {
                result = trimmed.split(",").map((s: string) => s.trim());
            } // Single value
            else {
                result = [trimmed];
            }
        }

        if (opts.trim) result = result.map((s: string) => s.trim());
        if (opts.lowercase) result = result.map((s: string) => s.toLowerCase());
        if (opts.removeEmpty) result = result.filter((s: string) => s !== "");
        if (opts.unique) result = [...new Set(result)];

        return result;
    }

    static toResponseArray(
        input: string | string[] | null | undefined,
    ): string[] {
        return this.toArray(input, {
            trim: true,
            removeEmpty: true,
            unique: true,
        });
    }

    static join(
        input: string | string[] | null | undefined,
        separator: string = ", ",
    ): string {
        return this.toArray(input).join(separator);
    }

    static normalize(input: string | string[] | null | undefined): string[] {
        return this.toArray(input, {
            trim: true,
            removeEmpty: true,
            unique: true,
        });
    }

    static contains(
        input: string | string[] | null | undefined,
        value: string,
    ): boolean {
        const arr = this.toArray(input);
        return arr.some((item: string) =>
            item.toLowerCase() === value.toLowerCase()
        );
    }

    static toPostgresArray(
        input: string | string[] | null | undefined,
    ): string | null {
        const arr = this.toArray(input);
        if (arr.length === 0) return null;
        return `{${arr.join(",")}}`;
    }

    static add(
        input: string | string[] | null | undefined,
        value: string,
    ): string[] {
        const arr = this.toArray(input);
        if (!arr.includes(value)) {
            arr.push(value);
        }
        return arr;
    }

    static remove(
        input: string | string[] | null | undefined,
        value: string,
    ): string[] {
        return this.toArray(input).filter((item: string) => item !== value);
    }

    static intersection(
        arr1: string | string[] | null | undefined,
        arr2: string | string[] | null | undefined,
    ): string[] {
        const a1 = this.normalize(arr1);
        const a2 = this.normalize(arr2);
        return a1.filter((value: string) => a2.includes(value));
    }

    static union(
        arr1: string | string[] | null | undefined,
        arr2: string | string[] | null | undefined,
    ): string[] {
        const a1 = this.normalize(arr1);
        const a2 = this.normalize(arr2);
        return [...new Set([...a1, ...a2])];
    }

    static isEmpty(input: string | string[] | null | undefined): boolean {
        return this.toArray(input).length === 0;
    }

    static length(input: string | string[] | null | undefined): number {
        return this.toArray(input).length;
    }

    static equals(
        arr1: string | string[] | null | undefined,
        arr2: string | string[] | null | undefined,
    ): boolean {
        const a1 = this.normalize(arr1).sort();
        const a2 = this.normalize(arr2).sort();
        if (a1.length !== a2.length) return false;
        return a1.every((val: string, index: number) => val === a2[index]);
    }
}
