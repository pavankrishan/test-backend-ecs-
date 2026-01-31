# Purchase Worker Status & Fix Summary

## Diagnosis Results

### ✅ What's Working
1. **purchase-worker container**: Running (Up 3 hours, restarted just now)
2. **Kafka**: Running and healthy
3. **Consumer connection**: Connected to Kafka
4. **Consumer group**: `purchase-creation-workers` is active
5. **Topics**: `purchase-confirmed` topic exists with messages

### ❌ What's NOT Working
1. **Message consumption**: Consumer is NOT processing messages
2. **Offset commits**: No offsets committed (CURRENT-OFFSET: "-")
3. **Event processing**: No "Received PURCHASE_CONFIRMED" logs since restart

## Root Cause

**The consumer is connected but stuck - not consuming messages from Kafka.**

### Evidence:
- Consumer group shows: `CURRENT-OFFSET: "-"` (no messages processed)
- Kafka shows: `LOG-END-OFFSET: 1` (messages exist in partitions 0 and 2)
- Worker logs: No "Received" or "Processing" messages since restart
- Consumer is in "Stable" state but not consuming

### Why This Happens:
1. **Consumer group offset issue**: Offset is stuck or not initialized
2. **`fromBeginning: false`**: Only reads new messages, but even new ones aren't being read
3. **Silent failure**: Consumer connected but not actually consuming

## Previous Error (Fixed)

At `2026-01-07T16:55:09`:
```
error: column "start_date" of relation "student_course_purchases" does not exist
```

This error was from an old version of the code. The current code doesn't use `start_date`, so this is fixed.

## Actions Taken

1. ✅ Restarted purchase-worker container
2. ⚠️ Tried to reset consumer group offset (failed - group is active)
3. ✅ Documented the issue

## Next Steps to Fix

### Option 1: Stop Worker, Reset Offset, Restart (Recommended)

```bash
# 1. Stop the worker
docker-compose stop purchase-worker

# 2. Wait a few seconds for consumer group to become inactive
sleep 5

# 3. Reset offset to latest (skip old messages)
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group purchase-creation-workers \
  --reset-offsets \
  --to-latest \
  --topic purchase-confirmed \
  --execute

# 4. Restart worker
docker-compose start purchase-worker

# 5. Monitor logs
docker logs kodingcaravan-purchase-worker --tail 20 -f
```

### Option 2: Change to `fromBeginning: true` (Temporary)

Edit `kc-backend/services/purchase-worker/src/index.ts`:
```typescript
// Line 323: Change from false to true
fromBeginning: true,
```

Then rebuild and restart:
```bash
docker-compose up -d --build purchase-worker
```

### Option 3: Delete Consumer Group

```bash
# 1. Stop worker
docker-compose stop purchase-worker

# 2. Wait for group to become inactive
sleep 10

# 3. Delete consumer group
docker exec kodingcaravan-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group purchase-creation-workers \
  --delete

# 4. Restart worker (will create new group)
docker-compose start purchase-worker
```

## Verification

After fixing, verify:

1. **Check consumer offset**:
   ```bash
   docker exec kodingcaravan-kafka kafka-consumer-groups \
     --bootstrap-server localhost:9092 \
     --group purchase-creation-workers \
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
   ```

3. **Test with new purchase**:
   - Make a test purchase from frontend
   - Should see purchase created automatically
   - Check `student_course_purchases` table

## Why Purchases Weren't Created

1. ✅ Payment succeeded
2. ✅ Payment service emitted `PURCHASE_CONFIRMED` to Kafka
3. ❌ **purchase-worker received event but didn't process it** (consumer stuck)
4. ❌ Purchase never created
5. ✅ Manual fix script worked (proves database and logic work)

## Summary

**Status**: ❌ NOT WORKING - Consumer connected but not consuming

**Root Cause**: Consumer group offset stuck, consumer not processing messages

**Fix Required**: Reset consumer group offset or delete and recreate group

**Impact**: All purchases from frontend will fail to create purchase records automatically until this is fixed

