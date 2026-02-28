# External Integrations

**Analysis Date:** 2026-02-28

## APIs & External Services

**Stremio Addon Protocol:**
- Stremio platform - Content catalog and streaming addon
  - SDK: stremio-addon-sdk 1.6.10
  - Manifest endpoint: `/manifest.json`
  - Catalog endpoint: `/catalog/{type}/{id}`
  - Stream endpoint: `/stream/{type}/{id}`
  - Implementation: `addon.js`

**Broker Service:**
- Custom broker service - Episode URL resolution
  - Endpoint: `GET /api/resolve?episode={episodeId}`
  - Base URL env var: `B_BASE_URL`
  - Client: `modules/integrations/broker-client.js`
  - Timeout: 60 seconds attempt, 60 seconds total budget
  - Retry strategy: Single automatic retry on transient failures
  - Error handling: HTTP 408/429/5xx and network errors trigger retry
  - Response parsing: Extracts URL from `url`, `streamUrl`, `link` fields (direct or nested)
  - Fallback filename extraction: Supports `filename`, `fileName`, `name` fields

## Data Storage

**Cache & Session Store:**
- Upstash Redis (optional) or KV store
  - Connection: `KV_REST_API_URL` or `UPSTASH_REDIS_REST_URL`
  - Authentication: `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_TOKEN`
  - Client: `modules/integrations/redis-client.js`
  - Protocol: REST API via `POST /pipeline` endpoint
  - Access pattern: RESP3 command arrays
  - Timeout: 900ms attempt, 1800ms total budget (shorter than broker)

**What is Stored:**
- Session slot allocation (time-window based)
- Session gate state (concurrent session limits)
- Reliability counters (labeled metrics for success/degraded/failure)
- Quarantine events (error tracking for problematic IPs)
- Episode share state (IP allowlists per episode)
- Daily analytics summaries
- Hourly event tracking
- Session view cache

**File Storage:**
- None - stateless except for Redis integration

## Authentication & Identity

**Operator Authentication:**
- Custom token-based
  - Token env var: `OPERATOR_TOKEN`
  - Header: `X-Operator-Token`
  - Implementation: `modules/policy/operator-auth.js`
  - Endpoints: `/operator/*`, `/admin/*`, `/quarantine`
  - Returns 401 if token missing, 403 if token invalid

**Request Identity:**
- Correlation ID tracking
  - Header: `x-correlation-id` or `X-Correlation-Id`
  - Auto-generated: UUID4 if not provided
  - Purpose: Request tracing across logs
  - Implementation: `observability/context.js`

**Client IP Resolution:**
- Trusted proxy chain parsing
  - Using proxy-addr library
  - Config: `TRUST_PROXY` env var (default: "loopback,linklocal,uniquelocal")
  - Fallback: Direct socket remote address if proxy parsing fails

## Monitoring & Observability

**Logging Framework:**
- Pino JSON logger
  - Log level: Configurable via `LOG_LEVEL` env var
  - Redaction: Sensitive fields are redacted (auth headers, tokens, cookies)
  - Redacted paths: `headers.authorization`, `headers.cookie`, `headers.x-operator-token`, `token`, `accessToken`, `refreshToken`
  - Output format: JSON structured logs to stdout
  - Fallback: console.log if pino fails to load

**Event Emission:**
- Custom event system
  - Location: `observability/events.js`
  - Events emitted: `request.start`, `policy.decision`, `dependency.attempt`, `dependency.failure`, `request.degraded`, `request.complete`
  - Event sources: broker, redis, validation, policy
  - Failure classification: Maps errors to source/cause for analysis

**Metrics & Analytics:**
- Reliability counters (multi-dimensional)
  - Location: `observability/metrics.js`
  - Stored in Redis hash: `stats:reliability:counters`
  - Dimensions: source (broker/redis/validation/policy), cause (success/timeout/unavailable/etc), routeClass (stremio/operator/public), result (success/degraded/failure)
  - Meta tracking: First/last seen timestamps
  - Accessed via `/admin/health/details` operator endpoint

- Hourly event tracking
  - Location: `modules/analytics/hourly-tracker.js`
  - Aggregates events per hour window
  - TTL: `HOURLY_ANALYTICS_TTL_SEC` (default: 129600 seconds)

- Nightly rollup
  - Location: `modules/analytics/nightly-rollup.js`
  - Daily summary generation
  - Aggregates hourly data into daily summaries

- Session analytics
  - Location: `modules/analytics/session-view.js`
  - Tracks session metadata (client, IP, episode)

## CI/CD & Deployment

**Hosting:**
- Vercel serverless platform
- Configuration: `vercel.json`
- Build: `@vercel/node` runtime
- Max duration: 60 seconds per request
- Automatic deployment on push

**CI Pipeline:**
- Not detected (no GitHub Actions, GitLab CI, or Jenkins config)
- All tests run locally via npm scripts

## Environment Configuration

**Required env vars (for operation):**
- `B_BASE_URL` - Broker service URL (required for stream resolution)
- `OPERATOR_TOKEN` - Operator authentication token (should be set for security)

**Optional env vars (with sensible defaults):**
- `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` - Redis for persistence
- `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` - Redis authentication
- `LOG_LEVEL` - Logger level (default: "info")
- `CORS_ALLOW_ORIGINS` - CORS allowlist (default: empty, no CORS)
- All timeout/TTL env vars have defaults in code

**Secrets location:**
- Secrets must be configured in Vercel environment variables (not committed)
- Never use .env files in production
- Use Vercel Dashboard or `vercel env` CLI to manage secrets

## Webhooks & Callbacks

**Incoming Webhooks:**
- None detected

**Outgoing Webhooks/Callbacks:**
- None detected

**Request/Response Pattern:**
- Stremio addon protocol (request-response via HTTP GET)
- Broker service (HTTP GET with query parameters)
- Operator routes (HTTP GET/OPTIONS)

## Error Handling & Resilience

**Dependency Timeouts:**
- Broker: 60 second total timeout, retries once on transient errors
- Redis: 1800 millisecond total timeout, retries once on transient errors
- Transient error detection: HTTP 408/429/5xx, network error codes (ETIMEDOUT, ECONNRESET, etc)

**Degradation Strategy:**
- Stream requests: Return degraded stream response (fallback video or empty stream)
- Policy requests: Return 503 Service Unavailable
- Operator routes: Return 503 with error details

**Fallback Behavior:**
- Stream resolution: Fallback to test video URL if broker fails
- Analytics: Best-effort (errors don't block responses)
- Metrics: Best-effort (reliability counters don't affect responses)

---

*Integration audit: 2026-02-28*
