import type { Pool, PoolClient } from 'pg';

export interface TrainerStudentAllocation {
  id: string;
  trainerId: string;
  studentId: string;
  startDate: Date;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAllocationInput {
  trainerId: string;
  studentId: string;
  startDate: Date;
  endDate?: Date | null;
}

export interface UpdateAllocationInput {
  endDate?: Date | null;
}

function mapRow(row: any): TrainerStudentAllocation {
  return {
    id: row.id,
    trainerId: row.trainer_id,
    studentId: row.student_id,
    startDate: new Date(row.start_date),
    endDate: row.end_date ? new Date(row.end_date) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function ensureTrainerStudentAllocationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_student_allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_trainer 
    ON trainer_student_allocations(trainer_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_student 
    ON trainer_student_allocations(student_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_active 
    ON trainer_student_allocations(trainer_id, start_date) 
    WHERE end_date IS NULL;
  `);

  // Create exclusion constraint for overlapping allocations
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'no_overlapping_allocations'
      ) THEN
        ALTER TABLE trainer_student_allocations
        ADD CONSTRAINT no_overlapping_allocations
        EXCLUDE USING gist (
          trainer_id WITH =,
          student_id WITH =,
          daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
        );
      END IF;
    END $$;
  `);
}

export class TrainerStudentAllocationRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateAllocationInput,
    client?: PoolClient
  ): Promise<TrainerStudentAllocation> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `
        INSERT INTO trainer_student_allocations (
          trainer_id,
          student_id,
          start_date,
          end_date,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING *
      `,
      [input.trainerId, input.studentId, input.startDate, input.endDate || null]
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<TrainerStudentAllocation | null> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `SELECT * FROM trainer_student_allocations WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async findByTrainerId(
    trainerId: string,
    options?: { activeOnly?: boolean },
    client?: PoolClient
  ): Promise<TrainerStudentAllocation[]> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    let query = `SELECT * FROM trainer_student_allocations WHERE trainer_id = $1`;
    const params: any[] = [trainerId];

    if (options?.activeOnly) {
      query += ` AND (end_date IS NULL OR end_date >= CURRENT_DATE)`;
    }

    query += ` ORDER BY start_date DESC`;

    const result = await queryFn(query, params);
    return result.rows.map(mapRow);
  }

  async findByStudentId(
    studentId: string,
    client?: PoolClient
  ): Promise<TrainerStudentAllocation[]> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `SELECT * FROM trainer_student_allocations WHERE student_id = $1 ORDER BY start_date DESC`,
      [studentId]
    );

    return result.rows.map(mapRow);
  }

  async update(
    id: string,
    input: UpdateAllocationInput,
    client?: PoolClient
  ): Promise<TrainerStudentAllocation> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.endDate !== undefined) {
      updates.push(`end_date = $${paramIndex++}`);
      params.push(input.endDate);
    }

    if (updates.length === 0) {
      const existing = await this.findById(id, client);
      if (!existing) {
        throw new Error('Allocation not found');
      }
      return existing;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await queryFn(
      `
        UPDATE trainer_student_allocations
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `,
      params
    );

    if (result.rows.length === 0) {
      throw new Error('Allocation not found');
    }

    return mapRow(result.rows[0]);
  }

  async getActiveStudentCount(
    trainerId: string,
    date: Date,
    client?: PoolClient
  ): Promise<number> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `
        SELECT COUNT(DISTINCT student_id) as count
        FROM trainer_student_allocations
        WHERE trainer_id = $1
          AND start_date <= $2
          AND (end_date IS NULL OR end_date >= $2)
      `,
      [trainerId, date]
    );

    return parseInt(result.rows[0]?.count || '0', 10);
  }

  async getDailyStudentCounts(
    trainerId: string,
    monthStart: Date,
    monthEnd: Date,
    client?: PoolClient
  ): Promise<Array<{ date: Date; studentCount: number }>> {
    const queryFn = client ? client.query.bind(client) : this.pool.query.bind(this.pool);

    const result = await queryFn(
      `
        WITH date_series AS (
          SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS day
        )
        SELECT 
          ds.day AS date,
          COUNT(DISTINCT tsa.student_id) AS student_count
        FROM date_series ds
        LEFT JOIN trainer_student_allocations tsa ON (
          tsa.trainer_id = $1
          AND tsa.start_date <= ds.day
          AND (tsa.end_date IS NULL OR tsa.end_date >= ds.day)
        )
        GROUP BY ds.day
        ORDER BY ds.day
      `,
      [trainerId, monthStart, monthEnd]
    );

    return result.rows.map((row: any) => ({
      date: new Date(row.date),
      studentCount: parseInt(row.student_count || '0', 10),
    }));
  }
}

