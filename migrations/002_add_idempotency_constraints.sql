-- Migration: Add idempotency constraints to existing tables
-- These constraints ensure no duplicate records on retries

-- 1. Payment idempotency: UNIQUE constraint on provider_payment_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_provider_payment_id'
  ) THEN
    ALTER TABLE payments 
    ADD CONSTRAINT unique_provider_payment_id 
    UNIQUE (provider_payment_id) 
    WHERE provider_payment_id IS NOT NULL;
    
    COMMENT ON CONSTRAINT unique_provider_payment_id ON payments IS 
      'Ensures payment verification is idempotent (same Razorpay payment ID cannot be processed twice)';
  END IF;
END $$;

-- 2. Purchase idempotency: UNIQUE constraint on (student_id, course_id) WHERE is_active = true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_active_purchase'
  ) THEN
    -- Create partial unique index (PostgreSQL doesn't support partial unique constraints directly)
    CREATE UNIQUE INDEX IF NOT EXISTS unique_active_purchase 
    ON student_course_purchases(student_id, course_id) 
    WHERE is_active = true;
    
    COMMENT ON INDEX unique_active_purchase IS 
      'Ensures purchase creation is idempotent (same student cannot have duplicate active purchases for same course)';
  END IF;
END $$;

-- 3. Allocation idempotency: UNIQUE constraint on (student_id, course_id) WHERE status IN ('approved', 'active')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'unique_active_allocation'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS unique_active_allocation 
    ON trainer_allocations(student_id, course_id) 
    WHERE status IN ('approved', 'active');
    
    COMMENT ON INDEX unique_active_allocation IS 
      'Ensures trainer allocation is idempotent (same student cannot have duplicate approved/active allocations for same course)';
  END IF;
END $$;

-- 4. Session idempotency: UNIQUE constraint on (allocation_id, scheduled_date, scheduled_time)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_session_slot'
  ) THEN
    ALTER TABLE tutoring_sessions 
    ADD CONSTRAINT unique_session_slot 
    UNIQUE (allocation_id, scheduled_date, scheduled_time);
    
    COMMENT ON CONSTRAINT unique_session_slot ON tutoring_sessions IS 
      'Ensures session creation is idempotent (same time slot cannot be scheduled twice for same allocation)';
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON TABLE payments IS 
  'Payment records with idempotency guarantee via unique_provider_payment_id constraint';
COMMENT ON TABLE student_course_purchases IS 
  'Course purchases with idempotency guarantee via unique_active_purchase index';
COMMENT ON TABLE trainer_allocations IS 
  'Trainer allocations with idempotency guarantee via unique_active_allocation index';
COMMENT ON TABLE tutoring_sessions IS 
  'Tutoring sessions with idempotency guarantee via unique_session_slot constraint';

