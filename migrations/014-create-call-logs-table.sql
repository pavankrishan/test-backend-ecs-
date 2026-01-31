-- ============================================================================
-- MIGRATION: 014 - CREATE CALL LOGS TABLE
-- Creates table for Exotel call logging
-- ============================================================================

BEGIN;

-- Create call_logs table
CREATE TABLE IF NOT EXISTS call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_sid TEXT UNIQUE NOT NULL, -- Exotel Call SID
    trainer_id UUID NOT NULL,
    student_id UUID NOT NULL,
    session_id UUID, -- Optional: link to tutoring session
    trainer_phone TEXT NOT NULL,
    student_phone TEXT NOT NULL,
    caller_role TEXT NOT NULL CHECK (caller_role IN ('trainer', 'student')),
    status TEXT NOT NULL DEFAULT 'initiated', -- initiated, ringing, answered, completed, failed, busy, no-answer
    direction TEXT NOT NULL DEFAULT 'outbound', -- outbound, inbound
    duration INTEGER, -- Call duration in seconds
    recording_url TEXT, -- URL to call recording if available
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_call_logs_trainer_student ON call_logs(trainer_id, student_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_session_id ON call_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_status ON call_logs(status);

-- Add comments
COMMENT ON TABLE call_logs IS 'Stores Exotel call logs for trainer-student communication';
COMMENT ON COLUMN call_logs.call_sid IS 'Exotel Call SID (unique identifier)';
COMMENT ON COLUMN call_logs.caller_role IS 'Who initiated the call: trainer or student';

COMMIT;

