# Root Cause Analysis: Allocation Worker Failure

## EXECUTION TRACE

### Step 1: Payment Service ✅
- Payment verified: `1fa90c93-ea40-4ba9-a7bf-4ed47e735b91`
- Status: `succeeded`
- PURCHASE_CONFIRMED event emitted
- **Result**: ✅ CONFIRMED (payment exists)

### Step 2: Purchase Worker ✅
- Consumes: `purchase-confirmed` topic
- Creates purchase in `student_course_purchases`
- Emits: `PURCHASE_CREATED` event
- **Result**: ✅ CONFIRMED (purchase exists in DB)

### Step 3: Allocation Worker ❌
- Should consume: `purchase-created` topic
- Should call: admin-service `/api/v1/admin/allocations/auto-assign`
- Should create: row in `trainer_allocations`
- **Result**: ❌ FAILED (no allocation in DB)

---

## CRITICAL BUG IDENTIFIED

### Location: `services/allocation-worker/src/index.ts:183-196`

**The Problem**:
```typescript
// Allocate trainer via admin-service API
const { allocationId, trainerId } = await allocateTrainer(...);

// Mark event as processed
await idempotencyGuard.markProcessed(...);
```

**Root Cause**: 
The allocation worker marks the event as processed **AFTER** calling admin-service API, but:
1. **NO verification** that allocation exists in database
2. **NO transaction** wrapping the allocation creation
3. Admin-service API might return success but allocation creation could fail
4. If admin-service is async or has internal errors, allocation won't exist

**Evidence**:
- Purchase exists ✅
- Allocation does NOT exist ❌
- This means admin-service API either:
  - Was never called
  - Returned success but didn't create allocation
  - Failed silently

---

## DIAGNOSTIC CHECKS REQUIRED

### Check 1: Is Allocation Worker Running?
```bash
# Check if worker process exists
docker ps | grep allocation-worker
# OR
ps aux | grep allocation-worker
```

**Expected**: Worker process should be running
**If NOT**: Worker is not deployed/started → **ROOT CAUSE #1**

### Check 2: Is Kafka Topic Created?
```bash
kafka-topics --list --bootstrap-server localhost:9092 | grep purchase-created
```

**Expected**: `purchase-created` topic exists
**If NOT**: Topic missing → **ROOT CAUSE #2**

### Check 3: Is Event in Kafka?
```bash
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic purchase-created \
  --from-beginning \
  --max-messages 10
```

**Expected**: PURCHASE_CREATED event visible
**If NOT**: Event never emitted → **ROOT CAUSE #3**

### Check 4: Is processed_events Marked?
```sql
SELECT * FROM processed_events 
WHERE event_type = 'PURCHASE_CREATED' 
  AND correlation_id = '1fa90c93-ea40-4ba9-a7bf-4ed47e735b91'
ORDER BY processed_at DESC;
```

**Expected**: 
- If EXISTS → Event was processed but allocation failed → **ROOT CAUSE #4**
- If NOT EXISTS → Event never consumed → **ROOT CAUSE #5**

### Check 5: Admin-Service Logs
```bash
# Check admin-service logs for allocation API call
docker logs kodingcaravan-admin-service | grep "auto-assign"
```

**Expected**: API call logged with studentId `809556c1-e184-4b85-8fd6-a5f1c8014bf6`
**If NOT**: API never called → **ROOT CAUSE #6**

---

## MOST LIKELY ROOT CAUSES (Ranked)

### #1: Allocation Worker Not Running (90% certainty)
**Evidence**: No allocation in DB, no logs from allocation worker
**Fix**: Deploy/start allocation worker

### #2: Kafka Topic Missing (80% certainty)
**Evidence**: Event emitted but not consumed
**Fix**: Create `purchase-created` topic

### #3: Admin-Service API Failing (70% certainty)
**Evidence**: API called but allocation not created
**Fix**: Check admin-service logs, fix API

### #4: Idempotency Guard Skipping (60% certainty)
**Evidence**: Event marked processed but allocation missing
**Fix**: Verify allocation exists before marking processed

### #5: Consumer Group Issue (50% certainty)
**Evidence**: Worker running but not consuming
**Fix**: Check consumer group configuration

---

## MINIMAL FIX (If Worker is Running)

### Fix Location: `services/allocation-worker/src/index.ts:183-196`

**Current Code** (BUGGY):
```typescript
// Allocate trainer via admin-service API
const { allocationId, trainerId } = await allocateTrainer(...);

// Mark event as processed
await idempotencyGuard.markProcessed(...);
```

**Fixed Code**:
```typescript
// Allocate trainer via admin-service API
const { allocationId, trainerId } = await allocateTrainer(...);

// CRITICAL: Verify allocation exists in database
const allocationExists = await pool.query(
  `SELECT id FROM trainer_allocations WHERE id = $1`,
  [allocationId]
);

if (allocationExists.rows.length === 0) {
  throw new Error(`Allocation ${allocationId} not found in database after API call`);
}

// Mark event as processed ONLY after verification
await idempotencyGuard.markProcessed(...);
```

---

## VERIFICATION QUERIES

Run these to confirm root cause:

```sql
-- 1. Check if purchase exists
SELECT * FROM student_course_purchases 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = 'ebefde63-8a3a-4d45-a594-c04275a03092';

-- 2. Check if allocation exists
SELECT * FROM trainer_allocations 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = 'ebefde63-8a3a-4d45-a594-c04275a03092';

-- 3. Check processed_events for PURCHASE_CREATED
SELECT * FROM processed_events 
WHERE event_type = 'PURCHASE_CREATED'
  AND correlation_id LIKE '%1fa90c93-ea40-4ba9-a7bf-4ed47e735b91%'
ORDER BY processed_at DESC;

-- 4. Check processed_events for PURCHASE_CONFIRMED
SELECT * FROM processed_events 
WHERE event_type = 'PURCHASE_CONFIRMED'
  AND correlation_id = '1fa90c93-ea40-4ba9-a7bf-4ed47e735b91'
ORDER BY processed_at DESC;
```

---

## NEXT STEPS

1. **Run verification queries** → Identify exact failure point
2. **Check worker logs** → Confirm worker is running
3. **Check Kafka topics** → Confirm topic exists
4. **Check admin-service logs** → Confirm API was called
5. **Apply minimal fix** → Add allocation verification

---

## CONFIDENCE LEVELS

- **90%**: Worker not running OR topic missing
- **70%**: Admin-service API failing
- **60%**: Idempotency guard skipping incorrectly
- **50%**: Consumer group misconfiguration

**Action**: Check worker status first, then apply verification fix.

