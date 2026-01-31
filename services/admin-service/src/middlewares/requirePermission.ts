import { Request, Response, NextFunction } from 'express';
import { AppError } from '@kodingcaravan/shared';
import { getAdminContext, checkPermission, type AdminContext } from '../services/permission.service';

// Extend Express Request to include admin context
declare global {
	namespace Express {
		interface Request {
			adminContext?: AdminContext;
		}
	}
}

/**
 * Middleware to require a specific permission
 * This middleware should be used AFTER requireAdminAuth middleware
 */
export function requirePermission(permissionCode: string) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const adminId = (req as any).adminId as string | undefined;
			if (!adminId) {
				return next(new AppError('Admin identifier missing from request context. Use requireAdminAuth middleware first.', 401));
			}

			// Get admin context with permissions
			const context = await getAdminContext(adminId);
			req.adminContext = context;

			// Check if admin has the required permission
			const hasPermission = await checkPermission(adminId, permissionCode);
			if (!hasPermission) {
				return next(
					new AppError(`Permission denied: ${permissionCode} required`, 403)
				);
			}

			next();
		} catch (error) {
			next(error);
		}
	};
}

/**
 * Middleware to require any of the specified permissions
 * This middleware should be used AFTER requireAdminAuth middleware
 */
export function requireAnyPermission(permissionCodes: string[]) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const adminId = (req as any).adminId as string | undefined;
			if (!adminId) {
				return next(new AppError('Admin identifier missing from request context. Use requireAdminAuth middleware first.', 401));
			}

			// Get admin context with permissions
			const context = await getAdminContext(adminId);
			req.adminContext = context;

			// Check if admin has any of the required permissions
			let hasPermission = false;
			for (const permissionCode of permissionCodes) {
				const has = await checkPermission(adminId, permissionCode);
				if (has) {
					hasPermission = true;
					break;
				}
			}

			if (!hasPermission) {
				return next(
					new AppError(`Permission denied: One of [${permissionCodes.join(', ')}] required`, 403)
				);
			}

			next();
		} catch (error) {
			next(error);
		}
	};
}

/**
 * Middleware to require all of the specified permissions
 * This middleware should be used AFTER requireAdminAuth middleware
 */
export function requireAllPermissions(permissionCodes: string[]) {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const adminId = (req as any).adminId as string | undefined;
			if (!adminId) {
				return next(new AppError('Admin identifier missing from request context. Use requireAdminAuth middleware first.', 401));
			}

			// Get admin context with permissions
			const context = await getAdminContext(adminId);
			req.adminContext = context;

			// Check if admin has all of the required permissions
			for (const permissionCode of permissionCodes) {
				const hasPermission = await checkPermission(adminId, permissionCode);
				if (!hasPermission) {
					return next(
						new AppError(`Permission denied: ${permissionCode} required`, 403)
					);
				}
			}

			next();
		} catch (error) {
			next(error);
		}
	};
}

/**
 * Middleware to load admin context (without permission check)
 * Useful when you want to access admin context but check permissions manually
 * This should be used AFTER requireAdminAuth middleware
 */
export async function loadAdminContext(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const adminId = (req as any).adminId as string | undefined;
		if (!adminId) {
			return next(new AppError('Admin identifier missing from request context', 401));
		}

		// Get admin context with permissions
		const context = await getAdminContext(adminId);
		req.adminContext = context;

		next();
	} catch (error) {
		next(error);
	}
}

