-- Migration: Add claimed deal tracking to students table
-- Description: Track if a student has claimed their first-time user deal (₹1000 discount)

-- Add column to track if student has claimed their deal
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS has_claimed_deal BOOLEAN NOT NULL DEFAULT false;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_students_claimed_deal ON students(has_claimed_deal) WHERE has_claimed_deal = true;

-- Add comment to document the column
COMMENT ON COLUMN students.has_claimed_deal IS 'True if student has claimed their first-time user ₹1000 discount deal';
