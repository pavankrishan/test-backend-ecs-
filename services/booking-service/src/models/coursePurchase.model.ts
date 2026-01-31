/**
 * Course Purchase Model - PostgreSQL Schema
 * Represents a course purchase with auto trainer assignment
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type ClassType = 'ONE_ON_ONE' | 'ONE_ON_TWO' | 'ONE_ON_THREE' | 'HYBRID';
export type DeliveryMode = 'WEEKDAY_DAILY' | 'SUNDAY_ONLY';
export type PurchaseStatus = 'ASSIGNED' | 'WAITLISTED' | 'SERVICE_NOT_AVAILABLE' | 'INVALID_PURCHASE';

export interface StudentDetail {
	id: string;
	name: string;
	email?: string;
	phone?: string;
}

export interface CoursePurchase {
	id: string;
	bookingId: string;
	courseId: string;
	classType: ClassType;
	totalSessions: 10 | 20 | 30;
	deliveryMode: DeliveryMode;
	startDate: Date;
	preferredTimeSlot: string; // Format: "HH:MM"
	studentLocation: {
		latitude: number;
		longitude: number;
		address?: string;
	};
	students: StudentDetail[];
	franchiseId: string | null;
	zoneId: string | null;
	trainerId: string | null;
	status: PurchaseStatus;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CoursePurchaseCreateInput {
	bookingId: string;
	courseId: string;
	classType: ClassType;
	totalSessions: 10 | 20 | 30;
	deliveryMode: DeliveryMode;
	startDate: Date;
	preferredTimeSlot: string;
	studentLocation: {
		latitude: number;
		longitude: number;
		address?: string;
	};
	students: StudentDetail[];
	franchiseId?: string | null;
	zoneId?: string | null;
	trainerId?: string | null;
	status?: PurchaseStatus;
	metadata?: Record<string, unknown> | null;
}

const PURCHASE_COLUMNS = `
	id,
	booking_id AS "bookingId",
	course_id AS "courseId",
	class_type AS "classType",
	total_sessions AS "totalSessions",
	delivery_mode AS "deliveryMode",
	start_date AS "startDate",
	preferred_time_slot AS "preferredTimeSlot",
	student_location AS "studentLocation",
	students,
	franchise_id AS "franchiseId",
	zone_id AS "zoneId",
	trainer_id AS "trainerId",
	status,
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

function mapRow(row: any): CoursePurchase {
	return {
		id: row.id,
		bookingId: row.bookingId,
		courseId: row.courseId,
		classType: row.classType,
		totalSessions: row.totalSessions,
		deliveryMode: row.deliveryMode,
		startDate: row.startDate,
		preferredTimeSlot: row.preferredTimeSlot,
		studentLocation: typeof row.studentLocation === 'string' ? JSON.parse(row.studentLocation) : row.studentLocation,
		students: typeof row.students === 'string' ? JSON.parse(row.students) : row.students,
		franchiseId: row.franchiseId,
		zoneId: row.zoneId,
		trainerId: row.trainerId,
		status: row.status,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureCoursePurchaseTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS course_purchases (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			booking_id UUID NOT NULL UNIQUE,
			course_id UUID NOT NULL,
			class_type VARCHAR(20) NOT NULL CHECK (class_type IN ('ONE_ON_ONE', 'ONE_ON_TWO', 'ONE_ON_THREE', 'HYBRID')),
			total_sessions INT NOT NULL CHECK (total_sessions IN (10, 20, 30)),
			delivery_mode VARCHAR(20) NOT NULL CHECK (delivery_mode IN ('WEEKDAY_DAILY', 'SUNDAY_ONLY')),
			start_date DATE NOT NULL,
			preferred_time_slot VARCHAR(10) NOT NULL,
			student_location JSONB NOT NULL,
			students JSONB NOT NULL,
			franchise_id UUID,
			zone_id UUID,
			trainer_id UUID,
			status VARCHAR(30) NOT NULL DEFAULT 'WAITLISTED'
				CHECK (status IN ('ASSIGNED', 'WAITLISTED', 'SERVICE_NOT_AVAILABLE', 'INVALID_PURCHASE')),
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	// Add franchise_id column if it doesn't exist (migration for existing tables)
	await queryFn(`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name = 'course_purchases' AND column_name = 'franchise_id'
			) THEN
				ALTER TABLE course_purchases ADD COLUMN franchise_id UUID;
			END IF;
		END $$;
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_purchases_booking ON course_purchases(booking_id);
		CREATE INDEX IF NOT EXISTS idx_purchases_trainer ON course_purchases(trainer_id) WHERE trainer_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_purchases_status ON course_purchases(status);
		CREATE INDEX IF NOT EXISTS idx_purchases_franchise ON course_purchases(franchise_id) WHERE franchise_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_purchases_zone ON course_purchases(zone_id) WHERE zone_id IS NOT NULL;
	`);
}

export class CoursePurchaseRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: CoursePurchaseCreateInput, client?: PoolClient): Promise<CoursePurchase> {
		const result = await executeQuery<CoursePurchase>(
			this.pool,
			client,
			`
				INSERT INTO course_purchases (
					booking_id, course_id, class_type, total_sessions, delivery_mode,
					start_date, preferred_time_slot, student_location, students,
					franchise_id, zone_id, trainer_id, status, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
				RETURNING ${PURCHASE_COLUMNS}
			`,
			[
				input.bookingId,
				input.courseId,
				input.classType,
				input.totalSessions,
				input.deliveryMode,
				input.startDate,
				input.preferredTimeSlot,
				JSON.stringify(input.studentLocation),
				JSON.stringify(input.students),
				input.franchiseId || null,
				input.zoneId || null,
				input.trainerId || null,
				input.status || 'WAITLISTED',
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<CoursePurchase | null> {
		const result = await executeQuery<CoursePurchase>(
			this.pool,
			client,
			`SELECT ${PURCHASE_COLUMNS} FROM course_purchases WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByBookingId(bookingId: string, client?: PoolClient): Promise<CoursePurchase | null> {
		const result = await executeQuery<CoursePurchase>(
			this.pool,
			client,
			`SELECT ${PURCHASE_COLUMNS} FROM course_purchases WHERE booking_id = $1`,
			[bookingId]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async update(id: string, updates: {
		trainerId?: string | null;
		status?: PurchaseStatus;
		franchiseId?: string | null;
		zoneId?: string | null;
		metadata?: Record<string, unknown> | null;
	}, client?: PoolClient): Promise<CoursePurchase | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (updates.trainerId !== undefined) {
			setClauses.push(`trainer_id = $${paramIdx++}`);
			params.push(updates.trainerId);
		}

		if (updates.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(updates.status);
		}

		if (updates.franchiseId !== undefined) {
			setClauses.push(`franchise_id = $${paramIdx++}`);
			params.push(updates.franchiseId);
		}

		if (updates.zoneId !== undefined) {
			setClauses.push(`zone_id = $${paramIdx++}`);
			params.push(updates.zoneId);
		}

		if (updates.metadata !== undefined) {
			setClauses.push(`metadata = $${paramIdx++}`);
			params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
		}

		if (setClauses.length === 0) {
			return this.findById(id, client);
		}

		setClauses.push('updated_at = NOW()');
		params.push(id);

		const result = await executeQuery<CoursePurchase>(
			this.pool,
			client,
			`
				UPDATE course_purchases
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${PURCHASE_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

