# Session Limit Increased

## Issue
The API was only returning 50 sessions when the database has 60 sessions. Additionally, with 5 courses planned (each with 90 sessions = 450 total sessions), the limit needed to be much higher.

## Root Cause
The SQL query in `aggregation.service.ts` had a hardcoded `LIMIT 50` clause, which was insufficient for:
- Current needs: 60 sessions
- Future needs: 5 courses × 90 sessions = 450 sessions

## Solution
Increased the limit from 50 to 1000 to accommodate all current and future sessions:

```typescript
const MAX_UPCOMING_SESSIONS = 1000; // Support up to 1000 sessions (5 courses × 90 sessions = 450, with room for growth)
```

Updated both SQL queries to use this constant:
- Main query (line 697): `LIMIT ${MAX_UPCOMING_SESSIONS}`
- Raw data check query (line 608): `LIMIT ${MAX_UPCOMING_SESSIONS}`

## Changes Made

**File**: `kc-backend/services/student-service/services/aggregation.service.ts`
- **Line 16**: Added `MAX_UPCOMING_SESSIONS = 1000` constant
- **Line 608**: Changed `LIMIT 100` to use `MAX_UPCOMING_SESSIONS`
- **Line 697**: Changed `LIMIT 50` to use `MAX_UPCOMING_SESSIONS`

## Impact

- ✅ Now returns up to 1000 sessions (was 50)
- ✅ All 60 current sessions from database will be returned
- ✅ Supports future growth: 5 courses × 90 sessions = 450 sessions
- ✅ Room for additional growth beyond 450 sessions

## Next Steps

1. **Restart backend service** to apply the change:
   ```bash
   cd kc-backend
   # Stop current service (Ctrl+C)
   # Restart with: pnpm dev
   ```

2. **Clear Redis cache** (optional, to see immediate effect):
   ```bash
   cd kc-backend
   node clear-student-cache.js <studentId>
   ```

3. **Reload mobile app** to fetch fresh data

## Expected Result

After restart:
- ✅ API should return all 60 sessions (and up to 1000 in future)
- ✅ Frontend should display all sessions
- ✅ Ready for 5 courses × 90 sessions = 450 sessions

## Performance Considerations

- 1000 sessions is still reasonable for a single query
- Results are cached in Redis for 5 minutes
- If performance becomes an issue, consider pagination
- Current limit (1000) should handle all planned courses with room for growth
