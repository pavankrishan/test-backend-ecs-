import type { Pool, PoolClient, QueryResult } from 'pg';

export interface TrainerProfile {
  id: string;
  trainerId: string;
  fullName: string | null;
  bio: string | null;
  specialties: string[] | null;
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  availability: Record<string, unknown> | null;
  preferredLanguages: string[] | null;
  certifications: string[] | null;
  ratingAverage: number | null;
  totalReviews: number;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainerProfileInput {
  fullName?: string | null;
  bio?: string | null;
  specialties?: string[] | null;
  yearsOfExperience?: number | null;
  hourlyRate?: number | null;
  availability?: Record<string, unknown> | null;
  preferredLanguages?: string[] | null;
  certifications?: string[] | null;
  verified?: boolean;
}

const PROFILE_COLUMNS = `
  id,
  trainer_id AS "trainerId",
  full_name AS "fullName",
  bio,
  specialties,
  years_of_experience AS "yearsOfExperience",
  hourly_rate AS "hourlyRate",
  availability,
  preferred_languages AS "preferredLanguages",
  certifications,
  rating_average AS "ratingAverage",
  total_reviews AS "totalReviews",
  verified,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
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

function mapRow(row: any): TrainerProfile {
  return {
    id: row.id,
    trainerId: row.trainerId,
    fullName: row.fullName ?? null,
    bio: row.bio ?? null,
    specialties: Array.isArray(row.specialties) ? row.specialties : null,
    yearsOfExperience:
      typeof row.yearsOfExperience === 'number'
        ? row.yearsOfExperience
        : row.yearsOfExperience === null
        ? null
        : Number(row.yearsOfExperience) || null,
    hourlyRate:
      typeof row.hourlyRate === 'number'
        ? row.hourlyRate
        : row.hourlyRate === null
        ? null
        : Number(row.hourlyRate),
    availability:
      row.availability && typeof row.availability === 'object'
        ? (row.availability as Record<string, unknown>)
        : row.availability
        ? JSON.parse(row.availability)
        : null,
    preferredLanguages: Array.isArray(row.preferredLanguages) ? row.preferredLanguages : null,
    certifications: Array.isArray(row.certifications) ? row.certifications : null,
    ratingAverage:
      typeof row.ratingAverage === 'number'
        ? Number(row.ratingAverage)
        : row.ratingAverage === null
        ? null
        : Number(row.ratingAverage),
    totalReviews: typeof row.totalReviews === 'number' ? row.totalReviews : Number(row.totalReviews) || 0,
    verified: Boolean(row.verified),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureAdditionalColumns(pool: Pool): Promise<void> {
  const clauses = [
    'ADD COLUMN IF NOT EXISTS full_name VARCHAR(150)',
    'ADD COLUMN IF NOT EXISTS bio TEXT',
    'ADD COLUMN IF NOT EXISTS specialties TEXT[]',
    'ADD COLUMN IF NOT EXISTS years_of_experience INT',
    'ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2)',
    'ADD COLUMN IF NOT EXISTS availability JSONB',
    'ADD COLUMN IF NOT EXISTS preferred_languages TEXT[]',
    'ADD COLUMN IF NOT EXISTS certifications TEXT[]',
    'ADD COLUMN IF NOT EXISTS rating_average NUMERIC(4,2)',
    'ADD COLUMN IF NOT EXISTS total_reviews INT NOT NULL DEFAULT 0',
    'ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false',
    'ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
  ];

  for (const clause of clauses) {
    await pool.query(`ALTER TABLE trainer_profiles ${clause};`);
  }
}

export async function ensureTrainerProfileTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL,
      full_name VARCHAR(150),
      bio TEXT,
      specialties TEXT[],
      years_of_experience INT,
      hourly_rate NUMERIC(10,2),
      availability JSONB,
      preferred_languages TEXT[],
      certifications TEXT[],
      rating_average NUMERIC(4,2),
      total_reviews INT NOT NULL DEFAULT 0,
      verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trainer_id)
    );
  `);

  await ensureAdditionalColumns(pool);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_profiles_verified ON trainer_profiles(verified);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_profiles_specialties ON trainer_profiles USING gin(specialties);
  `);
}

export class TrainerProfileRepository {
  constructor(private readonly pool: Pool) {}

  async getByTrainerId(trainerId: string, client?: PoolClient): Promise<TrainerProfile | null> {
    const result = await execute(
      this.pool,
      client,
      `SELECT ${PROFILE_COLUMNS} FROM trainer_profiles WHERE trainer_id = $1`,
      [trainerId],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async list(filters: { search?: string; specialties?: string[]; verified?: boolean; limit?: number; offset?: number }): Promise<TrainerProfile[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.search) {
      conditions.push(`(LOWER(coalesce(full_name, '')) LIKE $${idx} OR LOWER(coalesce(bio, '')) LIKE $${idx})`);
      params.push(`%${filters.search.toLowerCase()}%`);
      idx += 1;
    }

    if (filters.specialties && filters.specialties.length) {
      conditions.push(`specialties && $${idx}::text[]`);
      params.push(filters.specialties);
      idx += 1;
    }

    if (typeof filters.verified === 'boolean') {
      conditions.push(`verified = $${idx++}`);
      params.push(filters.verified);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    params.push(limit, offset);

    const result = await this.pool.query(
      `
        SELECT ${PROFILE_COLUMNS}
        FROM trainer_profiles
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${idx++}
        OFFSET $${idx}
      `,
      params,
    );

    return result.rows.map(mapRow);
  }

  async count(filters: { search?: string; specialties?: string[]; verified?: boolean }): Promise<number> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.search) {
      conditions.push(`(LOWER(coalesce(full_name, '')) LIKE $${idx} OR LOWER(coalesce(bio, '')) LIKE $${idx})`);
      params.push(`%${filters.search.toLowerCase()}%`);
      idx += 1;
    }

    if (filters.specialties && filters.specialties.length) {
      conditions.push(`specialties && $${idx}::text[]`);
      params.push(filters.specialties);
      idx += 1;
    }

    if (typeof filters.verified === 'boolean') {
      conditions.push(`verified = $${idx++}`);
      params.push(filters.verified);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.pool.query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM trainer_profiles
        ${whereClause}
      `,
      params,
    );

    return result.rows[0]?.total ?? 0;
  }

  async upsert(trainerId: string, input: TrainerProfileInput, client?: PoolClient): Promise<TrainerProfile> {
    const result = await execute(
      this.pool,
      client,
      `
        INSERT INTO trainer_profiles (
          trainer_id,
          full_name,
          bio,
          specialties,
          years_of_experience,
          hourly_rate,
          availability,
          preferred_languages,
          certifications,
          verified
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (trainer_id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          bio = EXCLUDED.bio,
          specialties = EXCLUDED.specialties,
          years_of_experience = EXCLUDED.years_of_experience,
          hourly_rate = EXCLUDED.hourly_rate,
          availability = EXCLUDED.availability,
          preferred_languages = EXCLUDED.preferred_languages,
          certifications = EXCLUDED.certifications,
          verified = COALESCE(EXCLUDED.verified, trainer_profiles.verified),
          updated_at = NOW()
        RETURNING ${PROFILE_COLUMNS}
      `,
      [
        trainerId,
        input.fullName ?? null,
        input.bio ?? null,
        input.specialties ?? null,
        input.yearsOfExperience ?? null,
        input.hourlyRate ?? null,
        input.availability ?? null,
        input.preferredLanguages ?? null,
        input.certifications ?? null,
        input.verified ?? false,
      ],
    );

    return mapRow(result.rows[0]);
  }

  async updateRatings(trainerId: string, ratingAverage: number, totalReviews: number, client?: PoolClient): Promise<TrainerProfile | null> {
    const result = await execute(
      this.pool,
      client,
      `
        UPDATE trainer_profiles
        SET rating_average = $2,
            total_reviews = $3,
            updated_at = NOW()
        WHERE trainer_id = $1
        RETURNING ${PROFILE_COLUMNS}
      `,
      [trainerId, ratingAverage, totalReviews],
    );

    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }
}

