import type { Pool, PoolClient, QueryResult } from 'pg';

/**
 * Trainer Base Location Model
 * 
 * WHY: Stores trainer's confirmed operational base location
 * - Can be geocoded from address (source: 'geocoded')
 * - Can be GPS-confirmed by trainer (source: 'gps_confirmed')
 * - Used for service area matching and distance calculations
 * - Separate from trainer_addresses (KYC/identity) and live GPS tracking
 */
export interface TrainerBaseLocation {
  id: string;
  trainerId: string;
  latitude: number;
  longitude: number;
  source: 'geocoded' | 'manual' | 'verified' | 'gps_confirmed';
  confidenceScore: number | null;
  geocodedAt: Date | null;
  geocodedBy: string | null;
  addressId: string | null;
  confirmedAt: Date | null; // Only set when source = 'gps_confirmed'
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainerBaseLocationInput {
  trainerId: string;
  latitude: number;
  longitude: number;
  source: 'geocoded' | 'manual' | 'verified' | 'gps_confirmed';
  confidenceScore?: number | null;
  geocodedBy?: string | null;
  addressId?: string | null;
  accuracy?: number | null; // GPS accuracy in meters (for gps_confirmed)
}

function mapRow(row: any): TrainerBaseLocation {
  return {
    id: row.id,
    trainerId: row.trainerId,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    source: row.source,
    confidenceScore: row.confidenceScore ? parseFloat(row.confidenceScore) : null,
    geocodedAt: row.geocodedAt ? new Date(row.geocodedAt) : null,
    geocodedBy: row.geocodedBy,
    addressId: row.addressId,
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

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

/**
 * Ensure trainer_base_locations table exists
 * WHY: Table may not exist in older deployments
 */
export async function ensureTrainerBaseLocationTable(pool: Pool): Promise<void> {
  // Table should already exist from migration 009
  // This is a safety check
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_base_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
      latitude NUMERIC(10, 8) NOT NULL,
      longitude NUMERIC(11, 8) NOT NULL,
      source TEXT NOT NULL DEFAULT 'geocoded' 
        CHECK (source IN ('geocoded', 'manual', 'verified', 'gps_confirmed')),
      confidence_score NUMERIC(3, 2),
      geocoded_at TIMESTAMPTZ,
      geocoded_by TEXT,
      address_id UUID REFERENCES trainer_addresses(id) ON DELETE SET NULL,
      confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trainer_id),
      CONSTRAINT latitude_range_check 
        CHECK (latitude >= -90 AND latitude <= 90),
      CONSTRAINT longitude_range_check 
        CHECK (longitude >= -180 AND longitude <= 180)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_trainer 
    ON trainer_base_locations(trainer_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_confirmed
    ON trainer_base_locations(trainer_id, confirmed_at)
    WHERE source = 'gps_confirmed' AND confirmed_at IS NOT NULL;
  `);
}

/**
 * Repository for trainer_base_locations operations
 */
export class TrainerBaseLocationRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Get base location for a trainer
   * WHY: Check if trainer has confirmed location
   */
  async getByTrainerId(trainerId: string, client?: PoolClient): Promise<TrainerBaseLocation | null> {
    const result = await execute<any>(
      this.pool,
      client,
      `
        SELECT 
          id,
          trainer_id AS "trainerId",
          latitude,
          longitude,
          source,
          confidence_score AS "confidenceScore",
          geocoded_at AS "geocodedAt",
          geocoded_by AS "geocodedBy",
          address_id AS "addressId",
          confirmed_at AS "confirmedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM trainer_base_locations
        WHERE trainer_id = $1
      `,
      [trainerId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  /**
   * Confirm location via GPS + map pin
   * WHY: Store trainer-confirmed exact location, replacing geocoded location if exists
   * 
   * RULES:
   * - Only one active base location per trainer (enforced by UNIQUE constraint)
   * - If geocoded location exists, it will be replaced
   * - confirmed_at timestamp proves trainer consent
   */
  async confirmLocation(
    trainerId: string,
    latitude: number,
    longitude: number,
    accuracy: number | null,
    client?: PoolClient
  ): Promise<TrainerBaseLocation> {
    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error('Invalid latitude: must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Invalid longitude: must be between -180 and 180');
    }

    // Use accuracy as confidence score for GPS-confirmed locations
    // Higher accuracy (lower meters) = higher confidence
    // Convert accuracy (meters) to confidence score (0.0-1.0)
    // If accuracy is 10m or less, confidence is 1.0
    // If accuracy is 100m or more, confidence is 0.5
    // Linear interpolation between
    let confidenceScore: number | null = null;
    if (accuracy !== null && accuracy > 0) {
      if (accuracy <= 10) {
        confidenceScore = 1.0;
      } else if (accuracy >= 100) {
        confidenceScore = 0.5;
      } else {
        // Linear interpolation: 1.0 at 10m, 0.5 at 100m
        confidenceScore = 1.0 - ((accuracy - 10) / 90) * 0.5;
      }
    } else {
      // If no accuracy provided, assume good GPS (0.9 confidence)
      confidenceScore = 0.9;
    }

    const result = await execute<any>(
      this.pool,
      client,
      `
        INSERT INTO trainer_base_locations (
          trainer_id,
          latitude,
          longitude,
          source,
          confidence_score,
          confirmed_at,
          geocoded_at,
          updated_at
        ) VALUES ($1, $2, $3, 'gps_confirmed', $4, NOW(), NOW(), NOW())
        ON CONFLICT (trainer_id) DO UPDATE SET
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          source = 'gps_confirmed',
          confidence_score = EXCLUDED.confidence_score,
          confirmed_at = NOW(),
          updated_at = NOW()
        RETURNING 
          id,
          trainer_id AS "trainerId",
          latitude,
          longitude,
          source,
          confidence_score AS "confidenceScore",
          geocoded_at AS "geocodedAt",
          geocoded_by AS "geocodedBy",
          address_id AS "addressId",
          confirmed_at AS "confirmedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [trainerId, latitude, longitude, confidenceScore]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to confirm location');
    }

    return mapRow(result.rows[0]);
  }

  /**
   * Check if trainer has confirmed location
   * WHY: Fast check for navigation gating
   */
  async hasConfirmedLocation(trainerId: string, client?: PoolClient): Promise<boolean> {
    const result = await execute<any>(
      this.pool,
      client,
      `
        SELECT 1
        FROM trainer_base_locations
        WHERE trainer_id = $1
          AND source = 'gps_confirmed'
          AND confirmed_at IS NOT NULL
      `,
      [trainerId]
    );

    return result.rows.length > 0;
  }
}

