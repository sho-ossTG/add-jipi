# Codebase Structure

**Analysis Date:** 2026-02-25

## Directory Layout

```text
add-jipi/
├── .planning/
│   └── codebase/              # Generated codebase mapping documents
├── modules/
│   ├── analytics/             # Event counting, session views, nightly rollup
│   │   ├── daily-summary-store.js
│   │   ├── hourly-tracker.js
│   │   ├── nightly-rollup.js
│   │   └── session-view.js
│   ├── integrations/          # External dependency clients
│   │   ├── broker-client.js
│   │   └── redis-client.js
│   ├── policy/                # Business rule evaluation
│   │   ├── operator-auth.js
│   │   ├── session-gate.js
│   │   └── time-window.js
│   ├── presentation/          # Response shaping and HTML rendering
│   │   ├── operator-diagnostics.js
│   │   ├── public-pages.js
│   │   ├── quarantine-page.js
│   │   └── stream-payloads.js
│   ├── routing/               # HTTP request lifecycle orchestration
│   │   ├── http-handler.js
│   │   ├── operator-routes.js
│   │   ├── request-controls.js
│   │   └── stream-route.js
│   ├── BOUNDARIES.md          # Import direction rules and ownership contracts
│   └── index.js               # Maintainer manifest — NOT a runtime import
├── observability/
│   ├── context.js             # Correlation ID via AsyncLocalStorage
│   ├── diagnostics.js         # Operator diagnostics aggregation
│   ├── events.js              # EVENTS enum, classifyFailure, emitEvent
│   ├── logger.js              # Pino logger factory with component tagging
│   ├── metrics.js             # Reliability counters (Redis hash read/write)
│   └── TEST-GATES.md          # Test gate membership documentation
├── tests/
│   ├── helpers/
│   │   └── runtime-fixtures.js        # Mock Redis and runtime factories
│   ├── analytics-hourly.test.js
│   ├── analytics-nightly-rollup.test.js
│   ├── contract-observability.test.js
│   ├── contract-security-boundary.test.js
│   ├── contract-stream-failures.test.js
│   ├── contract-stream-reliability.test.js
│   ├── contract-stream.test.js
│   ├── request-controls-nightly.test.js
│   └── session-view-ttl.test.js
├── addon.js                   # Stremio manifest, catalog/stream handlers, resolveEpisode
├── package.json               # Scripts, dependencies, test runner (node --test)
├── package-lock.json          # Dependency lockfile
├── serverless.js              # Vercel entry: re-exports createHttpHandler
└── vercel.json                # Vercel build config (builds-only, maxDuration: 60)
```

## Directory Purposes

**`modules/`:**
- Purpose: All application logic organized by bounded responsibility.
- Subdirectories: `routing`, `policy`, `integrations`, `analytics`, `presentation`.
- Key files: `BOUNDARIES.md` (import rules), `index.js` (maintainer manifest only — never imported).

**`modules/routing/`:**
- Purpose: HTTP request lifecycle — route classification, CORS, session gating, stream resolution.
- Key file: `http-handler.js` (entry for all requests).

**`modules/policy/`:**
- Purpose: Deterministic business rules with no external I/O of their own.
- Key file: `session-gate.js` (Lua atomic ZSET gate).

**`modules/integrations/`:**
- Purpose: Encapsulate all external transport — Redis REST and broker HTTP.
- Key files: `redis-client.js`, `broker-client.js`.

**`modules/analytics/`:**
- Purpose: Track request events and aggregate into daily summaries.
- Key files: `hourly-tracker.js`, `nightly-rollup.js`.

**`modules/presentation/`:**
- Purpose: Format responses — Stremio stream payloads, HTML pages, diagnostics.
- Key file: `stream-payloads.js` (`formatStream`, `sendDegradedStream`).

**`observability/`:**
- Purpose: Cross-cutting concerns — structured logging (pino), metrics, correlation IDs.
- Key files: `events.js` (all telemetry flows through here), `metrics.js` (reliability counters), `context.js` (correlation ID).

**`tests/`:**
- Purpose: Contract tests and integration tests using Node's built-in `node:test` runner.
- Key file: `tests/helpers/runtime-fixtures.js` (mock Redis, mock broker, shared test factories).

## Key File Locations

**Entry Points:**
- `serverless.js` — Vercel runtime entry; thin re-export of `createHttpHandler`.
- `addon.js` — Stremio addon interface; also exposes `resolveEpisode` for routing layer.
- `package.json` — Local start: `node serverless.js`.

**Configuration:**
- `vercel.json` — Build target (`@vercel/node`), catch-all route, `maxDuration: 60`.
- `package.json` — Test scripts, runtime type (`commonjs`), dependency declarations.

**Core Logic:**
- `modules/routing/http-handler.js` — Top-level request handler, composes all boundaries.
- `modules/routing/stream-route.js` — Episode share cache and broker resolution.
- `modules/routing/request-controls.js` — Shutdown window + session gate.
- `modules/policy/session-gate.js` — Lua atomic session admission script.
- `modules/integrations/broker-client.js` — Broker HTTP client with retry.
- `observability/events.js` — `classifyFailure`, `emitEvent`, `EVENTS` enum.

**Boundary Rules:**
- `modules/BOUNDARIES.md` — Enforced by code review; static lint is deferred to a future phase.

## Naming Conventions

**Files:**
- `kebab-case.js` throughout `modules/` and `observability/`.
- Root-level files use lowercase role names: `addon.js`, `serverless.js`.
- Config files match platform/tooling convention: `package.json`, `vercel.json`.

**Directories:**
- Lowercase singular names matching responsibility: `routing`, `policy`, `integrations`, `analytics`, `presentation`.
- Dot-prefixed for tooling/meta: `.planning`.

## Where to Add New Code

**New route or endpoint:**
- Add route handler in `modules/routing/` (e.g., `modules/routing/new-route.js`).
- Wire from `http-handler.js`.
- Add presentation rendering in `modules/presentation/` if HTML/JSON formatting is needed.

**New external dependency:**
- Add client in `modules/integrations/` (e.g., `modules/integrations/new-service.js`).
- Inject via `injected` pattern; do not import directly from `routing` or `presentation`.

**New business rule:**
- Add to `modules/policy/` if the rule is deterministic and stateless (or uses injected Redis).
- Keep pure functions separate from I/O.

**New analytics event:**
- Use `trackHourlyEvent(redisCommand, { bucket, fields, uniqueId }, options)` from `modules/analytics/hourly-tracker.js`.
- Field names follow `event.subtype` convention (e.g., `stream.success`, `policy.blocked`).

**New test:**
- Place in `tests/` with `.test.js` suffix.
- Use factories from `tests/helpers/runtime-fixtures.js`.
- Add to `package.json` test scripts and `observability/TEST-GATES.md`.

## Special Directories

**`.planning/codebase/`:**
- Purpose: Generated architecture and quality reference documents.
- Generated: Yes — by `gsd-codebase-mapper` agents.
- Committed: Yes.

**`modules/BOUNDARIES.md`:**
- Purpose: Documents allowed and forbidden import directions between module boundaries.
- Enforced: By code review (no static lint yet).

---

*Structure analysis: 2026-02-25*
