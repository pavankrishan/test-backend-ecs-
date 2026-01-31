-- Migration: Create processed_events table for event idempotency
-- This table ensures events are only processed once, even if retried

CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  correlation_id UUID NOT NULL,
  payload JSONB NOT NULL,
  source VARCHAR(100) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for idempotency checks (correlationId + eventType)
CREATE INDEX IF NOT EXISTS idx_processed_events_correlation_type 
  ON processed_events(correlation_id, event_type);

-- Index for source (service) queries
CREATE INDEX IF NOT EXISTS idx_processed_events_source 
  ON processed_events(source, processed_at);

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_processed_events_type 
  ON processed_events(event_type, processed_at);

-- Unique constraint for idempotency (correlationId + eventType)
-- This ensures same event type for same correlation is only processed once
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_events_idempotency 
  ON processed_events(correlation_id, event_type);

COMMENT ON TABLE processed_events IS 'Tracks processed events for idempotency guarantees';
COMMENT ON COLUMN processed_events.event_id IS 'Unique event ID (UUID)';
COMMENT ON COLUMN processed_events.correlation_id IS 'Correlation ID (payment ID, allocation ID, etc.)';
COMMENT ON COLUMN processed_events.event_type IS 'Event type (PURCHASE_CONFIRMED, PURCHASE_CREATED, etc.)';
COMMENT ON COLUMN processed_events.payload IS 'Full event payload (JSON)';
COMMENT ON COLUMN processed_events.source IS 'Service that emitted the event';
COMMENT ON COLUMN processed_events.version IS 'Event schema version';

