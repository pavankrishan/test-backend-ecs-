-- Migration: Add auth_provider column to trainers table
-- This fixes the "column auth_provider does not exist" error

-- Add auth_provider column if it doesn't exist
DO $$
BEGIN
    -- Add column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trainers' AND column_name = 'auth_provider'
    ) THEN
        ALTER TABLE trainers 
        ADD COLUMN auth_provider VARCHAR(20) DEFAULT NULL;
        
        RAISE NOTICE 'Column auth_provider added to trainers table';
    ELSE
        RAISE NOTICE 'Column auth_provider already exists';
    END IF;
    
    -- Add constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'trainers_auth_provider_check'
    ) THEN
        ALTER TABLE trainers 
        ADD CONSTRAINT trainers_auth_provider_check 
        CHECK (auth_provider IS NULL OR auth_provider IN ('email', 'google', 'phone'));
        
        RAISE NOTICE 'Constraint trainers_auth_provider_check added';
    ELSE
        RAISE NOTICE 'Constraint trainers_auth_provider_check already exists';
    END IF;
END $$;

