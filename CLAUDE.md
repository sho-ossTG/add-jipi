# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`add-jipi` is a Stremio addon for One Piece, deployed as a Vercel serverless function. It serves stream URLs and catalog metadata via the Stremio addon protocol, with session gating, Redis-backed analytics, and a downstream dependency ("Server D") for episode resolution.

The active migration goal is **Server A → D Integration Adaptation**: replacing the broker-based episode resolver with a direct HTTP client to Server D.

## Commands

```bash
# Run a single test file
node --test tests/<filename>.test.js

# Required gate (must pass before deployment)
npm run test:gate:required

# Optional diagnostics gate
npm run test:gate:optional

# Full validation gate
npm run test:gate:all

# Individual test suites
npm run test:contract:stream
npm run test:contract:reliability
npm run test:contract:stream:failures
npm run test:policy:time-window
npm run test:policy:session-gate
npm run test:analytics:hourly
npm run test:analytics:nightly-rollup
npm run test:session:view-ttl
npm run test:request-controls:nightly
```

Tests use Node.js built-in `node:test` — no test runner install needed.

## Architecture

### Request Flow

All HTTP traffic enters via `serverless.js` → `modules/routing/http-handler.js` (`createHttpHandler`), which:

1. Handles CORS preflight
2. Routes `operator`/`/admin`/`/quarantine` paths to `modules/routing/operator-routes.js`
3. Serves `/` (landing page) and `/health` from `modules/presentation/public-pages.js`
4. Applies session/rate controls via `modules/routing/request-controls.js` (Redis-backed)
5. Delegates `/stream/...` to `modules/routing/stream-route.js` (`handleStreamRequest`)
6. Falls through to the Stremio SDK router for `/manifest.json` and `/catalog/...`
7. Records reliability counters and emits structured telemetry in the `finally` block

### Module Boundaries (`modules/BOUNDARIES.md`)

| Directory | Responsibility |
|---|---|
| `modules/routing/` | HTTP composition, request flow orchestration |
| `modules/policy/` | Deterministic business rules (time-window, session gate, operator auth) |
| `modules/integrations/` | External clients: Redis (`redis-client.js`), D server (`d-client.js`) |
| `modules/presentation/` | Response shaping (stream payloads, landing page, operator diagnostics) |
| `modules/analytics/` | Hourly tracker, nightly rollup, session view, daily summary |
| `observability/` | Cross-cutting: logger (pino), events, metrics, request context |

**Import direction**: `routing` → `policy`, `integrations`, `presentation`. `policy` and `integrations` must not import from each other or from `routing`. `modules/index.js` is a maintainer manifest only — never import it at runtime.

### Key Integration Points

- **D client** (`modules/integrations/d-client.js`): `POST /api/resolve` for episode URLs, `POST /api/ua` (fire-and-forget UA forwarding), `POST /api/logs` (fire-and-forget log shipping). Configured via `D_BASE_URL`, `D_ATTEMPT_TIMEOUT_MS`, `D_TOTAL_TIMEOUT_MS`. Throws `dependency_unavailable`, `dependency_timeout`, or `validation_error`.
- **Redis client** (`modules/integrations/redis-client.js`): Upstash REST API. Configured via `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*` variants). Uses `executeBoundedDependency` for retry/timeout.
- **Bounded dependency** (`modules/integrations/bounded-dependency.js`): Shared retry-with-jitter helper. Redis uses 900ms/1800ms budget; D client uses 5s/10s budget.

### Session Gate & Redis Keys

- `system:active_sessions` — sorted set; score = last-seen timestamp. Max 2 sessions (`MAX_SESSIONS`).
- `episode:share:{episodeId}` — JSON string; caches resolved URL + allowed IPs (max 6) for 30 min.
- `analytics:hourly` — hash; field format `{bucket}|{event}|{metric}`.
- `analytics:unique:{bucket}` — HyperLogLog per hourly bucket.
- `quarantine:events` — list; last 50 stream error events for operator review.

### Policy

- **Time window** (`modules/policy/time-window.js`): Jerusalem timezone shutdown window (00:00–08:00 Asia/Jerusalem by default), configurable via `SHUTDOWN_START_HOUR`/`SHUTDOWN_END_HOUR`.
- **Session gate** (`modules/policy/session-gate.js`): slot allocation via Redis Lua EVAL for atomicity.

### Test Infrastructure

Tests in `tests/` use `tests/helpers/runtime-fixtures.js` which provides:
- `createRedisRuntime()` — in-memory Redis mock
- `loadServerless()` / `loadAddon()` — module loaders that clear require cache
- `requestWithHandler()` — HTTP handler simulator
- `setRedisEnv()` — sets fake env vars for Redis config

Tests must clear the require cache and restore `global.fetch` after each test that patches it.

## Environment Variables

| Variable | Purpose |
|---|---|
| `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | Redis endpoint |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |
| `D_BASE_URL` | Server D base URL |
| `OPERATOR_TOKEN` | Auth token for `/operator/` routes |
| `TRUST_PROXY` | Comma-separated trusted proxy list (default: loopback,linklocal,uniquelocal) |
| `CORS_ALLOW_ORIGINS` | Allowed CORS origins |
| `MAX_SESSIONS` | Max concurrent sessions (default: 2) |
| `SLOT_TTL_SEC` | Session slot TTL (default: 3600) |
| `RECONNECT_GRACE_MS` | Grace period for reconnect (default: 15000) |

## Deployment

Deployed to Vercel via `vercel.json` — all routes route to `serverless.js` with a 60s max duration. The `.planning/` directory is gitignored (local GSD planning docs only).
