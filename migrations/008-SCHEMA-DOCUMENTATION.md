# Trainer Application Skills & Courses Schema - Complete Documentation

## Overview

This migration implements enterprise-grade application-stage junction tables for trainer skills and courses, with a transactional approval flow that copies data to permanent trainer tables upon approval.

## Architecture Principles

### Absolute Rules (DO NOT VIOLATE)
- ✅ **NEVER** store comma-separated values or arrays for skills or courses
- ✅ **NEVER** write application-stage data into `trainer_skills` or `trainer_courses`
- ✅ Application data must be isolated and safely discardable
- ✅ Existing tables must NOT be modified or dropped

### Design Philosophy
1. **Separation of Concerns**: Application data is completely isolated from production data
2. **Audit Trail**: Application records are preserved even after approval/rejection
3. **Data Integrity**: Database-level constraints enforce business rules
4. **Transactional Safety**: All approval operations are atomic
5. **Scalability**: Proper indexing for production workloads

## Schema Structure

### Table 1: `trainer_application_skills`

**Purpose**: Store provisional skill selections during application process

**Columns**:
- `id` (UUID, PK) - Primary key
- `trainer_application_id` (UUID, FK → `trainer_applications.id`) - Application reference
- `skill_id` (UUID, FK → `skills.id`) - Skill reference
- `created_at` (TIMESTAMPTZ) - Audit timestamp

**Constraints**:
- `UNIQUE (trainer_application_id, skill_id)` - Prevents duplicate skill assignments

**Indexes**:
- `idx_trainer_application_skills_application` - On `trainer_application_id`
- `idx_trainer_application_skills_skill` - On `skill_id`
- `idx_trainer_application_skills_created` - On `created_at DESC`

### Table 2: `trainer_application_courses`

**Purpose**: Store provisional course selections with preference ordering (MAX 3)

**Columns**:
- `id` (UUID, PK) - Primary key
- `trainer_application_id` (UUID, FK → `trainer_applications.id`) - Application reference
- `course_id` (UUID, FK → `courses.id`) - Course reference
- `preference_order` (INTEGER, 1-3) - Preference ranking
- `created_at` (TIMESTAMPTZ) - Audit timestamp

**Constraints**:
- `UNIQUE (trainer_application_id, course_id)` - Prevents duplicate course assignments
- `UNIQUE (trainer_application_id, preference_order)` - Enforces max 3 courses (1, 2, 3)
- `CHECK (preference_order >= 1 AND preference_order <= 3)` - Validates range

**Indexes**:
- `idx_trainer_application_courses_application` - On `trainer_application_id`
- `idx_trainer_application_courses_course` - On `course_id`
- `idx_trainer_application_courses_order` - On `(trainer_application_id, preference_order)`
- `idx_trainer_application_courses_created` - On `created_at DESC`

## Database Functions

### Function 1: `check_max_courses_per_application()`

**Purpose**: Trigger function enforcing maximum 3 courses per application

**Trigger**: `trigger_check_max_courses` (BEFORE INSERT OR UPDATE)

**Logic**:
- Counts existing courses for the application
- Rejects INSERT if count >= 3
- Rejects UPDATE if count >= 3 (excluding current row)
- Provides explicit error messaging

**Defense-in-Depth**: Works alongside UNIQUE constraint on `(trainer_application_id, preference_order)`

### Function 2: `approve_trainer_application()`

**Purpose**: Transactional approval function that copies data to permanent tables

**Parameters**:
- `p_application_id` (UUID) - Application to approve
- `p_reviewed_by` (UUID) - Admin user ID
- `p_review_notes` (TEXT, optional) - Review notes

**Returns**: JSON object with approval status and counts

**Operations** (all atomic):
1. Validates application exists and is in PENDING status
2. Copies skills: `trainer_application_skills` → `trainer_skills`
3. Copies courses: `trainer_application_courses` → `trainer_courses`
4. Updates `trainer_applications.review_status` to 'APPROVED'
5. Returns JSON with operation results

**Error Handling**: Automatic rollback on any failure

## Data Flow

### Application Submission Flow

```
1. Trainer submits application
   ↓
2. Insert into trainer_applications
   ↓
3. Insert into trainer_application_skills (multiple skills)
   ↓
4. Insert into trainer_application_courses (MAX 3 courses)
   ↓
5. Application status: PENDING
```

### Approval Flow

```
1. Admin calls approve_trainer_application()
   ↓
2. BEGIN TRANSACTION
   ↓
3. Copy trainer_application_skills → trainer_skills
   ↓
4. Copy trainer_application_courses → trainer_courses
   ↓
5. Update trainer_applications.review_status = 'APPROVED'
   ↓
6. COMMIT TRANSACTION
   ↓
7. Return JSON result
```

### Rejection Flow

```
1. Admin updates trainer_applications.review_status = 'REJECTED'
   ↓
2. No data copied to permanent tables
   ↓
3. Application records preserved for audit
```

## Usage Examples

### Insert Skills During Application

```sql
INSERT INTO trainer_application_skills (trainer_application_id, skill_id)
VALUES 
    ('app-uuid-1', 'skill-uuid-1'),
    ('app-uuid-1', 'skill-uuid-2'),
    ('app-uuid-1', 'skill-uuid-3');
```

### Insert Courses with Preference Order

```sql
INSERT INTO trainer_application_courses (trainer_application_id, course_id, preference_order)
VALUES 
    ('app-uuid-1', 'course-uuid-1', 1),  -- Highest preference
    ('app-uuid-1', 'course-uuid-2', 2),  -- Second preference
    ('app-uuid-1', 'course-uuid-3', 3);  -- Third preference
```

### Approve Application

```sql
SELECT approve_trainer_application(
    'app-uuid-1'::UUID,
    'admin-uuid-1'::UUID,
    'Approved after document verification'
);
```

### Reject Application

```sql
UPDATE trainer_applications
SET 
    review_status = 'REJECTED',
    reviewed_by = 'admin-uuid-1'::UUID,
    reviewed_at = NOW(),
    review_notes = 'Insufficient qualifications',
    application_stage = 'rejected',
    updated_at = NOW()
WHERE id = 'app-uuid-1'::UUID
    AND review_status = 'PENDING';
```

## Verification Queries

### Check Application Skills Count

```sql
SELECT 
    ta.id AS application_id,
    ta.trainer_id,
    COUNT(tas.id) AS skills_count
FROM trainer_applications ta
LEFT JOIN trainer_application_skills tas ON ta.id = tas.trainer_application_id
GROUP BY ta.id, ta.trainer_id;
```

### Check Application Courses Count (should be <= 3)

```sql
SELECT 
    ta.id AS application_id,
    ta.trainer_id,
    COUNT(tac.id) AS courses_count,
    STRING_AGG(tac.preference_order::TEXT, ', ' ORDER BY tac.preference_order) AS preference_orders
FROM trainer_applications ta
LEFT JOIN trainer_application_courses tac ON ta.id = tac.trainer_application_id
GROUP BY ta.id, ta.trainer_id
HAVING COUNT(tac.id) > 3;  -- Should return no rows
```

### Compare Application vs Permanent Data (After Approval)

```sql
SELECT 
    ta.id AS application_id,
    ta.trainer_id,
    ta.review_status,
    (SELECT COUNT(*) FROM trainer_application_skills WHERE trainer_application_id = ta.id) AS app_skills,
    (SELECT COUNT(*) FROM trainer_skills WHERE trainer_id = ta.trainer_id) AS permanent_skills,
    (SELECT COUNT(*) FROM trainer_application_courses WHERE trainer_application_id = ta.id) AS app_courses,
    (SELECT COUNT(*) FROM trainer_courses WHERE trainer_id = ta.trainer_id) AS permanent_courses
FROM trainer_applications ta
WHERE ta.review_status = 'APPROVED';
```

## Security & Compliance

### Audit Trail
- All application records preserved (never deleted)
- `created_at` timestamps on all tables
- `reviewed_by` and `reviewed_at` on approvals
- `review_notes` for documentation

### Data Isolation
- Application data completely separate from production data
- No risk of polluting permanent tables with unapproved data
- Safe to discard application data if needed (though preserved for audit)

### Transaction Safety
- All approval operations atomic
- Automatic rollback on failure
- No partial state possible

## Performance Considerations

### Indexing Strategy
- All foreign keys indexed for join performance
- Composite indexes for common query patterns
- Descending indexes for time-based queries

### Scalability
- UUID primary keys for distributed systems
- Efficient constraint checking
- Optimized trigger functions

## Migration Files

1. **008-trainer-application-skills-courses-ENHANCED.sql** - Main migration file
2. **008-APPROVAL-FLOW-PSEUDOCODE.md** - Pseudocode documentation
3. **008-EXAMPLE-INSERTS.sql** - Example INSERT statements
4. **008-SCHEMA-DOCUMENTATION.md** - This file (complete documentation)

## Testing Checklist

- [ ] Create application with skills
- [ ] Create application with courses (1, 2, 3 courses)
- [ ] Attempt to insert 4th course (should fail)
- [ ] Approve application (verify data copied)
- [ ] Reject application (verify no data copied)
- [ ] Verify UNIQUE constraints work
- [ ] Verify trigger enforces max 3 courses
- [ ] Test transaction rollback on error
- [ ] Verify indexes are created
- [ ] Performance test with large datasets

## Support

For questions or issues, refer to:
- Main migration file: `008-trainer-application-skills-courses-ENHANCED.sql`
- Approval flow: `008-APPROVAL-FLOW-PSEUDOCODE.md`
- Examples: `008-EXAMPLE-INSERTS.sql`
