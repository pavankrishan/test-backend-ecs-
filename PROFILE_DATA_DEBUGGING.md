# Profile Data Debugging Guide

## Issues Fixed

### 1. ✅ Active Courses Count (Backend Fixed)
**Location:** `kc-backend/services/student-service/services/student.service.ts`

**Fix:** Changed from counting only `student_course_progress` to counting from:
- `student_course_purchases` (where `is_active = true`)
- `trainer_allocations` (where `status IN ('approved', 'active')`)
- Takes maximum of all three sources

### 2. ✅ Stats Not Preserved in Bootstrap Store (Frontend Fixed)
**Location:** 
- `kc-app/stores/studentBootstrapStore.ts` - Added `account` and `stats` to type
- `kc-app/services/bootstrap/studentBootstrap.ts` - Preserve stats when mapping overview

**Fix:** Bootstrap now preserves `account` and `stats` from API response

### 3. ✅ Profile Screen Stats Reading (Frontend Fixed)
**Location:** `kc-app/app/(student)/profile.tsx`

**Fix:** Added fallback to read stats from `globalDataStore` if bootstrap overview doesn't have them

### 4. ✅ Course Names in Allocations (Backend Fixed)
**Location:** `kc-backend/services/admin-service/src/services/allocation.service.ts`

**Fix:** Added logging to detect missing courses, improved error handling

## Database Verification Queries

Run these queries to verify data exists:

### 1. Check Active Course Purchases:
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

### 2. Check Active Allocations:
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

### 3. Check Courses Table Has Titles:
```sql
SELECT 
  id,
  title,
  category
FROM courses
WHERE id IN (
  SELECT DISTINCT course_id 
  FROM trainer_allocations 
  WHERE student_id = '<STUDENT_ID>' 
    AND course_id IS NOT NULL
  UNION
  SELECT DISTINCT course_id 
  FROM student_course_purchases 
  WHERE student_id = '<STUDENT_ID>' 
    AND is_active = true
);
```

### 4. Check Progress Records:
```sql
SELECT 
  scp.id,
  scp.student_id,
  scp.course_id,
  scp.percentage,
  scp.completed_lessons,
  scp.total_lessons
FROM student_course_progress scp
WHERE scp.student_id = '<STUDENT_ID>';
```

## Backend API Testing

### Test Student Overview API:
```bash
curl -X GET "http://localhost:3002/api/v1/students/<STUDENT_ID>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**Expected Response:**
```json
{
  "account": { ... },
  "profile": { ... },
  "progress": [ ... ],
  "stats": {
    "activeCourses": 2,  // Should be > 0 if student has purchases/allocations
    "averageProgress": 45.5,
    "pendingProjects": 0
  }
}
```

### Test Student Home Aggregation API:
```bash
curl -X GET "http://localhost:3002/api/v1/students/<STUDENT_ID>/home" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**Expected Response:**
```json
{
  "overview": {
    "account": { ... },
    "profile": { ... },
    "stats": {
      "activeCourses": 2,
      "averageProgress": 45.5,
      "pendingProjects": 0
    }
  },
  "upcomingSessions": [ ... ],
  "recentCourses": [ ... ],
  "trendingCourses": [ ... ],
  "notifications": { ... }
}
```

### Test Student Allocations API:
```bash
curl -X GET "http://localhost:3001/api/v1/admin/allocations/student/<STUDENT_ID>?details=true" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "studentId": "...",
    "courseId": "...",
    "course": {
      "id": "...",
      "title": "Course Name Here",  // Should NOT be null
      "level": "...",
      ...
    },
    "trainer": { ... },
    ...
  }
]
```

## Frontend Debugging

### Check Bootstrap Store State:
Add this to profile screen temporarily:
```typescript
useEffect(() => {
  if (__DEV__) {
    console.log('[Profile Debug] Overview:', {
      hasOverview: !!overview,
      hasStats: !!overview?.stats,
      stats: overview?.stats,
      account: overview?.account,
      profile: overview?.profile,
    });
    console.log('[Profile Debug] Global Data Store:', {
      hasHomeData: !!globalDataStore.homeData,
      homeDataStats: globalDataStore.homeData?.overview?.stats,
    });
    console.log('[Profile Debug] Allocations:', {
      count: allocations.length,
      firstAllocation: allocations[0],
      firstAllocationCourse: allocations[0]?.course,
    });
  }
}, [overview, globalDataStore.homeData, allocations]);
```

## Common Issues & Solutions

### Issue: Active Courses = 0
**Possible Causes:**
1. No active purchases (`is_active = false` or no purchases)
2. No approved/active allocations
3. Database query failing silently

**Solution:**
- Check database queries above
- Check backend logs for errors
- Verify `student_course_purchases` and `trainer_allocations` tables have data

### Issue: Course Name = "Course"
**Possible Causes:**
1. Course doesn't exist in `courses` table
2. Course `title` is NULL in database
3. Allocation `course_id` doesn't match any course `id`

**Solution:**
- Check if course exists: `SELECT * FROM courses WHERE id = '<COURSE_ID>'`
- Check if title is NULL: `SELECT id, title FROM courses WHERE id = '<COURSE_ID>'`
- Check backend logs for: `[Allocation Service] Course not found for allocation`

### Issue: Average Progress = 0%
**Possible Causes:**
1. No progress records (no completed sessions yet)
2. All progress records have `percentage = 0`

**Solution:**
- This is expected if student hasn't completed any sessions
- Progress is created when sessions are completed
- Check: `SELECT * FROM student_course_progress WHERE student_id = '<STUDENT_ID>'`

## Cache Clearing

If data still doesn't show after fixes:

### Clear Redis Cache:
```bash
# Connect to Redis
redis-cli

# Clear student home cache
DEL "student:home:<STUDENT_ID>"

# Clear student learning cache
DEL "student:learning:<STUDENT_ID>"
```

### Clear Frontend Cache:
- Restart the app
- Or trigger a fresh bootstrap by logging out and back in

## Next Steps

1. **Verify Database:** Run the SQL queries above to confirm data exists
2. **Test Backend APIs:** Use curl commands to verify APIs return correct data
3. **Check Backend Logs:** Look for warnings about missing courses
4. **Check Frontend Logs:** Add debug logging to see what data is being received
5. **Clear Caches:** Clear Redis and restart app if needed

