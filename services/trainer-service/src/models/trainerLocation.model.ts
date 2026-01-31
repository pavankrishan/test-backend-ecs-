import type { Pool, PoolClient, QueryResult } from 'pg';

export interface TrainerLocation {
  id: string;
  trainerId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  serviceRadiusKm: number | null;
  available: boolean;
  updatedAt: Date;
  createdAt: Date;
}

export interface TrainerLocationInput {
  trainerId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  serviceRadiusKm?: number | null;
  available?: boolean;
}

const LOCATION_COLUMNS = `
  id,
  trainer_id AS "trainerId",
  latitude,
  longitude,
  accuracy,
  city,
  state,
  country,
  service_radius_km AS "serviceRadiusKm",
  available,
  updated_at AS "updatedAt",
  created_at AS "createdAt"
`;

function execute<T extends Record<string, any> = Record<string, any>>(
  pool: Pool,
  client: PoolClient | undefined,
  text: string,
  params: any[] = [],
): Promise<QueryResult<T>> {
  if (client) {
    return client.query<T>(text, params);
  }
  return pool.query<T>(text, params);
}

function mapRow(row: any): TrainerLocation {
  return {
    id: row.id,
    trainerId: row.trainerId,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
    city: row.city ?? null,
    state: row.state ?? null,
    country: row.country ?? null,
    serviceRadiusKm:
      row.serviceRadiusKm === null || row.serviceRadiusKm === undefined ? null : Number(row.serviceRadiusKm),
    available: Boolean(row.available),
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

export async function ensureTrainerLocationTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL,
      latitude NUMERIC(9,6) NOT NULL,
      longitude NUMERIC(9,6) NOT NULL,
      accuracy NUMERIC(6,2),
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100),
      service_radius_km NUMERIC(5,2),
      available BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trainer_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_locations_trainer ON trainer_locations(trainer_id);
  `);
}

export class TrainerLocationRepository {
  constructor(private readonly pool: Pool) {}

  async upsertLocation(input: TrainerLocationInput, client?: PoolClient): Promise<TrainerLocation> {
    const result = await execute(
      this.pool,
      client,
      `
        INSERT INTO trainer_locations (
          trainer_id,
          latitude,
          longitude,
          accuracy,
          city,
          state,
          country,
          service_radius_km,
          available
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (trainer_id) DO UPDATE SET
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          accuracy = EXCLUDED.accuracy,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          country = EXCLUDED.country,
          service_radius_km = EXCLUDED.service_radius_km,
          available = COALESCE(EXCLUDED.available, trainer_locations.available),
          updated_at = NOW()
        RETURNING ${LOCATION_COLUMNS}
      `,
      [
        input.trainerId,
        input.latitude,
        input.longitude,
        input.accuracy ?? null,
        input.city ?? null,
        input.state ?? null,
        input.country ?? null,
        input.serviceRadiusKm ?? null,
        input.available ?? true,
      ],
    );

    return mapRow(result.rows[0]);
  }

  async getByTrainer(trainerId: string, client?: PoolClient): Promise<TrainerLocation | null> {
    const result = await execute(
      this.pool,
      client,
      `SELECT ${LOCATION_COLUMNS} FROM trainer_locations WHERE trainer_id = $1`,
      [trainerId],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async listAvailable(options: {
    city?: string;
    state?: string;
    country?: string;
    limit?: number;
    offset?: number;
  }): Promise<TrainerLocation[]> {
    const conditions = ['available = true'];
    const params: any[] = [];
    let idx = 1;

    if (options.city) {
      conditions.push(`LOWER(city) = LOWER($${idx++})`);
      params.push(options.city);
    }
    if (options.state) {
      conditions.push(`LOWER(state) = LOWER($${idx++})`);
      params.push(options.state);
    }
    if (options.country) {
      conditions.push(`LOWER(country) = LOWER($${idx++})`);
      params.push(options.country);
    }

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    params.push(limit, offset);

    const result = await this.pool.query(
      `
        SELECT ${LOCATION_COLUMNS}
        FROM trainer_locations
        WHERE ${conditions.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT $${idx++}
        OFFSET $${idx}
      `,
      params,
    );

    return result.rows.map(mapRow);
  }
}

