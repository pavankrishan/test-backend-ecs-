# Session Worker Database Schema Fix

## Problem
Session worker was querying non-existent columns `start_date` and `preferred_time_slot` from `trainer_allocations` table, causing cron job failures.

## Root Cause
The `trainer_allocations` table schema does NOT include:
- `start_date` column
- `preferred_time_slot` column

These values are:
1. **In the TRAINER_ALLOCATED event**: The `startDate` is already in the event payload
2. **In metadata JSONB**: May be stored in the `metadata` column as JSON

## Fixes Applied

### 1. Removed `getAllocationDetails` Function
- **Before**: Queried `start_date` and `preferred_time_slot` (non-existent columns)
- **After**: Removed function entirely, use event data directly

### 2. Updated Event Handler
- **Before**: Called `getAllocationDetails()` to get start date
- **After**: Uses `allocationEvent.startDate` from the `TRAINER_ALLOCATED` event
- Only queries database to verify allocation exists (student_id, trainer_id, course_id)

### 3. Fixed Cron Job
- **Before**: Queried `start_date` and `preferred_time_slot` columns
- **After**: 
  - Queries only existing columns: `id, student_id, trainer_id, course_id, metadata`
  - Extracts `startDate` from `metadata` JSONB column
  - Falls back to today's date if not found
  - Uses default time slot `'4:00 PM'`

## Code Changes

**Event Handler:**
```typescript
// Before: getAllocationDetails() querying non-existent columns
// After: Use allocationEvent.startDate directly
const sessionStartDate = allocationEvent.startDate || new Date().toISOString().split('T')[0];
```

**Cron Job:**
```typescript
// Before: SELECT start_date, preferred_time_slot (columns don't exist)
// After: SELECT metadata, extract startDate from JSONB
const metadata = allocation.metadata as Record<string, unknown> | null;
const startDate = (metadata?.startDate as string) || 
                 (metadata?.schedule as Record<string, unknown>)?.startDate as string ||
                 new Date().toISOString().split('T')[0];
```

## Next Steps

Rebuild session worker:
```powershell
cd kc-backend
docker-compose build session-worker
docker-compose up -d session-worker
```

## Verification

After rebuild, check logs:
```powershell
docker-compose logs session-worker | Select-String -Pattern "Cron|error|ERROR"
```

The cron job should no longer fail with "column start_date does not exist" error.

