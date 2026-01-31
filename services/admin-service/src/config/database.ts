import bcrypt from 'bcryptjs';
import { Pool, PoolClient } from 'pg';
import { createPostgresPool } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { PERMISSION_DEFINITIONS, ROLE_PERMISSIONS, getPermissionsForRole } from '../constants/permissions';

let pool: Pool | null = null;

export function getPool(): Pool {
	if (!pool) {
		pool = createPostgresPool({});
		if (!pool) {
			throw new Error('Failed to initialize PostgreSQL pool');
		}
		pool.on('connect', async (client) => {
			await client.query("SET application_name = 'admin-service'");
		});
	}
	return pool;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await handler(client);
		await client.query('COMMIT');
		return result;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

// Validate bcrypt salt rounds - must be >= 12 for production security, >= 10 for development
const BCRYPT_ROUNDS = (() => {
	const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
	const isProduction = process.env.NODE_ENV === 'production';
	const minRounds = isProduction ? 12 : 10;
	
	if (rounds < minRounds) {
		throw new Error(
			`BCRYPT_SALT_ROUNDS must be at least ${minRounds} for ${isProduction ? 'production' : 'development'} security. Current value: ${rounds}`
		);
	}
	return rounds;
})();

type RoleSeed = {
	code: string;
	name: string;
	description?: string;
	parentCode?: string;
};

const DEFAULT_ROLES: RoleSeed[] = [
	{
		code: 'super_admin',
		name: 'Super Admin',
		description: 'Full access to every administrative feature (company).',
	},
	{
		code: 'state_admin',
		name: 'State Admin',
		description: 'Oversees operations within an assigned state or region (company).',
		parentCode: 'super_admin',
	},
	{
		code: 'district_admin',
		name: 'District Admin',
		description: 'Manages operations at district level (company direct branch or franchise business partner).',
		parentCode: 'state_admin',
	},
	{
		code: 'zone_admin',
		name: 'Zone Admin',
		description: 'Manages operations at zone level (company internal staff or franchise sub-franchise).',
		parentCode: 'district_admin',
	},
	{
		code: 'locality_supervisor',
		name: 'Locality Supervisor',
		description: 'Supervises operations at locality level (company).',
		parentCode: 'zone_admin',
	},
];

// Use permission definitions from constants
// Convert PermissionDefinition to PermissionSeed format for database seeding
type PermissionSeed = {
	code: string;
	name: string;
	description: string;
	category: string;
};

const ALL_PERMISSIONS: PermissionSeed[] = PERMISSION_DEFINITIONS.map((p) => ({
	code: p.code,
	name: p.name,
	description: p.description,
	category: p.category,
}));

async function ensureExtensions(client: PoolClient): Promise<void> {
	await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
	await client.query(`CREATE EXTENSION IF NOT EXISTS "citext";`);
}

async function ensureTables(client: PoolClient): Promise<void> {
	await client.query(`
		CREATE TABLE IF NOT EXISTS admin_roles (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			parent_role_id UUID REFERENCES admin_roles(id) ON DELETE SET NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS admin_users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email CITEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			full_name TEXT,
			status TEXT NOT NULL DEFAULT 'active',
			last_login_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Add new columns for hierarchy and location if they don't exist
	await client.query(`
		DO $$
		BEGIN
			-- Add admin_type column if it doesn't exist
			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name='admin_users' AND column_name='admin_type') THEN
				ALTER TABLE admin_users 
				ADD COLUMN admin_type TEXT NOT NULL DEFAULT 'company';
			ELSE
				-- Update existing NULL values to 'company' if column exists
				UPDATE admin_users SET admin_type = 'company' WHERE admin_type IS NULL;
				-- Ensure column is NOT NULL with default
				ALTER TABLE admin_users ALTER COLUMN admin_type SET DEFAULT 'company';
				ALTER TABLE admin_users ALTER COLUMN admin_type SET NOT NULL;
			END IF;
			
			-- Add check constraint if it doesn't exist (handle gracefully if it already exists)
			BEGIN
				ALTER TABLE admin_users 
				ADD CONSTRAINT admin_users_admin_type_check 
				CHECK (admin_type IN ('company', 'franchise'));
			EXCEPTION
				WHEN duplicate_object THEN NULL;
			END;

			-- Add parent_admin_id column if it doesn't exist
			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name='admin_users' AND column_name='parent_admin_id') THEN
				ALTER TABLE admin_users 
				ADD COLUMN parent_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;
			END IF;

			-- Add location columns if they don't exist
			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name='admin_users' AND column_name='state') THEN
				ALTER TABLE admin_users ADD COLUMN state TEXT;
			END IF;

			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name='admin_users' AND column_name='district') THEN
				ALTER TABLE admin_users ADD COLUMN district TEXT;
			END IF;

			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name='admin_users' AND column_name='zone') THEN
				ALTER TABLE admin_users ADD COLUMN zone TEXT;
			END IF;

			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name='admin_users' AND column_name='locality') THEN
				ALTER TABLE admin_users ADD COLUMN locality TEXT;
			END IF;
		END $$;
	`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS admin_user_roles (
			admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
			role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
			assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (admin_id, role_id)
		);
	`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS admin_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
			token_hash TEXT UNIQUE NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL,
			user_agent TEXT,
			ip_address TEXT,
			revoked_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS admin_permissions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			category TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS admin_role_permissions (
			role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
			permission_id UUID NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
			assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (role_id, permission_id)
		);
	`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS safety_incidents (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id TEXT NOT NULL,
			user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer', 'admin')),
			type TEXT NOT NULL CHECK (type IN ('emergency', 'safety', 'medical', 'security', 'other')),
			description TEXT NOT NULL,
			location JSONB NOT NULL,
			severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
			status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'acknowledged', 'investigating', 'resolved', 'closed', 'cancelled')),
			reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			acknowledged_at TIMESTAMPTZ,
			resolved_at TIMESTAMPTZ,
			resolved_by TEXT,
			notes TEXT,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_safety_incidents_user_id ON safety_incidents(user_id);
		CREATE INDEX IF NOT EXISTS idx_safety_incidents_status ON safety_incidents(status);
		CREATE INDEX IF NOT EXISTS idx_safety_incidents_reported_at ON safety_incidents(reported_at DESC);
		CREATE INDEX IF NOT EXISTS idx_safety_incidents_user_role ON safety_incidents(user_role);
	`);

	// Create tutoring sessions table
	await ensureSessionTable(client);

	// Create trainer allocations table
	await ensureTrainerAllocationTable(client);

	// Create journeys and allocation_trainers (tracking bound to journeyId only)
	await ensureJourneyTables(client);

	// Create trainer reschedules table
	await ensureTrainerRescheduleTable(client);

	// Create location tracking tables
	await ensureLocationTrackingTables(client);

	// Create session reviews table
	await ensureSessionReviewTable(client);

	// Create call logs table
	await ensureCallLogsTable(client);
}

async function ensureSessionTable(client: PoolClient): Promise<void> {
	const { ensureSessionTable } = await import('../models/session.model');
	await ensureSessionTable(client);
}

async function ensureJourneyTables(client: PoolClient): Promise<void> {
	await client.query(`
		CREATE TABLE IF NOT EXISTS allocation_trainers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			allocation_id UUID NOT NULL REFERENCES trainer_allocations(id) ON DELETE CASCADE,
			trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
			role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'substitute')),
			effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			effective_to TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_allocation_trainers_allocation ON allocation_trainers(allocation_id);
		CREATE INDEX IF NOT EXISTS idx_allocation_trainers_trainer ON allocation_trainers(trainer_id);
	`);
	await client.query(`
		CREATE TABLE IF NOT EXISTS journeys (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			session_id UUID NOT NULL REFERENCES tutoring_sessions(id) ON DELETE CASCADE,
			trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
			student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'completed', 'cancelled')),
			started_at TIMESTAMPTZ,
			ended_at TIMESTAMPTZ,
			end_reason TEXT CHECK (end_reason IN ('arrived', 'cancelled', 'timeout', 'trainer_replaced')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_journeys_session ON journeys(session_id);
		CREATE INDEX IF NOT EXISTS idx_journeys_trainer ON journeys(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_journeys_student ON journeys(student_id);
		CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_one_active_per_session ON journeys(session_id) WHERE status = 'active';
	`);
}

async function ensureTrainerAllocationTable(client: PoolClient): Promise<void> {
	const { ensureTrainerAllocationTable } = await import('../models/trainerAllocation.model');
	await ensureTrainerAllocationTable(client);
}

async function ensureTrainerRescheduleTable(client: PoolClient): Promise<void> {
	const { ensureTrainerRescheduleTable } = await import('../models/trainerReschedule.model');
	await ensureTrainerRescheduleTable(client);
}

async function ensureLocationTrackingTables(client: PoolClient): Promise<void> {
	const { ensureLocationTrackingTables } = await import('../models/locationTracking.model');
	await ensureLocationTrackingTables(client);
}

async function ensureSessionReviewTable(client: PoolClient): Promise<void> {
	const { ensureSessionReviewTable } = await import('../models/sessionReview.model');
	await ensureSessionReviewTable(client);
}

async function ensureCallLogsTable(client: PoolClient): Promise<void> {
	await client.query(`
		CREATE TABLE IF NOT EXISTS call_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			call_sid TEXT UNIQUE NOT NULL,
			trainer_id UUID NOT NULL,
			student_id UUID NOT NULL,
			session_id UUID,
			trainer_phone TEXT NOT NULL,
			student_phone TEXT NOT NULL,
			caller_role TEXT NOT NULL CHECK (caller_role IN ('trainer', 'student')),
			status TEXT NOT NULL DEFAULT 'initiated',
			direction TEXT NOT NULL DEFAULT 'outbound',
			duration INTEGER,
			recording_url TEXT,
			start_time TIMESTAMPTZ,
			end_time TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Create indexes
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_call_logs_trainer_student ON call_logs(trainer_id, student_id);
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_call_logs_session_id ON call_logs(session_id);
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at DESC);
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_call_logs_status ON call_logs(status);
	`);
}

async function cleanupOldRoles(client: PoolClient): Promise<void> {
	// Remove old roles (course_admin and sub_admin) if they exist
	const oldRoles = ['course_admin', 'sub_admin'];
	
	for (const oldRole of oldRoles) {
		// First, remove any admin_user_roles associations
		await client.query(
			`
				DELETE FROM admin_user_roles
				WHERE role_id IN (SELECT id FROM admin_roles WHERE code = $1)
			`,
			[oldRole]
		);
		
		// Then remove the role itself
		await client.query(
			`
				DELETE FROM admin_roles WHERE code = $1
			`,
			[oldRole]
		);
	}
}

async function seedRoles(client: PoolClient): Promise<Map<string, string>> {
	// Clean up old roles first
	await cleanupOldRoles(client);

	const roleIdMap = new Map<string, string>();

	for (const role of DEFAULT_ROLES) {
		const result = await client.query(
			`
				INSERT INTO admin_roles (code, name, description)
				VALUES ($1, $2, $3)
				ON CONFLICT (code) DO UPDATE
				SET name = EXCLUDED.name,
					description = EXCLUDED.description,
					updated_at = NOW()
				RETURNING id;
			`,
			[role.code, role.name, role.description || null]
		);

		const id = result.rows[0]?.id as string;
		if (id) {
			roleIdMap.set(role.code, id);
		}
	}

	for (const role of DEFAULT_ROLES) {
		if (!role.parentCode) {
			continue;
		}
		const childId = roleIdMap.get(role.code);
		const parentId = roleIdMap.get(role.parentCode);
		if (!childId || !parentId) {
			continue;
		}
		await client.query(
			`
				UPDATE admin_roles
				SET parent_role_id = $1,
					updated_at = NOW()
				WHERE id = $2
			`,
			[parentId, childId]
		);
	}

	return roleIdMap;
}

async function seedPermissions(client: PoolClient): Promise<Map<string, string>> {
	const permissionIdMap = new Map<string, string>();

	for (const permission of ALL_PERMISSIONS) {
		const result = await client.query(
			`
				INSERT INTO admin_permissions (code, name, description, category)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (code) DO UPDATE
				SET name = EXCLUDED.name,
					description = EXCLUDED.description,
					category = EXCLUDED.category,
					updated_at = NOW()
				RETURNING id;
			`,
			[permission.code, permission.name, permission.description, permission.category]
		);

		const id = result.rows[0]?.id as string;
		if (id) {
			permissionIdMap.set(permission.code, id);
		}
	}

	return permissionIdMap;
}

// Get role permissions using the new constants
// Note: This returns base permissions - admin type differences are handled at runtime
function getRolePermissions(roleCode: string): string[] {
	return ROLE_PERMISSIONS[roleCode] || [];
}

async function assignPermissionsToRoles(
	client: PoolClient,
	roleIds: Map<string, string>,
	permissionIds: Map<string, string>
): Promise<void> {
	for (const [roleCode, permissionCodes] of Object.entries({
		super_admin: getRolePermissions('super_admin'),
		state_admin: getRolePermissions('state_admin'),
		district_admin: getRolePermissions('district_admin'),
		zone_admin: getRolePermissions('zone_admin'),
		locality_supervisor: getRolePermissions('locality_supervisor'),
	})) {
		const roleId = roleIds.get(roleCode);
		if (!roleId) {
			continue;
		}

		// Clear existing permissions for this role
		await client.query(`DELETE FROM admin_role_permissions WHERE role_id = $1`, [roleId]);

		// Assign new permissions
		const rolePermissionIds = permissionCodes
			.map((code) => permissionIds.get(code))
			.filter((id): id is string => !!id);

		if (rolePermissionIds.length > 0) {
			const values = rolePermissionIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
			await client.query(
				`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ${values} ON CONFLICT DO NOTHING`,
				[roleId, ...rolePermissionIds]
			);
		}
	}
}

async function seedDefaultAdmin(client: PoolClient, roleIds: Map<string, string>): Promise<void> {
	const seedEmail = process.env.ADMIN_SEED_EMAIL;
	const seedPassword = process.env.ADMIN_SEED_PASSWORD;
	const seedName = process.env.ADMIN_SEED_NAME || 'Super Admin';

	if (!seedEmail || !seedPassword) {
		return;
	}

	const existing = await client.query(
		`SELECT id FROM admin_users WHERE email = $1`,
		[seedEmail.toLowerCase()]
	);

	let adminId: string;

	if (existing.rows.length) {
		adminId = existing.rows[0].id;
	} else {
		const passwordHash = await bcrypt.hash(seedPassword, BCRYPT_ROUNDS);
		const inserted = await client.query(
			`
				INSERT INTO admin_users (email, password_hash, full_name, status, admin_type)
				VALUES ($1, $2, $3, 'active', 'company')
				ON CONFLICT (email) DO NOTHING
				RETURNING id;
			`,
			[seedEmail.toLowerCase(), passwordHash, seedName]
		);

		if (inserted.rows.length) {
			adminId = inserted.rows[0].id;
		} else {
			const fallback = await client.query(
				`SELECT id FROM admin_users WHERE email = $1`,
				[seedEmail.toLowerCase()]
			);
			if (!fallback.rows.length) {
				return;
			}
			adminId = fallback.rows[0].id;
		}
	}

	const superAdminRoleId = roleIds.get('super_admin');
	if (!superAdminRoleId) {
		return;
	}

	await client.query(
		`
			INSERT INTO admin_user_roles (admin_id, role_id)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING;
		`,
		[adminId, superAdminRoleId]
	);
}

let initialized = false;

export async function initializeAdminAuth(): Promise<void> {
	if (initialized) {
		logger.info('Admin Auth already initialized', {
			service: 'admin-service',
		});
		return;
	}

	logger.info('Connecting to database', {
		service: 'admin-service',
	});
	const pool = getPool();
	
	try {
		// Test connection first with timeout
		const connectionTest = pool.query('SELECT 1');
		const timeout = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Database connection timeout after 10 seconds')), 10000)
		);
		await Promise.race([connectionTest, timeout]);
		logger.info('Database connection successful', {
			service: 'admin-service',
		});
	} catch (error: any) {
		logger.error('Database connection failed', {
			error: error?.message || String(error),
			service: 'admin-service',
		});
		logger.error('Check PostgreSQL is running and connection settings in .env', {
			service: 'admin-service',
		});
		logger.warn('Service will continue but admin features requiring database will not work', {
			service: 'admin-service',
		});
		// Don't throw - allow service to start without database
		// The service can still handle HTTP requests, just DB features won't work
		return;
	}

	logger.info('Setting up database schema', {
		service: 'admin-service',
	});
	try {
	await withTransaction(async (client) => {
			logger.debug('Ensuring extensions', {
				service: 'admin-service',
			});
		await ensureExtensions(client);
			logger.debug('Ensuring tables', {
				service: 'admin-service',
			});
		await ensureTables(client);
			logger.debug('Seeding roles', {
				service: 'admin-service',
			});
		const roleIds = await seedRoles(client);
			logger.debug('Seeding permissions', {
				service: 'admin-service',
			});
		const permissionIds = await seedPermissions(client);
			logger.debug('Assigning permissions to roles', {
				service: 'admin-service',
			});
		await assignPermissionsToRoles(client, roleIds, permissionIds);
			logger.debug('Seeding default admin', {
				service: 'admin-service',
			});
		await seedDefaultAdmin(client, roleIds);
	});

	initialized = true;
		logger.info('Admin Auth initialization complete', {
			service: 'admin-service',
		});
	} catch (error: any) {
		logger.error('Database initialization error', {
			error: error?.message || String(error),
			stack: error?.stack,
			service: 'admin-service',
		});
		throw error;
	}
}
