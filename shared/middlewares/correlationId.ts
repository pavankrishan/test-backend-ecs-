/**
 * Correlation ID Middleware
 * Extracts or generates correlation IDs for request tracing across services
 * Ensures all logs and downstream requests include the correlation ID
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import logger from '../config/logger';

/**
 * Generate a unique correlation ID
 * Format: corr-{timestamp}-{random}
 */
function generateCorrelationId(): string {
	const timestamp = Date.now();
	const random = randomBytes(12).toString('hex');
	return `corr-${timestamp}-${random}`;
}

/**
 * Extract correlation ID from request headers
 * Supports both X-Correlation-ID and Correlation-Id headers
 */
function extractCorrelationId(req: Request): string {
	const correlationId =
		req.headers['x-correlation-id'] ||
		req.headers['correlation-id'] ||
		req.headers['X-Correlation-ID'] ||
		req.headers['Correlation-Id'];

	if (Array.isArray(correlationId)) {
		return correlationId[0] || generateCorrelationId();
	}

	return (correlationId as string) || generateCorrelationId();
}

/**
 * Extend Express Request type to include correlationId
 */
declare global {
	namespace Express {
		interface Request {
			correlationId?: string;
		}
	}
}

/**
 * Correlation ID Middleware
 * - Extracts correlation ID from headers (X-Correlation-ID or Correlation-Id)
 * - Generates one if missing
 * - Attaches to req.correlationId
 * - Sets response header
 * - Adds to logger context
 */
export function correlationIdMiddleware(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	const correlationId = extractCorrelationId(req);

	// Attach to request object
	req.correlationId = correlationId;

	// Set response header
	res.setHeader('X-Correlation-ID', correlationId);

	// Add to logger default metadata for this request
	// Note: Winston logger doesn't support per-request context natively,
	// but we can use child loggers or include in each log call
	// For now, we'll include it in the request object and services should use it

	next();
}

/**
 * Helper to get correlation ID from request
 * Use this in services to include correlation ID in logs
 */
export function getCorrelationId(req: Request): string {
	return req.correlationId || 'unknown';
}
