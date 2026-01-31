import type { Pool, PoolClient, QueryResult } from 'pg';
import { getPool } from '../config/database';

export type SessionStatus = 'scheduled' | 'pending_verification' | 'in_progress' | 'pending_confirmation' | 'completed' | 'disputed' | 'cancelled';

export interface SessionRecord {
	id: string;
	allocationId: string | null; // Links to trainer_allocations (nullable for backward compatibility)
	studentId: string;
	trainerId: string;
	courseId: string | null;
	scheduledDate: Date;
	scheduledTime: string;
	duration: number; // in minutes
	status: SessionStatus;
	
	// GPS Verification
	studentHomeLocation: {
		latitude: number;
		longitude: number;
		address?: string;
	} | null;
	trainerStartLocation: {
		latitude: number;
		longitude: number;
		timestamp: Date;
	} | null;
	trainerEndLocation: {
		latitude: number;
		longitude: number;
		timestamp: Date;
	} | null;
	gpsVerificationPassed: boolean | null;
	gpsVerificationDistance: number | null; // in meters
	
	// Face Verification
	trainerFaceVerificationImage: string | null; // Base64 or URL
	faceVerificationPassed: boolean | null;
	faceVerificationConfidence: number | null; // 0-100
	faceVerificationMethod: 'selfie' | 'video' | null;
	
	// Combined Verification
	verificationPassed: boolean | null;
	verificationFailedReason: string | null;
	
	// Session Timing
	startedAt: Date | null;
	endedAt: Date | null;
	actualDuration: number | null; // in minutes
	
	// Student/Parent Confirmation
	studentConfirmed: boolean | null;
	studentConfirmedAt: Date | null;
	studentConfirmationNotes: string | null;
	
	// Earnings
	price: number | null; // Trainer payout amount (₹200 per confirmed session)
	
	// Dispute Handling
	disputedReason: string | null;
	disputedAt: Date | null;
	resolvedAt: Date | null;
	resolvedBy: string | null; // Admin ID
	resolutionNotes: string | null;
	
	// Student OTP Verification (Reverse Flow)
	studentOtp: string | null; // OTP generated when trainer arrives
	studentOtpGeneratedAt: Date | null;
	studentOtpVerified: boolean | null;
	studentOtpVerifiedAt: Date | null;
	
	// Metadata
	otp: string | null; // Legacy OTP field (deprecated)
	notes: string | null;
	metadata: Record<string, unknown> | null;
	
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateSessionInput {
	allocationId: string;
	studentId: string;
	trainerId: string;
	courseId?: string | null;
	scheduledDate: Date;
	scheduledTime: string;
	duration: number;
	studentHomeLocation: {
		latitude: number;
		longitude: number;
		address?: string;
	};
	otp?: string | null;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface StartSessionInput {
	trainerLocation: {
		latitude: number;
		longitude: number;
	};
	faceVerificationImage: string; // Base64 encoded image
	faceVerificationMethod?: 'selfie' | 'video';
}

export interface EndSessionInput {
	trainerLocation: {
		latitude: number;
		longitude: number;
	};
	notes?: string | null;
}

export interface ConfirmSessionInput {
	confirmed: boolean;
	notes?: string | null;
}

const SESSION_COLUMNS = `
	id,
	allocation_id AS "allocationId",
	student_id AS "studentId",
	trainer_id AS "trainerId",
	course_id AS "courseId",
	TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
	scheduled_time AS "scheduledTime",
	duration,
	status,
	student_home_location AS "studentHomeLocation",
	trainer_start_location AS "trainerStartLocation",
	trainer_end_location AS "trainerEndLocation",
	gps_verification_passed AS "gpsVerificationPassed",
	gps_verification_distance AS "gpsVerificationDistance",
	trainer_face_verification_image AS "trainerFaceVerificationImage",
	face_verification_passed AS "faceVerificationPassed",
	face_verification_confidence AS "faceVerificationConfidence",
	face_verification_method AS "faceVerificationMethod",
	verification_passed AS "verificationPassed",
	verification_failed_reason AS "verificationFailedReason",
	started_at AS "startedAt",
	ended_at AS "endedAt",
	actual_duration AS "actualDuration",
	student_confirmed AS "studentConfirmed",
	student_confirmed_at AS "studentConfirmedAt",
	student_confirmation_notes AS "studentConfirmationNotes",
	price,
	disputed_reason AS "disputedReason",
	disputed_at AS "disputedAt",
	resolved_at AS "resolvedAt",
	resolved_by AS "resolvedBy",
	resolution_notes AS "resolutionNotes",
	student_otp AS "studentOtp",
	student_otp_generated_at AS "studentOtpGeneratedAt",
	student_otp_verified AS "studentOtpVerified",
	student_otp_verified_at AS "studentOtpVerifiedAt",
	otp,
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

function mapRow(row: any): SessionRecord {
	// CRITICAL: Handle scheduled_date conversion to avoid timezone shifts
	// scheduled_date is returned as a string (YYYY-MM-DD) from PostgreSQL TO_CHAR
	// Parse it as local date components to avoid timezone conversion
	let scheduledDate: Date;
	if (typeof row.scheduledDate === 'string') {
		// Parse date string (YYYY-MM-DD) as local date components
		const dateParts = row.scheduledDate.split(/[-/T]/);
		if (dateParts.length >= 3) {
			scheduledDate = new Date(
				parseInt(dateParts[0], 10), // year
				parseInt(dateParts[1], 10) - 1, // month (0-indexed)
				parseInt(dateParts[2], 10) // day
			);
		} else {
			// Fallback if parsing fails
			scheduledDate = new Date(row.scheduledDate);
		}
	} else if (row.scheduledDate instanceof Date) {
		// If it's already a Date object (fallback), use UTC methods to extract date components
		scheduledDate = new Date(
			row.scheduledDate.getUTCFullYear(),
			row.scheduledDate.getUTCMonth(),
			row.scheduledDate.getUTCDate()
		);
	} else {
		scheduledDate = row.scheduledDate;
	}
	
	return {
		id: row.id,
		allocationId: row.allocationId,
		studentId: row.studentId,
		trainerId: row.trainerId,
		courseId: row.courseId,
		scheduledDate,
		scheduledTime: row.scheduledTime,
		duration: row.duration,
		status: row.status,
		studentHomeLocation: row.studentHomeLocation ? (typeof row.studentHomeLocation === 'string' ? JSON.parse(row.studentHomeLocation) : row.studentHomeLocation) : null,
		trainerStartLocation: row.trainerStartLocation ? (typeof row.trainerStartLocation === 'string' ? JSON.parse(row.trainerStartLocation) : row.trainerStartLocation) : null,
		trainerEndLocation: row.trainerEndLocation ? (typeof row.trainerEndLocation === 'string' ? JSON.parse(row.trainerEndLocation) : row.trainerEndLocation) : null,
		gpsVerificationPassed: row.gpsVerificationPassed,
		gpsVerificationDistance: row.gpsVerificationDistance,
		trainerFaceVerificationImage: row.trainerFaceVerificationImage,
		faceVerificationPassed: row.faceVerificationPassed,
		faceVerificationConfidence: row.faceVerificationConfidence,
		faceVerificationMethod: row.faceVerificationMethod,
		verificationPassed: row.verificationPassed,
		verificationFailedReason: row.verificationFailedReason,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		actualDuration: row.actualDuration,
		studentConfirmed: row.studentConfirmed,
		studentConfirmedAt: row.studentConfirmedAt,
		studentConfirmationNotes: row.studentConfirmationNotes,
		price: row.price ?? null,
		disputedReason: row.disputedReason,
		disputedAt: row.disputedAt,
		resolvedAt: row.resolvedAt,
		resolvedBy: row.resolvedBy,
		resolutionNotes: row.resolutionNotes,
		studentOtp: row.studentOtp,
		studentOtpGeneratedAt: row.studentOtpGeneratedAt,
		studentOtpVerified: row.studentOtpVerified,
		studentOtpVerifiedAt: row.studentOtpVerifiedAt,
		otp: row.otp,
		notes: row.notes,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureSessionTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS tutoring_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			allocation_id UUID NOT NULL REFERENCES trainer_allocations(id) ON DELETE CASCADE,
			student_id UUID NOT NULL,
			trainer_id UUID NOT NULL,
			course_id UUID,
			scheduled_date DATE NOT NULL,
			scheduled_time VARCHAR(20) NOT NULL,
			duration INT NOT NULL DEFAULT 40,
			status TEXT NOT NULL DEFAULT 'scheduled' 
				CHECK (status IN ('scheduled', 'pending_verification', 'in_progress', 'pending_confirmation', 'completed', 'disputed', 'cancelled')),
			
			-- GPS Verification
			student_home_location JSONB,
			trainer_start_location JSONB,
			trainer_end_location JSONB,
			gps_verification_passed BOOLEAN,
			gps_verification_distance NUMERIC(10, 2),
			
			-- Face Verification
			trainer_face_verification_image TEXT,
			face_verification_passed BOOLEAN,
			face_verification_confidence NUMERIC(5, 2),
			face_verification_method TEXT CHECK (face_verification_method IN ('selfie', 'video')),
			
			-- Combined Verification
			verification_passed BOOLEAN,
			verification_failed_reason TEXT,
			
			-- Session Timing
			started_at TIMESTAMPTZ,
			ended_at TIMESTAMPTZ,
			actual_duration INT,
			
			-- Student/Parent Confirmation
			student_confirmed BOOLEAN,
			student_confirmed_at TIMESTAMPTZ,
			student_confirmation_notes TEXT,
			
			-- Earnings
			price NUMERIC(10, 2), -- Trainer payout amount (₹200 per confirmed session)
			
			-- Dispute Handling
			disputed_reason TEXT,
			disputed_at TIMESTAMPTZ,
			resolved_at TIMESTAMPTZ,
			resolved_by UUID REFERENCES admin_users(id),
			resolution_notes TEXT,
			
			-- Student OTP Verification (Reverse Flow)
			student_otp VARCHAR(10),
			student_otp_generated_at TIMESTAMPTZ,
			student_otp_verified BOOLEAN,
			student_otp_verified_at TIMESTAMPTZ,
			
			-- Metadata
			otp VARCHAR(10),
			notes TEXT,
			metadata JSONB,
			
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Migrate session_date to scheduled_date if needed (for existing tables)
	await queryFn(`
		DO $$
		BEGIN
			-- If session_date exists but scheduled_date doesn't, migrate the data
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='session_date'
			) AND NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='scheduled_date'
			) THEN
				ALTER TABLE tutoring_sessions 
				ADD COLUMN scheduled_date DATE,
				ADD COLUMN scheduled_time VARCHAR(20) DEFAULT '09:00';
				
				-- Migrate data from session_date to scheduled_date
				UPDATE tutoring_sessions 
				SET scheduled_date = session_date::DATE,
				    scheduled_time = TO_CHAR(session_date::TIMESTAMP, 'HH24:MI')
				WHERE scheduled_date IS NULL;
			END IF;
			
			-- Add scheduled_date if it doesn't exist (for new tables)
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='scheduled_date'
			) THEN
				ALTER TABLE tutoring_sessions 
				ADD COLUMN scheduled_date DATE,
				ADD COLUMN scheduled_time VARCHAR(20) DEFAULT '09:00';
			END IF;
			
			-- Handle case where both columns exist (migration in progress)
			-- Migrate any missing data and drop NOT NULL constraint from session_date
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='session_date'
			) AND EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='scheduled_date'
			) THEN
				-- Migrate any remaining data
				UPDATE tutoring_sessions 
				SET scheduled_date = session_date::DATE,
				    scheduled_time = COALESCE(scheduled_time, TO_CHAR(session_date::TIMESTAMP, 'HH24:MI'))
				WHERE scheduled_date IS NULL AND session_date IS NOT NULL;
				
				-- Drop NOT NULL constraint from session_date if it exists
				ALTER TABLE tutoring_sessions ALTER COLUMN session_date DROP NOT NULL;
			END IF;
			
			-- Add duration column if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='duration'
			) THEN
				ALTER TABLE tutoring_sessions 
				ADD COLUMN duration INT NOT NULL DEFAULT 60;
			END IF;
		END $$;
	`);

	// Add allocation_id column if it doesn't exist (for existing tables)
	await queryFn(`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='allocation_id'
			) THEN
				-- Check if trainer_allocations table exists first
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='trainer_allocations') THEN
					-- Add column as nullable first (in case table has existing rows)
					ALTER TABLE tutoring_sessions 
					ADD COLUMN allocation_id UUID REFERENCES trainer_allocations(id) ON DELETE CASCADE;
					
					-- If table is empty or all rows can have allocation_id, we could make it NOT NULL
					-- But for safety, we'll leave it nullable for existing tables
				ELSE
					-- If trainer_allocations doesn't exist yet, add column without foreign key constraint
					-- The foreign key will be added later when trainer_allocations is created
					ALTER TABLE tutoring_sessions 
					ADD COLUMN allocation_id UUID;
				END IF;
			END IF;
		END $$;
	`);

	// Create indexes (only if columns exist)
	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_sessions_student ON tutoring_sessions(student_id);
		CREATE INDEX IF NOT EXISTS idx_sessions_trainer ON tutoring_sessions(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_sessions_status ON tutoring_sessions(status);
		CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_date ON tutoring_sessions(scheduled_date);
	`);

	// Create allocation_id index only if the column exists
	await queryFn(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='allocation_id'
			) THEN
				CREATE INDEX IF NOT EXISTS idx_sessions_allocation ON tutoring_sessions(allocation_id);
			END IF;
		END $$;
	`);

	// Add GPS and verification columns if they don't exist (migration for existing tables)
	await queryFn(`
		DO $$
		BEGIN
			-- Add student_home_location if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_home_location'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_home_location JSONB;
			END IF;

			-- Add trainer_start_location if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='trainer_start_location'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN trainer_start_location JSONB;
			END IF;

			-- Add trainer_end_location if it doesn't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='trainer_end_location'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN trainer_end_location JSONB;
			END IF;

			-- Add GPS verification columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='gps_verification_passed'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN gps_verification_passed BOOLEAN;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='gps_verification_distance'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN gps_verification_distance NUMERIC(10, 2);
			END IF;

			-- Add face verification columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='trainer_face_verification_image'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN trainer_face_verification_image TEXT;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='face_verification_passed'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN face_verification_passed BOOLEAN;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='face_verification_confidence'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN face_verification_confidence NUMERIC(5, 2);
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='face_verification_method'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN face_verification_method TEXT 
					CHECK (face_verification_method IN ('selfie', 'video'));
			END IF;

			-- Add combined verification columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='verification_passed'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN verification_passed BOOLEAN;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='verification_failed_reason'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN verification_failed_reason TEXT;
			END IF;

			-- Add student OTP verification columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_otp'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_otp VARCHAR(10);
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_otp_generated_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_otp_generated_at TIMESTAMPTZ;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_otp_verified'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_otp_verified BOOLEAN;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_otp_verified_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_otp_verified_at TIMESTAMPTZ;
			END IF;

			-- Add student confirmation columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_confirmed'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_confirmed BOOLEAN;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_confirmed_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_confirmed_at TIMESTAMPTZ;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='student_confirmation_notes'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN student_confirmation_notes TEXT;
			END IF;

			-- Add price column if it doesn't exist (trainer payout amount)
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='price'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN price NUMERIC(10, 2);
			END IF;

			-- Add dispute handling columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='disputed_reason'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN disputed_reason TEXT;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='disputed_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN disputed_at TIMESTAMPTZ;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='resolved_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN resolved_at TIMESTAMPTZ;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='resolved_by'
			) THEN
				-- Check if admin_users table exists before adding foreign key
				IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='admin_users') THEN
					ALTER TABLE tutoring_sessions ADD COLUMN resolved_by UUID REFERENCES admin_users(id);
				ELSE
					ALTER TABLE tutoring_sessions ADD COLUMN resolved_by UUID;
				END IF;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='resolution_notes'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN resolution_notes TEXT;
			END IF;

			-- Add timing columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='started_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN started_at TIMESTAMPTZ;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='ended_at'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN ended_at TIMESTAMPTZ;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='actual_duration'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN actual_duration INT;
			END IF;

			-- Add legacy otp column if it doesn't exist (for backward compatibility)
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='otp'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN otp VARCHAR(10);
			END IF;

			-- Add notes and metadata columns if they don't exist
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='notes'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN notes TEXT;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name='tutoring_sessions' AND column_name='metadata'
			) THEN
				ALTER TABLE tutoring_sessions ADD COLUMN metadata JSONB;
			END IF;
		END $$;
	`);
}

export class SessionRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: CreateSessionInput, client?: PoolClient): Promise<SessionRecord> {
		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				INSERT INTO tutoring_sessions (
					allocation_id,
					student_id,
					trainer_id,
					course_id,
					scheduled_date,
					scheduled_time,
					duration,
					student_home_location,
					otp,
					notes,
					metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				RETURNING ${SESSION_COLUMNS}
			`,
			[
				input.allocationId,
				input.studentId,
				input.trainerId,
				input.courseId || null,
				// CRITICAL: Format date as YYYY-MM-DD string to avoid timezone conversion
				// PostgreSQL DATE type expects a date string or Date object, but Date objects can be timezone-shifted
				input.scheduledDate instanceof Date
					? `${input.scheduledDate.getFullYear()}-${String(input.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(input.scheduledDate.getDate()).padStart(2, '0')}`
					: input.scheduledDate,
				input.scheduledTime,
				input.duration,
				JSON.stringify(input.studentHomeLocation),
				input.otp || null,
				input.notes || null,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<SessionRecord | null> {
		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`SELECT ${SESSION_COLUMNS} FROM tutoring_sessions WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByStudentId(studentId: string, filters?: {
		status?: SessionStatus;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<SessionRecord[]> {
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

		// For upcoming/scheduled sessions, order by ASC (earliest first)
		// For completed sessions, order by DESC (latest first)
		const orderDirection = filters?.status === 'completed' || filters?.status === 'cancelled' 
			? 'DESC' 
			: 'ASC';

		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				SELECT ${SESSION_COLUMNS}
				FROM tutoring_sessions
				${whereClause}
				ORDER BY scheduled_date ${orderDirection}, scheduled_time ${orderDirection}
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async findByTrainerAndStudent(
		trainerId: string,
		studentId: string,
		filters?: {
			startDate?: Date;
			endDate?: Date;
			status?: SessionStatus | SessionStatus[];
		},
		client?: PoolClient
	): Promise<SessionRecord[]> {
		const conditions: string[] = ['trainer_id = $1', 'student_id = $2'];
		const params: any[] = [trainerId, studentId];
		let paramIdx = 3;

		if (filters?.startDate) {
			conditions.push(`scheduled_date >= $${paramIdx++}`);
			params.push(filters.startDate);
		}

		if (filters?.endDate) {
			conditions.push(`scheduled_date < $${paramIdx++}`);
			params.push(filters.endDate);
		}

		if (filters?.status) {
			if (Array.isArray(filters.status)) {
				conditions.push(`status = ANY($${paramIdx++})`);
				params.push(filters.status);
			} else {
				conditions.push(`status = $${paramIdx++}`);
				params.push(filters.status);
			}
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				SELECT ${SESSION_COLUMNS}
				FROM tutoring_sessions
				${whereClause}
				ORDER BY scheduled_date DESC, scheduled_time DESC
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async findByTrainerId(trainerId: string, filters?: {
		status?: SessionStatus;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<SessionRecord[]> {
		// ARCHITECTURE FIX: Use allocation join as PRIMARY method
		// trainer_allocations is the source of truth for trainer-student relationships
		// This ensures ALL sessions are returned, even if trainer_id field is NULL or incorrect
		
		const limit = filters?.limit || 200; // Default limit for bootstrap
		const offset = filters?.offset || 0;
		
		// Build allocation-based query (PRIMARY METHOD)
		const allocationConditions: string[] = [`ta.trainer_id = $1`];
		const allocationParams: any[] = [trainerId];
		let allocationParamIdx = 2;
		
		if (filters?.status) {
			allocationConditions.push(`ts.status = $${allocationParamIdx++}`);
			allocationParams.push(filters.status);
		}
		
		const allocationWhereClause = `WHERE ${allocationConditions.join(' AND ')}`;
		allocationParams.push(limit, offset);
		
		// PRIMARY QUERY: Use allocation join (source of truth)
		const allocationResult = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				SELECT 
					ts.id,
					ts.allocation_id AS "allocationId",
					ts.student_id AS "studentId",
					COALESCE(ts.trainer_id, ta.trainer_id) AS "trainerId",
					ts.course_id AS "courseId",
					TO_CHAR(ts.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
					ts.scheduled_time AS "scheduledTime",
					ts.duration,
					ts.status,
					ts.student_home_location AS "studentHomeLocation",
					ts.trainer_start_location AS "trainerStartLocation",
					ts.trainer_end_location AS "trainerEndLocation",
					ts.gps_verification_passed AS "gpsVerificationPassed",
					ts.gps_verification_distance AS "gpsVerificationDistance",
					ts.trainer_face_verification_image AS "trainerFaceVerificationImage",
					ts.face_verification_passed AS "faceVerificationPassed",
					ts.face_verification_confidence AS "faceVerificationConfidence",
					ts.face_verification_method AS "faceVerificationMethod",
					ts.verification_passed AS "verificationPassed",
					ts.verification_failed_reason AS "verificationFailedReason",
					ts.started_at AS "startedAt",
					ts.ended_at AS "endedAt",
					ts.actual_duration AS "actualDuration",
					ts.student_confirmed AS "studentConfirmed",
					ts.student_confirmed_at AS "studentConfirmedAt",
					ts.student_confirmation_notes AS "studentConfirmationNotes",
					ts.disputed_reason AS "disputedReason",
					ts.disputed_at AS "disputedAt",
					ts.resolved_at AS "resolvedAt",
					ts.resolved_by AS "resolvedBy",
					ts.resolution_notes AS "resolutionNotes",
					ts.student_otp AS "studentOtp",
					ts.student_otp_generated_at AS "studentOtpGeneratedAt",
					ts.student_otp_verified AS "studentOtpVerified",
					ts.student_otp_verified_at AS "studentOtpVerifiedAt",
					ts.otp,
					ts.notes,
					ts.metadata,
					ts.created_at AS "createdAt",
					ts.updated_at AS "updatedAt"
				FROM tutoring_sessions ts
				INNER JOIN trainer_allocations ta ON ts.allocation_id = ta.id
				${allocationWhereClause}
				ORDER BY ts.scheduled_date DESC, ts.scheduled_time DESC
				LIMIT $${allocationParamIdx++}
				OFFSET $${allocationParamIdx}
			`,
			allocationParams
		);
		
		const sessions = allocationResult.rows.map(mapRow);
		
		// CONSISTENCY CHECK: Verify completeness
		// Count total sessions via allocation (source of truth)
		const totalAllocationCount = await executeQuery<{ count: string }>(
			this.pool,
			client,
			`
				SELECT COUNT(*) as count 
				FROM tutoring_sessions ts
				INNER JOIN trainer_allocations ta ON ts.allocation_id = ta.id
				WHERE ta.trainer_id = $1
				${filters?.status ? `AND ts.status = $2` : ''}
			`,
			filters?.status ? [trainerId, filters.status] : [trainerId]
		);
		const totalCount = parseInt(totalAllocationCount.rows[0]?.count || '0', 10);
		
		// Count sessions returned (respecting limit/offset)
		const returnedCount = sessions.length;
		const expectedCount = Math.min(limit, Math.max(0, totalCount - offset));
		
		// Log consistency check
		console.log(`[SessionRepository] findByTrainerId consistency check:`, {
			trainerId,
			totalSessionsViaAllocation: totalCount,
			returnedCount,
			expectedCount,
			limit,
			offset,
			statusFilter: filters?.status || 'all',
			consistent: returnedCount === expectedCount,
		});
		
		// ERROR: Log if mismatch detected (but don't fail - return what we have)
		if (returnedCount !== expectedCount && offset === 0) {
			// Only log error on first page (offset=0) to avoid false positives from pagination
			console.error(`[SessionRepository] ⚠️ CONSISTENCY MISMATCH: Expected ${expectedCount} sessions, got ${returnedCount} for trainer ${trainerId}`);
			console.error(`[SessionRepository] This indicates a query or pagination issue. Total sessions: ${totalCount}, Limit: ${limit}, Offset: ${offset}`);
		}
		
		return sessions;
	}

	async updateStatus(
		id: string,
		status: SessionStatus,
		client?: PoolClient
	): Promise<SessionRecord | null> {
		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				UPDATE tutoring_sessions
				SET status = $2, updated_at = NOW()
				WHERE id = $1
				RETURNING ${SESSION_COLUMNS}
			`,
			[id, status]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async updateVerification(
		id: string,
		updates: {
			trainerStartLocation?: { latitude: number; longitude: number; timestamp: Date };
			gpsVerificationPassed?: boolean;
			gpsVerificationDistance?: number;
			trainerFaceVerificationImage?: string;
			faceVerificationPassed?: boolean;
			faceVerificationConfidence?: number;
			faceVerificationMethod?: 'selfie' | 'video';
			verificationPassed?: boolean;
			verificationFailedReason?: string | null;
			startedAt?: Date;
		},
		client?: PoolClient
	): Promise<SessionRecord | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (updates.trainerStartLocation) {
			setClauses.push(`trainer_start_location = $${paramIdx++}`);
			params.push(JSON.stringify(updates.trainerStartLocation));
		}

		if (updates.gpsVerificationPassed !== undefined) {
			setClauses.push(`gps_verification_passed = $${paramIdx++}`);
			params.push(updates.gpsVerificationPassed);
		}

		if (updates.gpsVerificationDistance !== undefined) {
			setClauses.push(`gps_verification_distance = $${paramIdx++}`);
			params.push(updates.gpsVerificationDistance);
		}

		if (updates.trainerFaceVerificationImage !== undefined) {
			setClauses.push(`trainer_face_verification_image = $${paramIdx++}`);
			params.push(updates.trainerFaceVerificationImage);
		}

		if (updates.faceVerificationPassed !== undefined) {
			setClauses.push(`face_verification_passed = $${paramIdx++}`);
			params.push(updates.faceVerificationPassed);
		}

		if (updates.faceVerificationConfidence !== undefined) {
			setClauses.push(`face_verification_confidence = $${paramIdx++}`);
			params.push(updates.faceVerificationConfidence);
		}

		if (updates.faceVerificationMethod !== undefined) {
			setClauses.push(`face_verification_method = $${paramIdx++}`);
			params.push(updates.faceVerificationMethod);
		}

		if (updates.verificationPassed !== undefined) {
			setClauses.push(`verification_passed = $${paramIdx++}`);
			params.push(updates.verificationPassed);
		}

		if (updates.verificationFailedReason !== undefined) {
			setClauses.push(`verification_failed_reason = $${paramIdx++}`);
			params.push(updates.verificationFailedReason);
		}

		if (updates.startedAt !== undefined) {
			setClauses.push(`started_at = $${paramIdx++}`);
			params.push(updates.startedAt);
		}

		if (setClauses.length === 0) {
			return this.findById(id, client);
		}

		setClauses.push('updated_at = NOW()');
		params.push(id);

		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				UPDATE tutoring_sessions
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${SESSION_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async updateEndSession(
		id: string,
		updates: {
			trainerEndLocation: { latitude: number; longitude: number; timestamp: Date };
			endedAt: Date;
			actualDuration: number;
			notes?: string | null;
		},
		client?: PoolClient
	): Promise<SessionRecord | null> {
		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				UPDATE tutoring_sessions
				SET 
					trainer_end_location = $2,
					ended_at = $3,
					actual_duration = $4,
					notes = COALESCE($5, notes),
					status = 'pending_confirmation',
					updated_at = NOW()
				WHERE id = $1
				RETURNING ${SESSION_COLUMNS}
			`,
			[
				id,
				JSON.stringify(updates.trainerEndLocation),
				updates.endedAt,
				updates.actualDuration,
				updates.notes || null,
			]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async updateConfirmation(
		id: string,
		updates: {
			studentConfirmed: boolean;
			studentConfirmedAt: Date;
			studentConfirmationNotes?: string | null;
		},
		client?: PoolClient
	): Promise<SessionRecord | null> {
		const status = updates.studentConfirmed ? 'completed' : 'disputed';
		// Trainer payout: ₹200 per session when confirmed
		const TRAINER_PAYOUT_PER_SESSION = 200;

		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				UPDATE tutoring_sessions
				SET 
					student_confirmed = $2,
					student_confirmed_at = $3,
					student_confirmation_notes = COALESCE($4, student_confirmation_notes),
					status = $5,
					${updates.studentConfirmed ? `price = $6,` : ''}
					${!updates.studentConfirmed ? `disputed_at = NOW(), disputed_reason = COALESCE($4, 'Student did not confirm session completion'),` : ''}
					updated_at = NOW()
				WHERE id = $1
				RETURNING ${SESSION_COLUMNS}
			`,
			updates.studentConfirmed
				? [
					id,
					updates.studentConfirmed,
					updates.studentConfirmedAt,
					updates.studentConfirmationNotes || null,
					status,
					TRAINER_PAYOUT_PER_SESSION,
				]
				: [
					id,
					updates.studentConfirmed,
					updates.studentConfirmedAt,
					updates.studentConfirmationNotes || null,
					status,
				]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async updateStudentOtp(
		id: string,
		updates: {
			studentOtp?: string | null;
			studentOtpGeneratedAt?: Date | null;
			studentOtpVerified?: boolean | null;
			studentOtpVerifiedAt?: Date | null;
		},
		client?: PoolClient
	): Promise<SessionRecord | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (updates.studentOtp !== undefined) {
			setClauses.push(`student_otp = $${paramIdx++}`);
			params.push(updates.studentOtp);
		}

		if (updates.studentOtpGeneratedAt !== undefined) {
			setClauses.push(`student_otp_generated_at = $${paramIdx++}`);
			params.push(updates.studentOtpGeneratedAt);
		}

		if (updates.studentOtpVerified !== undefined) {
			setClauses.push(`student_otp_verified = $${paramIdx++}`);
			params.push(updates.studentOtpVerified);
		}

		if (updates.studentOtpVerifiedAt !== undefined) {
			setClauses.push(`student_otp_verified_at = $${paramIdx++}`);
			params.push(updates.studentOtpVerifiedAt);
		}

		if (setClauses.length === 0) {
			return this.findById(id, client);
		}

		setClauses.push('updated_at = NOW()');
		params.push(id);

		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				UPDATE tutoring_sessions
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${SESSION_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async updateDisputeResolution(
		id: string,
		updates: {
			resolvedAt: Date;
			resolvedBy: string;
			resolutionNotes: string;
		},
		client?: PoolClient
	): Promise<SessionRecord | null> {
		const result = await executeQuery<SessionRecord>(
			this.pool,
			client,
			`
				UPDATE tutoring_sessions
				SET 
					resolved_at = $2,
					resolved_by = $3,
					resolution_notes = $4,
					status = 'completed',
					updated_at = NOW()
				WHERE id = $1
				RETURNING ${SESSION_COLUMNS}
			`,
			[id, updates.resolvedAt, updates.resolvedBy, updates.resolutionNotes]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

