import type { Pool, PoolClient, QueryResult } from 'pg';

export type ProjectSubmissionStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'needs_revision'
  | 'rejected';

export interface ProjectSubmission {
  id: string;
  studentId: string;
  courseId: string | null;
  projectTitle: string;
  description: string | null;
  submissionUrl: string | null;
  attachments: Record<string, unknown>[] | null;
  status: ProjectSubmissionStatus;
  grade: number | null;
  feedback: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  updatedAt: Date;
}

export interface ProjectSubmissionInput {
  studentId: string;
  courseId?: string | null;
  projectTitle: string;
  description?: string | null;
  submissionUrl?: string | null;
  attachments?: Record<string, unknown>[] | null;
}

export interface ProjectSubmissionUpdateInput {
  description?: string | null;
  submissionUrl?: string | null;
  attachments?: Record<string, unknown>[] | null;
  status?: ProjectSubmissionStatus;
  grade?: number | null;
  feedback?: string | null;
  reviewedAt?: Date | null;
}

const SUBMISSION_COLUMNS = `
  id,
  student_id AS "studentId",
  course_id AS "courseId",
  project_title AS "projectTitle",
  description,
  submission_url AS "submissionUrl",
  attachments,
  status,
  grade,
  feedback,
  submitted_at AS "submittedAt",
  reviewed_at AS "reviewedAt",
  updated_at AS "updatedAt"
`;

function mapRow(row: any): ProjectSubmission {
  let attachments: Record<string, unknown>[] | null = null;
  if (Array.isArray(row.attachments)) {
    attachments = row.attachments as Record<string, unknown>[];
  } else if (row.attachments && typeof row.attachments === 'object') {
    attachments = [row.attachments as Record<string, unknown>];
  } else if (typeof row.attachments === 'string') {
    try {
      const parsed = JSON.parse(row.attachments);
      if (Array.isArray(parsed)) {
        attachments = parsed as Record<string, unknown>[];
      } else if (parsed && typeof parsed === 'object') {
        attachments = [parsed as Record<string, unknown>];
      }
    } catch {
      attachments = null;
    }
  }

  return {
    id: row.id,
    studentId: row.studentId,
    courseId: row.courseId ?? null,
    projectTitle: row.projectTitle,
    description: row.description ?? null,
    submissionUrl: row.submissionUrl ?? null,
    attachments,
    status: row.status as ProjectSubmissionStatus,
    grade: row.grade === null || row.grade === undefined ? null : Number(row.grade),
    feedback: row.feedback ?? null,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt ?? null,
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

export async function ensureProjectSubmissionTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_project_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      course_id UUID,
      project_title TEXT NOT NULL,
      description TEXT,
      submission_url TEXT,
      attachments JSONB,
      status VARCHAR(20) NOT NULL DEFAULT 'submitted',
      grade NUMERIC(5,2),
      feedback TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(student_id, project_title)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_project_submissions_student ON student_project_submissions(student_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_project_submissions_course ON student_project_submissions(course_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_project_submissions_status ON student_project_submissions(status);
  `);
}

export class ProjectSubmissionRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: ProjectSubmissionInput, client?: PoolClient): Promise<ProjectSubmission> {
    const result = await execute(
      this.pool,
      client,
      `
        INSERT INTO student_project_submissions (
          student_id,
          course_id,
          project_title,
          description,
          submission_url,
          attachments
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (student_id, project_title) DO UPDATE SET
          description = EXCLUDED.description,
          submission_url = EXCLUDED.submission_url,
          attachments = EXCLUDED.attachments,
          status = 'submitted',
          grade = NULL,
          feedback = NULL,
          submitted_at = NOW(),
          reviewed_at = NULL,
          updated_at = NOW()
        RETURNING ${SUBMISSION_COLUMNS}
      `,
      [
        input.studentId,
        input.courseId ?? null,
        input.projectTitle,
        input.description ?? null,
        input.submissionUrl ?? null,
        input.attachments ?? null,
      ],
    );

    return mapRow(result.rows[0]);
  }

  async update(
    submissionId: string,
    updates: ProjectSubmissionUpdateInput,
    client?: PoolClient,
  ): Promise<ProjectSubmission | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (updates.description !== undefined) {
      fields.push(`description = $${idx++}`);
      params.push(updates.description);
    }
    if (updates.submissionUrl !== undefined) {
      fields.push(`submission_url = $${idx++}`);
      params.push(updates.submissionUrl);
    }
    if (updates.attachments !== undefined) {
      fields.push(`attachments = $${idx++}`);
      params.push(updates.attachments);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      params.push(updates.status);
    }
    if (updates.grade !== undefined) {
      fields.push(`grade = $${idx++}`);
      params.push(updates.grade);
    }
    if (updates.feedback !== undefined) {
      fields.push(`feedback = $${idx++}`);
      params.push(updates.feedback);
    }
    if (updates.reviewedAt !== undefined) {
      fields.push(`reviewed_at = $${idx++}`);
      params.push(updates.reviewedAt);
    }

    if (!fields.length) {
      return this.findById(submissionId, client);
    }

    fields.push(`updated_at = NOW()`);

    params.push(submissionId);

    const result = await execute(
      this.pool,
      client,
      `
        UPDATE student_project_submissions
        SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING ${SUBMISSION_COLUMNS}
      `,
      params,
    );

    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<ProjectSubmission | null> {
    const result = await execute(
      this.pool,
      client,
      `SELECT ${SUBMISSION_COLUMNS} FROM student_project_submissions WHERE id = $1`,
      [id],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async listByStudent(
    studentId: string,
    options?: { limit?: number },
    client?: PoolClient
  ): Promise<ProjectSubmission[]> {
    const limit = options?.limit ?? 100; // Default 100, bootstrap uses 50
    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${SUBMISSION_COLUMNS}
        FROM student_project_submissions
        WHERE student_id = $1
        ORDER BY submitted_at DESC
        LIMIT $2
      `,
      [studentId, limit],
    );
    return result.rows.map(mapRow);
  }

  async listByCourse(courseId: string, client?: PoolClient): Promise<ProjectSubmission[]> {
    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${SUBMISSION_COLUMNS}
        FROM student_project_submissions
        WHERE course_id = $1
        ORDER BY submitted_at DESC
      `,
      [courseId],
    );
    return result.rows.map(mapRow);
  }
}

