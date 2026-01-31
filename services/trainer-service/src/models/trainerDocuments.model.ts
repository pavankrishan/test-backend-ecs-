import type { Pool, PoolClient, QueryResult } from 'pg';

export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'resubmitted';

export interface TrainerDocument {
  id: string;
  trainerId: string;
  documentType: string;
  fileUrl: string;
  status: DocumentStatus;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewerId: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainerDocumentInput {
  trainerId: string;
  documentType: string;
  fileUrl: string;
  metadata?: Record<string, unknown> | null;
}

export interface TrainerDocumentUpdateInput {
  status?: DocumentStatus;
  reviewerId?: string | null;
  rejectionReason?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Helper to get status column name (handles both 'status' and 'verification_status')
let statusColumnName: string | null = null;

async function getStatusColumnName(pool: Pool): Promise<string> {
  if (statusColumnName) {
    return statusColumnName;
  }
  
  // Check which column exists
  const result = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'trainer_documents' 
    AND column_name IN ('status', 'verification_status')
    LIMIT 1
  `);
  
  if (result.rows.length > 0 && result.rows[0].column_name) {
    statusColumnName = result.rows[0].column_name as string;
  } else {
    // Default to 'status' if table doesn't exist yet
    statusColumnName = 'status';
  }
  
  return statusColumnName;
}

function getDocumentColumns(statusCol: string): string {
  return `
  id,
  trainer_id AS "trainerId",
  document_type AS "documentType",
  file_url AS "fileUrl",
  ${statusCol} AS status,
  submitted_at AS "submittedAt",
  reviewed_at AS "reviewedAt",
  reviewer_id AS "reviewerId",
  rejection_reason AS "rejectionReason",
  metadata,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
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

function mapRow(row: any): TrainerDocument {
  return {
    id: row.id,
    trainerId: row.trainerId,
    documentType: row.documentType,
    fileUrl: row.fileUrl,
    status: row.status as DocumentStatus,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt ?? null,
    reviewerId: row.reviewerId ?? null,
    rejectionReason: row.rejectionReason ?? null,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : row.metadata
        ? JSON.parse(row.metadata)
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureTrainerDocumentsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL,
      document_type VARCHAR(100) NOT NULL,
      file_url TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewer_id UUID,
      rejection_reason TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_documents_trainer ON trainer_documents(trainer_id);
  `);
  
  // Check which status column exists before creating index
  const statusCol = await getStatusColumnName(pool);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_documents_status ON trainer_documents(${statusCol});
  `);
}

export class TrainerDocumentsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: TrainerDocumentInput, client?: PoolClient): Promise<TrainerDocument> {
    const statusCol = await getStatusColumnName(this.pool);
    const result = await execute(
      this.pool,
      client,
      `
        INSERT INTO trainer_documents (
          trainer_id,
          document_type,
          file_url,
          metadata
        ) VALUES ($1,$2,$3,$4)
        RETURNING ${getDocumentColumns(statusCol)}
      `,
      [input.trainerId, input.documentType, input.fileUrl, input.metadata ?? null],
    );

    return mapRow(result.rows[0]);
  }

  async update(id: string, updates: TrainerDocumentUpdateInput, client?: PoolClient): Promise<TrainerDocument | null> {
    const statusCol = await getStatusColumnName(this.pool);
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`${statusCol} = $${idx++}`);
      params.push(updates.status);
      if (updates.status === 'approved' || updates.status === 'rejected') {
        fields.push(`reviewed_at = NOW()`);
      }
    }
    if (updates.reviewerId !== undefined) {
      fields.push(`reviewer_id = $${idx++}`);
      params.push(updates.reviewerId);
    }
    if (updates.rejectionReason !== undefined) {
      fields.push(`rejection_reason = $${idx++}`);
      params.push(updates.rejectionReason);
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${idx++}`);
      params.push(updates.metadata);
    }

    if (!fields.length) {
      return this.findById(id, client);
    }

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const result = await execute(
      this.pool,
      client,
      `
        UPDATE trainer_documents
        SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING ${getDocumentColumns(statusCol)}
      `,
      params,
    );

    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<TrainerDocument | null> {
    const statusCol = await getStatusColumnName(this.pool);
    const result = await execute(
      this.pool,
      client,
      `SELECT ${getDocumentColumns(statusCol)} FROM trainer_documents WHERE id = $1`,
      [id],
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async listByTrainer(trainerId: string, client?: PoolClient): Promise<TrainerDocument[]> {
    const statusCol = await getStatusColumnName(this.pool);
    const result = await execute(
      this.pool,
      client,
      `
        SELECT ${getDocumentColumns(statusCol)}
        FROM trainer_documents
        WHERE trainer_id = $1
        ORDER BY submitted_at DESC
      `,
      [trainerId],
    );

    return result.rows.map(mapRow);
  }

  async listPending(limit = 50): Promise<TrainerDocument[]> {
    const statusCol = await getStatusColumnName(this.pool);
    const result = await this.pool.query(
      `
        SELECT ${getDocumentColumns(statusCol)}
        FROM trainer_documents
        WHERE ${statusCol} = 'pending'
        ORDER BY submitted_at ASC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map(mapRow);
  }
}

