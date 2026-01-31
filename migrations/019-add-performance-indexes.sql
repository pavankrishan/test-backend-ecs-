-- Migration: Add performance indexes for high-traffic tables
-- Phase 2: Production Hardening - Database Indexes
-- 
-- These indexes are based on actual query patterns in the codebase
-- DO NOT add speculative indexes - only indexes proven to be needed

-- ============================================================================
-- PAYMENTS TABLE INDEXES
-- ============================================================================

-- Composite index for common payment queries: filter by student, status, order by date
-- Query pattern: WHERE student_id = $1 AND status = $2 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_payments_student_status_created 
ON payments(student_id, status, created_at DESC);

COMMENT ON INDEX idx_payments_student_status_created IS 
  'Optimizes payment queries filtering by student and status, ordered by creation date';

-- ============================================================================
-- TUTORING_SESSIONS TABLE INDEXES
-- ============================================================================

-- Composite index for upcoming sessions query (student-service aggregation)
-- Query pattern: WHERE student_id = $1 AND status = ANY($2::text[]) 
--                AND scheduled_date >= ... ORDER BY scheduled_date ASC, scheduled_time ASC
CREATE INDEX IF NOT EXISTS idx_sessions_student_status_date_time 
ON tutoring_sessions(student_id, status, scheduled_date ASC, scheduled_time ASC);

COMMENT ON INDEX idx_sessions_student_status_date_time IS 
  'Optimizes upcoming sessions queries for students with status filter and date/time ordering';

-- Composite index for trainer calendar queries
-- Query pattern: WHERE trainer_id = $1 AND scheduled_date = $2
CREATE INDEX IF NOT EXISTS idx_sessions_trainer_date 
ON tutoring_sessions(trainer_id, scheduled_date);

COMMENT ON INDEX idx_sessions_trainer_date IS 
  'Optimizes trainer calendar queries filtering by trainer and scheduled date';

-- Composite index for trainer status queries (admin-service)
-- Query pattern: WHERE trainer_id = $1 AND status = 'completed'
CREATE INDEX IF NOT EXISTS idx_sessions_trainer_status 
ON tutoring_sessions(trainer_id, status);

COMMENT ON INDEX idx_sessions_trainer_status IS 
  'Optimizes queries filtering sessions by trainer and status';

-- ============================================================================
-- TRAINER_ALLOCATIONS TABLE INDEXES
-- ============================================================================

-- Composite index for active allocations query (student-service)
-- Query pattern: WHERE student_id = $1 AND status IN ('approved', 'active') 
--                AND course_id IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_allocations_student_status_course 
ON trainer_allocations(student_id, status, course_id);

COMMENT ON INDEX idx_allocations_student_status_course IS 
  'Optimizes queries for active student allocations with course filter';

-- Composite index for trainer assignments query
-- Query pattern: WHERE trainer_id = $1 AND status IN ('approved', 'active')
CREATE INDEX IF NOT EXISTS idx_allocations_trainer_status 
ON trainer_allocations(trainer_id, status);

COMMENT ON INDEX idx_allocations_trainer_status IS 
  'Optimizes queries for trainer assignments filtering by trainer and status';

-- ============================================================================
-- STUDENT_COURSE_PURCHASES TABLE INDEXES
-- ============================================================================

-- Composite index for listing purchases by student ordered by date
-- Query pattern: WHERE student_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_purchases_student_created 
ON student_course_purchases(student_id, created_at DESC);

COMMENT ON INDEX idx_purchases_student_created IS 
  'Optimizes purchase listing queries ordered by creation date';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify indexes were created
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE indexname IN (
    'idx_payments_student_status_created',
    'idx_sessions_student_status_date_time',
    'idx_sessions_trainer_date',
    'idx_sessions_trainer_status',
    'idx_allocations_student_status_course',
    'idx_allocations_trainer_status',
    'idx_purchases_student_created'
  );
  
  IF index_count = 7 THEN
    RAISE NOTICE '✅ All performance indexes created successfully';
  ELSE
    RAISE WARNING '⚠️  Only % of 7 indexes were created', index_count;
  END IF;
END $$;
