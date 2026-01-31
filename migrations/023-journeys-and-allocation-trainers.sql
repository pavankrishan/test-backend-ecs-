-- ============================================================================
-- JOURNEYS AND ALLOCATION_TRAINERS
-- Home tutoring: one journey per session, bound to exactly one trainer.
-- Substitutes create a new journey. Tracking is by journeyId only.
-- ============================================================================

-- allocation_trainers: supports primary + substitute trainers per allocation
-- (optional; trainer_allocations.trainer_id remains source for primary)
CREATE TABLE IF NOT EXISTS allocation_trainers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    allocation_id UUID NOT NULL REFERENCES trainer_allocations(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'primary'
        CHECK (role IN ('primary', 'substitute')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allocation_trainers_allocation
    ON allocation_trainers(allocation_id);
CREATE INDEX IF NOT EXISTS idx_allocation_trainers_trainer
    ON allocation_trainers(trainer_id);

-- journeys: one per session per "trip", bound to EXACTLY one trainer
-- Lifecycle: CREATED -> ACTIVE -> COMPLETED | CANCELLED
-- Substitute trainer starts a NEW journey (new row).
CREATE TABLE IF NOT EXISTS journeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES tutoring_sessions(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'active', 'completed', 'cancelled')),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    end_reason TEXT CHECK (end_reason IN ('arrived', 'cancelled', 'timeout', 'trainer_replaced')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_journeys_session ON journeys(session_id);
CREATE INDEX IF NOT EXISTS idx_journeys_trainer ON journeys(trainer_id);
CREATE INDEX IF NOT EXISTS idx_journeys_student ON journeys(student_id);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);
CREATE INDEX IF NOT EXISTS idx_journeys_started_at ON journeys(started_at);

COMMENT ON TABLE journeys IS 'One journey per session per trip. Live tracking is bound to journeyId only. Trainer replacement revokes tracking (new journey for substitute).';
