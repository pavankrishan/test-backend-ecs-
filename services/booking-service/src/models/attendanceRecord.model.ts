/**
 * Attendance Record Model - PostgreSQL Schema
 * Tracks daily attendance for sessions
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type AttendanceStatus = 'present' | 'absent' | 'rescheduled' | 'cancelled';

export interface AttendanceRecord {
	id: string;
	bookingId: string;
	sessionId: string | null; // Links to tutoring_sessions table
	trainerId: string;
	studentId: string;
	date: Date;
	timeslot: string;
	status: AttendanceStatus;
	notes: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface AttendanceRecordCreateInput {
	bookingId: string;
	sessionId?: string | null;
	trainerId: string;
	studentId: string;
	date: Date;
	timeslot: string;
	status: AttendanceStatus;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface AttendanceRecordUpdateInput {
	status?: AttendanceStatus;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
}

const ATTENDANCE_COLUMNS = `
	id,
	booking_id AS "bookingId",
	session_id AS "sessionId",
	trainer_id AS "trainerId",
	student_id AS "studentId",
	date,
	timeslot,
	status,
	notes,
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

function mapRow(row: any): AttendanceRecord {
	return {
		id: row.id,
		bookingId: row.bookingId,
		sessionId: row.sessionId,
		trainerId: row.trainerId,
		studentId: row.studentId,
		date: row.date,
		timeslot: row.timeslot,
		status: row.status,
		notes: row.notes,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureAttendanceRecordTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS attendance_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			booking_id UUID NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
			session_id UUID,
			trainer_id UUID NOT NULL,
			student_id UUID NOT NULL,
			date DATE NOT NULL,
			timeslot VARCHAR(10) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'absent'
				CHECK (status IN ('present', 'absent', 'rescheduled', 'cancelled')),
			notes TEXT,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(booking_id, date)
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_attendance_booking ON attendance_records(booking_id);
		CREATE INDEX IF NOT EXISTS idx_attendance_trainer ON attendance_records(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
		CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
		CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);
	`);
}

export class AttendanceRecordRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: AttendanceRecordCreateInput, client?: PoolClient): Promise<AttendanceRecord> {
		const result = await executeQuery<AttendanceRecord>(
			this.pool,
			client,
			`
				INSERT INTO attendance_records (
					booking_id, session_id, trainer_id, student_id, date, timeslot, status, notes, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT (booking_id, date) DO UPDATE SET
					status = EXCLUDED.status,
					notes = EXCLUDED.notes,
					metadata = EXCLUDED.metadata,
					updated_at = NOW()
				RETURNING ${ATTENDANCE_COLUMNS}
			`,
			[
				input.bookingId,
				input.sessionId || null,
				input.trainerId,
				input.studentId,
				input.date,
				input.timeslot,
				input.status,
				input.notes || null,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<AttendanceRecord | null> {
		const result = await executeQuery<AttendanceRecord>(
			this.pool,
			client,
			`SELECT ${ATTENDANCE_COLUMNS} FROM attendance_records WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByBookingId(bookingId: string, client?: PoolClient): Promise<AttendanceRecord[]> {
		const result = await executeQuery<AttendanceRecord>(
			this.pool,
			client,
			`SELECT ${ATTENDANCE_COLUMNS} FROM attendance_records WHERE booking_id = $1 ORDER BY date ASC`,
			[bookingId]
		);

		return result.rows.map(mapRow);
	}

	async findByTrainerId(
		trainerId: string,
		filters?: {
			startDate?: Date;
			endDate?: Date;
			status?: AttendanceStatus;
			limit?: number;
			offset?: number;
		},
		client?: PoolClient
	): Promise<AttendanceRecord[]> {
		const conditions: string[] = ['trainer_id = $1'];
		const params: any[] = [trainerId];
		let paramIdx = 2;

		if (filters?.startDate) {
			conditions.push(`date >= $${paramIdx++}`);
			params.push(filters.startDate);
		}

		if (filters?.endDate) {
			conditions.push(`date <= $${paramIdx++}`);
			params.push(filters.endDate);
		}

		if (filters?.status) {
			conditions.push(`status = $${paramIdx++}`);
			params.push(filters.status);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 100;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<AttendanceRecord>(
			this.pool,
			client,
			`
				SELECT ${ATTENDANCE_COLUMNS}
				FROM attendance_records
				${whereClause}
				ORDER BY date DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async update(id: string, input: AttendanceRecordUpdateInput, client?: PoolClient): Promise<AttendanceRecord | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(input.status);
		}

		if (input.notes !== undefined) {
			setClauses.push(`notes = $${paramIdx++}`);
			params.push(input.notes);
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

		const result = await executeQuery<AttendanceRecord>(
			this.pool,
			client,
			`
				UPDATE attendance_records
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${ATTENDANCE_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

