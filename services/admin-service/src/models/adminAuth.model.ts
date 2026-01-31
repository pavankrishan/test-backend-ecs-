import { PoolClient, QueryResult } from 'pg';
import { getPool } from '../config/database';

export type AdminRoleRecord = {
	id: string;
	code: string;
	name: string;
	description: string | null;
	parentRoleId: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export type AdminUserRecord = {
	id: string;
	email: string;
	passwordHash: string;
	fullName: string | null;
	status: 'active' | 'inactive' | 'suspended';
	adminType: 'company' | 'franchise';
	parentAdminId: string | null;
	state: string | null;
	district: string | null;
	zone: string | null;
	locality: string | null;
	lastLoginAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type AdminSessionRecord = {
	id: string;
	adminId: string;
	tokenHash: string;
	expiresAt: Date;
	userAgent: string | null;
	ipAddress: string | null;
	revokedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type AdminWithRoles = AdminUserRecord & { roles: AdminRoleRecord[] };

const adminColumns = `
	id,
	email::text as email,
	password_hash as "passwordHash",
	full_name as "fullName",
	status::text as status,
	admin_type as "adminType",
	parent_admin_id as "parentAdminId",
	state,
	district,
	zone,
	locality,
	last_login_at as "lastLoginAt",
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

const roleColumns = `
	id,
	code,
	name,
	description,
	parent_role_id as "parentRoleId",
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

const sessionColumns = `
	id,
	admin_id as "adminId",
	token_hash as "tokenHash",
	expires_at as "expiresAt",
	user_agent as "userAgent",
	ip_address as "ipAddress",
	revoked_at as "revokedAt",
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

async function query<T extends Record<string, any> = any>(text: string, params: any[] = [], client?: PoolClient): Promise<QueryResult<T>> {
	if (client) {
		return client.query<T>(text, params);
	}
	return getPool().query<T>(text, params);
}

export async function findAdminByEmail(email: string, client?: PoolClient): Promise<AdminUserRecord | null> {
	const result = await query<AdminUserRecord>(
		`SELECT ${adminColumns} FROM admin_users WHERE email = $1`,
		[email.toLowerCase()],
		client
	);
	return result.rows[0] || null;
}

export async function findAdminById(id: string, client?: PoolClient): Promise<AdminUserRecord | null> {
	const result = await query<AdminUserRecord>(
		`SELECT ${adminColumns} FROM admin_users WHERE id = $1`,
		[id],
		client
	);
	return result.rows[0] || null;
}

export async function getRolesForAdmin(adminId: string, client?: PoolClient): Promise<AdminRoleRecord[]> {
	const result = await query<AdminRoleRecord>(
		`
			SELECT ${roleColumns}
			FROM admin_roles ar
			INNER JOIN admin_user_roles aur ON aur.role_id = ar.id
			WHERE aur.admin_id = $1
			ORDER BY ar.name ASC
		`,
		[adminId],
		client
	);
	return result.rows;
}

export async function attachRoles(admin: AdminUserRecord | null, client?: PoolClient): Promise<AdminWithRoles | null> {
	if (!admin) {
		return null;
	}
	const roles = await getRolesForAdmin(admin.id, client);
	return {
		...admin,
		roles,
	};
}

export async function updateAdminLastLogin(adminId: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE admin_users
			SET last_login_at = NOW(),
				updated_at = NOW()
			WHERE id = $1
		`,
		[adminId],
		client
	);
}

export async function createAdminSession(
	adminId: string,
	tokenHash: string,
	expiresAt: Date,
	meta: { userAgent?: string | null; ipAddress?: string | null },
	client?: PoolClient
): Promise<void> {
	await query(
		`
			INSERT INTO admin_sessions (admin_id, token_hash, expires_at, user_agent, ip_address)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (token_hash) DO UPDATE
			SET expires_at = EXCLUDED.expires_at,
				user_agent = EXCLUDED.user_agent,
				ip_address = EXCLUDED.ip_address,
				revoked_at = NULL,
				updated_at = NOW()
		`,
		[adminId, tokenHash, expiresAt, meta.userAgent || null, meta.ipAddress || null],
		client
	);
}

export async function findSessionByTokenHash(tokenHash: string, client?: PoolClient): Promise<AdminSessionRecord | null> {
	const result = await query<AdminSessionRecord>(
		`SELECT ${sessionColumns} FROM admin_sessions WHERE token_hash = $1`,
		[tokenHash],
		client
	);
	return result.rows[0] || null;
}

export async function revokeSession(tokenHash: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE admin_sessions
			SET revoked_at = NOW(),
				updated_at = NOW()
			WHERE token_hash = $1
		`,
		[tokenHash],
		client
	);
}

export async function revokeAllSessions(adminId: string, client?: PoolClient): Promise<void> {
	await query(
		`
			UPDATE admin_sessions
			SET revoked_at = NOW(),
				updated_at = NOW()
			WHERE admin_id = $1 AND revoked_at IS NULL
		`,
		[adminId],
		client
	);
}

export async function setRolesForAdmin(adminId: string, roleIds: string[], client?: PoolClient): Promise<void> {
	await query(`DELETE FROM admin_user_roles WHERE admin_id = $1`, [adminId], client);

	if (!roleIds.length) {
		return;
	}

	const values = roleIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
	await query(
		`INSERT INTO admin_user_roles (admin_id, role_id) VALUES ${values} ON CONFLICT DO NOTHING`,
		[adminId, ...roleIds],
		client
	);
}

