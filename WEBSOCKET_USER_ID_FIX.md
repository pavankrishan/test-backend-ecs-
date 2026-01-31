# WebSocket User ID Extraction Fix

## Problem

The WebSocket connection was successful, but the user ID was `undefined`, causing:
1. Events to be received but not delivered (0 handlers found)
2. Connection to disconnect shortly after connecting
3. Frontend falling back to polling

## Root Cause

The JWT token verification was not correctly extracting the user ID from the token payload. The token structure may use different field names than expected.

## Fixes Applied

### 1. Enhanced Token Verification (`eventServer.ts`)

**Before:**
```typescript
const decoded = verifyAccessToken<any>(token);
return {
  id: decoded.userId || decoded.id || decoded.trainerId || decoded.studentId,
  role: decoded.role || (decoded.trainerId ? 'trainer' : decoded.studentId ? 'student' : 'trainer'),
};
```

**After:**
```typescript
const decoded = verifyAccessToken<any>(token);

// Log decoded token structure for debugging
console.log('[WebSocket] Decoded token fields:', Object.keys(decoded));
console.log('[WebSocket] Decoded token sample:', JSON.stringify(decoded, null, 2).substring(0, 200));

// Try multiple possible field names for user ID
const userId = decoded.userId || decoded.id || decoded.trainerId || decoded.studentId || decoded.sub;

if (!userId) {
  console.error('[WebSocket] No user ID found in token. Available fields:', Object.keys(decoded));
  return null;
}

// Determine role - try multiple sources
const role = decoded.role || 
             (decoded.trainerId ? 'trainer' : 
              decoded.studentId ? 'student' : 
              decoded.type === 'trainer' ? 'trainer' :
              decoded.type === 'student' ? 'student' :
              'student'); // Default to student if unclear

return {
  id: userId,
  role: role,
};
```

### 2. Added Safety Check for User Data

**Before:**
```typescript
io.on('connection', (socket) => {
  const userId = socket.data.user.id;
  const role = socket.data.user.role;
  // ...
});
```

**After:**
```typescript
io.on('connection', (socket) => {
  const userId = socket.data.user?.id;
  const role = socket.data.user?.role;
  
  if (!userId || !role) {
    console.error('[WebSocket] Invalid user data in socket:', socket.data.user);
    socket.disconnect();
    return;
  }
  // ...
});
```

## What to Check

After restarting the API Gateway, check the logs for:

1. **Token structure:**
   ```
   [WebSocket] Decoded token fields: [...]
   [WebSocket] Decoded token sample: {...}
   ```

2. **User connection:**
   ```
   [WebSocket] Token verified for user: <actual-user-id> (student)
   [WebSocket] User connected: <actual-user-id> (student)
   ```

3. **Event delivery:**
   ```
   [WebSocket] Event received: SESSION_COMPLETED, userId: <actual-user-id>, role: student, shouldReceive: true
   [WebSocket] Emitting event to user <actual-user-id>: SESSION_COMPLETED
   ```

## Next Steps

1. **Restart API Gateway** to apply the fixes
2. **Check logs** to see what fields are in the token
3. **If user ID is still undefined**, we may need to check where the token is created and ensure it includes the user ID field
4. **Test event delivery** by completing a session and verifying the frontend receives the event

## Expected Behavior

- ✅ WebSocket connects with valid user ID
- ✅ Events are delivered to connected clients
- ✅ Frontend receives real-time updates
- ✅ No fallback to polling needed

