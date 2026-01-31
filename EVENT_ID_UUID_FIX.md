# Event ID UUID Format Fix

## Problem

The `allocation-worker` was failing with:
```
Error: "invalid input syntax for type uuid: \"purchase-created-8620e626-27f8-4068-b2c0-85ecc9e60062\""
```

The issue was that `eventId` contained a prefix (`"purchase-created-"`) before the UUID, but the database `processed_events` table expects a pure UUID in the `event_id` column.

## Root Cause

1. Some events are emitted with prefixed `eventId` (e.g., `"purchase-created-{uuid}"`)
2. The `extractEventId()` function was supposed to extract the UUID, but it wasn't being used correctly in all cases
3. The database `processed_events.event_id` column is of type UUID and cannot accept prefixed strings

## Solution

**Use `purchaseId` directly as `eventId`** instead of trying to extract from the raw eventId:

1. **Why**: `purchaseId` is always a valid UUID (from database)
2. **Why**: Avoids regex extraction which could fail
3. **Why**: Consistent with `purchase-worker` which uses `purchaseId` as `eventId` (line 821)

## Changes Made

### 1. `allocation-worker/src/index.ts` - PURCHASE_CREATED events

**Before**:
```typescript
const rawEventId = getEventId(event);
const eventId = extractEventId(rawEventId);
```

**After**:
```typescript
const rawEventId = getEventId(event);

// Use purchaseId as eventId if available (it's always a UUID)
let eventId: string;
if (purchaseEvent.purchaseId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseEvent.purchaseId)) {
  eventId = purchaseEvent.purchaseId;
} else {
  eventId = extractEventId(rawEventId);
}
```

### 2. `allocation-worker/src/index.ts` - TRAINER_ALLOCATED event emission

**Before**:
```typescript
await kafkaBus.emit(trainerAllocatedEvent, {
  eventId: `trainer-allocated-${allocationId}`,
  ...
});
```

**After**:
```typescript
// Use allocationId directly as eventId (it's already a UUID)
await kafkaBus.emit(trainerAllocatedEvent, {
  eventId: allocationId,
  ...
});
```

### 3. `admin-service/src/services/allocation.service.ts` - TRAINER_ALLOCATED event emission

**Before**:
```typescript
eventId: `trainer-allocated-${approved.id}`,
```

**After**:
```typescript
eventId: approved.id, // Use allocationId directly as eventId (it's already a UUID)
```

### 4. `session-worker/src/index.ts` - TRAINER_ALLOCATED event handling

**Before**:
```typescript
const eventId = getEventId(event);
```

**After**:
```typescript
const rawEventId = getEventId(event);

// Use allocationId as eventId if available (it's always a UUID)
let eventId: string;
if (allocationEvent.allocationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(allocationEvent.allocationId)) {
  eventId = allocationEvent.allocationId;
} else {
  // Extract UUID from prefixed eventId
  const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const match = rawEventId.match(uuidPattern);
  if (match && match[1]) {
    eventId = match[1];
  } else {
    throw new Error(`Invalid eventId format - no UUID found: ${rawEventId}`);
  }
}
```

### 5. `cache-worker/src/index.ts` - TRAINER_ALLOCATED event handling

Applied the same fix as `session-worker` for consistency.

## Benefits

1. **Reliability**: Uses guaranteed UUID format instead of regex extraction
2. **Consistency**: Matches `purchase-worker` behavior
3. **Error Prevention**: Avoids UUID format errors in database
4. **Fallback**: Still uses extraction if `purchaseId` not available

## Testing

After this fix:
- ✅ `allocation-worker` should process `PURCHASE_CREATED` events without UUID errors
- ✅ Events will be marked as processed correctly in `processed_events` table
- ✅ Idempotency checks will work correctly
