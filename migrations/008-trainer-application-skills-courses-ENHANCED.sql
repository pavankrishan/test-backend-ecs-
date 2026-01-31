-- ============================================================================
-- MIGRATION: 008 - TRAINER APPLICATION SKILLS & COURSES JUNCTION TABLES
-- ============================================================================
-- Enterprise-grade schema extension for trainer application system
-- 
-- PURPOSE:
--   - Isolate application-stage data from permanent trainer tables
--   - Enable provisional skill/course selection during application
--   - Provide transactional approval flow to copy data to permanent tables
--   - Maintain audit trail and legal compliance
--
-- ABSOLUTE RULES (DO NOT VIOLATE):
--   - NEVER store comma-separated values or arrays for skills/courses
--   - NEVER write application-stage data into trainer_skills or trainer_courses
--   - Application data must be isolated and safely discardable
--   - Existing tables must NOT be modified or dropped
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE: trainer_application_skills
-- ============================================================================
-- Application-stage junction table for trainer skills
-- Stores provisional skill selections during application process
-- Data is copied to trainer_skills only upon approval
CREATE TABLE IF NOT EXISTS trainer_application_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_application_id UUID NOT NULL REFERENCES trainer_applications(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Prevent duplicate skill assignments per application
    CONSTRAINT uq_trainer_application_skills_application_skill 
        UNIQUE (trainer_application_id, skill_id)
);

-- Indexes for trainer_application_skills (all foreign keys indexed)
CREATE INDEX IF NOT EXISTS idx_trainer_application_skills_application 
    ON trainer_application_skills(trainer_application_id);
CREATE INDEX IF NOT EXISTS idx_trainer_application_skills_skill 
    ON trainer_application_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_trainer_application_skills_created 
    ON trainer_application_skills(created_at DESC);

-- ============================================================================
-- TABLE: trainer_application_courses
-- ============================================================================
-- Application-stage junction table for trainer courses
-- Stores provisional course selections with preference ordering (MAX 3)
-- Data is copied to trainer_courses only upon approval
CREATE TABLE IF NOT EXISTS trainer_application_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_application_id UUID NOT NULL REFERENCES trainer_applications(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    preference_order INTEGER NOT NULL CHECK (preference_order >= 1 AND preference_order <= 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Prevent duplicate course assignments per application
    CONSTRAINT uq_trainer_application_courses_application_course 
        UNIQUE (trainer_application_id, course_id),
    
    -- Prevent duplicate preference orders per application
    -- This constraint alone enforces max 3 courses (since preference_order is 1-3)
    CONSTRAINT uq_trainer_application_courses_application_order 
        UNIQUE (trainer_application_id, preference_order)
);

-- Indexes for trainer_application_courses (all foreign keys indexed)
CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_application 
    ON trainer_application_courses(trainer_application_id);
CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_course 
    ON trainer_application_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_order 
    ON trainer_application_courses(trainer_application_id, preference_order);
CREATE INDEX IF NOT EXISTS idx_trainer_application_courses_created 
    ON trainer_application_courses(created_at DESC);

-- ============================================================================
-- FUNCTION: Enforce Max 3 Courses Per Application (Trigger-Based)
-- ============================================================================
-- Database-level enforcement of business rule: MAX 3 courses per application
-- This provides defense-in-depth beyond application-level validation
-- 
-- NOTE: The UNIQUE constraint on (trainer_application_id, preference_order) 
-- already limits courses to 3 (since preference_order is 1-3), but this trigger
-- provides explicit error messaging and additional safety
CREATE OR REPLACE FUNCTION check_max_courses_per_application()
RETURNS TRIGGER AS $$
DECLARE
    existing_count INTEGER;
BEGIN
    -- For INSERT: count all existing rows for this application
    -- For UPDATE: count all rows except the one being updated
    IF TG_OP = 'INSERT' THEN
        SELECT COUNT(*) INTO existing_count
        FROM trainer_application_courses
        WHERE trainer_application_id = NEW.trainer_application_id;
        
        -- Reject if adding this row would exceed the limit of 3
        IF existing_count >= 3 THEN
            RAISE EXCEPTION 'Maximum 3 courses allowed per trainer application. Current count: %, attempting to add course with preference_order: %', 
                existing_count, NEW.preference_order;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- For UPDATE, count all rows except the one being updated
        SELECT COUNT(*) INTO existing_count
        FROM trainer_application_courses
        WHERE trainer_application_id = NEW.trainer_application_id
            AND id != NEW.id;
        
        -- Reject if updating would exceed the limit (shouldn't happen due to UNIQUE constraint, but safety check)
        IF existing_count >= 3 THEN
            RAISE EXCEPTION 'Maximum 3 courses allowed per trainer application. Current count: %', 
                existing_count;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce max 3 courses
DROP TRIGGER IF EXISTS trigger_check_max_courses ON trainer_application_courses;
CREATE TRIGGER trigger_check_max_courses
    BEFORE INSERT OR UPDATE ON trainer_application_courses
    FOR EACH ROW
    EXECUTE FUNCTION check_max_courses_per_application();

-- ============================================================================
-- FUNCTION: Approve Trainer Application (Transactional Copy)
-- ============================================================================
-- Enterprise-grade approval function that:
--   1. Copies skills from trainer_application_skills → trainer_skills
--   2. Copies courses from trainer_application_courses → trainer_courses
--   3. Updates trainer_applications review status
--   4. All operations in a single transaction (atomic)
--   5. Does NOT delete application records (audit trail preserved)
--
-- PARAMETERS:
--   p_application_id: UUID of trainer_application to approve
--   p_reviewed_by: UUID of admin user approving the application
--   p_review_notes: Optional notes from reviewer
--
-- RETURNS:
--   JSON object with approval status and counts
--
-- USAGE:
--   SELECT approve_trainer_application(
--       'application-uuid-here'::UUID,
--       'admin-uuid-here'::UUID,
--       'Approved after document verification'
--   );
-- ============================================================================
CREATE OR REPLACE FUNCTION approve_trainer_application(
    p_application_id UUID,
    p_reviewed_by UUID,
    p_review_notes TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_trainer_id UUID;
    v_skills_count INTEGER;
    v_courses_count INTEGER;
    v_result JSON;
BEGIN
    -- Validate application exists and is in approvable state
    SELECT trainer_id INTO v_trainer_id
    FROM trainer_applications
    WHERE id = p_application_id
        AND review_status = 'PENDING';
    
    IF v_trainer_id IS NULL THEN
        RAISE EXCEPTION 'Application not found or not in PENDING status. Application ID: %', p_application_id;
    END IF;
    
    -- ========================================================================
    -- PHASE 1: Copy Skills from Application to Permanent Table
    -- ========================================================================
    INSERT INTO trainer_skills (
        trainer_id,
        skill_id,
        created_at,
        updated_at
    )
    SELECT 
        v_trainer_id,
        tas.skill_id,
        tas.created_at,
        NOW()
    FROM trainer_application_skills tas
    WHERE tas.trainer_application_id = p_application_id
    ON CONFLICT (trainer_id, skill_id) DO UPDATE SET
        updated_at = NOW();
    
    GET DIAGNOSTICS v_skills_count = ROW_COUNT;
    
    -- ========================================================================
    -- PHASE 2: Copy Courses from Application to Permanent Table
    -- ========================================================================
    INSERT INTO trainer_courses (
        trainer_id,
        course_id,
        certification_status,
        created_at,
        updated_at
    )
    SELECT 
        v_trainer_id,
        tac.course_id,
        'pending'::TEXT, -- Initial certification status
        tac.created_at,
        NOW()
    FROM trainer_application_courses tac
    WHERE tac.trainer_application_id = p_application_id
    ON CONFLICT (trainer_id, course_id) DO UPDATE SET
        updated_at = NOW();
    
    GET DIAGNOSTICS v_courses_count = ROW_COUNT;
    
    -- ========================================================================
    -- PHASE 3: Update Application Review Status
    -- ========================================================================
    UPDATE trainer_applications
    SET 
        review_status = 'APPROVED',
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        review_notes = COALESCE(p_review_notes, review_notes),
        application_stage = 'approved',
        updated_at = NOW()
    WHERE id = p_application_id;
    
    -- ========================================================================
    -- PHASE 4: Build Result JSON
    -- ========================================================================
    v_result := json_build_object(
        'status', 'approved',
        'application_id', p_application_id,
        'trainer_id', v_trainer_id,
        'skills_copied', v_skills_count,
        'courses_copied', v_courses_count,
        'reviewed_by', p_reviewed_by,
        'reviewed_at', NOW()
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Transaction will rollback automatically
        RAISE EXCEPTION 'Failed to approve trainer application: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE trainer_application_skills IS 
    'Application-stage junction table for trainer skills. Provisional data isolated from permanent trainer_skills table. Data copied to trainer_skills only upon approval.';

COMMENT ON TABLE trainer_application_courses IS 
    'Application-stage junction table for trainer courses with preference ordering (MAX 3). Provisional data isolated from permanent trainer_courses table. Data copied to trainer_courses only upon approval.';

COMMENT ON COLUMN trainer_application_courses.preference_order IS 
    'Preference order for course selection (1 = highest preference, 2 = second, 3 = third). Maximum 3 courses per application enforced at database level via UNIQUE constraint and trigger.';

COMMENT ON FUNCTION approve_trainer_application IS 
    'Transactional approval function. Copies skills and courses from application tables to permanent trainer tables. Updates application review status. All operations atomic within single transaction. Does NOT delete application records (audit trail preserved).';

COMMENT ON FUNCTION check_max_courses_per_application IS 
    'Trigger function enforcing maximum 3 courses per trainer application. Provides database-level defense-in-depth beyond application validation. Handles both INSERT and UPDATE operations correctly.';

COMMIT;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================


