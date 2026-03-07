# Architecture

**Analysis Date:** 2026-03-06

## Pattern Overview

**Overall:** Layered HTTP request pipeline with dependency-driven composition and policy-based gating for stream resolution and session management.

**Key Characteristics:**
- Request flows through sequential decision gates (CORS, auth, policy, resolution)
- Policy and integrations decoupled from routing via dependency injection
- Redis-backed session gating with atomic Lua scripts for consensus
- Multi-layered telemetry: structured events, reliability counters, hourly analytics, session snapshots
- Bounded dependency execution with retry-with-jitter for external services (D server, Redis)
- Episode URL caching with per-IP sharing limits (max 6 IPs per episode)

## Layers

**Routing:**
- Purpose: HTTP request composition, path classification, middleware orchestration
- Location: `modules/routing/`
- Contains: `http-handler.js` (entry point), `request-controls.js` (session/policy gate), `stream-route.js` (episode resolution)
- Depends on: policy, integrations, presentation, observability, analytics
- Used by: `serverless.js` (Vercel handler)

**Policy:**
- Purpose: Deterministic business rules for access control and time-based availability
- Location: `modules/policy/`
- Contains: `session-gate.js` (Redis Lua session allocation), `time-window.js` (Jerusalem timezone shutdowns), `operator-auth.js` (token validation)
- Depends on: Redis client (for atomic operations)
- Used by: `request-controls.js`

**Integrations:**
- Purpose: External service clients with bounded execution and timeout management
- Location: `modules/integrations/`
- Contains: `d-client.js` (Server D HTTP client for episode resolution), `redis-client.js` (Upstash REST wrapper), `bounded-dependency.js` (shared retry helper)
- Depends on: observability (logging)
- Used by: routing, policy, analytics

**Presentation:**
- Purpose: Response formatting and rendering
- Location: `modules/presentation/`
- Contains: `stream-payloads.js` (JSON response builders), `public-pages.js` (landing page, health check), `operator-diagnostics.js`, `quarantine-page.js`
- Depends on: nothing (pure renderers)
- Used by: routing handlers

**Analytics:**
- Purpose: Hourly event tracking, session view snapshotting, nightly rollup
- Location: `modules/analytics/`
- Contains: `hourly-tracker.js` (Redis HINCRBY/PFADD bucketing), `session-view.js` (request snapshots), `nightly-rollup.js` (daily consolidation), `daily-summary-store.js`
- Depends on: Redis client
- Used by: routing (for hourly), request-controls (for hourly)

**Observability:**
- Purpose: Cross-cutting concerns: logging, telemetry events, request correlation, metrics
- Location: `observability/`
- Contains: `logger.js` (Pino wrapper with redaction), `events.js` (event classification), `context.js` (request correlation), `metrics.js` (reliability counters), `diagnostics.js`
- Depends on: Pino (or console fallback)
- Used by: all modules

## Data Flow

**Stream Request (Core Path):**

1. `serverless.js` receives HTTP request → delegates to `createHttpHandler(req, res)`
2. `http-handler.js`:
   - Wraps request in async context via `withRequestContext()` (sets correlation ID)
   - Emits `REQUEST_START` telemetry
   - Handles OPTIONS (CORS preflight)
   - Routes to operator paths (`/operator/*`, `/admin/*`, `/quarantine`) → `operator-routes.js`
   - Routes to public paths (`/`, `/health`) → `public-pages.js`
   - Routes to Stremio paths (`/manifest.json`, `/catalog/*`, `/stream/*`) → applies request controls
3. `request-controls.js` (via `applyRequestControls()`):
   - Checks if Jerusalem timezone is in shutdown window (configurable, default 00:00-08:00)
   - If blocked: returns `{ allowed: false, reason: "blocked:shutdown_window" }`
   - Runs `runAtomicSessionGate()` via Redis Lua script to allocate session slot
     - Prunes inactive sessions (older than `INACTIVITY_LIMIT_SEC`, default 20 min)
     - Admits existing IPs or new IPs if under `MAX_SESSIONS` limit (default 2)
     - Rotates out oldest idle IP if over capacity (if outside `RECONNECT_GRACE_MS`)
   - If blocked: returns `{ allowed: false, reason: "blocked:slot_taken" }`
   - Tracks hourly analytics (requests.total, policy.admitted/blocked) via `trackHourlyEvent()`
   - Runs nightly rollup if hour >= 1 (daily quarantine reset)
4. If `applyRequestControls` allows, routes to `stream-route.js` (`handleStreamRequest()`):
   - Parses `/stream/series/{episodeId}.json` path
   - Validates episode ID supports One Piece (starts with `tt0388629`)
   - Marks client's latest episode selection (for staleness detection across concurrent requests)
   - Calls `resolveLatestStreamIntent()` to get episode URL:
     - Checks Redis `episode:share:{episodeId}` cache
     - If cache hit and IP in allowedIps: returns cached URL (status: ok)
     - If cache hit but IP not in allowedIps and capacity exists: adds IP to allowedIps (max 6) (status: ok)
     - If cache hit but capacity full: returns degraded (status: degraded, cause: blocked:capacity_busy)
     - If cache expired/miss or client selection updated: calls `resolveEpisode()` (from `d-client.js`)
       - POST `/api/resolve` to D server with episodeId
       - On success: stores URL + title + ownerIp + allowedIps in Redis cache (30 min TTL)
       - On error (timeout/unavailable): emits DEPENDENCY_FAILURE telemetry, throws
   - On resolution success: returns 200 with stream payload via `sendJson()`
   - On degraded/error: returns 200 with empty streams + notice via `sendDegradedStream()`
   - Fires background tasks (fire-and-forget):
     - `forwardUserAgent()` → POST `/api/ua` to D (silent catch)
     - Session view snapshot via `upsertSessionView()` (for operator diagnostics)
     - Hourly analytics track (stream.requests, stream.success/degraded)
5. Finally block in `http-handler.js`:
   - Records reliability counters (source, cause, result) via `incrementReliabilityCounter()`
   - Emits `REQUEST_COMPLETE` telemetry with duration and status code

**State Management:**

Redis-backed:
- `system:active_sessions` — sorted set (score = last-seen timestamp ms, members = client IP)
- `episode:share:{episodeId}` — JSON string with URL, title, ownerIp, allowedIps array (max 6), timestamps
- `analytics:hourly` — hash; field format `{bucket}|{event}|{metric}` → count/timestamp
- `analytics:unique:{bucket}` — HyperLogLog per hourly bucket for unique IP counts
- `quarantine:events` — list of last 50 stream error events (JSON: ip, episodeId, error, time)
- `stats:*` — counters (slot_taken, d_error, ua_forward_error)
- `system:reset:{dateStr}` — TTL marker for daily reset (daily once at hour 1)

In-memory:
- `inFlightStreamIntents` (Map) — deduplicates concurrent resolution requests for same episode/IP
- `latestStreamSelectionByClient` (Map) — tracks most recent episode selection per IP (5 min TTL), used to detect stale requests
- `latestStreamSelectionVersion` (counter) — version marker for staleness comparison

## Key Abstractions

**Bounded Dependency Execution:**
- Purpose: Unified retry-with-jitter and timeout handling for external services
- Examples: `d-client.js` uses it, `http-handler.js` wraps Redis commands with it
- Pattern: `executeBoundedDependency(operation, { attemptTimeoutMs, totalBudgetMs, jitterMs })`
  - Attempt 1 with attemptTimeoutMs timeout
  - On transient failure (5xx, 408, 429, ETIMEDOUT, ECANCELED): wait random jitter (0-120ms), attempt 2
  - Total execution capped at totalBudgetMs (10s for D, 1.8s for Redis)
  - Non-transient failures throw immediately
  - Returns promise that resolves to operation result or rejects with classified error

**Request Context (Correlation ID):**
- Purpose: Async-local request tracking across module boundaries
- Pattern: `withRequestContext(req, async () => { ... })` wraps handler
  - Stores correlation ID from request header or generates UUID
  - Logger automatically injects `correlationId` into all logs within context
  - Accessible via `getCorrelationId()` from any module
  - Bound to response via `bindResponseCorrelationId(res)` header

**Event Classification:**
- Purpose: Normalize error/failure sources and causes for consistent metrics aggregation
- Pattern: `classifyFailure({ error, source, cause, reason })`
  - Maps error codes/HTTP status → (source, cause) tuples
  - Sources: "policy", "d", "redis", "validation"
  - Causes: "dependency_timeout", "dependency_unavailable", "policy_shutdown", "capacity_busy", "validation_error", etc.
  - Used for: telemetry events, reliability counters, degradation policy lookup

**Session Gating (Atomic Lua):**
- Purpose: Ensure exactly N concurrent active IPs without race conditions
- Pattern: Redis Lua script `SESSION_GATE_SCRIPT` via `runAtomicSessionGate()`
  - Accepts: current IP, timestamps (now, pruneThreshold, idleThreshold), limits (maxSessions, slotTtlSec, reconnectGraceMs, rotationIdleMs)
  - Returns: `[allowed: 0|1, reason: string, rotatedIp: string, activeCount: number]`
  - Logic: atomically prune inactive, check existing/new/rotate, update sorted set score and TTL
  - Rotation priority: oldest idle IP outside grace period, then lexicographically

**Episode Share Cache:**
- Purpose: Allow multiple clients to share resolved URLs, capped at per-episode capacity
- Pattern: Redis key `episode:share:{episodeId}` with JSON payload
  - Stores: URL, title, ownerIp, allowedIps (array, max 6), createdAtMs, lastSharedAtMs
  - TTL: 30 min
  - On add: validates HTTPS URL, enforces max 6 IPs, updates lastSharedAtMs

## Entry Points

**HTTP Handler:**
- Location: `modules/routing/http-handler.js` → function `createHttpHandler(req, res)`
- Triggers: Every HTTP request (Vercel serverless invocation)
- Responsibilities: Orchestrate request flow through all decision gates, record telemetry, apply CORS

**Addon Interface:**
- Location: `addon.js` → exports addonInterface from Stremio SDK
- Triggers: Catalog and stream manifest/data requests
- Responsibilities: Catalog handler (returns One Piece meta), stream handler (delegates to stream-route handler via `resolveEpisode`)

**Serverless Entry:**
- Location: `serverless.js`
- Triggers: Vercel function invocation
- Responsibilities: Exports `createHttpHandler` for Vercel

## Error Handling

**Strategy:** Errors in non-critical paths are logged but don't block responses. Stream requests degrade to fallback (empty streams + notice). Dependencies have bounded execution with timeout protection.

**Patterns:**

1. **Critical path errors** (resolve episode, session gate):
   - Caught at route handler, trigger degraded response (200 + empty streams + notice)
   - Session view still recorded with status "degraded" or "error"
   - Hourly analytics still tracked (stream.degraded)

2. **Best-effort telemetry**:
   - Wrapped in try/catch, failures silently ignored
   - Examples: `incrementReliabilityCounter()`, `trackHourlyEvent()`, `emitEvent()`, `upsertSessionView()`
   - Never block request flow or response

3. **Dependency timeouts**:
   - D client: 5s attempt, 10s total budget
   - Redis: 900ms attempt, 1800ms total budget
   - Transient retries (5xx, 408, 429, ETIMEDOUT, ECANCELED) with random jitter only on first failure
   - Non-transient (4xx except 408, connection reset) throw immediately

4. **Operator route auth failures**:
   - Missing token: return 401 with `{ error: "unauthorized" }`
   - Invalid token: return 403 with `{ error: "forbidden" }`

5. **Redis errors**:
   - Connection missing (KV_REST_API_URL not set): throw `code: "redis_config_missing"`
   - Network/HTTP error: throw `code: "dependency_unavailable"`
   - Lua evaluation error: throw `code: "dependency_unavailable"`

## Cross-Cutting Concerns

**Logging:** Pino (JSON structured logging) with automatic redaction of sensitive headers (Authorization, X-Operator-Token, cookies). Fallback to console if Pino not available. Correlation ID injected automatically.

**Validation:** Episode ID checked against `isSupportedEpisode()` predicate (default: `id.startsWith("tt0388629")`). D response URLs must start with `https://`, titles non-empty. IPs normalized via proxy-addr for trusted proxies.

**Authentication:** `OPERATOR_TOKEN` env var checked via `handleOperatorRoute()` using Bearer token in header or query param.

**CORS:** Configurable via `CORS_ALLOW_ORIGINS`, `CORS_ALLOW_HEADERS`, `CORS_ALLOW_METHODS` env vars (defaults: empty origins, Content-Type/Authorization/X-Operator-Token headers, GET/OPTIONS methods). Preflight response includes Access-Control-Allow-* headers and Vary: Origin.

**Request Correlation:** Every request gets unique correlation ID (from X-Correlation-Id header or generated UUID), propagated through logger bindings and telemetry events for end-to-end tracing.

**Rate Limiting:** Session-based quota via Redis session gate. Max concurrent IPs configurable (default 2). TTL per session configurable (default 3600s). Rotation strategy evicts oldest idle IP if all slots taken (after reconnect grace period).

**Time Windows:** Jerusalem timezone shutdown window (default 00:00-08:00) blocks stream requests. Configurable via `SHUTDOWN_START_HOUR` / `SHUTDOWN_END_HOUR` env vars. Nightly rollup triggered when hour >= 1.

---

*Architecture analysis: 2026-03-06*
