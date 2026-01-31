# Production Payment Service Architecture
## Enterprise EdTech Pattern (Vedantu/Byjus Style)

### Overview
This document outlines the production-grade payment processing flow implemented following enterprise edtech best practices.

---

## Payment Confirmation Flow

### Critical Path (Must Succeed)
1. **Payment Verification** ✅
   - Verify payment signature with payment gateway
   - Update payment status to `succeeded`
   - Record payment confirmation timestamp

2. **Purchase Record Creation** ✅ (CRITICAL)
   - Creates `student_course_purchases` record
   - Stores purchase tier (10/20/30 sessions)
   - Stores metadata (timeSlot, date, schedule, etc.)
   - **Retries on failure** - Added to retry queue
   - **Why Critical**: Course must appear in student dashboard immediately

3. **Trainer Auto-Assignment** ✅ (CRITICAL)
   - Automatically assigns trainer based on:
     - Course specialty matching
     - Gender preferences
     - Time slot availability
     - Workload balancing
     - Distance constraints
   - **Retries on failure** - Added to retry queue
   - **Why Critical**: Student needs trainer to start sessions

### Non-Critical Path (Can Fail Silently)
4. **Notification** ⚠️ (NON-CRITICAL)
   - Sends push notification about purchase
   - Fetches course name from course service
   - **Can fail silently** - Doesn't block payment flow

---

## Deprecated: Enrollment

### What Was Enrollment?
Enrollment was a legacy step that created a `student_course_progress` record when a course was purchased.

### Why It's Deprecated
- **Progress is now read-only** - Managed by database triggers
- **Auto-generated from sessions** - Progress calculated from `tutoring_sessions` table
- **No manual step needed** - Progress record created automatically when first session completes

### Current Architecture
```
Payment Success
  ↓
Purchase Record Created
  ↓
Trainer Auto-Assigned
  ↓
Sessions Created
  ↓
[First Session Completed] → Database Trigger → Progress Record Created
```

---

## Production Best Practices

### 1. Idempotency
- All operations are idempotent
- Duplicate purchase records are handled gracefully
- Retry-safe operations

### 2. Retry Queue
- Purchase creation failures → Retry queue
- Trainer assignment failures → Retry queue
- Automatic retry with exponential backoff

### 3. Error Handling
- **Critical failures**: Logged and retried
- **Non-critical failures**: Logged but don't block flow
- **Payment never fails** due to downstream service issues

### 4. Async Processing
- Purchase creation: Async (non-blocking)
- Auto-assignment: Async (non-blocking)
- Notifications: Async (non-blocking)
- **Payment confirmation returns immediately**

### 5. Logging
- Structured logging with context
- Clear success/failure indicators
- Detailed error information for debugging

---

## Flow Diagram

```
┌─────────────────┐
│ Payment Success │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ 1. Create Purchase      │ ← CRITICAL (Retries on failure)
│    - student_course_    │
│      purchases table    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 2. Auto-Assign Trainer  │ ← CRITICAL (Retries on failure)
│    - Find matching      │
│      trainer            │
│    - Create allocation  │
│    - Create sessions    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 3. Send Notification     │ ← NON-CRITICAL (Can fail)
│    - Push notification   │
└─────────────────────────┘
```

---

## Key Differences from Legacy Flow

### Legacy Flow (Deprecated)
```
Payment → Enrollment → Purchase → Auto-Assignment
         (FAILS 410)    (Works)    (Never triggered)
```

### Production Flow (Current)
```
Payment → Purchase → Auto-Assignment → Notification
         (Works)    (Works)           (Optional)
```

---

## Database Architecture

### Purchase Record
- **Table**: `student_course_purchases`
- **Purpose**: Track course purchases
- **Key Fields**: `purchase_tier`, `purchase_date`, `expiry_date`, `metadata`

### Progress Record
- **Table**: `student_course_progress`
- **Purpose**: Track learning progress
- **Auto-Generated**: Via database triggers from `tutoring_sessions`
- **Read-Only**: Cannot be manually updated

### Allocation Record
- **Table**: `trainer_allocations`
- **Purpose**: Link student to trainer
- **Status**: `approved` or `pending`
- **Created**: Automatically during auto-assignment

---

## Monitoring & Alerts

### Critical Metrics
1. **Purchase Creation Success Rate** - Should be > 99%
2. **Auto-Assignment Success Rate** - Should be > 95%
3. **Retry Queue Size** - Monitor for backlog
4. **Payment Confirmation Time** - Should be < 2 seconds

### Alert Thresholds
- Purchase creation failures > 1% → Alert
- Auto-assignment failures > 5% → Alert
- Retry queue size > 100 → Alert

---

## Retry Strategy

### Purchase Creation
- **Max Retries**: 3
- **Backoff**: Exponential (2s, 4s, 8s)
- **Dead Letter Queue**: After 3 failures

### Trainer Assignment
- **Max Retries**: 3
- **Backoff**: Exponential (2s, 4s, 8s)
- **Dead Letter Queue**: After 3 failures
- **Manual Review**: Pending allocations can be manually approved

---

## Testing Checklist

### Unit Tests
- [ ] Purchase creation with valid data
- [ ] Purchase creation with duplicate order ID
- [ ] Auto-assignment with matching trainer
- [ ] Auto-assignment with no available trainers
- [ ] Notification sending success/failure

### Integration Tests
- [ ] Full payment flow end-to-end
- [ ] Retry queue processing
- [ ] Error handling and recovery

### Load Tests
- [ ] Concurrent payment processing
- [ ] Retry queue under load
- [ ] Database connection pooling

---

## Migration Notes

### For Existing Purchases
Use the retry endpoint to trigger auto-assignment:
```
POST /api/v1/admin/allocations/retry-auto-assign
{
  "studentId": "...",
  "courseId": "..."
}
```

### For Pending Allocations
Manually approve or assign trainer:
```
POST /api/v1/admin/allocations/:allocationId/approve
POST /api/v1/admin/allocations/allocate
```

---

## Code Quality Standards

### Error Handling
- ✅ All async operations have `.catch()` handlers
- ✅ Critical failures are logged with context
- ✅ Non-critical failures don't block main flow

### Logging
- ✅ Structured logging with emojis for quick scanning
- ✅ Context included (studentId, courseId, paymentId)
- ✅ Success/failure clearly indicated

### Code Organization
- ✅ Clear separation of critical vs non-critical operations
- ✅ Comments explain "why" not just "what"
- ✅ Production-ready error messages

---

## Future Improvements

1. **Event-Driven Architecture**
   - Use message queue for async operations
   - Better retry handling
   - Improved observability

2. **Circuit Breaker Pattern**
   - Prevent cascade failures
   - Graceful degradation

3. **Distributed Tracing**
   - Track requests across services
   - Performance monitoring

4. **Rate Limiting**
   - Prevent abuse
   - Fair resource allocation

