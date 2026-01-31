/**
 * City Model - PostgreSQL Schema
 * Manages city activation and service availability
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export interface City {
	id: string;
	name: string;
	state: string;
	country: string;
	isActive: boolean;
	activatedAt: Date | null;
	activatedBy: string | null; // Admin ID (HQ)
	franchiseId: string | null; // Franchise that owns this city
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CityCreateInput {
	name: string;
	state: string;
	country?: string;
	franchiseId?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface CityUpdateInput {
	name?: string;
	state?: string;
	country?: string;
	isActive?: boolean;
	activatedBy?: string | null;
	activatedAt?: Date | null;
	franchiseId?: string | null;
	metadata?: Record<string, unknown> | null;
}

const CITY_COLUMNS = `
	id,
	name,
	state,
	country,
	is_active AS "isActive",
	activated_at AS "activatedAt",
	activated_by AS "activatedBy",
	franchise_id AS "franchiseId",
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

function mapRow(row: any): City {
	return {
		id: row.id,
		name: row.name,
		state: row.state,
		country: row.country || 'India',
		isActive: row.isActive,
		activatedAt: row.activatedAt,
		activatedBy: row.activatedBy,
		franchiseId: row.franchiseId,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureCityTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS cities (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(100) NOT NULL,
			state VARCHAR(100) NOT NULL,
			country VARCHAR(100) DEFAULT 'India',
			is_active BOOLEAN NOT NULL DEFAULT false,
			activated_at TIMESTAMPTZ,
			activated_by UUID, -- Admin ID (HQ)
			franchise_id UUID, -- Franchise that owns this city
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(name, state, country)
		);
	`);

	// Add franchise_id column if it doesn't exist (migration for existing tables)
	await queryFn(`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name = 'cities' AND column_name = 'franchise_id'
			) THEN
				ALTER TABLE cities ADD COLUMN franchise_id UUID;
			END IF;
		END $$;
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);
		CREATE INDEX IF NOT EXISTS idx_cities_state ON cities(state);
		CREATE INDEX IF NOT EXISTS idx_cities_is_active ON cities(is_active);
		CREATE INDEX IF NOT EXISTS idx_cities_franchise ON cities(franchise_id) WHERE franchise_id IS NOT NULL;
	`);
}

export class CityRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: CityCreateInput, client?: PoolClient): Promise<City> {
		const result = await executeQuery<City>(
			this.pool,
			client,
			`
				INSERT INTO cities (name, state, country, franchise_id, metadata)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING ${CITY_COLUMNS}
			`,
			[
				input.name,
				input.state,
				input.country || 'India',
				input.franchiseId || null,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<City | null> {
		const result = await executeQuery<City>(
			this.pool,
			client,
			`SELECT ${CITY_COLUMNS} FROM cities WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByName(name: string, state: string, client?: PoolClient): Promise<City | null> {
		const result = await executeQuery<City>(
			this.pool,
			client,
			`SELECT ${CITY_COLUMNS} FROM cities WHERE LOWER(name) = LOWER($1) AND LOWER(state) = LOWER($2)`,
			[name, state]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findAll(filters?: {
		isActive?: boolean;
		state?: string;
		franchiseId?: string | null;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<City[]> {
		const conditions: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (filters?.isActive !== undefined) {
			conditions.push(`is_active = $${paramIdx++}`);
			params.push(filters.isActive);
		}

		if (filters?.state) {
			conditions.push(`LOWER(state) = LOWER($${paramIdx++})`);
			params.push(filters.state);
		}

		if (filters?.franchiseId !== undefined) {
			if (filters.franchiseId === null) {
				conditions.push(`franchise_id IS NULL`);
			} else {
				conditions.push(`franchise_id = $${paramIdx++}`);
				params.push(filters.franchiseId);
			}
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 100;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<City>(
			this.pool,
			client,
			`
				SELECT ${CITY_COLUMNS}
				FROM cities
				${whereClause}
				ORDER BY name ASC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async update(id: string, input: CityUpdateInput, client?: PoolClient): Promise<City | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.name !== undefined) {
			setClauses.push(`name = $${paramIdx++}`);
			params.push(input.name);
		}

		if (input.state !== undefined) {
			setClauses.push(`state = $${paramIdx++}`);
			params.push(input.state);
		}

		if (input.country !== undefined) {
			setClauses.push(`country = $${paramIdx++}`);
			params.push(input.country);
		}

		if (input.isActive !== undefined) {
			setClauses.push(`is_active = $${paramIdx++}`);
			params.push(input.isActive);

			if (input.isActive) {
				setClauses.push(`activated_at = NOW()`);
				if (input.activatedBy) {
					setClauses.push(`activated_by = $${paramIdx++}`);
					params.push(input.activatedBy);
				}
			} else {
				setClauses.push(`activated_at = NULL`);
				setClauses.push(`activated_by = NULL`);
			}
		}

		if (input.franchiseId !== undefined) {
			setClauses.push(`franchise_id = $${paramIdx++}`);
			params.push(input.franchiseId);
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

		const result = await executeQuery<City>(
			this.pool,
			client,
			`
				UPDATE cities
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${CITY_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async activate(id: string, activatedBy: string, client?: PoolClient): Promise<City | null> {
		return this.update(id, { isActive: true, activatedBy }, client);
	}

	async deactivate(id: string, client?: PoolClient): Promise<City | null> {
		return this.update(id, { isActive: false }, client);
	}
}

