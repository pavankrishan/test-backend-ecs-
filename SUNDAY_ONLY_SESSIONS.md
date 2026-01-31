# Sunday-Only Sessions Feature

## Overview
This feature allows students to purchase sessions specifically for Sundays only, with different time slots and durations compared to regular daily sessions.

## Key Features

### 1. Purchase Options
- **Regular Sessions**: 10, 20, or 30 sessions for consecutive days (including Sundays)
- **Sunday-Only Sessions**: 10, 20, or 30 sessions scheduled only on Sundays

### 2. Session Duration
- **Regular Sessions**: 
  - Default: 60 minutes per session
  - Can be 40 minutes per session
- **Sunday-Only Sessions**: 
  - 80 minutes per session (equivalent to 2 regular sessions)
  - This is because normally 1 session = 40 minutes, so 2 sessions = 80 minutes

### 3. Time Slots
- Sunday-only sessions have more time slot options available
- Time slot is selected during purchase and stored in `metadata.timeSlot`
- Used when creating sessions

## Implementation Details

### Database Schema
The `student_course_purchases` table uses the `metadata` JSONB column to store:
```json
{
  "isSundayOnly": true,
  "sessionDuration": 80,
  "timeSlot": "9:00 AM",
  "sessionCount": 10
}
```

### Session Creation Logic
When a trainer is assigned and allocation is approved:

1. **Check Purchase Type**: 
   - Reads `metadata.isSundayOnly` from allocation metadata
   - If `true`, creates sessions only on Sundays

2. **Calculate Start Date**:
   - Regular: Starts from preferred date or tomorrow
   - Sunday-only: Finds the next Sunday from preferred date

3. **Session Duration**:
   - Regular: Uses `metadata.sessionDuration` or defaults to 60 minutes
   - Sunday-only: Uses 80 minutes (2 sessions worth)

4. **Time Slot**:
   - Uses `metadata.timeSlot` from purchase metadata
   - Falls back to `schedule.timeSlot` or defaults to "4:00 PM"

5. **Session Scheduling**:
   - Regular: Creates one session per day for consecutive days
   - Sunday-only: Creates one session per week (only on Sundays)

### Example Flow

**Regular Purchase (20 sessions):**
- Purchase date: Nov 27
- Start date: Nov 28
- Creates sessions: Nov 28, Nov 29, Nov 30, ..., Dec 17 (20 consecutive days)
- Duration: 60 minutes each
- Time: 4:00 PM (default)

**Sunday-Only Purchase (10 sessions):**
- Purchase date: Nov 27
- Next Sunday: Dec 1
- Creates sessions: Dec 1, Dec 8, Dec 15, ..., Feb 2 (10 consecutive Sundays)
- Duration: 80 minutes each (2 sessions worth)
- Time: Selected time slot (e.g., "9:00 AM")

## Metadata Structure

### Purchase Metadata (in `student_course_purchases.metadata`)
```json
{
  "isSundayOnly": true,
  "sessionDuration": 80,
  "timeSlot": "9:00 AM",
  "sessionCount": 10,
  "groupSize": 1,
  "learningMode": "home"
}
```

### Allocation Metadata (inherited from purchase)
The allocation service reads from purchase metadata and includes:
- `isSundayOnly`: Boolean flag
- `sessionDuration`: Duration in minutes
- `timeSlot`: Selected time slot
- `sessionCount`: Number of sessions (from `purchase_tier`)

### Session Metadata (in `tutoring_sessions.metadata`)
```json
{
  "autoCreated": true,
  "createdFromAllocation": "allocation-id",
  "sessionNumber": 1,
  "totalSessions": 10,
  "isSundayOnly": true,
  "sessionDuration": 80,
  "preferredSchedule": {
    "timeSlot": "9:00 AM",
    "date": "2024-12-01T00:00:00Z"
  }
}
```

## API Integration

When creating a purchase, the frontend should include:
```json
{
  "courseId": "course-id",
  "purchaseTier": 10,
  "metadata": {
    "isSundayOnly": true,
    "sessionDuration": 80,
    "timeSlot": "9:00 AM",
    "sessionCount": 10
  }
}
```

## Files Modified

1. **`kc-backend/services/admin-service/src/services/allocation.service.ts`**
   - Updated `createInitialSession()` method
   - Added Sunday-only session creation logic
   - Added support for 80-minute duration
   - Added time slot selection from metadata

## Testing

To test Sunday-only sessions:

1. Create a purchase with `isSundayOnly: true` in metadata
2. Assign a trainer to the allocation
3. Approve the allocation
4. Verify sessions are created only on Sundays
5. Verify session duration is 80 minutes
6. Verify time slot matches the selected time

## Notes

- Sunday-only sessions skip weekdays automatically
- If a preferred date is provided but it's not a Sunday, the system finds the next Sunday
- Reschedules work the same way - sessions can be rescheduled but will maintain Sunday-only constraint if applicable
- The system supports both regular and Sunday-only purchases simultaneously for the same student

