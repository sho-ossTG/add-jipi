# Server A Template

## Server identity & role

- **Server:** A (Stremio addon edge)
- **Runtime:** Vercel Node serverless entry (`serverless.js` via `vercel.json`)
- **Primary role:** Serve manifest/catalog/stream routes, enforce request controls, and call Server D for episode resolution
- **Out of scope:** Gateway admission and fixed-link lookup (D), broker worker fan-out (B), yt-dlp execution (C)

## File & folder structure

- `serverless.js` - Vercel entrypoint that mounts the HTTP handler
- `addon.js` - Stremio manifest/catalog/stream interface and `resolveEpisode` bridge
- `modules/routing/http-handler.js` - route orchestration, CORS, operator/public/stremio routing, telemetry
- `modules/routing/stream-route.js` - stream request handling path and degraded payload branching
- `modules/integrations/d-client.js` - A -> D HTTP dependency client (`/api/resolve`, `/api/ua`) with bounded retries
- `modules/integrations/redis-client.js` - Redis integration used by request controls and metrics
- `modules/analytics/` - hourly/nightly analytics tracking helpers
- `observability/` - correlation context, structured logger, event emission, reliability counters
- `tests/` - contract and policy tests for runtime behavior
- `docs/` - operator-facing docs including this template

## Contracts & dependencies

- **Inbound (Stremio):** `GET /manifest.json`, `GET /catalog/...`, `GET /stream/...` handled by addon/router surfaces
- **Outbound A -> D:** `POST /api/resolve` with `{ episodeId }` and `x-correlation-id`; expects `2xx { url, filename }`
- **Outbound A -> D (best effort):** `POST /api/ua` with `{ userAgent, episodeId, timestamp }`
- **Headers:** generates/propagates `x-correlation-id`; supports operator auth header `X-Operator-Token` for operator routes
- **Env vars (runtime):** `D_BASE_URL`, `D_ATTEMPT_TIMEOUT_MS`, `D_TOTAL_TIMEOUT_MS`, `D_RETRY_JITTER_MS`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `OPERATOR_TOKEN`, `TRUST_PROXY`, `CORS_ALLOW_ORIGINS`, `CORS_ALLOW_HEADERS`, `CORS_ALLOW_METHODS`, `MAX_SESSIONS`, `SLOT_TTL_SEC`, `INACTIVITY_LIMIT_SEC`, `RECONNECT_GRACE_MS`, `ROTATION_IDLE_MS`, `SESSION_VIEW_TTL_SEC`, `HOURLY_ANALYTICS_TTL_SEC`, `LOG_LEVEL`
- **Cross-reference:** `.planning/phases/11-architecture-baseline-stubs-repo-cleanup/11-CONTRACT-MATRIX.md` row `A -> D`

## Functional vs non-functional ideas

- ✅ Functional - Stremio manifest/catalog/stream serving through `addon.js` + `modules/routing/http-handler.js`
- ✅ Functional - A -> D resolve and UA forwarding via `modules/integrations/d-client.js`
- ✅ Functional - reliability controls/telemetry and degraded fallback payloads in routing/observability modules
- 🚧 Non-functional (stub) - optional operator dashboard cards in operator routes; keep insertion behind `const STUB_ENABLED = false` in `modules/routing/operator-routes.js`
- 🚧 Non-functional (stub) - experimental stream policy variants; insert behind `const STUB_ENABLED = false` in `modules/routing/stream-route.js`

## Cross-server change impact

- Contract changes here primarily impact Server D (`/api/resolve`, `/api/ua`) and downstream observability expectations
- Co-update requirement: A caller docs/code and D callee docs/code in one change set
- Execute the Change Propagation Checklist in `11-CONTRACT-MATRIX.md` for any `A -> D` contract edits

## Verification notes

- `GET /manifest.json` returns addon manifest JSON
- `GET /` returns landing page HTML from A public route
- Stream request path should return stream payload on healthy D dependency and degraded payload when D fails/timeouts
