/**
 * Comprehensive Logger Configuration
 * Supports timestamps, ports, messages, errors, API handlers, and more
 */

import winston from "winston";
import { Request, Response } from "express";

// Custom log levels
const logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Custom colors for each level
const logColors = {
    error: "red",
    warn: "yellow",
    info: "green",
    http: "magenta",
    debug: "cyan",
};

winston.addColors(logColors);

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, service, port, method, url, statusCode, error, ...meta }) => {
        let logMessage = `[${timestamp}]`;

        // Add service name if available
        if (service) {
            logMessage += ` [${service}]`;
        }

        // Add port if available
        if (port) {
            logMessage += ` [Port:${port}]`;
        }

        // Add HTTP request info if available
        if (method && url) {
            logMessage += ` [${method} ${url}]`;
        }

        // Add status code if available
        if (statusCode) {
            logMessage += ` [Status:${statusCode}]`;
        }

        logMessage += ` ${level}: ${message}`;

        // Add error details if available
        if (error) {
            if (error instanceof Error) {
                logMessage += `\n  Error: ${error.message}`;
                if (error.stack && process.env.NODE_ENV === "development") {
                    logMessage += `\n  Stack: ${error.stack}`;
                }
            } else {
                logMessage += `\n  Error: ${JSON.stringify(error)}`;
            }
        }

        // Add additional metadata
        const metaKeys = Object.keys(meta).filter(
            (key) => !["timestamp", "level", "message", "service", "port", "method", "url", "statusCode", "error"].includes(key)
        );
        if (metaKeys.length > 0) {
            logMessage += `\n  Meta: ${JSON.stringify(Object.fromEntries(metaKeys.map((k) => [k, meta[k]])))}`;
        }

        return logMessage;
    })
);

// File format (without colors, more detailed)
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create the logger instance
const logger = winston.createLogger({
    levels: logLevels,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    format: fileFormat,
    defaultMeta: {
        service: process.env.SERVICE_NAME || "unknown-service",
        environment: process.env.NODE_ENV || "development",
    },
    transports: [
        // Console transport with colored output (stdout/stderr)
        new winston.transports.Console({
            format: process.env.NODE_ENV === "production" ? fileFormat : consoleFormat,
        }),
    ],
    // Handle exceptions and rejections (stdout/stderr only)
    exceptionHandlers: [
        new winston.transports.Console({
            format: process.env.NODE_ENV === "production" ? fileFormat : consoleFormat,
        }),
    ],
    rejectionHandlers: [
        new winston.transports.Console({
            format: process.env.NODE_ENV === "production" ? fileFormat : consoleFormat,
        }),
    ],
});

// Helper functions for structured logging

/**
 * Log service startup
 */
export const logServiceStart = (serviceName: string, port: number) => {
    logger.info(`🚀 ${serviceName} started successfully`, {
        service: serviceName,
        port,
        timestamp: new Date().toISOString(),
    });
};

/**
 * Log service shutdown
 */
export const logServiceStop = (serviceName: string, port: number) => {
    logger.info(`🛑 ${serviceName} stopped`, {
        service: serviceName,
        port,
        timestamp: new Date().toISOString(),
    });
};

/**
 * Log API request
 */
export const logApiRequest = (req: Request, res: Response, responseTime?: number) => {
    const logData: any = {
        method: req.method,
        url: req.originalUrl || req.url,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
        statusCode: res.statusCode,
    };

    if (responseTime !== undefined) {
        logData.responseTime = `${responseTime}ms`;
    }

    if (res.statusCode >= 400) {
        logger.warn(`API Request`, logData);
    } else {
        logger.http(`API Request`, logData);
    }
};

/**
 * Log API error
 * Client errors (4xx) are logged as warnings, server errors (5xx) as errors
 */
export const logApiError = (
    error: Error,
    req: Request,
    res: Response,
    statusCode: number = 500
) => {
    const logData = {
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode,
        error: {
            name: error.name,
            message: error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        },
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
    };

    // Log client errors (4xx) as warnings, server errors (5xx) as errors
    if (statusCode >= 400 && statusCode < 500) {
        // Client errors (invalid tokens, not found, etc.) - expected scenarios
        logger.warn(`API Error: ${error.message}`, logData);
    } else {
        // Server errors - unexpected issues that need attention
        logger.error(`API Error: ${error.message}`, logData);
    }
};

/**
 * Log database operation
 */
export const logDatabaseOperation = (
    operation: string,
    collection?: string,
    details?: any
) => {
    logger.debug(`Database ${operation}`, {
        operation,
        collection,
        ...details,
    });
};

/**
 * Log authentication event
 */
export const logAuthEvent = (
    event: "login" | "logout" | "register" | "token_refresh" | "token_verify",
    userId?: string,
    success: boolean = true,
    details?: any
) => {
    const level = success ? "info" : "warn";
    logger[level](`Auth Event: ${event}`, {
        event,
        userId,
        success,
        ...details,
    });
};

/**
 * Log security event
 */
export const logSecurityEvent = (
    event: string,
    severity: "low" | "medium" | "high" | "critical",
    details?: any
) => {
    const level = severity === "critical" || severity === "high" ? "error" : "warn";
    logger[level](`Security Event: ${event}`, {
        event,
        severity,
        ...details,
    });
};

/**
 * Log performance metric
 */
export const logPerformance = (
    metric: string,
    value: number,
    unit: string = "ms",
    context?: any
) => {
    logger.debug(`Performance: ${metric}`, {
        metric,
        value,
        unit,
        ...context,
    });
};

// Export the logger instance
export default logger;
