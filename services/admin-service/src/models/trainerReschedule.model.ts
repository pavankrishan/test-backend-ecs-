import type { Pool, PoolClient, QueryResult } from 'pg';
import { getPool } from '../config/database';

export type RescheduleStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TrainerRescheduleRecord {
	id: string;
	sessionId: string;
	allocationId: string;
	studentId: string;
	trainerId: string;
	requestedBy: string; // Student ID or Trainer ID
	requestType: 'student' | 'trainer';
	originalDate: Date;
	originalTime: string;
	newDate: Date;
	newTime: string;
	reason: string;
	status: RescheduleStatus;
	reviewedBy: string | null; // Admin ID
	reviewedAt: Date | null;
	rejectionReason: string | null;
	notes: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateRescheduleInput {
	sessionId: string;
	allocationId: string;
	studentId: string;
	trainerId: string;
	requestedBy: string;
	requestType: 'student' | 'trainer';
	originalDate: Date;
	originalTime: string;
	newDate: Date;
	newTime: string;
	reason: string;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpdateRescheduleInput {
	newDate?: Date;
	newTime?: string;
	reason?: string;
	status?: RescheduleStatus;
	rejectionReason?: string | null;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
}

const RESCHEDULE_COLUMNS = `
	id,
	session_id AS "sessionId",
	allocation_id AS "allocationId",
	student_id AS "studentId",
	trainer_id AS "trainerId",
	requested_by AS "requestedBy",
	request_type AS "requestType",
	original_date AS "originalDate",
	original_time AS "originalTime",
	new_date AS "newDate",
	new_time AS "newTime",
	reason,
	status,
	reviewed_by AS "reviewedBy",
	reviewed_at AS "reviewedAt",
	rejection_reason AS "rejectionReason",
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

function mapRow(row: any): TrainerRescheduleRecord {
	return {
		id: row.id,
		sessionId: row.sessionId,
		allocationId: row.allocationId,
		studentId: row.studentId,
		trainerId: row.trainerId,
		requestedBy: row.requestedBy,
		requestType: row.requestType,
		originalDate: row.originalDate,
		originalTime: row.originalTime,
		newDate: row.newDate,
		newTime: row.newTime,
		reason: row.reason,
		status: row.status,
		reviewedBy: row.reviewedBy,
		reviewedAt: row.reviewedAt,
		rejectionReason: row.rejectionReason,
		notes: row.notes,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureTrainerRescheduleTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = async (text: string, params?: any[]) => {
		if ('query' in poolOrClient) {
			return (poolOrClient as Pool).query(text, params);
		}
		return (poolOrClient as PoolClient).query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS trainer_reschedules (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			session_id UUID NOT NULL REFERENCES tutoring_sessions(id) ON DELETE CASCADE,
			allocation_id UUID NOT NULL REFERENCES trainer_allocations(id) ON DELETE CASCADE,
			student_id UUID NOT NULL,
			trainer_id UUID NOT NULL,
			requested_by UUID NOT NULL,
			request_type TEXT NOT NULL CHECK (request_type IN ('student', 'trainer')),
			original_date DATE NOT NULL,
			original_time VARCHAR(20) NOT NULL,
			new_date DATE NOT NULL,
			new_time VARCHAR(20) NOT NULL,
			reason TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
			reviewed_by UUID REFERENCES admin_users(id),
			reviewed_at TIMESTAMPTZ,
			rejection_reason TEXT,
			notes TEXT,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Add missing columns for existing tables (migration from old schema)
	await queryFn(`
		DO $$
		BEGIN
			-- Add allocation_id column if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='allocation_id'
			) THEN
				-- Check if trainer_allocations table exists first
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='trainer_allocations') THEN
					-- Add column as nullable first (in case table has existing rows)
					ALTER TABLE trainer_reschedules 
					ADD COLUMN allocation_id UUID REFERENCES trainer_allocations(id) ON DELETE CASCADE;
				ELSE
					-- If trainer_allocations doesn't exist yet, add column without foreign key constraint
					ALTER TABLE trainer_reschedules 
					ADD COLUMN allocation_id UUID;
				END IF;
			END IF;
			
			-- Add student_id if it doesn't exist (old schema didn't have it)
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='student_id'
			) THEN
				ALTER TABLE trainer_reschedules 
				ADD COLUMN student_id UUID;
			END IF;
			
			-- Add requested_by if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='requested_by'
			) THEN
				ALTER TABLE trainer_reschedules 
				ADD COLUMN requested_by UUID;
			END IF;
			
			-- Add request_type if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='request_type'
			) THEN
				ALTER TABLE trainer_reschedules 
				ADD COLUMN request_type TEXT CHECK (request_type IN ('student', 'trainer'));
			END IF;
			
			-- Migrate old_date to original_date if needed
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='old_date'
			) AND NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='original_date'
			) THEN
				-- Rename old new_date to avoid conflict
				ALTER TABLE trainer_reschedules RENAME COLUMN new_date TO old_new_date;
				
				-- Add new columns
				ALTER TABLE trainer_reschedules 
				ADD COLUMN original_date DATE,
				ADD COLUMN original_time VARCHAR(20) DEFAULT '09:00',
				ADD COLUMN new_date DATE,
				ADD COLUMN new_time VARCHAR(20) DEFAULT '09:00';
				
				-- Migrate data from old columns to new columns
				UPDATE trainer_reschedules 
				SET original_date = old_date::DATE,
				    original_time = TO_CHAR(old_date::TIMESTAMP, 'HH24:MI'),
				    new_date = old_new_date::DATE,
				    new_time = TO_CHAR(old_new_date::TIMESTAMP, 'HH24:MI')
				WHERE original_date IS NULL;
				
				-- Drop old columns
				ALTER TABLE trainer_reschedules DROP COLUMN old_date;
				ALTER TABLE trainer_reschedules DROP COLUMN old_new_date;
			END IF;
			
			-- Add original_date if it doesn't exist (for new tables)
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='original_date'
			) THEN
				ALTER TABLE trainer_reschedules 
				ADD COLUMN original_date DATE,
				ADD COLUMN original_time VARCHAR(20) DEFAULT '09:00',
				ADD COLUMN new_date DATE,
				ADD COLUMN new_time VARCHAR(20) DEFAULT '09:00';
			END IF;
			
			-- Add reviewed_by if it doesn't exist (old schema had approved_by)
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='approved_by'
			) AND NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='reviewed_by'
			) THEN
				ALTER TABLE trainer_reschedules 
				ADD COLUMN reviewed_by UUID,
				ADD COLUMN reviewed_at TIMESTAMPTZ,
				ADD COLUMN rejection_reason TEXT,
				ADD COLUMN notes TEXT,
				ADD COLUMN metadata JSONB;
				
				-- Migrate approved_by to reviewed_by
				UPDATE trainer_reschedules 
				SET reviewed_by = approved_by
				WHERE reviewed_by IS NULL AND approved_by IS NOT NULL;
			END IF;
			
			-- Add reviewed_by if it doesn't exist (for new tables)
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='reviewed_by'
			) THEN
				ALTER TABLE trainer_reschedules 
				ADD COLUMN reviewed_by UUID,
				ADD COLUMN reviewed_at TIMESTAMPTZ,
				ADD COLUMN rejection_reason TEXT,
				ADD COLUMN notes TEXT,
				ADD COLUMN metadata JSONB;
			END IF;
		END $$;
	`);

	// Create indexes (only if columns exist)
	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_reschedules_session ON trainer_reschedules(session_id);
		CREATE INDEX IF NOT EXISTS idx_reschedules_student ON trainer_reschedules(student_id);
		CREATE INDEX IF NOT EXISTS idx_reschedules_trainer ON trainer_reschedules(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_reschedules_status ON trainer_reschedules(status);
		CREATE INDEX IF NOT EXISTS idx_reschedules_created_at ON trainer_reschedules(created_at DESC);
	`);

	// Create allocation_id index only if the column exists
	await queryFn(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_reschedules' AND column_name='allocation_id'
			) THEN
				CREATE INDEX IF NOT EXISTS idx_reschedules_allocation ON trainer_reschedules(allocation_id);
			END IF;
		END $$;
	`);
}

export class TrainerRescheduleRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: CreateRescheduleInput, client?: PoolClient): Promise<TrainerRescheduleRecord> {
		const result = await executeQuery<TrainerRescheduleRecord>(
			this.pool,
			client,
			`
				INSERT INTO trainer_reschedules (
					session_id,
					allocation_id,
					student_id,
					trainer_id,
					requested_by,
					request_type,
					original_date,
					original_time,
					new_date,
					new_time,
					reason,
					notes,
					metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
				RETURNING ${RESCHEDULE_COLUMNS}
			`,
			[
				input.sessionId,
				input.allocationId,
				input.studentId,
				input.trainerId,
				input.requestedBy,
				input.requestType,
				input.originalDate,
				input.originalTime,
				input.newDate,
				input.newTime,
				input.reason,
				input.notes || null,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<TrainerRescheduleRecord | null> {
		const result = await executeQuery<TrainerRescheduleRecord>(
			this.pool,
			client,
			`SELECT ${RESCHEDULE_COLUMNS} FROM trainer_reschedules WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findBySessionId(sessionId: string, client?: PoolClient): Promise<TrainerRescheduleRecord[]> {
		const result = await executeQuery<TrainerRescheduleRecord>(
			this.pool,
			client,
			`SELECT ${RESCHEDULE_COLUMNS} FROM trainer_reschedules WHERE session_id = $1 ORDER BY created_at DESC`,
			[sessionId]
		);

		return result.rows.map(mapRow);
	}

	async findAll(filters?: {
		status?: RescheduleStatus;
		studentId?: string;
		trainerId?: string;
		sessionId?: string;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<TrainerRescheduleRecord[]> {
		const conditions: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (filters?.status) {
			conditions.push(`status = $${paramIdx++}`);
			params.push(filters.status);
		}

		if (filters?.studentId) {
			conditions.push(`student_id = $${paramIdx++}`);
			params.push(filters.studentId);
		}

		if (filters?.trainerId) {
			conditions.push(`trainer_id = $${paramIdx++}`);
			params.push(filters.trainerId);
		}

		if (filters?.sessionId) {
			conditions.push(`session_id = $${paramIdx++}`);
			params.push(filters.sessionId);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 50;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<TrainerRescheduleRecord>(
			this.pool,
			client,
			`
				SELECT ${RESCHEDULE_COLUMNS}
				FROM trainer_reschedules
				${whereClause}
				ORDER BY created_at DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async update(
		id: string,
		input: UpdateRescheduleInput,
		adminId?: string,
		client?: PoolClient
	): Promise<TrainerRescheduleRecord | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.newDate !== undefined) {
			setClauses.push(`new_date = $${paramIdx++}`);
			params.push(input.newDate);
		}

		if (input.newTime !== undefined) {
			setClauses.push(`new_time = $${paramIdx++}`);
			params.push(input.newTime);
		}

		if (input.reason !== undefined) {
			setClauses.push(`reason = $${paramIdx++}`);
			params.push(input.reason);
		}

		if (input.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(input.status);

			if (input.status === 'approved' || input.status === 'rejected') {
				if (adminId) {
					setClauses.push(`reviewed_by = $${paramIdx++}`);
					setClauses.push(`reviewed_at = NOW()`);
					params.push(adminId);
				}
			}
		}

		if (input.rejectionReason !== undefined) {
			setClauses.push(`rejection_reason = $${paramIdx++}`);
			params.push(input.rejectionReason);
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

		const result = await executeQuery<TrainerRescheduleRecord>(
			this.pool,
			client,
			`
				UPDATE trainer_reschedules
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${RESCHEDULE_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async delete(id: string, client?: PoolClient): Promise<boolean> {
		const result = await executeQuery(
			this.pool,
			client,
			`DELETE FROM trainer_reschedules WHERE id = $1`,
			[id]
		);

		return (result.rowCount ?? 0) > 0;
	}
}



