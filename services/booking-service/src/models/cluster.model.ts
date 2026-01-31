/**
 * Cluster Model - PostgreSQL Schema
 * Internal operational clusters within a city (2-3 km radius each)
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export interface Cluster {
	id: string;
	cityId: string;
	name: string;
	centerLatitude: number;
	centerLongitude: number;
	radiusKm: number; // Typically 2-3 km
	boundary: {
		north: number;
		south: number;
		east: number;
		west: number;
	} | null;
	isActive: boolean;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ClusterCreateInput {
	cityId: string;
	name: string;
	centerLatitude: number;
	centerLongitude: number;
	radiusKm?: number;
	metadata?: Record<string, unknown> | null;
}

export interface ClusterUpdateInput {
	name?: string;
	centerLatitude?: number;
	centerLongitude?: number;
	radiusKm?: number;
	isActive?: boolean;
	boundary?: {
		north: number;
		south: number;
		east: number;
		west: number;
	} | null;
	metadata?: Record<string, unknown> | null;
}

const CLUSTER_COLUMNS = `
	id,
	city_id AS "cityId",
	name,
	center_latitude AS "centerLatitude",
	center_longitude AS "centerLongitude",
	radius_km AS "radiusKm",
	boundary,
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

function mapRow(row: any): Cluster {
	return {
		id: row.id,
		cityId: row.cityId,
		name: row.name,
		centerLatitude: row.centerLatitude,
		centerLongitude: row.centerLongitude,
		radiusKm: row.radiusKm,
		boundary: row.boundary ? (typeof row.boundary === 'string' ? JSON.parse(row.boundary) : row.boundary) : null,
		isActive: row.isActive,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureClusterTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS clusters (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			city_id UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
			name VARCHAR(100) NOT NULL,
			center_latitude NUMERIC(10, 8) NOT NULL,
			center_longitude NUMERIC(11, 8) NOT NULL,
			radius_km NUMERIC(5, 2) NOT NULL DEFAULT 2.5,
			boundary JSONB,
			is_active BOOLEAN NOT NULL DEFAULT true,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(city_id, name)
		);
	`);

	// Create indexes for location queries
	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_clusters_city ON clusters(city_id);
		CREATE INDEX IF NOT EXISTS idx_clusters_location ON clusters(center_latitude, center_longitude);
		CREATE INDEX IF NOT EXISTS idx_clusters_active ON clusters(is_active) WHERE is_active = true;
	`);
}

export class ClusterRepository {
	constructor(private readonly pool: Pool) {}

	async create(input: ClusterCreateInput, client?: PoolClient): Promise<Cluster> {
		const result = await executeQuery<Cluster>(
			this.pool,
			client,
			`
				INSERT INTO clusters (city_id, name, center_latitude, center_longitude, radius_km, metadata)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING ${CLUSTER_COLUMNS}
			`,
			[
				input.cityId,
				input.name,
				input.centerLatitude,
				input.centerLongitude,
				input.radiusKm || 2.5,
				input.metadata ? JSON.stringify(input.metadata) : null,
			]
		);

		return mapRow(result.rows[0]);
	}

	async findById(id: string, client?: PoolClient): Promise<Cluster | null> {
		const result = await executeQuery<Cluster>(
			this.pool,
			client,
			`SELECT ${CLUSTER_COLUMNS} FROM clusters WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByCityId(cityId: string, client?: PoolClient): Promise<Cluster[]> {
		const result = await executeQuery<Cluster>(
			this.pool,
			client,
			`SELECT ${CLUSTER_COLUMNS} FROM clusters WHERE city_id = $1 AND is_active = true ORDER BY name ASC`,
			[cityId]
		);

		return result.rows.map(mapRow);
	}

	/**
	 * Find nearest cluster to a given location
	 * Uses simple distance calculation (for production, use PostGIS for better performance)
	 */
	async findNearestCluster(
		latitude: number,
		longitude: number,
		cityId?: string,
		client?: PoolClient
	): Promise<Cluster | null> {
		const cityFilter = cityId ? 'AND city_id = $3' : '';
		const params = cityId ? [latitude, longitude, cityId] : [latitude, longitude];

		// Calculate distance using Haversine formula in SQL
		const result = await executeQuery<Cluster & { distance: number }>(
			this.pool,
			client,
			`
				SELECT 
					${CLUSTER_COLUMNS},
					6371 * acos(
						cos(radians($1)) *
						cos(radians(center_latitude)) *
						cos(radians(center_longitude) - radians($2)) +
						sin(radians($1)) *
						sin(radians(center_latitude))
					) AS distance
				FROM clusters
				WHERE is_active = true ${cityFilter}
				ORDER BY distance ASC
				LIMIT 1
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		const row = result.rows[0];
		return mapRow(row);
	}

	async findAll(filters?: {
		cityId?: string;
		isActive?: boolean;
		limit?: number;
		offset?: number;
	}, client?: PoolClient): Promise<Cluster[]> {
		const conditions: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (filters?.cityId) {
			conditions.push(`city_id = $${paramIdx++}`);
			params.push(filters.cityId);
		}

		if (filters?.isActive !== undefined) {
			conditions.push(`is_active = $${paramIdx++}`);
			params.push(filters.isActive);
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filters?.limit || 100;
		const offset = filters?.offset || 0;

		params.push(limit, offset);

		const result = await executeQuery<Cluster>(
			this.pool,
			client,
			`
				SELECT ${CLUSTER_COLUMNS}
				FROM clusters
				${whereClause}
				ORDER BY name ASC
				LIMIT $${paramIdx++}
				OFFSET $${paramIdx}
			`,
			params
		);

		return result.rows.map(mapRow);
	}

	async update(id: string, input: ClusterUpdateInput, client?: PoolClient): Promise<Cluster | null> {
		const setClauses: string[] = [];
		const params: any[] = [];
		let paramIdx = 1;

		if (input.name !== undefined) {
			setClauses.push(`name = $${paramIdx++}`);
			params.push(input.name);
		}

		if (input.centerLatitude !== undefined) {
			setClauses.push(`center_latitude = $${paramIdx++}`);
			params.push(input.centerLatitude);
		}

		if (input.centerLongitude !== undefined) {
			setClauses.push(`center_longitude = $${paramIdx++}`);
			params.push(input.centerLongitude);
		}

		if (input.radiusKm !== undefined) {
			setClauses.push(`radius_km = $${paramIdx++}`);
			params.push(input.radiusKm);
		}

		if (input.boundary !== undefined) {
			setClauses.push(`boundary = $${paramIdx++}`);
			params.push(JSON.stringify(input.boundary));
		}

		if (input.isActive !== undefined) {
			setClauses.push(`is_active = $${paramIdx++}`);
			params.push(input.isActive);
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

		const result = await executeQuery<Cluster>(
			this.pool,
			client,
			`
				UPDATE clusters
				SET ${setClauses.join(', ')}
				WHERE id = $${paramIdx}
				RETURNING ${CLUSTER_COLUMNS}
			`,
			params
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}
}

