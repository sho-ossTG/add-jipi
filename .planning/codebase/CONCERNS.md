# Codebase Concerns

**Analysis Date:** 2026-02-28

## Known Bugs (Documented)

Six confirmed bugs exist in the current codebase as shipped. These are silent failures—tests pass but functionality is broken.

### Bug 1: Analytics Gap in Shutdown Window

**Issue:** `trackPolicyEvent()` call was deleted from shutdown window path in commit 7700b50.

**Files:** `modules/routing/request-controls.js` (line 108-119)

**Impact:** Requests blocked during shutdown window are silently excluded from hourly analytics. The `REQUEST_TOTAL` and `POLICY_BLOCKED` counters don't increment for shutdown-window rejections, making analytics incomplete during planned maintenance windows.

**Current behavior:**
```javascript
if (isWithinShutdownWindow(info, injected.shutdownWindow || {})) {
  await runNightlyMaintenance();
  // ... telemetry emitted ...
  return { allowed: false, reason: "blocked:shutdown_window" };
  // Missing: await trackPolicyEvent([...], ip);
}
```

**Fix approach:** Add `await trackPolicyEvent(["requests.total", "policy.blocked", "policy.blocked:shutdown_window"], ip);` before returning `{ allowed: false }`.

---

### Bug 2: HyperLogLog Unique Tracking Non-Functional

**Issue:** `uniqueId` parameter is accepted and passed by callers, but PFADD calls were never implemented.

**Files:** `modules/analytics/hourly-tracker.js` (lines 27-61)

**Impact:** Unique-IP counting is completely broken. The function accepts `uniqueId` but never writes HyperLogLog entries. Returns `uniqueTracked: false` explicitly (line 59), indicating this is incomplete implementation.

**Current behavior:**
```javascript
async function trackHourlyEvent(redisCommand, input = {}, options = {}) {
  // ... accepts input.uniqueId but never uses it ...
  for (const field of fields) {
    const countField = `${bucket}|${field}|count`;
    // Missing: PFADD analytics:unique:{bucket} uniqueId
    await redisCommand(["HINCRBY", key, countField, "1"]);
  }
  return { key, bucket, tracked: fields.length, uniqueTracked: false };
}
```

**Fix approach:** For each field, also execute `PFADD analytics:unique:${bucket} ${uniqueId}` to track unique IPs per hour.

---

### Bug 3: Daily Rollup Unique Count Always Zero

**Issue:** Rollup queries HyperLogLog but it was never populated (follows from Bug 2).

**Files:** `modules/analytics/nightly-rollup.js` (entire file)

**Impact:** Daily summary `uniqueEstimateTotal` is always 0. The field exists but no PFCOUNT is performed, and unique HLL keys are never deleted during cleanup.

**Expected behavior:**
1. Query `PFCOUNT analytics:unique:{bucket}` for each hour in the rolled-up day
2. Sum unique counts into `uniqueEstimateTotal`
3. Delete HLL keys during cleanup: `DEL analytics:unique:*` for the day's buckets

**Current implementation:** No HyperLogLog operations exist. Field would be `uniqueEstimateTotal: 0` as default.

**Fix approach:** In rollup loop (around line 140+), add PFCOUNT calls per bucket and sum results. Add cleanup DEL calls for unique HLL keys.

---

### Bug 4: Four Test Files Not Wired to Test Gates

**Issue:** Test files exist but aren't included in any npm script.

**Files:**
- `tests/analytics-hourly.test.js`
- `tests/analytics-nightly-rollup.test.js`
- `tests/session-view-ttl.test.js`
- `tests/request-controls-nightly.test.js`

**Impact:** These tests never run in CI. Regressions in their covered functionality won't be caught.

**Current state:**
- `package.json` has `test:gate:required`, `test:gate:optional`, `test:gate:all` but only 9 test files are referenced
- These 4 files are in `/tests/` directory but wired to nothing

**Fix approach:**
1. Add individual npm scripts: `test:analytics:hourly`, `test:analytics:nightly`, `test:session-view-ttl`, `test:request-controls-nightly`
2. Add all four to `test:gate:optional` in existing script
3. Ensure `test:gate:all` runs them

---

### Bug 5: Stale Cache Key in Test Mock

**Issue:** Mock Redis in test fixtures still uses old per-IP cache key format.

**Files:** `tests/helpers/runtime-fixtures.js` (in `createMockRedisFetch()`)

**Impact:** Mock accepts `active:url:*` GETs (old format) instead of `episode:share:*` (new format). The mock returns "1" for these keys, which `parseEpisodeShare("1")` rejects gracefully in `stream-route.js` line 22, so tests pass by accident.

**Current behavior:**
```javascript
// Old format: active:url:{episodeId}
// New format: episode:share:{episodeId}
// Mock likely still checks 'active:url:*' → returns dummy value
// Correct pattern: 'episode:share:*' → null
```

**Fix approach:** Update mock `GET` handler to check for `episode:share:*` pattern instead of `active:url:*`. Return null for unmatched keys.

---

### Bug 6: Session Index Conflates Two Sorted Sets

**Issue:** Test mock `createRedisRuntime()` routes both session gate entries AND session view entries into same `state.sessions` map.

**Files:** `tests/helpers/runtime-fixtures.js` (in `createRedisRuntime()`)

**Impact:**
- `ZADD system:active_sessions <ms> <ip>` (session gate) goes into `state.sessions`
- `ZADD sessions:view:active <ms> <sha256hash>` (session view) also goes into `state.sessions`
- These are different data: one tracks IPs for connection limits, other tracks session identity hashes for analytics
- `state.sessions.size` is inflated, affecting `EVAL` session gate logic
- Only harmless in current tests because `MAX_SESSIONS=20` is very permissive

**Example issue:**
```javascript
// Session gate script expects: ZCARD system:active_sessions → count of IPs
// Session view tracker calls: ZADD sessions:view:active → hashes
// Both land in same mock map → ZCARD returns wrong count under load
```

**Fix approach:** In `createRedisRuntime()`, maintain separate Map instances:
- `state.sessions` for `system:active_sessions` (gate)
- `state.sessionViews` for `sessions:view:active` (tracking)
- Route ZADD/ZCARD/ZRANGE commands to correct map based on key

---

## Memory Leaks and Resource Exhaustion

### In-Memory Maps Without Bounds

**Issue:** Two global Maps in stream request handler grow unbounded.

**Files:** `modules/routing/stream-route.js` (lines 5-6)

**Risk:** Memory leak in long-running serverless processes.

**Current state:**
```javascript
const inFlightStreamIntents = new Map();  // Promise cache
const latestStreamSelectionByClient = new Map();  // Client selection tracker
```

**Problematic patterns:**
1. `latestStreamSelectionByClient` has TTL-based cleanup in `pruneLatestSelections()` (line 64-70) but is only called when marking a selection, not on every request
2. `inFlightStreamIntents` auto-deletes on promise settlement (line 98), but if promises never settle, entries remain forever
3. No maximum size limits; in production with thousands of concurrent clients, these could grow unboundedly

**Current mitigations:**
- `pruneLatestSelections()` removes entries older than 5 minutes (LATEST_SELECTION_TTL_MS)
- But pruning is lazy—only happens when new selections are marked
- During traffic lulls, stale entries persist indefinitely

**Fix approach:**
1. Add explicit maximum size enforcement (e.g., max 10,000 concurrent selections)
2. Add periodic cleanup timer independent of request flow
3. Consider using LRU cache library instead of native Map

**Severity:** Medium — Serverless processes restart frequently, but could accumulate memory within a single warm container lifespan.

---

## Error Handling Gaps

### Silent Error Suppression in Analytics Paths

**Issue:** Multiple paths suppress errors without logging.

**Files:**
- `modules/routing/http-handler.js` (line 342-344, 477-479, 491-493)
- `modules/routing/stream-route.js` (line 328-330, 363-365)
- `modules/routing/request-controls.js` (line 86-88, 101-105)

**Impact:** Analytics and reliability tracking failures are completely silent. If Redis is down for analytics, operators have no visibility—response still succeeds but metrics are lost.

**Examples:**
```javascript
try {
  await incrementReliabilityCounter(redisCommand, labels);
} catch {
  // Reliability counters are best-effort and must not affect responses.
}

try {
  await injected.trackHourlyEvent(injected.redisCommand, {...});
} catch {
  // Hourly analytics are best-effort and must not affect requests.
}
```

**Problem:** "Best-effort" paths should still emit warnings to logs when they fail repeatedly. Current implementation has zero visibility.

**Fix approach:**
1. Add counter/rate-limiting for error logging (avoid spam)
2. Log failures at `warn` level with context
3. Emit telemetry event indicating analytics path failure

**Severity:** Low — Doesn't affect response quality, but hides operational issues.

---

## Security Considerations

### User-Agent and IP Storage Without Sanitization

**Issue:** Raw request headers are stored in Redis session views.

**Files:** `modules/analytics/session-view.js` (lines 32-33, 43, 49-50)

**Current behavior:**
```javascript
const ip = normalizeText(input.ip) || "unknown";
const userAgent = normalizeText(input.userAgent) || "unknown";
// Stored directly in Redis as SHA256 hash input and JSON
```

**Risk:**
1. User-Agent header can contain attacker-controlled data (though normalized via `.trim()`)
2. SHA256 hash is built from `ip\n${userAgent}` but userAgent could be extremely long
3. JSON serialization could be exploited if malformed

**Mitigation already in place:**
- `normalizeText()` trims whitespace
- Session identity is hashed (not stored raw)
- Size of fields limited implicitly (Redis value size limits)

**Recommendation:** Add explicit length limits before hashing:
```javascript
const userAgent = normalizeText(input.userAgent || "").substring(0, 256);
```

**Severity:** Low — Current mitigations are adequate, but defense-in-depth would be better.

---

### Missing Rate Limit on Broker Resolution

**Issue:** Episode resolution requests to broker are rate-limited per IP but not globally.

**Files:** `modules/routing/stream-route.js` (line 122+), `modules/integrations/broker-client.js`

**Current behavior:**
- Session gate limits concurrent IPs to `MAX_SESSIONS` (default 2)
- But each IP can request a new episode without rate limiting
- Broker is called per unique episode ID (no request deduplication across IPs)
- `inFlightStreamIntents` only deduplicates same IP + same episode

**Risk:** If broker is slow or down, many IPs could pile up waiting, exhausting memory and connection pools.

**Existing protections:**
- `executeBoundedDependency()` has timeouts (900ms per attempt, 1800ms total)
- Only 2 retries maximum
- Still, slow broker could cause accumulation

**Fix approach:** Add broker request deduplication at HTTP handler level, not just per-IP basis.

**Severity:** Low — Current timeouts prevent indefinite waits, but could be more robust.

---

## Performance Bottlenecks

### Session Gate EVAL Script Complexity

**Issue:** Redis LUA script in session gate has O(n) complexity.

**Files:** `modules/policy/session-gate.js` (lines 10-63)

**Impact:** With `MAX_SESSIONS=2`, gate evaluates ~3 members per request. Not a bottleneck now, but if `MAX_SESSIONS` grows, ZRANGE + iteration becomes O(MAX_SESSIONS).

**Current complexity:**
```lua
local members = redis.call("ZRANGE", sessions, 0, -1, "WITHSCORES")  -- O(n)
for i = 1, #members, 2 do  -- O(n) iteration
  -- rotation logic
```

**Safe at current scale:** `MAX_SESSIONS=2` means ~4 operations per request.

**Risk if scaled:** No production use case documented for MAX_SESSIONS > 10, so not immediate concern.

**Improvement:** Cache member list at script boundary or use ZRANGE BYSCORE with limits.

**Severity:** Low — Current scale is fine, but document the limit.

---

## Fragile Areas

### Dependency Injection Chains Are Deep and Implicit

**Issue:** Stream request handler requires 20+ injected functions/values, many optional.

**Files:** `modules/routing/stream-route.js` (line 294+, 334+), `modules/routing/http-handler.js` (line 369-385)

**Risk:**
1. Missing optional dependency silently creates stub behavior (line 306: `isSupportedEpisode || ((id) => id.startsWith("tt0388629"))`)
2. Hard to audit which dependencies are required vs optional
3. Test fixtures must replicate this entire chain correctly

**Example chain:**
```javascript
streamInjected = {
  redisCommand, resolveEpisode, sendJson, sendDegradedStream, emitTelemetry,
  classifyFailure, events, degradedPolicy, fallbackVideoUrl, sessionViewTtlSec,
  inactivityLimitSec, hourlyAnalyticsTtlSec, trackHourlyEvent,
  // Request-specific overrides:
  requestUserAgent, requestRoute, requestStartedAt, correlationId,
  trackSessionView, // optional
  trackHourlyEvent, // optional override
  isSupportedEpisode, // optional
  streamPayloads, formatStream, sendDegradedStream, // optional
  ...
}
```

**Safe mitigations:**
- All tests pass, meaning mocks are complete
- Required dependencies throw errors early (line 124: "requires injected.redisCommand")
- Type system would help but not present (CommonJS)

**Fix approach:**
1. Document required vs optional dependencies in comments
2. Add validation function that checks all required deps at handler init
3. Consider schema/validation object instead of loose properties

**Severity:** Medium — Works in practice, but risky for future maintainers.

---

### Shutdown Window Time-Based Logic

**Issue:** Shutdown window blocking is time-based and depends on Jerusalem timezone calculations.

**Files:** `modules/policy/time-window.js`, `modules/routing/request-controls.js` (line 108)

**Risk:**
1. Logic depends on `getJerusalemInfo()` returning correct hour and date
2. If Jerusalem timezone has DST transition, hour calculation could be off
3. No way to override time in production for testing
4. Bug in timezone logic would silently allow/block wrong traffic

**Safe mitigations:**
- Tests mock `timeWindow.createJerusalemClock()` explicitly
- Timezone library (if used) handles DST
- Only blocks during single hour window, so worst case is 1-hour window off

**Improvement:** Add `X-Shutdown-Hour` header override for testing, emit telemetry showing calculated hour.

**Severity:** Low — Test coverage exists, logic is simple.

---

## Test Coverage Gaps

### Session Gate Script Logic Only Tested at Boundaries

**Issue:** LUA script in `modules/policy/session-gate.js` is complex but only tested through wrapper function.

**Files:** `modules/policy/session-gate.js`, `tests/policy-session-gate.test.js`

**Gap:** ZRANGE rotation logic (lines 36-60) is only tested with 2-3 concurrent IPs. No tests for:
- Exact order of rotation (should be oldest, then alphabetical tiebreak)
- Boundary conditions (all IPs in grace period, all idle)
- Interaction with jitter/randomness in reconnectGraceMs

**Impact:** Rotation bug would affect user ability to reconnect, but might not be caught by existing tests.

**Fix approach:** Add dedicated LUA script tests with larger datasets (10+ IPs, varied timestamps).

**Severity:** Low — Current tests pass, rotation logic is deterministic in tests.

---

### Stream Route Request Handling Not Fully Covered

**Issue:** `modules/routing/stream-route.js` has complex branching for cache hits, shares, degraded states, but test coverage is indirect.

**Files:** `modules/routing/stream-route.js` (lines 122-292), `tests/contract-stream.test.js`

**Gaps:**
1. Episode sharing logic (lines 166-194) — branches for max IPs, expiry, join scenarios
2. Cache invalidation on stale selections (lines 273-292) — while loop could infinite-loop
3. Error recovery paths — what happens if Redis fails mid-share-update?

**Current testing:** Stream reliability tests use mocked Redis with predefined behavior. Tests pass but don't exercise all paths.

**Fix approach:** Add parametrized tests for share scenarios (full, expired, joining, etc.).

**Severity:** Medium — Potential for unexpected behavior in production, but tests catch major failures.

---

### Operator Routes and Diagnostics Untested

**Issue:** `/operator/` routes and diagnostics endpoints have no dedicated tests.

**Files:** `modules/routing/operator-routes.js`, `modules/presentation/operator-diagnostics.js`

**Impact:** Operator endpoints could have bugs without affecting test scores. Current coverage comes from observability tests only.

**Severity:** Low — Endpoints are simple read-only diagnostics, low risk.

---

## Dependency Risks

### Stremio Addon SDK Tightly Coupled

**Issue:** SDK is used directly for routing and manifest.

**Files:** `modules/routing/http-handler.js` (line 1), `addon.js` (line 1)

**Risk:**
- Version is pinned to `^1.6.10` in package.json
- No wrapper abstraction; SDK router is called directly (line 516 in http-handler)
- If SDK has breaking changes, entire addon fails

**Mitigation:** Version range allows minor/patch updates; breaking changes would require major version change. Current version is stable.

**Recommendation:** Consider wrapper interface for SDK to ease future migration.

**Severity:** Low — Dependency is stable; not a blocker.

---

### Redis Configuration Requires Environment Variables

**Issue:** Redis connection is configured via environment variables only.

**Files:** `modules/integrations/redis-client.js` (lines 66-71), `modules/integrations/broker-client.js` (line 134)

**Risk:**
- No validation that required vars are set until first request
- Error message "Missing Redis configuration" (line 100) is generic

**Mitigation:** Errors are thrown early and clearly. Tests verify this.

**Improvement:** Validate on server startup, not first request.

**Severity:** Low — Current approach works for serverless; validation at startup would be nice-to-have.

---

## Missing Critical Features

### No Metrics Aggregation Endpoint

**Issue:** Reliability metrics are tracked but not exposed.

**Files:** `observability/metrics.js` (has `readReliabilitySummary()`)

**Current state:**
- `/health/details` endpoint exists and calls `readReliabilitySummary()`
- But endpoint is operator-only (requires `X-Operator-Token`)
- No public metrics endpoint

**Impact:** Monitoring systems can't scrape metrics without authentication.

**Fix approach:** Add `/metrics` endpoint with Prometheus-style output (optional).

**Severity:** Low — Diagnostics are available to operators; public metrics aren't needed unless monitoring is external.

---

## Technical Debt Summary

| Issue | Priority | Effort | Risk |
|-------|----------|--------|------|
| Bug 1: Shutdown analytics gap | **High** | Small | Medium |
| Bug 2: HyperLogLog unimplemented | **High** | Small | Medium |
| Bug 3: Rollup unique count | **High** | Small | Medium |
| Bug 4: Test files not wired | **High** | Trivial | Medium |
| Bug 5: Stale cache key in mock | **Medium** | Trivial | Low |
| Bug 6: Sorted set conflation | **Medium** | Medium | Low |
| Memory leak in client maps | **Medium** | Small | Low |
| Error logging in analytics paths | **Low** | Small | Low |
| Rate limiting on broker | **Low** | Medium | Low |
| Dependency injection validation | **Low** | Medium | Low |
| Stream route test coverage | **Medium** | Medium | Low |

---

*Concerns audit: 2026-02-28*
