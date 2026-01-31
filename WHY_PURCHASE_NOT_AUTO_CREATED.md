# Why Purchase Wasn't Automatically Created in Database

## Problem Statement

When you purchased a course from the frontend app:
- ✅ Payment succeeded
- ✅ Payment record created in database
- ❌ **Purchase record was NOT automatically created**
- ❌ Had to manually run fix script to create purchase

## Root Cause Analysis

### Investigation Results

**Payment 1**: `5dc56599-cd44-4672-ab73-2bf7f789ef34` (Artificial Intelligence)
- ✅ Payment succeeded: `2026-01-07T20:22:22.352Z`
- ✅ **PURCHASE_CONFIRMED event emitted** by `payment-service`: `2026-01-07T20:22:24.753Z`
- ❌ **purchase-worker did NOT process it**
- ✅ Purchase created manually by fix-script: `2026-01-07T20:35:21.031Z`

**Evidence**:
- Event was recorded in `processed_events` table with source = `payment-service`
- **No PURCHASE_CREATED event from `purchase-worker` source**
- Purchase was only created 13 minutes later by manual fix script

## Root Cause: purchase-worker Not Running

**The purchase-worker service is NOT running or NOT consuming from Kafka.**

### Why This Happens

The normal flow should be:
```
1. Frontend Purchase → Payment Service
2. Payment Service → Emits PURCHASE_CONFIRMED to Kafka ✅ (This worked)
3. purchase-worker → Consumes from Kafka ❌ (This failed)
4. purchase-worker → Creates purchase record ❌ (Never happened)
5. purchase-worker → Emits PURCHASE_CREATED ❌ (Never happened)
```

What actually happened:
```
1. Frontend Purchase → Payment Service ✅
2. Payment Service → Emits PURCHASE_CONFIRMED to Kafka ✅
3. purchase-worker → NOT RUNNING or NOT CONSUMING ❌
4. Event sits in Kafka, never processed ❌
5. Purchase never created ❌
```

## How to Fix

### Step 1: Check if purchase-worker is Running

```bash
# Check Docker containers
docker ps | grep purchase-worker

# Or check docker-compose
docker-compose ps purchase-worker
```

**Expected**: Should see `kodingcaravan-purchase-worker` container running

**If not running**: Start it:
```bash
docker-compose up -d purchase-worker
```

### Step 2: Check purchase-worker Logs

```bash
# View recent logs
docker logs kodingcaravan-purchase-worker --tail 50

# Or follow logs
docker logs -f kodingcaravan-purchase-worker
```

**Look for**:
- `[PurchaseWorker] Initialized` - Worker started
- `[PurchaseWorker] Processing PURCHASE_CONFIRMED event` - Processing events
- `[PurchaseWorker] Purchase created successfully` - Purchase created
- Any Kafka connection errors

### Step 3: Check Kafka is Running

```bash
# Check Kafka container
docker ps | grep kafka

# Check Kafka topics
docker exec kodingcaravan-kafka kafka-topics --list --bootstrap-server localhost:9092
```

**Should see**: `purchase-confirmed` topic exists

### Step 4: Check Kafka Consumer Groups

```bash
# Check consumer groups
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --list

# Check consumer lag (should be 0 if processing)
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group purchase-creation-workers \
  --describe
```

**If lag > 0**: Events are piling up, worker not processing

### Step 5: Restart purchase-worker

```bash
# Restart the worker
docker-compose restart purchase-worker

# Or if using docker directly
docker restart kodingcaravan-purchase-worker
```

### Step 6: Verify It's Working

After restart, make a test purchase and check logs:
```bash
docker logs kodingcaravan-purchase-worker --tail 20 -f
```

**Should see**:
```
[PurchaseWorker] Processing PURCHASE_CONFIRMED event
[PurchaseWorker] Purchase created successfully
[PurchaseWorker] PURCHASE_CREATED event emitted
```

## Why purchase-worker Might Not Be Running

1. **Not Started**
   - Worker service not included in docker-compose up
   - Service failed to start

2. **Kafka Connection Failed**
   - Kafka broker not accessible
   - Network configuration issue
   - Kafka credentials wrong

3. **Consumer Group Issue**
   - Consumer group already exists with different configuration
   - Offset reset needed

4. **Environment Variables Missing**
   - `KAFKA_BROKER` not set
   - `POSTGRES_URL` not set
   - Other required env vars missing

## Prevention

1. **Health Checks**
   - Add health check endpoint to workers
   - Monitor worker status

2. **Auto-restart**
   - Configure docker-compose with `restart: unless-stopped`
   - Set up process manager (PM2, supervisor)

3. **Monitoring**
   - Monitor Kafka consumer lag
   - Alert if lag increases
   - Monitor worker logs for errors

4. **Fallback Mechanism**
   - Keep manual fix script available
   - Set up retry queue for failed events
   - Dead letter queue processing

## Quick Fix Commands

```bash
# 1. Check status
docker-compose ps purchase-worker

# 2. View logs
docker-compose logs purchase-worker

# 3. Restart worker
docker-compose restart purchase-worker

# 4. Check all workers
docker-compose ps | grep worker

# 5. Restart all workers
docker-compose restart purchase-worker allocation-worker session-worker cache-worker
```

## Summary

**Root Cause**: purchase-worker is not running or not consuming from Kafka

**Evidence**:
- ✅ Payment service emitted PURCHASE_CONFIRMED events
- ❌ purchase-worker did not process them
- ✅ Manual fix script worked (proves database and logic work)

**Action Required**:
1. Check if purchase-worker is running
2. Check Kafka connectivity
3. Restart purchase-worker
4. Monitor logs to ensure future purchases work automatically

**For Future Purchases**:
- Once purchase-worker is running, purchases will be created automatically
- No manual fix needed
- Full flow: Payment → Purchase → Allocation → Sessions → Cache Invalidation → Frontend Update

