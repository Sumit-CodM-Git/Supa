// ============================================
// _shared/logger.ts - Fixed Version
// ============================================

type LogLevel = "info" | "warn" | "error" | "debug";

// ============================================
// LogData interface - Remove index signature to fix conflicts
// ============================================
interface LogData {
    level: LogLevel;
    timestamp: string;
    service?: string;
    userId?: string;
    action?: string;
    message?: string;
    duration?: number;
    count?: number;
    stack?: string;
    error?: string;
    [key: string]: string | number | undefined; // Only allow string/number/undefined
}

// ============================================
// Logger Class
// ============================================
class Logger {
    private service: string;

    constructor(service: string = "edge-function") {
        this.service = service;
    }

    private log(
        level: LogLevel,
        data: Omit<LogData, "level" | "timestamp">,
    ): void {
        const logEntry: LogData = {
            level,
            timestamp: new Date().toISOString(),
            service: this.service,
            ...data,
        };

        if (level === "error") {
            console.error(JSON.stringify(logEntry));
        } else if (level === "warn") {
            console.warn(JSON.stringify(logEntry));
        } else if (level === "debug") {
            console.debug(JSON.stringify(logEntry));
        } else {
            console.log(JSON.stringify(logEntry));
        }
    }

    info(data: Omit<LogData, "level" | "timestamp">): void {
        this.log("info", data);
    }

    warn(data: Omit<LogData, "level" | "timestamp">): void {
        this.log("warn", data);
    }

    error(data: Omit<LogData, "level" | "timestamp">): void {
        this.log("error", data);
    }

    debug(data: Omit<LogData, "level" | "timestamp">): void {
        this.log("debug", data);
    }

    // Quick methods for common patterns
    requestStart(action: string, userId?: string): void {
        this.info({
            action,
            userId,
            message: `Request started: ${action}`,
        });
    }

    requestEnd(action: string, duration: number, count: number = 0): void {
        this.info({
            action,
            duration,
            count,
            message: `Request completed: ${action} (${duration}ms)`,
        });
    }

    requestError(action: string, error: Error, userId?: string): void {
        this.error({
            action,
            userId,
            message: error.message,
            stack: error.stack,
        });
    }
}

// ============================================
// Type for log data without level and timestamp
// ============================================
export type LogDataInput = Omit<LogData, "level" | "timestamp">;

// ============================================
// Create and export singleton instances
// ============================================
export const createLogger = (service: string): Logger => new Logger(service);
export const logger = new Logger();

// Quick function for one-off logging
export const log = {
    info: (data: LogDataInput) => logger.info(data),
    warn: (data: LogDataInput) => logger.warn(data),
    error: (data: LogDataInput) => logger.error(data),
    debug: (data: LogDataInput) => logger.debug(data),
};
