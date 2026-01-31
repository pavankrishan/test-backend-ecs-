-- ============================================================================
-- Only one ACTIVE journey per session (enforced at DB level)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_one_active_per_session
ON journeys(session_id)
WHERE status = 'active';

COMMENT ON INDEX idx_journeys_one_active_per_session IS 'Ensures at most one active journey per session.';
