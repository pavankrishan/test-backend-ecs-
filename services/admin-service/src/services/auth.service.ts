import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import {
	signAccessToken,
	signRefreshToken,
	verifyRefreshToken,
	AppError,
} from '@kodingcaravan/shared';
import {
	attachRoles,
	createAdminSession,
	findAdminByEmail,
	findAdminById,
	findSessionByTokenHash,
	getRolesForAdmin,
	revokeAllSessions,
	revokeSession,
	updateAdminLastLogin,
	type AdminRoleRecord,
	type AdminUserRecord,
} from '../models/adminAuth.model';

type TokenPair = {
	accessToken: string;
	refreshToken: string;
};

type LoginResult = {
	admin: Omit<AdminUserRecord, 'passwordHash'> & { roles: AdminRoleRecord[] };
	tokens: TokenPair;
};

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function sanitizeAdmin(admin: AdminUserRecord, roles: AdminRoleRecord[]): LoginResult['admin'] {
	const { passwordHash, ...rest } = admin;
	return {
		...rest,
		roles,
	};
}

function issueTokens(admin: AdminUserRecord, roles: AdminRoleRecord[]): TokenPair {
	const payload = {
		sub: admin.id,
		role: 'admin',
		roles: roles.map((role) => role.code),
	};

	return {
		accessToken: signAccessToken(payload),
		refreshToken: signRefreshToken(payload),
	};
}

export async function loginWithEmailPassword(
	email: string,
	password: string,
	meta: { ip?: string; userAgent?: string }
): Promise<LoginResult> {
	const admin = await findAdminByEmail(email.toLowerCase());
	if (!admin) {
		throw new AppError('Invalid credentials', 401);
	}

	if (admin.status !== 'active') {
		throw new AppError('Admin account is not active', 403);
	}

	const match = await bcrypt.compare(password, admin.passwordHash);
	if (!match) {
		throw new AppError('Invalid credentials', 401);
	}

	const roles = await getRolesForAdmin(admin.id);
	if (!roles.length) {
		throw new AppError('No roles assigned to admin', 403);
	}

	const tokens = issueTokens(admin, roles);
	const refreshPayload = verifyRefreshToken<{ exp: number }>(tokens.refreshToken);
	const expiresAt = new Date(refreshPayload.exp * 1000);
	const tokenHash = hashToken(tokens.refreshToken);

	await createAdminSession(
		admin.id,
		tokenHash,
		expiresAt,
		{
			userAgent: meta.userAgent || null,
			ipAddress: meta.ip || null,
		}
	);

	await updateAdminLastLogin(admin.id);

	return {
		admin: sanitizeAdmin(admin, roles),
		tokens,
	};
}

export async function refreshSession(
	refreshToken: string,
	meta: { ip?: string; userAgent?: string }
): Promise<LoginResult> {
	let payload: { sub: string; exp: number; roles?: string[] };
	try {
		payload = verifyRefreshToken(refreshToken) as { sub: string; exp: number; roles?: string[] };
	} catch {
		throw new AppError('Invalid refresh token', 401);
	}

	const admin = await findAdminById(payload.sub);
	if (!admin) {
		throw new AppError('Admin account not found', 404);
	}
	if (admin.status !== 'active') {
		throw new AppError('Admin account is not active', 403);
	}

	const tokenHash = hashToken(refreshToken);
	const session = await findSessionByTokenHash(tokenHash);
	if (!session || session.revokedAt) {
		throw new AppError('Refresh token revoked', 401);
	}
	if (session.expiresAt.getTime() <= Date.now()) {
		throw new AppError('Refresh token expired', 401);
	}

	// CRITICAL FIX: Issue new tokens FIRST, then revoke old token
	// This prevents race conditions where concurrent refreshes see the token as revoked
	// before the new token is stored
	const roles = await getRolesForAdmin(admin.id);
	const tokens = issueTokens(admin, roles);

	const nextPayload = verifyRefreshToken<{ exp: number }>(tokens.refreshToken);
	const expiresAt = new Date(nextPayload.exp * 1000);
	
	// Store new session FIRST
	await createAdminSession(
		admin.id,
		hashToken(tokens.refreshToken),
		expiresAt,
		{
			userAgent: meta.userAgent || null,
			ipAddress: meta.ip || null,
		}
	);

	// NOW revoke old session (after new one is safely stored)
	await revokeSession(tokenHash);

	return {
		admin: sanitizeAdmin(admin, roles),
		tokens,
	};
}

export async function logout(refreshToken: string): Promise<void> {
	const tokenHash = hashToken(refreshToken);
	await revokeSession(tokenHash);
}

export async function logoutAll(adminId: string): Promise<void> {
	await revokeAllSessions(adminId);
}

export async function getAdminProfile(adminId: string): Promise<LoginResult['admin']> {
	const admin = await attachRoles(await findAdminById(adminId));
	if (!admin) {
		throw new AppError('Admin account not found', 404);
	}
	const { roles, passwordHash, ...rest } = admin;
	return {
		...rest,
		roles,
	};
}

