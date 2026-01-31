# ECS Fargate + ALB Readiness Audit

**Scope:** All Dockerfiles, docker-compose, env usage, networking, health checks, and ECS/ALB compatibility for a Node.js microservices backend.

**Date:** 2025-01-30

---

## Fixes applied (2025-01-30)

All required fixes from this audit have been implemented:

- **booking-service:** Default `TRAINER_SERVICE_URL` port corrected to 3004 in `trainerIntegration.ts` and `trainerServiceClient.ts`.
- **notification-worker:** When `DOCKER=true`, `NOTIFICATION_SERVICE_URL` or `NOTIFICATION_SERVICE_INTERNAL_URL` is required (no localhost fallback).
- **Workers (purchase, session, cache, allocation):** SIGTERM/SIGINT graceful shutdown (consumer stop, pool close, then exit); consumer ref stored for shutdown.
- **All 5 worker Dockerfiles:** Non-root user `nodejs:1001` added; **allocation-worker:** pnpm pinned to `8.15.0`.
- **All 12 HTTP service Dockerfiles:** `ENV PORT=<default>` added and HEALTHCHECK updated to use `process.env.PORT` so ECS dynamic ports work.
- **docker-compose:** `MONGO_URI` default removed; use `.env` for local dev and ECS/secrets for production.

---

## Executive Summary

| Category | Verdict |
|----------|---------|
| **Overall** | **READY** for test deployment (required fixes applied) |
| HTTP services (API-facing) | 12 services: mostly READY with **required fixes** below |
| Workers | 5 workers: **NEEDS CHANGES** (Dockerfile + SIGTERM) |
| docker-compose | Local parity only; **compose-only configs** must be moved to ECS |

**Safe for TEST deployment?** **Yes.** Required fixes have been applied; see "Fixes applied" above. Optional improvements can follow.

---

## 1. DOCKERFILE BASICS

### 1.1 HTTP Services (api-gateway, booking, course, admin, analytics, trainer-auth, student-auth, student, trainer, notification, payment, chat)

| Check | Status | Notes |
|-------|--------|--------|
| Pinned base image | ✅ | `node:18-alpine` (no `:latest`) |
| WORKDIR | ✅ | Set in base and runtime (`/app`, then `/app/service`) |
| Lockfile usage | ⚠️ | `pnpm install` used; **not** `pnpm ci` / frozen lockfile. Lockfile is copied (`pnpm-lock.yaml`). |
| Production deps only at runtime | ✅ | Runtime stage uses `npm install --omit=dev` |
| Non-root user | ✅ | `nodejs:1001` in runtime |
| CMD/ENTRYPOINT | ✅ | `CMD ["node", "dist/index.js"]` (exec form, no shell) |

**Issues:**

- **notification-service/Dockerfile** (line 39): Comment says "Use install (no frozen-lockfile)" — lockfile can drift; recommend `pnpm install --frozen-lockfile` for CI/ECS builds.
- **api-gateway/Dockerfile** (line 90): Uses `sed` without `apk add sed`; Alpine includes sed — OK.
- **admin-service/Dockerfile** (line 90): Uses `node -e` for workspace replacement (no `sed`); acceptable.

### 1.2 Workers (notification-worker, purchase-worker, session-worker, cache-worker, allocation-worker)

| Check | Status | Notes |
|-------|--------|--------|
| Pinned base image | ✅ | `node:18-alpine` |
| WORKDIR | ✅ | Set |
| Lockfile | ⚠️ | notification/purchase/session/cache: `npm install --legacy-peer-deps` — **no lockfile copy** (only `package*.json`). allocation-worker: has `pnpm-lock.yaml`, uses `pnpm install`. |
| Production only | ⚠️ | `npm prune --production` / `pnpm prune --production` after build — OK. |
| Non-root user | ❌ | **All 5 workers run as root.** allocation-worker has no `USER` directive. |
| CMD | ✅ | `CMD ["node", "dist/index.js"]` |

**Concrete issues:**

- **notification-worker/Dockerfile**: No `pnpm-lock.yaml`/`package-lock.json` copied; `COPY package*.json` may not include lockfile from repo root. No non-root user.
- **purchase-worker/Dockerfile**: Same — no lockfile, root user.
- **session-worker/Dockerfile**: Same.
- **cache-worker/Dockerfile**: Same.
- **allocation-worker/Dockerfile** (line 6): `pnpm@latest` — **unpinned**. Line 52: No `USER nodejs` — runs as root.

---

## 2. PORT & NETWORKING

### 2.1 Containers that MUST expose a port (ALB targets)

| Service | Port | Exposes in compose | Dockerfile HEALTHCHECK port |
|---------|------|--------------------|-----------------------------|
| api-gateway | 3000 | ✅ | 3000 (hardcoded) |
| student-auth-service | 3001 | ✅ | 3001 |
| trainer-auth-service | 3002 | ✅ | 3002 |
| student-service | 3003 | ✅ | 3003 |
| trainer-service | 3004 | ✅ | 3004 |
| course-service | 3005 | ✅ | 3005 |
| notification-service | 3006 | ✅ | 3006 |
| payment-service | 3007 | ✅ | 3007 |
| chat-service | 3008 | ✅ | 3008 |
| analytics-service | 3009 | ✅ | 3009 |
| admin-service | 3010 | ✅ | 3010 |
| booking-service | 3011 | ✅ | 3011 |

### 2.2 Containers that MUST NOT expose a port

| Worker | Port in compose | Correct |
|--------|------------------|--------|
| notification-worker | none | ✅ |
| purchase-worker | none | ✅ |
| allocation-worker | none | ✅ |
| session-worker | none | ✅ |
| cache-worker | none | ✅ |

### 2.3 No localhost for inter-service communication

- **api-gateway/proxy.ts**: Uses env-based targets (`SERVICES_HOST`, per-service port env vars); fallback to `localhost` only when **not** Docker. ✅
- **admin-service**: `COURSE_SERVICE_URL: http://course-service:3005` in compose; code uses `SERVICES_HOST` or `localhost`. ✅ For ECS, set `COURSE_SERVICE_URL` (or equivalent) in task definition.
- **allocation-worker**: `ADMIN_SERVICE_URL: http://admin-service:3010` in compose. ✅ ECS: set `ADMIN_SERVICE_URL` to ECS service discovery URL or ALB/internal NLB.
- **notification-worker**: **Issue** — `services/notification-worker/src/index.ts` line 126–128: default `'http://localhost:3006'` if `NOTIFICATION_SERVICE_URL` / `NOTIFICATION_SERVICE_INTERNAL_URL` unset. In ECS there is no localhost to notification-service. **Required:** Always set `NOTIFICATION_SERVICE_URL` in ECS task definition.
- **booking-service**: **Issue** — `TRAINER_SERVICE_URL` default `'http://localhost:3003'` in `trainerIntegration.ts` and `trainerServiceClient.ts` (lines 13 and 9). Port **3003 is student-service**; trainer-service is **3004**. **Required:** Set `TRAINER_SERVICE_URL` in ECS (e.g. `http://trainer-service:3004` or service discovery URL) and fix default to 3004 if kept as fallback for local dev only.

---

## 3. HEALTH CHECKS (CRITICAL FOR ALB)

### 3.1 ALB-facing services — health endpoint

| Service | `/health` exists | Does not depend on DB/Redis/Kafka |
|---------|-------------------|------------------------------------|
| api-gateway | ✅ `app.ts` L115 | ✅ Returns 200 + JSON |
| student-auth-service | ✅ | ✅ `healthHandler` from shared (liveness only) |
| trainer-auth-service | ✅ | ✅ |
| student-service | ✅ | ✅ |
| trainer-service | ✅ | ✅ |
| course-service | ✅ | ✅ (also lazy init; `/health` is liveness) |
| notification-service | ✅ | ✅ |
| payment-service | ✅ | ✅ |
| chat-service | ✅ | ✅ |
| analytics-service | ✅ | ✅ |
| admin-service | ✅ | ✅ |
| booking-service | ✅ | ✅ |

Shared **liveness** (`/health`): `healthHandler` returns 200 with no DB/Redis/Mongo check — **ALB-safe**.

**Readiness** (`/ready`): Uses Postgres/Redis/Mongo; **do not** use `/ready` for ALB target group health — use **path `/health`**.

### 3.2 Dockerfile HEALTHCHECK vs ECS

- All 12 HTTP service Dockerfiles include `HEALTHCHECK` pointing at `http://localhost:<SERVICE_PORT>/health` with fixed port (e.g. 3000, 3001, …).
- **Issue:** If ECS task definition sets **`PORT`** (or `API_GATEWAY_PORT`, etc.) to a **dynamic** value, the in-image HEALTHCHECK would still call the fixed port and could fail. **Required:** Either (a) use **ECS task definition health check** (path `/health`, port from container port mapping) and omit/override Docker HEALTHCHECK, or (b) make Dockerfile HEALTHCHECK use env: e.g. `CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || '3000') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"` (and set `ENV PORT=3000` in Dockerfile as default so local Docker stays correct).

### 3.3 Workers

- Workers do **not** expose HTTP; no HEALTHCHECK in Dockerfiles. ✅ Correct for ECS (no ALB target).

---

## 4. ENVIRONMENT VARIABLES

### 4.1 Required env vars per service (summary)

- **api-gateway:** `API_GATEWAY_PORT`, `POSTGRES_URL`, `REDIS_URL`/`REDIS_HOST`, `KAFKA_BROKERS`, per-service URLs/ports for proxy (or `SERVICES_HOST`), `CORS_ORIGIN`.
- **student-auth-service / trainer-auth-service:** `POSTGRES_URL`, `REDIS_URL`/`REDIS_HOST`, `STUDENT_AUTH_SERVICE_PORT`/`TRAINER_AUTH_SERVICE_PORT`, payment/student service URLs if used.
- **student-service / trainer-service:** Postgres, Redis, port env, any downstream service URLs.
- **course-service:** Postgres, Mongo, Redis, `COURSE_SERVICE_PORT`, `SERVICES_HOST` if calling student-service.
- **notification-service:** Postgres, Redis, `KAFKA_BROKERS`, `NOTIFICATION_SERVICE_PORT`, FCM vars (optional if `FCM_OPTIONAL=true`).
- **payment-service:** Postgres, Redis, `KAFKA_BROKERS`, `PAYMENT_SERVICE_PORT`, `SERVICES_HOST` / service URLs for student/course/admin.
- **chat-service:** Postgres, Mongo, Redis, `CHAT_SERVICE_PORT`.
- **analytics-service:** Postgres, Redis, `ANALYTICS_SERVICE_PORT`.
- **admin-service:** Postgres, Mongo, Redis, `KAFKA_BROKERS`, `ADMIN_SERVICE_PORT`, `COURSE_SERVICE_URL` (or `SERVICES_HOST` + port).
- **booking-service:** Postgres, Redis, `BOOKING_SERVICE_PORT`, **`TRAINER_SERVICE_URL`** (must set in ECS).
- **Workers:** `KAFKA_BROKERS`, `POSTGRES_URL`, `REDIS_URL` where used; **notification-worker:** **`NOTIFICATION_SERVICE_URL`** (required); **allocation-worker:** **`ADMIN_SERVICE_URL`**, `SERVICES_HOST`/port if needed.

### 4.2 No secrets in Dockerfiles

- No hardcoded secrets in Dockerfiles. ✅
- **docker-compose.yml** (chat-service, L344): Default `MONGO_URI` in compose env — **risk** if committed with real credentials. Ensure production uses ECS secrets/env from Secrets Manager or Parameter Store, not compose defaults.

### 4.3 ECS task definition compatibility

- All services use `process.env.*`; no assumption of compose-only injection. ✅ ECS env and secrets injection is compatible.

---

## 5. LOGGING & SIGNAL HANDLING

### 5.1 Logs to stdout/stderr

- No file-only logging found; services use shared logger (stdout). ✅

### 5.2 SIGTERM (graceful shutdown)

| Service | SIGTERM handler |
|---------|------------------|
| api-gateway | ✅ `index.ts` L67, L97 |
| student-auth-service | ✅ |
| trainer-auth-service | ✅ |
| student-service | ✅ |
| trainer-service | ✅ |
| course-service | ✅ |
| notification-service | ✅ |
| payment-service | ✅ |
| chat-service | ✅ |
| analytics-service | ✅ |
| admin-service | ✅ |
| booking-service | ✅ |
| **notification-worker** | ✅ L293 |
| **purchase-worker** | ❌ None |
| **session-worker** | ❌ None |
| **cache-worker** | ❌ None |
| **allocation-worker** | ❌ None |

**Required:** Add SIGTERM (and ideally SIGINT) handlers in purchase-worker, session-worker, cache-worker, allocation-worker so they stop consuming and exit within ECS stop timeout (e.g. 30s).

### 5.3 No background processes blocking exit

- HTTP services close server on SIGTERM then `process.exit`. Workers: only notification-worker has explicit shutdown; others rely on process exit — **may leave Kafka consumer in-flight**. Graceful shutdown in workers should close consumer and then exit.

---

## 6. STARTUP DEPENDENCIES

### 6.1 docker-compose `depends_on`

- Compose uses `depends_on` (e.g. api-gateway → kafka healthy; notification-worker → kafka-init completed, notification-service started). **Required for ECS:** Services must **not** rely on compose order. They must start and **retry** DB/Kafka/Redis until available.

### 6.2 Retry logic for DB/Kafka/Redis

- **Shared:** Redis `retryStrategy`; Kafka client retry/metadata refresh; Postgres pool “retry on next query”. ✅
- **course-service:** **Blocks** startup on `getMongoConnection()` — if MongoDB is down, process never listens. For ECS, consider starting HTTP server and returning 503 on `/ready` until Mongo is up, or retrying Mongo in background with a short delay so container stays “running” and can be health-checked on `/health`.

### 6.3 Services starting when dependencies temporarily unavailable

- Most services start and listen; dependency checks are in `/ready` or on first use. **Exception:** course-service blocks listen on Mongo. Recommendation: allow listen first, then lazy-init Mongo (already partially done) so `/health` can return 200 and ALB can mark target healthy; use `/ready` for dependency readiness.

---

## 7. IMAGE SIZE & BUILD EFFICIENCY

- **HTTP services:** Multi-stage builds (base → deps → builder → runtime); only dist + production node_modules in final image. ✅
- **Workers:** Single-stage; copy full source and run `npm run build` then prune. **Recommendation:** Use same multi-stage pattern as HTTP services (deps → builder → runtime) to reduce size and avoid dev tooling in final image.
- **.dockerignore:** Excludes `node_modules`, `dist`, tests, most docs, scripts — good. ✅
- **allocation-worker:** Copies **admin-service** and shared; build order is correct. No unnecessary files beyond that.

---

## 8. ECS & ALB COMPATIBILITY

### 8.1 Bind to 0.0.0.0

| Service | Listen call | Binding |
|---------|-------------|--------|
| api-gateway | `app.listen(port, '0.0.0.0', ...)` | ✅ Explicit |
| admin-service | `httpServer.listen(PORT, '0.0.0.0', ...)` | ✅ Explicit |
| All others | `app.listen(PORT, ...)` | ✅ Node default is all interfaces when host omitted |

So all services accept external connections. Explicit `0.0.0.0` for api-gateway and admin-service is best practice; others are fine for ECS.

### 8.2 No fixed container IP

- No code assumes fixed container IPs. ✅

### 8.3 Dynamic port (PORT env)

- All services use `getServicePortSync(..., 'XXX_PORT', default)` or equivalent. If ECS sets `PORT` (or service-specific `XXX_PORT`), they will listen on that port. ✅
- **Required:** Ensure ECS task definition **container port** matches the port the app listens on (same as env `PORT` or `XXX_PORT`). ALB target group should use this port and path `/health`.

### 8.4 HTTP server respects PORT

- Confirmed: every HTTP service reads port from env and passes to `listen`. ✅

---

## 9. docker-compose PARITY CHECK

- **Purpose:** Compose is for **local dev** (and optional local Kafka/Zookeeper/MinIO). DBs/Redis are cloud (Postgres, Mongo Atlas, Upstash).
- **Differences that could break ECS:**
  - **Service discovery:** Compose uses hostnames like `kafka:9092`, `course-service:3005`. In ECS, you must set equivalent URLs via env (e.g. `KAFKA_BROKERS`, `COURSE_SERVICE_URL`, `ADMIN_SERVICE_URL`, `NOTIFICATION_SERVICE_URL`, `TRAINER_SERVICE_URL`) or service discovery.
  - **depends_on:** ECS does not order task startup; services must retry dependencies (already partially true).
  - **env_file:** `.env.${ENV:-production}` — in ECS, provide same vars via task definition / Secrets Manager / Parameter Store.
- **Compose-only configs to move to ECS:**
  - All `environment:` entries in compose (especially `KAFKA_BROKERS`, `COURSE_SERVICE_URL`, `ADMIN_SERVICE_URL`, `NOTIFICATION_SERVICE_URL`, `TRAINER_SERVICE_URL`, `SERVICES_HOST`, and DB/Redis/Kafka URLs).
  - **chat-service:** Remove or override default `MONGO_URI` in compose for production; use only env from ECS/secrets.

---

## 10. PER-SERVICE READINESS VERDICT

| Service | Verdict | Blocking issues |
|---------|---------|------------------|
| api-gateway | READY | None (bind 0.0.0.0, /health, SIGTERM). Optional: HEALTHCHECK use PORT env. |
| student-auth-service | READY | Optional: HEALTHCHECK use PORT. |
| trainer-auth-service | READY | Optional: HEALTHCHECK use PORT. |
| student-service | READY | Optional: HEALTHCHECK use PORT. |
| trainer-service | READY | Optional: HEALTHCHECK use PORT. |
| course-service | READY | Optional: HEALTHCHECK use PORT; consider not blocking listen on Mongo. |
| notification-service | READY | Optional: HEALTHCHECK use PORT. |
| payment-service | READY | Optional: HEALTHCHECK use PORT. |
| chat-service | READY | Optional: HEALTHCHECK use PORT. Remove default MONGO_URI from compose in prod. |
| analytics-service | READY | Optional: HEALTHCHECK use PORT. |
| admin-service | READY | Optional: HEALTHCHECK use PORT. |
| booking-service | NEEDS CHANGES | Set `TRAINER_SERVICE_URL` in ECS; fix default port 3003 → 3004 in code (trainerIntegration.ts, trainerServiceClient.ts). |
| notification-worker | NEEDS CHANGES | Set `NOTIFICATION_SERVICE_URL` in ECS (no localhost). Add non-root user; add lockfile to build. |
| purchase-worker | NEEDS CHANGES | Non-root user; SIGTERM; lockfile in Dockerfile. |
| session-worker | NEEDS CHANGES | Non-root user; SIGTERM; lockfile in Dockerfile. |
| cache-worker | NEEDS CHANGES | Non-root user; SIGTERM; lockfile in Dockerfile. |
| allocation-worker | NEEDS CHANGES | Pin pnpm version; non-root user; SIGTERM. |

---

## 11. REQUIRED FIXES FOR ECS + ALB

1. **booking-service**
   - **trainerIntegration.ts** (L13) and **trainerServiceClient.ts** (L9): Change default from `'http://localhost:3003'` to `'http://localhost:3004'` (trainer-service port). In ECS, **always** set `TRAINER_SERVICE_URL` in task definition.

2. **notification-worker**
   - **index.ts** (L126–128): Do not default to `'http://localhost:3006'` when running in ECS (e.g. require `NOTIFICATION_SERVICE_URL` or `NOTIFICATION_SERVICE_INTERNAL_URL` when not in local dev). Document in env template. In ECS task definition, **always** set `NOTIFICATION_SERVICE_URL`.

3. **Workers (all 5)**
   - Add **SIGTERM** (and SIGINT) handler: stop Kafka consumer / in-flight work, then `process.exit(0)` within ~30s.
   - **Dockerfiles:** Add non-root user (e.g. `nodejs:1001`) and `USER nodejs` in runtime stage.
   - **allocation-worker Dockerfile:** Replace `pnpm@latest` with pinned version (e.g. `pnpm@8.15.0`).
   - **notification-worker, purchase-worker, session-worker, cache-worker:** Copy lockfile into image and use `npm ci` or `pnpm install --frozen-lockfile` if migrating to pnpm.

4. **Health checks**
   - **Option A (recommended):** In ECS task definition, define **health check** (path `/health`, port = container port, protocol HTTP). Rely on ECS health check; Dockerfile HEALTHCHECK can remain for local Docker.
   - **Option B:** In each service Dockerfile, make HEALTHCHECK use port from env, e.g. `ENV PORT=3000` (or appropriate default) and `CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || '3000') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"`.

5. **docker-compose**
   - Do not rely on compose for production secrets. Ensure `MONGO_URI` and other secrets come from ECS/secrets in prod; remove or override default `MONGO_URI` in compose for production use.

---

## 12. OPTIONAL IMPROVEMENTS (NON-BLOCKING)

- Use **`pnpm install --frozen-lockfile`** (or `pnpm ci`) in HTTP service Dockerfiles for reproducible builds.
- **course-service:** Start HTTP server without blocking on Mongo; use lazy init + `/ready` for dependency checks so ALB can use `/health` immediately.
- **Workers:** Convert to multi-stage Dockerfiles (deps → builder → runtime) and align with HTTP service pattern (lockfile, non-root, single CMD).
- Add **EXPOSE &lt;port&gt;** in HTTP service Dockerfiles for documentation (does not change behavior in ECS).
- Centralize required env vars in a single **env.example** or deployment doc for ECS task definitions.

---

## 13. FINAL SUMMARY

- **Is this safe for TEST deployment on ECS?** **Yes, after applying the required fixes above.**
- **Blocking:** (1) booking-service default TRAINER_SERVICE_URL port and ECS env; (2) notification-worker NOTIFICATION_SERVICE_URL in ECS and no localhost default in ECS; (3) all workers: SIGTERM + non-root + allocation-worker pnpm pin; (4) ECS health check configuration (path `/health`, correct port).
- **ALB:** Use **path `/health`** for target group health checks; do not use `/ready` so targets are not dropped when DB/Redis are temporarily slow.
- **Compose:** Treat as local-only; all production config (URLs, secrets, Kafka/DB/Redis) must come from ECS task definitions and secrets.
