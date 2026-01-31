# Startup crash fixes — summary

Fixes applied to eliminate “container starts then immediately exits” in ECS/EC2. Assumes ECS_VERIFICATION_REPORT.md is correct.

---

## 1. course-service startup fix

**File:** `services/course-service/src/index.ts`

### Before (blocking startup, then exit(1) on Mongo failure)

```ts
async function start() {
  try {
    logger.info('Initializing MongoDB before starting server', ...);
    await getMongoConnection();
    logger.info('MongoDB initialized successfully', ...);
    const server = app.listen(PORT, () => { logServiceStart('Course Service', PORT); });
    setupServerHandlers(server);
  } catch (error) {
    logger.error('Failed to start Course Service - MongoDB initialization failed', ...);
    process.exit(1);
  }
}
// ...
start();
```

### After (listen first, Mongo in background, no exit(1) on Mongo)

```ts
function start() {
  const server = app.listen(PORT, () => {
    logServiceStart('Course Service', PORT);
  });

  setupServerHandlers(server);

  getMongoConnection().then(() => {
    logger.info('MongoDB connected (background)', { service: 'course-service' });
  }).catch((error) => {
    logger.warn('MongoDB background connection failed; /ready will stay 503 until Mongo is available', {
      service: 'course-service',
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
// ...
start();
```

**Why this prevents “container starts then exits”:**

- Server binds to PORT immediately; ALB can hit `/health` and get 200.
- Mongo is no longer awaited before `listen`, so Mongo unavailability does not block startup.
- Mongo failure is handled in `.catch()` with a warn log only; no `process.exit(1)`.
- `/ready` in `app.ts` still calls `setupHealthChecks()` → `getMongoConnection()`; it returns 503 until Mongo is up. No change to PORT, HEALTHCHECK, Dockerfiles, or `/health` semantics.

**Startup crash path removed:**

- **Removed:** `getMongoConnection()` rejects → catch → `process.exit(1)` (index.ts previously L44). That path is no longer possible.

**Still present (intended):**

- `process.exit(1)` on server `error` (e.g. EADDRINUSE) in `setupServerHandlers` — only after the server has been started; not “immediate” startup crash due to Mongo.

---

## 2. notification-worker SIGTERM and consumer ref

**File:** `services/notification-worker/src/index.ts`

### Changes

1. **Module-level consumer ref**

```ts
let consumerRef: ReturnType<typeof createKafkaConsumer> | null = null;
```

2. **Assign consumer after creation**

```ts
const consumer = createKafkaConsumer({ ... });
consumerRef = consumer;
await consumer.start(async (event, payload) => { ... });
```

3. **SIGTERM: stop consumer, then Mongo, then pool, then exit**

**Before:**

```ts
process.on('SIGTERM', async () => {
  logger.info('[NotificationWorker] Shutting down gracefully');
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});
```

**After:**

```ts
process.on('SIGTERM', async () => {
  logger.info('[NotificationWorker] Shutting down gracefully');
  try {
    if (consumerRef) await consumerRef.stop();
  } catch (e: any) {
    logger.warn('[NotificationWorker] Error stopping consumer', { error: e?.message });
  }
  try {
    if (mongoClient) await mongoClient.close();
  } catch (e: any) {
    logger.warn('[NotificationWorker] Error closing Mongo client', { error: e?.message });
  }
  try {
    if (pool) await pool.end();
  } catch (e: any) {
    logger.warn('[NotificationWorker] Error closing pool', { error: e?.message });
  }
  process.exit(0);
});
process.on('SIGINT', () => process.emit('SIGTERM' as any));
```

**Why this is correct:**

- Same pattern as purchase/session/cache/allocation workers: store consumer, on SIGTERM call `consumerRef.stop()`, close other resources, then exit.
- ECS stop no longer leaves the Kafka consumer running without a proper disconnect.

---

## 3. notification-worker startup robustness (Mongo retry + clear error)

**File:** `services/notification-worker/src/index.ts`

### Before

- Single `mongoClient.connect()`; on failure or missing `MONGO_URI`, throw → `main().catch` → `process.exit(1)` with no retry and generic log.

### After

- **Missing env:** If `MONGO_URI` (and alternatives) is unset, log explicit error then throw (fail fast with clear message).
- **Mongo connect:** Retry loop (5 attempts, delay 2s × attempt). Create a new `MongoClient` per attempt; on success assign to `mongoClient`/`mongoDb` and return. On failure after all retries, log explicit error then throw.

**Why this prevents silent/immediate crash:**

- Temporary Mongo unavailability is retried with backoff; only after 5 failures do we throw and then `main().catch` → `process.exit(1)`.
- When we do exit, logs state clearly: “MONGO_URI … is required” or “MongoDB connection failed after all retries. Check MONGO_URI and network.”
- No infinite loop: fixed 5 attempts.

---

## 4. cache-worker startup robustness (Redis retry + clear error)

**File:** `services/cache-worker/src/index.ts`

### Before

- `redis = getRedisClient(); if (!redis) throw ...; if (redis.status !== 'ready') await redis.connect();` — single attempt; any connect failure → throw → `main().catch` → `process.exit(1)`.

### After

- Same get of `redis`; if `!redis`, log “Redis client not available. Set REDIS_URL or REDIS_HOST…” and throw.
- Retry loop (5 attempts, delay 2s × attempt): if `redis.status !== 'ready'`, `await redis.connect()`. On success return; on failure after all retries, log “Redis connection failed after all retries. Check REDIS_URL/REDIS_HOST and network.” and throw.

**Why this prevents silent/immediate crash:**

- Temporary Redis unavailability is retried; exit(1) only after 5 failed attempts.
- Fail-fast with explicit log when Redis client is missing or all retries fail.
- No infinite loop: fixed 5 attempts.

---

## 5. No other startup changes

- **PORT handling:** Unchanged (getServicePortSync, Dockerfile ENV PORT).
- **HEALTHCHECK:** Unchanged (process.env.PORT in Dockerfile).
- **Dockerfiles:** Unchanged.
- **ALB /health:** Unchanged; course-service `/health` still returns 200 without DB.
- **Other HTTP services / workers:** No changes; only course-service, notification-worker, and cache-worker were modified for startup/exit behavior.

---

## Startup crash paths that are now impossible

| # | Previous crash path | Now |
|---|---------------------|-----|
| 1 | course-service: Mongo unavailable at startup → catch → `process.exit(1)` | Server starts first; Mongo in background; no exit(1) on Mongo failure. |
| 2 | notification-worker: Mongo connect fails once → throw → `main().catch` → `process.exit(1)` | Retry 5× with backoff; exit(1) only after all retries, with clear log. |
| 3 | cache-worker: Redis not ready / connect fails once → throw → `main().catch` → `process.exit(1)` | Retry 5× with backoff; exit(1) only after all retries, with clear log. |

**Still possible (by design):**

- course-service: server `listen` error (e.g. EADDRINUSE) → `process.exit(1)` (after server has started).
- notification-worker / cache-worker: after 5 failed Mongo/Redis attempts → throw → `main().catch` → `process.exit(1)` (with explicit logs).
- notification-worker: missing `MONGO_URI` → throw → `process.exit(1)` (with explicit log).

---

## Final checklist — system can start when Mongo/Redis/Kafka are temporarily unavailable

| Component | Can start when dependency temporarily unavailable? | Notes |
|-----------|----------------------------------------------------|--------|
| course-service | Yes | HTTP server listens immediately; Mongo in background; `/health` 200; `/ready` 503 until Mongo (and other deps) ready. No exit(1) on Mongo. |
| notification-worker | Yes (for a short window) | Mongo retried 5× with backoff (~2s, 4s, 6s, 8s, 10s). If Mongo is up within that window, worker starts; otherwise exit(1) with clear log. |
| cache-worker | Yes (for a short window) | Redis retried 5× with backoff. Same idea as notification-worker. |
| purchase-worker | N/A | No Mongo; Postgres/Kafka failure still leads to main().catch → exit(1). Not changed; same as before. |
| session-worker | N/A | Same as purchase-worker. |
| allocation-worker | N/A | Same as purchase-worker. |
| Other HTTP services | Yes | No change; they do not block listen on Mongo/Redis; only course-service was blocking on Mongo and that is fixed. |

**Summary:** course-service no longer exits on Mongo unavailability at startup. notification-worker and cache-worker retry Mongo/Redis with backoff and only exit after 5 failures with explicit logs, so short-lived Mongo/Redis outages no longer cause an immediate single-attempt crash.
