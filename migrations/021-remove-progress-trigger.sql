-- Migration: Remove progress calculation database trigger
-- Production Hardening - Move progress calculation to async worker
-- 
-- This migration removes the synchronous database trigger that calculates
-- progress on session completion. Progress calculation is moved to progress-worker
-- to prevent blocking session confirmation requests under high load.
--
-- IMPORTANT: Deploy progress-worker BEFORE running this migration
-- The progress-worker must be running to handle SESSION_COMPLETED events

-- ============================================================================
-- REMOVE TRIGGERS
-- ============================================================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_sync_course_progress_on_completion ON tutoring_sessions;
DROP TRIGGER IF EXISTS trigger_sync_course_progress_revert ON tutoring_sessions;

-- ============================================================================
-- REMOVE FUNCTIONS
-- ============================================================================

-- Drop functions (triggers must be dropped first)
DROP FUNCTION IF EXISTS sync_course_progress_on_session_completion();
DROP FUNCTION IF EXISTS sync_course_progress_on_revert();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify triggers and functions were removed
DO $$
DECLARE
  trigger_count INTEGER;
  function_count INTEGER;
BEGIN
  -- Check triggers
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgname IN (
    'trigger_sync_course_progress_on_completion',
    'trigger_sync_course_progress_revert'
  );
  
  -- Check functions
  SELECT COUNT(*) INTO function_count
  FROM pg_proc
  WHERE proname IN (
    'sync_course_progress_on_session_completion',
    'sync_course_progress_on_revert'
  );
  
  IF trigger_count = 0 AND function_count = 0 THEN
    RAISE NOTICE '✅ Progress calculation triggers and functions removed successfully';
    RAISE NOTICE '⚠️  Ensure progress-worker is running to handle SESSION_COMPLETED events';
  ELSE
    RAISE WARNING '⚠️  Some triggers or functions still exist. trigger_count: %, function_count: %', 
      trigger_count, function_count;
  END IF;
END $$;

-- ============================================================================
-- NOTES
-- ============================================================================

-- After this migration:
-- 1. Progress calculation is handled by progress-worker (async)
-- 2. Session confirmation is no longer blocked by progress calculation
-- 3. Progress updates happen via SESSION_COMPLETED event → progress-worker
-- 4. Progress updates are eventually consistent (acceptable trade-off)
