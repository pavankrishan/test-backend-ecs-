import type { Pool, PoolClient } from 'pg';

export interface TrainerSessionSubstitution {
  id: string;
  sessionDate: Date;
  originalTrainerId: string;
  substituteTrainerId: string;
  studentId: string;
  createdAt: Date;
}

export interface CreateSubstitutionInput {
  sessionDate: Date;
  originalTrainerId: string;
  substituteTrainerId: string;
  studentId: string;
}

function mapRow(row: any): TrainerSessionSubstitution {
  return {
    id: row.id,
    sessionDate: new Date(row.session_date),
    originalTrainerId: row.original_trainer_id,
    substituteTrainerId: row.substitute_trainer_id,
    studentId: row.student_id,
    createdAt: new Date(row.created_at),
  };
}

export async function ensureTrainerSessionSubstitutionsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_session_substitutions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_date DATE NOT NULL,
      original_trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
      substitute_trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      -- Ensure substitution only on working days (Mon-Sat)
      CONSTRAINT substitution_working_day CHECK (
        EXTRACT(DOW FROM session_date) BETWEEN 1 AND 6
      ),
      
      -- One substitution per session per day
      UNIQUE(session_date, original_trainer_id, student_id)
    );
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_date 
    ON trainer_session_substitutions(session_date);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_original 
    ON trainer_session_substitutions(original_trainer_id, session_date);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_substitute 
    ON trainer_session_substitutions(substitute_trainer_id, session_date);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_student 
    ON trainer_session_substitutions(student_id, session_date);
  `);
}

export class TrainerSessionSubstitutionRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateSubstitutionInput,
    client?: PoolClient
  ): Promise<TrainerSessionSubstitution> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    // Validate it's a working day
    const dayOfWeek = new Date(input.sessionDate).getDay();
    if (dayOfWeek === 0) {
      throw new Error('Substitutions cannot be scheduled on Sundays');
    }

    const result = await queryFn(
      `
        INSERT INTO trainer_session_substitutions (
          session_date,
          original_trainer_id,
          substitute_trainer_id,
          student_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (session_date, original_trainer_id, student_id) 
        DO UPDATE SET
          substitute_trainer_id = EXCLUDED.substitute_trainer_id,
          created_at = NOW()
        RETURNING *
      `,
      [
        input.sessionDate,
        input.originalTrainerId,
        input.substituteTrainerId,
        input.studentId,
      ]
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<TrainerSessionSubstitution | null> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `SELECT * FROM trainer_session_substitutions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async findByDateRange(
    trainerId: string,
    startDate: Date,
    endDate: Date,
    options?: { asSubstitute?: boolean },
    client?: PoolClient
  ): Promise<TrainerSessionSubstitution[]> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    let query = `
      SELECT * FROM trainer_session_substitutions
      WHERE session_date BETWEEN $1 AND $2
    `;
    const params: any[] = [startDate, endDate];

    if (options?.asSubstitute) {
      query += ` AND substitute_trainer_id = $3`;
      params.push(trainerId);
    } else {
      query += ` AND original_trainer_id = $3`;
      params.push(trainerId);
    }

    query += ` ORDER BY session_date DESC`;

    const result = await queryFn(query, params);
    return result.rows.map(mapRow);
  }

  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `DELETE FROM trainer_session_substitutions WHERE id = $1`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }
}

