-- ============================================================================
-- UNBOUNDED DATA MANAGEMENT INDEXES
-- Purpose: Enable efficient archival and cleanup of unbounded tables
-- ============================================================================

BEGIN;

-- Indexes for analytics_events archival
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at 
  ON analytics_events(created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_archive 
  ON analytics_events(created_at) 
  WHERE created_at < NOW() - INTERVAL '90 days';

-- Indexes for notifications cleanup
CREATE INDEX IF NOT EXISTS idx_notifications_cleanup 
  ON notifications(read, created_at) 
  WHERE read = true;

CREATE INDEX IF NOT EXISTS idx_notifications_user_read 
  ON notifications(user_id, read, created_at);

COMMIT;

