-- Migration: Add additional production indexes (Phase 2)
-- Production Hardening - Critical Performance Indexes
-- 
-- These indexes address the specific issues identified in production review:
-- 1. Purchase flow performance
-- 2. Allocation flow performance
-- 3. Session progress calculation performance
-- 4. Event processing performance

-- ============================================================================
-- STUDENT_COURSE_PURCHASES TABLE INDEXES
-- ============================================================================

-- UNIQUE index for active purchases (prevents duplicates, enables fast lookups)
-- This is CRITICAL for purchase-worker idempotency
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_purchase 
ON student_course_purchases(student_id, course_id) 
WHERE is_active = true;

COMMENT ON INDEX unique_active_purchase IS 
  'Ensures only one active purchase per student per course. Critical for idempotency.';

-- Composite index for purchase lookups with status filter
CREATE INDEX IF NOT EXISTS idx_purchases_student_course_active 
ON student_course_purchases(student_id, course_id, is_active) 
WHERE is_active = true;

COMMENT ON INDEX idx_purchases_student_course_active IS 
  'Optimizes purchase lookups filtering by student, course, and active status';

-- ============================================================================
-- TRAINER_ALLOCATIONS TABLE INDEXES
-- ============================================================================

-- Composite index for allocation lookups (student + course + status)
-- Query pattern: WHERE student_id = $1 AND course_id = $2 AND status IN ('approved', 'active')
CREATE INDEX IF NOT EXISTS idx_allocations_student_course_status 
ON trainer_allocations(student_id, course_id, status);

COMMENT ON INDEX idx_allocations_student_course_status IS 
  'Optimizes allocation lookups filtering by student, course, and status';

-- Composite index for trainer active allocations
-- Query pattern: WHERE trainer_id = $1 AND status IN ('approved', 'active')
CREATE INDEX IF NOT EXISTS idx_allocations_trainer_status_active 
ON trainer_allocations(trainer_id, status) 
WHERE status IN ('approved', 'active');

COMMENT ON INDEX idx_allocations_trainer_status_active IS 
  'Optimizes queries for trainer active allocations';

-- ============================================================================
-- TUTORING_SESSIONS TABLE INDEXES
-- ============================================================================

-- Composite index for allocation-based session queries
-- Query pattern: WHERE allocation_id = $1 AND status = $2
CREATE INDEX IF NOT EXISTS idx_sessions_allocation_status 
ON tutoring_sessions(allocation_id, status);

COMMENT ON INDEX idx_sessions_allocation_status IS 
  'Optimizes session queries filtering by allocation and status';

-- Composite index for session progress calculation (CRITICAL for performance)
-- Query pattern: WHERE student_id = $1 AND course_id = $2 AND status = 'completed' AND student_confirmed = true
CREATE INDEX IF NOT EXISTS idx_sessions_completed_count 
ON tutoring_sessions(student_id, course_id, status, student_confirmed) 
WHERE status = 'completed' AND student_confirmed = true;

COMMENT ON INDEX idx_sessions_completed_count IS 
  'Optimizes progress calculation queries. Critical for removing DB trigger blocking.';

-- Composite index for student sessions with date/time ordering
-- Query pattern: WHERE student_id = $1 AND status = $2 ORDER BY scheduled_date, scheduled_time
CREATE INDEX IF NOT EXISTS idx_sessions_student_status_date_time 
ON tutoring_sessions(student_id, status, scheduled_date, scheduled_time);

COMMENT ON INDEX idx_sessions_student_status_date_time IS 
  'Optimizes student session listing queries with date/time ordering';

-- Composite index for trainer sessions with date/time ordering
-- Query pattern: WHERE trainer_id = $1 AND status = $2 ORDER BY scheduled_date, scheduled_time
CREATE INDEX IF NOT EXISTS idx_sessions_trainer_status_date_time 
ON tutoring_sessions(trainer_id, status, scheduled_date, scheduled_time);

COMMENT ON INDEX idx_sessions_trainer_status_date_time IS 
  'Optimizes trainer session listing queries with date/time ordering';

-- ============================================================================
-- STUDENT_COURSE_PROGRESS TABLE INDEXES
-- ============================================================================

-- Composite index for progress lookups
-- Query pattern: WHERE student_id = $1 AND course_id = $2
CREATE INDEX IF NOT EXISTS idx_progress_student_course 
ON student_course_progress(student_id, course_id);

COMMENT ON INDEX idx_progress_student_course IS 
  'Optimizes progress lookups by student and course';

-- ============================================================================
-- PROCESSED_EVENTS TABLE INDEXES
-- ============================================================================

-- Composite index for event idempotency checks
-- Query pattern: WHERE correlation_id = $1 AND event_type = $2
CREATE INDEX IF NOT EXISTS idx_processed_events_correlation_type 
ON processed_events(correlation_id, event_type);

COMMENT ON INDEX idx_processed_events_correlation_type IS 
  'Optimizes event idempotency checks by correlation ID and event type';

-- Composite index for event source and type queries
-- Query pattern: WHERE source = $1 AND event_type = $2 ORDER BY processed_at DESC
CREATE INDEX IF NOT EXISTS idx_processed_events_source_type 
ON processed_events(source, event_type, processed_at DESC);

COMMENT ON INDEX idx_processed_events_source_type IS 
  'Optimizes event processing queries by source service and event type';

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
    'unique_active_purchase',
    'idx_purchases_student_course_active',
    'idx_allocations_student_course_status',
    'idx_allocations_trainer_status_active',
    'idx_sessions_allocation_status',
    'idx_sessions_completed_count',
    'idx_sessions_student_status_date_time',
    'idx_sessions_trainer_status_date_time',
    'idx_progress_student_course',
    'idx_processed_events_correlation_type',
    'idx_processed_events_source_type'
  );
  
  IF index_count = 11 THEN
    RAISE NOTICE '✅ All Phase 2 production indexes created successfully';
  ELSE
    RAISE WARNING '⚠️  Only % of 11 indexes were created', index_count;
  END IF;
END $$;
