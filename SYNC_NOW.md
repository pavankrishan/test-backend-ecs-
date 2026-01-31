# 🔄 Sync Your Sessions NOW

## Your Situation
- Student ID: `e079d807-86ef-421c-b381-115ce68af27d`
- You purchased 2 courses (30 + 20 = 50 sessions total)
- Sessions exist in database but not showing in app

## ✅ Quick Fix (Choose One Method)

### Method 1: Run the Test Script (Easiest)

```bash
node test-sync-sessions.js
```

This will automatically call the sync endpoint and show you the results.

### Method 2: Use Postman/Thunder Client

1. Open Postman or Thunder Client in VS Code
2. Create new request:
   - **Method:** `POST`
   - **URL:** `http://localhost:3011/api/v1/booking/sync-sessions/all`
   - **Headers:** 
     ```
     Content-Type: application/json
     ```
   - **Body:** (leave empty)
3. Click **Send**

### Method 3: Use cURL

```bash
curl -X POST http://localhost:3011/api/v1/booking/sync-sessions/all -H "Content-Type: application/json"
```

### Method 4: Use PowerShell

```powershell
Invoke-RestMethod -Uri "http://localhost:3011/api/v1/booking/sync-sessions/all" -Method POST -ContentType "application/json"
```

## 📊 What to Expect

**Success Response:**
```json
{
  "success": true,
  "message": "Synced 50 sessions from 2 purchases",
  "data": {
    "purchasesProcessed": 2,
    "totalSessionsSynced": 50,
    ...
  }
}
```

## 🔍 Verify It Worked

After syncing, check your sessions:

```bash
# Using cURL
curl "http://localhost:3010/api/v1/admin/sessions/student/e079d807-86ef-421c-b381-115ce68af27d?status=scheduled"

# Or in Postman
GET http://localhost:3010/api/v1/admin/sessions/student/e079d807-86ef-421c-b381-115ce68af27d?status=scheduled
```

You should see your 50 sessions!

## 📱 After Syncing

1. **Refresh your mobile app** (pull to refresh)
2. **Check "Upcoming Sessions"** on home screen
3. **Check "Learnings" tab** - should show all 50 sessions

## ❌ If It Fails

**Error: Connection refused**
- Booking service not running on port 3011
- Start it: `cd kc-backend/services/booking-service && npm start`

**Error: No unsynced sessions found**
- Sessions might already be synced
- Or purchases don't have trainers assigned
- Check: `SELECT id, trainer_id, status FROM course_purchases WHERE ...`

**Error: Student location missing**
- GPS coordinates not set
- Need to update purchase with location data

## 🆘 Need Help?

Check the booking service logs for detailed error messages.

