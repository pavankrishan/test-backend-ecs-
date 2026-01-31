/**
 * Purchase Session Model - PostgreSQL Schema
 * Individual sessions linked to a course purchase
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type SessionType = 'offline' | 'online';
export type SessionStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';

export interface PurchaseSession {
	id: string;
	purchaseId: string;
	bookingId: string;
	sessionNumber: number; // 1, 2, 3, ... up to totalSessions
	sessionDate: Date;
	sessionTime: string; // Format: "HH:MM"
	sessionType: SessionType; // 'offline' for regular, 'online' for HYBRID online sessions
	status: SessionStatus;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PurchaseSessionCreateInput {
	purchaseId: string;
	bookingId: string;
	sessionNumber: number;
	sessionDate: Date;
	sessionTime: string;
	sessionType: SessionType;
	status?: SessionStatus;
	metadata?: Record<string, unknown> | null;
}

const SESSION_COLUMNS = `
	id,
	purchase_id AS "purchaseId",
	booking_id AS "bookingId",
	session_number AS "sessionNumber",
	session_date AS "sessionDate",
	session_time AS "sessionTime",
	session_type AS "sessionType",
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

function mapRow(row: any): PurchaseSession {
	return {
		id: row.id,
		purchaseId: row.purchaseId,
		bookingId: row.bookingId,
		sessionNumber: row.sessionNumber,
		sessionDate: row.sessionDate,
		sessionTime: row.sessionTime,
		sessionType: row.sessionType,
		status: row.status,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensurePurchaseSessionTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS purchase_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			purchase_id UUID NOT NULL,
			booking_id UUID NOT NULL,
			session_number INT NOT NULL,
			session_date DATE NOT NULL,
			session_time VARCHAR(10) NOT NULL,
			session_type VARCHAR(10) NOT NULL CHECK (session_type IN ('offline', 'online')),
			status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
				CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_purchase_sessions_purchase ON purchase_sessions(purchase_id);
		CREATE INDEX IF NOT EXISTS idx_purchase_sessions_booking ON purchase_sessions(booking_id);
		CREATE INDEX IF NOT EXISTS idx_purchase_sessions_date ON purchase_sessions(session_date);
		CREATE INDEX IF NOT EXISTS idx_purchase_sessions_status ON purchase_sessions(status);
	`);
}

export class PurchaseSessionRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: PurchaseSessionCreateInput, client?: PoolClient): Promise<PurchaseSession> {
		const result = await executeQuery<PurchaseSession>(
			this.pool,
			client,
			`
				INSERT INTO purchase_sessions (
					purchase_id, booking_id, session_number, session_date,
					session_time, session_type, status, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				RETURNING ${SESSION_COLUMNS}
			`,
			[
				input.purchaseId,
				input.bookingId,
				input.sessionNumber,
				input.sessionDate,
				input.sessionTime,
				input.sessionType,
				input.status || 'scheduled',
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async createMany(inputs: PurchaseSessionCreateInput[], client?: PoolClient): Promise<PurchaseSession[]> {
		if (inputs.length === 0) {
			return [];
		}

		// Use batch insert for better performance
		const values = inputs.map((input, idx) => {
			const base = idx * 8;
			return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
		}).join(', ');

		const params = inputs.flatMap(input => [
			input.purchaseId,
			input.bookingId,
			input.sessionNumber,
			input.sessionDate,
			input.sessionTime,
			input.sessionType,
			input.status || 'scheduled',
			input.metadata ? JSON.stringify(input.metadata) : null,
		]);

		const result = await executeQuery<PurchaseSession>(
			this.pool,
			client,
			`
				INSERT INTO purchase_sessions (
					purchase_id, booking_id, session_number, session_date,
					session_time, session_type, status, metadata
				)
				VALUES ${values}
				RETURNING ${SESSION_COLUMNS}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async findByPurchaseId(purchaseId: string, client?: PoolClient): Promise<PurchaseSession[]> {
		const result = await executeQuery<PurchaseSession>(
			this.pool,
			client,
			`SELECT ${SESSION_COLUMNS} FROM purchase_sessions WHERE purchase_id = $1 ORDER BY session_number ASC`,
			[purchaseId]
		);

		return result.rows.map(mapRow);
	}

	async findByBookingId(bookingId: string, client?: PoolClient): Promise<PurchaseSession[]> {
		const result = await executeQuery<PurchaseSession>(
			this.pool,
			client,
			`SELECT ${SESSION_COLUMNS} FROM purchase_sessions WHERE booking_id = $1 ORDER BY session_number ASC`,
			[bookingId]
		);

		return result.rows.map(mapRow);
	}
}

