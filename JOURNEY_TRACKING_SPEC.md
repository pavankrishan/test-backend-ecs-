# Journey-Based Live Tracking – Spec & Implementation

**Status:** Implemented  
**Rules:** Tracking bound to `journeyId` only; no polling; no DB on location hot path; Redis TTL 120s; WebSocket by journeyId + role; no background tracking when journey inactive.

---

## 1. Schema (PostgreSQL)

### Tables

- **allocations**  
  Mapped to existing `trainer_allocations`: 30-day allocation per student.

- **allocation_trainers**  
  Links allocation ↔ trainer with substitutes:
  - `allocation_id`, `trainer_id`, `role` ('primary' | 'substitute'), `effective_from`, `effective_to`.

- **journeys**  
  One row per session per “trip”, bound to exactly one trainer:
  - `id`, `session_id`, `trainer_id`, `student_id`
  - `status`: `created` → `active` → `completed` | `cancelled`
  - `started_at`, `ended_at`, `end_reason` ('arrived' | 'cancelled' | 'timeout' | 'trainer_replaced')
  - **Constraint:** At most one ACTIVE journey per session (unique partial index on `session_id` WHERE `status = 'active'`).

Reschedule does **not** create a journey. Substitute trainer creates a **new** journey for the same session.

**Migrations:** `migrations/023-journeys-and-allocation-trainers.sql`, `migrations/024-journeys-one-active-per-session.sql`  
**Bootstrap:** `admin-service` `ensureJourneyTables()` creates tables and the unique partial index if missing (after sessions and trainer_allocations).

---

## 2. Backend APIs

Base path: `/api/v1/admin`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sessions/:sessionId/active-journey` | Student or Trainer (must own session) | Returns `{ journeyId: string \| null }` when the session has an active journey. Use to obtain `journeyId` for WebSocket subscribe or GET live. |
| GET | `/sessions/:sessionId/journey-status` | Student or Trainer (must own session) | Returns **derived** trainer live-location status: `{ status: 'NOT_STARTED' \| 'ON_THE_WAY' \| 'ARRIVED' \| 'ENDED' }`. Session-scoped; not stored; use to show live map only when `ON_THE_WAY`. |
| POST | `/journeys/start` | Trainer | Body: `{ sessionId }`. Creates journey, sets Redis, returns `journeyId`. |
| POST | `/journeys/:journeyId/location` | Trainer | Body: `{ sequence, latitude, longitude, accuracy?, speed?, heading? }`. Hot path: Redis only; trainer ownership and sequence validated. |
| POST | `/journeys/:journeyId/end` | Trainer | End journey (e.g. cancel). Clears Redis, updates DB. |
| POST | `/journeys/:journeyId/arrived` | Trainer | Validates distance to student location, then ends journey with reason `arrived`. |
| GET | `/journeys/:journeyId/live` | Student | Returns live location for journey (Redis only). |

- **Ownership:** Trainer must own the journey (validated in Redis for location; DB only for start/end/arrived).
- **Sequence:** Location updates must have `sequence` strictly greater than last accepted; stale sequences rejected (409).

**Trainer live-location status (student view):** Derived, session-scoped enum. **NOT** raw location, **NOT** user-level presence.
- `NOT_STARTED` – no journey exists for session.
- `ON_THE_WAY` – active journey exists (only state where live map/WebSocket is used).
- `ARRIVED` – last journey ended with `end_reason = 'arrived'`.
- `ENDED` – last journey exists but ended (completed/cancelled, not arrived).
Logic: if active journey → `ON_THE_WAY`; else if last journey end_reason arrived → `ARRIVED`; else if last journey exists → `ENDED`; else `NOT_STARTED`. UI shows live map **only** for `ON_THE_WAY`; no GPS or WebSocket for other states.

---

## 3. Redis

- **Key:** `live:journey:{journeyId}`
- **TTL:** 120 seconds (refreshed on each location update).
- **Value (JSON):** `journeyId`, `sessionId`, `trainerId`, `studentId`, `sequence`, `location?`, `startedAt`.
- **Channels (Pub/Sub):**
  - `journey:updates` – payload: `{ journeyId, location, sequence, timestamp }` (for WebSocket).
  - `journey:ended` – payload: `{ journeyId, endedAt }` (for WebSocket auto-close).

Stale sequence updates are rejected. No DB read on location hot path.

---

## 4. WebSocket Flow

- **Student:** Subscribes by `journeyId`:
  - Obtain `journeyId`: call **GET /sessions/:sessionId/active-journey** (or from session details). When `journeyId` is non-null, open WebSocket and emit `subscribe:journey` with `{ journeyId }`.
  - Server checks `live:journey:{journeyId}` in Redis; verifies `studentId === socket.user.id`; joins socket to room `journey:{journeyId}`.
  - Receives `journey:location` and `journey:ended` in that room. Map loads once; only marker updates (no polling).
- **Trainer:** Does **not** subscribe (trainer only sends location via HTTP).
- **Auto-close:** On `journey:ended`, server emits `journey:ended` to room; client should stop subscription and clear UI.

---

## 5. Expo (Trainer App) – Location Logic

- **Start Journey:** `POST /journeys/start` with `sessionId` → store `journeyId`, start GPS.
- **End Journey:** `POST /journeys/:journeyId/end` → stop GPS **immediately** (no further location sends).
- **Location updates:** `POST /journeys/:journeyId/location` with `sequence` (monotonic) and coords.
- **Intervals:** Foreground ~3s, background ~10–15s (via `AppState` and `timeInterval` in `watchPositionAsync`).
- **Sequence:** Local counter incremented per update; backend rejects non-increasing sequences.
- **Arrived:** When within 150m, call `POST /journeys/:journeyId/arrived`; then stop tracking.

No tracking outside an active journey; no reuse of `journeyId`; do not trust cached trainer state for ownership.

---

## 6. Failure Handling

| Scenario | Handling |
|----------|----------|
| **Trainer replacement mid-allocation** | Old trainer’s journey is ended (or not started). New trainer starts a **new** journey. Redis key for old journey TTLs or is deleted; old trainer’s location calls get 403/410. |
| **App killed mid-journey** | Redis key expires in 120s if no updates. No background tracking when journey inactive. On reopen, trainer must start a new journey if needed. |
| **Network reconnect** | Client resends location with next sequence. Backend accepts if sequence > last; no DB on hot path. |
| **Redis outage** | Start journey / location update can return 503; client retries. End journey still updates DB and publishes `journey:ended` if Redis publish fails (best-effort). |

---

## 7. Cleanup Guarantees

- **Redis:** All keys `live:journey:{journeyId}` have TTL 120s; no permanent live keys.
- **Journey end:** On end (arrived/cancel/timeout/replace): Redis key deleted, DB status set, `journey:ended` published.
- **WebSocket:** Student leaves room on `journey:ended`; trainer never subscribes.
- **No polling:** Student gets updates via WebSocket (or single GET) by `journeyId`; no session-based polling.
- **OS-safe:** No background tracking when journey is not active; foreground/background intervals are explicit and bounded.

---

## Files Touched

- **Backend:**  
  `migrations/023-journeys-and-allocation-trainers.sql`,  
  `migrations/024-journeys-one-active-per-session.sql`,  
  `services/admin-service/src/models/journey.model.ts` (getLastBySessionId for journey-status),  
  `services/admin-service/src/services/journey.service.ts`,  
  `services/admin-service/src/controllers/journey.controller.ts`,  
  `services/admin-service/src/routes/journey.routes.ts`,  
  `services/admin-service/src/routes/session.routes.ts` (GET /sessions/:sessionId/active-journey, GET /sessions/:sessionId/journey-status),
  `services/admin-service/src/config/database.ts` (ensureJourneyTables + unique partial index),
  `services/api-gateway/src/websocket/eventServer.ts` (subscribe by journeyId, journey:updates/ended).

- **Expo:**  
  `services/api/session.ts` (journeyId-based APIs, getActiveJourneyForSession, getJourneyStatus + JourneyStatusEnum),  
  `components/TrainerTravelTracker.tsx` (journeyId, sequence, foreground/background intervals),  
  `components/StudentTrainerLocationMap.tsx` (getActiveJourneyForSession + WebSocket subscribe:journey),  
  `app/(trainer)/session/[id]/journey.tsx` (store and pass `journeyId`),  
  `app/(student)/session/[id].tsx` (getJourneyStatus; live map only when ON_THE_WAY),  
  `app/(student)/trainer-location/[trainerId].tsx` (getJourneyStatus; live map only when ON_THE_WAY).

---

## 8. Legacy / Removed (Student Tracking)

- **Student live tracking is journey-only.** Do not use user-level live location APIs or socket events for tracking.
- **Removed / not used for student tracking:**
  - `GET /location-tracking/live` (by userId) — not used for journey tracking; journey uses `GET /journeys/:journeyId/live` and WebSocket.
  - Socket events `trainerTravelStarted`, `trainerTravelStopped`, `location_{trainerId}` — not emitted by backend; students use `subscribe:journey` + `journey:location` / `journey:ended`.
- **Student flow:** Get `journeyId` via `GET /sessions/:sessionId/active-journey` (or session details); open WebSocket when tracking screen is open; subscribe with `journeyId`; map loads once, marker updates from WebSocket only (no polling).

---

## 9. Audit / Production Sign-Off

- **Student tracking is journey-only.** No `getLiveLocation(userId)`, no trainerId-based tracking, no user-level socket events for student→trainer tracking.
- **Trainer live-location status (student view):** Derived, session-scoped enum (`NOT_STARTED` \| `ON_THE_WAY` \| `ARRIVED` \| `ENDED`). Live map and WebSocket are used **only** when status is `ON_THE_WAY`; no GPS or WebSocket for other states.
- **JourneyId resolution (mobile):** `getActiveJourneyForSession(sessionId)` is used only to obtain `journeyId`. Polling is **bounded**: max 30 polls (every 10s) = 5 minutes; interval is cleared as soon as `journeyId` is returned or the bound is reached. No polling for live location updates.
- **WebSocket subscribe:** `subscribe:journey` validates Redis key `live:journey:{journeyId}` exists and `journey.studentId === socket.user.id`; on failure emits `subscribe:journey:error`. Students receive `journey:location` and `journey:ended` only.
- **Redis:** Key `live:journey:{journeyId}`, TTL 120s (refreshed on each location update). No GPS history in Redis.
- **Cleanup:** On `journey:ended` client stops tracking and clears state; on map unmount client unsubscribes and removes listeners. Trainer stops GPS on journey end or 401/403/409 from location API.
- **Security:** Ownership and studentId checks are enforced server-side (Redis + WebSocket); no reliance on frontend state for auth.
