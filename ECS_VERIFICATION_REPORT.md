# ECS / EC2 Verification Report

**Purpose:** Verify all claimed fixes from ECS_DOCKER_READINESS_AUDIT.md against actual code. No assumptions; code-backed only.

**Date:** 2025-01-30

---

## Section A: VERIFIED OK (with file references)

### A.1 Worker Dockerfiles — non-root, no EXPOSE, CMD path

| Worker | USER nodejs | EXPOSE | CMD path |
|--------|-------------|--------|----------|
| notification-worker | ✅ L27–29 `USER nodejs` | ✅ None | ✅ L33 `CMD ["node", "dist/index.js"]`; WORKDIR L31 `/app/services/notification-worker` → `dist/index.js` exists after build |
| purchase-worker | ✅ L27–29 | ✅ None | ✅ L33; WORKDIR L31 `/app/services/purchase-worker` |
| session-worker | ✅ L27–29 | ✅ None | ✅ L33; WORKDIR L31 `/app/services/session-worker` |
| cache-worker | ✅ L27–29 | ✅ None | ✅ L33; WORKDIR L31 `/app/services/cache-worker` |
| allocation-worker | ✅ L52–55 `addgroup`/`adduser`/`chown`/`USER nodejs` | ✅ None | ✅ L57; WORKDIR L39 `/app/services/allocation-worker` |

**Reference:** Each `services/<name>/Dockerfile` — no file contains `EXPOSE`.

### A.2 Worker Dockerfiles — pinned package manager (where applicable)

- **allocation-worker:** `pnpm@8.15.0` pinned at Dockerfile L6. ✅  
- **notification-worker, purchase-worker, session-worker, cache-worker:** Use `npm` (no pnpm); no version pin required for npm in Dockerfile. ✅  

### A.3 HTTP service Dockerfiles — PORT and HEALTHCHECK

- All 12 HTTP service Dockerfiles:
  - Set `ENV PORT=<default>` (3000–3011). ✅  
  - HEALTHCHECK uses `process.env.PORT` (e.g. api-gateway L104–105: `CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || '3000') + '/health', ...)"`). ✅  

**Reference:** Grep on `ENV PORT` and `process.env.PORT` in `services/*/Dockerfile` — 12 files, all match.

### A.4 HTTP services — respect PORT and binding

- **getServicePortSync** (`shared/utils/portHelper.ts` L78): uses `process.env[envVarName] || process.env.PORT`. So PORT is respected. ✅  
- **api-gateway** `index.ts` L16: `app.listen(port, '0.0.0.0', ...)`. ✅  
- **admin-service** `index.ts` L25: `httpServer.listen(PORT, '0.0.0.0', ...)`. ✅  
- Other HTTP services: `app.listen(PORT, ...)` with no host — Node binds all interfaces by default. ✅  

### A.5 booking-service — TRAINER_SERVICE_URL default 3004

- `services/booking-service/src/utils/trainerIntegration.ts` L13: `process.env.TRAINER_SERVICE_URL || 'http://localhost:3004'`. ✅  
- `services/booking-service/src/utils/trainerServiceClient.ts` L9: same. ✅  

### A.6 notification-worker — no localhost when DOCKER=true

- `services/notification-worker/src/index.ts` L125–132:  
  `baseUrl = ... (process.env.DOCKER === 'true' ? '' : 'http://localhost:3006')`; then `if (!baseUrl) throw new Error('NOTIFICATION_SERVICE_URL or NOTIFICATION_SERVICE_INTERNAL_URL must be set when running in Docker/ECS')`. ✅  
  So when `DOCKER=true`, it does not default to localhost and requires URL from env.

### A.7 Workers (purchase, session, cache, allocation) — SIGTERM/SIGINT and consumer stop

- Each has:
  - `consumerRef` stored and `consumerRef.stop()` in SIGTERM handler. ✅  
  - `process.on('SIGTERM', ...)` and `process.on('SIGINT', () => process.emit('SIGTERM'))`. ✅  
  - Pool close (where applicable) then `process.exit(0)`. ✅  

**Reference:**  
- purchase-worker L1099–1114, session-worker L480–495, cache-worker L430–445, allocation-worker L466–481.

### A.8 HTTP services — SIGTERM and server close

- All 12 HTTP services register SIGTERM/SIGINT and call `server.close()` (or `httpServer.close()`) in a graceful shutdown handler, then `process.exit(0)`. ✅  
- course-service L69–97 (gracefulShutdown closes server, then exit). Same pattern in others.

### A.9 allocation-worker — lockfile

- `services/allocation-worker/Dockerfile` L15–16: `COPY pnpm-workspace.yaml` and `COPY pnpm-lock.yaml`. ✅  

---

## Section B: STILL BROKEN (blocking, causes crash or wrong behavior)

### B.1 notification-worker — SIGTERM does not stop Kafka consumer

- **Fact:** `notification-worker/src/index.ts` L296–302 only closes `mongoClient` on SIGTERM. It does **not** set or use `consumerRef` and does **not** call `consumer.stop()`.
- **Impact:** On ECS stop, Kafka consumer is not disconnected; process exits without graceful consumer shutdown. Can cause rebalance delays and duplicate processing.
- **Reference:** `services/notification-worker/src/index.ts` L233–239 (consumer created in `main()`), L296–302 (SIGTERM handler). No `consumerRef` or `consumer.stop()` in file.

### B.2 course-service — connects to MongoDB before HTTP server; exits if Mongo unavailable

- **Fact:** `course-service/src/index.ts` L22–44: `await getMongoConnection()` is called **before** `app.listen(PORT, ...)`. On failure, `catch` runs `process.exit(1)` at L44.
- **Impact:** If MongoDB is temporarily unavailable (e.g. network, Atlas throttling), course-service container starts then immediately exits with code 1. Classic “crash on startup” in ECS/EC2.
- **Reference:** `services/course-service/src/index.ts` L22–44.

### B.3 notification-worker — exits if MONGO_URI missing or Mongo connection fails

- **Fact:** `initialize()` is called from `main()` (L232). It throws if `!mongoUrl` (L61–66) or if `mongoClient.connect()` fails. `main().catch` then calls `process.exit(1)` at L292.
- **Impact:** Missing `MONGO_URI` (or Mongo unreachable) → container starts then immediately exits with code 1.
- **Reference:** `services/notification-worker/src/index.ts` L61–66, L69–70, L286–292.

### B.4 cache-worker — exits if Redis not available

- **Fact:** `initialize()` (L52–70) does `redis = getRedisClient(); if (!redis) throw new Error('Redis client not available');`. Called from `main()`; on throw, `main().catch` → `process.exit(1)` at L426.
- **Impact:** If Redis client is not available at startup, cache-worker exits immediately with code 1.
- **Reference:** `services/cache-worker/src/index.ts` L56–59, L346, L424–426.

---

## Section C: RISKY BUT NON-BLOCKING

### C.1 Worker Dockerfiles (notification, purchase, session, cache) — no lockfile copied

- **Fact:** These four use `COPY package*.json` only (root + service). Repo has `pnpm-lock.yaml`, not `package-lock.json`. No lockfile is copied; `npm install --legacy-peer-deps` runs without a lockfile.
- **Impact:** Builds are not reproducible; dependency drift possible. Does not by itself cause runtime crash.
- **Reference:** e.g. `services/notification-worker/Dockerfile` L6–7, L14; idem for purchase/session/cache.

### C.2 HTTP services — getServicePortSync at module top level

- **Fact:** api-gateway, notification-service, course-service, trainer-service, student-service, chat-service, booking-service, analytics-service call `getServicePortSync(...)` at top level (e.g. `const PORT = getServicePortSync(...)`). If both `PORT` and the service-specific env var are unset, `getServicePortSync` throws and the process exits before listening.
- **Mitigation:** All HTTP service Dockerfiles set `ENV PORT=<default>`, so in normal ECS/EC2 use PORT is set. Risk only if task definition unsets or overrides PORT with empty.
- **Reference:** e.g. `api-gateway/src/index.ts` L10; `shared/utils/portHelper.ts` L80–84 (throw when envPort missing).

### C.3 allocation-worker — exits if AllocationService import fails

- **Fact:** `initialize()` dynamically imports admin-service allocation module (L64–68). On failure it throws; `main().catch` → `process.exit(1)` at L462.
- **Impact:** Misbuilt image or missing admin-service dist can cause immediate exit. Not an env/dependency availability issue in the same way as Mongo/Redis.

### C.4 notification-worker — NOTIFICATION_SERVICE_URL only checked at call time

- **Fact:** The requirement “NOTIFICATION_SERVICE_URL or INTERNAL URL when DOCKER=true” is enforced inside `createNotificationViaService()` when handling an event, not at startup.
- **Impact:** If DOCKER=true and URL is unset, worker starts successfully; first notification request then throws. Non-blocking for “start then immediately exit” but can cause task failures under load.

---

## Section D: DOCUMENTATION MISMATCHES

### D.1 Audit doc §1.2 — “Non-root user | ❌” and “All 5 workers run as root”

- **Claim in doc:** “Non-root user | ❌” and “All 5 workers run as root” / “allocation-worker has no USER directive”.
- **Actual code:** All five worker Dockerfiles have `USER nodejs` (and addgroup/adduser/chown). allocation-worker L52–55.
- **Verdict:** Documentation was not updated after fixes; contradicts current code.

### D.2 Audit doc §1.2 — “allocation-worker/Dockerfile (line 6): pnpm@latest”

- **Claim in doc:** pnpm@latest (unpinned).
- **Actual code:** allocation-worker Dockerfile L6: `pnpm@8.15.0`.
- **Verdict:** Documentation not updated; contradicts code.

### D.3 Audit doc §5.2 — Worker SIGTERM table

- **Claim in doc:** “purchase-worker | ❌ None”, “session-worker | ❌ None”, “cache-worker | ❌ None”, “allocation-worker | ❌ None”.
- **Actual code:** All four have SIGTERM/SIGINT handlers and call `consumerRef.stop()`.
- **Verdict:** Table was not updated after fixes; contradicts code.

### D.4 Audit doc §5.2 — “notification-worker | ✅ L293”

- **Claim in doc:** notification-worker has SIGTERM (OK).
- **Actual code:** It has a SIGTERM handler at L296–302 but only closes `mongoClient`; it does **not** stop the Kafka consumer. Requirement was “gracefully stop Kafka consumers”.
- **Verdict:** Partial mismatch: handler exists but does not meet “stop Kafka consumer” requirement.

### D.5 Audit doc §2.1 — “Dockerfile HEALTHCHECK port” column

- **Claim in doc:** “3000 (hardcoded)” etc. for HEALTHCHECK port.
- **Actual code:** All 12 HTTP Dockerfiles use `process.env.PORT` in HEALTHCHECK.
- **Verdict:** Doc still describes old hardcoded behavior; not updated.

### D.6 “Fixes applied” — “All 5 worker Dockerfiles: Non-root user …”

- **Claim:** All 5 worker Dockerfiles have non-root user.
- **Actual:** True. No mismatch.

### D.7 “Fixes applied” — “Workers (purchase, session, cache, allocation): SIGTERM … consumer stop”

- **Claim:** Those four have SIGTERM and consumer stop.
- **Actual:** True. No mismatch. But “Fixes applied” does not state that **notification-worker** still does not stop the Kafka consumer.

---

## Section E: CRASH REPRODUCTION — Container starts then exits with code 1

| # | Service / Worker | File | Line(s) | Failing condition |
|---|-------------------|------|--------|--------------------|
| 1 | course-service | `services/course-service/src/index.ts` | 44 | `getMongoConnection()` rejects (MongoDB unavailable / bad MONGO_URI) → catch → `process.exit(1)` |
| 2 | course-service | same | 58, 65 | Server `listen` error (e.g. EADDRINUSE) → `process.exit(1)` |
| 3 | notification-worker | `services/notification-worker/src/index.ts` | 62–66 | `MONGO_URI` (and MONGODB_URI/MONGODB_URL) all unset → throw in `initialize()` → `main().catch` → `process.exit(1)` at 292 |
| 4 | notification-worker | same | 69–70 | `mongoClient.connect()` rejects → throw → `process.exit(1)` at 292 |
| 5 | notification-worker | same | 292 | Any throw from `main()` (e.g. Kafka connect, DLQ connect) → `process.exit(1)` |
| 6 | cache-worker | `services/cache-worker/src/index.ts` | 58–59 | `getRedisClient()` returns null/undefined → throw in `initialize()` → `process.exit(1)` at 426 |
| 7 | cache-worker | same | 426 | Any throw from `main()` → `process.exit(1)` |
| 8 | purchase-worker | `services/purchase-worker/src/index.ts` | 1095 | Any throw from `main()` (e.g. DB, Kafka, DLQ init) → `process.exit(1)` |
| 9 | session-worker | `services/session-worker/src/index.ts` | 476 | Any throw from `main()` → `process.exit(1)` |
| 10 | allocation-worker | `services/allocation-worker/src/index.ts` | 462 | Any throw from `main()` (e.g. AllocationService import, Kafka, DB) → `process.exit(1)` |
| 11 | Any HTTP service | `shared/utils/portHelper.ts` | 82–84 | `getServicePortSync` called when both service port env and `PORT` are unset → throw → in services that call it at top level, process exits (e.g. student-auth L85 `process.exit(1)` in catch). Mitigated by Dockerfile `ENV PORT` in all 12. |

---

## Section F: FINAL VERDICT

**Is this safe to deploy for TEST on EC2/ECS?**  
**NO** — with justification below.

### Blocking reasons

1. **course-service** (B.2): Connects to MongoDB **before** binding HTTP. If MongoDB is down or unreachable at startup, the container exits with code 1. This matches “system was previously crashing immediately on startup” when Mongo is slow or unavailable (e.g. cold start, network, Atlas throttling).

2. **notification-worker** (B.1): SIGTERM does not stop the Kafka consumer. ECS stop will not gracefully disconnect the consumer; can cause rebalance and duplicate processing. (B.3 is also a crash path but is env/config; B.1 is a behavioral defect in the claimed fix.)

3. **notification-worker** (B.3): Missing or invalid `MONGO_URI` (or Mongo connection failure) causes immediate exit. For ECS, task definition must set Mongo env/secrets; any misconfiguration → crash.

4. **cache-worker** (B.4): If Redis is not available at startup, worker exits immediately. Same pattern as above for dependency-at-startup.

### What is OK

- Worker Dockerfiles: non-root, no EXPOSE, CMD path, allocation-worker pnpm pin and lockfile.
- HTTP Dockerfiles: ENV PORT, HEALTHCHECK using PORT, and (with ENV PORT set) services respect PORT and bind correctly.
- booking-service trainer URL default 3004 and notification-worker no-localhost when DOCKER=true.
- purchase-, session-, cache-, allocation-workers: SIGTERM/SIGINT and consumer stop.

### Recommendation before TEST deploy

1. **course-service:** Start HTTP server first (e.g. listen on PORT), then connect to MongoDB in background or on first request; use `/ready` for Mongo readiness so ALB can use `/health` and the container does not exit when Mongo is temporarily unavailable.
2. **notification-worker:** Add `consumerRef` and call `consumer.stop()` (and optional pool/dlq disconnect) in SIGTERM handler, same pattern as the other four workers.
3. **notification-worker / cache-worker:** Either document required env (MONGO_URI, Redis) and accept immediate exit if missing, or add retry/backoff so temporary dependency unavailability does not cause immediate exit.
4. **Audit doc:** Update §1.2 (worker non-root, allocation pnpm), §5.2 (worker SIGTERM table and notification-worker consumer stop), and §2.1 (HEALTHCHECK uses PORT) so they match current code and requirements.

Once (1) and (2) are done and (3)/(4) are accepted or addressed, a TEST deployment on EC2/ECS behind ALB is reasonable, with task definitions setting all required env (PORT, MONGO_URI, NOTIFICATION_SERVICE_URL, Redis, etc.) and dependencies (Mongo, Redis, Kafka) available at startup for workers that currently require them.
