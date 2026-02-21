# External Integrations

**Analysis Date:** 2026-02-21

## APIs & External Services

**Content Resolution:**
- Broker service (custom "B" service) - resolves episode IDs into final stream URLs
  - SDK/Client: native `fetch` in `addon.js` (`callBrokerResolve`)
  - Auth: none detected in request code; endpoint base comes from `B_BASE_URL`

**Addon Ecosystem:**
- Stremio platform - consumes manifest/catalog/stream responses
  - SDK/Client: `stremio-addon-sdk` used in `addon.js` and `serverless.js`
  - Auth: Not applicable

**Static/Reference Media:**
- Metahub image CDN - poster URL in addon metadata from `addon.js`
- Test video host (`test-videos.co.uk`) - fallback stream URL in `serverless.js`

## Data Storage

**Databases:**
- Redis (REST API; Upstash/Vercel KV style) used for session control, counters, and quarantine events in `serverless.js`
  - Connection: `KV_REST_API_URL` or `UPSTASH_REDIS_REST_URL`
  - Client: custom REST pipeline wrapper via `redisCommand` in `serverless.js`

**File Storage:**
- Local filesystem only (no external blob/object storage integration detected)

**Caching:**
- Redis key-value caching for active stream URL per IP (`active:url:*`) and heartbeat/session data in `serverless.js`

## Authentication & Identity

**Auth Provider:**
- Service-to-service token auth for Redis REST
  - Implementation: `Authorization: Bearer <token>` header built from `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_TOKEN` in `serverless.js`

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Datadog/etc. SDK detected)

**Logs:**
- Quarantine event log persisted to Redis list (`quarantine:events`) in `serverless.js`
- Health status endpoint at `/health` in `serverless.js`
- Operational stats (`stats:slot_taken`, `stats:broker_error`) tracked in Redis in `serverless.js`

## CI/CD & Deployment

**Hosting:**
- Vercel serverless deployment configured in `vercel.json`

**CI Pipeline:**
- None detected in repository files (no GitHub Actions or other CI config present)

## Environment Configuration

**Required env vars:**
- `B_BASE_URL` (broker API base URL) in `addon.js`
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` OR `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in `serverless.js`

**Secrets location:**
- Runtime environment variables in deployment platform settings (repository contains no checked-in `.env*` files)

## Webhooks & Callbacks

**Incoming:**
- None detected (HTTP routes are client-invoked addon endpoints: `/manifest.json`, `/catalog/*`, `/stream/*`, `/health`, `/quarantine` in `serverless.js`)

**Outgoing:**
- None detected for webhook callbacks; outbound calls are direct API requests to broker and Redis from `addon.js` and `serverless.js`

---

*Integration audit: 2026-02-21*
