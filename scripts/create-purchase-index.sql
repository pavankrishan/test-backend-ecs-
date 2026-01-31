-- Create unique_active_purchase index for purchase idempotency
-- This index ensures no duplicate active purchases per student per course
-- 
-- Usage:
--   Option 1: Run via psql
--     psql -U postgres -d kodingcaravan -f scripts/create-purchase-index.sql
--   
--   Option 2: Run via any SQL client (pgAdmin, DBeaver, etc.)
--     Copy and paste this SQL into your SQL client
--
--   Option 3: Run via Docker (if database is in Docker)
--     docker exec -i <postgres-container> psql -U postgres -d kodingcaravan < scripts/create-purchase-index.sql

-- Check if index already exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'student_course_purchases'
      AND indexname = 'unique_active_purchase'
  ) THEN
    RAISE NOTICE 'Index unique_active_purchase already exists - no action needed';
  ELSE
    -- Create the index
    CREATE UNIQUE INDEX unique_active_purchase 
    ON student_course_purchases(student_id, course_id) 
    WHERE is_active = true;
    
    -- Add comment
    COMMENT ON INDEX unique_active_purchase IS 
      'Ensures purchase creation is idempotent (same student cannot have duplicate active purchases for same course)';
    
    RAISE NOTICE 'Index unique_active_purchase created successfully';
  END IF;
END $$;

-- Verify index was created
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'student_course_purchases'
  AND indexname = 'unique_active_purchase';

