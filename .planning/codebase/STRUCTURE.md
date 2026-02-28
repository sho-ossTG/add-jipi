# Codebase Structure

**Analysis Date:** 2026-02-28

## Directory Layout

```
add-jipi/
├── serverless.js              # Serverless function entrypoint (exports createHttpHandler)
├── addon.js                   # Stremio addon manifest + catalog/stream handlers
├── package.json               # Dependencies: pino, proxy-addr, stremio-addon-sdk
├── vercel.json                # Vercel deployment config (builds-only routing)
├── modules/                   # Core modular layers
│   ├── index.js               # Maintainer-facing module ownership manifest (not runtime)
│   ├── BOUNDARIES.md          # Module boundary constraints and import rules
│   ├── routing/               # HTTP request handling and route dispatch
│   │   ├── http-handler.js    # Main request orchestrator, route classification, lifecycle
│   │   ├── stream-route.js    # Stream request handler, episode resolution
│   │   ├── operator-routes.js # Operator diagnostic endpoints
│   │   └── request-controls.js# Policy gate evaluation (time window, session quota)
│   ├── policy/                # Business rule evaluation (deterministic, stateless)
│   │   ├── time-window.js     # Jerusalem timezone, shutdown window logic
│   │   ├── session-gate.js    # Redis Lua script for atomic session quota
│   │   └── operator-auth.js   # Token authentication
│   ├── integrations/          # External dependency clients
│   │   ├── redis-client.js    # HTTP-based Redis (Upstash) with bounded timeouts
│   │   └── broker-client.js   # Episode resolution service client
│   ├── presentation/          # Response formatting and HTML rendering
│   │   ├── stream-payloads.js # Stream JSON structure, degradation rules
│   │   ├── public-pages.js    # Landing page, public health endpoint HTML
│   │   ├── operator-diagnostics.js # Health, metrics, analytics JSON projection
│   │   └── quarantine-page.js # Error event log HTML viewer
│   └── analytics/             # Session and event tracking
│       ├── session-view.js    # Session snapshot storage, active count queries
│       ├── hourly-tracker.js  # Per-hour metric bucketing and aggregation
│       ├── nightly-rollup.js  # Daily summary consolidation
│       └── daily-summary-store.js # Daily total persistence
├── observability/             # Request context, events, logging, metrics
│   ├── context.js             # AsyncLocalStorage for correlation ID propagation
│   ├── events.js              # Event emission, failure classification
│   ├── logger.js              # Pino logger wrapper
│   ├── diagnostics.js         # Health/metrics projection utilities
│   └── metrics.js             # Reliability counter management
└── tests/                     # Contract and policy verification
    ├── contract-*.test.js     # Stream reliability, CORS, security, observability contracts
    ├── policy-*.test.js       # Time window and session gate determinism
    ├── analytics-*.test.js    # Hourly tracking and nightly rollup logic
    ├── request-controls-*.test.js # Request control gate evaluation
    ├── session-view-ttl.test.js   # Session view TTL management
    └── helpers/
        └── runtime-fixtures.js # Test runtime construction utilities
```

## Directory Purposes

**`modules/routing/`:**
- Purpose: HTTP request handling, route dispatch, request lifecycle orchestration
- Contains: Request handler factories, route classifiers, handler composition
- Key files: `http-handler.js` (main entry), `stream-route.js` (stream logic), `operator-routes.js` (diagnostics), `request-controls.js` (policy gates)

**`modules/policy/`:**
- Purpose: Business rule evaluation (shutdown windows, session gates, authentication)
- Contains: Deterministic, stateless rule engines and policy decisions
- Key files: `time-window.js` (timezone logic), `session-gate.js` (quota management), `operator-auth.js` (token validation)

**`modules/integrations/`:**
- Purpose: External service clients with resilience and bounded timeouts
- Contains: Redis HTTP client, broker episode resolver, dependency retry logic
- Key files: `redis-client.js` (Upstash HTTP), `broker-client.js` (episode service)

**`modules/presentation/`:**
- Purpose: Response payload shaping and HTML rendering
- Contains: JSON formatters, HTML builders, degradation policies
- Key files: `stream-payloads.js` (stream JSON), `public-pages.js` (HTML pages), `operator-diagnostics.js` (JSON projections), `quarantine-page.js` (error viewer)

**`modules/analytics/`:**
- Purpose: Session tracking, hourly event aggregation, daily summarization
- Contains: Redis-backed storage, hourly bucketing, TTL management
- Key files: `session-view.js` (snapshots), `hourly-tracker.js` (metrics), `nightly-rollup.js` (consolidation)

**`observability/`:**
- Purpose: Request context binding, event emission, structured logging, metrics
- Contains: AsyncLocalStorage wrapper, event classification, logger config, metric counters
- Key files: `context.js` (correlation ID), `events.js` (event/failure classification), `logger.js` (pino setup), `metrics.js` (reliability counters)

**`tests/`:**
- Purpose: Contract verification and policy determinism testing
- Contains: Node built-in test files, runtime fixtures
- Pattern: One test file per module/concern, test names reflect contracts (e.g., `contract-stream-reliability.test.js`)

## Key File Locations

**Entry Points:**
- `serverless.js`: Serverless function handler export (imports `createHttpHandler`)
- `addon.js`: Stremio SDK addon registration and manifest
- `modules/routing/http-handler.js`: Main HTTP request orchestrator (invoked per request)

**Configuration:**
- `package.json`: Dependencies, scripts (test gates), name/version metadata
- `vercel.json`: Deployment routing and builds-only serverless config
- Environment variables: Loaded in runtime files (no `.env` file committed)
  - `OPERATOR_TOKEN`: Operator endpoint authentication
  - `KV_REST_API_URL`, `KV_REST_API_TOKEN`: Redis (Upstash) connection
  - `B_BASE_URL`: Broker service base URL
  - `SLOT_TTL_SEC`, `INACTIVITY_LIMIT_SEC`, `MAX_SESSIONS`: Session quota config
  - `SHUTDOWN_START_HOUR`, `SHUTDOWN_END_HOUR`: Shutdown window hours (UTC)

**Core Logic:**
- Policy gates: `modules/policy/time-window.js`, `modules/policy/session-gate.js`
- Stream resolution: `modules/routing/stream-route.js`, `modules/integrations/broker-client.js`
- Session tracking: `modules/analytics/session-view.js`, `modules/routing/stream-route.js`

**Testing:**
- Policy tests: `tests/policy-time-window.test.js`, `tests/policy-session-gate.test.js`
- Contract tests: `tests/contract-stream-reliability.test.js`, `tests/contract-stream.test.js`
- Analytics tests: `tests/analytics-hourly.test.js`, `tests/analytics-nightly-rollup.test.js`
- Runtime fixtures: `tests/helpers/runtime-fixtures.js`

## Naming Conventions

**Files:**
- Kebab-case with purpose prefix: `[domain]-[purpose].js`
  - Examples: `http-handler.js`, `session-gate.js`, `broker-client.js`, `contract-stream.test.js`
- Test files: `[domain]-[purpose].test.js`
- Modules exposed via function exports, not barrel files

**Directories:**
- Plural nouns for domain collections: `routing`, `policy`, `integrations`, `presentation`, `analytics`, `tests`
- Functional grouping by concern, not by type (not "handlers", "clients", "models")

**Functions:**
- PascalCase for factory functions: `createHttpHandler`, `createRedisClient`, `createBrokerClient`, `createJerusalemClock`
- camelCase for pure functions: `classifyFailure`, `getJerusalemInfo`, `isWithinShutdownWindow`, `applyRequestControls`
- Async functions typically named as verbs: `handleStreamRequest`, `runAtomicSessionGate`, `executeB‌oundedDependency`, `trackHourlyEvent`

**Variables:**
- camelCase: `clientIp`, `episodeId`, `sessionKey`, `hourlyAnalyticsTtlSec`
- Constant config: `DEFAULTS` (object), `SLOT_TTL` (parsed env), `SESSION_GATE_SCRIPT` (template)
- HTTP status/code constants: `statusCode`, `statusCode`

**Types:**
- No TypeScript; object structures documented in JSDoc or inline comments
- Input/output shapes normalized in function parameter naming: `input`, `injected`, `options`, `payload`

## Where to Add New Code

**New Feature (Stream Handling):**
- Primary code: `modules/routing/stream-route.js` (if stream-specific logic) or `modules/integrations/broker-client.js` (if external service)
- Policy rules: `modules/policy/[rule-name].js`
- Response format: `modules/presentation/stream-payloads.js`
- Tests: `tests/contract-stream-*.test.js` or `tests/policy-*.test.js`

**New Component/Module:**
- Implementation: `modules/[domain]/[component].js` (choose domain: routing, policy, integrations, presentation, analytics)
- Keep files focused on one concern; break into separate files if logic exceeds ~200 lines
- Export factory or function directly; use `modules/index.js` for maintainer documentation only
- Tests: `tests/[domain]-[component].test.js`

**New Utility/Helper:**
- Observability helpers: `observability/[helper].js` (if cross-cutting: events, logging, context, metrics)
- Module-specific utilities: Keep inline or in same file if <50 lines; extract if used by multiple modules
- Tests: `tests/[domain]-[helper].test.js` (if public/important)

**Operator Endpoint:**
- Route handler: Add case in `modules/routing/operator-routes.js` → `handleOperatorRoute`
- Response format: `modules/presentation/operator-diagnostics.js` (data projection) or inline JSON
- Authentication: Handled by `modules/policy/operator-auth.js` (already applied)
- Tests: `tests/contract-observability.test.js` or new `tests/contract-[endpoint].test.js`

**Analytics Event:**
- Field definition: Add to event name list in `modules/routing/stream-route.js` or `modules/routing/request-controls.js` → `trackHourlyEvent` calls
- Hourly tracking: Use `trackHourlyEvent(redisCommand, { fields: ["event.name"], uniqueId })` (already integrated)
- Query/projection: `modules/presentation/operator-diagnostics.js` → `projectMetricsDiagnostics`
- Tests: `tests/analytics-hourly.test.js`

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
       │    ├─> modules/integrations/broker-client.js
       │    ├─> modules/presentation/stream-payloads.js
       │    └─> modules/analytics/session-view.js
       ├─> modules/routing/request-controls.js
       │    ├─> modules/policy/time-window.js
       │    ├─> modules/policy/session-gate.js
       │    └─> modules/analytics/hourly-tracker.js
       ├─> modules/presentation/public-pages.js
       ├─> modules/integrations/redis-client.js
       └─> observability/* (context, events, logger, metrics)

addon.js
  └─> modules/integrations/broker-client.js
```

---

*Structure analysis: 2026-02-28*
