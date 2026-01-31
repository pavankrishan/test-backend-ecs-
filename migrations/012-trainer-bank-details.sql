-- ============================================================================
-- TRAINER BANK DETAILS TABLE
-- ============================================================================
-- Stores bank account information for monthly payroll
-- Required after trainer is allocated to students
CREATE TABLE IF NOT EXISTS trainer_bank_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL UNIQUE REFERENCES trainers(id) ON DELETE CASCADE,
    account_holder_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    ifsc_code VARCHAR(11) NOT NULL, -- IFSC code format: 4 letters + 0 + 6 digits
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

CREATE INDEX IF NOT EXISTS idx_trainer_bank_details_trainer ON trainer_bank_details(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_bank_details_verified ON trainer_bank_details(is_verified) WHERE is_verified = true;

