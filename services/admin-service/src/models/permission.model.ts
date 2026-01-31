import { PoolClient, QueryResult } from 'pg';
import { getPool } from '../config/database';

export type PermissionRecord = {
	id: string;
	code: string;
	name: string;
	description: string | null;
	category: string;
	createdAt: Date;
	updatedAt: Date;
};

export type RolePermissionRecord = {
	roleId: string;
	permissionId: string;
	assignedAt: Date;
};

const permissionColumns = `
	id,
	code,
	name,
	description,
	category,
	created_at as "createdAt",
	updated_at as "updatedAt"
`;

async function query<T extends Record<string, any> = any>(text: string, params: any[] = [], client?: PoolClient): Promise<QueryResult<T>> {
	if (client) {
		return client.query<T>(text, params);
	}
	return getPool().query<T>(text, params);
}

export async function findPermissionByCode(code: string, client?: PoolClient): Promise<PermissionRecord | null> {
	const result = await query<PermissionRecord>(
		`SELECT ${permissionColumns} FROM admin_permissions WHERE code = $1`,
		[code],
		client
	);
	return result.rows[0] || null;
}

export async function getPermissionsForRole(roleId: string, client?: PoolClient): Promise<PermissionRecord[]> {
	const result = await query<PermissionRecord>(
		`
			SELECT ${permissionColumns}
			FROM admin_permissions ap
			INNER JOIN admin_role_permissions arp ON arp.permission_id = ap.id
			WHERE arp.role_id = $1
			ORDER BY ap.category, ap.name ASC
		`,
		[roleId],
		client
	);
	return result.rows;
}

export async function getPermissionsForRoles(roleIds: string[], client?: PoolClient): Promise<PermissionRecord[]> {
	if (!roleIds.length) {
		return [];
	}

	const placeholders = roleIds.map((_, idx) => `$${idx + 1}`).join(', ');
	const result = await query<PermissionRecord>(
		`
			SELECT DISTINCT ${permissionColumns}
			FROM admin_permissions ap
			INNER JOIN admin_role_permissions arp ON arp.permission_id = ap.id
			WHERE arp.role_id IN (${placeholders})
			ORDER BY ap.category, ap.name ASC
		`,
		roleIds,
		client
	);
	return result.rows;
}

export async function hasPermission(roleId: string, permissionCode: string, client?: PoolClient): Promise<boolean> {
	const result = await query<{ count: string }>(
		`
			SELECT COUNT(*) as count
			FROM admin_role_permissions arp
			INNER JOIN admin_permissions ap ON ap.id = arp.permission_id
			WHERE arp.role_id = $1 AND ap.code = $2
		`,
		[roleId, permissionCode],
		client
	);
	return parseInt(result.rows[0]?.count || '0', 10) > 0;
}

export async function hasAnyPermission(roleIds: string[], permissionCode: string, client?: PoolClient): Promise<boolean> {
	if (!roleIds.length) {
		return false;
	}

	const placeholders = roleIds.map((_, idx) => `$${idx + 2}`).join(', ');
	const result = await query<{ count: string }>(
		`
			SELECT COUNT(*) as count
			FROM admin_role_permissions arp
			INNER JOIN admin_permissions ap ON ap.id = arp.permission_id
			WHERE arp.role_id IN (${placeholders}) AND ap.code = $1
		`,
		[permissionCode, ...roleIds],
		client
	);
	return parseInt(result.rows[0]?.count || '0', 10) > 0;
}

export async function setPermissionsForRole(
	roleId: string,
	permissionIds: string[],
	client?: PoolClient
): Promise<void> {
	await query(`DELETE FROM admin_role_permissions WHERE role_id = $1`, [roleId], client);

	if (!permissionIds.length) {
		return;
	}

	const values = permissionIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
	await query(
		`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ${values} ON CONFLICT DO NOTHING`,
		[roleId, ...permissionIds],
		client
	);
}

