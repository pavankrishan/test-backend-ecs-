# Troubleshooting: Sessions Not Showing in Frontend

## Problem
You've purchased courses (e.g., 30 sessions and 20 sessions) but they're not showing in the student app.

## Root Cause
Sessions exist in `purchase_sessions` table but not in `tutoring_sessions` table. The frontend queries `tutoring_sessions`, so they won't appear until synced.

## Quick Fix

### Option 1: Use the API Endpoint (Easiest)

Call this endpoint to sync all unsynced sessions:

```bash
POST http://your-backend-url/api/v1/booking/sync-sessions/all
```

**Using cURL:**
```bash
curl -X POST http://localhost:3001/api/v1/booking/sync-sessions/all \
  -H "Content-Type: application/json"
```

**Using Postman/Thunder Client:**
- Method: POST
- URL: `http://localhost:3001/api/v1/booking/sync-sessions/all`
- Headers: `Content-Type: application/json`

### Option 2: Sync Specific Purchase

If you know your purchase ID:

```bash
POST http://your-backend-url/api/v1/booking/sync-sessions/:purchaseId
```

Replace `:purchaseId` with your actual purchase ID.

### Option 3: Run the Sync Script

```bash
cd kc-backend
npm run sync-sessions
# or
ts-node scripts/sync-all-purchases.ts
```

(You may need to add the script to package.json first)

## Verify Sessions Are Synced

### Check via API:
```bash
GET /api/v1/admin/sessions/student/:studentId
```

### Check via SQL:
```sql
-- Count sessions in each table for your student
SELECT 
    'purchase_sessions' as table_name,
    COUNT(*) as count
FROM purchase_sessions ps
JOIN course_purchases cp ON ps.purchase_id = cp.id
WHERE cp.students::jsonb @> '[{"id": "YOUR_STUDENT_ID"}]'::jsonb
    AND cp.trainer_id IS NOT NULL
UNION ALL
SELECT 
    'tutoring_sessions' as table_name,
    COUNT(*) as count
FROM tutoring_sessions ts
WHERE ts.student_id = 'YOUR_STUDENT_ID';
```

## Common Issues

### 1. No Trainer Assigned
**Symptom:** Sync endpoint returns "No trainer assigned"

**Fix:**
```sql
-- Check if trainer is assigned
SELECT id, trainer_id, status 
FROM course_purchases 
WHERE id = 'YOUR_PURCHASE_ID';

-- If trainer_id is NULL, you need to assign a trainer first
```

### 2. Missing GPS Coordinates
**Symptom:** Sync fails with "Student location missing"

**Fix:**
```sql
-- Check student location
SELECT student_location 
FROM course_purchases 
WHERE id = 'YOUR_PURCHASE_ID';

-- If NULL or missing latitude/longitude, update it:
UPDATE course_purchases
SET student_location = jsonb_build_object(
    'latitude', YOUR_LATITUDE,
    'longitude', YOUR_LONGITUDE,
    'address', 'YOUR_ADDRESS'
)
WHERE id = 'YOUR_PURCHASE_ID';
```

### 3. Purchase Status Not "ASSIGNED"
**Symptom:** Purchase not found in sync query

**Fix:**
```sql
-- Update status if needed
UPDATE course_purchases
SET status = 'ASSIGNED'
WHERE id = 'YOUR_PURCHASE_ID'
    AND trainer_id IS NOT NULL;
```

## After Syncing

1. **Refresh the app** - Sessions should now appear
2. **Check "Upcoming Sessions" section** on home screen
3. **Check "Learnings" tab** for all sessions
4. **Check session detail pages** - should be accessible

## Prevention

New purchases will automatically sync when:
- Trainer is assigned via auto-assignment
- Sync service runs in the same transaction

## Need Help?

Check the logs for detailed error messages:
- Look for `[SessionSync]` in backend logs
- Errors will show specific reasons for sync failure

