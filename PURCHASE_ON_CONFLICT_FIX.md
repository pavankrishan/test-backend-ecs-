# Purchase ON CONFLICT Error Fix - Complete Resolution

## Problem

Every time a course is purchased from the frontend app, the `purchase-worker` fails with:
```
Error: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
Error: "current transaction is aborted, commands ignored until end of transaction block"
```

This causes:
- ❌ Purchases fail to be created
- ❌ Courses don't appear after payment
- ❌ Events are sent to Dead Letter Queue (DLQ)
- ❌ Worker crashes and restarts

## Root Cause

1. **Missing Database Index**: The `unique_active_purchase` index doesn't exist in the database
2. **Incorrect ON CONFLICT Syntax**: The code was using `ON CONFLICT (student_id, course_id) WHERE is_active = true`, but PostgreSQL doesn't support WHERE clauses in ON CONFLICT
3. **Transaction Abortion**: When ON CONFLICT fails, PostgreSQL aborts the transaction, but the code tried to continue using the aborted transaction
4. **Migration Not Run**: The migration file `002_add_idempotency_constraints.sql` exists but may not have been executed

## Why Scripts Work But Frontend Doesn't

Scripts likely work because:
- They might be using a different database connection
- They might be running against a database where the index exists
- They might be using the fallback method directly
- The migration might have been run manually for scripts but not for the production database

## Solution

### 1. Fixed ON CONFLICT Syntax

**Before:**
```sql
ON CONFLICT (student_id, course_id) WHERE is_active = true
```

**After:**
```sql
ON CONFLICT (student_id, course_id)
```

PostgreSQL automatically matches partial unique indexes when the WHERE clause conditions are met.

### 2. Added Index Existence Check

The code now:
- Checks if the `unique_active_purchase` index exists before attempting ON CONFLICT
- Uses cached result (5-minute TTL) to avoid checking on every purchase
- Falls back to manual duplicate check + INSERT if index doesn't exist
- Prevents transaction abortion by using fallback immediately

### 3. Improved Transaction Handling

- Properly rolls back aborted transactions
- Uses a completely new client for fallback method
- Ensures original client is released before using fallback client
- Prevents double-release errors

### 4. Created Index Creation Script

Created `scripts/ensure-purchase-index.js` to:
- Check if index exists
- Create index if missing
- Verify index creation
- Provide clear instructions

## How to Fix

### Step 1: Ensure the Index Exists

**Option A: Using Node.js Script (Recommended if connection works)**

```powershell
cd C:\Users\PC\Desktop\React-Expo-set\kc-backend
node scripts/ensure-purchase-index.js
```

**Option B: Using SQL File Directly (If Node.js script has connection issues)**

If you get connection errors with the Node.js script, use the SQL file directly:

1. **Via psql (if installed):**
   ```powershell
   psql -U postgres -d kodingcaravan -f kc-backend/scripts/create-purchase-index.sql
   ```

2. **Via SQL Client (pgAdmin, DBeaver, etc.):**
   - Open `kc-backend/scripts/create-purchase-index.sql`
   - Copy and paste into your SQL client
   - Execute the SQL

3. **Via Cloud Database Console:**
   - Log into your cloud database console (AWS RDS, Google Cloud SQL, etc.)
   - Open SQL query editor
   - Copy contents of `create-purchase-index.sql`
   - Execute

**Expected Output:**
```
✅ Index already exists: unique_active_purchase
   OR
✅ Index created successfully!
```

### Step 2: Verify the Fix

The `purchase-worker` will now:
1. Check if index exists on startup
2. Log a warning if index is missing
3. Use fallback method if index doesn't exist (prevents errors)
4. Use ON CONFLICT if index exists (better performance)

### Step 3: Test Purchase Flow

1. Make a purchase from the frontend
2. Check `purchase-worker` logs - should see:
   - `✅ unique_active_purchase index found` (if index exists)
   - `⚠️ unique_active_purchase index not found - will use fallback method` (if index missing)
3. Purchase should succeed in both cases
4. Course should appear immediately after payment

## Code Changes

### File: `kc-backend/services/purchase-worker/src/index.ts`

1. **Added Index Check Function** (lines ~61-105):
   - `checkIndexExists()` - Checks if index exists with caching
   - Caches result for 5 minutes to avoid repeated checks

2. **Updated `createPurchase` Function** (lines ~177-220):
   - Checks index existence before attempting ON CONFLICT
   - Uses fallback immediately if index doesn't exist
   - Fixed ON CONFLICT syntax (removed WHERE clause)

3. **Updated `initialize` Function** (lines ~46-75):
   - Checks index on startup
   - Logs warning if index is missing
   - Provides instructions to create index

4. **Improved Transaction Handling** (lines ~401-580):
   - Proper rollback on errors
   - New client for fallback method
   - Prevents double-release errors

## Database Schema

The index should be:
```sql
CREATE UNIQUE INDEX unique_active_purchase 
ON student_course_purchases(student_id, course_id) 
WHERE is_active = true;
```

This ensures:
- Only one active purchase per student per course
- Idempotent purchase creation
- Automatic duplicate prevention

## Migration File

The migration file `migrations/002_add_idempotency_constraints.sql` creates this index, but it may not have been run.

**To run the migration:**
```powershell
# Option 1: Run the full migration
psql -U postgres -d kodingcaravan -f kc-backend/migrations/002_add_idempotency_constraints.sql

# Option 2: Use the index creation script (recommended)
node kc-backend/scripts/ensure-purchase-index.js
```

## Troubleshooting

### Connection Error (ECONNRESET)

If you get `Error: read ECONNRESET` when running the Node.js script:

**This usually means:**
1. Database is not accessible from your machine
2. SSL/TLS configuration issue
3. Firewall blocking the connection
4. Wrong connection credentials

**Solutions:**

1. **Use SQL File Instead (Easiest):**
   - Use `scripts/create-purchase-index.sql` directly
   - Run via your cloud database console or SQL client
   - No connection issues this way

2. **Check Your .env File:**
   ```env
   POSTGRES_URL=postgresql://user:password@host:5432/database?sslmode=require
   # OR
   POSTGRES_HOST=your-db-host
   POSTGRES_PORT=5432
   POSTGRES_USER=your-user
   POSTGRES_PASSWORD=your-password
   POSTGRES_DB=your-database
   POSTGRES_SSL=true
   ```

3. **Verify Database is Accessible:**
   - Check if database is running
   - Verify host/port are correct
   - Check firewall rules allow your IP
   - For cloud databases, ensure your IP is whitelisted

4. **Test Connection:**
   ```powershell
   # Test with psql (if installed)
   psql -h your-host -U your-user -d your-database
   ```

## Verification

After applying the fix, verify:

1. **Index exists:**
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'student_course_purchases' 
     AND indexname = 'unique_active_purchase';
   ```

2. **Worker logs show:**
   - `✅ unique_active_purchase index found` on startup
   - No ON CONFLICT errors during purchase processing

3. **Frontend purchases work:**
   - Payment succeeds
   - Course appears immediately
   - No errors in purchase-worker logs

## Expected Behavior After Fix

### With Index (Optimal):
1. Purchase event received
2. Index check: ✅ exists
3. Use ON CONFLICT (fast, atomic)
4. Purchase created successfully
5. Events emitted
6. Course appears in frontend

### Without Index (Fallback):
1. Purchase event received
2. Index check: ❌ doesn't exist
3. Use fallback method (manual check + INSERT)
4. Purchase created successfully
5. Events emitted
6. Course appears in frontend
7. Warning logged to create index

## Next Steps

1. ✅ Run `node scripts/ensure-purchase-index.js` to create the index
2. ✅ Restart `purchase-worker` service
3. ✅ Test purchase flow from frontend
4. ✅ Verify courses appear immediately after payment
5. ✅ Monitor logs to ensure no more ON CONFLICT errors

## Related Files

- `kc-backend/services/purchase-worker/src/index.ts` - Main worker code
- `kc-backend/migrations/002_add_idempotency_constraints.sql` - Migration file
- `kc-backend/scripts/ensure-purchase-index.js` - Index creation script

