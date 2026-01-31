import type { Pool, PoolClient, QueryResult } from 'pg';

export interface TrainerBankDetails {
  id: string;
  trainerId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName: string | null;
  accountType: 'savings' | 'current';
  isVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  verificationNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainerBankDetailsInput {
  trainerId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string | null;
  accountType?: 'savings' | 'current';
}

const BANK_DETAILS_COLUMNS = `
  id,
  trainer_id as "trainerId",
  account_holder_name as "accountHolderName",
  account_number as "accountNumber",
  ifsc_code as "ifscCode",
  bank_name as "bankName",
  branch_name as "branchName",
  account_type as "accountType",
  is_verified as "isVerified",
  verified_by as "verifiedBy",
  verified_at as "verifiedAt",
  verification_notes as "verificationNotes",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function mapRow(row: any): TrainerBankDetails {
  return {
    id: row.id,
    trainerId: row.trainerId,
    accountHolderName: row.accountHolderName,
    accountNumber: row.accountNumber,
    ifscCode: row.ifscCode,
    bankName: row.bankName,
    branchName: row.branchName,
    accountType: row.accountType,
    isVerified: row.isVerified,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    verificationNotes: row.verificationNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureTrainerBankDetailsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_bank_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trainer_id UUID NOT NULL UNIQUE REFERENCES trainers(id) ON DELETE CASCADE,
      account_holder_name VARCHAR(255) NOT NULL,
      account_number VARCHAR(50) NOT NULL,
      ifsc_code VARCHAR(11) NOT NULL,
      bank_name VARCHAR(255) NOT NULL,
      branch_name VARCHAR(255),
      account_type VARCHAR(20) NOT NULL DEFAULT 'savings' CHECK (account_type IN ('savings', 'current')),
      is_verified BOOLEAN NOT NULL DEFAULT false,
      verified_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
      verified_at TIMESTAMPTZ,
      verification_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_bank_details_trainer ON trainer_bank_details(trainer_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_trainer_bank_details_verified ON trainer_bank_details(is_verified) WHERE is_verified = true;
  `);
}

export class TrainerBankDetailsRepository {
  constructor(private readonly pool: Pool) {}

  async findByTrainerId(trainerId: string, client?: PoolClient): Promise<TrainerBankDetails | null> {
    const result = await (client || this.pool).query<TrainerBankDetails>(
      `SELECT ${BANK_DETAILS_COLUMNS}
       FROM trainer_bank_details
       WHERE trainer_id = $1`,
      [trainerId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async create(input: TrainerBankDetailsInput, client?: PoolClient): Promise<TrainerBankDetails> {
    const result = await (client || this.pool).query<TrainerBankDetails>(
      `INSERT INTO trainer_bank_details (
        trainer_id,
        account_holder_name,
        account_number,
        ifsc_code,
        bank_name,
        branch_name,
        account_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${BANK_DETAILS_COLUMNS}`,
      [
        input.trainerId,
        input.accountHolderName,
        input.accountNumber,
        input.ifscCode,
        input.bankName,
        input.branchName || null,
        input.accountType || 'savings',
      ]
    );

    return mapRow(result.rows[0]);
  }

  async update(
    trainerId: string,
    updates: Partial<Omit<TrainerBankDetailsInput, 'trainerId'>>,
    client?: PoolClient
  ): Promise<TrainerBankDetails> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.accountHolderName !== undefined) {
      fields.push(`account_holder_name = $${paramIndex++}`);
      values.push(updates.accountHolderName);
    }
    if (updates.accountNumber !== undefined) {
      fields.push(`account_number = $${paramIndex++}`);
      values.push(updates.accountNumber);
    }
    if (updates.ifscCode !== undefined) {
      fields.push(`ifsc_code = $${paramIndex++}`);
      values.push(updates.ifscCode);
    }
    if (updates.bankName !== undefined) {
      fields.push(`bank_name = $${paramIndex++}`);
      values.push(updates.bankName);
    }
    if (updates.branchName !== undefined) {
      fields.push(`branch_name = $${paramIndex++}`);
      values.push(updates.branchName);
    }
    if (updates.accountType !== undefined) {
      fields.push(`account_type = $${paramIndex++}`);
      values.push(updates.accountType);
    }

    if (fields.length === 0) {
      const existing = await this.findByTrainerId(trainerId, client);
      if (!existing) {
        throw new Error('Bank details not found');
      }
      return existing;
    }

    fields.push(`updated_at = NOW()`);
    values.push(trainerId);

    const result = await (client || this.pool).query<TrainerBankDetails>(
      `UPDATE trainer_bank_details
       SET ${fields.join(', ')}
       WHERE trainer_id = $${paramIndex}
       RETURNING ${BANK_DETAILS_COLUMNS}`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('Bank details not found');
    }

    return mapRow(result.rows[0]);
  }
}

