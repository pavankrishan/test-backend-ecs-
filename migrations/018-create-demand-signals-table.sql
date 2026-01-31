-- ============================================================================
-- MIGRATION: 018 - DEMAND SIGNALS TABLE
-- Purpose: Track demand for courses when trainers are unavailable
-- ============================================================================
-- Date: 2024
-- Status: Production Schema
-- ============================================================================

-- Create demand_signals table for tracking course demand
CREATE TABLE IF NOT EXISTS demand_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    city_id UUID REFERENCES cities(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL CHECK (signal_type IN (
        'COURSE_VIEW',
        'CHECKOUT_STARTED',
        'PURCHASE_BLOCKED',
        'WAITLIST'
    )),
    reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_demand_signals_course_id ON demand_signals(course_id);
CREATE INDEX IF NOT EXISTS idx_demand_signals_user_id ON demand_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_demand_signals_city_id ON demand_signals(city_id);
CREATE INDEX IF NOT EXISTS idx_demand_signals_signal_type ON demand_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_demand_signals_created_at ON demand_signals(created_at);
CREATE INDEX IF NOT EXISTS idx_demand_signals_course_city_date ON demand_signals(course_id, city_id, created_at);

-- Composite index for common analytics queries
CREATE INDEX IF NOT EXISTS idx_demand_signals_analytics ON demand_signals(course_id, city_id, signal_type, created_at);

-- Add comment for documentation
COMMENT ON TABLE demand_signals IS 'Tracks demand signals for courses when trainers are unavailable. Used for analytics and hiring decisions.';
COMMENT ON COLUMN demand_signals.signal_type IS 'Type of demand signal: COURSE_VIEW, CHECKOUT_STARTED, PURCHASE_BLOCKED, WAITLIST';
COMMENT ON COLUMN demand_signals.reason IS 'Reason for the signal (e.g., NO_TRAINER_AVAILABLE)';
COMMENT ON COLUMN demand_signals.metadata IS 'Additional context: timeSlot, sessionCount, etc.';
