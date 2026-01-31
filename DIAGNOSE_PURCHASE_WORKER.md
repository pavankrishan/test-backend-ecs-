# Purchase Worker Diagnosis

## Status: ❌ NOT WORKING

### Current State

1. **Worker is Running**: ✅
   - Container: `kodingcaravan-purchase-worker`
   - Status: Up 3 hours
   - Started: 2026-01-07 17:26:08

2. **Kafka is Running**: ✅
   - Container: `kodingcaravan-kafka`
   - Status: Up 4 hours (healthy)
   - Port: 9092

3. **Consumer Connected**: ✅
   - Consumer group: `purchase-creation-workers`
   - Topics: `purchase-confirmed`
   - Partitions assigned: [0, 1, 2]

4. **Messages in Kafka**: ✅
   - Partition 0: 1 message (LOG-END-OFFSET: 1)
   - Partition 2: 1 message (LOG-END-OFFSET: 1)
   - **CURRENT-OFFSET: "-" (NO OFFSET COMMITTED)**

5. **Worker Processing Messages**: ❌
   - **NO messages processed since restart**
   - **NO "Received PURCHASE_CONFIRMED" logs**
   - **NO "Processing" logs**

## Root Cause

**The consumer is connected but NOT consuming messages.**

### Why?

1. **`fromBeginning: false`** (line 323 in `purchase-worker/src/index.ts`)
   - Consumer only reads NEW messages after it starts
   - Messages sent BEFORE worker started are ignored
   - But even NEW messages (after 17:26:08) aren't being processed

2. **Consumer Offset Issue**
   - CURRENT-OFFSET is "-" (no offset committed)
   - This means consumer hasn't processed ANY messages
   - Messages are stuck in Kafka

3. **Possible Causes**:
   - Consumer is connected but not actually consuming
   - Consumer group offset is stuck
   - Consumer is waiting for something
   - Consumer crashed silently and restarted but didn't resume

## Previous Error (Before Restart)

At `2026-01-07T16:55:09.359Z`:
```
error: column "start_date" of relation "student_course_purchases" does not exist
```

This error caused the consumer to crash. The worker was restarted at 17:26:08, but:
- The error is fixed (code doesn't use `start_date` anymore)
- But the consumer is still not processing messages

## Solution

### Option 1: Reset Consumer Group Offset (Recommended)

Reset the consumer group to start from the beginning or latest:

```bash
# Reset to latest (skip old messages)
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group purchase-creation-workers \
  --reset-offsets \
  --to-latest \
  --topic purchase-confirmed \
  --execute

# Or reset to beginning (reprocess all messages)
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group purchase-creation-workers \
  --reset-offsets \
  --to-earliest \
  --topic purchase-confirmed \
  --execute
```

### Option 2: Restart Worker

```bash
docker-compose restart purchase-worker
```

### Option 3: Change `fromBeginning: true`

Temporarily change the worker to read from beginning:

```typescript
// In purchase-worker/src/index.ts line 323
fromBeginning: true,  // Change from false to true
```

Then restart the worker.

### Option 4: Delete Consumer Group

Delete the consumer group and let it recreate:

```bash
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group purchase-creation-workers \
  --delete
```

Then restart the worker.

## Verification

After fixing, check:

1. **Consumer offset**:
   ```bash
   docker exec kodingcaravan-kafka kafka-consumer-groups \
     --bootstrap-server localhost:9092 \
     --group purchase-creation-workers \
     --describe
   ```
   Should show CURRENT-OFFSET > 0

2. **Worker logs**:
   ```bash
   docker logs kodingcaravan-purchase-worker --tail 20 -f
   ```
   Should see:
   ```
   [PurchaseWorker] 📨 Received PURCHASE_CONFIRMED event from Kafka
   [PurchaseWorker] Processing PURCHASE_CONFIRMED event
   [PurchaseWorker] Purchase created successfully
   ```

3. **Test with new purchase**:
   - Make a test purchase from frontend
   - Should see purchase created automatically
   - Check logs for processing

## Summary

**Problem**: Consumer is connected but not consuming messages

**Evidence**:
- ✅ Worker running
- ✅ Kafka running
- ✅ Consumer connected
- ✅ Messages in Kafka
- ❌ No messages processed
- ❌ No offset committed

**Fix**: Reset consumer group offset or restart worker

