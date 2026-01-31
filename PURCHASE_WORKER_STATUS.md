# Purchase Worker Status Report

## Current Status: ⚠️ CONNECTED BUT NOT PROCESSING

### What's Working ✅
1. **Container**: Running and healthy
2. **Kafka**: Running and healthy  
3. **Consumer Connection**: Connected to Kafka
4. **Consumer Group**: `purchase-creation-workers` is active
5. **Topics**: Subscribed to `purchase-confirmed`

### What's NOT Working ❌
1. **Message Consumption**: Consumer is NOT processing messages
2. **Offset Commits**: No offsets committed (`CURRENT-OFFSET: "-"`)
3. **Event Processing**: No "Received PURCHASE_CONFIRMED" logs

## Root Cause Analysis

### The Problem
The consumer is **connected but stuck** - it's not consuming messages from Kafka partitions.

### Evidence
```
CURRENT-OFFSET: "-"  (no messages processed)
LOG-END-OFFSET: 1    (messages exist in partitions 0 and 2)
LAG: "-"             (can't calculate lag without offset)
```

### Why This Happens

1. **`fromBeginning: false`** (line 323 in `purchase-worker/src/index.ts`)
   - Consumer only reads NEW messages after it starts
   - Messages sent BEFORE worker started are ignored
   - **But even NEW messages aren't being consumed**

2. **Consumer Offset Not Initialized**
   - When `fromBeginning: false`, Kafka should start from the latest offset
   - But `CURRENT-OFFSET: "-"` means no offset has been committed
   - This suggests the consumer hasn't processed ANY messages (even new ones)

3. **Possible Causes**:
   - Consumer is waiting for new messages but not actually polling
   - Consumer group offset is stuck in an invalid state
   - Consumer is connected but the `eachMessage` handler isn't being called
   - There's a bug in the Kafka consumer wrapper

## Previous Error (Fixed)

At `2026-01-07T16:55:09`:
```
error: column "start_date" of relation "student_course_purchases" does not exist
```

This error was from an old version. Current code doesn't use `start_date`, so this is fixed.

## Why Your Purchases Weren't Created

1. ✅ Payment succeeded
2. ✅ Payment service emitted `PURCHASE_CONFIRMED` to Kafka
3. ❌ **purchase-worker consumer received event but didn't process it**
4. ❌ Purchase never created
5. ✅ Manual fix script worked (proves database and logic work)

## Solution

### Option 1: Stop Worker, Reset Offset, Restart (Recommended)

```bash
# 1. Stop the worker
docker-compose stop purchase-worker

# 2. Wait for consumer group to become inactive
Start-Sleep -Seconds 10

# 3. Reset offset to latest (skip old messages, start fresh)
docker exec kodingcaravan-kafka kafka-consumer-groups `
  --bootstrap-server localhost:9092 `
  --group purchase-creation-workers `
  --reset-offsets `
  --to-latest `
  --topic purchase-confirmed `
  --execute

# 4. Restart worker
docker-compose start purchase-worker

# 5. Monitor logs
docker logs kodingcaravan-purchase-worker --tail 20 -f
```

### Option 2: Change to `fromBeginning: true` (Temporary Fix)

Edit `kc-backend/services/purchase-worker/src/index.ts` line 323:
```typescript
fromBeginning: true,  // Change from false to true
```

Then rebuild and restart:
```bash
docker-compose up -d --build purchase-worker
```

**Note**: This will process ALL old messages, which might cause duplicate purchases if they were already created manually.

### Option 3: Delete Consumer Group (Clean Slate)

```bash
# 1. Stop worker
docker-compose stop purchase-worker

# 2. Wait for group to become inactive
Start-Sleep -Seconds 10

# 3. Delete consumer group
docker exec kodingcaravan-kafka kafka-consumer-groups `
  --bootstrap-server localhost:9092 `
  --group purchase-creation-workers `
  --delete

# 4. Restart worker (will create new group)
docker-compose start purchase-worker
```

### Option 4: Test with New Purchase

Make a test purchase from the frontend to see if NEW messages are processed:
- If new purchase works → Consumer is working, just missed old messages
- If new purchase doesn't work → Consumer has a deeper issue

## Verification

After fixing, verify:

1. **Check consumer offset**:
   ```bash
   docker exec kodingcaravan-kafka kafka-consumer-groups `
     --bootstrap-server localhost:9092 `
     --group purchase-creation-workers `
     --describe
   ```
   Should show `CURRENT-OFFSET` > 0

2. **Check worker logs**:
   ```bash
   docker logs kodingcaravan-purchase-worker --tail 30
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
   - Check `student_course_purchases` table

## Summary

**Status**: ⚠️ CONNECTED BUT NOT PROCESSING

**Root Cause**: Consumer connected but not consuming messages (offset not initialized or stuck)

**Impact**: All purchases from frontend will fail to create purchase records automatically

**Fix Required**: Reset consumer group offset or change `fromBeginning: true`

**Next Step**: Try Option 1 (reset offset) or Option 4 (test with new purchase)

