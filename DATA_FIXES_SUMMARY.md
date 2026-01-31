# Data Fixes Summary - Profile Screen Issues

## Issues Fixed

### 1. Active Courses Count Showing 0
**Problem:** `activeCourses` was calculated from `student_course_progress` table, which only has records after sessions are completed. Students with allocations/purchases but no completed sessions showed 0 active courses.

**Fix:** Updated `getOverview()` in `student.service.ts` to count active courses from:
- `student_course_purchases` table (where `is_active = true`)
- `trainer_allocations` table (where `status IN ('approved', 'active')`)
- Takes the maximum of all three sources (purchases, allocations, progress)

**Location:** `kc-backend/services/student-service/services/student.service.ts` (line ~466)

### 2. Course Names Not Showing
**Problem:** Course titles were not being returned in allocation data, showing "Course" as fallback.

**Fix:** 
- Added better logging to detect when courses are missing from database
- Improved course lookup to handle missing courses gracefully
- Backend already fetches course titles via `enrichAllocationsWithDetails()` - verified the query is correct

**Location:** `kc-backend/services/admin-service/src/services/allocation.service.ts` (line ~1484)

### 3. Average Progress Calculation
**Status:** Already correct - calculates from `student_course_progress.percentage`
**Note:** If there are no progress records (no completed sessions), average progress will be 0, which is expected.

## Database Verification Checklist

To verify data is present, check these tables:

### 1. Check if student has active course purchases:
```sql
SELECT 
  scp.id,
  scp.student_id,
  scp.course_id,
  scp.is_active,
  c.title AS course_title
FROM student_course_purchases scp
LEFT JOIN courses c ON c.id = scp.course_id
WHERE scp.student_id = '<STUDENT_ID>' 
  AND scp.is_active = true;
```

### 2. Check if student has active allocations:
```sql
SELECT 
  ta.id,
  ta.student_id,
  ta.course_id,
  ta.status,
  c.title AS course_title
FROM trainer_allocations ta
LEFT JOIN courses c ON c.id = ta.course_id
WHERE ta.student_id = '<STUDENT_ID>' 
  AND ta.status IN ('approved', 'active')
  AND ta.course_id IS NOT NULL;
```

### 3. Check if courses table has titles:
```sql
SELECT 
  id,
  title,
  category,
  level
FROM courses
WHERE id IN (
  SELECT DISTINCT course_id 
  FROM trainer_allocations 
  WHERE student_id = '<STUDENT_ID>' 
    AND course_id IS NOT NULL
);
```

### 4. Check if progress records exist:
```sql
SELECT 
  scp.id,
  scp.student_id,
  scp.course_id,
  scp.percentage,
  scp.completed_lessons,
  scp.total_lessons,
  c.title AS course_title
FROM student_course_progress scp
LEFT JOIN courses c ON c.id = scp.course_id
WHERE scp.student_id = '<STUDENT_ID>';
```

## Expected Behavior After Fix

1. **Active Courses Count:**
   - Should show count of active purchases OR active allocations (whichever is higher)
   - Will show 0 only if student has no purchases AND no allocations

2. **Course Names:**
   - Should display actual course title from `courses.title`
   - Will show "Course" only if:
     - Course doesn't exist in `courses` table
     - Course title is NULL in database
     - Allocation has invalid `course_id`

3. **Average Progress:**
   - Calculated from `student_course_progress.percentage`
   - Will be 0 if no progress records exist (no completed sessions)
   - This is expected behavior - progress is created when sessions are completed

## Troubleshooting

If data still doesn't show:

1. **Check backend logs** for warnings:
   - `[Allocation Service] Some courses not found in database`
   - `[Allocation Service] Course not found for allocation`

2. **Verify database connections:**
   - Ensure `courses` table exists and has data
   - Ensure `student_course_purchases` table exists
   - Ensure `trainer_allocations` table exists

3. **Check data integrity:**
   - Verify `course_id` in allocations matches `id` in courses table
   - Verify `student_id` matches actual student ID
   - Verify `is_active = true` for purchases
   - Verify `status IN ('approved', 'active')` for allocations

4. **Clear Redis cache** (if using):
   ```bash
   # Clear student home cache
   redis-cli DEL "student:home:<STUDENT_ID>"
   # Clear student learning cache
   redis-cli DEL "student:learning:<STUDENT_ID>"
   ```

## API Endpoints to Test

1. **Student Overview:**
   ```
   GET /api/v1/students/<STUDENT_ID>
   ```
   Check `stats.activeCourses` and `stats.averageProgress`

2. **Student Allocations:**
   ```
   GET /api/v1/admin/allocations/student/<STUDENT_ID>?details=true
   ```
   Check each allocation has `course.title` populated

3. **Student Home Aggregation:**
   ```
   GET /api/v1/students/<STUDENT_ID>/home
   ```
   Check `overview.stats.activeCourses`

