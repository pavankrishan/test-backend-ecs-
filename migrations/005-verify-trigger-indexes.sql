-- ============================================================================
-- VERIFY TRIGGER INDEXES EXIST
-- Purpose: Ensure all required indexes for triggers are present
-- ============================================================================

-- Check indexes required by sync_course_progress_on_session_completion trigger
DO $$
DECLARE
  missing_indexes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Check index for COUNT(*) query
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_tutoring_sessions_student_course_completed'
  ) THEN
    missing_indexes := array_append(missing_indexes, 'idx_tutoring_sessions_student_course_completed');
  END IF;
  
  -- Check index for MAX(ended_at) query
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_tutoring_sessions_ended_at_completed'
  ) THEN
    missing_indexes := array_append(missing_indexes, 'idx_tutoring_sessions_ended_at_completed');
  END IF;
  
  -- Check index for student_course_purchases lookup
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_student_course_purchases_active_lookup'
  ) THEN
    missing_indexes := array_append(missing_indexes, 'idx_student_course_purchases_active_lookup');
  END IF;
  
  -- Check index for student_course_progress upsert
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_student_course_progress_student'
  ) THEN
    missing_indexes := array_append(missing_indexes, 'idx_student_course_progress_student');
  END IF;
  
  IF array_length(missing_indexes, 1) > 0 THEN
    RAISE EXCEPTION 'Missing required indexes: %', array_to_string(missing_indexes, ', ');
  END IF;
  
  RAISE NOTICE 'All required trigger indexes verified';
END $$;

