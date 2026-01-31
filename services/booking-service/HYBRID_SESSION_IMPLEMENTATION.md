# HYBRID Session Generation Implementation

## Overview

Complete implementation of HYBRID class session generation and booking logic for the ed-tech platform (600k+ users). Supports the HYBRID class type with 30 sessions split into 18 online and 12 offline sessions.

## Implementation Details

### Session Pattern

**HYBRID Class Requirements:**
- Total sessions per batch: **30**
- Online sessions: **18** (fixed time, defined by admin/client)
- Offline sessions: **12** (flexible time, student books slots)
- **First 6 sessions**: ONLINE only
- **After session 6**: Sessions alternate ONLINE → OFFLINE → ONLINE → OFFLINE...
- Sessions occur on **consecutive days** (no gaps unless specified)
- Each month can have 2 independent batches

### Session Rules

#### ONLINE Sessions
- Time is **FIXED** by client/admin (via `preferredTimeSlot`)
- Students can only **JOIN** (cannot choose or modify time)
- Capacity-based (many students per session)
- Metadata flags:
  - `isBookable: false`
  - `isFixedTime: true`
  - `requiresBooking: false`

#### OFFLINE Sessions
- Time is **FLEXIBLE** (initially set to `preferredTimeSlot`, but student can book different slot)
- Student selects available slot
- Must validate trainer availability
- Prevent double booking
- Capacity depends on class type (1-1, 1-2, 1-3)
- Metadata flags:
  - `isBookable: true`
  - `isFixedTime: false`
  - `requiresBooking: true`
  - `initialTimeSlot: <preferredTimeSlot>`

## Files Modified

### 1. `sessionScheduleGenerator.service.ts`
- **Method**: `generateHybridSchedule()`
- **Changes**:
  - Implemented correct pattern: First 6 ONLINE, then alternate
  - Added strict validation for exact counts (18 online, 12 offline)
  - Added metadata flags for booking behavior
  - Ensures consecutive days

### 2. `sessionSync.service.ts`
- **Method**: `syncSingleSession()`
- **Changes**:
  - Preserves all metadata from purchase sessions
  - Ensures booking flags are maintained when syncing to `tutoring_sessions`

### 3. New Files Created

#### `utils/hybridScheduleValidator.ts`
- Validation utility to verify HYBRID schedules meet all business rules
- Checks:
  - Exact session counts (30 total, 18 online, 12 offline)
  - First 6 are ONLINE
  - Alternation pattern after session 6
  - Consecutive days
  - Metadata flags

#### `utils/__tests__/hybridSchedule.test.ts`
- Comprehensive test suite for HYBRID schedule generation
- Validates all business rules and edge cases

## Usage

### Generating HYBRID Schedule

```typescript
import { SessionScheduleGeneratorService } from './services/sessionScheduleGenerator.service';

const generator = new SessionScheduleGeneratorService();

const schedule = generator.generateSchedule(
  purchaseId,
  bookingId,
  'HYBRID',        // Class type
  30,              // Total sessions (must be 30 for HYBRID)
  'WEEKDAY_DAILY', // Delivery mode
  startDate,       // Start date
  '16:00'          // Preferred time slot (fixed for online, initial for offline)
);

// schedule.sessions contains 30 sessions:
// - Sessions 1-6: ONLINE
// - Sessions 7-30: Alternating ONLINE/OFFLINE
```

### Validating Schedule

```typescript
import { validateHybridSchedule } from './utils/hybridScheduleValidator';

const validation = validateHybridSchedule(schedule.sessions);

if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
}
```

## Example Schedule Output

For a HYBRID class starting on 2024-01-01:

```
Session 1: 2024-01-01, ONLINE, 16:00 (fixed)
Session 2: 2024-01-02, ONLINE, 16:00 (fixed)
Session 3: 2024-01-03, ONLINE, 16:00 (fixed)
Session 4: 2024-01-04, ONLINE, 16:00 (fixed)
Session 5: 2024-01-05, ONLINE, 16:00 (fixed)
Session 6: 2024-01-06, ONLINE, 16:00 (fixed)
Session 7: 2024-01-07, ONLINE, 16:00 (fixed)
Session 8: 2024-01-08, OFFLINE, 16:00 (bookable)
Session 9: 2024-01-09, ONLINE, 16:00 (fixed)
Session 10: 2024-01-10, OFFLINE, 16:00 (bookable)
...
Session 30: 2024-01-30, OFFLINE, 16:00 (bookable)
```

## Integration Points

### Auto Trainer Assignment
- `AutoTrainerAssignmentService` uses `SessionScheduleGeneratorService`
- Online sessions ignore zone/operator/travel rules (already implemented)
- Offline sessions require zone match and travel feasibility

### Session Sync
- `SessionSyncService` preserves metadata when syncing to `tutoring_sessions`
- Booking flags maintained for frontend consumption

### Frontend Integration
Frontend should check metadata flags:
```typescript
const session = /* ... */;
const metadata = session.metadata as Record<string, unknown>;

if (metadata.isBookable === true) {
  // Show booking UI for offline sessions
  // Allow student to select time slot
} else {
  // Show join button for online sessions
  // Time is fixed, cannot be changed
}
```

## Validation Rules

1. ✅ Exactly 30 sessions total
2. ✅ Exactly 18 online sessions
3. ✅ Exactly 12 offline sessions
4. ✅ First 6 sessions are ONLINE
5. ✅ After session 6, alternates ONLINE/OFFLINE
6. ✅ Sessions on consecutive days
7. ✅ Online sessions have `isFixedTime: true`
8. ✅ Offline sessions have `isBookable: true`

## Error Handling

The implementation throws descriptive errors:
- `HYBRID mode requires exactly 30 sessions`
- `Expected 18 online sessions, but generated X`
- `Expected 12 offline sessions, but generated X`

## Performance Considerations

- **Deterministic generation**: No randomness, same input produces same output
- **No database queries**: Pure computation, fast execution
- **Scalable**: O(n) complexity where n = total sessions
- **Cache-friendly**: Results can be cached by purchase ID

## Testing

Run tests:
```bash
npm test -- hybridSchedule.test.ts
```

Or use the validator directly:
```typescript
import { validateHybridSchedule } from './utils/hybridScheduleValidator';

const result = validateHybridSchedule(sessions);
console.log(result.isValid, result.errors, result.stats);
```

## Next Steps

1. **Frontend Integration**: Use metadata flags to show appropriate UI
2. **Booking API**: Implement slot booking for offline sessions with trainer availability validation
3. **Admin Configuration**: Add admin panel to configure online session fixed times (if needed)
4. **Monitoring**: Add metrics to track HYBRID class adoption and booking patterns

## Notes

- Online session times are currently set via `preferredTimeSlot` during purchase
- If separate admin-defined times are needed, add a configuration table
- Offline sessions initially use `preferredTimeSlot` but can be changed during booking
- All validation is done at generation time to prevent invalid schedules
