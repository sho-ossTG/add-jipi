# Testing Patterns

**Analysis Date:** 2026-02-28

## Test Framework

**Runner:**
- Node.js built-in `node:test` module (no external test framework)
- Version: Node.js 18+ required for `node:test` support
- Config: None - runs directly with `node --test`

**Assertion Library:**
- `node:assert/strict` for all assertions
- Strict equality and deep comparison via `assert.equal()`, `assert.deepEqual()`

**Run Commands:**
```bash
npm run test:policy:time-window     # Run single policy test
npm run test:policy:session-gate    # Run session gate policy test
npm run test:policy:deterministic   # Run all deterministic policies
npm run test:contract:*             # Run specific contract tests
npm run test:gate:required          # Run all required gating tests
npm run test:gate:optional          # Run optional tests
npm run test:gate:all               # Run all tests
```

- Tests organized into "gates": required contracts (blocking) vs. optional contracts
- Individual test files run: `node --test tests/contract-stream.test.js`

## Test File Organization

**Location:**
- All test files in `tests/` directory at project root
- Tests are **not** co-located with source code
- Separate directory structure: `tests/` mirrors no specific source layout

**Naming:**
- Test files: `[contract|policy|analytics|request]-[name].test.js`
- Categories: `contract-*`, `policy-*`, `analytics-*`, `request-*`
- Examples: `contract-stream.test.js`, `policy-time-window.test.js`, `contract-observability.test.js`

**Test File Listing:**
```
tests/
├── contract-cors-policy.test.js         # CORS policy compliance
├── contract-manifest-catalog.test.js    # Addon manifest/catalog endpoints
├── contract-observability.test.js       # Observability event emissions
├── contract-security-boundary.test.js   # Security boundary validation
├── contract-stream.test.js              # Stream endpoint basic contract
├── contract-stream-failures.test.js     # Stream endpoint failure scenarios
├── contract-stream-reliability.test.js  # Stream endpoint reliability (13.9 KB)
├── policy-session-gate.test.js          # Session gating logic
├── policy-time-window.test.js           # Time window policy
├── analytics-hourly.test.js             # Hourly analytics tracking
├── analytics-nightly-rollup.test.js     # Nightly rollup aggregation
├── request-controls-nightly.test.js     # Request control nightly logic
├── session-view-ttl.test.js             # Session view TTL handling
├── helpers/
│   └── runtime-fixtures.js              # Mock factories and utilities
```

## Test Structure

**Suite Organization:**
- Tests organized with `test()` function from `node:test`
- Each test file imports test framework and assertion library:
```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
```
- No describe blocks or nested suites - flat test list per file
- Test descriptions are human-readable problem statements

**Example Test:**
```javascript
test("session gate admits new sessions when capacity exists", async () => {
  const decision = await runAtomicSessionGate({
    redisEval: createSessionGateRedisEval(),
    ip: "198.51.100.40",
    nowMs: NOW_MS,
    maxSessions: 2
  });

  assert.deepEqual(decision, {
    allowed: true,
    reason: "admitted:new",
    rotatedIp: "",
    activeCount: 1
  });
});
```

**Patterns:**
- Test description starts with action: "admits", "returns", "blocks", "rotates", "deterministic"
- Setup in function body - minimal external setup
- Assertions at end - typically 1-5 assertions per test
- No setup/teardown fixtures; helpers passed as parameters

## Mocking

**Framework:** Custom mocking via dependency injection + runtime factories

**Mocking Pattern - Redis Operations:**
```javascript
// Create mock Redis implementation
const redisRuntime = createRedisRuntime();

// Inject into function under test
await handler(req, res, {
  redisCommand: async (cmd) => redisRuntime.fetch(/* ... */),
  redisEval: createSessionGateRedisEval({ initialSessions })
});

// Verify state changed
assert.deepEqual(redisRuntime.state.sessions.get(ip), expectedScore);
```

**Mocking Pattern - Time/Clock:**
```javascript
// Mock Intl.DateTimeFormat for deterministic time
await withFixedJerusalemTime(async () => {
  const info = getJerusalemInfo(clock);
  assert.equal(info.hour, 2);
}, {
  hour: "02",
  minute: "30",
  second: "05"
});
```

**Mocking Pattern - Global Fetch:**
```javascript
const originalFetch = global.fetch;
global.fetch = createMockRedisFetch(mode);
// Run test
global.fetch = originalFetch;
```

**Mocking Pattern - Module Loading:**
```javascript
// Clear module cache to reload with new mocks
delete require.cache[require.resolve("../../addon")];
const addon = require("../../addon");

// Run test with fresh module instance
// ...

// Restore after test
delete require.cache[require.resolve("../../serverless")];
```

**What to Mock:**
- External dependency: Redis, HTTP calls, addon interface
- System time (Intl.DateTimeFormat, Date.now)
- Module singletons (addon interface, logger)

**What NOT to Mock:**
- Pure utility functions (time window checks, IP parsing)
- Core business logic modules under test
- Assertion methods
- Event classification functions

## Fixtures and Factories

**Test Data Factories:**
- `runtime-fixtures.js` contains all test helper factories
- No separate fixture files - all in single helpers module

**Factory Examples:**

```javascript
// Redis runtime simulation
function createRedisRuntime() {
  const state = { strings: new Map(), sessions: new Map(), lists: new Map() };
  async function fetch(_url, options = {}) {
    // Simulate Redis command responses
  }
  return { state, fetch };
}

// Session gate evaluation
function createSessionGateRedisEval({
  initialSessions = [],
  reconnectGraceMs = 15000,
  rotationIdleMs = 45000,
  inactivityLimitSec = 20 * 60
} = {}) {
  const sessions = new Map(initialSessions);
  return async function redisEval(_script, _keys, args = []) {
    // Implement session gate logic
  };
}

// Mock fetch for simple responses
function createMockRedisFetch(mode = "allow") {
  return async function fetch(_url, options = {}) {
    // Return mocked Redis responses based on mode
  };
}

// Time-based testing
function withFixedJerusalemTime(run, overrides = {}) {
  // Mock Intl.DateTimeFormat and restore after test
  Intl.DateTimeFormat = MockDateTimeFormat;
  return Promise.resolve().then(run).finally(() => {
    Intl.DateTimeFormat = originalDateTimeFormat;
  });
}

// Logger capture for observability testing
function createCaptureLogger(events, bindings = {}) {
  return {
    child(nextBindings = {}) { return createCaptureLogger(events, {...bindings, ...nextBindings}); },
    info(payload = {}) { events.push({ ...bindings, ...payload }); },
    warn(payload = {}) { events.push({ ...bindings, ...payload }); },
    error(payload = {}) { events.push({ ...bindings, ...payload }); }
  };
}
```

**Location:**
- `tests/helpers/runtime-fixtures.js` - All fixtures and factories
- Exported as named functions: `module.exports = { createRedisRuntime, createMockRedisFetch, ... }`

## Coverage

**Requirements:** Not enforced - no coverage configuration found

**Test Types - Determination Pattern:**

Tests categorized by what they validate:

**Contract Tests** (largest category - 8 files, 50+ tests):
- Validate HTTP endpoint behavior and response shapes
- Stremio addon protocol compliance
- Examples: `contract-stream.test.js`, `contract-cors-policy.test.js`
- Scope: End-to-end from HTTP request to JSON response
- Use `requestWithHandler()` to simulate full request/response cycle

**Policy Tests** (2 files, ~10 tests):
- Deterministic business logic validation
- Time window checks, session gating rules
- Examples: `policy-time-window.test.js`, `policy-session-gate.test.js`
- Scope: Unit tests of decision logic with injected dependencies

**Analytics Tests** (3 files, ~15 tests):
- Tracking and aggregation logic
- Hourly tracking, nightly rollup, TTL handling
- Examples: `analytics-hourly.test.js`, `analytics-nightly-rollup.test.js`
- Scope: Redis interaction and data transformation

**Reliability Tests** (1 file, ~12 tests):
- `contract-stream-reliability.test.js` - Largest test file (14 KB)
- Tests determinism under concurrent requests, stream sharing logic, retry behavior
- Scope: Complex concurrent scenarios with detailed state verification

## Common Patterns

**Async Testing:**
```javascript
test("async operation completes successfully", async () => {
  // Test is async function - await all async operations
  const result = await asyncFunction({ param });

  // Assertions after await
  assert.equal(result.statusCode, 200);
});
```

**Error Testing:**
```javascript
test("validates input and throws on missing required param", async () => {
  // Call function with invalid input
  try {
    await runAtomicSessionGate({ /* missing ip */ });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.message, "runAtomicSessionGate requires ip");
  }
});
```

**State Verification:**
```javascript
test("updates session state correctly", async () => {
  const redisRuntime = createRedisRuntime();

  // Run operation
  await someFunc({ /* ... */, redisCommand: redisRuntime.fetch });

  // Verify final state
  assert.deepEqual(
    redisRuntime.state.sessions.get(ip),
    expectedScoreValue
  );
});
```

**Parametric Testing (Table-Driven):**
```javascript
test("shutdown window boundaries are deterministic", () => {
  const cases = [
    { label: "00:00", hour: 0, expected: true },
    { label: "08:00", hour: 8, expected: false }
  ];

  for (const entry of cases) {
    const result = isWithinShutdownWindow({ hour: entry.hour });
    assert.equal(result, entry.expected, `expected ${entry.label} to be ${entry.expected}`);
  }
});
```

**Integration Testing Pattern:**
```javascript
// Full request/response cycle with mocked Redis and time
async function request(pathname, options = {}) {
  const { mode = "allow", resolveEpisode } = options;

  setRedisEnv(); // Set mock env vars
  global.fetch = createMockRedisFetch(mode);
  const addon = loadAddon();
  const handler = loadServerless();

  try {
    return await requestWithHandler(handler, pathname, {
      ip: "203.0.113.1",
      headers: { "x-forwarded-for": "203.0.113.1" }
    });
  } finally {
    // Cleanup
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
}

test("endpoint returns contract-valid response", async () => {
  const response = await request("/stream/series/tt0388629%3A1%3A1.json");
  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.streams));
});
```

## Reliability & Resilience Testing

**Determinism Pattern:**
Tests verify behavior is deterministic across multiple scenarios:
- Time boundaries (exact hours, before/after cutoff)
- Concurrent request handling (duplicate requests coalesce)
- Session rotation under load (fair ordering by idle time)
- Retry logic under network failures (jitter bounded)

**Examples from Test Files:**
```javascript
// contract-stream-reliability.test.js - tests determinism extensively
test("duplicate in-flight requests for same client and episode share one resolve path", async () => {
  // Launch multiple concurrent requests for same episode
  // Verify they coalesce and share single upstream call
});

test("fair idle rotation admits contender by replacing oldest idle session", async () => {
  // Sessions with different idle times compete for slot
  // Verify oldest idle is evicted (deterministic ordering)
});

test("broker resolve retries once on transient HTTP failure", async () => {
  // Mock transient 500 error
  // Verify automatic retry happens within bounded budget
});
```

---

*Testing analysis: 2026-02-28*
