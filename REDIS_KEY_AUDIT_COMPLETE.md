# Redis Key Audit - Complete Inventory
## Production Hardening - Phase 2

**Date:** January 26, 2026  
**Status:** ✅ **AUDIT COMPLETE**

---

## Redis Key Patterns - Complete Inventory

### 1. Journey Tracking Keys

| Key Pattern | Purpose | Owner Service | TTL | Failure Behavior | Operations |
|-------------|---------|---------------|-----|------------------|------------|
| `journey:active:{sessionId}` | Active journey tracking | admin-service | 3600s (1h) | Fail-closed (throw) | SETNX, GET, DEL |
| `location:trainer:{trainerId}:session:{sessionId}` | Trainer location during journey | admin-service | 300s (5m) | Fail-open (return null) | SETEX, GET, DEL |
| `location:rate:{trainerId}` | Rate limiting for location updates | admin-service | 5s | Fail-open (allow) | INCR, EXPIRE |

**Rationale:**
- Journey TTL (1h): Covers max journey duration, auto-expires if trainer crashes
- Location TTL (5m): Auto-expires if trainer stops updating (network failure)
- Rate limit TTL (5s): Matches rate limit window

---

### 2. Cache Keys

| Key Pattern | Purpose | Owner Service | TTL | Failure Behavior | Operations |
|-------------|---------|---------------|-----|------------------|------------|
| `cache:student:{studentId}:home` | Student home data cache | student-service | 3600s (1h) | Fail-open (return null) | SETEX, GET, DEL |
| `cache:student:{studentId}:learning` | Learning data cache | student-service | 3600s (1h) | Fail-open (return null) | SETEX, GET, DEL |
| `cache:course:{courseId}:videos` | Course videos cache | course-service | 3600s (1h) | Fail-open (return null) | SETEX, GET, DEL |

**Rationale:**
- Cache TTL (1h): Balance between freshness and performance
- Fail-open: Cache misses are acceptable, don't break requests

---

### 3. WebSocket Connection Keys

| Key Pattern | Purpose | Owner Service | TTL | Failure Behavior | Operations |
|-------------|---------|---------------|-----|------------------|------------|
| `ws:connection:{socketId}` | WebSocket connection mapping | api-gateway | 3600s (1h) | Fail-silent (continue) | SETEX, DEL |
| `ws:user:{userId}` | User's WebSocket connections (set) | api-gateway | 3600s (1h) | Fail-silent (continue) | SADD, SREM, EXPIRE |

**Rationale:**
- Connection TTL (1h): Matches typical session duration
- Set TTL: Prevents set accumulation if cleanup fails
- Fail-silent: WebSocket tracking is non-critical

---

### 4. Session Management Keys

| Key Pattern | Purpose | Owner Service | TTL | Failure Behavior | Operations |
|-------------|---------|---------------|-----|------------------|------------|
| `session:{sessionId}` | Session state cache | sessionManager | 86400s (24h) | Fail-open (return null) | SETEX, GET, DEL |
| `refresh:lock:{sessionId}` | Refresh token lock (prevents race conditions) | sessionManager | 30s | Fail-open (allow) | SET with EX+NX, DEL |

**Rationale:**
- Session TTL (24h): Matches typical session lifetime
- Refresh lock TTL (30s): Short-lived lock for atomic operations

---

### 5. Rate Limiting Keys

| Key Pattern | Purpose | Owner Service | TTL | Failure Behavior | Operations |
|-------------|---------|---------------|-----|------------------|------------|
| `rate_limit:*` | API rate limiting | api-gateway | 60s | Fail-open (allow) | INCR, EXPIRE |
| `ratelimit:{ip}:{userId}` | Per-user rate limiting | api-gateway | 60s | Fail-open (allow) | INCR, EXPIRE |

**Rationale:**
- Rate limit TTL (60s): Matches rate limit window
- Fail-open: Allow requests if rate limiting fails (availability over strict limits)

---

### 6. Token Management Keys

| Key Pattern | Purpose | Owner Service | TTL | Failure Behavior | Operations |
|-------------|---------|---------------|-----|------------------|------------|
| `token:blacklist:{tokenHash}` | Blacklisted tokens | auth-services | Match token expiry | Fail-open (allow) | SETEX, GET |

**Rationale:**
- TTL matches token expiry: Prevents unnecessary storage
- Fail-open: If Redis fails, allow token (security vs availability trade-off)

---

## Redis Key Convention (Standardized)

### Format
```
{namespace}:{entity}:{identifier}:{subkey?}
```

### Namespaces

| Namespace | Purpose | Example |
|-----------|---------|---------|
| `journey:` | Journey tracking | `journey:active:{sessionId}` |
| `location:` | Location data | `location:trainer:{trainerId}:session:{sessionId}` |
| `cache:` | Application cache | `cache:student:{studentId}:home` |
| `ws:` | WebSocket state | `ws:connection:{socketId}` |
| `session:` | Session state | `session:{sessionId}` |
| `token:` | Token management | `token:blacklist:{tokenHash}` |
| `rate_limit:` | Rate limiting | `rate_limit:{route}:{userId}` |
| `refresh:` | Refresh token locks | `refresh:lock:{sessionId}` |

### TTL Rules

1. **Volatile data:** TTL required (journey, location, cache)
2. **Persistent data:** No TTL (processed_events - handled by database)
3. **Default TTL:** 
   - Cache: 3600s (1 hour)
   - Location: 300s (5 minutes)
   - Rate limiting: 60s (1 minute)
   - Locks: 30s (short-lived)

### Failure Behavior

| Behavior | Use Case | Example |
|----------|----------|---------|
| **Fail-closed** | Critical operations | Journey start (prevents duplicates) |
| **Fail-open** | Cache reads, rate limiting | Cache misses, allow requests if Redis fails |
| **Fail-silent** | Non-critical tracking | WebSocket connection tracking |

---

## Verification

### ✅ All Keys Have TTLs

**Verified:**
- ✅ All `redis.set()` calls use `SETEX` or `SET ... EX` (with TTL)
- ✅ All `redis.sadd()` calls followed by `EXPIRE` (sets have TTL)
- ✅ All cache keys have TTLs (1 hour default)
- ✅ All location keys have TTLs (5 minutes)
- ✅ All rate limit keys have TTLs (60 seconds)

**No Action Required:** All Redis operations already have TTLs ✅

---

## Redis Operations Summary

### Operations with TTLs ✅

1. **SETEX** - Set with expiration (atomic)
2. **SET ... EX** - Set with expiration option
3. **SET ... EX ... NX** - Set if not exists with expiration (atomic)
4. **INCR + EXPIRE** - Increment counter, then set expiration
5. **SADD + EXPIRE** - Add to set, then set expiration

### Operations Without TTLs (By Design) ✅

1. **GET** - Read operations (no TTL needed)
2. **DEL** - Delete operations (no TTL needed)
3. **SREM** - Remove from set (no TTL needed)

---

## Memory Management

### Estimated Memory Usage (10k concurrent users)

| Key Type | Count | Size per Key | Total |
|----------|-------|--------------|-------|
| Journey keys | 10,000 | ~200 bytes | ~2 MB |
| Location keys | 10,000 | ~100 bytes | ~1 MB |
| Cache keys | 50,000 | ~5 KB | ~250 MB |
| WebSocket keys | 10,000 | ~50 bytes | ~0.5 MB |
| Rate limit keys | 100,000 | ~20 bytes | ~2 MB |
| **Total** | **180,000** | - | **~255 MB** |

**Conclusion:** Memory usage is reasonable for 10k users. Redis can handle this easily.

---

## Recommendations

### ✅ Already Implemented
- All keys have TTLs
- Proper failure behavior (fail-open for cache, fail-closed for critical ops)
- Atomic operations (SETNX, SETEX)

### ⚠️ Future Considerations
- **Redis Clustering:** For 100k+ users, consider Redis Cluster
- **Cache Warming:** Pre-warm frequently accessed cache keys
- **Monitoring:** Add Redis memory usage alerts

---

**Audit Status:** ✅ **COMPLETE**  
**All Keys Documented:** ✅ **YES**  
**All TTLs Verified:** ✅ **YES**

---

**END OF REDIS AUDIT**
