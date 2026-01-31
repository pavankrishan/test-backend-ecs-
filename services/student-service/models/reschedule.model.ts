import type { Pool, PoolClient, QueryResult } from 'pg';

export type RescheduleStatus = 'pending' | 'approved' | 'rejected' | 'rescheduled' | 'cancelled';

export interface RescheduleRequest {
  id: string;
  studentId: string;
  bookingId: string | null;
  courseId: string | null;
  reason: string;
  currentSchedule: {
    start: string | null;
    end: string | null;
    timezone: string | null;
  } | null;
  preferredSlots: string[] | null;
  meetingType: string | null;
  status: RescheduleStatus;
  adminNotes: string | null;
  studentNotes: string | null;
  requestedFor: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RescheduleCreateInput {
  studentId: string;
  bookingId?: string | null;
  courseId?: string | null;
  reason: string;
  currentSchedule?: RescheduleRequest['currentSchedule'];
  preferredSlots?: string[] | null;
  meetingType?: string | null;
  studentNotes?: string | null;
  requestedFor?: Date | null;
}

export interface RescheduleUpdateInput {
  reason?: string;
  preferredSlots?: string[] | null;
  meetingType?: string | null;
  studentNotes?: string | null;
  requestedFor?: Date | null;
  currentSchedule?: RescheduleRequest['currentSchedule'];
  bookingId?: string | null;
  courseId?: string | null;
}

export interface RescheduleStatusUpdate {
  status: RescheduleStatus;
  adminNotes?: string | null;
  resolvedAt?: Date | null;
}

const RESCHEDULE_COLUMNS = `
  id,
  student_id AS "studentId",
  booking_id AS "bookingId",
  course_id AS "courseId",
  reason,
  current_schedule AS "currentSchedule",
  preferred_slots AS "preferredSlots",
  meeting_type AS "meetingType",
  status,
  admin_notes AS "adminNotes",
  student_notes AS "studentNotes",
  requested_for AS "requestedFor",
  resolved_at AS "resolvedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function mapRow(row: any): RescheduleRequest {
  const currentSchedule =
    row.currentSchedule && typeof row.currentSchedule === 'object'
      ? (row.currentSchedule as RescheduleRequest['currentSchedule'])
      : typeof row.currentSchedule === 'string'
      ? (() => {
          try {
            return JSON.parse(row.currentSchedule);
          } catch {
            return null;
          }
        })()
      : null;

  let preferredSlots: string[] | null = null;
  if (Array.isArray(row.preferredSlots)) {
    preferredSlots = row.preferredSlots as string[];
  } else if (typeof row.preferredSlots === 'string') {
    try {
      const parsed = JSON.parse(row.preferredSlots);
      preferredSlots = Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      preferredSlots = null;
    }
  }

  return {
    id: row.id,
    studentId: row.studentId,
    bookingId: row.bookingId ?? null,
    courseId: row.courseId ?? null,
    reason: row.reason,
    currentSchedule,
    preferredSlots,
    meetingType: row.meetingType ?? null,
    status: row.status as RescheduleStatus,
    adminNotes: row.adminNotes ?? null,
    studentNotes: row.studentNotes ?? null,
    requestedFor: row.requestedFor ?? null,
    resolvedAt: row.resolvedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function query<T extends Record<string, any> = Record<string, any>>(
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

export async function ensureRescheduleTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_reschedule_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      booking_id UUID,
      course_id UUID,
      reason TEXT NOT NULL,
      current_schedule JSONB,
      preferred_slots TEXT[],
      meeting_type VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      student_notes TEXT,
      requested_for TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reschedule_student ON student_reschedule_requests(student_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reschedule_status ON student_reschedule_requests(status);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reschedule_booking ON student_reschedule_requests(booking_id);
  `);
}

export class RescheduleRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: RescheduleCreateInput, client?: PoolClient): Promise<RescheduleRequest> {
    const result = await query(
      this.pool,
      client,
      `
        INSERT INTO student_reschedule_requests (
          student_id,
          booking_id,
          course_id,
          reason,
          current_schedule,
          preferred_slots,
          meeting_type,
          student_notes,
          requested_for
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING ${RESCHEDULE_COLUMNS}
      `,
      [
        input.studentId,
        input.bookingId ?? null,
        input.courseId ?? null,
        input.reason,
        input.currentSchedule ?? null,
        input.preferredSlots ?? null,
        input.meetingType ?? null,
        input.studentNotes ?? null,
        input.requestedFor ?? null,
      ],
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<RescheduleRequest | null> {
    const result = await query(
      this.pool,
      client,
      `
        SELECT ${RESCHEDULE_COLUMNS}
        FROM student_reschedule_requests
        WHERE id = $1
      `,
      [id],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async listByStudent(
    studentId: string,
    options: { status?: RescheduleStatus; limit?: number; offset?: number } = {},
    client?: PoolClient,
  ): Promise<RescheduleRequest[]> {
    const filters: string[] = ['student_id = $1'];
    const params: any[] = [studentId];
    let idx = params.length + 1;

    if (options.status) {
      filters.push(`status = $${idx++}`);
      params.push(options.status);
    }

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    params.push(limit, offset);

    const result = await query(
      this.pool,
      client,
      `
        SELECT ${RESCHEDULE_COLUMNS}
        FROM student_reschedule_requests
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${idx++}
        OFFSET $${idx}
      `,
      params,
    );

    return result.rows.map(mapRow);
  }

  async update(
    id: string,
    updates: RescheduleUpdateInput,
    client?: PoolClient,
  ): Promise<RescheduleRequest | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (updates.reason !== undefined) {
      fields.push(`reason = $${idx++}`);
      params.push(updates.reason);
    }
    if (updates.preferredSlots !== undefined) {
      fields.push(`preferred_slots = $${idx++}`);
      params.push(updates.preferredSlots);
    }
    if (updates.meetingType !== undefined) {
      fields.push(`meeting_type = $${idx++}`);
      params.push(updates.meetingType);
    }
    if (updates.studentNotes !== undefined) {
      fields.push(`student_notes = $${idx++}`);
      params.push(updates.studentNotes);
    }
    if (updates.requestedFor !== undefined) {
      fields.push(`requested_for = $${idx++}`);
      params.push(updates.requestedFor);
    }
    if (updates.currentSchedule !== undefined) {
      fields.push(`current_schedule = $${idx++}`);
      params.push(updates.currentSchedule);
    }
    if (updates.bookingId !== undefined) {
      fields.push(`booking_id = $${idx++}`);
      params.push(updates.bookingId);
    }
    if (updates.courseId !== undefined) {
      fields.push(`course_id = $${idx++}`);
      params.push(updates.courseId);
    }

    if (!fields.length) {
      return this.findById(id, client);
    }

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query(
      this.pool,
      client,
      `
        UPDATE student_reschedule_requests
        SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING ${RESCHEDULE_COLUMNS}
      `,
      params,
    );

    if (!result.rows.length) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async updateStatus(
    id: string,
    statusUpdate: RescheduleStatusUpdate,
    client?: PoolClient,
  ): Promise<RescheduleRequest | null> {
    const result = await query(
      this.pool,
      client,
      `
        UPDATE student_reschedule_requests
        SET
          status = $1,
          admin_notes = COALESCE($2, admin_notes),
          resolved_at = COALESCE($3, resolved_at),
          updated_at = NOW()
        WHERE id = $4
        RETURNING ${RESCHEDULE_COLUMNS}
      `,
      [statusUpdate.status, statusUpdate.adminNotes ?? null, statusUpdate.resolvedAt ?? null, id],
    );

    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async list(
    options: { status?: RescheduleStatus; studentId?: string; courseId?: string; limit?: number; offset?: number },
    client?: PoolClient,
  ): Promise<RescheduleRequest[]> {
    const filters: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (options.studentId) {
      filters.push(`student_id = $${idx++}`);
      params.push(options.studentId);
    }
    if (options.courseId) {
      filters.push(`course_id = $${idx++}`);
      params.push(options.courseId);
    }
    if (options.status) {
      filters.push(`status = $${idx++}`);
      params.push(options.status);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    params.push(limit, offset);

    const result = await query(
      this.pool,
      client,
      `
        SELECT ${RESCHEDULE_COLUMNS}
        FROM student_reschedule_requests
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${idx++}
        OFFSET $${idx}
      `,
      params,
    );

    return result.rows.map(mapRow);
  }

  async count(
    options: { status?: RescheduleStatus; studentId?: string; courseId?: string },
    client?: PoolClient,
  ): Promise<number> {
    const filters: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (options.studentId) {
      filters.push(`student_id = $${idx++}`);
      params.push(options.studentId);
    }
    if (options.courseId) {
      filters.push(`course_id = $${idx++}`);
      params.push(options.courseId);
    }
    if (options.status) {
      filters.push(`status = $${idx++}`);
      params.push(options.status);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await query<{ total: number }>(
      this.pool,
      client,
      `
        SELECT COUNT(*)::int AS total
        FROM student_reschedule_requests
        ${whereClause}
      `,
      params,
    );

    return result.rows[0]?.total ?? 0;
  }
}

