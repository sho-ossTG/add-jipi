# Codebase Structure

**Analysis Date:** 2026-03-06

## Directory Layout

```
add-jipi/
├── serverless.js              # Serverless function entrypoint (exports createHttpHandler)
├── addon.js                   # Stremio addon manifest + catalog/stream handlers
├── package.json               # Dependencies: pino, proxy-addr, stremio-addon-sdk
├── vercel.json                # Vercel deployment config (all routes → serverless.js, 60s max)
├── modules/                   # Core modular layers
│   ├── index.js               # Maintainer-facing module ownership manifest (not runtime)
│   ├── BOUNDARIES.md          # Module boundary constraints and import rules
│   ├── routing/               # HTTP request handling and route dispatch
│   │   ├── http-handler.js    # Main request orchestrator, route classification, lifecycle
│   │   ├── stream-route.js    # Stream request handler, episode resolution, deduplication
│   │   ├── operator-routes.js # Operator diagnostic endpoints (/operator/*, /quarantine, /health/details)
│   │   └── request-controls.js# Policy gate evaluation (time window, session quota, analytics)
│   ├── policy/                # Business rule evaluation (deterministic, stateless)
│   │   ├── time-window.js     # Jerusalem timezone, shutdown window logic
│   │   ├── session-gate.js    # Redis Lua script for atomic session quota enforcement
│   │   └── operator-auth.js   # Token authentication
│   ├── integrations/          # External dependency clients
│   │   ├── d-client.js        # Server D HTTP client (episode resolve, UA forward, log ship)
│   │   ├── redis-client.js    # Upstash REST HTTP Redis wrapper
│   │   └── bounded-dependency.js # Shared retry-with-jitter and timeout wrapper
│   ├── presentation/          # Response formatting and HTML rendering
│   │   ├── stream-payloads.js # Stream JSON structure, degradation policy rules
│   │   ├── public-pages.js    # Landing page HTML, public health endpoint
│   │   ├── operator-diagnostics.js # Health, metrics, analytics JSON projection
│   │   └── quarantine-page.js # Error event log HTML viewer
│   └── analytics/             # Session and event tracking
│       ├── session-view.js    # Session snapshot storage in Redis, active count queries
│       ├── hourly-tracker.js  # Per-hour metric bucketing and HyperLogLog aggregation
│       ├── nightly-rollup.js  # Daily summary consolidation job
│       └── daily-summary-store.js # Daily total persistence
├── observability/             # Request context, events, logging, metrics
│   ├── context.js             # AsyncLocalStorage for correlation ID propagation
│   ├── events.js              # Event emission, failure classification (source/cause)
│   ├── logger.js              # Pino logger wrapper with redaction config
│   ├── diagnostics.js         # Health/metrics projection utilities
│   └── metrics.js             # Reliability counter management
└── tests/                     # Contract and policy verification
    ├── contract-*.test.js     # Stream reliability, CORS, security, observability contracts
    ├── policy-*.test.js       # Time window and session gate determinism tests
    ├── analytics-*.test.js    # Hourly tracking and nightly rollup logic tests
    ├── request-controls-*.test.js # Request control gate evaluation tests
    ├── session-view-ttl.test.js   # Session view TTL management test
    └── helpers/
        └── runtime-fixtures.js # Test runtime construction utilities (mocks, loaders)
```

## Directory Purposes

**`modules/routing/`:**
- Purpose: HTTP request handling, route dispatch, request lifecycle orchestration
- Contains: Request handler factories, route classifiers, handler composition
- Key files:
  - `http-handler.js` (main entry, request classification, CORS, telemetry)
  - `stream-route.js` (stream logic, episode resolution, in-memory dedup)
  - `operator-routes.js` (diagnostics)
  - `request-controls.js` (policy gates, analytics tracking)
- Import pattern: Routes to policy, integrations, presentation, observability

**`modules/policy/`:**
- Purpose: Business rule evaluation (shutdown windows, session gates, authentication)
- Contains: Deterministic, stateless rule engines and policy decisions
- Key files:
  - `time-window.js` (Jerusalem timezone logic, shutdown hour checks)
  - `session-gate.js` (Redis Lua script for quota management)
  - `operator-auth.js` (token validation)
- Import pattern: No imports except observability (logging); imported by routing only

**`modules/integrations/`:**
- Purpose: External service clients with resilience and bounded timeouts
- Contains: Redis HTTP client, D server client, dependency retry logic
- Key files:
  - `d-client.js` (Episode resolution via HTTP POST)
  - `redis-client.js` (Upstash REST HTTP API wrapper)
  - `bounded-dependency.js` (Shared retry-with-jitter and timeout handler)
- Import pattern: No cross-dependency imports; imported by routing, policy, analytics

**`modules/presentation/`:**
- Purpose: Response payload shaping and HTML rendering
- Contains: JSON formatters, HTML builders, degradation policies
- Key files:
  - `stream-payloads.js` (Stream JSON, degradation rules)
  - `public-pages.js` (HTML: landing page, health check)
  - `operator-diagnostics.js` (JSON projections: health, metrics, analytics)
  - `quarantine-page.js` (HTML: error event viewer)
- Import pattern: No imports (pure renderers); imported by routing only

**`modules/analytics/`:**
- Purpose: Session tracking, hourly event aggregation, daily summarization
- Contains: Redis-backed storage, hourly bucketing, TTL management
- Key files:
  - `session-view.js` (Snapshots: IP, user-agent, episode, resolved URL, status, TTL)
  - `hourly-tracker.js` (Metrics: HINCRBY counts, PFADD unique IPs, HyperLogLog)
  - `nightly-rollup.js` (Consolidation: daily totals)
  - `daily-summary-store.js` (Persistence)
- Import pattern: Uses Redis client; imported by routing, policy

**`observability/`:**
- Purpose: Request context binding, event emission, structured logging, metrics
- Contains: AsyncLocalStorage wrapper, event classification, logger config, metric counters
- Key files:
  - `context.js` (Correlation ID binding and retrieval)
  - `events.js` (Event emission, failure classification)
  - `logger.js` (Pino setup, redaction paths)
  - `metrics.js` (Reliability counters)
  - `diagnostics.js` (Health projections)
- Import pattern: Imported by all modules; no cross-observability imports

**`tests/`:**
- Purpose: Contract verification and policy determinism testing
- Contains: Node built-in test files, runtime fixtures
- Pattern: One test file per module/concern
  - `contract-*.test.js` — stream reliability, CORS, security, observability, manifest
  - `policy-*.test.js` — time window, session gate logic
  - `analytics-*.test.js` — hourly tracking, nightly rollup
  - `request-controls-*.test.js` — gate evaluation
  - `session-view-ttl.test.js` — TTL management
- Fixtures: `helpers/runtime-fixtures.js` provides mocks, loaders, handlers

## Key File Locations

**Entry Points:**
- `serverless.js`: Serverless function handler export (imports `createHttpHandler`)
- `addon.js`: Stremio SDK addon registration and manifest
- `modules/routing/http-handler.js`: Main HTTP request orchestrator (invoked per request)

**Configuration:**
- `package.json`: Dependencies, scripts (test gates), name/version metadata
- `vercel.json`: Deployment routing and builds-only serverless config
- Environment variables: Loaded in runtime files (no `.env` file committed)
  - `OPERATOR_TOKEN`: Operator endpoint authentication token
  - `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`): Redis (Upstash) connection
  - `D_BASE_URL`: Server D base URL for episode resolution
  - `D_ATTEMPT_TIMEOUT_MS`, `D_TOTAL_TIMEOUT_MS`: D client timeout config
  - `SLOT_TTL_SEC`: Session slot TTL (default 3600)
  - `INACTIVITY_LIMIT_SEC`: Session inactivity threshold (default 1200 = 20 min)
  - `MAX_SESSIONS`: Max concurrent sessions (default 2)
  - `RECONNECT_GRACE_MS`: Grace period before rotation (default 15000)
  - `ROTATION_IDLE_MS`: Idle time to qualify for rotation (default 45000)
  - `SESSION_VIEW_TTL_SEC`: Session view snapshot TTL (default 1200)
  - `HOURLY_ANALYTICS_TTL_SEC`: Hourly analytics retention (default 129600 = 36 hours)
  - `SHUTDOWN_START_HOUR`, `SHUTDOWN_END_HOUR`: Shutdown window hours UTC (default 0, 8)
  - `TRUST_PROXY`: Trusted proxy list (default "loopback,linklocal,uniquelocal")
  - `CORS_ALLOW_ORIGINS`, `CORS_ALLOW_HEADERS`, `CORS_ALLOW_METHODS`: CORS config

**Core Logic:**
- Policy gates: `modules/policy/time-window.js`, `modules/policy/session-gate.js`
- Stream resolution: `modules/routing/stream-route.js`, `modules/integrations/d-client.js`
- Session tracking: `modules/analytics/session-view.js`, `modules/routing/stream-route.js`
- Episode caching: `modules/routing/stream-route.js` (Redis `episode:share:*` keys)

**Testing:**
- Policy tests: `tests/policy-time-window.test.js`, `tests/policy-session-gate.test.js`
- Contract tests: `tests/contract-stream-reliability.test.js`, `tests/contract-stream.test.js`, `tests/contract-cors-policy.test.js`
- Analytics tests: `tests/analytics-hourly.test.js`, `tests/analytics-nightly-rollup.test.js`
- Runtime fixtures: `tests/helpers/runtime-fixtures.js`

## Naming Conventions

**Files:**
- Kebab-case with domain prefix: `[domain]-[purpose].js`
  - Examples: `http-handler.js`, `session-gate.js`, `d-client.js`, `contract-stream.test.js`
- Test files: `[domain]-[purpose].test.js` or `[domain]-[concern].test.js`
- Modules exposed via direct function/class exports, not barrel files

**Directories:**
- Plural nouns for domain collections: `routing`, `policy`, `integrations`, `presentation`, `analytics`, `tests`, `observability`
- Functional grouping by concern, not by type (not "handlers", "clients", "models", "utils")

**Functions:**
- PascalCase for factory functions: `createHttpHandler`, `createRedisClient`, `createDClient`, `createJerusalemClock`
- camelCase for pure functions: `classifyFailure`, `getJerusalemInfo`, `isWithinShutdownWindow`, `applyRequestControls`, `toHourBucket`
- Async/imperative verbs for action functions: `handleStreamRequest`, `runAtomicSessionGate`, `executeBoundedDependency`, `trackHourlyEvent`, `upsertSessionView`

**Variables:**
- camelCase: `clientIp`, `episodeId`, `sessionKey`, `hourlyAnalyticsTtlSec`, `inFlightStreamIntents`
- Constant config: `DEFAULTS` (object), `SLOT_TTL` (parsed env), `SESSION_GATE_SCRIPT` (template string)
- HTTP/status codes: `statusCode`, `requestHeaders`

**Types:**
- No TypeScript; object structures documented in JSDoc or inline comments
- Input/output shapes normalized in function parameter naming: `input`, `injected`, `options`, `payload`
- Example: `handleStreamRequest(input = {}, injected = {})`

## Where to Add New Code

**New Feature (Stream Handling):**
- Primary code: `modules/routing/stream-route.js` (if stream-specific logic) or `modules/integrations/d-client.js` (if D server integration)
- Policy rules: `modules/policy/[rule-name].js`
- Response format: `modules/presentation/stream-payloads.js`
- Tests: `tests/contract-stream-*.test.js` or `tests/policy-*.test.js`

**New Component/Module:**
- Implementation: `modules/[domain]/[component].js` (choose domain: routing, policy, integrations, presentation, analytics)
- Keep files focused on one concern; break into separate files if logic exceeds ~200 lines
- Export factory or function directly; use `modules/index.js` for maintainer documentation only
- Tests: `tests/[domain]-[component].test.js`
- Update `modules/BOUNDARIES.md` if adding cross-domain dependencies

**New Utility/Helper:**
- Observability helpers: `observability/[helper].js` (if cross-cutting: events, logging, context, metrics)
- Module-specific utilities: Keep inline or in same file if <50 lines; extract if used by multiple modules
- Tests: `tests/[domain]-[helper].test.js` (if public/important)

**Operator Endpoint:**
- Route handler: Add case in `modules/routing/operator-routes.js` → `handleOperatorRoute` function
- Response format: `modules/presentation/operator-diagnostics.js` (data projection) or inline JSON
- Authentication: Handled automatically by `modules/policy/operator-auth.js` (called before route handler)
- Tests: `tests/contract-observability.test.js` or new `tests/contract-[endpoint].test.js`

**Analytics Event:**
- Field definition: Add to event name list in `modules/routing/stream-route.js` or `modules/routing/request-controls.js` → `trackHourlyEvent` calls
- Hourly tracking: Use `trackHourlyEvent(redisCommand, { fields: ["event.name"], uniqueId })` (already integrated in routing)
- Query/projection: `modules/presentation/operator-diagnostics.js` → metrics query functions
- Tests: `tests/analytics-hourly.test.js`

**Policy Rule:**
- Implementation: `modules/policy/[rule-name].js` (pure function or factory)
- Integration: Import and call in `modules/routing/request-controls.js` or `modules/routing/http-handler.js`
- Example: Time window checks in `applyRequestControls`, session gate in `applyRequestControls`
- Tests: `tests/policy-[rule-name].test.js`

## Special Directories

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (from `npm install`)
- Committed: No (included in `.gitignore`)
- Key packages: `pino` (logger), `stremio-addon-sdk` (Stremio protocol), `proxy-addr` (IP resolution)

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by `/gsd:map-codebase` command)
- Committed: Yes
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md

**`.git/`:**
- Purpose: Git version control
- Generated: Yes
- Committed: Yes (except `.git/objects` are binary)

**`.opencode/`:**
- Purpose: GSD orchestrator configuration and plugins
- Generated: Yes
- Committed: Yes (contains agents, commands, rules)

**`tests/`:**
- Purpose: Node.js test verification and contract enforcement
- Generated: No (manually written)
- Committed: Yes
- Test runner: Node built-in `--test` flag (no Jest/Vitest dependency)
- Run: `npm run test:gate:all` (all required + optional tests)

## Module Dependency Graph

```
serverless.js
  └─> modules/routing/http-handler.js
       ├─> modules/routing/operator-routes.js
       │    ├─> modules/policy/operator-auth.js
       │    └─> modules/presentation/operator-diagnostics.js
       ├─> modules/routing/stream-route.js
       │    ├─> modules/integrations/d-client.js
       │    ├─> modules/presentation/stream-payloads.js
       │    ├─> modules/analytics/session-view.js
       │    └─> modules/integrations/bounded-dependency.js
       ├─> modules/routing/request-controls.js
       │    ├─> modules/policy/time-window.js
       │    ├─> modules/policy/session-gate.js
       │    ├─> modules/analytics/hourly-tracker.js
       │    ├─> modules/analytics/nightly-rollup.js
       │    └─> modules/integrations/bounded-dependency.js
       ├─> modules/presentation/public-pages.js
       ├─> modules/integrations/redis-client.js
       │    └─> modules/integrations/bounded-dependency.js
       └─> observability/* (context, events, logger, metrics)

addon.js
  └─> modules/integrations/d-client.js
```

## Runtime Dependency Injection Pattern

Modules use dependency injection extensively to enable testability and decoupling:

- `http-handler.js` builds dependency objects and passes them to route handlers
- Route handlers (`stream-route.js`, `request-controls.js`, `operator-routes.js`) accept `injected` parameter
- Key injected dependencies:
  - `redisCommand`: Redis command executor
  - `redisEval`: Redis Lua EVAL wrapper
  - `emitTelemetry`: Event emission
  - `classifyFailure`: Error classification
  - `events`: Event type constants
  - Various config values (TTL, limits, etc.)

This allows test fixtures to override implementations (e.g., in-memory Redis mock) without modifying production code.

---

*Structure analysis: 2026-03-06*
