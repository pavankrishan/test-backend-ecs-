/**
 * Schedule Slot Model - PostgreSQL Schema
 * Tracks trainer schedule slots to prevent double-booking
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type SlotStatus = 'available' | 'booked' | 'blocked';

export interface ScheduleSlot {
	id: string;
	trainerId: string;
	bookingId: string | null;
	date: Date;
	timeslot: string; // Format: "HH:MM"
	status: SlotStatus;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ScheduleSlotCreateInput {
	trainerId: string;
	bookingId?: string | null;
	date: Date;
	timeslot: string;
	status?: SlotStatus;
	metadata?: Record<string, unknown> | null;
}

export interface ScheduleSlotUpdateInput {
	bookingId?: string | null;
	status?: SlotStatus;
	metadata?: Record<string, unknown> | null;
}

const SLOT_COLUMNS = `
	id,
	trainer_id AS "trainerId",
	booking_id AS "bookingId",
	date,
	timeslot,
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

function mapRow(row: any): ScheduleSlot {
	return {
		id: row.id,
		trainerId: row.trainerId,
		bookingId: row.bookingId,
		date: row.date,
		timeslot: row.timeslot,
		status: row.status,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureScheduleSlotTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS schedule_slots (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			trainer_id UUID NOT NULL,
			booking_id UUID,
			date DATE NOT NULL,
			timeslot VARCHAR(10) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'available'
				CHECK (status IN ('available', 'booked', 'blocked')),
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(trainer_id, date, timeslot)
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_slots_trainer ON schedule_slots(trainer_id);
		CREATE INDEX IF NOT EXISTS idx_slots_booking ON schedule_slots(booking_id) WHERE booking_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_slots_date ON schedule_slots(date);
		CREATE INDEX IF NOT EXISTS idx_slots_status ON schedule_slots(status);
		CREATE INDEX IF NOT EXISTS idx_slots_trainer_date ON schedule_slots(trainer_id, date, timeslot);
	`);
}

export class ScheduleSlotRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: ScheduleSlotCreateInput, client?: PoolClient): Promise<ScheduleSlot> {
		const result = await executeQuery<ScheduleSlot>(
			this.pool,
			client,
			`
				INSERT INTO schedule_slots (trainer_id, booking_id, date, timeslot, status, metadata)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (trainer_id, date, timeslot) DO UPDATE SET
					booking_id = EXCLUDED.booking_id,
					status = EXCLUDED.status,
					metadata = EXCLUDED.metadata,
					updated_at = NOW()
				RETURNING ${SLOT_COLUMNS}
			`,
			[
				input.trainerId,
				input.bookingId || null,
				input.date,
				input.timeslot,
				input.status || 'available',
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<ScheduleSlot | null> {
		const result = await executeQuery<ScheduleSlot>(
			this.pool,
			client,
			`SELECT ${SLOT_COLUMNS} FROM schedule_slots WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByTrainerId(
		trainerId: string,
		filters?: {
			startDate?: Date;
			endDate?: Date;
			status?: SlotStatus;
			limit?: number;
			offset?: number;
		},
		client?: PoolClient
	): Promise<ScheduleSlot[]> {
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

		const result = await executeQuery<ScheduleSlot>(
			this.pool,
			client,
			`
				SELECT ${SLOT_COLUMNS}
				FROM schedule_slots
				${whereClause}
				ORDER BY date ASC, timeslot ASC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	/**
	 * Check if trainer has conflicts for a given timeslot and date range
	 */
	async checkConflicts(
		trainerId: string,
		timeslot: string,
		startDate: Date,
		sessionCount: number,
		client?: PoolClient
	): Promise<boolean> {
		// Calculate end date
		const endDate = new Date(startDate);
		endDate.setDate(endDate.getDate() + sessionCount - 1);

		const result = await executeQuery<{ count: number }>(
			this.pool,
			client,
			`
				SELECT COUNT(*)::int AS count
				FROM schedule_slots
				WHERE trainer_id = $1
					AND timeslot = $2
					AND date >= $3
					AND date <= $4
					AND status IN ('booked', 'blocked')
			`,
			[trainerId, timeslot, startDate, endDate]
		);

		return (result.rows[0]?.count ?? 0) > 0;
	}

	/**
	 * Lock slots for a booking
	 */
	async lockSlots(
		trainerId: string,
		bookingId: string,
		timeslot: string,
		startDate: Date,
		sessionCount: number,
		client?: PoolClient
	): Promise<ScheduleSlot[]> {
		const slots: ScheduleSlot[] = [];
		const endDate = new Date(startDate);
		endDate.setDate(endDate.getDate() + sessionCount - 1);

		const currentDate = new Date(startDate);
		while (currentDate <= endDate) {
			const slot = await this.create(
				{
					trainerId,
					bookingId,
					date: new Date(currentDate),
					timeslot,
					status: 'booked',
				},
				client
			);
			slots.push(slot);
			currentDate.setDate(currentDate.getDate() + 1);
		}

		return slots;
	}

	async update(id: string, input: ScheduleSlotUpdateInput, client?: PoolClient): Promise<ScheduleSlot | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.bookingId !== undefined) {
			setClauses.push(`booking_id = $${paramIdx++}`);
			params.push(input.bookingId);
		}

		if (input.status !== undefined) {
			setClauses.push(`status = $${paramIdx++}`);
			params.push(input.status);
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

		const result = await executeQuery<ScheduleSlot>(
			this.pool,
			client,
			`
				UPDATE schedule_slots
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${SLOT_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

