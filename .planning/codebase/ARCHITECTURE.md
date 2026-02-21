# Architecture

**Analysis Date:** 2026-02-21

## Pattern Overview

**Overall:** Single-function serverless adapter around a Stremio addon interface

**Key Characteristics:**
- Route-first orchestration lives in one Node entry file at `serverless.js`.
- Addon domain behavior (catalog + stream resolution) is encapsulated in `addon.js` and consumed by `serverless.js`.
- External state and rate controls are delegated to Redis REST calls in `serverless.js` via `redisCommand()`.

## Layers

**HTTP Entry/Transport Layer:**
- Purpose: Accept all incoming HTTP requests, route special endpoints, and delegate Stremio protocol routes.
- Location: `serverless.js`
- Contains: `module.exports = async function (req, res)`, route checks for `/`, `/health`, `/quarantine`, `/stream/*`, and fallback router call.
- Depends on: `stremio-addon-sdk` router (`getRouter`), addon interface from `./addon`, Redis helper utilities.
- Used by: Vercel runtime configured in `vercel.json`.

**Addon Interface Layer:**
- Purpose: Define Stremio manifest, catalog response, and stream resolution behavior.
- Location: `addon.js`
- Contains: `manifest`, `builder.defineCatalogHandler(...)`, `builder.defineStreamHandler(...)`, `resolveEpisode(...)`.
- Depends on: `stremio-addon-sdk` (`addonBuilder`), broker endpoint via `B_BASE_URL` env var.
- Used by: `serverless.js` through `require("./addon")` and `addonInterface.resolveEpisode(...)`.

**Control/Policy Layer:**
- Purpose: Enforce access windows, session concurrency, and request admission before stream delivery.
- Location: `serverless.js`
- Contains: `applyRequestControls(req, pathname)`, IP extraction, Jerusalem-time checks, ZSET session tracking.
- Depends on: Redis command wrapper and constants (`INACTIVITY_LIMIT`, `MAX_SESSIONS`, `SLOT_TTL`).
- Used by: Main request handler before stream routing.

**Integration/State Layer:**
- Purpose: Persist and query distributed state and event counters.
- Location: `serverless.js`
- Contains: `getRedisConfig()`, `redisCommand(command)`, Redis key patterns (`system:*`, `active:*`, `stats:*`, `quarantine:*`).
- Depends on: Upstash/Vercel KV REST env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, fallback Upstash names).
- Used by: Control layer, stream caching path, health endpoint, and quarantine dashboard.

**Presentation Layer (Operational UI):**
- Purpose: Render landing page and quarantine diagnostics HTML.
- Location: `serverless.js`
- Contains: `getLandingPageHtml()`, `handleQuarantine(res)` HTML string builders.
- Depends on: Current Redis metrics and event log list.
- Used by: `/` and `/quarantine` endpoints.

## Data Flow

**Stream Request Flow (`/stream/series/:id.json`):**

1. Request enters `module.exports` in `serverless.js` and passes through `applyRequestControls()`.
2. `handleStreamRequest()` checks Redis cache (`active:url:${ip}`) for same episode reuse.
3. Cache miss triggers `addonInterface.resolveEpisode(episodeId)` from `addon.js`, which calls broker `/api/resolve` via `callBrokerResolve()`.
4. URL is normalized/validated to HTTPS, cached in Redis, and returned as Stremio stream JSON (`sendJson` + `formatStream`).

**Catalog/Manifest Flow:**

1. Non-intercepted Stremio routes are delegated to `router(req, res, ...)` in `serverless.js`.
2. Router calls handlers defined in `addon.js` (`defineCatalogHandler`, `defineStreamHandler`) based on resource path.
3. Handler returns manifest/catalog/stream payload in Stremio format.

**Operational Endpoint Flow:**

1. `/health` pings Redis (`redisCommand(["PING"])`) and returns JSON status.
2. `/quarantine` reads Redis lists/counters and renders HTML table.
3. `/` returns static landing page HTML.

**State Management:**
- Use Redis as the single shared state store; keep process memory stateless.
- Store session/activity in ZSET/string keys (`system:active_sessions`, `active:last_seen:*`, `active:url:*`) with TTLs.
- Treat addon metadata as code-defined constants in `addon.js` (`manifest`, `IMDB_ID`).

## Key Abstractions

**Stremio Addon Interface:**
- Purpose: Standard contract for manifest/catalog/stream behavior.
- Examples: `addon.js` (`builder.getInterface()`, handlers at lines defining catalog and stream behavior).
- Pattern: Build once with `addonBuilder`, export interface object, enrich with helper (`resolveEpisode`) for internal reuse.

**Redis REST Command Wrapper:**
- Purpose: Centralize Redis authentication, transport, and response validation.
- Examples: `serverless.js` (`getRedisConfig`, `redisCommand`).
- Pattern: Send single-command pipeline request; throw typed errors (`err.code`) on config/http/response failures.

**Route Interception Gate:**
- Purpose: Intercept selected routes (`/stream/*`) for custom policy and caching while delegating remaining Stremio protocol routes.
- Examples: `serverless.js` (`if (pathname.startsWith("/stream/"))` blocks + final `router(req, res, ...)`).
- Pattern: Handle custom cases first, then call SDK router as fallback.

## Entry Points

**Serverless Function Entry Point:**
- Location: `serverless.js`
- Triggers: Any HTTP path matched by `vercel.json` route `/(.*)`.
- Responsibilities: Route dispatch, request control, stream interception, health/quarantine UI, SDK router fallback.

**Local Runtime Entry Point:**
- Location: `package.json` (`scripts.start`)
- Triggers: `npm start`
- Responsibilities: Run Node process with `serverless.js` for local/dev execution.

## Error Handling

**Strategy:** Fail-safe responses with degraded but valid payloads instead of unhandled exceptions

**Patterns:**
- Wrap stream resolution in `try/catch` and return empty streams or test-video error stream (`sendErrorStream`) on failure.
- Convert infra errors to API-safe payloads in endpoints (`/health`, main handler) via `sendJson` with 500/503 codes.
- Validate critical upstream contracts early (`B_BASE_URL`, broker JSON body, `data.url` presence, Redis response shape).

## Cross-Cutting Concerns

**Logging:**
- Use Redis-backed event capture (`quarantine:events`) rather than stdout logs in `serverless.js`.

**Validation:**
- Validate route shape and episode constraints (`tt0388629` prefix) in `handleStreamRequest()`.
- Validate environment config for Redis and broker before external calls.

**Authentication:**
- No end-user auth layer is implemented.
- Infrastructure auth uses bearer token for Redis REST in `redisCommand()`.

---

*Architecture analysis: 2026-02-21*
