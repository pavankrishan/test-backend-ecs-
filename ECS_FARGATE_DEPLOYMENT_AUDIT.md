# AWS ECS Fargate Deployment Readiness Audit

**Scope:** Dockerfiles (all services), AWS SDK v3, pnpm workspace handling, ECS runtime safety.  
**Node:** Root `package.json` specifies `engines.node: ">=18.0.0"`. All Dockerfiles use `node:18-alpine`.  
**Date:** 2025-01-31

---

## ✅ What is production-safe

### Dockerfiles (multi-stage services only)

- **api-gateway, student-service, trainer-service, student-auth-service, trainer-auth-service, notification-service, payment-service, chat-service, analytics-service, admin-service, booking-service, course-service:**  
  - Multi-stage (base → deps → builder → runtime) is correct.  
  - Build deps (python3, make, g++) only in `deps`; runtime image is slim.  
  - Node version: `node:18-alpine` matches root `engines.node >=18.0.0`.  
  - Non-root user: `addgroup`/`adduser` (gid/uid 1001), `chown -R nodejs:nodejs /app`, `USER nodejs`.  
  - Runtime layout: `/app/shared` (package.json + dist + node_modules prod), `/app/service` (package.json + dist + node_modules prod).  
  - Start command: `CMD ["node", "dist/index.js"]` with `WORKDIR /app/service`; all services use `main: "dist/index.js"`.  
  - HEALTHCHECK: present for HTTP services, uses `process.env.PORT`; appropriate for ECS dynamic port.

### pnpm workspace (multi-stage only)

- **shared package linking at runtime:**  
  - `sed` replaces `"@kodingcaravan/shared": "workspace:*"` with `"file:../shared"` in service `package.json`, then `npm install --omit=dev` in `/app/service` and `/app/shared`.  
  - Node resolves `@kodingcaravan/shared` to `/app/shared`; shared `package.json` exports point to `./dist/*`, so runtime resolution is correct.  
- **Build:** `pnpm --filter @kodingcaravan/shared build` then `pnpm --filter @kodingcaravan/<service> build`; shared built first, then service.  
- **Lockfile:** Multi-stage Dockerfiles copy `pnpm-lock.yaml` and use `pnpm install` (no `--frozen-lockfile` in notification-service; see warnings).

### AWS SDK v3

- **shared** uses `@aws-sdk/client-eventbridge`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (^3.975.0).  
- AWS SDK v3 supports Node 14+; Node 18 is compatible. No engine change required.  
- EventBridge/S3 clients are created with `process.env.AWS_REGION`; no eager throw at module load.  
- s3Client throws only when `getClient()` or upload is used without creds; not a startup crash.

### ECS runtime safety (multi-stage services)

- Non-root user used.  
- `dist` and `package.json` are copied from builder; no reliance on host paths.  
- Container start is `node dist/index.js`; no shell or fragile entrypoint.  
- Env loading: `global-env` uses `findEnvPath(process.cwd())`; in ECS there is no `.env` file (correct; use task definition env). No validation at import time; `validateRequiredEnvVars()` is opt-in from entrypoints.

### allocation-worker (single-stage, pnpm)

- Uses pnpm, copies `pnpm-workspace.yaml` and `pnpm-lock.yaml`, builds shared → admin-service → allocation-worker, then manual `@kodingcaravan/shared` layout in `node_modules`.  
- Dynamic import `../../admin-service/dist/services/allocation.service` is resolved relative to the **executing file** (`dist/index.js`), so path resolves to `/app/services/admin-service/dist/...`; admin-service is present and built in the same image.  
- No HEALTHCHECK (worker); CMD and WORKDIR are correct.

---

## ⚠️ What will likely break only in ECS runtime

### notification-service: lockfile not frozen

- **Where:** `services/notification-service/Dockerfile` (deps stage): `RUN pnpm install` (comment says lockfile can be updated for e.g. firebase-admin).  
- **Risk:** Build can install different versions than `pnpm-lock.yaml`; ECS runs may differ from local/CI.  
- **Recommendation:** Use `pnpm install --frozen-lockfile` and manage firebase-admin in lockfile; or accept controlled drift and document it.

### HEALTHCHECK vs ECS task health

- Docker HEALTHCHECK is not used by ECS for task health. ECS uses the task definition’s **healthCheck** (and ALB target group health).  
- If the task definition does not define a health check, or uses a different path/port, containers may be marked unhealthy or not receive traffic even though Docker HEALTHCHECK passes.  
- **Action:** Ensure ECS service/task definition and ALB (if any) health checks match the app (e.g. `GET /health`, correct PORT).

### Workers: no HTTP health

- **session-worker, notification-worker, purchase-worker, cache-worker, allocation-worker:** No `/health` endpoint; no Docker HEALTHCHECK.  
- ECS should not use an HTTP health check for these; use log-based, no health check, or a custom check that matches the worker’s lifecycle.

### Env vars at runtime

- `shared/config/global-env.ts`: `validateRequiredEnvVars()` requires `NODE_ENV`, `JWT_SECRET`, and (for cloud) one of `POSTGRES_URL`/`POSTGRES_URI`/`DATABASE_URL`.  
- If any service calls this at startup and ECS task definition omits these, the task will exit. Ensure every task definition sets the required env for that service.

---

## ❌ What must be fixed before deploying

### 1. Four workers use npm and wrong layout (session-worker, notification-worker, purchase-worker, cache-worker)

- **Where:**  
  - `services/session-worker/Dockerfile`  
  - `services/notification-worker/Dockerfile`  
  - `services/purchase-worker/Dockerfile`  
  - `services/cache-worker/Dockerfile`  

- **Problems:**  
  - `COPY package*.json ./` — repo root has **no** `package-lock.json` (monorepo uses **pnpm** and `pnpm-lock.yaml`). Only root `package.json` is copied; npm then generates a new lockfile and installs, so **dependency versions can differ from pnpm-lock.yaml** (drift, possible runtime breaks).  
  - They use `npm install --legacy-peer-deps` and `npm prune --production` at root. Root `package.json` has `workspaces: ["shared", "services/*"]`; npm workspaces behave differently from pnpm; shared and worker deps may not resolve the same way as in the rest of the repo.  
  - Workers import `@kodingcaravan/shared` and `@kodingcaravan/shared/worker`; at runtime Node must resolve these from `/app/shared` (or equivalent). With npm hoisting and no pnpm lockfile, resolution can be wrong or brittle in ECS.

- **Required fix:**  
  - Align these four Dockerfiles with the rest of the monorepo: use **pnpm**, copy **pnpm-lock.yaml** and **pnpm-workspace.yaml**, and follow the same pattern as **allocation-worker** (or the multi-stage pattern: deps → builder → runtime with shared dist + service dist and `file:../shared` at runtime).  
  - Do **not** rely on root `package-lock.json` (it does not exist) or npm workspaces for these workers.

### 2. Node version consistency (recommendation, not a hard failure)

- Root and Dockerfiles use **Node 18**.  
- No `engines` in shared or individual services; they rely on root.  
- **Recommendation:** Pin explicitly in shared and in critical services, e.g. `"engines": { "node": ">=18.0.0 <21" }`, and keep Dockerfiles on `node:18-alpine` (or match engines exactly, e.g. `node:20-alpine` if you standardize on 20).  
- No change **required** for current ECS deploy if you stay on Node 18.

### 3. Explicit engines for AWS SDK / runtime (optional)

- shared uses AWS SDK v3; Node 18 is sufficient.  
- No code changes needed for SDK; if you add `engines` in shared, use `"node": ">=18.0.0"` to document the minimum.

---

## Summary table

| Area                         | Status | Notes |
|-----------------------------|--------|--------|
| Multi-stage Dockerfiles     | ✅     | 12 services; correct stages, non-root, CMD, HEALTHCHECK. |
| allocation-worker Dockerfile| ✅     | pnpm, shared + admin-service; runtime path for dynamic import is correct. |
| session/notification/purchase/cache workers | ❌ | Use npm and no pnpm lockfile; must switch to pnpm and same layout as rest of repo. |
| Node 18                     | ✅     | Matches root engines; no change required for deploy. |
| AWS SDK v3                  | ✅     | Node 18 compatible; no runtime crash risk from SDK. |
| shared linking at runtime   | ✅     | Multi-stage: file:../shared + npm install; allocation-worker: manual copy into node_modules. |
| ECS health                  | ⚠️     | Rely on task definition healthCheck, not only Docker HEALTHCHECK. |
| notification-service lockfile | ⚠️   | Prefer `pnpm install --frozen-lockfile` for reproducible builds. |

---

## Checklist before first ECS deploy

1. **Fix the four worker Dockerfiles** (session-worker, notification-worker, purchase-worker, cache-worker) to use pnpm and pnpm-lock.yaml (same pattern as allocation-worker or multi-stage services).  
2. Ensure ECS task definitions set **NODE_ENV**, **JWT_SECRET**, and DB URL (or equivalent) where required; and that no service calls `validateRequiredEnvVars()` without those being set.  
3. Configure ECS health checks (and ALB if used) to match app (e.g. `/health`, correct PORT).  
4. (Optional) Use `pnpm install --frozen-lockfile` in all Dockerfiles, including notification-service, for reproducible builds.
