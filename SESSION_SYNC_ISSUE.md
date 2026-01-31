# Session Sync Issue: purchase_sessions vs sessions Table

## Problem

When using **auto-assignment** (booking-service), sessions are created in the `purchase_sessions` table, but the frontend and admin-service API endpoints query from the `sessions` table. This causes sessions to not appear in the frontend.

## Two Session Systems

### 1. Booking Service (Auto-Assignment)
- **Table**: `purchase_sessions`
- **Created when**: Auto-assignment assigns a trainer
- **Location**: `kc-backend/services/booking-service/src/models/purchaseSession.model.ts`
- **Created by**: `AutoTrainerAssignmentService.assignTrainer()`

### 2. Admin Service (Manual Allocation)
- **Table**: `sessions` (or `tutoring_sessions`)
- **Created when**: Admin approves a trainer allocation
- **Location**: `kc-backend/services/admin-service/src/models/session.model.ts`
- **Created by**: `AllocationService.approveAllocation()`

## Solution

We need to **sync sessions from `purchase_sessions` to `sessions` table** when a trainer is assigned via auto-assignment.

### Option 1: Sync on Assignment (Recommended)
When auto-assignment assigns a trainer, also create corresponding records in `sessions` table.

### Option 2: Unified Query
Update session API endpoints to query from both tables.

### Option 3: Background Sync Job
Create a background job that syncs `purchase_sessions` to `sessions` table periodically.

## Implementation: Sync on Assignment

Add session sync logic to `AutoTrainerAssignmentService` after trainer assignment:

```typescript
// After Step 8: Create session records in purchase_sessions
await this.sessionRepo.createMany(sessionsWithPurchaseId, client);

// NEW: Sync to sessions table if trainer assigned
if (finalSelectedTrainer) {
    await this.syncSessionsToAdminService(
        purchase.id,
        finalSelectedTrainer.id,
        sessionsWithPurchaseId,
        input.students[0], // Primary student
        client
    );
}
```

## Required Information for Sync

To create sessions in `sessions` table, we need:
- `allocationId`: Create or find a trainer_allocation record
- `studentId`: From purchase students
- `trainerId`: Assigned trainer
- `courseId`: From purchase
- `scheduledDate`: From purchase_sessions.session_date
- `scheduledTime`: From purchase_sessions.session_time
- `duration`: Calculate from purchase metadata
- `studentHomeLocation`: From purchase.studentLocation

## Quick Fix: Manual SQL Sync

To manually sync existing sessions (one-time):

```sql
-- Step 1: Create allocations for existing purchases with assigned trainers
INSERT INTO trainer_allocations (
    id,
    student_id,
    trainer_id,
    course_id,
    status,
    metadata,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid(),
    cp.students->0->>'id' as student_id,
    cp.trainer_id,
    cp.course_id,
    'approved',
    jsonb_build_object(
        'sessionCount', cp.total_sessions,
        'isSundayOnly', cp.delivery_mode = 'SUNDAY_ONLY',
        'schedule', jsonb_build_object(
            'timeSlot', cp.preferred_time_slot,
            'date', cp.start_date::text
        )
    ),
    cp.created_at,
    cp.updated_at
FROM course_purchases cp
WHERE cp.trainer_id IS NOT NULL
    AND cp.status = 'ASSIGNED'
    AND NOT EXISTS (
        SELECT 1 FROM trainer_allocations ta
        WHERE ta.student_id = cp.students->0->>'id'
            AND ta.trainer_id = cp.trainer_id
            AND ta.course_id = cp.course_id
            AND ta.status = 'approved'
    );

-- Step 2: Sync purchase_sessions to sessions table
INSERT INTO sessions (
    id,
    allocation_id,
    student_id,
    trainer_id,
    course_id,
    scheduled_date,
    scheduled_time,
    duration,
    status,
    student_home_location,
    metadata,
    created_at,
    updated_at
)
SELECT 
    ps.id,
    ta.id as allocation_id,
    cp.students->0->>'id' as student_id,
    cp.trainer_id,
    cp.course_id,
    ps.session_date,
    ps.session_time,
    CASE 
        WHEN cp.delivery_mode = 'SUNDAY_ONLY' THEN 80
        ELSE 60
    END as duration,
    ps.status::text as status,
    jsonb_build_object(
        'latitude', (cp.student_location->>'latitude')::float,
        'longitude', (cp.student_location->>'longitude')::float,
        'address', NULL
    ) as student_home_location,
    jsonb_build_object(
        'purchaseId', cp.id,
        'bookingId', cp.booking_id,
        'sessionNumber', ps.session_number,
        'sessionType', ps.session_type
    ) as metadata,
    ps.created_at,
    ps.updated_at
FROM purchase_sessions ps
JOIN course_purchases cp ON ps.purchase_id = cp.id
JOIN trainer_allocations ta ON 
    ta.student_id = cp.students->0->>'id'
    AND ta.trainer_id = cp.trainer_id
    AND ta.course_id = cp.course_id
    AND ta.status = 'approved'
WHERE cp.trainer_id IS NOT NULL
    AND cp.status = 'ASSIGNED'
    AND NOT EXISTS (
        SELECT 1 FROM sessions s WHERE s.id = ps.id
    );
```

## Recommended: Add Sync Service

Create a sync service that handles this automatically:

```typescript
// kc-backend/services/booking-service/src/services/sessionSync.service.ts

export class SessionSyncService {
    async syncPurchaseSessionsToAdminSessions(
        purchaseId: string,
        trainerId: string,
        purchaseSessions: PurchaseSession[],
        primaryStudentId: string,
        courseId: string,
        studentLocation: { latitude: number; longitude: number },
        client?: PoolClient
    ): Promise<void> {
        // 1. Create or find allocation
        // 2. Create sessions in admin-service sessions table
        // 3. Link sessions to allocation
    }
}
```

