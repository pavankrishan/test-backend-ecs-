# WebSocket Event Reception Fix

## Problem
WebSocket events were not being received by the frontend, and trainer allocation updates were not appearing in real-time.

## Root Causes

### 1. Allocation Worker Not Emitting to Redis Pub/Sub
**Issue**: The `allocation-worker` only emitted `TRAINER_ALLOCATED` events to Kafka, not to Redis Pub/Sub. This meant WebSocket clients never received these events.

**Location**: `kc-backend/services/allocation-worker/src/index.ts`

**Before**:
```typescript
// Only emitted to Kafka
await kafkaBus.emit(trainerAllocatedEvent, {...});
```

**After**:
```typescript
// Emit to Kafka (for workers)
await kafkaBus.emit(trainerAllocatedEvent, {...});

// ALSO emit to Redis Pub/Sub (for WebSocket/real-time updates)
try {
  const { getEventBus } = await import('@kodingcaravan/shared');
  const eventBus = getEventBus();
  await eventBus.emit(trainerAllocatedEvent);
} catch (redisError: any) {
  // Non-critical: WebSocket events are best-effort
  logWithContext('warn', 'Failed to emit TRAINER_ALLOCATED to Redis Pub/Sub (non-critical)', {...});
}
```

### 2. WebSocket Connection Status
**Status**: ✅ WebSocket server is properly initialized in `kc-backend/services/api-gateway/src/index.ts`

**Verification**:
- WebSocket server is created using Socket.IO
- `setupEventWebSocket(io)` is called
- Event bus subscribes to Redis Pub/Sub channel `business-events`
- Events are filtered by `shouldReceiveEvent()` function
- Events are emitted to connected clients via `socket.emit('business-event', event)`

## Event Flow (Now Fixed)

```
Purchase Created
    ↓
Allocation Worker allocates trainer
    ↓
Emits TRAINER_ALLOCATED to:
    ├─→ Kafka (for session-worker, cache-worker) ✅
    └─→ Redis Pub/Sub (for WebSocket clients) ✅ NEW
    ↓
WebSocket server forwards to frontend
    ↓
Frontend store receives event
    ↓
Invalidates cache + Refreshes learning data
    ↓
Trainer allocation appears immediately! ✅
```

## Events Now Emitted to Redis Pub/Sub

### Purchase Worker (`kc-backend/services/purchase-worker/src/index.ts`)
- ✅ `PURCHASE_CREATED`
- ✅ `COURSE_ACCESS_GRANTED`

### Allocation Worker (`kc-backend/services/allocation-worker/src/index.ts`)
- ✅ `TRAINER_ALLOCATED` (NEW)

## Frontend Event Handling

The frontend already handles these events:

1. **WebSocket Connection** (`kc-app/services/events/eventSubscription.ts`):
   - Connects to WebSocket server
   - Listens for `business-event` messages
   - Routes events to appropriate store

2. **Store Event Handler** (`kc-app/stores/studentGlobalStore.ts`):
   - Handles `TRAINER_ALLOCATED` events
   - Invalidates all caches
   - Refreshes home and learning data (force=true)
   - Trainer allocation appears automatically

3. **Focus-Based Refresh** (`kc-app/app/(student)/learnings.tsx`):
   - Added `useFocusEffect` to refresh stale data when screen is focused
   - Works as fallback if WebSocket events weren't received
   - Refreshes if data is older than 30 seconds

4. **Pull-to-Refresh** (`kc-app/app/(student)/learnings.tsx`):
   - Fixed `handleRefreshData` to actually refresh data
   - Invalidates caches and force refreshes learning data

## WebSocket Connection Debugging

### Check WebSocket Connection Status
The frontend logs WebSocket connection status:
- `[EventSocket] ✅ Connected successfully` - WebSocket is connected
- `[EventSocket] No access token or valid role available` - Token/role issue
- `[EventSocket] ❌ Failed to initialize WebSocket` - Connection failed

### Check Event Reception
The frontend logs event reception:
- `[EventSocket] ✅ Received event: <event.type>` - Event received
- `[EventSocket] Routing to student store` - Event routed to store
- `[Store] Handling event (order-safe): <event.type>` - Store handling event

### Backend WebSocket Logs
The backend logs WebSocket activity:
- `[WebSocket] User connected: <userId> (<role>)` - Client connected
- `[WebSocket] Event received: <event.type>, userId: <userId>, role: <role>, shouldReceive: <bool>` - Event received
- `[WebSocket] Emitting event to user <userId>: <event.type>` - Event emitted to client

## Testing

### Test WebSocket Connection
1. Check frontend console for `[EventSocket] ✅ Connected successfully`
2. Check backend logs for `[WebSocket] User connected: <userId>`

### Test Event Reception
1. Make a purchase → Should see `PURCHASE_CREATED` and `COURSE_ACCESS_GRANTED` events
2. Wait for allocation → Should see `TRAINER_ALLOCATED` event
3. Check frontend console for event reception logs
4. Verify course and trainer appear in learning screen

### Test Fallback Mechanisms
1. **Focus-based refresh**: Navigate away and back to learnings screen → Should refresh if data is stale
2. **Pull-to-refresh**: Pull down on learnings screen → Should manually refresh data

## Files Modified

1. ✅ `kc-backend/services/allocation-worker/src/index.ts`
   - Added Redis Pub/Sub emission for `TRAINER_ALLOCATED` events

2. ✅ `kc-app/app/(student)/learnings.tsx`
   - Added `useFocusEffect` for focus-based refresh
   - Fixed `handleRefreshData` to actually refresh data

## Expected Behavior

### For Future Purchases:
1. Purchase worker creates purchase
2. Emits `PURCHASE_CREATED` and `COURSE_ACCESS_GRANTED` to Redis Pub/Sub
3. Frontend receives events via WebSocket
4. Course appears automatically ✅

### For Trainer Allocations:
1. Allocation worker allocates trainer
2. Emits `TRAINER_ALLOCATED` to Redis Pub/Sub ✅ NEW
3. Frontend receives event via WebSocket
4. Trainer allocation appears automatically ✅

### Fallback Mechanisms:
1. If WebSocket not connected → Focus-based refresh will update on screen focus
2. If events missed → Pull-to-refresh will manually update
3. If data stale → Focus-based refresh will update when screen is focused

## Notes

- WebSocket connection is required for real-time updates
- If WebSocket is not connected, frontend will still get data on next API call or screen focus
- Events are emitted to both Kafka (for workers) and Redis (for WebSocket)
- Frontend store automatically refreshes data when events are received
- Focus-based refresh ensures data is fresh even if WebSocket events were missed

