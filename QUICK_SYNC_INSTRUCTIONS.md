# Quick Sync Instructions

## Your Student ID
From the logs: `e079d807-86ef-421c-b381-115ce68af27d`

## Step 1: Call the Sync Endpoint

### Option A: Using Browser/Postman (Easiest)

1. **Open Postman, Thunder Client, or any API client**

2. **Make a POST request:**
   - **URL:** `http://localhost:3002/api/v1/booking/sync-sessions/all`
   - **Method:** `POST`
   - **Headers:** 
     ```
     Content-Type: application/json
     ```
   - **Body:** (leave empty)

3. **Send the request**

### Option B: Using cURL (Terminal)

```bash
curl -X POST http://localhost:3002/api/v1/booking/sync-sessions/all \
  -H "Content-Type: application/json"
```

### Option C: Using PowerShell (Windows)

```powershell
Invoke-RestMethod -Uri "http://localhost:3002/api/v1/booking/sync-sessions/all" -Method POST -ContentType "application/json"
```

## Step 2: Verify Sync Worked

### Check via API:
```bash
GET http://localhost:3010/api/v1/admin/sessions/student/e079d807-86ef-421c-b381-115ce68af27d?status=scheduled
```

Or in Postman:
- **URL:** `http://localhost:3010/api/v1/admin/sessions/student/e079d807-86ef-421c-b381-115ce68af27d?status=scheduled`
- **Method:** `GET`

## Expected Response

After syncing, you should see:
```json
{
  "success": true,
  "message": "Synced X sessions from Y purchases",
  "data": {
    "purchasesProcessed": 2,
    "totalSessionsSynced": 50,
    ...
  }
}
```

## If It Fails

Common issues:

1. **Booking service not running on port 3002**
   - Check your booking service port in `.env` or config
   - Adjust the URL accordingly

2. **No trainer assigned**
   - Sessions need a trainer to sync
   - Check: `SELECT id, trainer_id, status FROM course_purchases WHERE ...`

3. **Missing GPS coordinates**
   - Check: `SELECT student_location FROM course_purchases WHERE ...`

## After Sync

1. **Refresh your app** - Sessions should appear
2. **Check "Upcoming Sessions"** on home screen
3. **Check "Learnings" tab** - Should show all sessions

