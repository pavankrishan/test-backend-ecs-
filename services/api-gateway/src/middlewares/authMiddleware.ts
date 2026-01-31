import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';

type UserJwt = {
	sub: string;
	role?: string;
	iat?: number;
	exp?: number;
};

// Rate limiting for expired token warnings (reduce log noise)
// Only log expired token warnings once per path per minute
const expiredTokenWarningCache: Map<string, number> = new Map();
const EXPIRED_TOKEN_WARNING_TTL_MS = 60 * 1000; // 1 minute

function shouldLogExpiredTokenWarning(path: string): boolean {
	const now = Date.now();
	const lastLogged = expiredTokenWarningCache.get(path);
	
	if (!lastLogged || (now - lastLogged) > EXPIRED_TOKEN_WARNING_TTL_MS) {
		expiredTokenWarningCache.set(path, now);
		return true;
	}
	
	return false;
}

// Cleanup old cache entries periodically
setInterval(() => {
	const now = Date.now();
	const keysToDelete: string[] = [];
	
	expiredTokenWarningCache.forEach((timestamp, path) => {
		if (now - timestamp > EXPIRED_TOKEN_WARNING_TTL_MS) {
			keysToDelete.push(path);
		}
	});
	
	keysToDelete.forEach(path => {
		expiredTokenWarningCache.delete(path);
	});
}, 5 * 60 * 1000); // Cleanup every 5 minutes

/**
 * Check if a path is a public/auth endpoint that doesn't require token validation
 */
function isPublicEndpoint(path: string): boolean {
	const publicPatterns = [
		'/health',
		'/ready',
		'/api/v1/students/auth',
		'/api/v1/trainers/auth',
		'/api/v1/admin/auth',
		'/api/students/auth',
		'/api/trainers/auth',
		'/api/admin/auth',
	];
	
	return publicPatterns.some(pattern => path.startsWith(pattern));
}

/**
 * Optional authentication middleware for API Gateway
 * Extracts user info from token if present, but doesn't block requests
 * This is useful for logging, analytics, and passing user context to services
 */
export function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
	const header = req.headers.authorization;
	
	if (!header || !header.startsWith('Bearer ')) {
		return next();
	}

	const token = header.substring('Bearer '.length).trim();
	if (!token) {
		return next();
	}

	try {
		const payload = verifyAccessToken<UserJwt>(token);
		
		if (payload && payload.sub) {
			// Store user info in request for downstream services
			(req as any).userId = payload.sub;
			(req as any).userRole = payload.role || 'student';
			
			// If it's an admin token, also set adminId
			if (payload.role === 'admin') {
				(req as any).adminId = payload.sub;
			}
		}
	} catch (error) {
		// Invalid token - silently continue (services will handle auth)
		// This allows public endpoints to work while still extracting valid tokens
	}

	next();
}

/**
 * CRITICAL FIX: Auth validation middleware that blocks invalid/expired tokens
 * before they hit downstream services. This prevents retry storms on downstream services.
 * 
 * This middleware:
 * - Only validates tokens for protected routes (not public/auth endpoints)
 * - Returns a clean 401 response for invalid/expired tokens
 * - Prevents invalid tokens from being proxied to downstream services
 */
export function validateAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
	// Skip validation for public endpoints
	if (isPublicEndpoint(req.path)) {
		return next();
	}

	const header = req.headers.authorization;
	
	// If no token is provided, let it pass through (downstream services will handle)
	// This allows services to have their own auth requirements
	if (!header || !header.startsWith('Bearer ')) {
		return next();
	}

	const token = header.substring('Bearer '.length).trim();
	if (!token) {
		return next();
	}

	// Validate token
	try {
		const payload = verifyAccessToken<UserJwt>(token);
		
		if (payload && payload.sub) {
			// Token is valid - store user info and continue
			(req as any).userId = payload.sub;
			(req as any).userRole = payload.role || 'student';
			
			if (payload.role === 'admin') {
				(req as any).adminId = payload.sub;
			}
			
			return next();
		}
	} catch (error: any) {
		// Token is invalid or expired
		const isExpired = error?.name === 'TokenExpiredError' || 
		                 error?.message?.includes('expired') || 
		                 error?.message?.includes('jwt expired');
		
		// CRITICAL: Block invalid/expired tokens with a clean 401 response
		// This prevents retry storms on downstream services
		
		// Reduce log noise: expired tokens are expected when tokens expire
		// Only log expired token warnings at debug level and rate-limited
		// Invalid tokens (malformed, wrong signature) are actual issues - log at warn level
		if (isExpired) {
			// Expired tokens are expected - log at debug level and rate-limit
			if (shouldLogExpiredTokenWarning(req.path)) {
				logger.debug('API Gateway: Blocking expired token', {
					path: req.path,
					method: req.method,
					error: error?.message,
				});
			}
		} else {
			// Invalid tokens (malformed, wrong signature) are actual issues
			logger.warn('API Gateway: Blocking invalid token', {
				path: req.path,
				method: req.method,
				error: error?.message,
			});
		}
		
		res.status(401).json({
			success: false,
			message: isExpired ? 'Token expired' : 'Invalid token',
			code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
		});
		return;
	}

	// If we get here, token validation failed but no error was thrown
	// This shouldn't happen, but handle it gracefully
	return next();
}



