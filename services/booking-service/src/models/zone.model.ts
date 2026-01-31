/**
 * Zone Model - PostgreSQL Schema
 * Zones have center coordinates and radius
 * Zones can be operated by COMPANY (franchise_id is NULL) or FRANCHISE (franchise_id is set)
 * Every city is always active, but zones can be assigned to franchises
 */

import type { Pool, PoolClient, QueryResult } from 'pg';

export type ZoneOperator = 'COMPANY' | 'FRANCHISE';

export interface Zone {
	id: string;
	franchiseId: string | null; // NULL = COMPANY-operated, non-NULL = FRANCHISE-operated
	name: string;
	centerLat: number;
	centerLng: number;
	radiusKm: number;
	isActive: boolean;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ZoneCreateInput {
	franchiseId?: string | null; // NULL for COMPANY-operated zones
	name: string;
	centerLat: number;
	centerLng: number;
	radiusKm: number;
	metadata?: Record<string, unknown> | null;
}

/**
 * Get zone operator type
 */
export function getZoneOperator(zone: Zone): ZoneOperator {
	return zone.franchiseId === null ? 'COMPANY' : 'FRANCHISE';
}

const ZONE_COLUMNS = `
	id,
	franchise_id AS "franchiseId",
	name,
	center_lat AS "centerLat",
	center_lng AS "centerLng",
	radius_km AS "radiusKm",
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

function mapRow(row: any): Zone {
	return {
		id: row.id,
		franchiseId: row.franchiseId || null, // Handle null franchise_id (COMPANY-operated zones)
		name: row.name,
		centerLat: parseFloat(row.centerLat),
		centerLng: parseFloat(row.centerLng),
		radiusKm: parseFloat(row.radiusKm),
		isActive: row.isActive,
		metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function ensureZoneTable(poolOrClient: Pool | PoolClient): Promise<void> {
	const queryFn = (text: string, params?: any[]) => {
		return poolOrClient.query(text, params);
	};

	await queryFn(`
		CREATE TABLE IF NOT EXISTS zones (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			franchise_id UUID, -- NULL = COMPANY-operated, non-NULL = FRANCHISE-operated
			name VARCHAR(100) NOT NULL,
			center_lat NUMERIC(10, 8) NOT NULL,
			center_lng NUMERIC(11, 8) NOT NULL,
			radius_km NUMERIC(5, 2) NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT true,
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
				WHERE table_name = 'zones' AND column_name = 'franchise_id'
			) THEN
				ALTER TABLE zones ADD COLUMN franchise_id UUID;
			END IF;
		END $$;
	`);

	await queryFn(`
		CREATE INDEX IF NOT EXISTS idx_zones_franchise ON zones(franchise_id);
		CREATE INDEX IF NOT EXISTS idx_zones_location ON zones(center_lat, center_lng);
		CREATE INDEX IF NOT EXISTS idx_zones_active ON zones(is_active) WHERE is_active = true;
		
		-- Partial unique indexes for zone name uniqueness
		-- COMPANY-operated zones: name must be unique when franchise_id IS NULL
		-- Drop existing index if it exists before creating new one
		DROP INDEX IF EXISTS idx_zones_company_name;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_company_name 
			ON zones(name) WHERE franchise_id IS NULL;
		
		-- FRANCHISE-operated zones: (franchise_id, name) must be unique
		DROP INDEX IF EXISTS idx_zones_franchise_name;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_franchise_name 
			ON zones(franchise_id, name) WHERE franchise_id IS NOT NULL;
	`);
}

export class ZoneRepository {
	constructor(private readonly pool: Pool) {}

	async findById(id: string, client?: PoolClient): Promise<Zone | null> {
		const result = await executeQuery<Zone>(
			this.pool,
			client,
			`SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1`,
			[id]
		);

		if (!result.rows.length) {
			return null;
		}

		return mapRow(result.rows[0]);
	}

	async findByFranchiseId(franchiseId: string | null, client?: PoolClient): Promise<Zone[]> {
		// If franchiseId is null, find COMPANY-operated zones
		const query = franchiseId === null
			? `SELECT ${ZONE_COLUMNS} FROM zones WHERE franchise_id IS NULL AND is_active = true ORDER BY name ASC`
			: `SELECT ${ZONE_COLUMNS} FROM zones WHERE franchise_id = $1 AND is_active = true ORDER BY name ASC`;
		
		const params = franchiseId === null ? [] : [franchiseId];
		
		const result = await executeQuery<Zone>(
			this.pool,
			client,
			query,
			params
		);

		return result.rows.map(mapRow);
	}

	/**
	 * Find COMPANY-operated zones (franchise_id IS NULL)
	 */
	async findCompanyOperatedZones(client?: PoolClient): Promise<Zone[]> {
		return this.findByFranchiseId(null, client);
	}

	/**
	 * Find zones that contain a given location (within radius)
	 * Optimized to calculate distance once using CTE
	 */
	async findZonesContainingLocation(
		latitude: number,
		longitude: number,
		franchiseId?: string,
		client?: PoolClient
	): Promise<Zone[]> {
		const franchiseFilter = franchiseId ? 'AND franchise_id = $3' : '';
		const params = franchiseId ? [latitude, longitude, franchiseId] : [latitude, longitude];

		// Calculate distance using Haversine formula (optimized - calculate once using CTE)
		const result = await executeQuery<Zone & { distance: number }>(
			this.pool,
			client,
			`
				WITH zone_distances AS (
					SELECT 
						${ZONE_COLUMNS},
						6371 * acos(
							cos(radians($1)) *
							cos(radians(center_lat)) *
							cos(radians(center_lng) - radians($2)) +
							sin(radians($1)) *
							sin(radians(center_lat))
						) AS distance
					FROM zones
					WHERE is_active = true ${franchiseFilter}
				)
				SELECT * FROM zone_distances
				WHERE distance <= radius_km
				ORDER BY distance ASC
			`,
			params
		);

		return result.rows.map(mapRow);
	}
}

