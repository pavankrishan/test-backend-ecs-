# Trainer Allocation Not Triggered - Fix Guide

## Problem
After course purchase, the course appears in the learnings screen but trainer allocation shows "Trainer allocation pending" and is not triggered automatically.

## Expected Flow

1. **Payment Confirmed** → `PURCHASE_CONFIRMED` event emitted
2. **Purchase Worker** → Consumes `PURCHASE_CONFIRMED` → Creates purchase → Emits `PURCHASE_CREATED` event
3. **Allocation Worker** → Consumes `PURCHASE_CREATED` → Allocates trainer → Emits `TRAINER_ALLOCATED` event
4. **Session Worker** → Consumes `TRAINER_ALLOCATED` → Creates sessions

## Current Status

✅ **Purchase Worker**: Running and creating purchases
✅ **Allocation Worker**: Running and listening to `purchase-created` topic
❓ **Issue**: `PURCHASE_CREATED` events may not be reaching allocation worker

## Verification Steps

### 1. Check if PURCHASE_CREATED events are being emitted:

```bash
docker logs kodingcaravan-purchase-worker --tail 100 | grep "PURCHASE_CREATED"
```

Look for:
- `[PurchaseWorker] PURCHASE_CREATED event emitted`
- `purchaseId: <id>`

### 2. Check if allocation worker is receiving events:

```bash
docker logs kodingcaravan-allocation-worker --tail 100 | grep "PURCHASE_CREATED\|Received\|Processing"
```

Look for:
- `[AllocationWorker] 📨 Received PURCHASE_CREATED event`
- `[AllocationWorker] Processing PURCHASE_CREATED event`

### 3. Check Kafka topics:

```bash
docker exec kodingcaravan-kafka kafka-topics.sh --bootstrap-server localhost:9092 --list
```

Should see:
- `purchase-confirmed`
- `purchase-created` ⭐ (for allocation worker)
- `trainer-allocated`

### 4. Check if purchase was created:

```sql
SELECT id, student_id, course_id, purchase_tier, created_at 
FROM student_course_purchases 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = '9e16d892-4324-4568-be60-163aa1665683'
  AND is_active = true;
```

### 5. Check if allocation exists:

```sql
SELECT id, student_id, course_id, trainer_id, status, created_at
FROM trainer_allocations 
WHERE student_id = '809556c1-e184-4b85-8fd6-a5f1c8014bf6'
  AND course_id = '9e16d892-4324-4568-be60-163aa1665683';
```

## Possible Issues

### Issue 1: PURCHASE_CREATED event not emitted
**Symptom**: Purchase created but no `PURCHASE_CREATED` event in logs
**Fix**: Check purchase worker logs for errors

### Issue 2: Allocation worker not receiving events
**Symptom**: Events emitted but allocation worker doesn't see them
**Fix**: 
- Check Kafka connectivity
- Verify topic exists: `purchase-created`
- Check consumer group: `trainer-allocation-workers`

### Issue 3: Allocation worker failing silently
**Symptom**: Events received but allocation not created
**Fix**: Check allocation worker logs for errors

### Issue 4: Admin service allocation API failing
**Symptom**: Allocation worker calls API but gets error
**Fix**: Check admin-service logs

## Manual Fix (If Needed)

If automatic allocation is not working, manually trigger allocation:

```bash
# Via API
curl -X POST http://localhost:3010/api/v1/admin/allocations/auto-assign \
  -H "Content-Type: application/json" \
  -d '{
    "studentId": "809556c1-e184-4b85-8fd6-a5f1c8014bf6",
    "courseId": "9e16d892-4324-4568-be60-163aa1665683",
    "timeSlot": "3:00 PM",
    "date": "2026-01-08",
    "paymentMetadata": {}
  }'
```

## Next Steps

1. Check purchase worker logs for `PURCHASE_CREATED` emission
2. Check allocation worker logs for event reception
3. Verify Kafka topics exist
4. Check for errors in allocation worker
5. If needed, manually trigger allocation

