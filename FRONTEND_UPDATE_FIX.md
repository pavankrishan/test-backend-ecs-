# Frontend Not Updating - Quick Fix Guide

## Problem

Session completed but frontend (student & trainer) not updating.

## Root Cause

**Redis connection is failing**, so event bus falls back to **InMemoryEventBus**. Events are only in memory (not in Redis), so:
- ✅ Events are emitted
- ❌ Events are NOT published to Redis
- ❌ WebSocket server can't receive events (subscribes to Redis)
- ❌ Frontend doesn't get updates

## Quick Fix

### Step 1: Restart API Gateway (Required)

The API Gateway needs a fresh Redis connection with the DNS fix:

```bash
# Stop API Gateway (Ctrl+C if running)
# Then restart:
cd kc-backend/services/api-gateway
npm run dev
```

### Step 2: Verify Redis Connection

Run the diagnostic script:
```bash
cd kc-backend
node check-event-system.js
```

You should see:
- ✅ Redis connected
- ✅ Event bus initialized
- ✅ Test event emitted successfully

### Step 3: Test Event Flow

1. **Complete a session**:
   ```bash
   node complete-session.js <session-id>
   ```

2. **Check API Gateway logs** for:
   ```
   [EventBus] Received event: SESSION_COMPLETED
   [WebSocket] Emitting event to user: <user-id>
   ```

3. **Check Frontend console** for:
   ```
   [EventSocket] Received event: SESSION_COMPLETED
   ```

## Why This Happens

The Redis singleton was created **before** the DNS fix was applied. Even though we fixed the code, the running service still has the old broken connection.

**Solution**: Restart services to get fresh connections with the DNS fix.

## Verification Checklist

- [ ] API Gateway is running
- [ ] Redis connection works (check diagnostic script)
- [ ] Event bus uses Redis (not InMemory)
- [ ] Frontend WebSocket connected (check console)
- [ ] Events appear in API Gateway logs
- [ ] Events appear in frontend console

## If Still Not Working

### Check 1: Frontend WebSocket Connection
- Open frontend console
- Look for: `[EventSocket] Connected`
- If not connected, check: `[EventPolling] Starting polling`

### Check 2: Event Filtering
The event should be received by:
- **Trainer**: If `event.trainerId === trainer.userId`
- **Student**: If `event.studentId === student.userId`

Verify the user IDs match in the event.

### Check 3: Store Update
Check if the store's `handleEvent` is being called:
- Look for store update logs in console
- Check if `SESSION_COMPLETED` case is handled

## Long-term Solution

1. ✅ DNS fix implemented (done)
2. ⏳ Restart services (do this now)
3. ⏳ Add event logging table (for polling fallback)
4. ⏳ Add monitoring/alerting

## Expected Behavior After Fix

1. Session completed → Event emitted to Redis ✅
2. API Gateway receives from Redis ✅
3. WebSocket forwards to clients ✅
4. Frontend receives event ✅
5. Store updates ✅
6. UI refreshes ✅

