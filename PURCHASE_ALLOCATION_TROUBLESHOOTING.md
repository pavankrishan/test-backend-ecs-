# Purchase Allocation Troubleshooting Guide

## Problem: Purchase Made But Allocation Not Triggered

When a student purchases a course from the frontend app, the following flow should happen automatically:

```
Payment Success
    ↓
PURCHASE_CONFIRMED event (Payment Service)
    ↓
Purchase Worker (creates purchase record)
    ↓
PURCHASE_CREATED event
    ↓
Allocation Worker (triggers trainer allocation)
    ↓
Sessions Created
```

If allocation is not triggered, one of these steps is failing.

---

## Quick Diagnosis

### Step 1: Run Diagnostic Script

```bash
cd kc-backend
node diagnose-purchase-allocation.js <studentId> <courseId>
```

**Or without arguments to see recent purchases:**
```bash
node diagnose-purchase-allocation.js
```

This will show:
- ✅ Payment status
- ✅ Purchase record status
- ✅ Processed events (PURCHASE_CONFIRMED, PURCHASE_CREATED)
- ✅ Allocation status
- ✅ Sessions status

---

## Common Issues & Fixes

### Issue 1: Purchase Not Created

**Symptoms:**
- Payment exists with status 'succeeded'
- No purchase record in `student_course_purchases`
- No PURCHASE_CONFIRMED event in `processed_events`

**Root Cause:**
- Purchase worker not running
- Kafka not running or misconfigured
- Event not emitted from payment service

**Fix:**
1. Check if purchase-worker is running:
   ```bash
   docker ps | grep purchase-worker
   ```

2. Check Kafka is running:
   ```bash
   docker ps | grep kafka
   ```

3. Check payment service logs:
   ```bash
   docker logs kodingcaravan-payment-service | grep "PURCHASE_CONFIRMED"
   ```

4. If event was emitted but not processed, check purchase-worker logs:
   ```bash
   docker logs kodingcaravan-purchase-worker | tail -50
   ```

---

### Issue 2: Purchase Created But No Allocation

**Symptoms:**
- ✅ Purchase record exists
- ✅ PURCHASE_CONFIRMED event processed
- ❌ No allocation in `trainer_allocations`
- ❌ PURCHASE_CREATED event may or may not be processed

**Root Cause:**
- Allocation worker not running
- PURCHASE_CREATED event not emitted
- Admin-service API failing

**Fix:**

#### Option A: Manual Trigger (Quick Fix)

```bash
cd kc-backend
node manual-trigger-allocation.js <studentId> <courseId>
```

This will:
1. Find the purchase record
2. Extract metadata (timeSlot, startDate, etc.)
3. Call admin-service API to trigger allocation
4. Create sessions automatically

#### Option B: Check Workers

1. Check if allocation-worker is running:
   ```bash
   docker ps | grep allocation-worker
   ```

2. Check if PURCHASE_CREATED event was emitted:
   ```bash
   # Check processed_events table
   psql $POSTGRES_URL -c "
     SELECT event_type, source, processed_at 
     FROM processed_events 
     WHERE event_type = 'PURCHASE_CREATED'
     ORDER BY processed_at DESC 
     LIMIT 5;
   "
   ```

3. Check allocation-worker logs:
   ```bash
   docker logs kodingcaravan-allocation-worker | tail -50
   ```

4. Check admin-service logs:
   ```bash
   docker logs kodingcaravan-admin-service | grep "auto-assign" | tail -20
   ```

---

### Issue 3: Allocation Created But No Sessions

**Symptoms:**
- ✅ Purchase exists
- ✅ Allocation exists with status 'approved'
- ❌ No sessions in `tutoring_sessions`

**Root Cause:**
- Session creation failed
- GPS coordinates missing
- Session worker not running

**Fix:**

1. Check if allocation has trainer_id:
   ```sql
   SELECT id, trainer_id, status 
   FROM trainer_allocations 
   WHERE student_id = '<studentId>' 
     AND course_id = '<courseId>';
   ```

2. Check student GPS coordinates:
   ```sql
   SELECT latitude, longitude 
   FROM students 
   WHERE id = '<studentId>';
   ```

3. Check session-worker logs:
   ```bash
   docker logs kodingcaravan-session-worker | tail -50
   ```

---

## Manual Fix Steps

### Step 1: Verify Purchase Exists

```sql
SELECT id, student_id, course_id, purchase_tier, created_at
FROM student_course_purchases
WHERE student_id = '<studentId>'
  AND course_id = '<courseId>'
  AND is_active = true;
```

### Step 2: Check Events

```sql
SELECT event_type, correlation_id, source, processed_at
FROM processed_events
WHERE correlation_id IN (
  SELECT id::text FROM payments
  WHERE student_id = '<studentId>'
    AND (metadata->>'courseId')::uuid = '<courseId>'
    AND status = 'succeeded'
  ORDER BY created_at DESC
  LIMIT 1
)
ORDER BY processed_at DESC;
```

### Step 3: Check Allocation

```sql
SELECT id, trainer_id, status, created_at
FROM trainer_allocations
WHERE student_id = '<studentId>'
  AND course_id = '<courseId>'
ORDER BY created_at DESC
LIMIT 1;
```

### Step 4: Manually Trigger Allocation

If purchase exists but no allocation:

```bash
cd kc-backend
node manual-trigger-allocation.js <studentId> <courseId>
```

---

## Worker Status Check

### Check All Workers

```bash
# List all worker containers
docker ps | grep -E "purchase-worker|allocation-worker|session-worker|cache-worker"

# Check each worker's logs
docker logs kodingcaravan-purchase-worker | grep "Started"
docker logs kodingcaravan-allocation-worker | grep "Started"
docker logs kodingcaravan-session-worker | grep "Started"
docker logs kodingcaravan-cache-worker | grep "Started"
```

### Check Kafka Topics

```bash
docker exec kodingcaravan-kafka kafka-topics --list --bootstrap-server localhost:9092
```

Expected topics:
- `purchase-confirmed`
- `purchase-created`
- `trainer-allocated`
- `dead-letter-queue`

### Check Consumer Groups

```bash
docker exec kodingcaravan-kafka kafka-consumer-groups --bootstrap-server localhost:9092 --list
```

Expected groups:
- `purchase-creation-workers`
- `trainer-allocation-workers`
- `session-scheduling-workers`
- `cache-invalidation-workers`

---

## Event Flow Verification

### 1. Payment Confirmed
```bash
docker logs kodingcaravan-payment-service | grep "PURCHASE_CONFIRMED event emitted"
```

### 2. Purchase Created
```bash
docker logs kodingcaravan-purchase-worker | grep "PURCHASE_CREATED event emitted"
```

### 3. Allocation Triggered
```bash
docker logs kodingcaravan-allocation-worker | grep "Allocation verified in database"
```

### 4. Sessions Created
```bash
docker logs kodingcaravan-session-worker | grep "Sessions created successfully"
```

---

## Quick Reference

### Scripts

1. **Diagnose**: `node diagnose-purchase-allocation.js [studentId] [courseId]`
   - Shows complete status of purchase → allocation → sessions

2. **Manual Trigger**: `node manual-trigger-allocation.js [studentId] [courseId]`
   - Manually triggers allocation for existing purchase

### Database Queries

```sql
-- Find recent purchases
SELECT scp.id, scp.student_id, scp.course_id, scp.purchase_tier, scp.created_at
FROM student_course_purchases scp
WHERE scp.is_active = true
ORDER BY scp.created_at DESC
LIMIT 10;

-- Check if allocation exists
SELECT ta.id, ta.trainer_id, ta.status, ta.created_at
FROM trainer_allocations ta
WHERE ta.student_id = '<studentId>'
  AND ta.course_id = '<courseId>';

-- Count sessions
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
       COUNT(*) FILTER (WHERE status = 'completed') as completed
FROM tutoring_sessions
WHERE student_id = '<studentId>' AND course_id = '<courseId>';
```

---

## Still Having Issues?

1. **Run diagnostic script** to identify the exact failure point
2. **Check worker logs** for error messages
3. **Verify Kafka is running** and topics exist
4. **Use manual trigger** as a temporary workaround
5. **Check admin-service** is accessible and responding

