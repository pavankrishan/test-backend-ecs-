import { Request, Response, NextFunction } from 'express';
import { AppError, verifyAccessToken } from '@kodingcaravan/shared';

type AdminJwt = {
	sub: string;
	role: string;
	roles?: string[];
	iat?: number;
	exp?: number;
};

export function requireAdminAuth(req: Request, _res: Response, next: NextFunction): void {
	const header = req.headers.authorization;
	if (!header || !header.startsWith('Bearer ')) {
		return next(new AppError('Authorization header missing', 401));
	}

	const token = header.substring('Bearer '.length).trim();
	if (!token) {
		return next(new AppError('Access token missing', 401));
	}

	let payload: AdminJwt;
	try {
		payload = verifyAccessToken<AdminJwt>(token);
	} catch (error) {
		return next(new AppError('Invalid or expired access token', 401));
	}

	if (!payload || payload.role !== 'admin') {
		return next(new AppError('Admin privileges required', 403));
	}

	(req as any).adminId = payload.sub;
	(req as any).adminRoles = payload.roles || [];
	next();
}

