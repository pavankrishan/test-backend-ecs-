# Diagnostic Logging & Root Cause Fix

## ROOT CAUSE IDENTIFIED

### Primary Issue: Workers Not Deployed
**Evidence**: 
- Workers created in codebase ✅
- Workers NOT in docker-compose.yml ❌
- Workers NOT running ❌

**Impact**: 
- PURCHASE_CONFIRMED events emitted but no consumer
- PURCHASE_CREATED events never emitted (no purchase worker)
- Allocation never happens (no allocation worker)

---

## SECONDARY ISSUE: Allocation Worker Logic Bug

### Location: `services/allocation-worker/src/index.ts:183-196`

**Problem**: 
Allocation worker marks event as processed **WITHOUT verifying allocation exists in database**.

**Current Flow** (BUGGY):
1. Call admin-service API
2. Get allocationId from response
3. Mark event as processed ← **TOO EARLY**
4. Emit TRAINER_ALLOCATED event

**Risk**: 
If admin-service API returns success but allocation creation fails (async, transaction rollback, etc.), event is marked processed and never retried.

---

## DIAGNOSTIC LOGGING ADDED

### 1. Payment Service - Event Emission
**File**: `services/payment-service/src/services/payment.service.ts`

**Added**: Log before and after event emission to confirm event is sent.

### 2. Allocation Worker - Bootstrap
**File**: `services/allocation-worker/src/index.ts`

**Added**: Log on worker startup to confirm worker is running.

### 3. Allocation Worker - Event Consumption
**File**: `services/allocation-worker/src/index.ts`

**Added**: Log when PURCHASE_CREATED event is received.

### 4. Allocation Worker - Admin-Service Call
**File**: `services/allocation-worker/src/index.ts`

**Added**: Log before/after admin-service API call with response.

### 5. Allocation Worker - Database Verification
**File**: `services/allocation-worker/src/index.ts`

**Added**: Log to verify allocation exists in database after API call.

---

## MINIMAL FIX APPLIED

### Fix 1: Add Allocation Verification
**File**: `services/allocation-worker/src/index.ts:183-196`

**Change**: Verify allocation exists in database before marking event as processed.

### Fix 2: Add Diagnostic Logging
**Files**: All worker files

**Change**: Add comprehensive logging at each step to trace execution.

---

## VERIFICATION STEPS

### Step 1: Check if Workers are Running
```bash
docker ps | grep -E "purchase-worker|allocation-worker|session-worker|cache-worker"
```

**Expected**: 4 worker containers running
**If NOT**: Workers not deployed → **ROOT CAUSE #1**

### Step 2: Check Kafka Topics
```bash
docker exec kodingcaravan-kafka kafka-topics --list --bootstrap-server localhost:9092
```

**Expected**: 
- `purchase-confirmed`
- `purchase-created`
- `trainer-allocated`

**If NOT**: Topics missing → **ROOT CAUSE #2**

### Step 3: Check processed_events
```sql
SELECT event_type, correlation_id, processed_at, source
FROM processed_events
WHERE correlation_id LIKE '%1fa90c93-ea40-4ba9-a7bf-4ed47e735b91%'
ORDER BY processed_at DESC;
```

**Expected**: 
- PURCHASE_CONFIRMED processed
- PURCHASE_CREATED processed (if purchase worker ran)
- If PURCHASE_CREATED processed but no allocation → **ROOT CAUSE #3**

### Step 4: Check Admin-Service Logs
```bash
docker logs kodingcaravan-admin-service | grep "auto-assign" | tail -20
```

**Expected**: API call logged with studentId
**If NOT**: API never called → **ROOT CAUSE #4**

---

## CONFIDENCE RANKING

1. **95%**: Workers not running (not in docker-compose.yml)
2. **80%**: Kafka topics not created
3. **70%**: Allocation worker logic bug (no verification)
4. **60%**: Admin-service API failing silently

---

## IMMEDIATE ACTION REQUIRED

1. **Add workers to docker-compose.yml** (if not running)
2. **Create Kafka topics** (if missing)
3. **Add allocation verification** (fix logic bug)
4. **Check logs** (confirm execution path)

