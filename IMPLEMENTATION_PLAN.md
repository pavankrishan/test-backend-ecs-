# Enterprise Architecture Implementation Plan

## Current State Analysis

### Existing Infrastructure
- ✅ Kafka available (docker-compose)
- ✅ Redis available (Upstash)
- ✅ Event bus exists (Redis Pub/Sub)
- ✅ Retry queue exists (in-memory)
- ❌ No Kafka integration
- ❌ No idempotency guarantees
- ❌ Synchronous service calls

### Critical Paths to Refactor
1. `confirmPayment()` - Currently waits for purchase + allocation
2. `createCoursePurchase()` - Synchronous HTTP call
3. `autoAssignTrainerAfterPurchase()` - Synchronous HTTP call
4. `createInitialSession()` - Creates all 30 sessions immediately

---

## Implementation Phases

### Phase 1: Event Infrastructure (Kafka)
**Files to Create:**
- `shared/events/kafkaEventBus.ts` - Kafka producer/consumer
- `shared/events/eventEmitter.ts` - Idempotent event emitter
- `shared/events/eventConsumer.ts` - Event consumer framework

**Files to Modify:**
- `shared/events/eventBus.ts` - Add Kafka support
- `shared/events/types.ts` - Add PURCHASE_CONFIRMED event

### Phase 2: Payment Service Refactor
**Files to Modify:**
- `services/payment-service/src/services/payment.service.ts`
  - Remove synchronous `createCoursePurchase()` call
  - Remove synchronous `invalidateStudentCache()` call
  - Remove synchronous `autoAssignTrainerAfterPurchase()` call
  - Add event emission: `PURCHASE_CONFIRMED`

### Phase 3: Purchase Creation Worker
**Files to Create:**
- `services/purchase-worker/src/index.ts` - Worker service
- `services/purchase-worker/src/handlers/purchaseHandler.ts` - Event handler
- `services/purchase-worker/Dockerfile` - Container

**Database:**
- Add UNIQUE constraint: `(student_id, course_id)` WHERE `is_active = true`

### Phase 4: Trainer Allocation Worker
**Files to Create:**
- `services/allocation-worker/src/index.ts` - Worker service
- `services/allocation-worker/src/handlers/allocationHandler.ts` - Event handler
- `services/allocation-worker/Dockerfile` - Container

**Database:**
- Add UNIQUE constraint: `(student_id, course_id)` WHERE `status IN ('approved', 'active')`

### Phase 5: Session Scheduling Worker
**Files to Create:**
- `services/session-worker/src/index.ts` - Worker service
- `services/session-worker/src/handlers/sessionHandler.ts` - Rolling window logic
- `services/session-worker/src/cron/sessionTopUp.ts` - Cron job
- `services/session-worker/Dockerfile` - Container

**Database:**
- Add UNIQUE constraint: `(allocation_id, scheduled_date, scheduled_time)`

### Phase 6: Cache Invalidation Worker
**Files to Create:**
- `services/cache-worker/src/index.ts` - Worker service
- `services/cache-worker/src/handlers/cacheHandler.ts` - Cache invalidation
- `services/cache-worker/Dockerfile` - Container

### Phase 7: Database Migrations
**Files to Create:**
- `migrations/add_idempotency_constraints.sql`
- `migrations/create_processed_events_table.sql`

---

## Event Flow Design

### Event: PURCHASE_CONFIRMED
```typescript
{
  eventId: UUID,
  correlationId: paymentId,
  eventType: 'PURCHASE_CONFIRMED',
  timestamp: ISO8601,
  payload: {
    paymentId: UUID,
    studentId: UUID,
    courseId: UUID,
    amountCents: number,
    metadata: {...}
  }
}
```

### Event: PURCHASE_CREATED
```typescript
{
  eventId: UUID,
  correlationId: paymentId,
  eventType: 'PURCHASE_CREATED',
  timestamp: ISO8601,
  payload: {
    purchaseId: UUID,
    studentId: UUID,
    courseId: UUID,
    purchaseTier: number,
    metadata: {...}
  }
}
```

### Event: TRAINER_ALLOCATED
```typescript
{
  eventId: UUID,
  correlationId: paymentId,
  eventType: 'TRAINER_ALLOCATED',
  timestamp: ISO8601,
  payload: {
    allocationId: UUID,
    trainerId: UUID,
    studentId: UUID,
    courseId: UUID,
    sessionCount: number,
    startDate: string
  }
}
```

---

## Idempotency Strategy

### Payment Confirmation
- UNIQUE constraint: `provider_payment_id`
- Check: `SELECT 1 FROM payments WHERE id = ? AND status = 'succeeded'`

### Purchase Creation
- UNIQUE constraint: `(student_id, course_id)` WHERE `is_active = true`
- Check: `SELECT 1 FROM student_course_purchases WHERE student_id = ? AND course_id = ? AND is_active = true`

### Trainer Allocation
- UNIQUE constraint: `(student_id, course_id)` WHERE `status IN ('approved', 'active')`
- Check: `SELECT 1 FROM trainer_allocations WHERE student_id = ? AND course_id = ? AND status IN ('approved', 'active')`

### Session Creation
- UNIQUE constraint: `(allocation_id, scheduled_date, scheduled_time)`
- Check: `SELECT 1 FROM tutoring_sessions WHERE allocation_id = ? AND scheduled_date = ? AND scheduled_time = ?`

### Event Processing
- Table: `processed_events` with `event_id` PRIMARY KEY
- Check: `SELECT 1 FROM processed_events WHERE event_id = ?`

---

## Rollout Strategy

1. **Week 1**: Implement event infrastructure + database constraints
2. **Week 2**: Refactor payment service (emit events only)
3. **Week 3**: Deploy purchase worker + allocation worker
4. **Week 4**: Deploy session worker + cache worker
5. **Week 5**: Monitor, optimize, fix issues
6. **Week 6**: Full production rollout

---

## Testing Strategy

1. **Unit Tests**: Idempotency checks
2. **Integration Tests**: Event flow end-to-end
3. **Load Tests**: 1000 concurrent payments
4. **Chaos Tests**: Service failures, network partitions
5. **Idempotency Tests**: Duplicate event processing

---

## Monitoring & Observability

1. **Metrics**:
   - Event emission rate
   - Event processing latency
   - Worker queue depth
   - Dead letter queue size
   - Idempotency hit rate

2. **Alerts**:
   - Dead letter queue > 100
   - Event processing latency > 5s
   - Worker crash
   - Database constraint violations

3. **Logging**:
   - Correlation IDs in all logs
   - Event trace (eventId → correlationId)
   - Processing time per event

---

## Risk Mitigation

1. **Event Loss**: Persist events to DB before emitting
2. **Worker Crash**: Auto-restart, idempotency prevents duplicates
3. **Database Deadlock**: Retry with exponential backoff
4. **Event Ordering**: Idempotency makes order irrelevant
5. **Kafka Failure**: Fallback to Redis Pub/Sub

---

## Success Criteria

- ✅ Payment confirmation < 100ms
- ✅ Zero duplicate purchases
- ✅ Zero duplicate allocations
- ✅ Zero duplicate sessions
- ✅ 99.9% event processing success rate
- ✅ Horizontal scalability (add workers as needed)
- ✅ Full observability (correlation IDs, metrics, alerts)

