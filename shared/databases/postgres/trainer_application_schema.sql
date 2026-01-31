-- ============================================================================
-- TRAINER APPLICATION SYSTEM - ENTERPRISE-GRADE SCHEMA
-- ============================================================================
-- This schema implements the refactored trainer application system with:
-- 1. Legal compliance (dateOfBirth instead of age)
-- 2. Raw location collection (separate from final service assignment)
-- 3. Normalized availability slots (1-hour slots from time ranges)
-- 4. Document verification pipeline
-- 5. Course and skills normalization
-- ============================================================================

-- ============================================================================
-- TRAINER APPLICATION TABLE
-- ============================================================================
-- Stores raw application data before admin review
-- Location is collected loosely; city/zone assignment happens during review
CREATE TABLE IF NOT EXISTS trainer_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    
    -- Personal Information (Legal Compliance)
    date_of_birth DATE NOT NULL, -- Replaces age field for legal compliance
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
    
    -- Raw Location Data (Application Phase)
    -- These are collected loosely and NOT validated against service areas
    address_text TEXT, -- Optional address for human review
    latitude NUMERIC(10, 8), -- GPS latitude (preferred)
    longitude NUMERIC(11, 8), -- GPS longitude (preferred)
    pincode TEXT, -- Optional pincode for reviewer context
    
    -- Review Status
    review_status TEXT NOT NULL DEFAULT 'PENDING' 
        CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ON_HOLD')),
    reviewed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT, -- Admin notes during review
    
    -- Final Service Assignment (Set during approval)
    city_id UUID REFERENCES cities(id) ON DELETE SET NULL, -- Assigned during review
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL, -- Assigned during review
    
    -- Consent Flags (Legal Requirement)
    consent_info_correct BOOLEAN NOT NULL DEFAULT false,
    consent_background_verification BOOLEAN NOT NULL DEFAULT false,
    consent_travel_to_students BOOLEAN NOT NULL DEFAULT false,
    
    -- Application Metadata
    application_stage TEXT NOT NULL DEFAULT 'submitted'
        CHECK (application_stage IN ('submitted', 'document_verification', 'under_review', 'approved', 'rejected')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one active application per trainer
    UNIQUE(trainer_id)
);

-- Indexes for trainer_applications
CREATE INDEX IF NOT EXISTS idx_trainer_applications_trainer ON trainer_applications(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_applications_review_status ON trainer_applications(review_status);
CREATE INDEX IF NOT EXISTS idx_trainer_applications_stage ON trainer_applications(application_stage);
CREATE INDEX IF NOT EXISTS idx_trainer_applications_city ON trainer_applications(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trainer_applications_zone ON trainer_applications(zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trainer_applications_location ON trainer_applications(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ============================================================================
-- TRAINER AVAILABILITY TABLE
-- ============================================================================
-- Stores normalized 1-hour time slots (NOT free text ranges)
-- Backend converts time ranges into discrete slots
CREATE TABLE IF NOT EXISTS trainer_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    
    -- Normalized 1-hour slot
    slot_start TIME NOT NULL, -- Format: HH:MM:SS (e.g., 18:00:00)
    slot_end TIME NOT NULL, -- Must be slot_start + 1 hour
    
    -- Employment type determines how slots are generated
    employment_type TEXT NOT NULL CHECK (employment_type IN ('full-time', 'part-time')),
    
    -- Constraints enforced at database level
    CONSTRAINT slot_duration_check CHECK (slot_end = slot_start + INTERVAL '1 hour'),
    CONSTRAINT slot_start_range CHECK (slot_start >= '06:00:00'),
    CONSTRAINT slot_end_range CHECK (slot_end <= '21:00:00'),
    CONSTRAINT slot_minutes_zero CHECK (
        EXTRACT(MINUTE FROM slot_start) = 0 AND 
        EXTRACT(SECOND FROM slot_start) = 0 AND
        EXTRACT(MINUTE FROM slot_end) = 0 AND 
        EXTRACT(SECOND FROM slot_end) = 0
    ),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One slot per trainer per time
    UNIQUE(trainer_id, slot_start)
);

-- Indexes for trainer_availability
CREATE INDEX IF NOT EXISTS idx_trainer_availability_trainer ON trainer_availability(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_availability_slot ON trainer_availability(slot_start, slot_end);
CREATE INDEX IF NOT EXISTS idx_trainer_availability_type ON trainer_availability(employment_type);

-- ============================================================================
-- COURSES TABLE (Normalized)
-- ============================================================================
-- Predefined courses that trainers can teach
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL, -- e.g., 'AI', 'ROBOTICS', 'CODING'
    name TEXT NOT NULL, -- e.g., 'Artificial Intelligence'
    description TEXT,
    category TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TRAINER COURSES TABLE (Many-to-Many)
-- ============================================================================
-- Links trainers to courses (max 3 courses enforced at application level)
CREATE TABLE IF NOT EXISTS trainer_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    certified_at TIMESTAMPTZ, -- When trainer was certified for this course
    certification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (certification_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(trainer_id, course_id)
);

-- Indexes for trainer_courses
CREATE INDEX IF NOT EXISTS idx_trainer_courses_trainer ON trainer_courses(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_courses_course ON trainer_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_trainer_courses_status ON trainer_courses(certification_status);

-- ============================================================================
-- SKILLS TABLE (Normalized)
-- ============================================================================
-- Predefined skills that can be assigned to trainers
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL, -- Normalized: lowercase, trimmed
    category TEXT, -- e.g., 'programming', 'design', 'teaching'
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TRAINER SKILLS TABLE (Many-to-Many)
-- ============================================================================
-- Links trainers to normalized skills
CREATE TABLE IF NOT EXISTS trainer_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    proficiency_level TEXT CHECK (proficiency_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(trainer_id, skill_id)
);

-- Indexes for trainer_skills
CREATE INDEX IF NOT EXISTS idx_trainer_skills_trainer ON trainer_skills(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_skills_skill ON trainer_skills(skill_id);

-- ============================================================================
-- TRAINER DOCUMENTS TABLE
-- ============================================================================
-- Document verification pipeline
CREATE TABLE IF NOT EXISTS trainer_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    application_id UUID REFERENCES trainer_applications(id) ON DELETE SET NULL,
    
    document_type TEXT NOT NULL 
        CHECK (document_type IN ('id_proof', 'qualification', 'experience_certificate', 'face_verification')),
    file_url TEXT NOT NULL, -- Secure file URL
    file_name TEXT,
    file_size_bytes INTEGER,
    mime_type TEXT,
    
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'approved', 'rejected')),
    verified_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    
    metadata JSONB, -- Additional metadata (e.g., OCR data, face match score)
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for trainer_documents
CREATE INDEX IF NOT EXISTS idx_trainer_documents_trainer ON trainer_documents(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_documents_application ON trainer_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_trainer_documents_type ON trainer_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_trainer_documents_status ON trainer_documents(verification_status);

-- ============================================================================
-- UPDATE TRAINERS TABLE
-- ============================================================================
-- Add service status and location assignment fields to trainers table
-- These are set AFTER admin approval
ALTER TABLE trainers 
    ADD COLUMN IF NOT EXISTS service_status TEXT DEFAULT 'INACTIVE'
        CHECK (service_status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'));
    
ALTER TABLE trainers
    ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES cities(id) ON DELETE SET NULL;
    
ALTER TABLE trainers
    ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES zones(id) ON DELETE SET NULL;

-- Indexes for trainers service fields
CREATE INDEX IF NOT EXISTS idx_trainers_service_status ON trainers(service_status);
CREATE INDEX IF NOT EXISTS idx_trainers_city ON trainers(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trainers_zone ON trainers(zone_id) WHERE zone_id IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE trainer_applications IS 
    'Raw trainer application data. Location collected loosely; city/zone assigned during admin review.';

COMMENT ON TABLE trainer_availability IS 
    'Normalized 1-hour time slots. Backend converts time ranges into discrete slots. Full-time trainers have slots 08:00-20:00 auto-generated.';

COMMENT ON TABLE trainer_courses IS 
    'Trainer-course associations. Max 3 courses enforced at application validation level.';

COMMENT ON TABLE trainer_documents IS 
    'Document verification pipeline. Required documents: ID proof, face verification, qualification. Experience certificate required if experienceYears > 0.';

COMMENT ON COLUMN trainer_applications.date_of_birth IS 
    'Date of birth (replaces age field for legal compliance). Age calculated on backend, must be >= 18.';

COMMENT ON COLUMN trainer_applications.latitude IS 
    'Raw GPS latitude collected during application. NOT validated against service areas.';

COMMENT ON COLUMN trainer_applications.longitude IS 
    'Raw GPS longitude collected during application. NOT validated against service areas.';

COMMENT ON COLUMN trainer_applications.city_id IS 
    'Assigned by admin during review. NULL until approval.';

COMMENT ON COLUMN trainer_applications.zone_id IS 
    'Assigned by admin during review. NULL until approval.';

COMMENT ON COLUMN trainer_availability.slot_start IS 
    'Start time of 1-hour slot. Must be on the hour (minutes = 0).';

COMMENT ON COLUMN trainer_availability.slot_end IS 
    'End time of 1-hour slot. Must be slot_start + 1 hour.';

-- ============================================================================
-- END OF TRAINER APPLICATION SCHEMA
-- ============================================================================

