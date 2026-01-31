-- Migration: processed_events.event_id UUID → TEXT
-- WHY: Event IDs are opaque identifiers (e.g. "sessions-generated-{allocationId}-{timestamp}").
--      The database adapts to the event system — not the other way around.
--      Supports both UUID-based and string-based eventIds without casting errors.

-- Alter event_id to TEXT. Existing UUIDs convert via ::text.
ALTER TABLE processed_events
  ALTER COLUMN event_id TYPE TEXT USING event_id::text;

COMMENT ON COLUMN processed_events.event_id IS 'Unique event ID (opaque string identifier for idempotency)';
