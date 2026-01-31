# Purchase Worker Idempotency Fix - Production Grade

## Problem Analysis

### Root Cause
The purchase worker was skipping purchase creation when events were marked as processed in the `processed_events` table, even when the actual purchase record didn't exist in the database. This created a critical data inconsistency:

1. **Payment succeeded** → Payment record created ✅
2. **Event emitted** → `PURCHASE_CONFIRMED` event marked as processed in `processed_events` ✅
3. **Purchase creation failed** → Purchase record NOT created ❌
4. **Worker receives event** → Checks idempotency, finds event marked as processed
5. **Worker skips** → Purchase never created ❌

### Why It Happened

1. **Idempotency Check Order**: The worker checked idempotency status before verifying purchase existence
2. **Missing Recovery Logic**: When event was marked as processed but purchase didn't exist, the worker should have attempted recovery
3. **Database Constraint Issues**: The `ON CONFLICT` constraint might not exist, causing INSERT failures
4. **Transaction Handling**: Purchase creation and event marking weren't properly atomic

## Production-Grade Solution

### 1. Fixed Idempotency Check Order

**Before**:
```typescript
// Check idempotency first
const alreadyProcessed = await idempotencyGuard.isProcessed(...);
if (alreadyProcessed) return; // ❌ Skips even if purchase doesn't exist
```

**After**:
```typescript
// Check purchase existence FIRST (source of truth)
const exists = await purchaseExists(...);
if (exists) {
  // Purchase exists, ensure event is marked, then return
  return;
}

// Then check idempotency (for logging/monitoring)
const alreadyProcessed = await idempotencyGuard.isProcessed(...);
if (alreadyProcessed) {
  // RECOVERY: Event marked but purchase missing - MUST create purchase
  logWithContext('warn', '⚠️ RECOVERY: Event marked as processed but purchase missing');
  // Continue to create purchase (CRITICAL: don't return)
}
```

### 2. Recovery Mechanism

The worker now **always attempts to create a purchase** if it doesn't exist, regardless of idempotency status:

- **Normal Flow**: Event not processed, purchase doesn't exist → Create purchase
- **Recovery Flow**: Event marked as processed, purchase doesn't exist → **Still create purchase** (recovery scenario)

This ensures data consistency even after failures.

### 3. Robust Database Constraint Handling

**Problem**: The `ON CONFLICT (student_id, course_id) WHERE is_active = true` constraint might not exist in all database instances.

**Solution**: Graceful fallback with manual duplicate check:

```typescript
try {
  // Try with ON CONFLICT (if constraint exists)
  const result = await client.query(
    `INSERT ... ON CONFLICT ... RETURNING id`
  );
} catch (error) {
  if (error.code === '42P10') { // Constraint doesn't exist
    // Manual duplicate check
    const existing = await client.query(`SELECT id WHERE ...`);
    if (existing.rows.length > 0) {
      return existing.rows[0].id; // Return existing
    }
    // Create without ON CONFLICT
    const result = await client.query(`INSERT ... RETURNING id`);
  }
}
```

### 4. Atomic Transaction Handling

**Before**: Used `pool.query('BEGIN')` which doesn't guarantee transaction isolation.

**After**: Uses dedicated client connection for transaction:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  // Create purchase (within transaction)
  const purchaseId = await createPurchase(client, ...);
  
  // Mark event as processed (same transaction)
  await idempotencyGuard.markProcessed(...);
  
  // Commit (both succeed or both fail)
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**Benefits**:
- Purchase creation and event marking are atomic
- If marking fails, purchase creation is rolled back
- Ensures data consistency

### 5. Enhanced Logging and Monitoring

Added comprehensive logging for:
- **Recovery scenarios**: When event is marked but purchase is missing
- **Constraint fallbacks**: When ON CONFLICT constraint doesn't exist
- **Transaction outcomes**: Success/failure with context
- **Error details**: Full error context for debugging

## Key Improvements

### ✅ Always Attempts Purchase Creation
- Purchase existence is the source of truth
- Idempotency status is for logging/monitoring only
- Recovery mechanism ensures purchases are created even after failures

### ✅ Handles Missing Constraints
- Graceful fallback when `ON CONFLICT` constraint doesn't exist
- Manual duplicate check ensures idempotency
- Works across different database configurations

### ✅ Atomic Operations
- Purchase creation and event marking are in the same transaction
- Rollback on any failure ensures consistency
- Proper connection management prevents leaks

### ✅ Production-Ready Error Handling
- Comprehensive error logging
- Recovery scenarios properly handled
- Transaction cleanup in all cases

## Testing Scenarios

### Scenario 1: Normal Flow
1. Payment succeeds
2. Event emitted (not processed yet)
3. Worker receives event
4. Purchase doesn't exist → Creates purchase ✅
5. Marks event as processed ✅

### Scenario 2: Recovery Flow
1. Payment succeeds
2. Event emitted and marked as processed
3. Purchase creation failed (previous attempt)
4. Worker receives event
5. Purchase doesn't exist → **Still creates purchase** ✅ (Recovery)
6. Marks event as processed (idempotent) ✅

### Scenario 3: Duplicate Prevention
1. Purchase already exists
2. Worker receives event
3. Checks purchase existence → Found ✅
4. Ensures event is marked → Returns early ✅
5. No duplicate purchase created ✅

### Scenario 4: Missing Constraint
1. Database doesn't have `ON CONFLICT` constraint
2. Worker attempts INSERT with ON CONFLICT
3. Gets error code `42P10`
4. Falls back to manual duplicate check ✅
5. Creates purchase if doesn't exist ✅

## Monitoring Recommendations

### Key Metrics to Track

1. **Recovery Rate**: Count of recovery scenarios (event marked but purchase missing)
2. **Constraint Fallback Rate**: Count of times manual duplicate check is used
3. **Transaction Failure Rate**: Count of rollbacks
4. **Purchase Creation Success Rate**: Overall success rate

### Alert Thresholds

- **Recovery Rate > 1%**: Indicates systematic failures in purchase creation
- **Transaction Failure Rate > 0.1%**: Indicates database or connection issues
- **Purchase Creation Success Rate < 99.9%**: Indicates critical issues

## Deployment Notes

1. **No Database Migration Required**: Works with or without `ON CONFLICT` constraint
2. **Backward Compatible**: Handles existing events and purchases correctly
3. **Zero Downtime**: Can be deployed without service interruption
4. **Rollback Safe**: Old behavior is preserved if new code fails

## Summary

This production-grade fix ensures:
- ✅ **Data Consistency**: Purchases are always created when payments succeed
- ✅ **Recovery**: Handles failures gracefully with automatic recovery
- ✅ **Robustness**: Works across different database configurations
- ✅ **Observability**: Comprehensive logging for monitoring and debugging
- ✅ **Atomicity**: Transaction-based operations ensure consistency

The purchase worker now handles all edge cases and failure scenarios, ensuring purchases are never lost even after system failures.

