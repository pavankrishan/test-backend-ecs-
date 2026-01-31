-- ============================================================================
-- CANONICAL PROGRESS MODEL MIGRATION
-- ============================================================================
-- 
-- Purpose: Establish tutoring_sessions as single source of truth for progress
--          Make student_course_progress a derived table (trigger-based)
--
-- Date: 2024
-- Status: Production-ready
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index for trigger queries (counting completed sessions)
CREATE INDEX IF NOT EXISTS idx_tutoring_sessions_student_course_status 
  ON tutoring_sessions(student_id, course_id, status) 
  WHERE status = 'completed';

-- Index for completed sessions with confirmation
CREATE INDEX IF NOT EXISTS idx_tutoring_sessions_student_course_completed 
  ON tutoring_sessions(student_id, course_id) 
  WHERE status = 'completed' AND student_confirmed = true;

-- Index for last_completed_at calculation
CREATE INDEX IF NOT EXISTS idx_tutoring_sessions_ended_at_completed 
  ON tutoring_sessions(student_id, course_id, ended_at) 
  WHERE status = 'completed' AND student_confirmed = true;

-- ============================================================================
-- STEP 2: CREATE TRIGGER FUNCTION FOR SESSION COMPLETION
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_course_progress_on_session_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_completed_count INT;
  v_total_lessons INT;
  v_percentage NUMERIC(5,2);
  v_last_completed TIMESTAMPTZ;
BEGIN
  -- Only process if session is completed and confirmed
  IF NEW.status = 'completed' 
     AND NEW.student_confirmed = true 
     AND NEW.course_id IS NOT NULL 
     AND NEW.student_id IS NOT NULL THEN
    
    -- Count completed sessions for this student/course
    SELECT COUNT(*)
    INTO v_completed_count
    FROM tutoring_sessions
    WHERE student_id = NEW.student_id
      AND course_id = NEW.course_id
      AND status = 'completed'
      AND student_confirmed = true;
    
    -- Get total lessons from purchase_tier (preferred) or course structure
    SELECT COALESCE(
      (SELECT purchase_tier 
       FROM student_course_purchases 
       WHERE student_id = NEW.student_id 
         AND course_id = NEW.course_id 
         AND is_active = true 
       ORDER BY created_at DESC 
       LIMIT 1),
      (SELECT COUNT(*) 
       FROM course_sessions cs
       JOIN course_levels cl ON cs.level_id = cl.id
       JOIN course_phases cp ON cl.phase_id = cp.id
       WHERE cp.course_id = NEW.course_id)
    ) INTO v_total_lessons;
    
    -- Ensure total_lessons is at least 1 to avoid division by zero
    IF v_total_lessons IS NULL OR v_total_lessons = 0 THEN
      v_total_lessons := 1;
    END IF;
    
    -- Calculate percentage (0-100)
    v_percentage := LEAST(100, ROUND(
      (v_completed_count::NUMERIC / v_total_lessons::NUMERIC) * 100, 
      2
    ));
    
    -- Get last completed timestamp
    SELECT MAX(ended_at)
    INTO v_last_completed
    FROM tutoring_sessions
    WHERE student_id = NEW.student_id
      AND course_id = NEW.course_id
      AND status = 'completed'
      AND student_confirmed = true;
    
    -- Upsert progress (create or update)
    INSERT INTO student_course_progress (
      student_id,
      course_id,
      completed_lessons,
      total_lessons,
      percentage,
      last_completed_at,
      updated_at
    ) VALUES (
      NEW.student_id,
      NEW.course_id,
      v_completed_count,
      v_total_lessons,
      v_percentage,
      v_last_completed,
      NOW()
    )
    ON CONFLICT (student_id, course_id) DO UPDATE SET
      completed_lessons = EXCLUDED.completed_lessons,
      total_lessons = EXCLUDED.total_lessons,
      percentage = EXCLUDED.percentage,
      last_completed_at = EXCLUDED.last_completed_at,
      updated_at = NOW();
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: CREATE TRIGGER FUNCTION FOR SESSION REVERT
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_course_progress_on_session_revert()
RETURNS TRIGGER AS $$
DECLARE
  v_completed_count INT;
  v_total_lessons INT;
  v_percentage NUMERIC(5,2);
  v_last_completed TIMESTAMPTZ;
BEGIN
  -- Only process if session was completed and is now not completed
  IF OLD.status = 'completed' 
     AND (NEW.status != 'completed' OR NEW.student_confirmed = false) 
     AND OLD.course_id IS NOT NULL 
     AND OLD.student_id IS NOT NULL THEN
    
    -- Recalculate completed count (same logic as completion trigger)
    SELECT COUNT(*)
    INTO v_completed_count
    FROM tutoring_sessions
    WHERE student_id = OLD.student_id
      AND course_id = OLD.course_id
      AND status = 'completed'
      AND student_confirmed = true;
    
    -- Get total lessons (same as completion trigger)
    SELECT COALESCE(
      (SELECT purchase_tier 
       FROM student_course_purchases 
       WHERE student_id = OLD.student_id 
         AND course_id = OLD.course_id 
         AND is_active = true 
       ORDER BY created_at DESC 
       LIMIT 1),
      (SELECT COUNT(*) 
       FROM course_sessions cs
       JOIN course_levels cl ON cs.level_id = cl.id
       JOIN course_phases cp ON cl.phase_id = cp.id
       WHERE cp.course_id = OLD.course_id)
    ) INTO v_total_lessons;
    
    -- Ensure total_lessons is at least 1
    IF v_total_lessons IS NULL OR v_total_lessons = 0 THEN
      v_total_lessons := 1;
    END IF;
    
    -- Calculate percentage
    v_percentage := LEAST(100, ROUND(
      (v_completed_count::NUMERIC / v_total_lessons::NUMERIC) * 100, 
      2
    ));
    
    -- Get last completed timestamp
    SELECT MAX(ended_at)
    INTO v_last_completed
    FROM tutoring_sessions
    WHERE student_id = OLD.student_id
      AND course_id = OLD.course_id
      AND status = 'completed'
      AND student_confirmed = true;
    
    -- Update progress (only if record exists)
    UPDATE student_course_progress
    SET
      completed_lessons = v_completed_count,
      total_lessons = v_total_lessons,
      percentage = v_percentage,
      last_completed_at = v_last_completed,
      updated_at = NOW()
    WHERE student_id = OLD.student_id
      AND course_id = OLD.course_id;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: CREATE TRIGGERS
-- ============================================================================

-- Drop existing triggers if they exist (for idempotency)
DROP TRIGGER IF EXISTS trigger_sync_course_progress ON tutoring_sessions;
DROP TRIGGER IF EXISTS trigger_sync_course_progress_revert ON tutoring_sessions;

-- Trigger for session completion (INSERT and UPDATE)
CREATE TRIGGER trigger_sync_course_progress
  AFTER INSERT OR UPDATE OF status, student_confirmed, course_id
  ON tutoring_sessions
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION sync_course_progress_on_session_completion();

-- Trigger for session revert (when status changes from completed to something else)
CREATE TRIGGER trigger_sync_course_progress_revert
  AFTER UPDATE OF status, student_confirmed
  ON tutoring_sessions
  FOR EACH ROW
  WHEN (OLD.status = 'completed' AND (NEW.status != 'completed' OR NEW.student_confirmed = false))
  EXECUTE FUNCTION sync_course_progress_on_session_revert();

-- ============================================================================
-- STEP 5: BACKFILL EXISTING DATA
-- ============================================================================
-- Recalculate all progress from tutoring_sessions to ensure consistency

INSERT INTO student_course_progress (
  student_id,
  course_id,
  completed_lessons,
  total_lessons,
  percentage,
  last_completed_at,
  updated_at
)
SELECT 
  ts.student_id,
  ts.course_id,
  COUNT(DISTINCT ts.id) FILTER (
    WHERE ts.status = 'completed' AND ts.student_confirmed = true
  ) as completed_lessons,
  COALESCE(
    (SELECT purchase_tier 
     FROM student_course_purchases scp
     WHERE scp.student_id = ts.student_id 
       AND scp.course_id = ts.course_id 
       AND scp.is_active = true 
     ORDER BY scp.created_at DESC 
     LIMIT 1),
    (SELECT COUNT(*) 
     FROM course_sessions cs
     JOIN course_levels cl ON cs.level_id = cl.id
     JOIN course_phases cp ON cl.phase_id = cp.id
     WHERE cp.course_id = ts.course_id),
    1  -- Fallback to 1 to avoid division by zero
  ) as total_lessons,
  -- Calculate percentage
  LEAST(100, ROUND(
    (COUNT(DISTINCT ts.id) FILTER (
      WHERE ts.status = 'completed' AND ts.student_confirmed = true
    )::NUMERIC / 
    COALESCE(
      (SELECT purchase_tier 
       FROM student_course_purchases scp
       WHERE scp.student_id = ts.student_id 
         AND scp.course_id = ts.course_id 
         AND scp.is_active = true 
       ORDER BY scp.created_at DESC 
       LIMIT 1),
      (SELECT COUNT(*) 
       FROM course_sessions cs
       JOIN course_levels cl ON cs.level_id = cl.id
       JOIN course_phases cp ON cl.phase_id = cp.id
       WHERE cp.course_id = ts.course_id),
      1
    )::NUMERIC) * 100, 
    2
  )) as percentage,
  MAX(ts.ended_at) FILTER (
    WHERE ts.status = 'completed' AND ts.student_confirmed = true
  ) as last_completed_at,
  NOW() as updated_at
FROM tutoring_sessions ts
WHERE ts.course_id IS NOT NULL
  AND ts.student_id IS NOT NULL
GROUP BY ts.student_id, ts.course_id
ON CONFLICT (student_id, course_id) DO UPDATE SET
  completed_lessons = EXCLUDED.completed_lessons,
  total_lessons = EXCLUDED.total_lessons,
  percentage = EXCLUDED.percentage,
  last_completed_at = EXCLUDED.last_completed_at,
  updated_at = NOW();

-- ============================================================================
-- STEP 6: VALIDATION QUERY (for verification)
-- ============================================================================
-- Run this after migration to verify consistency

-- Uncomment to run validation:
/*
SELECT 
  scp.student_id,
  scp.course_id,
  scp.completed_lessons as progress_table_count,
  (SELECT COUNT(*) 
   FROM tutoring_sessions ts
   WHERE ts.student_id = scp.student_id
     AND ts.course_id = scp.course_id
     AND ts.status = 'completed'
     AND ts.student_confirmed = true) as actual_completed_count,
  scp.percentage,
  CASE 
    WHEN scp.completed_lessons = (SELECT COUNT(*) 
                                 FROM tutoring_sessions ts
                                 WHERE ts.student_id = scp.student_id
                                   AND ts.course_id = scp.course_id
                                   AND ts.status = 'completed'
                                   AND ts.student_confirmed = true)
    THEN '✅ CONSISTENT'
    ELSE '❌ DRIFT DETECTED'
  END as status
FROM student_course_progress scp
ORDER BY scp.student_id, scp.course_id;
*/

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- To rollback, run:
/*
BEGIN;

DROP TRIGGER IF EXISTS trigger_sync_course_progress ON tutoring_sessions;
DROP TRIGGER IF EXISTS trigger_sync_course_progress_revert ON tutoring_sessions;
DROP FUNCTION IF EXISTS sync_course_progress_on_session_completion();
DROP FUNCTION IF EXISTS sync_course_progress_on_session_revert();

-- Note: Indexes are kept for performance (no harm in keeping them)
-- Note: student_course_progress table is kept (data preserved)

COMMIT;
*/


