import type { Pool, PoolClient, QueryResult } from 'pg';

export interface TrainerPerformance {
  id: string;
  trainerId: string;
  completedSessions: number;
  cancelledSessions: number;
  activeStudents: number;
  averageAttendance: number | null;
  averageFeedbackScore: number | null;
  responseTimeMinutes: number | null;
  onTimeRate: number | null;
  earningsTotal: number | null;
  earningsMonth: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PerformanceUpdateInput {
  completedSessions?: number;
  cancelledSessions?: number;
  activeStudents?: number;
  averageAttendance?: number | null;
  averageFeedbackScore?: number | null;
  responseTimeMinutes?: number | null;
  onTimeRate?: number | null;
  earningsTotal?: number | null;
  earningsMonth?: number | null;
}

const PERFORMANCE_COLUMNS = `
  id,
  trainer_id AS "trainerId",
  completed_sessions AS "completedSessions",
  cancelled_sessions AS "cancelledSessions",
  active_students AS "activeStudents",
  average_attendance AS "averageAttendance",
  average_feedback_score AS "averageFeedbackScore",
  response_time_minutes AS "responseTimeMinutes",
  on_time_rate AS "onTimeRate",
  earnings_total AS "earningsTotal",
  earnings_month AS "earningsMonth",
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

function mapRow(row: any): TrainerPerformance {
  return {
    id: row.id,
    trainerId: row.trainerId,
    completedSessions: Number(row.completedSessions) || 0,
    cancelledSessions: Number(row.cancelledSessions) || 0,
    activeStudents: Number(row.activeStudents) || 0,
    averageAttendance:
      row.averageAttendance === null || row.averageAttendance === undefined
        ? null
        : Number(row.averageAttendance),
    averageFeedbackScore:
      row.averageFeedbackScore === null || row.averageFeedbackScore === undefined
        ? null
        : Number(row.averageFeedbackScore),
    responseTimeMinutes:
      row.responseTimeMinutes === null || row.responseTimeMinutes === undefined
        ? null
        : Number(row.responseTimeMinutes),
    onTimeRate: row.onTimeRate === null || row.onTimeRate === undefined ? null : Number(row.onTimeRate),
    earningsTotal: row.earningsTotal === null || row.earningsTotal === undefined ? null : Number(row.earningsTotal),
    earningsMonth: row.earningsMonth === null || row.earningsMonth === undefined ? null : Number(row.earningsMonth),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureTrainerPerformanceTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_performance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL,
      completed_sessions INT NOT NULL DEFAULT 0,
      cancelled_sessions INT NOT NULL DEFAULT 0,
      active_students INT NOT NULL DEFAULT 0,
      average_attendance NUMERIC(5,2),
      average_feedback_score NUMERIC(3,2),
      response_time_minutes NUMERIC(6,2),
      on_time_rate NUMERIC(5,2),
      earnings_total NUMERIC(12,2),
      earnings_month NUMERIC(10,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trainer_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_performance_trainer ON trainer_performance(trainer_id);
  `);
}

export class TrainerPerformanceRepository {
  constructor(private readonly pool: Pool) {}

  async getByTrainerId(trainerId: string, client?: PoolClient): Promise<TrainerPerformance | null> {
    const result = await execute(
      this.pool,
      client,
      `SELECT ${PERFORMANCE_COLUMNS} FROM trainer_performance WHERE trainer_id = $1`,
      [trainerId],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async upsert(trainerId: string, updates: PerformanceUpdateInput, client?: PoolClient): Promise<TrainerPerformance> {
    const result = await execute(
      this.pool,
      client,
      `
        INSERT INTO trainer_performance (
          trainer_id,
          completed_sessions,
          cancelled_sessions,
          active_students,
          average_attendance,
          average_feedback_score,
          response_time_minutes,
          on_time_rate,
          earnings_total,
          earnings_month
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (trainer_id) DO UPDATE SET
          completed_sessions = COALESCE(EXCLUDED.completed_sessions, trainer_performance.completed_sessions),
          cancelled_sessions = COALESCE(EXCLUDED.cancelled_sessions, trainer_performance.cancelled_sessions),
          active_students = COALESCE(EXCLUDED.active_students, trainer_performance.active_students),
          average_attendance = COALESCE(EXCLUDED.average_attendance, trainer_performance.average_attendance),
          average_feedback_score = COALESCE(EXCLUDED.average_feedback_score, trainer_performance.average_feedback_score),
          response_time_minutes = COALESCE(EXCLUDED.response_time_minutes, trainer_performance.response_time_minutes),
          on_time_rate = COALESCE(EXCLUDED.on_time_rate, trainer_performance.on_time_rate),
          earnings_total = COALESCE(EXCLUDED.earnings_total, trainer_performance.earnings_total),
          earnings_month = COALESCE(EXCLUDED.earnings_month, trainer_performance.earnings_month),
          updated_at = NOW()
        RETURNING ${PERFORMANCE_COLUMNS}
      `,
      [
        trainerId,
        updates.completedSessions ?? null,
        updates.cancelledSessions ?? null,
        updates.activeStudents ?? null,
        updates.averageAttendance ?? null,
        updates.averageFeedbackScore ?? null,
        updates.responseTimeMinutes ?? null,
        updates.onTimeRate ?? null,
        updates.earningsTotal ?? null,
        updates.earningsMonth ?? null,
      ],
    );

    return mapRow(result.rows[0]);
  }

  async incrementSessions(
    trainerId: string,
    payload: { completedIncrement?: number; cancelledIncrement?: number },
    client?: PoolClient,
  ): Promise<TrainerPerformance> {
    const completed = payload.completedIncrement ?? 0;
    const cancelled = payload.cancelledIncrement ?? 0;

    const result = await execute(
      this.pool,
      client,
      `
        UPDATE trainer_performance
        SET
          completed_sessions = completed_sessions + $2,
          cancelled_sessions = cancelled_sessions + $3,
          updated_at = NOW()
        WHERE trainer_id = $1
        RETURNING ${PERFORMANCE_COLUMNS}
      `,
      [trainerId, completed, cancelled],
    );

    if (!result.rows.length) {
      return this.upsert(trainerId, { completedSessions: completed, cancelledSessions: cancelled }, client);
    }

    return mapRow(result.rows[0]);
  }
}

