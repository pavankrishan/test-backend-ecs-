import type { Pool, PoolClient, QueryResult } from 'pg';

export interface StudentCourseProgress {
  id: string;
  studentId: string;
  courseId: string;
  percentage: number;
  completedLessons: number;
  totalLessons: number;
  moduleProgress: Record<string, unknown> | null;
  streakCount: number;
  lastAccessedAt: Date | null;
  lastCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgressUpsertInput {
  studentId: string;
  courseId: string;
  percentage?: number | null;
  completedLessons?: number | null;
  totalLessons?: number | null;
  moduleProgress?: Record<string, unknown> | null;
  streakCount?: number | null;
  lastAccessedAt?: Date | null;
  lastCompletedAt?: Date | null;
}

const PROGRESS_COLUMNS = `
  id,
  student_id AS "studentId",
  course_id AS "courseId",
  percentage,
  completed_lessons AS "completedLessons",
  total_lessons AS "totalLessons",
  module_progress AS "moduleProgress",
  streak_count AS "streakCount",
  last_accessed_at AS "lastAccessedAt",
  last_completed_at AS "lastCompletedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function mapRow(row: any): StudentCourseProgress {
  // PostgreSQL NUMERIC returns as string, so parse it
  const parsePercentage = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  return {
    id: row.id,
    studentId: row.studentId,
    courseId: row.courseId,
    percentage: parsePercentage(row.percentage),
    completedLessons: typeof row.completedLessons === 'number' ? row.completedLessons : 0,
    totalLessons: typeof row.totalLessons === 'number' ? row.totalLessons : 0,
    moduleProgress:
      row.moduleProgress && typeof row.moduleProgress === 'object'
        ? (row.moduleProgress as Record<string, unknown>)
        : row.moduleProgress
        ? JSON.parse(row.moduleProgress)
        : null,
    streakCount: typeof row.streakCount === 'number' ? row.streakCount : 0,
    lastAccessedAt: row.lastAccessedAt ?? null,
    lastCompletedAt: row.lastCompletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

export async function ensureStudentProgressTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_course_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      course_id UUID NOT NULL,
      percentage NUMERIC(5,2) DEFAULT 0,
      completed_lessons INT DEFAULT 0,
      total_lessons INT DEFAULT 0,
      module_progress JSONB,
      streak_count INT DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,
      last_completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(student_id, course_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_course_progress_student ON student_course_progress(student_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_course_progress_course ON student_course_progress(course_id);
  `);
}

export class StudentProgressRepository {
  constructor(private readonly pool: Pool) {}

  async getByStudentAndCourse(studentId: string, courseId: string, client?: PoolClient): Promise<StudentCourseProgress | null> {
    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${PROGRESS_COLUMNS}
        FROM student_course_progress
        WHERE student_id = $1 AND course_id = $2
      `,
      [studentId, courseId],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async listByStudent(studentId: string, client?: PoolClient): Promise<StudentCourseProgress[]> {
    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${PROGRESS_COLUMNS}
        FROM student_course_progress
        WHERE student_id = $1
        ORDER BY updated_at DESC
      `,
      [studentId],
    );
    return result.rows.map(mapRow);
  }

  /**
   * @deprecated student_course_progress is now read-only and derived from tutoring_sessions via database triggers.
   * Progress is automatically updated when tutoring sessions are completed.
   * Use getByStudentAndCourse() to read progress instead.
   */
  async upsertProgress(input: ProgressUpsertInput, client?: PoolClient): Promise<StudentCourseProgress> {
    throw new Error(
      'student_course_progress is now read-only. Progress is derived from tutoring_sessions via database triggers. ' +
      'Use getByStudentAndCourse() to read progress. Progress updates automatically when sessions are completed.'
    );
  }

  /**
   * @deprecated student_course_progress is now read-only and derived from tutoring_sessions via database triggers.
   * Progress is automatically updated when tutoring sessions are completed.
   */
  async incrementCompletedLessons(
    studentId: string,
    courseId: string,
    incrementBy = 1,
    client?: PoolClient,
  ): Promise<StudentCourseProgress> {
    throw new Error(
      'student_course_progress is now read-only. Progress is derived from tutoring_sessions via database triggers. ' +
      'Use getByStudentAndCourse() to read progress. Progress updates automatically when sessions are completed.'
    );
  }
}

