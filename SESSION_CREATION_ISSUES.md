# Why Sessions Are Not Being Created

## Overview
Sessions are **automatically created** when a trainer allocation is approved. If sessions are not appearing, check the following prerequisites and common issues.

## Prerequisites for Session Creation

### 1. ✅ Allocation Must Be Approved
- **Status**: Allocation must be in `approved` status
- **API Endpoint**: `POST /api/v1/admin/allocations/:id/approve`
- **Who can approve**: Admin users only

**Check allocation status:**
```sql
SELECT id, student_id, trainer_id, course_id, status 
FROM trainer_allocations 
WHERE student_id = 'YOUR_STUDENT_ID';
```

**If status is `pending`:**
- An admin needs to approve the allocation via the admin panel or API
- Sessions will be created automatically after approval

---

### 2. ✅ Student Profile Must Exist
**Check if student profile exists:**
```sql
SELECT student_id, address, latitude, longitude 
FROM student_profiles 
WHERE student_id = 'YOUR_STUDENT_ID';
```

**If profile doesn't exist:**
- Student must complete their profile setup
- Profile is usually created during registration

---

### 3. ✅ **MOST COMMON ISSUE**: Student Must Have Valid GPS Coordinates
**This is the #1 reason sessions fail to create!**

**Requirements:**
- `latitude` must be a valid number between -90 and 90
- `longitude` must be a valid number between -180 and 180
- Both fields must be set (not NULL)

**Check coordinates:**
```sql
SELECT 
    student_id,
    address,
    latitude,
    longitude,
    CASE 
        WHEN latitude IS NULL OR longitude IS NULL THEN '❌ MISSING'
        WHEN latitude < -90 OR latitude > 90 THEN '❌ INVALID LATITUDE'
        WHEN longitude < -180 OR longitude > 180 THEN '❌ INVALID LONGITUDE'
        ELSE '✅ VALID'
    END as coordinate_status
FROM student_profiles 
WHERE student_id = 'YOUR_STUDENT_ID';
```

**Fix missing coordinates:**
1. Student must update their address in their profile
2. Address geocoding should automatically populate latitude/longitude
3. If geocoding fails, coordinates can be set manually by admin

**Manual fix (Admin):**
```sql
-- Update student address with coordinates
UPDATE student_profiles 
SET 
    address = 'Student Address Here',
    latitude = 17.3850,  -- Replace with actual coordinates
    longitude = 78.4867  -- Replace with actual coordinates
WHERE student_id = 'YOUR_STUDENT_ID';
```

---

### 4. ✅ Allocation Metadata Should Have Session Count
**Check session count in allocation:**
```sql
SELECT 
    id,
    student_id,
    metadata->>'sessionCount' as session_count,
    metadata->>'isSundayOnly' as is_sunday_only
FROM trainer_allocations 
WHERE id = 'ALLOCATION_ID';
```

**If sessionCount is missing or 0:**
- Sessions won't be created
- Check the purchase metadata for session count

---

## Session Creation Flow

```
1. Admin approves allocation
   ↓
2. AllocationService.approveAllocation() called
   ↓
3. Allocation status set to 'approved'
   ↓
4. AllocationService.createInitialSession() called automatically
   ↓
5. Checks:
   - ✅ Student profile exists?
   - ✅ Student has GPS coordinates?
   - ✅ Session count > 0?
   ↓
6. Creates sessions based on:
   - sessionCount from metadata
   - isSundayOnly flag (if true, only creates sessions on Sundays)
   - preferredTimeSlot from metadata (default: "4:00 PM")
   - preferredDate from metadata (default: today/tomorrow)
   ↓
7. Sessions created with status 'scheduled'
```

---

## Common Error Messages

### Error: "Student profile not found"
**Solution**: Ensure student has completed profile setup

### Error: "Student does not have valid GPS coordinates"
**Solution**: 
1. Student must update address in profile
2. Verify address geocoding worked
3. Check that latitude/longitude are set correctly

### Error: "Session creation failed"
**Solution**: Check backend logs for detailed error message

---

## Debugging Steps

### Step 1: Check Allocation Status
```sql
SELECT 
    ta.id,
    ta.student_id,
    ta.trainer_id,
    ta.course_id,
    ta.status,
    ta.metadata
FROM trainer_allocations ta
WHERE ta.student_id = 'YOUR_STUDENT_ID'
ORDER BY ta.created_at DESC;
```

### Step 2: Check Student Profile
```sql
SELECT 
    sp.student_id,
    sp.address,
    sp.latitude,
    sp.longitude,
    CASE 
        WHEN sp.latitude IS NOT NULL AND sp.longitude IS NOT NULL 
        THEN '✅ Ready'
        ELSE '❌ Missing Coordinates'
    END as ready_for_sessions
FROM student_profiles sp
WHERE sp.student_id = 'YOUR_STUDENT_ID';
```

### Step 3: Check Existing Sessions
```sql
SELECT 
    s.id,
    s.allocation_id,
    s.status,
    s.scheduled_date,
    s.student_id,
    s.trainer_id
FROM sessions s
WHERE s.student_id = 'YOUR_STUDENT_ID'
ORDER BY s.scheduled_date DESC;
```

### Step 4: Check Backend Logs
Look for these log messages:
- `✅ Successfully created ${sessionCount} sessions`
- `❌ Failed to create initial sessions`
- `❌ Student does not have valid GPS coordinates`
- `❌ Student profile not found`

---

## Manual Session Creation (If Auto-Creation Fails)

If automatic session creation fails, sessions can be created manually via API:

**Endpoint**: `POST /api/v1/admin/sessions`

**Request Body**:
```json
{
  "allocationId": "allocation-uuid",
  "studentId": "student-uuid",
  "trainerId": "trainer-uuid",
  "scheduledDate": "2024-01-15",
  "scheduledTime": "4:00 PM",
  "duration": 60,
  "studentHomeLocation": {
    "latitude": 17.3850,
    "longitude": 78.4867,
    "address": "Student Address"
  }
}
```

---

## Quick Fix Checklist

- [ ] Allocation status is `approved` (not `pending`)
- [ ] Student profile exists in `student_profiles` table
- [ ] Student has `latitude` and `longitude` set (not NULL)
- [ ] Coordinates are valid numbers (latitude: -90 to 90, longitude: -180 to 180)
- [ ] Allocation metadata has `sessionCount` > 0
- [ ] Check backend logs for specific error messages
- [ ] Try approving allocation again if it was recently updated

---

## Prevention

1. **Ensure address geocoding works** when student updates profile
2. **Validate coordinates** before allowing allocation approval
3. **Add UI validation** to prevent approval if coordinates missing
4. **Monitor logs** for session creation failures

