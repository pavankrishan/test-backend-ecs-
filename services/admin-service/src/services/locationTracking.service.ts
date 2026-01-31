import { AppError } from '@kodingcaravan/shared';
import {
	createTrackingSession,
	stopTrackingSession,
	findActiveTrackingSession,
	createLocationUpdate,
	findLiveLocation,
	findMultipleLiveLocations,
	findLocationHistory,
	LocationTrackingSessionRecord,
	LocationUpdateRecord,
	CreateTrackingSessionInput,
	CreateLocationUpdateInput,
} from '../models/locationTracking.model';

export async function startLocationTrackingSession(
	input: CreateTrackingSessionInput
): Promise<LocationTrackingSessionRecord> {
	if (!input.userId) {
		throw new AppError('User ID is required', 400);
	}

	if (!input.userRole || !['student', 'trainer'].includes(input.userRole)) {
		throw new AppError('User role must be student or trainer', 400);
	}

	return await createTrackingSession(input);
}

export async function stopLocationTrackingSession(
	sessionId: string
): Promise<LocationTrackingSessionRecord> {
	if (!sessionId) {
		throw new AppError('Session ID is required', 400);
	}

	const session = await stopTrackingSession(sessionId);
	if (!session) {
		throw new AppError('Tracking session not found', 404);
	}

	return session;
}

export async function getActiveTrackingSessionForUser(
	userId: string
): Promise<LocationTrackingSessionRecord | null> {
	if (!userId) {
		throw new AppError('User ID is required', 400);
	}

	return await findActiveTrackingSession(userId);
}

export async function sendLocationUpdateToServer(
	input: CreateLocationUpdateInput
): Promise<LocationUpdateRecord> {
	if (!input.userId) {
		throw new AppError('User ID is required', 400);
	}

	if (!input.userRole || !['student', 'trainer'].includes(input.userRole)) {
		throw new AppError('User role must be student or trainer', 400);
	}

	if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') {
		throw new AppError('Latitude and longitude must be numbers', 400);
	}

	if (input.latitude < -90 || input.latitude > 90) {
		throw new AppError('Latitude must be between -90 and 90', 400);
	}

	if (input.longitude < -180 || input.longitude > 180) {
		throw new AppError('Longitude must be between -180 and 180', 400);
	}

	return await createLocationUpdate(input);
}

export async function getLiveLocationForUser(
	userId: string
): Promise<LocationUpdateRecord | null> {
	if (!userId) {
		throw new AppError('User ID is required', 400);
	}

	return await findLiveLocation(userId);
}

export async function getMultipleLiveLocationsForUsers(
	userIds: string[]
): Promise<LocationUpdateRecord[]> {
	if (!Array.isArray(userIds) || userIds.length === 0) {
		throw new AppError('User IDs array is required', 400);
	}

	return await findMultipleLiveLocations(userIds);
}

export async function getLocationHistoryForUser(options?: {
	userId?: string;
	sessionId?: string;
	startTime?: string;
	endTime?: string;
	page?: number;
	limit?: number;
}): Promise<{
	updates: LocationUpdateRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const startTime = options?.startTime ? new Date(options.startTime) : undefined;
	const endTime = options?.endTime ? new Date(options.endTime) : undefined;

	return await findLocationHistory(
		{
			userId: options?.userId,
			sessionId: options?.sessionId,
			startTime,
			endTime,
			page: options?.page,
			limit: options?.limit,
		}
	);
}

/**
 * Get location history for a specific tutoring session
 * Finds all location tracking sessions linked to the tutoring session and returns their updates
 */
export async function getLocationHistoryForTutoringSession(
	tutoringSessionId: string,
	options?: {
		startTime?: string;
		endTime?: string;
		page?: number;
		limit?: number;
	}
): Promise<{
	updates: LocationUpdateRecord[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const { getPool } = await import('../config/database');
	const pool = getPool();

	// Find location tracking sessions linked to this tutoring session
	const sessionsResult = await pool.query<{ id: string }>(
		`
			SELECT id FROM location_tracking_sessions
			WHERE metadata->>'tutoringSessionId' = $1
			ORDER BY started_at ASC
		`,
		[tutoringSessionId]
	);

	const sessionIds = sessionsResult.rows.map(r => r.id);

	if (sessionIds.length === 0) {
		return {
			updates: [],
			total: 0,
			page: options?.page || 1,
			limit: options?.limit || 50,
			totalPages: 0,
		};
	}

	// Get location history for all these sessions
	const startTime = options?.startTime ? new Date(options.startTime) : undefined;
	const endTime = options?.endTime ? new Date(options.endTime) : undefined;

	// Use findLocationHistory but filter by multiple session IDs
	// Since findLocationHistory only supports one sessionId, we'll query directly
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
		WHERE session_id = ANY($1::uuid[])
	`;

	const params: unknown[] = [sessionIds];
	let paramIndex = 2;

	if (startTime) {
		query += ` AND timestamp >= $${paramIndex}`;
		params.push(startTime);
		paramIndex++;
	}

	if (endTime) {
		query += ` AND timestamp <= $${paramIndex}`;
		params.push(endTime);
		paramIndex++;
	}

	query += ` ORDER BY timestamp ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
	params.push(limit, offset);

	const result = await pool.query(query, params);

	// Get total count
	let countQuery = `SELECT COUNT(*) as count FROM location_updates WHERE session_id = ANY($1::uuid[])`;
	const countParams: unknown[] = [sessionIds];
	let countParamIndex = 2;

	if (startTime) {
		countQuery += ` AND timestamp >= $${countParamIndex}`;
		countParams.push(startTime);
		countParamIndex++;
	}

	if (endTime) {
		countQuery += ` AND timestamp <= $${countParamIndex}`;
		countParams.push(endTime);
		countParamIndex++;
	}

	const countResult = await pool.query<{ count: string }>(countQuery, countParams);
	const total = parseInt(countResult.rows[0]?.count || '0', 10);
	const totalPages = Math.ceil(total / limit);

	// Map rows to LocationUpdateRecord
	const updates: LocationUpdateRecord[] = result.rows.map((row: any) => ({
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
	}));

	return {
		updates,
		total,
		page,
		limit,
		totalPages,
	};
}

/**
 * Check location safety during a tutoring session
 * Alerts if user has moved too far from the session location
 */
export async function checkLocationSafety(
	userId: string,
	tutoringSessionId: string,
	currentLocation: { latitude: number; longitude: number }
): Promise<{ safe: boolean; distance?: number; alert?: string }> {
	const { getPool } = await import('../config/database');
	const pool = getPool();

	// Get tutoring session to find student home location
	const sessionResult = await pool.query<{
		student_home_location: { latitude: number; longitude: number } | null;
	}>(
		`SELECT student_home_location FROM tutoring_sessions WHERE id = $1`,
		[tutoringSessionId]
	);

	if (sessionResult.rows.length === 0 || !sessionResult.rows[0].student_home_location) {
		return {
			safe: true,
			alert: 'Session location not found',
		};
	}

	const sessionLocation = sessionResult.rows[0].student_home_location;

	// Calculate distance using Haversine formula
	const R = 6371e3; // Earth's radius in meters
	const φ1 = (sessionLocation.latitude * Math.PI) / 180;
	const φ2 = (currentLocation.latitude * Math.PI) / 180;
	const Δφ = ((currentLocation.latitude - sessionLocation.latitude) * Math.PI) / 180;
	const Δλ = ((currentLocation.longitude - sessionLocation.longitude) * Math.PI) / 180;

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	const distance = R * c; // Distance in meters

	// Alert if moved more than 500m from session location
	if (distance > 500) {
		return {
			safe: false,
			distance: Math.round(distance),
			alert: `User has moved ${Math.round(distance)}m from session location (max allowed: 500m)`,
		};
	}

	return {
		safe: true,
		distance: Math.round(distance),
	};
}

