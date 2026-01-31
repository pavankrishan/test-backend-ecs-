/**
 * Franchise Model - PostgreSQL Schema
 * Franchises belong to zones, which belong to cities, which belong to states
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export interface Franchise {
	id: string;
	name: string;
	stateId: string | null;
	cityId: string | null;
	isActive: boolean;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

const FRANCHISE_COLUMNS = `
	id,
	name,
	state_id AS "stateId",
	city_id AS "cityId",
	is_active AS "isActive",
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

function mapRow(row: any): Franchise {
	return {
		id: row.id,
		name: row.name,
		stateId: row.stateId,
		cityId: row.cityId,
		isActive: row.isActive,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureFranchiseTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS franchises (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(200) NOT NULL,
			state_id UUID,
			city_id UUID,
			is_active BOOLEAN NOT NULL DEFAULT true,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_franchises_active ON franchises(is_active) WHERE is_active = true;
		CREATE INDEX IF NOT EXISTS idx_franchises_city ON franchises(city_id) WHERE city_id IS NOT NULL;
	`);
}

export class FranchiseRepository {
	constructor(private readonly pool: Pool) {}

	async findById(id: string, client?: PoolClient): Promise<Franchise | null> {
		const result = await executeQuery<Franchise>(
			this.pool,
			client,
			`SELECT ${FRANCHISE_COLUMNS} FROM franchises WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

