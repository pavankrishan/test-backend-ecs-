# Phase 3 Production Hardening Review

**Date:** January 25, 2026  
**Reviewer:** Senior Backend + DevOps Engineer  
**Focus:** Traffic Safety, Failure Isolation, Latency Control, WebSocket Robustness

---

## Executive Summary

**Status:** 🟠 **PRODUCTION READY WITH CRITICAL FIXES REQUIRED**

**Critical Issues Found:** 3  
**Important Issues Found:** 5  
**Nice-to-Have Improvements:** 2

---

## 🔴 CRITICAL ISSUES (Must Fix Before Production)

### 1. Missing HTTP Timeouts in Multiple Services

**Impact:** Outbound HTTP calls can hang indefinitely, blocking ALB threads and causing cascading failures.

**Files Affected:**
- `shared/utils/notificationClient.ts` - All axios calls lack timeout
- `services/admin-service/src/services/allocation.service.ts` - Lines 418, 2049, 2323-2330
- `services/admin-service/src/services/session.service.ts` - Line 1559
- `services/booking-service/src/utils/trainerIntegration.ts` - Lines 32, 77, 120
- `services/trainer-auth-service/src/integrations/msg91.ts` - Lines 65, 157, 252
- `services/student-auth-service/src/integrations/msg91.ts` - Lines 65, 157, 252

**Current State:**
```typescript
// ❌ UNSAFE - No timeout
await axios.post(`${this.baseUrl}/api/notifications`, {...});

// ❌ UNSAFE - No timeout
const courseResponse = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`);
```

**Required Fix:**
```typescript
// ✅ SAFE - Explicit timeout
await axios.post(`${this.baseUrl}/api/notifications`, {...}, {
  timeout: 5000, // 5 seconds for notifications
});

// ✅ SAFE - Explicit timeout
const courseResponse = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`, {
  timeout: 5000, // 5 seconds for internal service calls
});
```

**Recommended Timeouts:**
- Internal service calls: 5-10 seconds
- External APIs (Msg91, Razorpay): 10-15 seconds
- Notification service: 5 seconds (non-critical)
- Cache invalidation: 3 seconds (non-critical)

**Action Items:**
1. Add `timeout` option to all axios calls in `notificationClient.ts`
2. Add timeouts to all axios calls in `allocation.service.ts`
3. Add timeouts to all axios calls in `session.service.ts`
4. Add timeouts to all axios calls in `trainerIntegration.ts`
5. Add timeouts to all axios calls in `msg91.ts` (both services)

**Specific Code Locations:**
- `shared/utils/notificationClient.ts:22` - `axios.post` (no timeout)
- `shared/utils/notificationClient.ts:218` - `axios.post` (no timeout)
- `shared/utils/notificationClient.ts:242` - `axios.post` (no timeout)
- `shared/utils/notificationClient.ts:266` - `axios.post` (no timeout)
- `services/admin-service/src/services/allocation.service.ts:418` - `axios.get` (no timeout)
- `services/admin-service/src/services/allocation.service.ts:2049` - `axios.get` (no timeout)
- `services/admin-service/src/services/allocation.service.ts:2323-2330` - `axios.get` (has timeout: 5000 ✅)
- `services/admin-service/src/services/session.service.ts:1559` - `axios.get` (no timeout)
- `services/booking-service/src/utils/trainerIntegration.ts:32` - `axios.get` (no timeout)
- `services/booking-service/src/utils/trainerIntegration.ts:77` - `axios.get` (no timeout)
- `services/booking-service/src/utils/trainerIntegration.ts:120` - `axios.get` (no timeout)
- `services/trainer-auth-service/src/integrations/msg91.ts:65` - `axios.post` (no timeout)
- `services/trainer-auth-service/src/integrations/msg91.ts:157` - `axios.get` (no timeout)
- `services/trainer-auth-service/src/integrations/msg91.ts:252` - `axios.get` (no timeout)
- `services/student-auth-service/src/integrations/msg91.ts:65` - `axios.post` (no timeout)
- `services/student-auth-service/src/integrations/msg91.ts:157` - `axios.get` (no timeout)
- `services/student-auth-service/src/integrations/msg91.ts:252` - `axios.get` (no timeout)

---

### 2. WebSocket Connection Limits Missing

**Impact:** Single instance can exhaust memory with unlimited WebSocket connections. Under DDoS, instance will crash.

**File:** `services/api-gateway/src/websocket/eventServer.ts`

**Current State:**
- No per-instance connection limit
- No connection tracking
- No Redis-based connection state (multi-instance issue)
- No ALB sticky session configuration

**Required Fix:**
```typescript
// Add connection limits
const MAX_CONNECTIONS_PER_INSTANCE = 1000; // Configurable via env
const activeConnections = new Map<string, Socket>();

io.on('connection', (socket) => {
  // Enforce per-instance limit
  if (activeConnections.size >= MAX_CONNECTIONS_PER_INSTANCE) {
    logger.warn('Connection limit reached, rejecting new connection', {
      currentConnections: activeConnections.size,
      maxConnections: MAX_CONNECTIONS_PER_INSTANCE,
      service: 'api-gateway',
    });
    socket.disconnect(true);
    return;
  }

  const userId = socket.data.user?.id;
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  // Track connection
  activeConnections.set(socket.id, socket);

  // Store in Redis for multi-instance awareness (optional but recommended)
  const redis = getRedisClient();
  await redis.setex(`ws:connection:${socket.id}`, 3600, userId); // 1 hour TTL
  await redis.sadd(`ws:user:${userId}`, socket.id);

  socket.on('disconnect', () => {
    activeConnections.delete(socket.id);
    redis.del(`ws:connection:${socket.id}`);
    redis.srem(`ws:user:${userId}`, socket.id);
  });
});
```

**Additional Requirements:**
1. Add `ALB sticky session` configuration in ECS task definition
2. Add connection count metrics
3. Add graceful connection cleanup on shutdown

**Action Items:**
1. Implement per-instance connection limit (1000 default, configurable)
2. Add Redis-based connection tracking for multi-instance support
3. Configure ALB sticky sessions for WebSocket traffic
4. Add connection count to health check response

---

### 3. Redis Operations Without Timeouts

**Impact:** Redis calls can hang indefinitely if Redis is slow/unresponsive, blocking request handlers.

**Files Affected:**
- `services/course-service/src/services/course.service.ts` - Lines 44, 55, 82, 105, 156, 176, 211, 223, 278, 322, 333, 385, 389
- `services/chat-service/src/utils/cache.ts` - Lines 27, 52, 73
- `services/student-service/config/database.ts` - Redis operations

**Current State:**
```typescript
// ❌ UNSAFE - No timeout
const cached = await redis.get(cacheKey);
await redis.setex(cacheKey, 3600, JSON.stringify(course));
```

**Required Fix:**
```typescript
// ✅ SAFE - With timeout wrapper
async function redisGetWithTimeout(key: string, timeoutMs: number = 1000): Promise<string | null> {
  return Promise.race([
    redis.get(key),
    new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
    ),
  ]).catch(() => null); // Fail open for cache
}

// Usage
const cached = await redisGetWithTimeout(cacheKey, 1000);
```

**Recommended Timeouts:**
- Cache reads: 1 second (fail open)
- Cache writes: 2 seconds (fail silently)
- Rate limiting: 500ms (fail open)
- Pub/Sub: 3 seconds

**Action Items:**
1. Create `redisWithTimeout` wrapper utility in `shared/utils/`
2. Wrap all Redis operations with timeout
3. Ensure cache operations fail open (don't break request flow)
4. Ensure rate limiting fails open (allow request if Redis fails)

**Implementation Example:**
```typescript
// shared/utils/redisWithTimeout.ts
import { getRedisClient } from '../databases/redis/connection';
import logger from '../config/logger';

const redis = getRedisClient();

export async function redisGetWithTimeout(
  key: string, 
  timeoutMs: number = 1000
): Promise<string | null> {
  try {
    return await Promise.race([
      redis.get(key),
      new Promise<null>((_, reject) => 
        setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
      ),
    ]);
  } catch (error) {
    logger.warn('Redis get timeout or error (failing open)', {
      key,
      timeoutMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return null; // Fail open for cache
  }
}

export async function redisSetexWithTimeout(
  key: string,
  seconds: number,
  value: string,
  timeoutMs: number = 2000
): Promise<boolean> {
  try {
    await Promise.race([
      redis.setex(key, seconds, value),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Redis timeout')), timeoutMs)
      ),
    ]);
    return true;
  } catch (error) {
    logger.warn('Redis setex timeout or error (failing silently)', {
      key,
      timeoutMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return false; // Fail silently for cache writes
  }
}
```

---

## 🟠 IMPORTANT ISSUES (Fix Soon)

### 4. ALB Proxy Timeout Mismatch

**File:** `services/api-gateway/src/proxy.ts` - Line 160

**Issue:** Proxy timeout is 45 seconds, but ALB default idle timeout is 60 seconds. This creates a window where ALB may close connection before proxy timeout.

**Current State:**
```typescript
proxyTimeout: 45000, // 45 seconds
```

**Required Fix:**
```typescript
proxyTimeout: 55000, // 55 seconds - below ALB 60s default, with buffer
```

**Additional Recommendation:**
- Configure ALB idle timeout to 65 seconds in AWS console
- Document ALB timeout configuration in deployment guide

**Action Items:**
1. Increase proxyTimeout to 55 seconds
2. Document ALB idle timeout configuration requirement
3. Add ALB timeout check in deployment validation script

---

### 5. Database Query Timeout Configuration Inconsistent

**Files:** Multiple service database configs

**Issue:** Some services have explicit query timeouts, others rely on connection pool defaults. PostgreSQL default `statement_timeout` is unlimited.

**Current State:**
- Connection pool has `connectionTimeoutMillis: 10000` (good)
- No `statement_timeout` set at connection level
- Individual queries don't set timeouts

**Required Fix:**
```typescript
// In shared/databases/postgres/cloud-connection.ts
const pool = new Pool({
  // ... existing config
  // Add statement timeout at connection level
  options: '-c statement_timeout=30000', // 30 seconds per query
});
```

**Recommended Timeouts:**
- Standard queries: 30 seconds
- Aggregation queries: 60 seconds (student-service)
- Report generation: 120 seconds (admin-service)

**Action Items:**
1. Add `statement_timeout` to PostgreSQL connection options
2. Add per-query timeout for long-running operations
3. Document timeout strategy in database config

---

### 6. WebSocket Event Filtering Performance

**File:** `services/api-gateway/src/websocket/eventServer.ts` - Lines 203-216

**Issue:** Every event is checked against every connected socket. With 1000 connections, this is 1000 checks per event.

**Current State:**
```typescript
// ❌ O(N) per event - inefficient
io.on('connection', (socket) => {
  const unsubscribe = eventBus.subscribe(async (event) => {
    const shouldReceive = shouldReceiveEvent(event, userId, role);
    if (shouldReceive) {
      socket.emit('business-event', event);
    }
  });
});
```

**Required Fix:**
```typescript
// ✅ O(1) per event - use Redis Pub/Sub with user-specific channels
// Store user → socket mapping in Redis
// Subscribe to user-specific channels: `events:user:${userId}`

// On connection:
await redis.subscribe(`events:user:${userId}`);
redis.on('message', (channel, message) => {
  const event = JSON.parse(message);
  socket.emit('business-event', event);
});
```

**Action Items:**
1. Implement Redis Pub/Sub for event routing (user-specific channels)
2. Remove per-socket event filtering
3. Add event routing metrics

---

### 7. Synchronous Downstream Calls in Request Path

**Files:**
- `services/payment-service/src/services/payment.service.ts` - Line 279 (cache invalidation)
- `services/course-service/src/services/courseStructure.service.ts` - Line 784 (cache invalidation)

**Issue:** Cache invalidation calls are awaited in request path. If notification-service is slow, payment confirmation is delayed.

**Current State:**
```typescript
// ❌ Blocks request until cache invalidation completes
const response = await httpPost(cacheInvalidationUrl, {}, { timeout: 5000 });
```

**Required Fix:**
```typescript
// ✅ Fire-and-forget (non-blocking)
httpPost(cacheInvalidationUrl, {}, { timeout: 5000 })
  .catch(error => {
    logger.warn('Cache invalidation failed (non-critical)', {
      error: error.message,
      service: 'payment-service',
    });
  });
// Continue without awaiting
```

**Action Items:**
1. Make cache invalidation non-blocking (fire-and-forget)
2. Ensure all non-critical operations are async
3. Add metrics for cache invalidation success rate

---

### 8. Missing Request Timeout Middleware

**File:** `services/*/src/app.ts` (all services)

**Issue:** No global request timeout middleware. Long-running requests can hold connections indefinitely.

**Required Fix:**
```typescript
// Add to each service's app.ts
import timeout from 'connect-timeout';

// Set request timeout (must be before routes)
app.use(timeout('30s')); // 30 seconds for most services
// For aggregation endpoints, use 60s

// Add timeout handler
app.use((req, res, next) => {
  if (!req.timedout) next();
});
```

**Recommended Timeouts:**
- Standard endpoints: 30 seconds
- Aggregation endpoints (student-service): 60 seconds
- File upload endpoints: 120 seconds

**Action Items:**
1. Add `connect-timeout` middleware to all services
2. Configure per-endpoint timeouts where needed
3. Add timeout metrics

---

## 🟡 NICE TO HAVE (Optimize Later)

### 9. ALB Path-Based Routing Validation

**File:** `services/api-gateway/src/proxy.ts`

**Issue:** No validation that all service routes are properly configured. Missing routes would return 404 without clear error.

**Recommendation:**
- Add startup validation that all services are reachable
- Add health check for each proxied service
- Log routing table on startup

---

### 10. Metrics Infrastructure

**Current State:** No metrics collection visible in codebase.

**Recommended Metrics:**
1. **Latency:**
   - Request duration (p50, p95, p99)
   - Database query duration
   - Redis operation duration
   - External API call duration

2. **Error Rate:**
   - 4xx/5xx response counts
   - Timeout counts
   - Database connection errors
   - Redis connection errors

3. **Queue Depth:**
   - Kafka consumer lag
   - Worker queue depth
   - Database connection pool wait queue

4. **Resource Usage:**
   - Active WebSocket connections
   - Database connection pool usage
   - Redis connection count

**Implementation:**
- Use CloudWatch Metrics (AWS-native)
- Add `prom-client` for Prometheus (if using Prometheus)
- Emit custom metrics from each service

**Action Items:**
1. Add CloudWatch metrics SDK to shared package
2. Create metrics utility (`shared/utils/metrics.ts`)
3. Add latency metrics to all endpoints
4. Add error rate metrics
5. Add queue depth metrics for workers

---

## 📋 Summary of Required Fixes

### Critical (Before Production):
1. ✅ Add HTTP timeouts to all axios calls (6 files)
2. ✅ Add WebSocket connection limits (1 file)
3. ✅ Add Redis operation timeouts (3 files)

### Important (Fix Soon):
4. ✅ Adjust ALB proxy timeout (1 file)
5. ✅ Add database statement timeout (1 file)
6. ✅ Optimize WebSocket event routing (1 file)
7. ✅ Make cache invalidation non-blocking (2 files)
8. ✅ Add request timeout middleware (all services)

### Nice to Have:
9. Add ALB routing validation
10. Add metrics infrastructure

---

## 🔧 Implementation Priority

**Week 1 (Critical):**
- Fix HTTP timeouts
- Add WebSocket connection limits
- Add Redis timeouts

**Week 2 (Important):**
- Fix ALB timeout mismatch
- Add database statement timeout
- Optimize WebSocket routing
- Make cache invalidation async
- Add request timeout middleware

**Week 3 (Nice to Have):**
- Add routing validation
- Add metrics infrastructure

---

## 📝 Notes

- All fixes maintain backward compatibility
- Timeout values are conservative (can be tuned based on metrics)
- WebSocket improvements require ALB configuration changes
- Metrics require CloudWatch permissions in ECS task roles

---

**Phase 3 Review Complete** ✅
