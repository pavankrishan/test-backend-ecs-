-- ============================================================================
-- PRODUCTION EDTECH PLATFORM SCHEMA MIGRATION
-- Implements: Pricing, Coupons, Pre-Booking Capacity, Trainer Shifts, Payroll
-- ============================================================================
-- Date: 2024
-- Status: Production Schema
-- ============================================================================

-- ============================================================================
-- 1. FEATURE FLAGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key TEXT UNIQUE NOT NULL,
    flag_value BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    enabled_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(flag_key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_value ON feature_flags(flag_value);

-- Initial feature flags
INSERT INTO feature_flags (flag_key, flag_value, description) VALUES
('enable_10_session_packages', false, 'Enable 10-session packages (disabled until July 31)'),
('enable_20_session_packages', false, 'Enable 20-session packages (disabled until July 31)'),
('enable_sunday_focus', false, 'Enable Sunday Focus mode (disabled until July 31)'),
('summer_pricing_enabled', true, 'Summer pricing period (Apr 1 - Jul 31, requires coupon)')
ON CONFLICT (flag_key) DO NOTHING;

-- ============================================================================
-- 2. PRICING CONFIGURATION TABLE (BY CLASS TYPE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pricing_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_type TEXT NOT NULL CHECK (class_type IN ('1-on-1', '1-on-2', '1-on-3', 'hybrid')),
    pricing_type TEXT NOT NULL CHECK (pricing_type IN ('official', 'summer')),
    base_price NUMERIC(10, 2) NOT NULL CHECK (base_price > 0),
    gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_from DATE,
    valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(class_type, pricing_type, valid_from, valid_until)
);

CREATE INDEX IF NOT EXISTS idx_pricing_config_class_type ON pricing_config(class_type);
CREATE INDEX IF NOT EXISTS idx_pricing_config_type ON pricing_config(pricing_type);
CREATE INDEX IF NOT EXISTS idx_pricing_config_active ON pricing_config(is_active) WHERE is_active = true;

-- Official Pricing (by class type)
INSERT INTO pricing_config (class_type, pricing_type, base_price, gst_percentage) VALUES
('1-on-1', 'official', 9000.00, 18.00),
('1-on-2', 'official', 7500.00, 18.00),
('1-on-3', 'official', 6000.00, 18.00),
('hybrid', 'official', 5000.00, 18.00)
ON CONFLICT DO NOTHING;

-- Summer Pricing (Apr 1 - Jul 31, requires coupon)
INSERT INTO pricing_config (class_type, pricing_type, base_price, gst_percentage, valid_from, valid_until) VALUES
('1-on-1', 'summer', 6999.00, 18.00, '2024-04-01', '2024-07-31'),
('1-on-2', 'summer', 5999.00, 18.00, '2024-04-01', '2024-07-31'),
('1-on-3', 'summer', 4999.00, 18.00, '2024-04-01', '2024-07-31'),
('hybrid', 'summer', 3999.00, 18.00, '2024-04-01', '2024-07-31')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. COUPONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('school', 'influencer', 'promotional')),
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed', 'summer_pricing')),
    discount_value NUMERIC(10, 2),
    max_redemptions INTEGER,
    current_redemptions INTEGER NOT NULL DEFAULT 0,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_until > valid_from),
    CHECK (current_redemptions <= COALESCE(max_redemptions, current_redemptions))
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_type ON coupons(type);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, valid_from, valid_until) WHERE is_active = true;

-- ============================================================================
-- 4. COUPON REDEMPTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL, -- FK added below
    student_id UUID NOT NULL, -- FK added below
    payment_id UUID, -- FK added below
    booking_id UUID, -- FK added below if session_bookings exists
    discount_applied NUMERIC(10, 2) NOT NULL,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(coupon_id, student_id, payment_id)
);

-- Add FK constraints only if referenced tables exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'coupons') THEN
        ALTER TABLE coupon_redemptions
            DROP CONSTRAINT IF EXISTS coupon_redemptions_coupon_id_fkey;
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'coupon_redemptions_coupon_id_fkey' AND table_name = 'coupon_redemptions') THEN
            ALTER TABLE coupon_redemptions
                ADD CONSTRAINT coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'students') THEN
        ALTER TABLE coupon_redemptions
            DROP CONSTRAINT IF EXISTS coupon_redemptions_student_id_fkey;
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'coupon_redemptions_student_id_fkey' AND table_name = 'coupon_redemptions') THEN
            ALTER TABLE coupon_redemptions
                ADD CONSTRAINT coupon_redemptions_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
        ALTER TABLE coupon_redemptions
            DROP CONSTRAINT IF EXISTS coupon_redemptions_payment_id_fkey;
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'coupon_redemptions_payment_id_fkey' AND table_name = 'coupon_redemptions') THEN
            ALTER TABLE coupon_redemptions
                ADD CONSTRAINT coupon_redemptions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_bookings') THEN
        ALTER TABLE coupon_redemptions
            DROP CONSTRAINT IF EXISTS coupon_redemptions_booking_id_fkey;
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'coupon_redemptions_booking_id_fkey' AND table_name = 'coupon_redemptions') THEN
            ALTER TABLE coupon_redemptions
                ADD CONSTRAINT coupon_redemptions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES session_bookings(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_student ON coupon_redemptions(student_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_payment ON coupon_redemptions(payment_id);

-- ============================================================================
-- 5. PRE-BOOKING CAPACITY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS pre_booking_capacity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    timeslot TEXT NOT NULL,
    current_count INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
    max_capacity INTEGER NOT NULL DEFAULT 10 CHECK (max_capacity > 0),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course_id, timeslot)
);

CREATE INDEX IF NOT EXISTS idx_pre_booking_capacity_course_timeslot ON pre_booking_capacity(course_id, timeslot);
CREATE INDEX IF NOT EXISTS idx_pre_booking_capacity_count ON pre_booking_capacity(current_count, max_capacity);

-- ============================================================================
-- 6. TRAINER SHIFTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS trainer_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL UNIQUE REFERENCES trainers(id) ON DELETE CASCADE,
    shift_type TEXT NOT NULL CHECK (shift_type IN ('morning', 'evening')),
    shift_start TIME NOT NULL,
    shift_end TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    changed_at TIMESTAMPTZ,
    changed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shift_morning_check CHECK (
        (shift_type = 'morning' AND shift_start = '06:00:00' AND shift_end = '14:00:00') OR
        (shift_type = 'evening' AND shift_start = '12:00:00' AND shift_end = '20:00:00')
    )
);

CREATE INDEX IF NOT EXISTS idx_trainer_shifts_trainer ON trainer_shifts(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_shifts_type ON trainer_shifts(shift_type);
CREATE INDEX IF NOT EXISTS idx_trainer_shifts_active ON trainer_shifts(is_active) WHERE is_active = true;

-- ============================================================================
-- 7. PAYROLL CONFIGURATION TABLE
-- ============================================================================
-- Payroll Model: Session-based, 3-8 sessions per DAY (not per month)
-- Payout cycle: Every 30 days
CREATE TABLE IF NOT EXISTS payroll_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sessions_per_day INTEGER NOT NULL CHECK (sessions_per_day >= 3 AND sessions_per_day <= 8),
    base_salary NUMERIC(10, 2) NOT NULL CHECK (base_salary > 0),
    travel_allowance_per_day NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_monthly_compensation NUMERIC(10, 2) NOT NULL, -- base_salary + (travel_allowance * 30)
    is_active BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL,
    effective_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(sessions_per_day, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_config_sessions_per_day ON payroll_config(sessions_per_day);
CREATE INDEX IF NOT EXISTS idx_payroll_config_active ON payroll_config(is_active) WHERE is_active = true;

-- Payroll Configuration Data
-- Note: sessions_per_day = 3 means trainer teaches 3 sessions per day
-- Monthly compensation = base_salary + (travel_allowance * 30 days)
INSERT INTO payroll_config (sessions_per_day, base_salary, travel_allowance_per_day, total_monthly_compensation, effective_from) VALUES
(3, 9000.00, 75.00, 11250.00, '2024-04-01'), -- 9000 + (75 * 30)
(4, 12000.00, 100.00, 15000.00, '2024-04-01'), -- 12000 + (100 * 30)
(5, 15000.00, 125.00, 18750.00, '2024-04-01'), -- 15000 + (125 * 30)
(6, 18000.00, 150.00, 22500.00, '2024-04-01'), -- 18000 + (150 * 30)
(7, 21000.00, 175.00, 26250.00, '2024-04-01'), -- 21000 + (175 * 30)
(8, 24000.00, 200.00, 30000.00, '2024-04-01') -- 24000 + (200 * 30)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 8. REFERRAL TRACKING TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    referred_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    referral_code TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rewarded')),
    coins_awarded INTEGER DEFAULT 25,
    awarded_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- ============================================================================
-- 9. ENHANCE PRE-BOOKINGS TABLE (if exists)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pre_bookings') THEN
        -- Add columns
        ALTER TABLE pre_bookings
            ADD COLUMN IF NOT EXISTS student_id UUID,
            ADD COLUMN IF NOT EXISTS coupon_id UUID,
            ADD COLUMN IF NOT EXISTS pricing_type TEXT CHECK (pricing_type IN ('official', 'summer')),
            ADD COLUMN IF NOT EXISTS base_price NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS payment_id UUID,
            ADD COLUMN IF NOT EXISTS booking_day_of_week INTEGER CHECK (booking_day_of_week >= 1 AND booking_day_of_week <= 6);

        -- Add foreign key constraints only if referenced tables exist
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'students') THEN
            ALTER TABLE pre_bookings
                DROP CONSTRAINT IF EXISTS pre_bookings_student_id_fkey;
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pre_bookings_student_id_fkey' AND table_name = 'pre_bookings') THEN
                ALTER TABLE pre_bookings
                    ADD CONSTRAINT pre_bookings_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
            END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'coupons') THEN
            ALTER TABLE pre_bookings
                DROP CONSTRAINT IF EXISTS pre_bookings_coupon_id_fkey;
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pre_bookings_coupon_id_fkey' AND table_name = 'pre_bookings') THEN
                ALTER TABLE pre_bookings
                    ADD CONSTRAINT pre_bookings_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
            END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
            ALTER TABLE pre_bookings
                DROP CONSTRAINT IF EXISTS pre_bookings_payment_id_fkey;
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pre_bookings_payment_id_fkey' AND table_name = 'pre_bookings') THEN
                ALTER TABLE pre_bookings
                    ADD CONSTRAINT pre_bookings_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
            END IF;
        END IF;

        -- Add constraint: Sunday is blocked
        ALTER TABLE pre_bookings
            DROP CONSTRAINT IF EXISTS no_sunday_bookings;
            
        ALTER TABLE pre_bookings
            ADD CONSTRAINT no_sunday_bookings CHECK (
                booking_day_of_week IS NULL OR booking_day_of_week != 7
            );

        -- Add indexes
        CREATE INDEX IF NOT EXISTS idx_pre_bookings_course_timeslot ON pre_bookings(course_id, timeslot, status) WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_pre_bookings_day_of_week ON pre_bookings(booking_day_of_week);
        CREATE INDEX IF NOT EXISTS idx_pre_bookings_student ON pre_bookings(student_id) WHERE student_id IS NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- 10. ENHANCE SESSION BOOKINGS TABLE (if exists)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_bookings') THEN
        -- Add columns
        ALTER TABLE session_bookings
            ADD COLUMN IF NOT EXISTS coupon_id UUID,
            ADD COLUMN IF NOT EXISTS pricing_type TEXT CHECK (pricing_type IN ('official', 'summer')),
            ADD COLUMN IF NOT EXISTS base_price NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS booking_day_of_week INTEGER CHECK (booking_day_of_week >= 1 AND booking_day_of_week <= 6);

        -- Add FK constraint only if coupons table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'coupons') THEN
            ALTER TABLE session_bookings
                DROP CONSTRAINT IF EXISTS session_bookings_coupon_id_fkey;
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'session_bookings_coupon_id_fkey' AND table_name = 'session_bookings') THEN
                ALTER TABLE session_bookings
                    ADD CONSTRAINT session_bookings_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
            END IF;
        END IF;

        -- Add constraint: Sunday is blocked
        ALTER TABLE session_bookings
            DROP CONSTRAINT IF EXISTS no_sunday_session_bookings;
            
        ALTER TABLE session_bookings
            ADD CONSTRAINT no_sunday_session_bookings CHECK (
                booking_day_of_week IS NULL OR booking_day_of_week != 7
            );
    END IF;
END $$;

-- ============================================================================
-- 11. FUNCTIONS
-- ============================================================================

-- Atomic increment pre-booking capacity
CREATE OR REPLACE FUNCTION increment_pre_booking_count(
    p_course_id UUID,
    p_timeslot TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_current_count INTEGER;
    v_max_capacity INTEGER;
BEGIN
    -- Lock row for update
    SELECT current_count, max_capacity INTO v_current_count, v_max_capacity
    FROM pre_booking_capacity
    WHERE course_id = p_course_id AND timeslot = p_timeslot
    FOR UPDATE;
    
    -- If row doesn't exist, create it
    IF NOT FOUND THEN
        INSERT INTO pre_booking_capacity (course_id, timeslot, current_count, max_capacity)
        VALUES (p_course_id, p_timeslot, 0, 10)
        RETURNING current_count, max_capacity INTO v_current_count, v_max_capacity;
    END IF;
    
    -- Check capacity
    IF v_current_count >= v_max_capacity THEN
        RAISE EXCEPTION 'Pre-booking capacity exceeded for course % and timeslot %', p_course_id, p_timeslot;
    END IF;
    
    -- Increment
    UPDATE pre_booking_capacity
    SET current_count = current_count + 1,
        last_updated_at = NOW()
    WHERE course_id = p_course_id AND timeslot = p_timeslot
    RETURNING current_count INTO v_current_count;
    
    RETURN v_current_count;
END;
$$ LANGUAGE plpgsql;

-- Atomic decrement pre-booking capacity
CREATE OR REPLACE FUNCTION decrement_pre_booking_count(
    p_course_id UUID,
    p_timeslot TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_current_count INTEGER;
BEGIN
    UPDATE pre_booking_capacity
    SET current_count = GREATEST(0, current_count - 1),
        last_updated_at = NOW()
    WHERE course_id = p_course_id AND timeslot = p_timeslot
    RETURNING current_count INTO v_current_count;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    RETURN v_current_count;
END;
$$ LANGUAGE plpgsql;

-- Generate trainer availability slots from shift
CREATE OR REPLACE FUNCTION generate_trainer_availability_from_shift(
    p_trainer_id UUID,
    p_shift_type TEXT
) RETURNS VOID AS $$
DECLARE
    v_slot_start TIME;
    v_slot_end TIME;
    i INTEGER;
BEGIN
    -- Delete existing slots for this trainer
    DELETE FROM trainer_availability WHERE trainer_id = p_trainer_id;
    
    -- Generate slots based on shift
    IF p_shift_type = 'morning' THEN
        -- Morning: 6 AM - 2 PM (8 slots: 6-7, 7-8, ..., 13-14)
        FOR i IN 0..7 LOOP
            v_slot_start := (TIME '06:00:00' + (i || ' hours')::INTERVAL)::TIME;
            v_slot_end := (v_slot_start + INTERVAL '1 hour')::TIME;
            
            INSERT INTO trainer_availability (trainer_id, slot_start, slot_end, employment_type)
            VALUES (p_trainer_id, v_slot_start, v_slot_end, 'full-time')
            ON CONFLICT (trainer_id, slot_start) DO NOTHING;
        END LOOP;
    ELSIF p_shift_type = 'evening' THEN
        -- Evening: 12 PM - 8 PM (8 slots: 12-13, 13-14, ..., 19-20)
        FOR i IN 0..7 LOOP
            v_slot_start := (TIME '12:00:00' + (i || ' hours')::INTERVAL)::TIME;
            v_slot_end := (v_slot_start + INTERVAL '1 hour')::TIME;
            
            INSERT INTO trainer_availability (trainer_id, slot_start, slot_end, employment_type)
            VALUES (p_trainer_id, v_slot_start, v_slot_end, 'full-time')
            ON CONFLICT (trainer_id, slot_start) DO NOTHING;
        END LOOP;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Validate time slot and day (no Sunday, 6 AM - 8 PM)
CREATE OR REPLACE FUNCTION validate_time_slot_and_day(
    p_timeslot TEXT,
    p_date DATE
) RETURNS BOOLEAN AS $$
DECLARE
    v_hour INTEGER;
    v_day_of_week INTEGER;
BEGIN
    -- Parse timeslot (format: "HH:MM" or "HH:MM:SS")
    v_hour := EXTRACT(HOUR FROM (p_timeslot::TIME));
    
    -- Check time range: 6 AM - 8 PM
    IF v_hour < 6 OR v_hour >= 20 THEN
        RAISE EXCEPTION 'Time slot % is outside allowed range (6 AM - 8 PM)', p_timeslot;
    END IF;
    
    -- Check day of week (Sunday = 0 in PostgreSQL)
    v_day_of_week := EXTRACT(DOW FROM p_date)::INTEGER;
    IF v_day_of_week = 0 THEN
        RAISE EXCEPTION 'Sunday bookings are not allowed';
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Get day of week from date (1=Monday, 6=Saturday, NULL=Sunday)
CREATE OR REPLACE FUNCTION get_day_of_week_from_date(p_date DATE) RETURNS INTEGER AS $$
DECLARE
    v_dow INTEGER;
BEGIN
    v_dow := EXTRACT(DOW FROM p_date)::INTEGER;
    -- PostgreSQL: 0=Sunday, 1=Monday, ..., 6=Saturday
    -- We want: 1=Monday, ..., 6=Saturday (NO Sunday)
    IF v_dow = 0 THEN
        RETURN NULL; -- Sunday is blocked
    END IF;
    RETURN v_dow;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 12. TRIGGERS
-- ============================================================================

-- Update coupon redemption count
CREATE OR REPLACE FUNCTION update_coupon_redemption_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE coupons
        SET current_redemptions = current_redemptions + 1
        WHERE id = NEW.coupon_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE coupons
        SET current_redemptions = GREATEST(0, current_redemptions - 1)
        WHERE id = OLD.coupon_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_coupon_redemption_count
    AFTER INSERT OR DELETE ON coupon_redemptions
    FOR EACH ROW
    EXECUTE FUNCTION update_coupon_redemption_count();

-- ============================================================================
-- 13. COMMENTS
-- ============================================================================

COMMENT ON TABLE feature_flags IS 'Feature flags for controlling business rules (NO hardcoded dates)';
COMMENT ON TABLE pricing_config IS 'Official and summer pricing configuration';
COMMENT ON TABLE coupons IS 'Coupons for schools, influencers, and promotional campaigns';
COMMENT ON TABLE pre_booking_capacity IS 'Atomic counter for pre-booking capacity (MAX 10 per course × timeslot)';
COMMENT ON TABLE trainer_shifts IS 'Trainer shift assignment (morning 6-2 or evening 12-8, full-time only)';
COMMENT ON TABLE payroll_config IS 'Session-based payroll configuration (3-8 sessions per day, payout cycle: 30 days)';
COMMENT ON TABLE referrals IS 'Referral tracking (25 coins per referral)';

COMMENT ON FUNCTION increment_pre_booking_count IS 'Atomically increment pre-booking capacity with row-level locking';
COMMENT ON FUNCTION decrement_pre_booking_count IS 'Atomically decrement pre-booking capacity';
COMMENT ON FUNCTION generate_trainer_availability_from_shift IS 'Auto-generate availability slots from trainer shift';
COMMENT ON FUNCTION validate_time_slot_and_day IS 'Validate timeslot is 6 AM - 8 PM and not Sunday';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

