# Architecture

**Analysis Date:** 2026-02-28

## Pattern Overview

**Overall:** Modular serverless streaming addon with layered request handling, policy gates, and bounded dependency integration.

**Key Characteristics:**
- Request flow orchestration through routing layer with early exit paths
- Policy-driven admission gates (session capacity, time windows) before processing
- Dependency resilience through bounded operation timeouts and retry logic
- Observability instrumented throughout request lifecycle (context, events, metrics)
- Hybrid state model: Redis for distributed sessions/analytics, in-memory for client session tracking
- Async dependency handling with graceful degradation on failures

## Layers

**Routing Layer:**
- Purpose: HTTP request classification, route dispatch, request/response lifecycle management
- Location: `modules/routing/`
- Contains: HTTP handler factory, route classifiers, stream/operator/public route dispatchers
- Depends on: Policy gates, integrations, presentation, observability
- Used by: Serverless entrypoint (`serverless.js`)

**Policy Layer:**
- Purpose: Business rule evaluation (shutdown windows, session quotas, time-based decisions)
- Location: `modules/policy/`
- Contains: Time window decisions (Jerusalem timezone), atomic session gates (Redis Lua scripts), operator authentication
- Depends on: Redis for shared state, observability for telemetry
- Used by: Request controls (routing layer)

**Integration Layer:**
- Purpose: External dependency abstraction and resilience (Redis, broker service)
- Location: `modules/integrations/`
- Contains: Redis HTTP client with bounded timeouts, broker episode resolver
- Depends on: Node fetch API, observability for error classification
- Used by: Routing, policy, analytics

**Presentation Layer:**
- Purpose: Response payload formatting and HTML rendering
- Location: `modules/presentation/`
- Contains: Stream JSON payloads, landing/health pages, operator diagnostics, quarantine event viewer
- Depends on: Policy output for degradation rules, observability for failure classification
- Used by: Routing handlers (stream, operator, public routes)

**Observability Layer:**
- Purpose: Request context propagation, event emission, metrics aggregation
- Location: `observability/`
- Contains: AsyncLocalStorage context binding, event classification, structured logging, reliability counters, metrics
- Depends on: Pino logger, Node built-ins
- Used by: All layers for telemetry and context binding

**Analytics Layer:**
- Purpose: Session tracking, hourly event aggregation, nightly rollup to daily summaries
- Location: `modules/analytics/`
- Contains: Session view snapshots (IP + user-agent hash), hourly metric tracking, daily summary consolidation
- Depends on: Redis for distributed storage, observability for event tracking
- Used by: Routing (stream/policy handlers), operator routes

**Addon Interface Layer:**
- Purpose: Stremio SDK integration for catalog and stream resolution
- Location: `addon.js`
- Contains: Manifest definition, catalog handler stub, stream handler with broker resolution
- Depends on: Broker client for episode resolution
- Used by: Routing layer for stream payload generation

## Data Flow

**Request Intake & Classification:**

1. HTTP request arrives → `createHttpHandler` in `modules/routing/http-handler.js`
2. Request context established (correlation ID via AsyncLocalStorage)
3. Pathname classified into route type: `operator`, `stremio`, or `public`
4. CORS preflight handled early for OPTIONS requests
5. Route-specific handlers invoked with classified metadata

**Policy Gate Flow (Stream Requests):**

1. `applyRequestControls` in `modules/routing/request-controls.js` evaluates request
2. Time window check: Jerusalem timezone window via `modules/policy/time-window.js` → blocks 0-8 UTC hours
3. Session gate check: Redis Lua script in `modules/policy/session-gate.js` manages capacity quota
   - Evaluates based on client IP, max session count (configurable)
   - Returns decision: admitted (new/existing/rotated) or blocked
4. If blocked → degraded response or 503 error (based on route)
5. If allowed → proceeds to route handler with client IP resolved

**Stream Resolution Flow:**

1. `handleStreamRequest` in `modules/routing/stream-route.js` extracts episode ID
2. Client's latest episode selection tracked in-memory for staleness detection
3. `resolveStreamIntent` checks Redis cache for episode share (per-IP sharing limits)
4. Cache hit → returns stored URL with TTL check
5. Cache miss → calls broker via `modules/integrations/broker-client.js`
   - Bounded dependency: 60s total budget, 60s attempt timeout, retries on transient failures
   - Response validation: URL must be HTTPS, title extracted from filename
6. On success → stores in Redis share key, session view recorded, hourly event tracked
7. On failure → degraded stream returned (empty payload or fallback video)

**Operator Route Flow:**

1. `handleOperatorRoute` in `modules/routing/operator-routes.js` routes operator-prefixed paths
2. Token authentication via `modules/policy/operator-auth.js`
3. Route-specific handlers:
   - `/health/details`: Redis PING + reliability summary
   - `/operator/metrics`: Reliability counter projection
   - `/operator/analytics`: Current hour snapshot + active sessions + latest daily summary
   - `/operator/rollup/nightly`: Manual trigger for daily rollup job
   - `/quarantine`: HTML page with error events and stats

**Analytics Tracking:**

1. Hourly event tracking: `trackHourlyEvent` in `modules/analytics/hourly-tracker.js`
   - Field names: `requests.total`, `policy.admitted`, `policy.blocked`, `stream.requests`, `stream.success`, `stream.degraded`
   - Stored as Redis hash with bucket key `YYYY-MM-DD-HH|fieldname|metric`
   - Metrics: count, first_seen, last_seen timestamps
2. Session views: `upsertSessionView` in `modules/analytics/session-view.js`
   - Snapshot of IP + user-agent + episode + resolved URL + status
   - Stored as JSON in Redis with TTL
   - Active index tracks via sorted set score (timestamp)
3. Nightly rollup: `runNightlyRollup` in `modules/analytics/nightly-rollup.js`
   - Triggered during shutdown window (after 0 UTC hour)
   - Aggregates hourly data into daily summary

**State Management:**

- **Distributed State (Redis):**
  - `system:active_sessions` (sorted set): IP tracking for session quota, scored by last-seen timestamp
  - `episode:share:{episodeId}` (JSON): Per-episode sharing ledger, allowed IPs list (max 6)
  - `sessions:view:{sessionId}` (JSON): Session snapshots with TTL
  - `analytics:hourly` (hash): Hourly aggregated metrics by field
  - `daily:summary:{YYYY-MM-DD}` (JSON): Nightly rollup of daily totals
  - `quarantine:events` (list): Error event log (max 50 entries)
  - `stats:*`: Counters for slot_taken, broker_error, etc.

- **In-Memory State:**
  - `inFlightStreamIntents` (Map): Deduplication of concurrent episode resolutions
  - `latestStreamSelectionByClient` (Map): Per-IP episode selection tracking (5min TTL)

## Key Abstractions

**Bounded Dependency:**
- Purpose: Timeout and retry resilience for external service calls
- Examples: `modules/integrations/redis-client.js`, `modules/integrations/broker-client.js`
- Pattern: Promise-based operation wrapper with total budget, per-attempt timeout, jitter-backoff retry
- Used for: Broker HTTP calls (60s), Redis commands (1.8s)

**Session Gate (Atomic):**
- Purpose: Distributed quota enforcement without race conditions
- Examples: `modules/policy/session-gate.js` (Redis Lua script)
- Pattern: Single atomic `EVAL` call manages sorted set mutations
- Returns: Admission decision + reason (admitted:existing/new/rotated, blocked:slot_taken)

**Request Context:**
- Purpose: Correlation ID propagation without threading through call stacks
- Examples: `observability/context.js` (AsyncLocalStorage)
- Pattern: Extract from request header or generate UUID, bind to async context
- Used by: Event emission, response headers, logging

**Failure Classification:**
- Purpose: Normalize error sources and causes for metrics aggregation
- Examples: `observability/events.js` (classifyFailure function)
- Pattern: Map error codes/HTTP status to structured (source, cause) tuple
- Sources: broker, redis, policy, validation
- Causes: dependency_timeout, dependency_unavailable, capacity_busy, policy_shutdown, validation_error, etc.

**Degradation Policy:**
- Purpose: Graceful fallback responses based on failure type
- Examples: `modules/presentation/stream-payloads.js` (DEGRADED_STREAM_POLICY in http-handler.js)
- Pattern: Map (source, cause) to response mode: "empty" (no streams) or "fallback" (test video)
- Returns: JSON with notice or fallback stream object

## Entry Points

**Serverless Function:**
- Location: `serverless.js`
- Triggers: HTTP request to function endpoint
- Responsibilities: Exports `createHttpHandler` for cold-start handler invocation

**HTTP Handler:**
- Location: `modules/routing/http-handler.js` → `createHttpHandler(req, res)`
- Triggers: Each HTTP request from serverless runtime
- Responsibilities:
  - Bind request context and correlation ID
  - Emit telemetry for request lifecycle
  - Route to operator/public/stremio handlers
  - Record reliability metrics
  - Apply CORS headers

**Stream Handler:**
- Location: `modules/routing/stream-route.js` → `handleStreamRequest(input, injected)`
- Triggers: Pathname matches `/stream/*/` pattern
- Responsibilities:
  - Parse episode ID from URL
  - Manage client selection staleness
  - Resolve episode via broker (with caching)
  - Track session view and hourly analytics
  - Return formatted stream payload or degraded response

**Operator Handler:**
- Location: `modules/routing/operator-routes.js` → `handleOperatorRoute(input, injected)`
- Triggers: Pathname matches `/operator/`, `/admin/`, `/health/`, `/quarantine`
- Responsibilities:
  - Authenticate operator token
  - Project health, metrics, analytics, quarantine data
  - Trigger nightly rollup

**Request Controls:**
- Location: `modules/routing/request-controls.js` → `applyRequestControls(input, injected)`
- Triggers: All gatable routes (stream requests and some catalog)
- Responsibilities:
  - Evaluate time window policy
  - Run atomic session gate
  - Emit policy decision telemetry
  - Return allowed/blocked decision with IP

## Error Handling

**Strategy:** Fail-open for operator routes with telemetry, fail-graceful for stream requests (degraded responses), fail-closed for public API (503).

**Patterns:**

- **Bounded Dependency Errors:**
  - Transient (408, 429, 5xx, ETIMEDOUT, ECANCELED): Retry once with jitter
  - Non-transient: Throw immediately
  - Timeout: Throw with `code: "dependency_timeout"`

- **Redis Command Errors:**
  - Connection/configuration missing: Throw with `code: "redis_config_missing"`
  - HTTP error: Throw with `code: "redis_http_error"`, statusCode property
  - Response error: Throw with `code: "redis_response_error"`
  - Best-effort paths (analytics, metrics, session views): Catch and continue

- **Stream Resolution Errors:**
  - Cache full (6 IPs): Return `status: "degraded"` with `cause: "blocked:capacity_busy"`
  - Broker error: Catch, emit failure event, return degraded response
  - Validation error (non-HTTPS URL): Return degraded with `cause: "validation_invalid_stream_url"`

- **Policy Gate Errors:**
  - Blocked by time window: Return `allowed: false`, emit POLICY_DECISION event
  - Blocked by session quota: Return `allowed: false` with `reason: "blocked:slot_taken"`

## Cross-Cutting Concerns

**Logging:** Pino logger via `observability/logger.js`
- Structured JSON output
- Component field added per logger instance
- INFO level for events, ERROR level for failures

**Validation:** Input normalization in handlers
- Episode ID decoding and validation
- IP normalization for dedupe/routing
- Header parsing (CORS, authorization)
- URL validation (HTTPS enforcement for streams)

**Authentication:** Token-based operator access
- Token passed via `X-Operator-Token` header
- Simple equality check against `OPERATOR_TOKEN` env var
- Missing token → 401, invalid token → 403

**Rate Limiting:** Session-based quota gate
- Max concurrent sessions per process (configurable, default 2)
- TTL per session (configurable, default 3600s)
- Rotation strategy: evict oldest idle session if all slots full
- Grace period before rotation (configurable, default 15s)

**Time-Based Routing:** Jerusalem timezone shutdown window
- Daily window 0-8 UTC (configurable via env: `SHUTDOWN_START_HOUR`, `SHUTDOWN_END_HOUR`)
- Applied to stream requests only
- Nightly maintenance (rollup) triggered during window

---

*Architecture analysis: 2026-02-28*
