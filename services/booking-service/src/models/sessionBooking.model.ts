/**
 * Session Booking Model - PostgreSQL Schema
 * Represents a booking for home tutoring sessions
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type BookingMode = '1on1' | '1on2' | '1on3';
export type BookingStatus = 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled';

export interface SessionBooking {
	id: string;
	studentId: string;
	studentIds: string[]; // For 1on2 and 1on3 modes
	courseId: string;
	address: string;
	latitude: number;
	longitude: number;
	timeslot: string; // Format: "HH:MM" (e.g., "09:00", "14:30")
	mode: BookingMode;
	groupSize: 1 | 2 | 3;
	sessionCount: 10 | 20 | 30;
	trainerId: string | null;
	clusterId: string | null;
	status: BookingStatus;
	startDate: Date;
	endDate: Date | null;
	completedSessions: number;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SessionBookingCreateInput {
	studentId: string;
	studentIds?: string[]; // For group bookings
	courseId: string;
	address: string;
	latitude: number;
	longitude: number;
	timeslot: string;
	mode: BookingMode;
	groupSize: 1 | 2 | 3;
	sessionCount: 10 | 20 | 30;
	startDate: Date;
	metadata?: Record<string, unknown> | null;
}

export interface SessionBookingUpdateInput {
	trainerId?: string | null;
	clusterId?: string | null;
	status?: BookingStatus;
	endDate?: Date | null;
	completedSessions?: number;
	metadata?: Record<string, unknown> | null;
}

const BOOKING_COLUMNS = `
	id,
	student_id AS "studentId",
	student_ids AS "studentIds",
	course_id AS "courseId",
	address,
	latitude,
	longitude,
	timeslot,
	mode,
	group_size AS "groupSize",
	session_count AS "sessionCount",
	trainer_id AS "trainerId",
	cluster_id AS "clusterId",
	status,
	start_date AS "startDate",
	end_date AS "endDate",
	completed_sessions AS "completedSessions",
	metadata,
	created_at AS "createdAt",
	updated_at AS "updatedAt"
`;

function executeQuery<T extends Record<string, any> = any>(
	pool: Pool,
	client: PoolClient | undefined,
	text: string,
	params: any[] = []
): Promise<QueryResult<T>> {
	if (client) {
		return client.query<T>(text, params);
	}
	return pool.query<T>(text, params);
}

function mapRow(row: any): SessionBooking {
	return {
		id: row.id,
		studentId: row.studentId,
		studentIds: row.studentIds || [],
		courseId: row.courseId,
		address: row.address,
		latitude: parseFloat(row.latitude),
		longitude: parseFloat(row.longitude),
		timeslot: row.timeslot,
		mode: row.mode,
		groupSize: row.groupSize,
		sessionCount: row.sessionCount,
		trainerId: row.trainerId,
		clusterId: row.clusterId,
		status: row.status,
		startDate: row.startDate,
		endDate: row.endDate,
		completedSessions: row.completedSessions || 0,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureSessionBookingTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS session_bookings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			student_id UUID NOT NULL,
			student_ids UUID[] DEFAULT ARRAY[]::UUID[],
			course_id UUID NOT NULL,
			address TEXT NOT NULL,
			latitude NUMERIC(10, 8) NOT NULL,
			longitude NUMERIC(11, 8) NOT NULL,
			timeslot VARCHAR(10) NOT NULL,
			mode VARCHAR(10) NOT NULL CHECK (mode IN ('1on1', '1on2', '1on3')),
			group_size INT NOT NULL CHECK (group_size IN (1, 2, 3)),
			session_count INT NOT NULL CHECK (session_count IN (10, 20, 30)),
			trainer_id UUID,
			cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending' 
				CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
			start_date DATE NOT NULL,
			end_date DATE,
			completed_sessions INT NOT NULL DEFAULT 0,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_bookings_student ON session_bookings(student_id);
		CREATE INDEX IF NOT EXISTS idx_bookings_trainer ON session_bookings(trainer_id) WHERE trainer_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_bookings_cluster ON session_bookings(cluster_id) WHERE cluster_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_bookings_status ON session_bookings(status);
		CREATE INDEX IF NOT EXISTS idx_bookings_course ON session_bookings(course_id);
		CREATE INDEX IF NOT EXISTS idx_bookings_timeslot ON session_bookings(timeslot);
		CREATE INDEX IF NOT EXISTS idx_bookings_location ON session_bookings(latitude, longitude);
		CREATE INDEX IF NOT EXISTS idx_bookings_dates ON session_bookings(start_date, end_date);
	`);
}

export class SessionBookingRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: SessionBookingCreateInput, client?: PoolClient): Promise<SessionBooking> {
		const result = await executeQuery<SessionBooking>(
			this.pool,
			client,
			`
				INSERT INTO session_bookings (
					student_id, student_ids, course_id, address, latitude, longitude,
					timeslot, mode, group_size, session_count, start_date, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				RETURNING ${BOOKING_COLUMNS}
			`,
			[
				input.studentId,
				input.studentIds || [],
				input.courseId,
				input.address,
				input.latitude,
				input.longitude,
				input.timeslot,
				input.mode,
				input.groupSize,
				input.sessionCount,
				input.startDate,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<SessionBooking | null> {
		const result = await executeQuery<SessionBooking>(
			this.pool,
			client,
			`SELECT ${BOOKING_COLUMNS} FROM session_bookings WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByStudentId(studentId: string, filters?: {
		status?: BookingStatus;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<SessionBooking[]> {
		const conditions: string[] = ['student_id = $1'];
		const params: any[] = [studentId];
		let paramIdx = 2;

		if (filters?.status) {
			conditions.push(`status = $${paramIdx++}`);
			params.push(filters.status);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 50;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<SessionBooking>(
			this.pool,
			client,
			`
				SELECT ${BOOKING_COLUMNS}
				FROM session_bookings
				${whereClause}
				ORDER BY created_at DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async findByTrainerId(trainerId: string, filters?: {
		status?: BookingStatus;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<SessionBooking[]> {
		const conditions: string[] = ['trainer_id = $1'];
		const params: any[] = [trainerId];
		let paramIdx = 2;

		if (filters?.status) {
			conditions.push(`status = $${paramIdx++}`);
			params.push(filters.status);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 50;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<SessionBooking>(
			this.pool,
			client,
			`
				SELECT ${BOOKING_COLUMNS}
				FROM session_bookings
				${whereClause}
				ORDER BY start_date ASC, timeslot ASC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async update(id: string, input: SessionBookingUpdateInput, client?: PoolClient): Promise<SessionBooking | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.trainerId !== undefined) {
			setClauses.push(`trainer_id = $${paramIdx++}`);
			params.push(input.trainerId);
		}

		if (input.clusterId !== undefined) {
			setClauses.push(`cluster_id = $${paramIdx++}`);
			params.push(input.clusterId);
		}

		if (input.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(input.status);
		}

		if (input.endDate !== undefined) {
			setClauses.push(`end_date = $${paramIdx++}`);
			params.push(input.endDate);
		}

		if (input.completedSessions !== undefined) {
			setClauses.push(`completed_sessions = $${paramIdx++}`);
			params.push(input.completedSessions);
		}

		if (input.metadata !== undefined) {
			setClauses.push(`metadata = $${paramIdx++}`);
			params.push(JSON.stringify(input.metadata));
		}

		if (setClauses.length === 0) {
			return this.findById(id, client);
		}

		setClauses.push('updated_at = NOW()');
		params.push(id);

		const result = await executeQuery<SessionBooking>(
			this.pool,
			client,
			`
				UPDATE session_bookings
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${BOOKING_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async incrementCompletedSessions(id: string, client?: PoolClient): Promise<SessionBooking | null> {
		const result = await executeQuery<SessionBooking>(
			this.pool,
			client,
			`
				UPDATE session_bookings
				SET completed_sessions = completed_sessions + 1,
					updated_at = NOW()
				WHERE id = $1
				RETURNING ${BOOKING_COLUMNS}
			`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

