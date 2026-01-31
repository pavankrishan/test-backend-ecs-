# Purchase Metadata Fix - Complete Summary

## Problem Identified

**Issue**: `student_course_purchases.metadata` was empty, but all required data exists in `payments.metadata`.

**Impact**: Learnings screen couldn't display:
- Starting Date
- Class Time
- Class Format
- Schedule Type
- Other purchase details

## Root Cause

Purchase worker was only using metadata from the event, which might be incomplete. The complete metadata exists in the `payments` table.

## Fix Applied

### 1. Updated Purchase Worker
**File**: `kc-backend/services/purchase-worker/src/index.ts`

**Change**: Purchase worker now:
1. Receives PURCHASE_CONFIRMED event
2. **Fetches payment record from `payments` table**
3. Extracts complete metadata from payment
4. Merges with event metadata (payment takes precedence)
5. Creates purchase with complete metadata

**Code Added**:
```typescript
// Fetch payment record to get complete metadata
const paymentResult = await pool.query(
  `SELECT metadata FROM payments 
   WHERE id = $1 AND student_id = $2 AND status = 'succeeded'
   LIMIT 1`,
  [purchaseEvent.paymentId, purchaseEvent.studentId]
);

if (paymentResult.rows.length > 0 && paymentResult.rows[0].metadata) {
  const paymentMetadata = typeof paymentResult.rows[0].metadata === 'string' 
    ? JSON.parse(paymentResult.rows[0].metadata)
    : paymentResult.rows[0].metadata;
  
  // Merge payment metadata with event metadata
  completeMetadata = {
    ...paymentMetadata,
    ...purchaseEvent.metadata,
    purchaseTier: purchaseTier,
    sessionCount: purchaseTier,
    courseId: purchaseEvent.courseId,
  };
}
```

### 2. Created Update Script
**File**: `kc-backend/update-purchase-metadata.js`

Script to update existing purchases with metadata from payments table.

## Required Tables for Learnings Screen

### Core Tables (9):
1. `student_course_purchases` - **MUST have complete metadata**
2. `payments` - Source of metadata
3. `courses` - Course details
4. `trainer_allocations` - Trainer assignment
5. `trainers` - Trainer info
6. `student_progress` - Progress tracking
7. `students` - Student info
8. `course_phases/levels/sessions` - Course structure
9. `tutoring_sessions` - Session records

### Supporting Tables (~32):
- Booking, admin, financial, location, etc.

### Potentially Unnecessary (~36):
- Legacy, migration backups, unused features

## Next Steps

1. ✅ Purchase worker updated
2. ⏳ Rebuild purchase-worker container (or restart to pick up changes)
3. ⏳ Run update script for existing purchases
4. ⏳ Test new purchases include all metadata
5. ⏳ Verify learnings screen displays correctly

## Verification

After fix, check:
```sql
SELECT id, metadata 
FROM student_course_purchases 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = '9e16d892-4324-4568-be60-163aa1665683';
```

Metadata should contain:
- `startDate`, `classTime`, `classTypeId`
- `sessionCount`, `scheduleType`
- `schedule` object with all details
- All other payment metadata

