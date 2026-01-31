/**
 * Pre-Booking Capacity Model
 * Atomic counter for pre-booking capacity (MAX 10 per course × timeslot)
 */

import type { Pool, PoolClient } from 'pg';

export interface PreBookingCapacity {
	id: string;
	courseId: string;
	timeslot: string;
	currentCount: number;
	maxCapacity: number;
	lastUpdatedAt: Date;
	createdAt: Date;
}

export async function ensurePreBookingCapacityTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS pre_booking_capacity (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
			timeslot TEXT NOT NULL,
			current_count INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
			max_capacity INTEGER NOT NULL DEFAULT 10 CHECK (max_capacity > 0),
			last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(course_id, timeslot)
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_pre_booking_capacity_course_timeslot ON pre_booking_capacity(course_id, timeslot);
		CREATE INDEX IF NOT EXISTS idx_pre_booking_capacity_count ON pre_booking_capacity(current_count, max_capacity);
	`);

	// Create atomic increment function if it doesn't exist
	await queryFn(`
		CREATE OR REPLACE FUNCTION increment_pre_booking_count(
			p_course_id UUID,
			p_timeslot TEXT
		) RETURNS INTEGER AS $$
		DECLARE
			v_current_count INTEGER;
			v_max_capacity INTEGER;
		BEGIN
			-- Lock row for update
			SELECT current_count, max_capacity INTO v_current_count, v_max_capacity
			FROM pre_booking_capacity
			WHERE course_id = p_course_id AND timeslot = p_timeslot
			FOR UPDATE;
			
			-- If row doesn't exist, create it
			IF NOT FOUND THEN
				INSERT INTO pre_booking_capacity (course_id, timeslot, current_count, max_capacity)
				VALUES (p_course_id, p_timeslot, 0, 10)
				RETURNING current_count, max_capacity INTO v_current_count, v_max_capacity;
			END IF;
			
			-- Check capacity
			IF v_current_count >= v_max_capacity THEN
				RAISE EXCEPTION 'Pre-booking capacity exceeded for course % and timeslot %', p_course_id, p_timeslot;
			END IF;
			
			-- Increment
			UPDATE pre_booking_capacity
			SET current_count = current_count + 1,
				last_updated_at = NOW()
			WHERE course_id = p_course_id AND timeslot = p_timeslot
			RETURNING current_count INTO v_current_count;
			
			RETURN v_current_count;
		END;
		$$ LANGUAGE plpgsql;
	`);

	// Create atomic decrement function
	await queryFn(`
		CREATE OR REPLACE FUNCTION decrement_pre_booking_count(
			p_course_id UUID,
			p_timeslot TEXT
		) RETURNS INTEGER AS $$
		DECLARE
			v_current_count INTEGER;
		BEGIN
			UPDATE pre_booking_capacity
			SET current_count = GREATEST(0, current_count - 1),
				last_updated_at = NOW()
			WHERE course_id = p_course_id AND timeslot = p_timeslot
			RETURNING current_count INTO v_current_count;
			
			IF NOT FOUND THEN
				RETURN 0;
			END IF;
			
			RETURN v_current_count;
		END;
		$$ LANGUAGE plpgsql;
	`);
}

export class PreBookingCapacityRepository {
	constructor(private readonly pool: Pool) {}

	async getCapacity(courseId: string, timeslot: string): Promise<PreBookingCapacity | null> {
		const result = await this.pool.query(
			`
				SELECT 
					id,
					course_id AS "courseId",
					timeslot,
					current_count AS "currentCount",
					max_capacity AS "maxCapacity",
					last_updated_at AS "lastUpdatedAt",
					created_at AS "createdAt"
				FROM pre_booking_capacity
				WHERE course_id = $1 AND timeslot = $2
			`,
			[courseId, timeslot]
		);

		if (!result.rows.length) {
			return null;
		}

		return this.mapRow(result.rows[0]);
	}

	async incrementCapacity(courseId: string, timeslot: string, client?: PoolClient): Promise<number> {
		const queryFn = client || this.pool;
		const result = await queryFn.query<{ increment_pre_booking_count: number }>(
			`SELECT increment_pre_booking_count($1, $2) AS increment_pre_booking_count`,
			[courseId, timeslot]
		);

		return result.rows[0]?.increment_pre_booking_count ?? 0;
	}

	async decrementCapacity(courseId: string, timeslot: string, client?: PoolClient): Promise<number> {
		const queryFn = client || this.pool;
		const result = await queryFn.query<{ decrement_pre_booking_count: number }>(
			`SELECT decrement_pre_booking_count($1, $2) AS decrement_pre_booking_count`,
			[courseId, timeslot]
		);

		return result.rows[0]?.decrement_pre_booking_count ?? 0;
	}

	async getRemainingCapacity(courseId: string, timeslot: string): Promise<number> {
		const capacity = await this.getCapacity(courseId, timeslot);
		if (!capacity) {
			return 10; // Default max capacity
		}
		return Math.max(0, capacity.maxCapacity - capacity.currentCount);
	}

	private mapRow(row: any): PreBookingCapacity {
		return {
			id: row.id,
			courseId: row.courseId,
			timeslot: row.timeslot,
			currentCount: row.currentCount,
			maxCapacity: row.maxCapacity,
			lastUpdatedAt: row.lastUpdatedAt,
			createdAt: row.createdAt,
		};
	}
}

