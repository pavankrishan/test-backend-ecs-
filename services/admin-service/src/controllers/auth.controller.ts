import { Request, Response, NextFunction } from 'express';
import { AppError } from '@kodingcaravan/shared';
import {
	getAdminProfile,
	loginWithEmailPassword,
	refreshSession,
	logout,
	logoutAll,
} from '../services/auth.service';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { email, password } = req.body || {};
		if (!email || !password) {
			throw new AppError('Email and password are required', 400);
		}

		const { tokens, admin } = await loginWithEmailPassword(email, password, {
			ip: req.ip,
			userAgent: req.get('user-agent') || undefined,
		});

		res.status(200).json({
			success: true,
			data: {
				admin,
				tokens,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { refreshToken } = req.body || {};
		if (!refreshToken) {
			throw new AppError('Refresh token is required', 400);
		}

		const { tokens, admin } = await refreshSession(refreshToken, {
			ip: req.ip,
			userAgent: req.get('user-agent') || undefined,
		});

		res.status(200).json({
			success: true,
			data: {
				admin,
				tokens,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function current(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const adminId = (req as any).adminId as string | undefined;
		if (!adminId) {
			throw new AppError('Admin identifier missing from request context', 400);
		}

		const admin = await getAdminProfile(adminId);
		res.status(200).json({
			success: true,
			data: admin,
		});
	} catch (error) {
		next(error);
	}
}

export async function logoutSession(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const { refreshToken } = req.body || {};
		if (!refreshToken) {
			throw new AppError('Refresh token is required', 400);
		}

		await logout(refreshToken);
		res.status(204).send();
	} catch (error) {
		next(error);
	}
}

export async function logoutEverywhere(req: Request, res: Response, next: NextFunction): Promise<void> {
	try {
		const adminId = (req as any).adminId as string | undefined;
		if (!adminId) {
			throw new AppError('Admin identifier missing from request context', 400);
		}

		await logoutAll(adminId);
		res.status(204).send();
	} catch (error) {
		next(error);
	}
}


