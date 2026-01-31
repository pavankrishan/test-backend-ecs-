# Frontend WebSocket Connection Diagnosis

## Current Status

### ✅ Working
- Event emission: Events are being emitted to Redis
- Event reception: API Gateway receives events from Redis
- Redis connection: ✅ Connected

### ❌ Not Working
- **WebSocket connections: 0 handlers found** (line 665)
- Frontend WebSocket: Not connecting (no `[EventSocket] Connected` logs)

## Root Cause

The frontend WebSocket is not connecting to the API Gateway. This means:
1. Events are emitted to Redis ✅
2. API Gateway receives events from Redis ✅
3. But no WebSocket clients are connected, so events can't be delivered ❌

## Why Frontend Isn't Connecting

Possible reasons:
1. **`connectEventSocket()` not being called** after login
2. **Token authentication failing** in WebSocket middleware
3. **WebSocket URL incorrect** (should be `ws://localhost:3000` or `wss://...`)
4. **CORS issues** preventing WebSocket connection
5. **Network/firewall blocking** WebSocket connections

## How to Fix

### Step 1: Check Frontend Logs
Look for these logs in the frontend console:
- `[EventSocket] Connected` ✅ Good
- `[EventSocket] Failed to initialize WebSocket` ❌ Bad
- `[EventSocket] No access token, cannot connect` ❌ Bad
- `[EventSocket] Tokens not valid, cannot connect` ❌ Bad

### Step 2: Verify `connectEventSocket()` is Called
Check `kc-app/stores/appStore.ts` line 428 - it should call `connectEventSocket()` after login.

### Step 3: Check WebSocket URL
Verify the API URL in frontend config matches the API Gateway URL.

### Step 4: Check Backend Logs
After frontend connects, you should see:
```
[WebSocket] User connected: <user-id> (<role>)
```

If you don't see this, the frontend isn't connecting.

## Temporary Workaround

The frontend has a **polling fallback** that should work:
- Polls every 5 seconds for new events
- Should pick up events even without WebSocket

Check if polling is active:
- Look for `[EventPolling] Starting polling` in frontend logs
- Events should arrive within 5 seconds via polling

## Next Steps

1. **Check frontend console** for WebSocket connection logs
2. **Verify `connectEventSocket()` is called** after login
3. **Check API Gateway logs** for WebSocket connection attempts
4. **Test polling fallback** - events should arrive within 5 seconds

