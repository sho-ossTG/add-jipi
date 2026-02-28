# Coding Conventions

**Analysis Date:** 2026-02-28

## Naming Patterns

**Files:**
- Kebab-case for file names: `stream-route.js`, `redis-client.js`, `session-gate.js`
- Test files use `.test.js` suffix: `contract-stream.test.js`, `policy-time-window.test.js`
- Convention: no index files in modules, use descriptive names instead

**Functions:**
- camelCase for all function declarations: `createRedisClient()`, `executeAsyncFunc()`, `handleStreamRequest()`
- Verb prefixes for action functions: `create*`, `get*`, `set*`, `run*`, `handle*`, `apply*`, `build*`, `normalize*`
- Prefix functions that return factories or builders with `create` or `build`: `createRedisClient()`, `buildEpisodeShareKey()`
- Query/accessor functions use `get`: `getRedisConfig()`, `getLatestSelection()`, `getTrustedClientIp()`
- Predicate functions use `is`: `isWithinShutdownWindow()`, `isCurrentEpisodeSelection()`, `isTransientDependencyFailure()`
- Functions that check/validate use `parse` or `normalize`: `parseEpisodeShare()`, `normalizeAllowedIps()`, `normalizeCor relationId()`

**Variables:**
- camelCase for all variables: `inFlightStreamIntents`, `latestStreamSelectionByClient`, `startedAt`
- Uppercase with underscores for constants: `DEFAULT_TIME_ZONE`, `SLOT_TTL`, `EPISODE_SHARE_MAX_IPS`
- Prefix utility Maps with descriptive names: `inFlightStreamIntents` (stores promises), `latestStreamSelectionByClient` (caches)
- Use descriptive suffixes for related values:
  - Time values: `createdAtMs`, `nowMs`, `expiresAtMs`, `Timeout`, `TTL`
  - Collections: `...Map`, `...Set`, `...Array` (implicit in naming when unclear)
  - HTTP/network: `statusCode`, `response`, `request`, `headers`

**Types:**
- No TypeScript in codebase - vanilla JavaScript with JSDoc annotations when complex
- Document parameter objects as nested structures in function comments
- Use Object.freeze() for constant objects and config

**Exports:**
- Named exports via `module.exports = { functionName, anotherFunc }`
- Avoid default exports; use named imports: `const { func } = require("./module")`
- Match export names to function/constant names exactly

## Code Style

**Formatting:**
- No linter/formatter config found (`.eslintrc` or `.prettierrc` absent)
- Observed style:
  - 2-space indentation (consistent across all files)
  - Single quotes for strings: `'string'` preferred
  - Semicolons required at end of statements
  - Trailing commas in multi-line objects/arrays

**Linting:**
- No linting enforced in development or CI
- Convention: developers follow Node.js best practices manually

## Import Organization

**Order:**
1. Built-in Node.js modules: `const test = require("node:test")`
2. Third-party packages: `const pino = require("pino")`
3. Local module imports (relative paths): `const { func } = require("../../../module")`
4. Constants and variable declarations follow imports

**Path Style:**
- Relative paths with `../` pattern: `require("../integrations/redis-client")`
- Import statement order consistent with entry point to leaf relationships
- No path aliases used in codebase

**Module Loading Pattern:**
```javascript
const { createRedisClient } = require("../integrations/redis-client");
const defaultTimeWindow = require("../policy/time-window");
```
- Destructure specific exports when targeting individual functions
- Use direct assignment for modules exporting entire namespace

## Error Handling

**Patterns:**
- Errors have explicit `.code` property for classification: `error.code = "redis_config_missing"`
- Error codes are snake_case: `dependency_timeout`, `redis_http_error`, `redis_response_error`
- Status codes attached when relevant: `error.statusCode = 404`
- Error classification via `classifyFailure()` function in `observability/events.js`

**Throw Strategy:**
- Create error with `.code` then throw:
```javascript
const err = new Error("Missing Redis configuration");
err.code = "redis_config_missing";
throw err;
```
- Try/catch blocks catch by type, re-throw with classification
- "Best-effort" patterns: catch silently in non-critical paths with comment explaining why

**Validation:**
- Input validation at function entry with guard clauses
- Return null/empty for invalid inputs when safe: `return null`, `return []`, `return {}`
- Throw errors only for truly exceptional conditions (missing deps, bad config)

## Logging

**Framework:** Pino (optional fallback to console.log)

**Patterns:**
- `getLogger()` returns logger with correlation ID bound
- Log redaction configured for sensitive paths: `headers.authorization`, `token`, `refreshToken`
- Structured logging via `logger.info()`, `logger.warn()`, `logger.error()`
- Logger methods take payload objects: `logger.info({ message: "text", data })`
- Fallback logger in `observability/logger.js` if Pino unavailable

**Observability Integration:**
- Events emitted via `emitEvent()` with event names from `EVENTS` enum
- Events include source, cause, and correlation ID automatically
- Dependency failures classified via `classifyFailure()` for consistent categorization

## Comments

**When to Comment:**
- Comments explain business logic or non-obvious decisions
- Implementation details in close function calls rarely commented
- Comments clarify complex calculations: time windows, slot rotation logic
- Comments mark "best-effort" paths that fail silently for resilience

**JSDoc/TSDoc:**
- Not heavily used - codebase is JavaScript, not TypeScript
- Comments on complex functions describe inputs/outputs when unclear
- Functions with injected dependencies document injection parameters

**Example Patterns:**
```javascript
// Reliability counters are best-effort and must not affect responses.
try {
  await incrementReliabilityCounter(redisCommand, labels);
} catch {
  // Silently continue - not critical to response
}

// Comments on time zone sensitive logic
function getJerusalemInfo(clock = createJerusalemClock()) {
  // Uses Intl.DateTimeFormat with Asia/Jerusalem timezone
```

## Function Design

**Size:** Functions typically 10-50 lines. Larger functions (80+ lines) break work into smaller helpers:
- `http-handler.js` main handler: ~160 lines split across 15+ helper functions
- `stream-route.js`: 290 lines with 10+ internal helpers

**Parameters:**
- Use object parameters for functions with multiple options:
```javascript
async function runAtomicSessionGate(input) {
  const { redisEval, ip, nowMs = Date.now(), ...other } = input || {};
}
```
- Provide sensible defaults via destructuring
- Prefix options objects to clarify: `options.env`, `dependencies.redisCommand`, `injected.emitTelemetry`

**Return Values:**
- Return structured objects with clear properties: `{ allowed: true, reason: "admitted:new", rotatedIp: "", activeCount: 1 }`
- Return null for "not found": `parseEpisodeShare(raw)` returns null for invalid JSON
- Return empty arrays for empty results: `normalizeAllowedIps([])` returns `[]`
- Async functions always return promises (even for void operations)

## Module Design

**Exports:**
- Each module exports specific functions and constants, no default exports
- Module.exports uses object literal: `module.exports = { func1, func2, constant }`
- Private functions declared without export in same file
- No private key convention (underscore prefix not used)

**Barrel Files:**
- Single index file at `modules/index.js` documents module structure
- Index is maintainer-only reference, not used by runtime code
- Runtime imports go directly to specific modules: `require("./integrations/redis-client")`

**Dependencies Injection:**
- Functions accept `injected` or `options` parameter for dependencies
- Allows test mocking and loose coupling:
```javascript
async function handleStreamRequest(input = {}, injected = {}) {
  const { redisCommand, resolveEpisode, sendJson } = injected;
  // Use injected deps, with sensible runtime defaults elsewhere
}
```
- Called with `{ req, pathname, ...data }` as first param, dependencies as second

**Singleton Pattern:**
- Redis client created once at module load: `const redisClient = createRedisClient()`
- Session/stream tracking kept in module-level Maps: `const inFlightStreamIntents = new Map()`
- Logger instance cached: `let baseLogger; getBaseLogger()` returns cached instance

## Async/Await

**Patterns:**
- All async operations use async/await, no Promise.then() chains (except setup)
- Try/catch for error handling in async functions
- Timeout handling via `AbortSignal.timeout(ms)` in fetch calls
- Concurrent operations with `Promise.all()` when multiple independent ops needed

**Bounded Execution:**
- `executeBoundedDependency()` wraps async calls with timeout + retry budget
- Retry logic: maximum 2 attempts, exponential backoff with jitter
- Elapsed time tracking: `const elapsed = Date.now() - startedAt`

## Testing Conventions in Source

**Test Data Setup:**
- Fixed test constants at module load: `const NOW_MS = 1_700_000_000_000`
- Mocking via dependency injection: `createSessionGateRedisEval({ initialSessions })`
- Environment variable setup in helpers: `setRedisEnv()`

**Constants Organization:**
- Defaults bundled in objects: `const DEFAULTS = Object.freeze({ ... })`
- Constants never mutated - use `Object.freeze()` for config objects
- Separation: code defaults vs. parameter defaults

---

*Convention analysis: 2026-02-28*
