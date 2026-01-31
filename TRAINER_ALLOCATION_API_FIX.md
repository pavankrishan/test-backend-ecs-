# Trainer Allocation API Fix - Complete

## Problem
Trainer allocation was not appearing in the frontend learning screen, even though:
- ✅ Allocation exists in database
- ✅ Events were emitted to Redis Pub/Sub
- ❌ Learning data API didn't include allocation data

## Root Cause
The `getLearningData` API endpoint in `AggregationService` was not fetching trainer allocations, so courses didn't include trainer information.

## Fix Applied

### 1. Fixed SQL Query (`kc-backend/services/student-service/services/aggregation.service.ts`)

**Issue**: Query tried to join `trainers.name` which doesn't exist. Trainer name is in `trainer_profiles.full_name`.

**Before**:
```typescript
LEFT JOIN trainers t ON ta.trainer_id = t.id
// Tried to access t.name (doesn't exist)
```

**After**:
```typescript
LEFT JOIN trainer_profiles tp ON ta.trainer_id = tp.trainer_id
// Accesses tp.full_name (correct)
// Also extracts trainer photo from tp.extra JSONB
```

**Fixed Query**:
```sql
SELECT 
  ta.id,
  ta.student_id AS "studentId",
  ta.course_id AS "courseId",
  ta.trainer_id AS "trainerId",
  ta.status,
  tp.full_name AS "trainerName",
  COALESCE(
    (tp.extra->>'avatarUrl')::text,
    (tp.extra->>'avatar_url')::text,
    NULL
  ) AS "trainerPhoto"
FROM trainer_allocations ta
LEFT JOIN trainer_profiles tp ON ta.trainer_id = tp.trainer_id
WHERE ta.student_id = $1
  AND ta.course_id = ANY($2::uuid[])
  AND ta.status IN ('approved', 'active')
```

### 2. Added Allocation Data to Courses

**Location**: `fetchCoursesWithPurchases` method

**Changes**:
- Fetches allocations for all course IDs
- Creates allocation map (courseId -> allocation)
- Adds `allocation` object to each course:
  ```typescript
  {
    ...course,
    purchase: purchaseMap.get(course.id) || null,
    allocation: allocation ? {
      id: allocation.id,
      trainerId: allocation.trainerId,
      trainerName: allocation.trainerName,
      trainerPhoto: allocation.trainerPhoto,
      status: allocation.status,
    } : null,
  }
  ```

### 3. Frontend Uses Allocation from Course Object

**Location**: `kc-app/app/(student)/learnings.tsx`

**Changes**:
- Updated `courseEntries` to use `course.allocation` if available
- Trainer info appears even if bootstrap doesn't have allocations

### 4. WebSocket Connection Fallback

**Location**: `kc-app/services/events/eventSubscription.ts`

**Changes**:
- Added fallback to use app store role if token role extraction fails
- WebSocket should connect even if token doesn't have explicit role field

## Testing

### Query Test ✅
```bash
node test-allocation-query.js
# Result: Allocation found with trainer name "Mahesh"
```

### API Test (After Service Restart)
```bash
curl http://localhost:3000/api/v1/students/401ca863-4543-4b3e-9bc6-c8ad49a77a03/learning
# Should return courses with allocation objects
```

## Required Action

**⚠️ CRITICAL: Backend service must be restarted for changes to take effect**

The `student-service` needs to be restarted to load the updated code:

```bash
# If using Docker
docker restart kodingcaravan-student-service

# Or if running directly
# Stop and restart the student-service process
```

## Verification Steps

1. **Restart student-service**
2. **Clear cache** (already done):
   ```bash
   redis-cli DEL student:learning:401ca863-4543-4b3e-9bc6-c8ad49a77a03
   ```
3. **Test API**:
   ```bash
   curl http://localhost:3000/api/v1/students/401ca863-4543-4b3e-9bc6-c8ad49a77a03/learning
   ```
4. **Check response**: Course should have `allocation` object with trainer info
5. **Check frontend**: Trainer should appear in learning screen

## Expected Result

After restarting the service:
- ✅ Learning API returns courses with `allocation` objects
- ✅ Frontend shows trainer name and photo
- ✅ `hasTrainer: true` in course entries
- ✅ Trainer allocation appears automatically

## Files Modified

1. ✅ `kc-backend/services/student-service/services/aggregation.service.ts`
   - Fixed SQL query to use `trainer_profiles.full_name`
   - Added allocation fetching and mapping
   - Added allocation to course objects

2. ✅ `kc-app/app/(student)/learnings.tsx`
   - Updated to use `course.allocation` for trainer info

3. ✅ `kc-app/services/events/eventSubscription.ts`
   - Added WebSocket connection fallback using app store role

