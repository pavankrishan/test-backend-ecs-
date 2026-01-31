# Trainer Application Approval Flow - Pseudocode

## Overview
This document provides pseudocode for the transactional approval flow that copies data from application-stage tables to permanent trainer tables.

## Database Transaction Flow

```
FUNCTION approve_trainer_application(
    application_id: UUID,
    reviewed_by: UUID,
    review_notes: TEXT (optional)
) RETURNS JSON

BEGIN TRANSACTION
    TRY:
        // ================================================================
        // PHASE 1: Validation
        // ================================================================
        
        SELECT trainer_id 
        FROM trainer_applications 
        WHERE id = application_id 
            AND review_status = 'PENDING'
        INTO v_trainer_id;
        
        IF v_trainer_id IS NULL THEN
            RAISE EXCEPTION 'Application not found or not in PENDING status';
        END IF;
        
        // ================================================================
        // PHASE 2: Copy Skills (Application → Permanent)
        // ================================================================
        
        INSERT INTO trainer_skills (
            trainer_id,
            skill_id,
            created_at,
            updated_at
        )
        SELECT 
            v_trainer_id,
            skill_id,
            created_at,
            NOW()
        FROM trainer_application_skills
        WHERE trainer_application_id = application_id
        ON CONFLICT (trainer_id, skill_id) DO UPDATE SET
            updated_at = NOW();
        
        skills_copied = ROW_COUNT;
        
        // ================================================================
        // PHASE 3: Copy Courses (Application → Permanent)
        // ================================================================
        
        INSERT INTO trainer_courses (
            trainer_id,
            course_id,
            certification_status,
            created_at,
            updated_at
        )
        SELECT 
            v_trainer_id,
            course_id,
            'pending',  // Initial certification status
            created_at,
            NOW()
        FROM trainer_application_courses
        WHERE trainer_application_id = application_id
        ON CONFLICT (trainer_id, course_id) DO UPDATE SET
            updated_at = NOW();
        
        courses_copied = ROW_COUNT;
        
        // ================================================================
        // PHASE 4: Update Application Status
        // ================================================================
        
        UPDATE trainer_applications
        SET 
            review_status = 'APPROVED',
            reviewed_by = reviewed_by,
            reviewed_at = NOW(),
            review_notes = COALESCE(review_notes, review_notes),
            application_stage = 'approved',
            updated_at = NOW()
        WHERE id = application_id;
        
        // ================================================================
        // PHASE 5: Build Response
        // ================================================================
        
        result = {
            status: 'approved',
            application_id: application_id,
            trainer_id: v_trainer_id,
            skills_copied: skills_copied,
            courses_copied: courses_copied,
            reviewed_by: reviewed_by,
            reviewed_at: NOW()
        };
        
        COMMIT TRANSACTION;
        RETURN result;
        
    CATCH EXCEPTION:
        ROLLBACK TRANSACTION;
        RAISE EXCEPTION 'Failed to approve trainer application: ' + error_message;
    END TRY
END FUNCTION
```

## Application-Level Usage Pattern

```typescript
// TypeScript/Node.js example
async function approveTrainerApplication(
    applicationId: string,
    adminUserId: string,
    reviewNotes?: string
): Promise<ApprovalResult> {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Call the database function
        const result = await client.query(
            `SELECT approve_trainer_application($1, $2, $3) AS result`,
            [applicationId, adminUserId, reviewNotes]
        );
        
        await client.query('COMMIT');
        
        return result.rows[0].result;
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Approval failed: ${error.message}`);
    } finally {
        client.release();
    }
}
```

## Key Design Principles

1. **Atomicity**: All operations occur within a single database transaction
2. **Isolation**: Application data remains separate until approval
3. **Audit Trail**: Application records are NOT deleted (preserved for compliance)
4. **Idempotency**: Function can be safely retried (uses ON CONFLICT)
5. **Validation**: Checks application status before processing
6. **Error Handling**: Automatic rollback on any failure

## Data Flow Diagram

```
┌─────────────────────────────────────┐
│  trainer_applications               │
│  (review_status = 'PENDING')         │
└──────────────┬──────────────────────┘
               │
               ├──────────────────────────────┐
               │                              │
               ▼                              ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ trainer_application_    │  │ trainer_application_     │
│ skills                   │  │ courses                  │
│ (provisional)            │  │ (provisional, MAX 3)     │
└──────────────┬───────────┘  └──────────────┬───────────┘
               │                              │
               │  [APPROVAL FUNCTION]         │
               │                              │
               ▼                              ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ trainer_skills           │  │ trainer_courses           │
│ (permanent)              │  │ (permanent)               │
└──────────────────────────┘  └──────────────────────────┘
               │                              │
               └──────────────┬───────────────┘
                              │
                              ▼
               ┌──────────────────────────┐
               │ trainer_applications     │
               │ (review_status =         │
               │  'APPROVED')             │
               └──────────────────────────┘
```

## Rejection Flow

When an application is rejected, no data is copied to permanent tables:

```sql
-- Simple rejection (no data copying needed)
UPDATE trainer_applications
SET 
    review_status = 'REJECTED',
    reviewed_by = p_reviewed_by,
    reviewed_at = NOW(),
    review_notes = p_review_notes,
    application_stage = 'rejected',
    updated_at = NOW()
WHERE id = p_application_id
    AND review_status = 'PENDING';
```

Application-stage data (`trainer_application_skills` and `trainer_application_courses`) remains in the database for audit purposes but is never copied to permanent tables.


