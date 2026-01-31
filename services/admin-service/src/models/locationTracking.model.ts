import { Pool, PoolClient } from 'pg';
import { getPool, withTransaction } from '../config/database';

export type LocationUpdateRecord = {
	id: string;
	sessionId: string;
	userId: string;
	userRole: 'student' | 'trainer';
	latitude: number;
	longitude: number;
	accuracy: number | null;
	altitude: number | null;
	heading: number | null;
	speed: number | null;
	address: string | null;
	timestamp: Date;
	isActive: boolean;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
};

export type LocationTrackingSessionRecord = {
	id: string;
	userId: string;
	userRole: 'student' | 'trainer';
	startedAt: Date;
	endedAt: Date | null;
	isActive: boolean;
	totalUpdates: number;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
};

export type CreateLocationUpdateInput = {
	sessionId?: string;
	userId: string;
	userRole: 'student' | 'trainer';
	latitude: number;
	longitude: number;
	accuracy?: number;
	altitude?: number;
	heading?: number;
	speed?: number;
	address?: string;
	metadata?: Record<string, unknown>;
};

export type CreateTrackingSessionInput = {
	userId: string;
	userRole: 'student' | 'trainer';
	metadata?: Record<string, unknown>;
};

export async function ensureLocationTrackingTables(client: PoolClient): Promise<void> {
	// Create location_tracking_sessions table
	await client.query(`
		CREATE TABLE IF NOT EXISTS location_tracking_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id TEXT NOT NULL,
			user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer')),
			started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			ended_at TIMESTAMPTZ,
			is_active BOOLEAN NOT NULL DEFAULT true,
			total_updates INTEGER NOT NULL DEFAULT 0,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Create location_updates table
	await client.query(`
		CREATE TABLE IF NOT EXISTS location_updates (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			session_id UUID REFERENCES location_tracking_sessions(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer')),
			latitude DOUBLE PRECISION NOT NULL,
			longitude DOUBLE PRECISION NOT NULL,
			accuracy DOUBLE PRECISION,
			altitude DOUBLE PRECISION,
			heading DOUBLE PRECISION,
			speed DOUBLE PRECISION,
			address TEXT,
			timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			is_active BOOLEAN NOT NULL DEFAULT true,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Create indexes
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_location_updates_user_id ON location_updates(user_id);
		CREATE INDEX IF NOT EXISTS idx_location_updates_session_id ON location_updates(session_id);
		CREATE INDEX IF NOT EXISTS idx_location_updates_timestamp ON location_updates(timestamp DESC);
		CREATE INDEX IF NOT EXISTS idx_location_updates_user_id_active ON location_updates(user_id, is_active) WHERE is_active = true;
		CREATE INDEX IF NOT EXISTS idx_location_sessions_user_id ON location_tracking_sessions(user_id);
		CREATE INDEX IF NOT EXISTS idx_location_sessions_active ON location_tracking_sessions(is_active) WHERE is_active = true;
	`);

	// Create function to update session total_updates
	await client.query(`
		CREATE OR REPLACE FUNCTION update_session_total_updates()
		RETURNS TRIGGER AS $$
		BEGIN
			UPDATE location_tracking_sessions
			SET total_updates = total_updates + 1,
				updated_at = NOW()
			WHERE id = NEW.session_id;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
	`);

	// Create trigger
	await client.query(`
		DROP TRIGGER IF EXISTS trigger_update_session_total_updates ON location_updates;
		CREATE TRIGGER trigger_update_session_total_updates
		AFTER INSERT ON location_updates
		FOR EACH ROW
		EXECUTE FUNCTION update_session_total_updates();
	`);
}

export async function createTrackingSession(
	input: CreateTrackingSessionInput,
	client?: PoolClient
): Promise<LocationTrackingSessionRecord> {
	const pool = client || getPool();

	// Deactivate any existing active sessions for this user
	await pool.query(
		`
			UPDATE location_tracking_sessions
			SET is_active = false, ended_at = NOW(), updated_at = NOW()
			WHERE user_id = $1 AND is_active = true
		`,
		[input.userId]
	);

	const result = await pool.query<LocationTrackingSessionRecord>(
		`
			INSERT INTO location_tracking_sessions (
				id, user_id, user_role, started_at, is_active, metadata, created_at, updated_at
			)
			VALUES (
				gen_random_uuid(), $1, $2, NOW(), true, $3::jsonb, NOW(), NOW()
			)
			RETURNING
				id,
				user_id as "userId",
				user_role as "userRole",
				started_at as "startedAt",
				ended_at as "endedAt",
				is_active as "isActive",
				total_updates as "totalUpdates",
				metadata::jsonb as metadata,
				created_at as "createdAt",
				updated_at as "updatedAt"
		`,
		[input.userId, input.userRole, JSON.stringify(input.metadata || {})]
	);

	return mapSessionRowToRecord(result.rows[0]);
}

export async function stopTrackingSession(
	sessionId: string,
	client?: PoolClient
): Promise<LocationTrackingSessionRecord | null> {
	const pool = client || getPool();

	const result = await pool.query<LocationTrackingSessionRecord>(
		`
			UPDATE location_tracking_sessions
			SET is_active = false, ended_at = NOW(), updated_at = NOW()
			WHERE id = $1
			RETURNING
				id,
				user_id as "userId",
				user_role as "userRole",
				started_at as "startedAt",
				ended_at as "endedAt",
				is_active as "isActive",
				total_updates as "totalUpdates",
				metadata::jsonb as metadata,
				created_at as "createdAt",
				updated_at as "updatedAt"
		`,
		[sessionId]
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapSessionRowToRecord(result.rows[0]);
}

export async function findActiveTrackingSession(
	userId: string,
	client?: PoolClient
): Promise<LocationTrackingSessionRecord | null> {
	const pool = client || getPool();

	const result = await pool.query<LocationTrackingSessionRecord>(
		`
			SELECT
				id,
				user_id as "userId",
				user_role as "userRole",
				started_at as "startedAt",
				ended_at as "endedAt",
				is_active as "isActive",
				total_updates as "totalUpdates",
				metadata::jsonb as metadata,
				created_at as "createdAt",
				updated_at as "updatedAt"
			FROM location_tracking_sessions
			WHERE user_id = $1 AND is_active = true
			ORDER BY started_at DESC
			LIMIT 1
		`,
		[userId]
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapSessionRowToRecord(result.rows[0]);
}

export async function createLocationUpdate(
	input: CreateLocationUpdateInput,
	client?: PoolClient
): Promise<LocationUpdateRecord> {
	const pool = client || getPool();

	// If sessionId is provided, verify it exists and is active
	let sessionId = input.sessionId;
	if (!sessionId) {
		// Find or create active session
		const activeSession = await findActiveTrackingSession(input.userId, client);
		if (activeSession) {
			sessionId = activeSession.id;
		} else {
			// Create new session
			const newSession = await createTrackingSession(
				{
					userId: input.userId,
					userRole: input.userRole,
				},
				client
			);
			sessionId = newSession.id;
		}
	}

	// Deactivate previous active updates for this user
	await pool.query(
		`
			UPDATE location_updates
			SET is_active = false
			WHERE user_id = $1 AND is_active = true
		`,
		[input.userId]
	);

	const result = await pool.query<LocationUpdateRecord>(
		`
			INSERT INTO location_updates (
				id, session_id, user_id, user_role, latitude, longitude,
				accuracy, altitude, heading, speed, address, timestamp,
				is_active, metadata, created_at
			)
			VALUES (
				gen_random_uuid(), $1, $2, $3, $4, $5,
				$6, $7, $8, $9, $10, NOW(),
				true, $11::jsonb, NOW()
			)
			RETURNING
				id,
				session_id as "sessionId",
				user_id as "userId",
				user_role as "userRole",
				latitude,
				longitude,
				accuracy,
				altitude,
				heading,
				speed,
				address,
				timestamp,
				is_active as "isActive",
				metadata::jsonb as metadata,
				created_at as "createdAt"
		`,
		[
			sessionId,
			input.userId,
			input.userRole,
			input.latitude,
			input.longitude,
			input.accuracy || null,
			input.altitude || null,
			input.heading || null,
			input.speed || null,
			input.address || null,
			JSON.stringify(input.metadata || {}),
		]
	);

	return mapUpdateRowToRecord(result.rows[0]);
}

export async function findLiveLocation(
	userId: string,
	client?: PoolClient
): Promise<LocationUpdateRecord | null> {
	const pool = client || getPool();

	const result = await pool.query<LocationUpdateRecord>(
		`
			SELECT
				id,
				session_id as "sessionId",
				user_id as "userId",
				user_role as "userRole",
				latitude,
				longitude,
				accuracy,
				altitude,
				heading,
				speed,
				address,
				timestamp,
				is_active as "isActive",
				metadata::jsonb as metadata,
				created_at as "createdAt"
			FROM location_updates
			WHERE user_id = $1 AND is_active = true
			ORDER BY timestamp DESC
			LIMIT 1
		`,
		[userId]
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapUpdateRowToRecord(result.rows[0]);
}

export async function findMultipleLiveLocations(
	userIds: string[],
	client?: PoolClient
): Promise<LocationUpdateRecord[]> {
	const pool = client || getPool();

	if (userIds.length === 0) {
		return [];
	}

	const result = await pool.query<LocationUpdateRecord>(
		`
			SELECT DISTINCT ON (user_id)
				id,
				session_id as "sessionId",
				user_id as "userId",
				user_role as "userRole",
				latitude,
				longitude,
				accuracy,
				altitude,
				heading,
				speed,
				address,
				timestamp,
				is_active as "isActive",
				metadata::jsonb as metadata,
				created_at as "createdAt"
			FROM location_updates
			WHERE user_id = ANY($1::text[]) AND is_active = true
			ORDER BY user_id, timestamp DESC
		`,
		[userIds]
	);

	return result.rows.map(mapUpdateRowToRecord);
}

export async function findLocationHistory(
	options?: {
		userId?: string;
		sessionId?: string;
		startTime?: Date;
		endTime?: Date;
		page?: number;
		limit?: number;
	},
	client?: PoolClient
): Promise<{
	updates: LocationUpdateRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const pool = client || getPool();
	const page = options?.page || 1;
	const limit = options?.limit || 50;
	const offset = (page - 1) * limit;

	let query = `
		SELECT
			id,
			session_id as "sessionId",
			user_id as "userId",
			user_role as "userRole",
			latitude,
			longitude,
			accuracy,
			altitude,
			heading,
			speed,
			address,
			timestamp,
			is_active as "isActive",
			metadata::jsonb as metadata,
			created_at as "createdAt"
		FROM location_updates
		WHERE 1=1
	`;

	const params: unknown[] = [];
	let paramIndex = 1;

	if (options?.userId) {
		query += ` AND user_id = $${paramIndex}`;
		params.push(options.userId);
		paramIndex++;
	}

	if (options?.sessionId) {
		query += ` AND session_id = $${paramIndex}`;
		params.push(options.sessionId);
		paramIndex++;
	}

	if (options?.startTime) {
		query += ` AND timestamp >= $${paramIndex}`;
		params.push(options.startTime);
		paramIndex++;
	}

	if (options?.endTime) {
		query += ` AND timestamp <= $${paramIndex}`;
		params.push(options.endTime);
		paramIndex++;
	}

	query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
	params.push(limit, offset);

	const result = await pool.query<LocationUpdateRecord>(query, params);

	// Get total count
	let countQuery = `SELECT COUNT(*) as count FROM location_updates WHERE 1=1`;
	const countParams: unknown[] = [];
	let countParamIndex = 1;

	if (options?.userId) {
		countQuery += ` AND user_id = $${countParamIndex}`;
		countParams.push(options.userId);
		countParamIndex++;
	}

	if (options?.sessionId) {
		countQuery += ` AND session_id = $${countParamIndex}`;
		countParams.push(options.sessionId);
		countParamIndex++;
	}

	if (options?.startTime) {
		countQuery += ` AND timestamp >= $${countParamIndex}`;
		countParams.push(options.startTime);
		countParamIndex++;
	}

	if (options?.endTime) {
		countQuery += ` AND timestamp <= $${countParamIndex}`;
		countParams.push(options.endTime);
		countParamIndex++;
	}

	const countResult = await pool.query<{ count: string }>(countQuery, countParams);
	const total = parseInt(countResult.rows[0]?.count || '0', 10);
	const totalPages = Math.ceil(total / limit);

	return {
		updates: result.rows.map(mapUpdateRowToRecord),
		total,
		page,
		limit,
		totalPages,
	};
}

function mapSessionRowToRecord(row: any): LocationTrackingSessionRecord {
	return {
		id: row.id,
		userId: row.userId,
		userRole: row.userRole,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		isActive: row.isActive,
		totalUpdates: row.totalUpdates,
		metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function mapUpdateRowToRecord(row: any): LocationUpdateRecord {
	return {
		id: row.id,
		sessionId: row.sessionId,
		userId: row.userId,
		userRole: row.userRole,
		latitude: row.latitude,
		longitude: row.longitude,
		accuracy: row.accuracy,
		altitude: row.altitude,
		heading: row.heading,
		speed: row.speed,
		address: row.address,
		timestamp: row.timestamp,
		isActive: row.isActive,
		metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
		createdAt: row.createdAt,
	};
}

