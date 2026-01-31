-- ============================================================================
-- MIGRATION: 002 - UNIFIED SCHEMA MIGRATION
-- Migrate from broken dual-schema to unified production-grade schema
-- ============================================================================

-- Start transaction for atomic migration
BEGIN;

-- Enable necessary extensions (safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================================
-- PHASE 1: CREATE ALL NEW TABLES (from schema.sql)
-- ============================================================================

-- Create students table if it doesn't exist
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id TEXT UNIQUE,
    email CITEXT UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role = 'student'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    phone TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create trainers table if it doesn't exist
CREATE TABLE IF NOT EXISTS trainers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id TEXT UNIQUE,
    email CITEXT UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'trainer' CHECK (role = 'trainer'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    phone TEXT,
    profile_image_url TEXT,
    verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create courses table if it doesn't exist
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    instructor TEXT,
    duration INTEGER,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create cities table
CREATE TABLE IF NOT EXISTS cities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'India',
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, state, country)
);

-- Create zones table
CREATE TABLE IF NOT EXISTS zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchise_id UUID,
    name TEXT NOT NULL,
    center_lat NUMERIC(10, 8) NOT NULL,
    center_lng NUMERIC(11, 8) NOT NULL,
    radius_km NUMERIC(5, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create clusters table
CREATE TABLE IF NOT EXISTS clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID REFERENCES cities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    center_latitude NUMERIC(10, 8) NOT NULL,
    center_longitude NUMERIC(11, 8) NOT NULL,
    radius_km NUMERIC(5, 2) NOT NULL DEFAULT 2.5,
    boundary JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(city_id, name)
);

-- ============================================================================
-- PHASE 2: MIGRATE DATA FROM LEGACY TABLES
-- ============================================================================

-- Insert sample data into cities (for Andhra Pradesh)
INSERT INTO cities (name, state, country, latitude, longitude, metadata) VALUES
    ('Visakhapatnam', 'Andhra Pradesh', 'India', 17.6868, 83.2185, '{"population": 2035922, "area_km2": 681}'),
    ('Vijayawada', 'Andhra Pradesh', 'India', 16.5062, 80.6480, '{"population": 1255741, "area_km2": 61.88}'),
    ('Guntur', 'Andhra Pradesh', 'India', 16.3067, 80.4365, '{"population": 670073, "area_km2": 168.4}'),
    ('Nellore', 'Andhra Pradesh', 'India', 14.4426, 79.9865, '{"population": 547621, "area_km2": 98.64}'),
    ('Kurnool', 'Andhra Pradesh', 'India', 15.8281, 78.0373, '{"population": 484327, "area_km2": 214.03}'),
    ('Kadapa', 'Andhra Pradesh', 'India', 14.4674, 78.8242, '{"population": 341823, "area_km2": 164.08}')
ON CONFLICT (name, state, country) DO NOTHING;

-- Create sample zones for each city
INSERT INTO zones (name, center_lat, center_lng, radius_km, metadata)
SELECT
    c.name || ' Central',
    c.latitude,
    c.longitude,
    15.0,
    jsonb_build_object('city_id', c.id, 'zone_type', 'central')
FROM cities c
WHERE c.state = 'Andhra Pradesh'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PHASE 3: MIGRATE EXISTING TUTORING_SESSIONS DATA
-- ============================================================================

-- First, create a temporary mapping table to track old->new relationships
CREATE TEMP TABLE migration_mapping (
    old_session_id UUID,
    new_booking_id UUID,
    new_purchase_id UUID,
    student_id UUID,
    trainer_id UUID,
    course_id UUID
);

-- Insert data into students table from tutoring_sessions (if they don't exist)
INSERT INTO students (name, created_at, updated_at)
SELECT DISTINCT
    COALESCE(ts.student_id::text, 'Unknown Student') as name,
    MIN(ts.created_at) as created_at,
    MAX(ts.updated_at) as updated_at
FROM tutoring_sessions ts
LEFT JOIN students s ON s.id::text = ts.student_id::text
WHERE s.id IS NULL
  AND ts.student_id IS NOT NULL
GROUP BY ts.student_id;

-- Insert data into trainers table from tutoring_sessions (if they don't exist)
INSERT INTO trainers (name, verified, created_at, updated_at)
SELECT DISTINCT
    COALESCE(ts.trainer_id::text, 'Unknown Trainer') as name,
    false as verified,
    MIN(ts.created_at) as created_at,
    MAX(ts.updated_at) as updated_at
FROM tutoring_sessions ts
LEFT JOIN trainers t ON t.id::text = ts.trainer_id::text
WHERE t.id IS NULL
  AND ts.trainer_id IS NOT NULL
GROUP BY ts.trainer_id;

-- Insert data into courses table from tutoring_sessions (if they don't exist)
INSERT INTO courses (title, category, created_at, updated_at)
SELECT DISTINCT
    COALESCE(ts.course_id::text, 'Unknown Course') as title,
    'General' as category,
    MIN(ts.created_at) as created_at,
    MAX(ts.updated_at) as updated_at
FROM tutoring_sessions ts
LEFT JOIN courses c ON c.id::text = ts.course_id::text
WHERE c.id IS NULL
  AND ts.course_id IS NOT NULL
GROUP BY ts.course_id;

-- Create session_bookings from tutoring_sessions
INSERT INTO session_bookings (
    id,
    student_id,
    course_id,
    address,
    latitude,
    longitude,
    timeslot,
    mode,
    group_size,
    session_count,
    trainer_id,
    status,
    start_date,
    end_date,
    completed_sessions,
    metadata,
    created_at,
    updated_at
)
SELECT
    ts.id,
    s.id as student_id,
    c.id as course_id,
    COALESCE(ts.student_home_location->>'address', 'Unknown Address') as address,
    (ts.student_home_location->>'latitude')::numeric as latitude,
    (ts.student_home_location->>'longitude')::numeric as longitude,
    COALESCE(ts.time_slot, ts.scheduled_time, '09:00') as timeslot,
    '1on1' as mode,
    1 as group_size,
    10 as session_count, -- Default assumption
    t.id as trainer_id,
    CASE
        WHEN ts.status = 'scheduled' THEN 'confirmed'
        WHEN ts.status = 'completed' THEN 'completed'
        WHEN ts.status = 'cancelled' THEN 'cancelled'
        ELSE 'pending'
    END as status,
    ts.scheduled_date as start_date,
    ts.scheduled_date as end_date, -- Single session assumption
    CASE WHEN ts.status = 'completed' THEN 1 ELSE 0 END as completed_sessions,
    jsonb_build_object(
        'migrated_from', 'tutoring_sessions',
        'original_id', ts.id,
        'duration', ts.duration,
        'otp', ts.otp,
        'notes', ts.notes,
        'metadata', ts.metadata
    ) as metadata,
    ts.created_at,
    ts.updated_at
FROM tutoring_sessions ts
LEFT JOIN students s ON s.id::text = ts.student_id::text
LEFT JOIN trainers t ON t.id::text = ts.trainer_id::text
LEFT JOIN courses c ON c.id::text = ts.course_id::text;

-- Create course_purchases for each booking
INSERT INTO course_purchases (
    booking_id,
    course_id,
    class_type,
    total_sessions,
    delivery_mode,
    start_date,
    preferred_time_slot,
    student_location,
    students,
    trainer_id,
    status,
    metadata
)
SELECT
    sb.id as booking_id,
    sb.course_id,
    'ONE_ON_ONE' as class_type,
    sb.session_count as total_sessions,
    'WEEKDAY_DAILY' as delivery_mode,
    sb.start_date,
    sb.timeslot as preferred_time_slot,
    jsonb_build_object(
        'latitude', sb.latitude,
        'longitude', sb.longitude,
        'address', sb.address
    ) as student_location,
    jsonb_build_array(
        jsonb_build_object(
            'id', sb.student_id,
            'name', s.name
        )
    ) as students,
    sb.trainer_id,
    CASE
        WHEN sb.trainer_id IS NOT NULL THEN 'ASSIGNED'
        ELSE 'WAITLISTED'
    END as status,
    jsonb_build_object(
        'migrated_from', 'tutoring_sessions',
        'original_booking_id', sb.id
    ) as metadata
FROM session_bookings sb
LEFT JOIN students s ON sb.student_id = s.id
WHERE sb.id IN (
    SELECT id FROM session_bookings
    WHERE metadata->>'migrated_from' = 'tutoring_sessions'
);

-- Create purchase_sessions for each purchase
INSERT INTO purchase_sessions (
    purchase_id,
    booking_id,
    session_number,
    session_date,
    session_time,
    session_type,
    status,
    metadata
)
SELECT
    cp.id as purchase_id,
    cp.booking_id,
    1 as session_number, -- Single session assumption
    cp.start_date as session_date,
    cp.preferred_time_slot as session_time,
    'offline' as session_type,
    CASE
        WHEN sb.status = 'completed' THEN 'completed'
        WHEN sb.status = 'cancelled' THEN 'cancelled'
        ELSE 'scheduled'
    END as status,
    jsonb_build_object(
        'migrated_from', 'tutoring_sessions'
    ) as metadata
FROM course_purchases cp
JOIN session_bookings sb ON cp.booking_id = sb.id
WHERE cp.metadata->>'migrated_from' = 'tutoring_sessions';

-- ============================================================================
-- PHASE 4: MIGRATE TRAINER ALLOCATIONS DATA
-- ============================================================================

-- Migrate trainer_allocations data (if table exists and has data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_allocations' AND table_schema = 'public') THEN
        -- Migrate existing trainer_allocations to use proper UUID references
        UPDATE trainer_allocations ta
        SET
            student_id = s.id,
            trainer_id = t.id,
            course_id = c.id,
            requested_by = s.id
        FROM students s, trainers t, courses c
        WHERE ta.student_id::text = s.id::text
          AND ta.trainer_id::text = t.id::text
          AND ta.course_id::text = c.id::text;
    END IF;
END $$;

-- ============================================================================
-- PHASE 5: CREATE INDEXES AND CONSTRAINTS
-- ============================================================================

-- Create indexes for performance (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_trainers_email ON trainers(email);
CREATE INDEX IF NOT EXISTS idx_trainers_status ON trainers(status);
CREATE INDEX IF NOT EXISTS idx_trainers_verified ON trainers(verified);

-- Location-based indexes
CREATE INDEX IF NOT EXISTS idx_zones_location ON zones(center_lat, center_lng) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_clusters_location ON clusters(center_latitude, center_longitude) WHERE is_active = true;

-- Booking and session indexes
CREATE INDEX IF NOT EXISTS idx_session_bookings_student ON session_bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_session_bookings_trainer ON session_bookings(trainer_id) WHERE trainer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_bookings_status ON session_bookings(status);
CREATE INDEX IF NOT EXISTS idx_session_bookings_dates ON session_bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_session_bookings_location ON session_bookings(latitude, longitude);

-- Purchase and progress indexes
CREATE INDEX IF NOT EXISTS idx_course_purchases_booking ON course_purchases(booking_id);
CREATE INDEX IF NOT EXISTS idx_course_purchases_trainer ON course_purchases(trainer_id) WHERE trainer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_purchases_status ON course_purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchase_sessions_purchase ON purchase_sessions(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_sessions_date ON purchase_sessions(session_date);

-- ============================================================================
-- PHASE 6: CREATE UPDATED_at TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to new tables
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trainers_updated_at BEFORE UPDATE ON trainers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_session_bookings_updated_at BEFORE UPDATE ON session_bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_course_purchases_updated_at BEFORE UPDATE ON course_purchases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_purchase_sessions_updated_at BEFORE UPDATE ON purchase_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PHASE 7: CREATE USEFUL VIEWS
-- ============================================================================

-- View for active bookings with student and trainer details
CREATE OR REPLACE VIEW active_bookings AS
SELECT
    sb.id,
    sb.student_id,
    s.name as student_name,
    sb.trainer_id,
    t.name as trainer_name,
    sb.course_id,
    c.title as course_title,
    sb.status,
    sb.start_date,
    sb.end_date,
    sb.completed_sessions,
    sb.session_count,
    sb.timeslot,
    sb.address,
    sb.latitude,
    sb.longitude
FROM session_bookings sb
LEFT JOIN students s ON sb.student_id = s.id
LEFT JOIN trainers t ON sb.trainer_id = t.id
LEFT JOIN courses c ON sb.course_id = c.id
WHERE sb.status IN ('active', 'confirmed');

-- View for trainer availability and location
CREATE OR REPLACE VIEW trainer_availability AS
SELECT
    t.id,
    t.name,
    t.verified,
    tl.latitude,
    tl.longitude,
    tl.available,
    tl.service_radius_km,
    tl.updated_at as location_updated_at,
    tp.rating_average,
    tp.total_reviews,
    tp.hourly_rate
FROM trainers t
LEFT JOIN trainer_locations tl ON t.id = tl.trainer_id
LEFT JOIN trainer_profiles tp ON t.id = tp.trainer_id
WHERE t.status = 'active';

-- ============================================================================
-- PHASE 8: VALIDATION AND CLEANUP
-- ============================================================================

-- Validate that migration was successful
DO $$
DECLARE
    old_count INTEGER;
    new_booking_count INTEGER;
    new_purchase_count INTEGER;
BEGIN
    -- Count old tutoring_sessions
    SELECT COUNT(*) INTO old_count FROM tutoring_sessions;
    RAISE NOTICE 'Found % records in old tutoring_sessions table', old_count;

    -- Count new session_bookings
    SELECT COUNT(*) INTO new_booking_count FROM session_bookings WHERE metadata->>'migrated_from' = 'tutoring_sessions';
    RAISE NOTICE 'Migrated % records to session_bookings table', new_booking_count;

    -- Count new course_purchases
    SELECT COUNT(*) INTO new_purchase_count FROM course_purchases WHERE metadata->>'migrated_from' = 'tutoring_sessions';
    RAISE NOTICE 'Created % records in course_purchases table', new_purchase_count;

    -- Check for issues
    IF old_count > 0 AND new_booking_count = 0 THEN
        RAISE WARNING 'Migration may have failed - no bookings were created from tutoring_sessions';
    END IF;

    RAISE NOTICE 'Migration validation complete';
END $$;

-- ============================================================================
-- PHASE 9: BACKUP AND CLEANUP (Optional - run manually after validation)
-- ============================================================================

-- NOTE: Uncomment these lines after validating the migration works correctly

-- -- Rename old table for backup (don't delete immediately)
-- ALTER TABLE tutoring_sessions RENAME TO tutoring_sessions_backup_pre_migration_002;

-- -- Create a view for backward compatibility (temporary)
-- CREATE VIEW tutoring_sessions AS
-- SELECT
--     sb.id,
--     sb.student_id::text as student_id,
--     sb.trainer_id::text as trainer_id,
--     sb.course_id::text as course_id,
--     sb.start_date as scheduled_date,
--     sb.timeslot as scheduled_time,
--     sb.timeslot as time_slot,
--     60 as duration,
--     CASE
--         WHEN sb.status = 'confirmed' THEN 'scheduled'
--         WHEN sb.status = 'completed' THEN 'completed'
--         WHEN sb.status = 'cancelled' THEN 'cancelled'
--         ELSE 'scheduled'
--     END as status,
--     jsonb_build_object(
--         'latitude', sb.latitude,
--         'longitude', sb.longitude,
--         'address', sb.address
--     ) as student_home_location,
--     sb.metadata->>'otp' as otp,
--     sb.metadata->>'notes' as notes,
--     sb.metadata,
--     sb.created_at,
--     sb.updated_at
-- FROM session_bookings sb
-- WHERE sb.metadata->>'migrated_from' = 'tutoring_sessions';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

COMMIT;

-- Post-migration validation query (run this manually)
-- SELECT 'Migration Summary:' as info;
-- SELECT COUNT(*) as old_sessions FROM tutoring_sessions_backup_pre_migration_002;
-- SELECT COUNT(*) as new_bookings FROM session_bookings WHERE metadata->>'migrated_from' = 'tutoring_sessions';
-- SELECT COUNT(*) as new_purchases FROM course_purchases WHERE metadata->>'migrated_from' = 'tutoring_sessions';
-- SELECT COUNT(*) as new_sessions FROM purchase_sessions WHERE metadata->>'migrated_from' = 'tutoring_sessions';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
