/**
 * Journey Model - One journey per session per trip, bound to exactly one trainer.
 * Lifecycle: CREATED -> ACTIVE -> COMPLETED | CANCELLED
 * Tracking is bound to journeyId only. Substitute trainer creates a new journey.
 */

import type { Pool, PoolClient } from 'pg';
import { getPool } from '../config/database';

export type JourneyStatus = 'created' | 'active' | 'completed' | 'cancelled';
export type JourneyEndReason = 'arrived' | 'cancelled' | 'timeout' | 'trainer_replaced';

export interface JourneyRecord {
	id: string;
	sessionId: string;
	trainerId: string;
	studentId: string;
	status: JourneyStatus;
	startedAt: Date | null;
	endedAt: Date | null;
	endReason: JourneyEndReason | null;
	createdAt: Date;
	updatedAt: Date;
}

const JOURNEY_COLUMNS = `
	id, session_id AS "sessionId", trainer_id AS "trainerId", student_id AS "studentId",
	status, started_at AS "startedAt", ended_at AS "endedAt", end_reason AS "endReason",
	created_at AS "createdAt", updated_at AS "updatedAt"
`;

function mapRow(row: any): JourneyRecord {
	return {
		id: row.id,
		sessionId: row.sessionId,
		trainerId: row.trainerId,
		studentId: row.studentId,
		status: row.status,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		endReason: row.endReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function executeQuery<T>(
	pool: Pool,
	client: PoolClient | undefined,
	text: string,
	params?: any[]
): Promise<{ rows: T[] }> {
	const result = client
		? await client.query(text, params)
		: await pool.query(text, params);
	return { rows: result.rows as T[] };
}

export class JourneyRepository {
	constructor(private pool: Pool) {}

	async create(input: {
		sessionId: string;
		trainerId: string;
		studentId: string;
		client?: PoolClient;
	}): Promise<JourneyRecord> {
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			input.client,
			`
			INSERT INTO journeys (session_id, trainer_id, student_id, status)
			VALUES ($1, $2, $3, 'created')
			RETURNING ${JOURNEY_COLUMNS}
			`,
			[input.sessionId, input.trainerId, input.studentId]
		);
		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<JourneyRecord | null> {
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			client,
			`SELECT ${JOURNEY_COLUMNS} FROM journeys WHERE id = $1`,
			[id]
		);
		if (!result.rows.length) return null;
		return mapRow(result.rows[0]);
	}

	async setActive(id: string, client?: PoolClient): Promise<JourneyRecord | null> {
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			client,
			`
			UPDATE journeys
			SET status = 'active', started_at = NOW(), updated_at = NOW()
			WHERE id = $1 AND status = 'created'
			RETURNING ${JOURNEY_COLUMNS}
			`,
			[id]
		);
		if (!result.rows.length) return null;
		return mapRow(result.rows[0]);
	}

	async setEnded(
		id: string,
		reason: JourneyEndReason,
		client?: PoolClient
	): Promise<JourneyRecord | null> {
		const status = reason === 'cancelled' ? 'cancelled' : 'completed';
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			client,
			`
			UPDATE journeys
			SET status = $2, ended_at = NOW(), end_reason = $3, updated_at = NOW()
			WHERE id = $1 AND status IN ('created', 'active')
			RETURNING ${JOURNEY_COLUMNS}
			`,
			[id, status, reason]
		);
		if (!result.rows.length) return null;
		return mapRow(result.rows[0]);
	}

	async setCancelled(id: string, client?: PoolClient): Promise<JourneyRecord | null> {
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			client,
			`
			UPDATE journeys
			SET status = 'cancelled', ended_at = NOW(), end_reason = 'cancelled', updated_at = NOW()
			WHERE id = $1 AND status IN ('created', 'active')
			RETURNING ${JOURNEY_COLUMNS}
			`,
			[id]
		);
		if (!result.rows.length) return null;
		return mapRow(result.rows[0]);
	}

	async getActiveBySessionId(sessionId: string, client?: PoolClient): Promise<JourneyRecord | null> {
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			client,
			`SELECT ${JOURNEY_COLUMNS} FROM journeys WHERE session_id = $1 AND status = 'active' LIMIT 1`,
			[sessionId]
		);
		if (!result.rows.length) return null;
		return mapRow(result.rows[0]);
	}

	/** Last journey for session (any status), by most recent ended_at or started_at. Used for derived journey status. */
	async getLastBySessionId(sessionId: string, client?: PoolClient): Promise<JourneyRecord | null> {
		const result = await executeQuery<JourneyRecord>(
			this.pool,
			client,
			`SELECT ${JOURNEY_COLUMNS} FROM journeys WHERE session_id = $1
			 ORDER BY COALESCE(ended_at, started_at, created_at) DESC NULLS LAST LIMIT 1`,
			[sessionId]
		);
		if (!result.rows.length) return null;
		return mapRow(result.rows[0]);
	}
}
