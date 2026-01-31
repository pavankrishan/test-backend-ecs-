import { Request, Response, NextFunction } from 'express';
import { AppError, verifyAccessToken } from '@kodingcaravan/shared';

type UserJwt = {
	sub: string;
	role?: string;
	iat?: number;
	exp?: number;
};

/**
 * Middleware that accepts both admin and student/trainer tokens
 * Extracts user ID and role from the token
 */
export function requireUserAuth(req: Request, _res: Response, next: NextFunction): void {
	const header = req.headers.authorization;
	if (!header || !header.startsWith('Bearer ')) {
		// For safety incidents, we allow reporting without auth (for emergencies)
		// But we'll still try to extract user info if token is provided
		return next();
	}

	const token = header.substring('Bearer '.length).trim();
	if (!token) {
		return next();
	}

	let payload: UserJwt;
	try {
		payload = verifyAccessToken<UserJwt>(token);
	} catch (error: any) {
		// If a token was provided but is invalid/expired, return 401 to trigger frontend refresh
		// This allows the frontend to automatically refresh tokens
		const isExpired = error?.name === 'TokenExpiredError' || 
		                 error?.message?.includes('expired') || 
		                 error?.message?.includes('jwt expired');
		
		if (isExpired) {
			// Token expired - return 401 to trigger frontend token refresh
			return next(new AppError('Token expired', 401));
		}
		
		// For other invalid tokens (malformed, etc.), also return 401
		// This ensures the frontend can handle token issues properly
		return next(new AppError('Invalid token', 401));
	}

	if (!payload || !payload.sub) {
		return next();
	}

	// Store user info in request
	(req as any).userId = payload.sub;
	(req as any).userRole = payload.role || 'student';
	
	// If it's an admin token, also set adminId
	if (payload.role === 'admin') {
		(req as any).adminId = payload.sub;
	}

	next();
}

/**
 * Middleware that requires authentication (admin, student, or trainer)
 * Use this when you need to ensure a user is authenticated
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
	const header = req.headers.authorization;
	if (!header || !header.startsWith('Bearer ')) {
		return next(new AppError('Authorization header missing', 401));
	}

	const token = header.substring('Bearer '.length).trim();
	if (!token) {
		return next(new AppError('Access token missing', 401));
	}

	let payload: UserJwt;
	try {
		payload = verifyAccessToken<UserJwt>(token);
	} catch (error) {
		return next(new AppError('Invalid or expired access token', 401));
	}

	if (!payload || !payload.sub) {
		return next(new AppError('Invalid token payload', 401));
	}

	// Store user info in request
	(req as any).userId = payload.sub;
	(req as any).userRole = payload.role || 'student';
	
	// If it's an admin token, also set adminId
	if (payload.role === 'admin') {
		(req as any).adminId = payload.sub;
	}

	next();
}

