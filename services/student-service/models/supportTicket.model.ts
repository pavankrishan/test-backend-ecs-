import type { Pool, PoolClient, QueryResult } from 'pg';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface SupportTicket {
  id: string;
  studentId: string;
  issueType: string;
  subject: string;
  description: string;
  email: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  metadata: Record<string, unknown> | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportTicketCreateInput {
  studentId: string;
  issueType: string;
  subject: string;
  description: string;
  email: string;
  priority?: SupportTicketPriority;
  metadata?: Record<string, unknown> | null;
}

const SUPPORT_TICKET_COLUMNS = `
  id,
  student_id AS "studentId",
  issue_type AS "issueType",
  subject,
  description,
  email,
  priority,
  status,
  metadata,
  resolved_at AS "resolvedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function mapRow(row: any): SupportTicket {
  return {
    id: row.id,
    studentId: row.studentId,
    issueType: row.issueType,
    subject: row.subject,
    description: row.description,
    email: row.email,
    priority: row.priority as SupportTicketPriority,
    status: row.status as SupportTicketStatus,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : row.metadata
        ? JSON.parse(row.metadata)
        : null,
    resolvedAt: row.resolvedAt ?? null,
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

export async function ensureSupportTicketTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_support_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      issue_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      email CITEXT NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      metadata JSONB,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_student ON student_support_tickets(student_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON student_support_tickets(status);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON student_support_tickets(created_at DESC);
  `);
}

export class SupportTicketRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: SupportTicketCreateInput, client?: PoolClient): Promise<SupportTicket> {
    const result = await execute(
      this.pool,
      client,
      `
        INSERT INTO student_support_tickets (
          student_id,
          issue_type,
          subject,
          description,
          email,
          priority,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING ${SUPPORT_TICKET_COLUMNS}
      `,
      [
        input.studentId,
        input.issueType,
        input.subject,
        input.description,
        input.email,
        input.priority ?? 'medium',
        input.metadata ?? null,
      ],
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<SupportTicket | null> {
    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${SUPPORT_TICKET_COLUMNS}
        FROM student_support_tickets
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
    options: { limit?: number; offset?: number } = {},
    client?: PoolClient,
  ): Promise<SupportTicket[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${SUPPORT_TICKET_COLUMNS}
        FROM student_support_tickets
        WHERE student_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [studentId, limit, offset],
    );

    return result.rows.map(mapRow);
  }
}


