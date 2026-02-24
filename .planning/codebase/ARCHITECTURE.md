# Architecture

**Analysis Date:** 2026-02-25

## Pattern Overview

**Overall:** Modular serverless adapter with 6 explicit boundary layers around a Stremio addon interface

**Key Characteristics:**
- `serverless.js` is a thin Vercel adapter — it imports `createHttpHandler` from `modules/routing/http-handler.js` and exports it.
- All routing, policy enforcement, integrations, analytics, and presentation live under `modules/` with strict import-direction rules documented in `modules/BOUNDARIES.md`.
- Cross-cutting concerns (logging, metrics, correlation IDs) are centralized in `observability/`.
- Redis is the only shared state store; process memory holds only in-flight deduplication maps.

## Layers

**HTTP Entry / Transport Layer:**
- Purpose: Compose the request lifecycle — CORS, route dispatch, telemetry, reliability counters.
- Location: `modules/routing/http-handler.js`
- Contains: `createHttpHandler`, `applyCors`, `handlePreflight`, `executeBoundedDependency`, `recordReliabilityOutcome`, `buildStreamRouteDependencies`.
- Depends on: All other `modules/` boundaries and `observability/`.
- Used by: `serverless.js` (Vercel runtime entry).

**Policy Layer:**
- Purpose: Deterministic rule evaluation — time windows, session admission, operator authentication.
- Location: `modules/policy/`
- Contains:
  - `session-gate.js` — Lua script (`SESSION_GATE_SCRIPT`) atomically manages `system:active_sessions` ZSET (admit existing, admit new, rotate idle, or block).
  - `time-window.js` — Jerusalem-timezone shutdown window logic.
  - `operator-auth.js` — Bearer token validation for operator routes.
- No direct Redis client; receives `redisEval` / `redisCommand` as injected dependencies.

**Integration Layer:**
- Purpose: External dependency clients — Redis REST and broker HTTP.
- Location: `modules/integrations/`
- Contains:
  - `redis-client.js` — Upstash REST transport wrapper.
  - `broker-client.js` — Broker `/api/resolve` HTTP client with `executeBoundedDependency` retry.
- No presentation or routing imports.

**Analytics Layer:**
- Purpose: Event counting, session view tracking, nightly rollup.
- Location: `modules/analytics/`
- Contains:
  - `hourly-tracker.js` — Increments hourly analytics hash fields (`analytics:hourly`).
  - `session-view.js` — Writes per-session episode view snapshots to Redis sorted set.
  - `nightly-rollup.js` — Aggregates prior-day hourly fields into `daily:summary` hash with distributed lock.
  - `daily-summary-store.js` — HSET writer for daily summary records.

**Presentation Layer:**
- Purpose: Response shaping and HTML rendering.
- Location: `modules/presentation/`
- Contains:
  - `stream-payloads.js` — `formatStream`, `sendDegradedStream`.
  - `quarantine-page.js` — Operator diagnostic HTML table (IPs redacted, errors sanitized).
  - `public-pages.js` — Landing page HTML, `/health` JSON projection.
  - `operator-diagnostics.js` — Detailed diagnostics for `/health/details`.
- No service client imports.

**Observability Layer:**
- Purpose: Structured logging, event classification, metrics, correlation IDs.
- Location: `observability/`
- Contains:
  - `context.js` — `withRequestContext` / `getCorrelationId` via AsyncLocalStorage.
  - `events.js` — `EVENTS` enum, `classifyFailure`, `emitEvent` (pino sink).
  - `logger.js` — Pino factory with component tagging.
  - `metrics.js` — `incrementReliabilityCounter` / `readReliabilitySummary` (Redis hash `stats:reliability:counters`).
  - `diagnostics.js` — Operator diagnostics aggregation.

**Routing Orchestration:**
- Location: `modules/routing/`
- Contains:
  - `http-handler.js` — Top-level request lifecycle composition.
  - `stream-route.js` — Episode share cache check, broker resolution, `handleStreamRequest`.
  - `request-controls.js` — Shutdown-window check, daily reset, atomic session gate, analytics.
  - `operator-routes.js` — `/quarantine`, `/health/details`, `/operator/*` dispatch.

## Data Flow

**Stream Request Flow (`/stream/series/:episodeId.json`):**

1. Vercel → `serverless.js` → `createHttpHandler` in `modules/routing/http-handler.js`.
2. `withRequestContext` binds a correlation ID via AsyncLocalStorage.
3. CORS preflight handled; operator route checked (auth-gated); public route (`/`, `/health`) checked.
4. `applyRequestControls` runs:
   - Jerusalem time-window check via `modules/policy/time-window.js`.
   - Nightly rollup triggered for previous day if inside shutdown window.
   - Lua atomic session gate (`runAtomicSessionGate`) via `modules/policy/session-gate.js`.
   - If blocked → `sendDegradedStream` with policy cause.
5. `handleStreamRequest` in `modules/routing/stream-route.js`:
   - Reads episode share cache (`GET episode:share:{episodeId}`).
   - Cache hit (IP already allowed): returns cached URL immediately.
   - Cache hit (new IP, slot available): adds IP to share, writes back with remaining TTL.
   - Cache miss: calls `resolveEpisode` → `addon.js` → broker `/api/resolve` (via `executeBoundedDependency`).
   - Validates URL (HTTPS-only); writes new share entry (`SET episode:share:{id} ... EX 1800`).
6. `upsertSessionView` writes per-session episode view to `sessions:view:active` ZSET.
7. `trackHourlyEvent` increments hourly analytics hash fields.
8. `recordReliabilityOutcome` writes bounded-dimension counter to `stats:reliability:counters`.
9. Response: `{ streams: [{ url, title, name }] }`.

**Policy-Blocked Flow:**
- Time window block → `sendDegradedStream` with `policy_shutdown` cause.
- Slot taken → `sendDegradedStream` with `capacity_busy` cause.
- Degraded stream: either empty `{ streams: [] }` or fallback test video, based on `DEGRADED_STREAM_POLICY`.

**Catalog / Manifest Flow:**
1. Non-intercepted Stremio routes fall through to `runtimeRouter` (stremio-addon-sdk).
2. SDK router invokes handlers defined in `addon.js` (`defineCatalogHandler`, `defineStreamHandler`).

**Operational Endpoints:**
- `/health` — Redis PING, JSON status (public, no auth).
- `/health/details` — Reliability summary from Redis hash (operator-auth required).
- `/quarantine` — Last 50 error events from Redis list (operator-auth required).
- `/operator/reliability` — Reliability counters via `readReliabilitySummary`.

## Key Abstractions

**`executeBoundedDependency`:**
- Purpose: 2-attempt retry with per-attempt timeout and jitter within a total budget.
- Location: `modules/routing/http-handler.js:94` (for Redis), `modules/integrations/broker-client.js:27` (for broker).
- Pattern: `operation({ timeout })` → catches transient errors → sleeps jitter → retries once.

**Atomic Session Gate (Lua):**
- Purpose: Admit, rotate, or block clients in a single atomic Redis operation.
- Location: `modules/policy/session-gate.js` — `SESSION_GATE_SCRIPT` (63 lines of Lua).
- Returns: `[allowed, reason, rotatedIp, activeCount]`.
- Outcomes: `admitted:existing`, `admitted:new`, `admitted:rotated`, `blocked:slot_taken`.

**Episode Share Cache:**
- Purpose: Allow up to 6 IPs to reuse one resolved stream URL per episode for 30 minutes.
- Key: `episode:share:{episodeId}` (Redis string, JSON payload).
- Fields: `episodeId`, `url`, `ownerIp`, `allowedIps[]`, `createdAtMs`, `lastSharedAtMs`.
- Location: `modules/routing/stream-route.js`.

**`classifyFailure` / `emitEvent`:**
- Purpose: Normalize any error or reason string to `{ source, cause }` and emit structured pino log entry.
- Location: `observability/events.js`.
- Used by all boundary layers to produce consistent telemetry.

**`withRequestContext` / `getCorrelationId`:**
- Purpose: AsyncLocalStorage-scoped correlation ID thread-local storage.
- Location: `observability/context.js`.
- Automatically included in all `emitEvent` payloads.

## Entry Points

**Vercel Serverless Entry:**
- Location: `serverless.js`
- Triggers: All HTTP paths matched by `vercel.json` catch-all route.
- Responsibilities: Import and re-export `createHttpHandler`.

**Stremio Addon Interface:**
- Location: `addon.js`
- Triggers: SDK router from within `createHttpHandler`.
- Responsibilities: Manifest definition, catalog/stream handlers, `resolveEpisode` helper.

**Local Start:**
- Location: `package.json` (`scripts.start` → `node serverless.js`)

## Error Handling

**Strategy:** Fail-safe degraded responses — never unhandled rejections in production paths.

**Patterns:**
- Route handlers return `{ handled, outcome: { source, cause, result } }`.
- Best-effort paths (analytics, quarantine events, reliability counters) always guarded with `catch { // comment }`.
- `DEGRADED_STREAM_POLICY` maps each cause to a `mode` (`empty` or `fallback`) and user-facing message.
- `sendDegradedStream` in `modules/presentation/stream-payloads.js` selects the appropriate degraded response.

## Cross-Cutting Concerns

**Logging:** All output via `emitEvent(logger, EVENTS.*, payload)` → pino JSON. Sensitive values (raw IPs, tokens) not included in log payloads.

**Validation:** Episode ID validated against `tt0388629` prefix. Broker URLs validated as HTTPS. Redis response shapes validated before use. Env config validated eagerly at startup.

**Authentication:** Operator routes require `X-Operator-Token` header matching `OPERATOR_TOKEN` env var. If env var unset → 503 `operator_auth_unconfigured` (no bypass).

**Import Directions (from `modules/BOUNDARIES.md`):**
- `routing` → `policy`, `integrations`, `analytics`, `presentation`, `observability`
- `policy` → pure utilities only (no service clients)
- `integrations` → transport utilities only
- `presentation` → no service client imports
- `analytics` → receives `redisCommand` as injected dependency

---

*Architecture analysis: 2026-02-25*
