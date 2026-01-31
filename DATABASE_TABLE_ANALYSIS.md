# Database Table Analysis - Required vs Unnecessary Tables

## Learnings Screen Data Requirements

Based on `CourseCard.tsx` and `learnings.tsx`, the frontend needs:

### Required Data Fields:
1. **Course Info**: `courseName`, `courseId`, `duration`
2. **Purchase Metadata** (from `student_course_purchases.metadata`):
   - `startDate` / `schedule.startDate` / `schedule.date`
   - `classTime` / `schedule.timeSlot`
   - `classTypeId` / `classTypeTitle`
   - `sessionCount` / `purchaseTier`
   - `scheduleType` / `scheduleMode`
   - `studentAddress` / `location`
3. **Trainer Info**: `trainerId`, `trainerName`, `trainerPhoto`
4. **Progress**: `progress` / `percentage`
5. **Status**: `status` (ongoing/completed)

## Current Problem

**Issue**: `student_course_purchases.metadata` is empty or missing data, but `payments.metadata` has all the details.

**Root Cause**: When purchase worker creates purchase, it doesn't copy metadata from payment.

## Data Flow Analysis

### Current Flow:
```
Payment Confirmed
  ↓
payments.metadata = { courseId, sessionCount, timeSlot, classTypeId, schedule: {...}, ... }
  ↓
PURCHASE_CONFIRMED event
  ↓
Purchase Worker creates student_course_purchases
  ↓
student_course_purchases.metadata = {} (EMPTY!)
```

### Required Flow:
```
Payment Confirmed
  ↓
payments.metadata = { courseId, sessionCount, timeSlot, classTypeId, schedule: {...}, ... }
  ↓
PURCHASE_CONFIRMED event (includes payment metadata)
  ↓
Purchase Worker creates student_course_purchases
  ↓
student_course_purchases.metadata = payments.metadata (COPY ALL DATA!)
```

## Required Tables for Learnings Screen

### Core Tables (REQUIRED):
1. **`student_course_purchases`** - Purchase records
   - **CRITICAL**: Must have complete `metadata` field with all payment details
   - Fields: `id`, `student_id`, `course_id`, `purchase_tier`, `metadata`, `is_active`

2. **`courses`** - Course details
   - Fields: `id`, `title`, `description`, `duration`, `thumbnail_url`

3. **`trainer_allocations`** - Trainer assignment
   - Fields: `id`, `student_id`, `course_id`, `trainer_id`, `status`
   - Joins with `trainers` for trainer details

4. **`trainers`** - Trainer information
   - Fields: `id`, `full_name`, `avatar_url`

5. **`student_progress`** or **`student_course_progress`** - Progress tracking
   - Fields: `student_id`, `course_id`, `progress` / `percentage`

6. **`payments`** - Payment records (source of metadata)
   - Fields: `id`, `student_id`, `status`, `metadata` (contains all purchase details)

### Supporting Tables (REQUIRED):
7. **`students`** - Student information
8. **`course_phases`**, **`course_levels`**, **`course_sessions`** - Course structure
9. **`tutoring_sessions`** or **`session_bookings`** - Session records

## Unnecessary/Redundant Tables

### Potentially Unnecessary:
- Tables that duplicate data already in other tables
- Legacy tables from old architecture
- Migration backup tables
- Unused feature tables

## Fix Required

### 1. Update Purchase Worker to Copy Metadata
**File**: `kc-backend/services/purchase-worker/src/index.ts`

The purchase worker must copy ALL metadata from payment to purchase:

```typescript
// In handlePurchaseConfirmed function
const purchaseTier = (purchaseEvent.metadata?.purchaseTier as number) ||
  (purchaseEvent.metadata?.sessionCount as number) ||
  30;

// CRITICAL: Copy ALL metadata from payment event
const purchaseMetadata = {
  ...purchaseEvent.metadata, // This should include all payment metadata
  purchaseTier,
  // Ensure all required fields are present
  startDate: purchaseEvent.metadata?.startDate || purchaseEvent.metadata?.schedule?.startDate,
  classTime: purchaseEvent.metadata?.timeSlot || purchaseEvent.metadata?.schedule?.timeSlot,
  classTypeId: purchaseEvent.metadata?.classTypeId,
  sessionCount: purchaseTier,
  scheduleType: purchaseEvent.metadata?.scheduleType || purchaseEvent.metadata?.scheduleMode,
};

await createPurchase(
  purchaseEvent.studentId,
  purchaseEvent.courseId,
  purchaseTier,
  purchaseMetadata // Pass complete metadata
);
```

### 2. Verify Payment Metadata Structure
Check what's actually in `payments.metadata` to ensure all fields are captured.

## Next Steps

1. Check `payments.metadata` structure for the purchase
2. Update purchase worker to copy complete metadata
3. Verify `student_course_purchases.metadata` has all required fields
4. Test learnings screen displays correctly

