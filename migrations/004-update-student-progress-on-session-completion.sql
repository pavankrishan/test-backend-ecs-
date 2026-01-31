-- ============================================================================
-- UPDATE STUDENT_PROGRESS ON SESSION COMPLETION
-- ============================================================================
-- 
-- Purpose: Update student_progress table when tutoring_sessions are completed
--          so that course content screen shows correct completion status
--
-- Date: 2024
-- Status: Production-ready
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: UPDATE TRIGGER FUNCTION TO SYNC STUDENT_PROGRESS
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_course_progress_on_session_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_completed_count INT;
  v_total_lessons INT;
  v_percentage NUMERIC(5,2);
  v_last_completed TIMESTAMPTZ;
  v_next_session_id UUID;
  v_progress_id UUID;
  v_phase_id UUID;
  v_level_id UUID;
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
    
    -- ========================================================================
    -- UPDATE STUDENT_PROGRESS: Mark the first incomplete session as completed
    -- ========================================================================
    -- Find the first incomplete session in student_progress (ordered by phase, level, session)
    -- This ensures we always mark sessions sequentially in the correct order
    
    SELECT cs.id INTO v_next_session_id
    FROM course_sessions cs
    JOIN course_levels cl ON cs.level_id = cl.id
    JOIN course_phases cp ON cl.phase_id = cp.id
    WHERE cp.course_id = NEW.course_id
      AND NOT EXISTS (
        -- Exclude sessions that are already completed in student_progress
        SELECT 1 FROM student_progress sp
        WHERE sp.student_id = NEW.student_id
          AND sp.session_id = cs.id
          AND sp.status = 'completed'
      )
    ORDER BY cp.sequence ASC, cl.sequence ASC, cs.session_number ASC
    LIMIT 1;
    
    -- If we found a session to mark as completed, update student_progress
    IF v_next_session_id IS NOT NULL THEN
      -- Get or create progress record for this session
      SELECT id INTO v_progress_id
      FROM student_progress
      WHERE student_id = NEW.student_id
        AND session_id = v_next_session_id;
      
      -- Get phase and level info for the session
      SELECT cp.id, cl.id
      INTO v_phase_id, v_level_id
      FROM course_sessions cs
      JOIN course_levels cl ON cs.level_id = cl.id
      JOIN course_phases cp ON cl.phase_id = cp.id
      WHERE cs.id = v_next_session_id;
      
      -- If progress record exists, update it
      IF v_progress_id IS NOT NULL THEN
        UPDATE student_progress
        SET 
          status = 'completed',
          video_watched = true,
          sheet_previewed = true,
          quiz_completed = true,
          video_watched_at = COALESCE(video_watched_at, NOW()),
          sheet_previewed_at = COALESCE(sheet_previewed_at, NOW()),
          quiz_completed_at = COALESCE(quiz_completed_at, NOW()),
          updated_at = NOW()
        WHERE id = v_progress_id;
      ELSIF v_phase_id IS NOT NULL AND v_level_id IS NOT NULL THEN
        -- Create new progress record if it doesn't exist
        INSERT INTO student_progress (
          student_id,
          course_id,
          phase_id,
          level_id,
          session_id,
          status,
          is_unlocked,
          video_watched,
          sheet_previewed,
          quiz_completed,
          video_watched_at,
          sheet_previewed_at,
          quiz_completed_at,
          created_at,
          updated_at
        ) VALUES (
          NEW.student_id,
          NEW.course_id,
          v_phase_id,
          v_level_id,
          v_next_session_id,
          'completed',
          true,
          true,
          true,
          true,
          NOW(),
          NOW(),
          NOW(),
          NOW(),
          NOW()
        );
      END IF;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: UPDATE REVERT TRIGGER TO ALSO UPDATE STUDENT_PROGRESS
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_course_progress_on_session_revert()
RETURNS TRIGGER AS $$
DECLARE
  v_completed_count INT;
  v_total_lessons INT;
  v_percentage NUMERIC(5,2);
  v_last_completed TIMESTAMPTZ;
  v_last_completed_session_id UUID;
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
    
    -- ========================================================================
    -- REVERT STUDENT_PROGRESS: Unmark the last completed session
    -- ========================================================================
    -- Find the last completed session in student_progress (the one that should be reverted)
    -- This is the session that was marked as completed when this tutoring_session was completed
    
    SELECT sp.session_id INTO v_last_completed_session_id
    FROM student_progress sp
    JOIN course_sessions cs ON sp.session_id = cs.id
    JOIN course_levels cl ON cs.level_id = cl.id
    JOIN course_phases cp ON cl.phase_id = cp.id
    WHERE sp.student_id = OLD.student_id
      AND sp.course_id = OLD.course_id
      AND sp.status = 'completed'
    ORDER BY cp.sequence DESC, cl.sequence DESC, cs.session_number DESC
    LIMIT 1;
    
    -- If we found a session to revert, update student_progress
    IF v_last_completed_session_id IS NOT NULL THEN
      UPDATE student_progress
      SET 
        status = 'in_progress',
        video_watched = false,
        sheet_previewed = false,
        quiz_completed = false,
        video_watched_at = NULL,
        sheet_previewed_at = NULL,
        quiz_completed_at = NULL,
        updated_at = NOW()
      WHERE student_id = OLD.student_id
        AND session_id = v_last_completed_session_id;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERY (optional - run manually to verify)
-- ============================================================================
/*
-- Check if student_progress is being updated correctly
SELECT 
  ts.id as tutoring_session_id,
  ts.status,
  ts.student_confirmed,
  sp.id as progress_id,
  sp.session_id as course_session_id,
  sp.status as progress_status,
  cs.title as session_title
FROM tutoring_sessions ts
LEFT JOIN student_progress sp ON sp.student_id = ts.student_id 
  AND sp.course_id = ts.course_id
LEFT JOIN course_sessions cs ON cs.id = sp.session_id
WHERE ts.status = 'completed'
  AND ts.student_confirmed = true
ORDER BY ts.ended_at DESC
LIMIT 10;
*/

