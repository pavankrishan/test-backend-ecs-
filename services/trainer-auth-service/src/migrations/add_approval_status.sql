-- Migration: Add approval_status to trainers table
-- This allows admins to approve/reject trainer applications

-- Add approval_status column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trainers' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE trainers 
        ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected'));
        
        -- Create index for faster queries
        CREATE INDEX IF NOT EXISTS idx_trainers_approval_status ON trainers(approval_status);
        
        -- Add comment
        COMMENT ON COLUMN trainers.approval_status IS 'Trainer application approval status: pending, approved, or rejected';
    END IF;
END $$;

