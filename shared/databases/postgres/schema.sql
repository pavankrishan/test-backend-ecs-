-- ============================================================================
-- KODING CARAVAN UNIFIED DATABASE SCHEMA
-- Production-Grade Schema with Proper Relationships and Constraints
-- ============================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- For future geospatial features

-- ============================================================================
-- ADMIN SYSTEM TABLES
-- ============================================================================

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    admin_type TEXT NOT NULL DEFAULT 'company' CHECK (admin_type IN ('company', 'franchise')),
    parent_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    state TEXT,
    district TEXT,
    zone TEXT,
    locality TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin Roles Table
CREATE TABLE IF NOT EXISTS admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    parent_role_id UUID REFERENCES admin_roles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin User Roles (Many-to-Many)
CREATE TABLE IF NOT EXISTS admin_user_roles (
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (admin_id, role_id)
);

-- Admin Permissions Table
CREATE TABLE IF NOT EXISTS admin_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin Role Permissions (Many-to-Many)
CREATE TABLE IF NOT EXISTS admin_role_permissions (
    role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

-- Admin Sessions Table
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- GEOGRAPHICAL HIERARCHY TABLES
-- ============================================================================

-- Cities Table
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

-- Zones Table (Service Areas)
CREATE TABLE IF NOT EXISTS zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchise_id UUID REFERENCES admin_users(id) ON DELETE SET NULL, -- NULL = COMPANY-operated
    name TEXT NOT NULL,
    center_lat NUMERIC(10, 8) NOT NULL,
    center_lng NUMERIC(11, 8) NOT NULL,
    radius_km NUMERIC(5, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique indexes for zone names (company vs franchise operated)
CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_company_name
    ON zones(name) WHERE franchise_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_franchise_name
    ON zones(franchise_id, name) WHERE franchise_id IS NOT NULL;

-- Clusters Table (Operational areas within cities)
CREATE TABLE IF NOT EXISTS clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    center_latitude NUMERIC(10, 8) NOT NULL,
    center_longitude NUMERIC(11, 8) NOT NULL,
    radius_km NUMERIC(5, 2) NOT NULL DEFAULT 2.5,
    boundary JSONB, -- For complex boundaries
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(city_id, name)
);

-- ============================================================================
-- USER MANAGEMENT TABLES
-- ============================================================================

-- Students Table (from MongoDB user model)
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id TEXT UNIQUE, -- Link to external auth system
    email CITEXT UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role = 'student'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    phone TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trainers Table
CREATE TABLE IF NOT EXISTS trainers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id TEXT UNIQUE, -- Link to external auth system
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

-- Trainer Profiles (Extended information)
CREATE TABLE IF NOT EXISTS trainer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL UNIQUE REFERENCES trainers(id) ON DELETE CASCADE,
    full_name TEXT,
    bio TEXT,
    specialties TEXT[], -- Array of specialties
    years_of_experience INTEGER,
    hourly_rate NUMERIC(10, 2),
    availability JSONB, -- Complex availability schedule
    preferred_languages TEXT[],
    certifications TEXT[],
    rating_average NUMERIC(4, 2),
    total_reviews INTEGER NOT NULL DEFAULT 0,
    verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trainer Locations (Real-time location tracking)
CREATE TABLE IF NOT EXISTS trainer_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL UNIQUE REFERENCES trainers(id) ON DELETE CASCADE,
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    accuracy NUMERIC(6, 2), -- GPS accuracy in meters
    city TEXT,
    state TEXT,
    country TEXT,
    service_radius_km NUMERIC(5, 2), -- How far they're willing to travel
    available BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Student Profiles (Extended information)
CREATE TABLE IF NOT EXISTS student_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    full_name TEXT,
    age INTEGER,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    address TEXT,
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    avatar_url TEXT,
    goals TEXT,
    interests TEXT[], -- Array of interests
    learning_preferences JSONB, -- Complex preferences
    timezone TEXT,
    occupation TEXT,
    organization TEXT,
    preferred_languages TEXT[],
    extra JSONB, -- Additional custom fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- COURSE MANAGEMENT TABLES
-- ============================================================================

-- Courses Table
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    instructor TEXT,
    duration INTEGER, -- in hours
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- BOOKING AND SESSION MANAGEMENT TABLES
-- ============================================================================

-- Session Bookings (Core booking table - replaces old tutoring_sessions)
CREATE TABLE IF NOT EXISTS session_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[], -- For group bookings (1on2, 1on3)
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    timeslot TEXT NOT NULL, -- Format: "HH:MM"
    mode TEXT NOT NULL CHECK (mode IN ('1on1', '1on2', '1on3')),
    group_size INTEGER NOT NULL CHECK (group_size IN (1, 2, 3)),
    session_count INTEGER NOT NULL CHECK (session_count IN (10, 20, 30)),
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
    start_date DATE NOT NULL,
    end_date DATE,
    completed_sessions INTEGER NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Course Purchases (Detailed purchase records)
CREATE TABLE IF NOT EXISTS course_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL UNIQUE REFERENCES session_bookings(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    class_type TEXT NOT NULL CHECK (class_type IN ('ONE_ON_ONE', 'ONE_ON_TWO', 'ONE_ON_THREE', 'HYBRID')),
    total_sessions INTEGER NOT NULL CHECK (total_sessions IN (10, 20, 30)),
    delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('WEEKDAY_DAILY', 'SUNDAY_ONLY')),
    start_date DATE NOT NULL,
    preferred_time_slot TEXT NOT NULL, -- Format: "HH:MM"
    student_location JSONB NOT NULL, -- {latitude, longitude, address}
    students JSONB NOT NULL, -- Array of student details
    franchise_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'WAITLISTED'
        CHECK (status IN ('ASSIGNED', 'WAITLISTED', 'SERVICE_NOT_AVAILABLE', 'INVALID_PURCHASE')),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purchase Sessions (Individual sessions within a purchase)
CREATE TABLE IF NOT EXISTS purchase_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES course_purchases(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
    session_number INTEGER NOT NULL, -- 1, 2, 3, ... up to total_sessions
    session_date DATE NOT NULL,
    session_time TEXT NOT NULL, -- Format: "HH:MM"
    session_type TEXT NOT NULL DEFAULT 'offline' CHECK (session_type IN ('offline', 'online')),
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(purchase_id, session_number)
);

-- ============================================================================
-- SESSION TRACKING AND VERIFICATION TABLES
-- ============================================================================

-- Attendance Records (Daily attendance tracking)
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
    session_id UUID REFERENCES purchase_sessions(id) ON DELETE SET NULL,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    timeslot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'absent'
        CHECK (status IN ('present', 'absent', 'rescheduled', 'cancelled')),
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(booking_id, date)
);

-- Certificates (Generated for completed courses)
CREATE TABLE IF NOT EXISTS certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES course_purchases(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    certificate_number TEXT NOT NULL UNIQUE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- STUDENT PROGRESS AND PROJECTS TABLES
-- ============================================================================

-- Student Course Progress (Progress tracking)
CREATE TABLE IF NOT EXISTS student_course_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
    completed_lessons INTEGER NOT NULL DEFAULT 0,
    total_lessons INTEGER NOT NULL DEFAULT 0,
    module_progress JSONB,
    streak_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    last_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, course_id)
);

-- Student Project Submissions
CREATE TABLE IF NOT EXISTS student_project_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    project_title TEXT NOT NULL,
    description TEXT,
    submission_url TEXT,
    attachments JSONB,
    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'under_review', 'approved', 'needs_revision', 'rejected')),
    grade NUMERIC(5, 2),
    feedback TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, project_title)
);

-- ============================================================================
-- TRAINER ALLOCATION TABLES (Admin System)
-- ============================================================================

-- Trainer Allocations (Admin-managed trainer assignments)
CREATE TABLE IF NOT EXISTS trainer_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    requested_by UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'completed', 'cancelled')),
    allocated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    allocated_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    notes TEXT,
    metadata JSONB, -- Can include sessionCount, schedule info, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate approved allocations
CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_unique_approved
    ON trainer_allocations(student_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status = 'approved';

-- ============================================================================
-- STUDENT SUPPORT AND COMMUNICATION TABLES
-- ============================================================================

-- Support Tickets
CREATE TABLE IF NOT EXISTS student_support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    email CITEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    metadata JSONB,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reschedule Requests
CREATE TABLE IF NOT EXISTS student_reschedule_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES session_bookings(id) ON DELETE SET NULL,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    current_schedule JSONB, -- Current schedule details
    preferred_slots TEXT[], -- Array of preferred time slots
    meeting_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'rescheduled', 'cancelled')),
    admin_notes TEXT,
    student_notes TEXT,
    requested_for TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PAYMENT AND WALLET TABLES
-- ============================================================================

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount_cents BIGINT NOT NULL, -- Store in cents to avoid floating point issues
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled')),
    payment_method TEXT,
    provider TEXT, -- 'razorpay', 'stripe', etc.
    provider_payment_id TEXT,
    description TEXT,
    metadata JSONB,
    payment_url TEXT,
    expires_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Coin Wallets
CREATE TABLE IF NOT EXISTS coin_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    balance BIGINT NOT NULL DEFAULT 0, -- Store in smallest unit (paise for INR)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Coin Transactions (Audit trail for wallet changes)
CREATE TABLE IF NOT EXISTS coin_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES coin_wallets(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL, -- Positive for credits, negative for debits
    type TEXT NOT NULL, -- 'earned', 'spent', 'refunded', etc.
    reference_id UUID, -- Link to payment, purchase, etc.
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ANALYTICS AND TRACKING TABLES
-- ============================================================================

-- Analytics Events (from MongoDB analytics model)
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    user_id UUID NOT NULL, -- Can reference students or trainers
    user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer', 'admin')),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    session_id UUID REFERENCES purchase_sessions(id) ON DELETE SET NULL,
    booking_id UUID REFERENCES session_bookings(id) ON DELETE SET NULL,
    metadata JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- NOTIFICATION AND DEVICE TABLES
-- ============================================================================

-- Device Tokens (from MongoDB deviceToken model)
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Can reference students or trainers
    user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer')),
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_id TEXT,
    device_name TEXT,
    app_version TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications (from MongoDB notification model)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Can reference students or trainers
    user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer', 'admin')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('course', 'assignment', 'achievement', 'payment', 'system')),
    read BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SAFETY AND MONITORING TABLES
-- ============================================================================

-- Safety Incidents
CREATE TABLE IF NOT EXISTS safety_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    user_role TEXT NOT NULL CHECK (user_role IN ('student', 'trainer', 'admin')),
    type TEXT NOT NULL CHECK (type IN ('emergency', 'safety', 'medical', 'security', 'other')),
    description TEXT NOT NULL,
    location JSONB NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'reported'
        CHECK (status IN ('reported', 'acknowledged', 'investigating', 'resolved', 'closed', 'cancelled')),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PERFORMANCE TRACKING TABLES
-- ============================================================================

-- Trainer Performance Metrics
CREATE TABLE IF NOT EXISTS trainer_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL UNIQUE REFERENCES trainers(id) ON DELETE CASCADE,
    completed_sessions INTEGER NOT NULL DEFAULT 0,
    cancelled_sessions INTEGER NOT NULL DEFAULT 0,
    active_students INTEGER NOT NULL DEFAULT 0,
    average_attendance NUMERIC(5, 2),
    average_feedback_score NUMERIC(3, 2),
    response_time_minutes NUMERIC(6, 2),
    on_time_rate NUMERIC(5, 2),
    earnings_total NUMERIC(12, 2),
    earnings_month NUMERIC(10, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Core lookup indexes
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_trainers_email ON trainers(email);
CREATE INDEX IF NOT EXISTS idx_trainers_status ON trainers(status);
CREATE INDEX IF NOT EXISTS idx_trainers_verified ON trainers(verified);

-- Location-based indexes
CREATE INDEX IF NOT EXISTS idx_trainer_locations_available ON trainer_locations(available) WHERE available = true;
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
CREATE INDEX IF NOT EXISTS idx_student_course_progress_student ON student_course_progress(student_id);

-- Admin and security indexes
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id, user_role);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, user_role, read, created_at DESC);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id, user_role);
CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(timestamp DESC);

-- Trainer allocation indexes
CREATE INDEX IF NOT EXISTS idx_trainer_allocations_student ON trainer_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_trainer_allocations_trainer ON trainer_allocations(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_allocations_status ON trainer_allocations(status);

-- Payment indexes
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider_payment_id);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at columns
DO $$
DECLARE
    table_name text;
BEGIN
    FOR table_name IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
            'admin_users', 'admin_roles', 'students', 'trainers', 'trainer_profiles',
            'trainer_locations', 'student_profiles', 'courses', 'session_bookings',
            'course_purchases', 'purchase_sessions', 'attendance_records', 'certificates',
            'student_course_progress', 'student_project_submissions', 'trainer_allocations',
            'student_support_tickets', 'student_reschedule_requests', 'payments',
            'coin_wallets', 'analytics_events', 'device_tokens', 'notifications',
            'safety_incidents', 'trainer_performance', 'cities', 'zones', 'clusters'
        )
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON %I', table_name, table_name);
        EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', table_name, table_name);
    END LOOP;
END $$;

-- ============================================================================
-- CONSTRAINTS AND VALIDATION
-- ============================================================================

-- Ensure trainer availability is updated when location changes
CREATE OR REPLACE FUNCTION update_trainer_location_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_trainer_locations_timestamp ON trainer_locations;
CREATE TRIGGER update_trainer_locations_timestamp
    BEFORE UPDATE ON trainer_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_trainer_location_timestamp();

-- ============================================================================
-- DATA VALIDATION FUNCTIONS
-- ============================================================================

-- Function to validate email format
CREATE OR REPLACE FUNCTION validate_email_format(email text)
RETURNS boolean AS $$
BEGIN
    RETURN email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$ language 'plpgsql';

-- Function to validate phone format (Indian phones)
CREATE OR REPLACE FUNCTION validate_phone_format(phone text)
RETURNS boolean AS $$
BEGIN
    RETURN phone ~ '^[6-9]\d{9}$'; -- Indian mobile format
END;
$$ language 'plpgsql';

-- ============================================================================
-- USEFUL VIEWS FOR COMMON QUERIES
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
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE students IS 'Core student user accounts';
COMMENT ON TABLE trainers IS 'Core trainer user accounts';
COMMENT ON TABLE session_bookings IS 'Core booking records for tutoring sessions';
COMMENT ON TABLE course_purchases IS 'Detailed purchase records with trainer assignment';
COMMENT ON TABLE purchase_sessions IS 'Individual scheduled sessions within purchases';
COMMENT ON TABLE trainer_allocations IS 'Admin-managed trainer-student assignments';
COMMENT ON TABLE trainer_locations IS 'Real-time trainer location tracking for service matching';
COMMENT ON TABLE attendance_records IS 'Daily attendance tracking for sessions';
COMMENT ON TABLE trainer_performance IS 'Aggregated performance metrics for trainers';

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
