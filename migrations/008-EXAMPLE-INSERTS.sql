-- ============================================================================
-- EXAMPLE INSERT STATEMENTS - Application Stage
-- ============================================================================
-- These examples demonstrate how to insert data during application submission
-- Replace UUIDs with actual values from your application
-- ============================================================================

-- ============================================================================
-- EXAMPLE 1: Insert Skills for a Trainer Application
-- ============================================================================
-- Scenario: Trainer selects multiple skills during application
-- Assumptions:
--   - trainer_application_id = '123e4567-e89b-12d3-a456-426614174000'
--   - skill_id values from skills table (e.g., 'Python', 'JavaScript', 'React')

INSERT INTO trainer_application_skills (trainer_application_id, skill_id)
VALUES 
    ('123e4567-e89b-12d3-a456-426614174000', 'skill-uuid-python'),
    ('123e4567-e89b-12d3-a456-426614174000', 'skill-uuid-javascript'),
    ('123e4567-e89b-12d3-a456-426614174000', 'skill-uuid-react'),
    ('123e4567-e89b-12d3-a456-426614174000', 'skill-uuid-nodejs');

-- Alternative: Using a subquery to find skill IDs by name
INSERT INTO trainer_application_skills (trainer_application_id, skill_id)
SELECT 
    '123e4567-e89b-12d3-a456-426614174000'::UUID,
    id
FROM skills
WHERE name IN ('Python', 'JavaScript', 'React', 'Node.js')
    AND is_active = true;

-- ============================================================================
-- EXAMPLE 2: Insert Courses with Preference Order (MAX 3)
-- ============================================================================
-- Scenario: Trainer selects up to 3 preferred courses with preference ordering
-- Assumptions:
--   - trainer_application_id = '123e4567-e89b-12d3-a456-426614174000'
--   - course_id values from courses table
--   - preference_order: 1 = highest preference, 2 = second, 3 = third

INSERT INTO trainer_application_courses (trainer_application_id, course_id, preference_order)
VALUES 
    ('123e4567-e89b-12d3-a456-426614174000', 'course-uuid-ai', 1),      -- Highest preference
    ('123e4567-e89b-12d3-a456-426614174000', 'course-uuid-robotics', 2), -- Second preference
    ('123e4567-e89b-12d3-a456-426614174000', 'course-uuid-coding', 3);  -- Third preference

-- Alternative: Using a subquery to find course IDs by code
INSERT INTO trainer_application_courses (trainer_application_id, course_id, preference_order)
SELECT 
    '123e4567-e89b-12d3-a456-426614174000'::UUID,
    id,
    CASE code
        WHEN 'AI' THEN 1
        WHEN 'ROBOTICS' THEN 2
        WHEN 'CODING' THEN 3
    END AS preference_order
FROM courses
WHERE code IN ('AI', 'ROBOTICS', 'CODING')
    AND is_active = true;

-- ============================================================================
-- EXAMPLE 3: Complete Application Submission Flow
-- ============================================================================
-- Scenario: Full application submission with skills and courses
-- This demonstrates a complete transaction for application submission

BEGIN;

-- Step 1: Create or get trainer_application record
-- (Assuming this already exists from the main application form)

-- Step 2: Insert skills
INSERT INTO trainer_application_skills (trainer_application_id, skill_id)
SELECT 
    '123e4567-e89b-12d3-a456-426614174000'::UUID,
    id
FROM skills
WHERE name IN ('Python', 'Machine Learning', 'Data Science')
    AND is_active = true;

-- Step 3: Insert courses (MAX 3)
INSERT INTO trainer_application_courses (trainer_application_id, course_id, preference_order)
SELECT 
    '123e4567-e89b-12d3-a456-426614174000'::UUID,
    id,
    CASE code
        WHEN 'AI' THEN 1
        WHEN 'DATA_SCIENCE' THEN 2
        WHEN 'ML' THEN 3
    END
FROM courses
WHERE code IN ('AI', 'DATA_SCIENCE', 'ML')
    AND is_active = true
LIMIT 3;  -- Application-level safety (database also enforces via constraints)

COMMIT;

-- ============================================================================
-- EXAMPLE 4: Approve Application (Copy to Permanent Tables)
-- ============================================================================
-- Scenario: Admin approves the application, copying data to permanent tables
-- This uses the transactional approval function

SELECT approve_trainer_application(
    '123e4567-e89b-12d3-a456-426614174000'::UUID,
    'admin-uuid-here'::UUID,
    'Approved after document verification and background check'
);

-- Expected response (JSON):
-- {
--   "status": "approved",
--   "application_id": "123e4567-e89b-12d3-a456-426614174000",
--   "trainer_id": "trainer-uuid-here",
--   "skills_copied": 3,
--   "courses_copied": 3,
--   "reviewed_by": "admin-uuid-here",
--   "reviewed_at": "2024-01-15T10:30:00Z"
-- }

-- ============================================================================
-- EXAMPLE 5: Reject Application (No Data Copying)
-- ============================================================================
-- Scenario: Admin rejects the application
-- No data is copied to permanent tables; application records remain for audit

UPDATE trainer_applications
SET 
    review_status = 'REJECTED',
    reviewed_by = 'admin-uuid-here'::UUID,
    reviewed_at = NOW(),
    review_notes = 'Insufficient qualifications for requested courses',
    application_stage = 'rejected',
    updated_at = NOW()
WHERE id = '123e4567-e89b-12d3-a456-426614174000'::UUID
    AND review_status = 'PENDING';

-- ============================================================================
-- EXAMPLE 6: Query Application Data (Before Approval)
-- ============================================================================
-- Scenario: View application details including skills and courses

SELECT 
    ta.id AS application_id,
    ta.trainer_id,
    ta.review_status,
    ta.application_stage,
    -- Skills
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'skill_id', s.id,
            'skill_name', s.name
        )) FILTER (WHERE s.id IS NOT NULL),
        '[]'::json
    ) AS skills,
    -- Courses with preference order
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'course_id', c.id,
            'course_code', c.code,
            'course_name', c.name,
            'preference_order', tac.preference_order
        ) ORDER BY tac.preference_order) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
    ) AS courses
FROM trainer_applications ta
LEFT JOIN trainer_application_skills tas ON ta.id = tas.trainer_application_id
LEFT JOIN skills s ON tas.skill_id = s.id
LEFT JOIN trainer_application_courses tac ON ta.id = tac.trainer_application_id
LEFT JOIN courses c ON tac.course_id = c.id
WHERE ta.id = '123e4567-e89b-12d3-a456-426614174000'::UUID
GROUP BY ta.id, ta.trainer_id, ta.review_status, ta.application_stage;

-- ============================================================================
-- EXAMPLE 7: Verify Data Integrity After Approval
-- ============================================================================
-- Scenario: Compare application data vs permanent data after approval

SELECT 
    ta.id AS application_id,
    ta.trainer_id,
    ta.review_status,
    -- Application-stage counts
    (SELECT COUNT(*) FROM trainer_application_skills WHERE trainer_application_id = ta.id) AS app_skills_count,
    (SELECT COUNT(*) FROM trainer_application_courses WHERE trainer_application_id = ta.id) AS app_courses_count,
    -- Permanent table counts
    (SELECT COUNT(*) FROM trainer_skills WHERE trainer_id = ta.trainer_id) AS permanent_skills_count,
    (SELECT COUNT(*) FROM trainer_courses WHERE trainer_id = ta.trainer_id) AS permanent_courses_count
FROM trainer_applications ta
WHERE ta.id = '123e4567-e89b-12d3-a456-426614174000'::UUID
    AND ta.review_status = 'APPROVED';

-- Expected: app_skills_count should match permanent_skills_count
-- Expected: app_courses_count should match permanent_courses_count

-- ============================================================================
-- END OF EXAMPLES
-- ============================================================================


