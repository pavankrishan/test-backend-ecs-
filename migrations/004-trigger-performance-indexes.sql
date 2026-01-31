-- ============================================================================
-- TRIGGER PERFORMANCE INDEXES
-- Purpose: Ensure all trigger queries execute in <100ms at scale
-- ============================================================================

BEGIN;

-- Index for student_course_purchases lookup in trigger
-- Used by: sync_course_progress_on_session_completion trigger
-- Query pattern: WHERE student_id = X AND course_id = Y AND is_active = true ORDER BY created_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_student_course_purchases_active_lookup 
  ON student_course_purchases(student_id, course_id, is_active, created_at DESC)
  WHERE is_active = true;

-- Composite index for course structure lookup in trigger (if tables exist)
-- Used by: sync_course_progress_on_session_completion trigger (fallback query)
-- Query pattern: JOIN course_sessions cs ON cs.level_id = cl.id JOIN course_levels cl ON cl.phase_id = cp.id WHERE cp.course_id = Y
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_phases') THEN
    CREATE INDEX IF NOT EXISTS idx_course_phases_course_id ON course_phases(course_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_levels') THEN
    CREATE INDEX IF NOT EXISTS idx_course_levels_phase_id ON course_levels(phase_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_sessions') THEN
    CREATE INDEX IF NOT EXISTS idx_course_sessions_level_id ON course_sessions(level_id);
  END IF;
END $$;

-- Verify critical index exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_student_course_purchases_active_lookup'
  ) THEN
    RAISE EXCEPTION 'Index idx_student_course_purchases_active_lookup creation failed';
  END IF;
  
  RAISE NOTICE 'All trigger performance indexes created successfully';
END $$;

COMMIT;

