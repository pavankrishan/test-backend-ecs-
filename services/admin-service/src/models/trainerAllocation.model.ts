import type { Pool, PoolClient, QueryResult } from 'pg';
import { getPool } from '../config/database';

export type AllocationStatus = 'pending' | 'approved' | 'rejected' | 'active' | 'completed' | 'cancelled';

export interface TrainerAllocationRecord {
	id: string;
	studentId: string;
	trainerId: string | null; // null until allocated
	courseId: string | null;
	requestedBy: string; // Student ID or parent ID
	requestedAt: Date;
	status: AllocationStatus;
	allocatedBy: string | null; // Admin ID
	allocatedAt: Date | null;
	rejectedBy: string | null; // Admin ID
	rejectedAt: Date | null;
	rejectionReason: string | null;
	notes: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateAllocationInput {
	studentId: string;
	trainerId?: string | null;
	courseId?: string | null;
	requestedBy: string;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpdateAllocationInput {
	trainerId?: string | null;
	status?: AllocationStatus;
	notes?: string | null;
	rejectionReason?: string | null;
	metadata?: Record<string, unknown> | null;
}

const ALLOCATION_COLUMNS = `
	id,
	student_id AS "studentId",
	trainer_id AS "trainerId",
	course_id AS "courseId",
	requested_by AS "requestedBy",
	requested_at AS "requestedAt",
	status,
	allocated_by AS "allocatedBy",
	allocated_at AS "allocatedAt",
	rejected_by AS "rejectedBy",
	rejected_at AS "rejectedAt",
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

function mapRow(row: any): TrainerAllocationRecord {
	return {
		id: row.id,
		studentId: row.studentId,
		trainerId: row.trainerId,
		courseId: row.courseId,
		requestedBy: row.requestedBy,
		requestedAt: row.requestedAt,
		status: row.status,
		allocatedBy: row.allocatedBy,
		allocatedAt: row.allocatedAt,
		rejectedBy: row.rejectedBy,
		rejectedAt: row.rejectedAt,
		rejectionReason: row.rejectionReason,
		notes: row.notes,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureTrainerAllocationTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = async (text: string, params?: any[]) => {
		if ('query' in poolOrClient) {
			return (poolOrClient as Pool).query(text, params);
		}
		return (poolOrClient as PoolClient).query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS trainer_allocations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			student_id UUID NOT NULL,
			trainer_id UUID,
			course_id UUID,
			requested_by UUID NOT NULL,
			requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			status TEXT NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'completed', 'cancelled')),
			allocated_by UUID REFERENCES admin_users(id),
			allocated_at TIMESTAMPTZ,
			rejected_by UUID REFERENCES admin_users(id),
			rejected_at TIMESTAMPTZ,
			rejection_reason TEXT,
			notes TEXT,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Add unique constraint to prevent duplicate approved allocations
	// This ensures one active allocation per student-trainer-course combination
	await queryFn(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_unique_approved 
		ON trainer_allocations(student_id, trainer_id, COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid))
		WHERE status = 'approved';
	`);

	// Add missing columns for existing tables
	await queryFn(`
		DO $$
		BEGIN
			-- Add requested_by if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='requested_by'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN requested_by UUID;
				
				-- For existing rows, set requested_by to student_id as default
				UPDATE trainer_allocations 
				SET requested_by = student_id 
				WHERE requested_by IS NULL;
			END IF;
			
			-- Add requested_at if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='requested_at'
			) THEN
				-- Add as nullable first
				ALTER TABLE trainer_allocations 
				ADD COLUMN requested_at TIMESTAMPTZ;
				
				-- For existing rows, set requested_at to created_at or allocated_at
				UPDATE trainer_allocations 
				SET requested_at = COALESCE(allocated_at, created_at, NOW())
				WHERE requested_at IS NULL;
				
				-- Now set NOT NULL constraint if all rows have values
				ALTER TABLE trainer_allocations 
				ALTER COLUMN requested_at SET NOT NULL,
				ALTER COLUMN requested_at SET DEFAULT NOW();
			END IF;
			
			-- Add allocated_by if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='allocated_by'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN allocated_by UUID;
			END IF;
			
			-- Add rejected_by if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='rejected_by'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN rejected_by UUID;
			END IF;
			
			-- Add rejected_at if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='rejected_at'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN rejected_at TIMESTAMPTZ;
			END IF;
			
			-- Add rejection_reason if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='rejection_reason'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN rejection_reason TEXT;
			END IF;
			
			-- Add notes if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='notes'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN notes TEXT;
			END IF;
			
			-- Add metadata if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='metadata'
			) THEN
				ALTER TABLE trainer_allocations 
				ADD COLUMN metadata JSONB;
			END IF;
			
			-- Update status column type if needed (from VARCHAR to TEXT with CHECK)
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' 
				AND column_name='status' 
				AND data_type='character varying'
			) THEN
				-- We can't directly change the type with CHECK constraint, so we'll leave it
				-- The application will handle the status values
			END IF;
		END $$;
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_allocations_student ON trainer_allocations(student_id);
		CREATE INDEX IF NOT EXISTS idx_allocations_trainer ON trainer_allocations(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_allocations_status ON trainer_allocations(status);
		CREATE INDEX IF NOT EXISTS idx_allocations_course ON trainer_allocations(course_id) WHERE course_id IS NOT NULL;
	`);
	
	// Create requested_at index only if the column exists
	await queryFn(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='trainer_allocations' AND column_name='requested_at'
			) THEN
				CREATE INDEX IF NOT EXISTS idx_allocations_requested_at ON trainer_allocations(requested_at DESC);
			END IF;
		END $$;
	`);

	// Create index for time slot queries in metadata (for auto-assignment)
	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_allocations_metadata_time_slot 
		ON trainer_allocations((metadata->'schedule'->>'timeSlot'))
		WHERE metadata IS NOT NULL 
		AND metadata->'schedule' IS NOT NULL
		AND status IN ('approved', 'active');
	`);

	// Create index for date queries in metadata
	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_allocations_metadata_date 
		ON trainer_allocations((metadata->'schedule'->>'date'))
		WHERE metadata IS NOT NULL 
		AND metadata->'schedule' IS NOT NULL;
	`);
}

export class TrainerAllocationRepository {
	constructor(private readonly pool: Pool) {}

	getPool(): Pool {
		return this.pool;
	}

	async create(input: CreateAllocationInput, client?: PoolClient): Promise<TrainerAllocationRecord> {
		// Production logging
		console.log('[TrainerAllocationRepository] create called:', {
			studentId: input.studentId,
			trainerId: input.trainerId,
			courseId: input.courseId,
			hasTrainerId: !!input.trainerId,
		});

		const result = await executeQuery<TrainerAllocationRecord>(
			this.pool,
			client,
			`
				INSERT INTO trainer_allocations (
					student_id,
					trainer_id,
					course_id,
					requested_by,
					notes,
					metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING ${ALLOCATION_COLUMNS}
			`,
			[
				input.studentId,
				input.trainerId || null,
				input.courseId || null,
				input.requestedBy,
				input.notes || null,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		const allocation = mapRow(result.rows[0]);

		// Production logging - verify what was actually stored
		console.log('[TrainerAllocationRepository] create result:', {
			allocationId: allocation.id,
			studentId: allocation.studentId,
			trainerId: allocation.trainerId,
			status: allocation.status,
			hasTrainerId: !!allocation.trainerId,
			trainerIdMatch: allocation.trainerId === input.trainerId,
		});

		return allocation;
	}

	async findById(id: string, client?: PoolClient): Promise<TrainerAllocationRecord | null> {
		const result = await executeQuery<TrainerAllocationRecord>(
			this.pool,
			client,
			`SELECT ${ALLOCATION_COLUMNS} FROM trainer_allocations WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByStudentId(studentId: string, filters?: {
		status?: AllocationStatus;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<TrainerAllocationRecord[]> {
		const conditions: string[] = ['ta.student_id = $1'];
		const params: any[] = [studentId];
		let paramIdx = 2;

		if (filters?.status) {
			conditions.push(`ta.status = $${paramIdx++}`);
			params.push(filters.status);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 50;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		// Join with student_course_purchases to get session count (purchase_tier)
		const result = await executeQuery<any>(
			this.pool,
			client,
			`
				SELECT 
					ta.id,
					ta.student_id AS "studentId",
					ta.trainer_id AS "trainerId",
					ta.course_id AS "courseId",
					ta.requested_by AS "requestedBy",
					ta.requested_at AS "requestedAt",
					ta.status,
					ta.allocated_by AS "allocatedBy",
					ta.allocated_at AS "allocatedAt",
					ta.rejected_by AS "rejectedBy",
					ta.rejected_at AS "rejectedAt",
					ta.rejection_reason AS "rejectionReason",
					ta.notes,
					-- Merge existing metadata with sessionCount from student_course_purchases
					CASE
						WHEN scp.purchase_tier IS NOT NULL THEN jsonb_set(COALESCE(ta.metadata, '{}'::jsonb), '{sessionCount}', to_jsonb(scp.purchase_tier), true)
						ELSE ta.metadata
					END AS metadata,
					-- Also select purchase_tier separately so we can use it if metadata merge fails
					scp.purchase_tier AS "sessionCount",
					ta.created_at AS "createdAt",
					ta.updated_at AS "updatedAt"
				FROM trainer_allocations ta
				LEFT JOIN student_course_purchases scp 
					ON ta.student_id = scp.student_id 
					AND ta.course_id = scp.course_id 
					AND scp.is_active = true
				${whereClause}
				ORDER BY ta.requested_at DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		// Map rows and ensure sessionCount is in metadata
		// The SQL query merges it, but we also get it from the JOIN result (row.sessionCount)
		return result.rows.map((row: any) => {
			const allocation = mapRow(row);
			
			// Get sessionCount from row.sessionCount (from JOIN - purchase_tier)
			// This is more reliable than relying on SQL CASE merge
			const sessionCount = row.sessionCount;
			
			// Always add sessionCount to metadata and as direct field
			if (sessionCount) {
				// Ensure metadata exists
				if (!allocation.metadata) {
					allocation.metadata = {};
				}
				// Add to metadata (even if SQL already merged it, this ensures it's there)
				allocation.metadata.sessionCount = sessionCount;
				// Also add as direct field for easier access
				(allocation as any).sessionCount = sessionCount;
			} else {
				// Log warning if sessionCount is missing
				console.warn('[AllocationModel] No sessionCount found for allocation:', {
					allocationId: allocation.id,
					studentId: allocation.studentId,
					courseId: allocation.courseId,
					metadata: allocation.metadata,
				});
			}
			
			return allocation;
		});
	}

	async findByTrainerId(trainerId: string, filters?: {
		status?: AllocationStatus;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<TrainerAllocationRecord[]> {
		// CRITICAL: Filter out NULL trainer_id - only return allocations where trainer is actually assigned
		const conditions: string[] = ['trainer_id = $1', 'trainer_id IS NOT NULL'];
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

		// Production logging for debugging
		if (process.env.NODE_ENV === 'development') {
			console.log('[TrainerAllocationRepository] findByTrainerId query:', {
				trainerId,
				status: filters?.status,
				whereClause,
				params: params.slice(0, -2), // Exclude limit/offset for logging
			});
		}

		const result = await executeQuery<TrainerAllocationRecord>(
			this.pool,
			client,
			`
				SELECT ${ALLOCATION_COLUMNS}
				FROM trainer_allocations
				${whereClause}
				ORDER BY allocated_at DESC NULLS LAST, requested_at DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		// Production logging for debugging
		if (process.env.NODE_ENV === 'development') {
			console.log('[TrainerAllocationRepository] findByTrainerId result:', {
				trainerId,
				status: filters?.status,
				count: result.rows.length,
				allocations: result.rows.map(r => ({
					id: r.id,
					status: r.status,
					trainerId: r.trainerId,
					studentId: r.studentId,
				})),
			});
		}

		return result.rows.map(mapRow);
	}

	async findByTrainerAndStudent(trainerId: string, studentId: string, client?: PoolClient): Promise<TrainerAllocationRecord[]> {
		const result = await executeQuery<TrainerAllocationRecord>(
			this.pool,
			client,
			`
				SELECT ${ALLOCATION_COLUMNS}
				FROM trainer_allocations
				WHERE trainer_id = $1 AND student_id = $2
				ORDER BY allocated_at DESC NULLS LAST, requested_at DESC
			`,
			[trainerId, studentId]
		);

		return result.rows.map(mapRow);
	}

	async findAll(filters?: {
		status?: AllocationStatus;
		studentId?: string;
		trainerId?: string;
		courseId?: string | null;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<TrainerAllocationRecord[]> {
		const conditions: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (filters?.status) {
			conditions.push(`ta.status = $${paramIdx++}`);
			params.push(filters.status);
		}

		if (filters?.studentId) {
			conditions.push(`ta.student_id = $${paramIdx++}`);
			params.push(filters.studentId);
		}

		if (filters?.trainerId) {
			conditions.push(`ta.trainer_id = $${paramIdx++}`);
			params.push(filters.trainerId);
		}

		if (filters?.courseId !== undefined) {
			if (filters.courseId === null) {
				conditions.push(`ta.course_id IS NULL`);
			} else {
				conditions.push(`ta.course_id = $${paramIdx++}`);
				params.push(filters.courseId);
			}
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 50;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		// Join with student_course_purchases to get session count (purchase_tier)
		const result = await executeQuery<any>(
			this.pool,
			client,
			`
				SELECT 
					ta.id,
					ta.student_id AS "studentId",
					ta.trainer_id AS "trainerId",
					ta.course_id AS "courseId",
					ta.requested_by AS "requestedBy",
					ta.requested_at AS "requestedAt",
					ta.status,
					ta.allocated_by AS "allocatedBy",
					ta.allocated_at AS "allocatedAt",
					ta.rejected_by AS "rejectedBy",
					ta.rejected_at AS "rejectedAt",
					ta.rejection_reason AS "rejectionReason",
					ta.notes,
					ta.metadata,
					ta.created_at AS "createdAt",
					ta.updated_at AS "updatedAt",
					spp.purchase_tier AS "sessionCount"
				FROM trainer_allocations ta
				LEFT JOIN student_course_purchases spp 
					ON ta.student_id = spp.student_id 
					AND ta.course_id = spp.course_id 
					AND spp.is_active = true
				${whereClause}
				ORDER BY ta.requested_at DESC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		// Map rows and add session count to metadata if available
		return result.rows.map((row: any) => {
			const allocation = mapRow(row);
			// Add session count to metadata if available (from purchase_tier JOIN)
			if (row.sessionCount) {
				// Always add sessionCount to metadata, even if metadata is null
				if (allocation.metadata) {
					allocation.metadata = {
						...allocation.metadata,
						sessionCount: row.sessionCount,
					};
				} else {
					allocation.metadata = {
						sessionCount: row.sessionCount,
					};
				}
				// Also add as direct field for easier access
				(allocation as any).sessionCount = row.sessionCount;
			}
			return allocation;
		});
	}

	async update(
		id: string,
		input: UpdateAllocationInput,
		adminId: string,
		client?: PoolClient
	): Promise<TrainerAllocationRecord | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.trainerId !== undefined) {
			setClauses.push(`trainer_id = $${paramIdx++}`);
			params.push(input.trainerId);
		}

		if (input.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(input.status);

			// Set allocated/rejected timestamps based on status
			if (input.status === 'approved' || input.status === 'active') {
				setClauses.push(`allocated_by = $${paramIdx++}`);
				setClauses.push(`allocated_at = NOW()`);
				params.push(adminId);
			} else if (input.status === 'rejected') {
				setClauses.push(`rejected_by = $${paramIdx++}`);
				setClauses.push(`rejected_at = NOW()`);
				params.push(adminId);
			}
		}

		if (input.notes !== undefined) {
			setClauses.push(`notes = $${paramIdx++}`);
			params.push(input.notes);
		}

		if (input.rejectionReason !== undefined) {
			setClauses.push(`rejection_reason = $${paramIdx++}`);
			params.push(input.rejectionReason);
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

		const result = await executeQuery<TrainerAllocationRecord>(
			this.pool,
			client,
			`
				UPDATE trainer_allocations
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${ALLOCATION_COLUMNS}
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
			`DELETE FROM trainer_allocations WHERE id = $1`,
			[id]
		);

		return (result.rowCount ?? 0) > 0;
	}
}

