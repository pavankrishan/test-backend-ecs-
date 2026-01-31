-- Migration: Add auth_provider field to support Google auth transition
-- Purpose: Track authentication method (native vs web) for smooth migration
-- Date: 2024

-- Add auth_provider column to students table
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT NULL;

-- Add auth_provider column to trainers table  
ALTER TABLE trainers
ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT NULL;

-- Create index for faster lookups by auth_provider
CREATE INDEX IF NOT EXISTS idx_students_auth_provider ON students(auth_provider);
CREATE INDEX IF NOT EXISTS idx_trainers_auth_provider ON trainers(auth_provider);

-- Update existing records with Google ID to mark as google_native (temporary)
-- This assumes existing Google auth users came from native flow
UPDATE students 
SET auth_provider = 'google_native' 
WHERE google_id IS NOT NULL AND auth_provider IS NULL;

UPDATE trainers 
SET auth_provider = 'google_native' 
WHERE google_id IS NOT NULL AND auth_provider IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN students.auth_provider IS 'Authentication provider: google_native (temporary), google_web (final), email, phone, or NULL';
COMMENT ON COLUMN trainers.auth_provider IS 'Authentication provider: google_native (temporary), google_web (final), email, phone, or NULL';

