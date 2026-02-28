# Technology Stack

**Analysis Date:** 2026-02-28

## Languages

**Primary:**
- JavaScript (Node.js) - All application code and tests
- CommonJS modules

**Markup:**
- HTML - Landing page and operator UI rendering
- JSON - API payloads and configuration

## Runtime

**Environment:**
- Node.js (version not pinned in package.json, runtime agnostic)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- stremio-addon-sdk ^1.6.10 - Stremio protocol implementation and addon interface
  - Provides manifest handler, catalog handler, stream handler routing
  - Location: `addon.js`, `modules/routing/http-handler.js`

**Logging:**
- pino ^10.3.1 - JSON structured logging
  - Automatic log redaction for sensitive fields (auth headers, tokens)
  - Fallback to console.log if pino not available
  - Configuration: `observability/logger.js`

**Networking:**
- proxy-addr ^2.0.7 - IP address trust chain parsing
  - Used for client IP extraction from request headers
  - Location: `modules/routing/http-handler.js`

**Testing:**
- Node.js built-in `--test` runner (no external test framework)
- Native Node.js assertion module
- Test execution via npm scripts

**Build/Dev:**
- No build tools required (pure JavaScript, no compilation)
- Vercel Node.js runtime for deployment

## Key Dependencies

**Critical:**
- stremio-addon-sdk 1.6.10 - Required for addon protocol and router
- pino 10.3.1 - Required for structured logging and security redaction
- proxy-addr 2.0.7 - Required for secure IP resolution

**No External Databases Required:**
- Redis/Upstash is an optional integration (not a dependency)
- Code runs with stub implementations when integrations unavailable

## Configuration

**Environment Variables:**
- `B_BASE_URL` - Broker service base URL for episode resolution
- `KV_REST_API_URL` or `UPSTASH_REDIS_REST_URL` - Redis/Upstash connection (optional)
- `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_TOKEN` - Redis authentication (optional)
- `LOG_LEVEL` - Pino logger level (default: "info")
- `OPERATOR_TOKEN` - Authentication token for operator routes
- `CORS_ALLOW_ORIGINS` - Comma-separated CORS origin allowlist
- `CORS_ALLOW_HEADERS` - Comma-separated CORS header allowlist (default: "Content-Type,Authorization,X-Operator-Token")
- `CORS_ALLOW_METHODS` - Comma-separated CORS method allowlist (default: "GET,OPTIONS")
- `TRUST_PROXY` - Proxy trust list for client IP extraction (default: "loopback,linklocal,uniquelocal")
- `SLOT_TTL_SEC` - Session slot TTL in seconds (default: 3600)
- `INACTIVITY_LIMIT_SEC` - Session inactivity timeout (default: 1200 seconds)
- `MAX_SESSIONS` - Maximum concurrent sessions per client (default: 2)
- `RECONNECT_GRACE_MS` - Reconnection grace period in milliseconds (default: 15000)
- `ROTATION_IDLE_MS` - Session rotation idle timeout (default: 45000)
- `SESSION_VIEW_TTL_SEC` - Session view cache TTL (default: 1200 seconds)
- `HOURLY_ANALYTICS_TTL_SEC` - Hourly analytics cache TTL (default: 129600 seconds)
- `BROKER_ATTEMPT_TIMEOUT_MS` - Broker request attempt timeout (default: 60000)
- `BROKER_TOTAL_TIMEOUT_MS` - Broker total request timeout (default: 60000)
- `BROKER_RETRY_JITTER_MS` - Broker retry jitter range (default: 150)

**Note:** No .env file is committed. Environment variables must be provided by deployment platform (Vercel).

## Build Configuration

**Vercel Deployment:**
- Config: `vercel.json`
- Entry point: `serverless.js`
- Build uses: `@vercel/node` runtime
- Max duration: 60 seconds per request
- Routes all requests to `serverless.js` entry point

## HTTP Server

**Handling:**
- Native Node.js HTTP server (no Express or other framework)
- Entry point: `serverless.js` exports `createHttpHandler` from `modules/routing/http-handler.js`
- Serverless-compatible handler pattern (req, res)
- CORS support with configurable origins/methods/headers
- Request correlation ID tracking via `x-correlation-id` header

## Platform Requirements

**Development:**
- Node.js runtime
- npm package manager
- Text editor or IDE supporting JavaScript

**Production:**
- Vercel serverless platform (configured in `vercel.json`)
- Optional: Upstash Redis for analytics and session management
- Optional: External broker service for episode resolution

---

*Stack analysis: 2026-02-28*
