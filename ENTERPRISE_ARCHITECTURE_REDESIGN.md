# Enterprise Architecture Redesign
## Production-Grade System for 600,000+ Concurrent Users

---

## STEP 1: IDENTIFY COUPLING (CRITICAL ISSUES)

### 1.1 Payment → Purchase Creation (SYNCHRONOUS HTTP CALL)
**Location**: `confirmPayment()` → `createCoursePurchase()`
- **Coupling**: Payment service makes HTTP call to course-service
- **Why Dangerous**:
  - Payment confirmation blocks on external service
  - If course-service is slow/down, payment confirmation fails
  - At 600K users: 1% failure = 6,000 failed payments/hour
  - No retry safety: duplicate calls create duplicate purchases
  - Payment API timeout = user sees payment failure even though money deducted

### 1.2 Payment → Cache Invalidation (SYNCHRONOUS HTTP CALL)
**Location**: `confirmPayment()` → `invalidateStudentCache()`
- **Coupling**: Payment service calls student-service synchronously
- **Why Dangerous**:
  - Payment confirmation waits for cache invalidation
  - Cache invalidation is NOT critical path
  - At scale: Adds 50-200ms latency to payment confirmation
  - If student-service down, payment confirmation fails unnecessarily

### 1.3 Payment → Trainer Allocation (SYNCHRONOUS HTTP CALL)
**Location**: `confirmPayment()` → `autoAssignTrainerAfterPurchase()`
- **Coupling**: Payment service calls admin-service synchronously
- **Why Dangerous**:
  - Payment confirmation blocks on trainer allocation (can take 2-5 seconds)
  - Trainer allocation is complex: queries, matching, session creation
  - At 600K users: Payment API response time = 5+ seconds (unacceptable)
  - If admin-service slow, ALL payments are slow
  - User sees "Payment processing..." for 5+ seconds

### 1.4 Trainer Allocation → Session Creation (SYNCHRONOUS)
**Location**: `autoAssignTrainerAfterPurchase()` → `allocateTrainer()` → `createInitialSession()`
- **Coupling**: Allocation creates all 30 sessions immediately
- **Why Dangerous**:
  - Creates 30 DB rows synchronously (can take 1-3 seconds)
  - If session creation fails, allocation partially succeeds
  - At 600K users: 10,000 purchases/hour = 300,000 session rows/hour
  - Database write load spikes during peak hours
  - No rollback: if allocation fails, sessions remain orphaned

### 1.5 Purchase Creation → No Idempotency Key
**Location**: `createCoursePurchase()` → HTTP POST without idempotency
- **Coupling**: Retry creates duplicate purchases
- **Why Dangerous**:
  - Network timeout → retry → duplicate purchase record
  - Payment succeeds but purchase created twice
  - Student sees duplicate courses
  - No unique constraint on (student_id, course_id, is_active)

### 1.6 Trainer Allocation → No Idempotency Key
**Location**: `autoAssignTrainerAfterPurchase()` → HTTP POST without idempotency
- **Coupling**: Retry creates duplicate allocations
- **Why Dangerous**:
  - Network timeout → retry → duplicate allocation
  - Same student gets allocated twice
  - Duplicate sessions created
  - No unique constraint on (student_id, course_id, status='approved')

### 1.7 Session Creation → No Idempotency
**Location**: `createInitialSession()` → Creates sessions without deduplication
- **Coupling**: Retry creates duplicate sessions
- **Why Dangerous**:
  - Allocation retry → duplicate session creation
  - Same session scheduled twice
  - Trainer sees duplicate sessions
  - No unique constraint on (allocation_id, scheduled_date, scheduled_time)

### 1.8 Read Model → Synchronous Cache Invalidation
**Location**: Aggregation service queries DB directly, cache invalidated synchronously
- **Coupling**: Cache invalidation is synchronous HTTP call
- **Why Dangerous**:
  - Payment confirmation waits for cache invalidation
  - Cache invalidation should be fire-and-forget
  - At scale: Cache invalidation failures block payment confirmation

---

## STEP 2: CORRECT ENTERPRISE FLOW

### 2.1 Payment Verification (FAST, IDEMPOTENT)
```
POST /api/v1/payments/:paymentId/verify
  ↓
1. Verify payment signature (idempotent check)
2. Update payment status to 'succeeded' (idempotent: check status first)
3. Insert payment record with UNIQUE constraint on (provider_payment_id)
4. Emit PURCHASE_CONFIRMED event (idempotent: check if event already emitted)
5. Return 200 OK immediately (< 100ms)
```

**Idempotency**:
- Payment ID is unique key
- Check `status = 'succeeded'` before update
- UNIQUE constraint: `provider_payment_id` (Razorpay payment ID)

**No Side Effects**:
- NO purchase creation
- NO cache invalidation
- NO trainer allocation
- NO session creation

### 2.2 Event Emission (FIRE-AND-FORGET)
```
PURCHASE_CONFIRMED event:
{
  eventId: UUID (idempotency key),
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

**Event Bus**: Kafka (already in infrastructure)
- **Why Kafka**: 
  - Already deployed in docker-compose
  - At-least-once delivery
  - Consumer groups for horizontal scaling
  - Persistence for replay
  - High throughput (millions of events/second)
  - Partitioning for parallel processing

**Idempotency**:
- Event ID = UUID (unique)
- Consumer checks: `SELECT 1 FROM processed_events WHERE event_id = ?`
- If exists, skip processing

### 2.3 Asynchronous Purchase Creation Worker
```
Consumer: purchase-creation-worker
  ↓
1. Receive PURCHASE_CONFIRMED event
2. Check idempotency: SELECT purchase WHERE student_id=? AND course_id=? AND is_active=true
3. If exists: Skip (idempotent)
4. If not: Create purchase with UNIQUE constraint (student_id, course_id, is_active=true)
5. Emit PURCHASE_CREATED event
6. Acknowledge event
```

**Idempotency**:
- UNIQUE constraint: `(student_id, course_id)` WHERE `is_active = true`
- Check before insert
- If duplicate: Return existing purchase (idempotent)

**Retry Safety**:
- Worker retries on failure
- Idempotency check prevents duplicates
- Max retries: 3
- Dead letter queue after 3 failures

### 2.4 Asynchronous Trainer Allocation Worker
```
Consumer: trainer-allocation-worker
  ↓
1. Receive PURCHASE_CREATED event
2. Check idempotency: SELECT allocation WHERE student_id=? AND course_id=? AND status IN ('approved','active')
3. If exists: Skip (idempotent)
4. If not: 
   a) Find available trainer
   b) Create allocation with UNIQUE constraint (student_id, course_id, status='approved')
   c) Emit TRAINER_ALLOCATED event
5. Acknowledge event
```

**Idempotency**:
- UNIQUE constraint: `(student_id, course_id)` WHERE `status IN ('approved', 'active')`
- Check before insert
- If duplicate: Return existing allocation (idempotent)

**Retry Safety**:
- Worker retries on failure
- Idempotency check prevents duplicates
- Max retries: 5 (allocation is complex)
- Dead letter queue after 5 failures

### 2.5 Session Scheduling Strategy

**CHOSEN STRATEGY: Rolling Window Sessions**

**Why NOT Eager Creation**:
- Creates 30 sessions immediately = 300K sessions/hour at scale
- Database write load spikes
- Most sessions unused for weeks
- Wastes storage

**Why NOT On-Demand Creation**:
- First session join requires allocation check
- Adds latency to user experience
- Complex state management

**Why Rolling Window**:
- Create next 7 sessions (1 week window)
- When 3 sessions remain, create next 7
- Always have 7 sessions ready
- Database load distributed
- Storage efficient

**Implementation**:
```
Consumer: session-scheduling-worker
  ↓
1. Receive TRAINER_ALLOCATED event
2. Check: SELECT COUNT(*) FROM sessions WHERE allocation_id=? AND status='scheduled'
3. If count < 7: Create next 7 sessions
4. Schedule cron: Every 6 hours, check all allocations
5. For each allocation with < 7 sessions: Create next 7
```

**Idempotency**:
- UNIQUE constraint: `(allocation_id, scheduled_date, scheduled_time)`
- Check before insert
- If duplicate: Skip (idempotent)

### 2.6 Read Models & Cache Invalidation

**Event-Driven Cache Invalidation**:
```
Consumer: cache-invalidation-worker
  ↓
1. Receive PURCHASE_CREATED event
2. Invalidate Redis cache: DEL student:home:{studentId}
3. Invalidate Redis cache: DEL student:learning:{studentId}
4. Acknowledge event
```

**Why Event-Driven**:
- Fire-and-forget
- Payment confirmation doesn't wait
- Retryable
- Observable

**Read Model**:
- Aggregation service queries `student_course_purchases` table
- Cache with 5-minute TTL
- Cache invalidation updates immediately
- No synchronous HTTP calls

---

## STEP 3: IDEMPOTENCY (NON-NEGOTIABLE)

### 3.1 Payment Confirmation
```sql
-- UNIQUE constraint
ALTER TABLE payments ADD CONSTRAINT unique_provider_payment_id 
  UNIQUE (provider_payment_id) WHERE provider_payment_id IS NOT NULL;

-- Idempotency check
IF EXISTS (SELECT 1 FROM payments WHERE id = paymentId AND status = 'succeeded') THEN
  RETURN existing_payment; -- Idempotent
END IF;
```

### 3.2 Purchase Creation
```sql
-- UNIQUE constraint
ALTER TABLE student_course_purchases ADD CONSTRAINT unique_active_purchase 
  UNIQUE (student_id, course_id) WHERE is_active = true;

-- Idempotency check
IF EXISTS (
  SELECT 1 FROM student_course_purchases 
  WHERE student_id = ? AND course_id = ? AND is_active = true
) THEN
  RETURN existing_purchase; -- Idempotent
END IF;
```

### 3.3 Trainer Allocation
```sql
-- UNIQUE constraint
ALTER TABLE trainer_allocations ADD CONSTRAINT unique_active_allocation 
  UNIQUE (student_id, course_id) WHERE status IN ('approved', 'active');

-- Idempotency check
IF EXISTS (
  SELECT 1 FROM trainer_allocations 
  WHERE student_id = ? AND course_id = ? AND status IN ('approved', 'active')
) THEN
  RETURN existing_allocation; -- Idempotent
END IF;
```

### 3.4 Session Creation
```sql
-- UNIQUE constraint
ALTER TABLE tutoring_sessions ADD CONSTRAINT unique_session_slot 
  UNIQUE (allocation_id, scheduled_date, scheduled_time);

-- Idempotency check
IF EXISTS (
  SELECT 1 FROM tutoring_sessions 
  WHERE allocation_id = ? AND scheduled_date = ? AND scheduled_time = ?
) THEN
  RETURN existing_session; -- Idempotent
END IF;
```

### 3.5 Event Processing
```sql
-- Processed events table
CREATE TABLE processed_events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  correlation_id UUID NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB
);

CREATE INDEX idx_processed_events_correlation ON processed_events(correlation_id);

-- Idempotency check
IF EXISTS (SELECT 1 FROM processed_events WHERE event_id = ?) THEN
  SKIP processing; -- Idempotent
END IF;
```

---

## STEP 4: FAILURE & RETRY SAFETY

### 4.1 Payment Confirmation Failure
**Scenario**: Payment verification fails
- **Action**: Return error to user
- **Retry**: User retries payment verification
- **Idempotency**: Payment ID check prevents duplicate processing
- **Recovery**: Manual review if payment succeeds but verification fails

### 4.2 Purchase Creation Failure
**Scenario**: Worker fails to create purchase
- **Action**: Retry 3 times with exponential backoff
- **Idempotency**: UNIQUE constraint prevents duplicates
- **Dead Letter**: After 3 failures, send to DLQ for manual review
- **Recovery**: Admin manually creates purchase

### 4.3 Trainer Allocation Failure
**Scenario**: Worker fails to allocate trainer
- **Action**: Retry 5 times with exponential backoff
- **Idempotency**: UNIQUE constraint prevents duplicates
- **Dead Letter**: After 5 failures, send to DLQ
- **Recovery**: Admin manually allocates trainer

### 4.4 Session Creation Failure
**Scenario**: Worker fails to create sessions
- **Action**: Retry 3 times with exponential backoff
- **Idempotency**: UNIQUE constraint prevents duplicates
- **Dead Letter**: After 3 failures, send to DLQ
- **Recovery**: Cron job retries failed session creation

### 4.5 Event Processing Failure
**Scenario**: Worker crashes during event processing
- **Action**: Event remains in stream, worker restarts and processes again
- **Idempotency**: `processed_events` table prevents duplicate processing
- **Recovery**: Automatic (event remains in stream)

---

## STEP 5: CODE RESTRUCTURE RULES

### 5.1 Controllers
- **Rule**: Validation + orchestration only
- **NO**: Business logic
- **NO**: Database writes (except payment status update)
- **NO**: Synchronous service calls

### 5.2 Services
- **Rule**: Business logic only
- **NO**: HTTP calls to other services
- **NO**: Event emission (use event bus abstraction)
- **NO**: Cache invalidation (use event-driven)

### 5.3 Events
- **Rule**: Fire-and-forget only
- **NO**: Waiting for event processing
- **NO**: Synchronous event handlers
- **YES**: Idempotency keys

### 5.4 Service Dependencies
- **Rule**: No service may synchronously depend on another service
- **NO**: HTTP calls in critical path
- **YES**: Event-driven communication
- **YES**: Read models for queries

### 5.5 WebSocket Handlers
- **Rule**: No WebSocket handler may write to DB
- **NO**: Direct database writes
- **YES**: Emit events
- **YES**: Read from read models

### 5.6 Payment Requests
- **Rule**: No payment request may wait for allocation
- **NO**: Await trainer allocation
- **NO**: Await session creation
- **YES**: Return immediately after payment confirmation

### 5.7 Empty State
- **Rule**: Empty state is VALID state
- **YES**: Student can have 0 courses (valid)
- **YES**: Allocation can have 0 sessions initially (valid)
- **NO**: Assuming data exists

### 5.8 Side Effects
- **Rule**: NO hidden side effects
- **YES**: Explicit event emission
- **NO**: Implicit side effects in functions
- **YES**: All side effects logged

### 5.9 Retries
- **Rule**: NO silent retries
- **YES**: Explicit retry logic with max attempts
- **YES**: Dead letter queue after max retries
- **NO**: Infinite retries

---

## STEP 6: IMPLEMENTATION PLAN

### Phase 1: Event Infrastructure
1. Create event bus abstraction (Redis Streams)
2. Create event emitter service
3. Create event consumer framework
4. Add `processed_events` table

### Phase 2: Payment Service Refactor
1. Remove synchronous purchase creation
2. Remove synchronous cache invalidation
3. Remove synchronous trainer allocation
4. Add event emission after payment confirmation
5. Add idempotency checks

### Phase 3: Purchase Creation Worker
1. Create purchase-creation-worker service
2. Consume PURCHASE_CONFIRMED events
3. Add idempotency checks
4. Add retry logic
5. Emit PURCHASE_CREATED events

### Phase 4: Trainer Allocation Worker
1. Create trainer-allocation-worker service
2. Consume PURCHASE_CREATED events
3. Add idempotency checks
4. Add retry logic
5. Emit TRAINER_ALLOCATED events

### Phase 5: Session Scheduling Worker
1. Create session-scheduling-worker service
2. Consume TRAINER_ALLOCATED events
3. Implement rolling window strategy
4. Add cron job for session top-up
5. Add idempotency checks

### Phase 6: Cache Invalidation Worker
1. Create cache-invalidation-worker service
2. Consume PURCHASE_CREATED events
3. Invalidate Redis caches
4. Add retry logic

### Phase 7: Database Constraints
1. Add UNIQUE constraints for idempotency
2. Add indexes for performance
3. Migrate existing data
4. Test constraint violations

### Phase 8: Monitoring & Observability
1. Add correlation IDs to all logs
2. Add metrics for event processing
3. Add alerts for dead letter queue
4. Add dashboard for event flow

---

## FINAL OUTPUT

### 1. Architecture Diagram
```
┌─────────────────┐
│  Payment API    │
│  (Controller)   │
└────────┬────────┘
         │
         │ 1. Verify Payment (idempotent)
         │ 2. Update Status
         │ 3. Emit Event (fire-and-forget)
         │ 4. Return 200 OK (< 100ms)
         │
         ▼
┌─────────────────┐
│  Event Bus       │
│  (Redis Streams) │
└────────┬────────┘
         │
         ├─────────────────┬─────────────────┬─────────────────┐
         │                 │                 │                 │
         ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Purchase     │  │ Allocation   │  │ Session      │  │ Cache       │
│ Worker       │  │ Worker      │  │ Worker       │  │ Worker      │
└──────┬───────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                 │                 │                 │
       │ Idempotent      │ Idempotent      │ Idempotent      │ Fire-and-
       │ Retry-safe      │ Retry-safe      │ Retry-safe      │ forget
       │                 │                 │                 │
       ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ PostgreSQL   │  │ PostgreSQL   │  │ PostgreSQL   │  │ Redis Cache  │
│ (Purchases)  │  │ (Allocations)│  │ (Sessions)   │  │ (Invalidate) │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### 2. Final Flow Sequence
1. **Payment Verification** (< 100ms)
   - Verify signature
   - Update payment status (idempotent)
   - Emit PURCHASE_CONFIRMED event
   - Return 200 OK

2. **Purchase Creation** (async, ~500ms)
   - Worker consumes PURCHASE_CONFIRMED
   - Check idempotency
   - Create purchase (idempotent)
   - Emit PURCHASE_CREATED event

3. **Trainer Allocation** (async, ~2-5s)
   - Worker consumes PURCHASE_CREATED
   - Check idempotency
   - Allocate trainer (idempotent)
   - Emit TRAINER_ALLOCATED event

4. **Session Scheduling** (async, ~1s)
   - Worker consumes TRAINER_ALLOCATED
   - Check idempotency
   - Create 7 sessions (rolling window)
   - Cron job maintains 7-session window

5. **Cache Invalidation** (async, ~50ms)
   - Worker consumes PURCHASE_CREATED
   - Invalidate Redis caches
   - Fire-and-forget

### 3. Idempotency Strategy
- **Payment**: UNIQUE constraint on `provider_payment_id`
- **Purchase**: UNIQUE constraint on `(student_id, course_id)` WHERE `is_active = true`
- **Allocation**: UNIQUE constraint on `(student_id, course_id)` WHERE `status IN ('approved', 'active')`
- **Session**: UNIQUE constraint on `(allocation_id, scheduled_date, scheduled_time)`
- **Event**: `processed_events` table with `event_id` as PRIMARY KEY

### 4. Retry & Failure Handling
- **Max Retries**: 3-5 attempts with exponential backoff
- **Dead Letter Queue**: After max retries, send to DLQ
- **Manual Recovery**: Admin reviews DLQ and fixes issues
- **Event Replay**: Events remain in stream for replay
- **Idempotency**: All operations idempotent, safe to retry

### 5. Why This Survives 600K+ Users
- **Decoupled**: No synchronous dependencies
- **Scalable**: Workers can scale horizontally
- **Resilient**: Failures don't cascade
- **Idempotent**: Safe to retry
- **Observable**: Full event trace with correlation IDs
- **Fast**: Payment confirmation < 100ms
- **Efficient**: Rolling window sessions, not eager creation

### 6. Remaining Risks
- **Event Bus Failure**: If Redis Streams down, events lost
  - **Mitigation**: Persist events to DB before emitting
- **Worker Crash**: If worker crashes, events remain in stream
  - **Mitigation**: Automatic restart, idempotency prevents duplicates
- **Database Deadlock**: High concurrency may cause deadlocks
  - **Mitigation**: Retry with exponential backoff, proper indexing
- **Event Ordering**: Events may process out of order
  - **Mitigation**: Idempotency makes order irrelevant

---

## DECISIONS MADE

1. **Event Bus**: Redis Streams (already in infrastructure, simpler than Kafka)
2. **Session Strategy**: Rolling window (7 sessions, efficient, scalable)
3. **Idempotency**: Database constraints + application checks (defense in depth)
4. **Retry Strategy**: Exponential backoff with max attempts (prevents infinite loops)
5. **Dead Letter Queue**: Manual review (ensures no data loss)

---

## NEXT STEPS

1. Review and approve architecture
2. Create implementation tickets
3. Implement Phase 1 (Event Infrastructure)
4. Test with load (1000 concurrent payments)
5. Gradually migrate existing flow
6. Monitor and optimize

