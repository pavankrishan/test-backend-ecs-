import type { Pool, PoolClient, QueryResult } from 'pg';

/**
 * Profile ownership: student-service is the single source of truth for student_profiles.
 * All profile writes (including address, latitude, longitude, fullName, etc.) MUST go
 * through this repository. student-auth only reads from the same table and must NOT
 * write (auth PUT /profile proxies to this service).
 */
export interface StudentProfile {
  id: string;
  studentId: string;
  fullName: string | null;
  age: number | null;
  gender: string | null;
  dateOfBirth: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  avatarUrl: string | null;
  goals: string | null;
  interests: string[] | null;
  learningPreferences: Record<string, unknown> | null;
  timezone: string | null;
  occupation: string | null;
  organization: string | null;
  preferredLanguages: string[] | null;
  extra: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentProfileInput {
  fullName?: string | null;
  age?: number | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  avatarUrl?: string | null;
  goals?: string | null;
  interests?: string[] | null;
  learningPreferences?: Record<string, unknown> | null;
  timezone?: string | null;
  occupation?: string | null;
  organization?: string | null;
  preferredLanguages?: string[] | null;
  extra?: Record<string, unknown> | null;
}

const PROFILE_COLUMNS = `
  id,
  student_id AS "studentId",
  full_name AS "fullName",
  age,
  gender,
  date_of_birth AS "dateOfBirth",
  address,
  latitude,
  longitude,
  avatar_url AS "avatarUrl",
  goals,
  interests,
  learning_preferences AS "learningPreferences",
  timezone,
  occupation,
  organization,
  preferred_languages AS "preferredLanguages",
  extra,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function mapRow(row: any): StudentProfile {
  return {
    id: row.id,
    studentId: row.studentId,
    fullName: row.fullName ?? null,
    age: typeof row.age === 'number' ? row.age : row.age === null ? null : Number(row.age) || null,
    gender: row.gender ?? null,
    dateOfBirth: row.dateOfBirth ?? null,
    address: row.address ?? null,
    latitude: typeof row.latitude === 'number' ? row.latitude : row.latitude === null ? null : Number(row.latitude) || null,
    longitude: typeof row.longitude === 'number' ? row.longitude : row.longitude === null ? null : Number(row.longitude) || null,
    avatarUrl: row.avatarUrl ?? null,
    goals: row.goals ?? null,
    interests: Array.isArray(row.interests) ? row.interests : null,
    learningPreferences:
      row.learningPreferences && typeof row.learningPreferences === 'object'
        ? (row.learningPreferences as Record<string, unknown>)
        : row.learningPreferences
        ? JSON.parse(row.learningPreferences)
        : null,
    timezone: row.timezone ?? null,
    occupation: row.occupation ?? null,
    organization: row.organization ?? null,
    preferredLanguages: Array.isArray(row.preferredLanguages) ? row.preferredLanguages : null,
    extra:
      row.extra && typeof row.extra === 'object'
        ? (row.extra as Record<string, unknown>)
        : row.extra
        ? JSON.parse(row.extra)
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function executeQuery<T extends Record<string, any> = Record<string, any>>(
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

async function ensureAdditionalColumns(pool: Pool): Promise<void> {
  const alterations = [
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS date_of_birth TIMESTAMPTZ;',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS goals TEXT;',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS interests TEXT[];',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS learning_preferences JSONB;',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS timezone VARCHAR(100);',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS organization VARCHAR(150);',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS preferred_languages TEXT[];',
    'ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS extra JSONB;',
    'CREATE INDEX IF NOT EXISTS idx_student_profiles_student_id ON student_profiles(student_id);',
  ];

  for (const statement of alterations) {
    // sequential to avoid connection flooding
    await pool.query(statement);
  }
}

export async function ensureStudentProfileTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      full_name VARCHAR(150),
      age INT,
      gender VARCHAR(20),
      date_of_birth TIMESTAMPTZ,
      address TEXT,
      avatar_url TEXT,
      goals TEXT,
      interests TEXT[],
      learning_preferences JSONB,
      timezone VARCHAR(100),
      occupation VARCHAR(100),
      organization VARCHAR(150),
      preferred_languages TEXT[],
      extra JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(student_id)
    );
  `);

  await ensureAdditionalColumns(pool);
}

export class StudentProfileRepository {
  constructor(private readonly pool: Pool) {}

  async getByStudentId(studentId: string, client?: PoolClient): Promise<StudentProfile | null> {
    const result = await executeQuery(
      this.pool,
      client,
      `SELECT ${PROFILE_COLUMNS} FROM student_profiles WHERE student_id = $1`,
      [studentId],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async upsert(studentId: string, input: StudentProfileInput, client?: PoolClient): Promise<StudentProfile> {
    // PRODUCTION-GRADE: Get existing profile to preserve values for fields not provided
    // This ensures partial updates don't overwrite existing data
    // PostgreSQL's ON CONFLICT DO UPDATE is atomic, so we don't need explicit transaction
    // However, we fetch existing profile first to build complete payload
    const existingProfile = await this.getByStudentId(studentId, client);
    
    // Build payload: only include fields that are explicitly provided in input
    // For fields not provided, use existing values to preserve them
    const payload: any = {};
    
    // Only set fields that are explicitly provided (not undefined)
    if (input.fullName !== undefined) {
      payload.fullName = (input.fullName && input.fullName.trim()) ? input.fullName.trim() : null;
    } else if (existingProfile) {
      payload.fullName = existingProfile.fullName;
    } else {
      payload.fullName = null;
    }
    
    if (input.age !== undefined) {
      payload.age = typeof input.age === 'number' ? input.age : input.age ?? null;
    } else if (existingProfile) {
      payload.age = existingProfile.age;
    } else {
      payload.age = null;
    }
    
    if (input.gender !== undefined) {
      payload.gender = (input.gender && input.gender.trim()) ? input.gender.trim() : null;
    } else if (existingProfile) {
      payload.gender = existingProfile.gender;
    } else {
      payload.gender = null;
    }
    
    if (input.dateOfBirth !== undefined) {
      payload.dateOfBirth = input.dateOfBirth ?? null;
    } else if (existingProfile) {
      payload.dateOfBirth = existingProfile.dateOfBirth;
    } else {
      payload.dateOfBirth = null;
    }
    
    if (input.address !== undefined) {
      payload.address = input.address ?? null;
    } else if (existingProfile) {
      payload.address = existingProfile.address;
    } else {
      payload.address = null;
    }
    
    if (input.latitude !== undefined) {
      payload.latitude = typeof input.latitude === 'number' ? input.latitude : input.latitude ?? null;
    } else if (existingProfile) {
      payload.latitude = existingProfile.latitude;
    } else {
      payload.latitude = null;
    }
    
    if (input.longitude !== undefined) {
      payload.longitude = typeof input.longitude === 'number' ? input.longitude : input.longitude ?? null;
    } else if (existingProfile) {
      payload.longitude = existingProfile.longitude;
    } else {
      payload.longitude = null;
    }
    
    if (input.avatarUrl !== undefined) {
      payload.avatarUrl = input.avatarUrl ?? null;
    } else if (existingProfile) {
      payload.avatarUrl = existingProfile.avatarUrl;
    } else {
      payload.avatarUrl = null;
    }
    
    if (input.goals !== undefined) {
      payload.goals = input.goals ?? null;
    } else if (existingProfile) {
      payload.goals = existingProfile.goals;
    } else {
      payload.goals = null;
    }
    
    if (input.interests !== undefined) {
      payload.interests = input.interests ?? null;
    } else if (existingProfile) {
      payload.interests = existingProfile.interests;
    } else {
      payload.interests = null;
    }
    
    if (input.learningPreferences !== undefined) {
      payload.learningPreferences = input.learningPreferences ?? null;
    } else if (existingProfile) {
      payload.learningPreferences = existingProfile.learningPreferences;
    } else {
      payload.learningPreferences = null;
    }
    
    if (input.timezone !== undefined) {
      payload.timezone = input.timezone ?? null;
    } else if (existingProfile) {
      payload.timezone = existingProfile.timezone;
    } else {
      payload.timezone = null;
    }
    
    if (input.occupation !== undefined) {
      payload.occupation = input.occupation ?? null;
    } else if (existingProfile) {
      payload.occupation = existingProfile.occupation;
    } else {
      payload.occupation = null;
    }
    
    if (input.organization !== undefined) {
      payload.organization = input.organization ?? null;
    } else if (existingProfile) {
      payload.organization = existingProfile.organization;
    } else {
      payload.organization = null;
    }
    
    if (input.preferredLanguages !== undefined) {
      payload.preferredLanguages = input.preferredLanguages ?? null;
    } else if (existingProfile) {
      payload.preferredLanguages = existingProfile.preferredLanguages;
    } else {
      payload.preferredLanguages = null;
    }
    
    // For extra, merge with existing extra to preserve existing data
    if (input.extra !== undefined) {
      if (existingProfile?.extra && typeof existingProfile.extra === 'object' && input.extra && typeof input.extra === 'object') {
        // Merge existing extra with new extra (new values override existing)
        payload.extra = { ...existingProfile.extra, ...input.extra };
      } else {
        payload.extra = input.extra ?? null;
      }
    } else if (existingProfile) {
      payload.extra = existingProfile.extra;
    } else {
      payload.extra = null;
    }

    // PRODUCTION-GRADE: Execute atomic upsert (ON CONFLICT DO UPDATE is atomic in PostgreSQL)
    const result = await executeQuery(
      this.pool,
      client,
      `
        INSERT INTO student_profiles (
          student_id,
          full_name,
          age,
          gender,
          date_of_birth,
          address,
          latitude,
          longitude,
          avatar_url,
          goals,
          interests,
          learning_preferences,
          timezone,
          occupation,
          organization,
          preferred_languages,
          extra
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (student_id) DO UPDATE
        SET
          full_name = EXCLUDED.full_name,
          age = EXCLUDED.age,
          gender = EXCLUDED.gender,
          date_of_birth = EXCLUDED.date_of_birth,
          address = EXCLUDED.address,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          avatar_url = EXCLUDED.avatar_url,
          goals = EXCLUDED.goals,
          interests = EXCLUDED.interests,
          learning_preferences = EXCLUDED.learning_preferences,
          timezone = EXCLUDED.timezone,
          occupation = EXCLUDED.occupation,
          organization = EXCLUDED.organization,
          preferred_languages = EXCLUDED.preferred_languages,
          extra = EXCLUDED.extra,
          updated_at = NOW()
        RETURNING ${PROFILE_COLUMNS}
      `,
      [
        studentId,
        payload.fullName,
        payload.age,
        payload.gender,
        payload.dateOfBirth,
        payload.address,
        payload.latitude,
        payload.longitude,
        payload.avatarUrl,
        payload.goals,
        payload.interests ? JSON.stringify(payload.interests) : null,
        payload.learningPreferences ? JSON.stringify(payload.learningPreferences) : null,
        payload.timezone,
        payload.occupation,
        payload.organization,
        payload.preferredLanguages ? JSON.stringify(payload.preferredLanguages) : null,
        payload.extra ? JSON.stringify(payload.extra) : null,
      ],
    );

    // PRODUCTION-GRADE: Return mapped profile
    // All fields are preserved - only provided fields are updated, others remain unchanged
    return mapRow(result.rows[0]);
  }

  async touch(studentId: string, client?: PoolClient): Promise<void> {
    await executeQuery(
      this.pool,
      client,
      `
        UPDATE student_profiles
        SET updated_at = NOW()
        WHERE student_id = $1
      `,
      [studentId],
    );
  }
}

