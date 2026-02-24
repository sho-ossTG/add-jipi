# Codebase Concerns

**Analysis Date:** 2026-02-25

## Tech Debt

**Duplicate `executeBoundedDependency` implementation:**
- Issue: Two independent copies of the same retry-with-timeout wrapper exist — one in `modules/integrations/broker-client.js` (default 60s timeouts) and one in `modules/routing/http-handler.js` (default 900ms/1800ms timeouts). Logic drift is possible.
- Files: `modules/integrations/broker-client.js:27-70`, `modules/routing/http-handler.js:94-137`
- Impact: Bug fixes or policy changes must be applied to both; defaults already differ.
- Fix approach: Extract to a shared utility in `modules/integrations/` or `observability/` and import in both call sites.

**HyperLogLog unique tracking not implemented (Bug 2):**
- Issue: `uniqueId` is accepted by `trackHourlyEvent`, callers pass it, test mocks support `PFADD`, and rollup includes `uniqueEstimateTotal` placeholder — but the actual `PFADD analytics:unique:{bucket}` calls were never written.
- Files: `modules/analytics/hourly-tracker.js`
- Impact: Per-hour unique-IP counts are permanently zero; rollup reports `uniqueEstimateTotal: 0`.
- Fix approach: Add `PFADD analytics:unique:{bucket} {uniqueId}` in `trackHourlyEvent`, `PFCOUNT` in rollup, and cleanup during field deletion.

**Analytics gap in shutdown window (Bug 1):**
- Issue: The `trackPolicyEvent(["requests.total", "policy.blocked", "policy.blocked:shutdown_window"])` call is missing from the shutdown window branch. Requests blocked during the shutdown window are completely excluded from hourly analytics.
- Files: `modules/routing/request-controls.js:108-119`
- Impact: Shutdown-window traffic is invisible in analytics. Daily totals are understated.
- Fix approach: Add a `trackPolicyEvent` call in the shutdown window branch (after `runNightlyMaintenance`).

**Module-level singleton Maps in stream-route.js:**
- Issue: `inFlightStreamIntents` and `latestStreamSelectionByClient` are module-level Maps. They are never reset between requests (correct for production), but require `require.cache` manipulation in tests to isolate.
- Files: `modules/routing/stream-route.js:5-7`
- Impact: Test interference if the module is not reloaded between test suites.
- Fix approach: Consider exposing a `_resetForTest()` export, or accept the `require.cache` pattern as documented.

**`NUL` file committed to repository:**
- Issue: A Windows `NUL` device artifact is committed in the `observability/` directory (and possibly the project root).
- Files: `observability/NUL`
- Impact: Non-functional file in version control; confusing for non-Windows contributors.
- Fix approach: Remove via `git rm observability/NUL` and add `NUL` to `.gitignore`.

## Known Bugs

**Nightly rollup lock not verified before DEL (Bug — correctness):**
- Symptoms: If the rollup lock (TTL 180s) expires during a long rollup run and another process acquires it, the `finally` block's unconditional `["DEL", lockKey]` deletes the OTHER process's lock.
- Files: `modules/analytics/nightly-rollup.js:229`
- Trigger: Rollup takes longer than 180 seconds, or Redis is slow and lock TTL races.
- Fix approach: Replace `DEL lockKey` with a Lua CAS: `if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) end`.

**Silent CORS lockout when `CORS_ALLOW_ORIGINS` not configured:**
- Symptoms: All requests with an `Origin` header receive no `Access-Control-Allow-Origin` response header. Stremio clients making cross-origin requests silently fail. No error is logged.
- Files: `modules/routing/http-handler.js:215-245` (`getCorsPolicy`, `applyCors`)
- Trigger: `CORS_ALLOW_ORIGINS` env var is empty or not set (empty Set → no origins allowed).
- Fix approach: Log a structured warning at startup if `CORS_ALLOW_ORIGINS` is unset; document required value in deployment config.

**Test fixture uses stale Redis key format (Bug 5):**
- Symptoms: `createMockRedisFetch` in `tests/helpers/runtime-fixtures.js` still checks `active:url:*` (old per-IP cache key replaced by `episode:share:*` in commit 7700b50). Currently harmless because `parseEpisodeShare("1")` fails gracefully and falls through to broker resolution.
- Files: `tests/helpers/runtime-fixtures.js`
- Trigger: Any test that relies on episode share cache behavior may get incorrect mock responses.
- Fix approach: Replace `active:url:*` → null with `episode:share:*` → null in mock fetch handler.

**Test ZADD mock conflates two sorted sets (Bug 6):**
- Symptoms: `createRedisRuntime` routes all `ZADD` commands into `state.sessions`, conflating `system:active_sessions` (session gate) with `sessions:view:active` (session views). This inflates `state.sessions.size`, affecting EVAL gate logic.
- Files: `tests/helpers/runtime-fixtures.js`
- Trigger: Currently harmless because sharing tests use `MAX_SESSIONS=20`. Would surface in tests with tight session limits.
- Fix approach: Route `ZADD sessions:view:active` into a separate `state.sessionViews` map.

## Security Considerations

**Operator token auth configured correctly:**
- Status: Operator routes (`/quarantine`, `/health/details`, `/operator/*`) require `X-Operator-Token` matching `OPERATOR_TOKEN` env var.
- If `OPERATOR_TOKEN` is unset → all operator routes return 503 `operator_auth_unconfigured` (no token bypass).
- Files: `modules/policy/operator-auth.js`, `modules/routing/operator-routes.js`
- Note: `OPERATOR_TOKEN` must be set in production for any operator access.

**Proxy trust configuration is deployment-sensitive:**
- Risk: `TRUST_PROXY` env var controls IP extraction hop trust (`loopback,linklocal,uniquelocal` by default). If the actual deployment proxy chain differs, IP extraction is wrong — affecting session gate, quarantine attribution, and episode share grouping.
- Files: `modules/routing/http-handler.js:176-190`
- Current mitigation: Defaults to private address ranges only; Vercel infrastructure should match.
- Recommendation: Document required `TRUST_PROXY` value in deployment runbook.

**CORS silent lockout (see Known Bugs above):**
- Risk: Unset `CORS_ALLOW_ORIGINS` blocks all cross-origin clients silently.

## Performance Bottlenecks

**Unbounded `HGETALL` for nightly rollup:**
- Problem: `runNightlyRollup` calls `HGETALL analytics:hourly`, loading the entire analytics hash into memory. As event volume grows, this payload grows linearly.
- Files: `modules/analytics/nightly-rollup.js:151`
- Improvement path: Use cursor-based `HSCAN` to process fields in pages, or prune old hourly fields more aggressively with a TTL on the hash key.

**4 sequential Redis calls per reliability counter increment:**
- Problem: `incrementReliabilityCounter` issues `HINCRBY`, `HSETNX`, `HSET`, and `SET` as 4 separate REST calls per request. Not pipelined.
- Files: `observability/metrics.js:120-123`
- Improvement path: Batch into a single pipeline request, or use a Lua script to atomically increment and update timestamps.

**Per-request proxy trust recompilation:**
- Problem: `getTrustedProxy()` calls `proxyaddr.compile()` on every request. The compiled trust function is not memoized.
- Files: `modules/routing/http-handler.js:176-180`
- Improvement path: Memoize at module initialization (compile once at startup, not per request).

## Fragile Areas

**4 test files not wired to any test gate (Bug 4):**
- Files: `tests/analytics-hourly.test.js`, `tests/analytics-nightly-rollup.test.js`, `tests/session-view-ttl.test.js`, `tests/request-controls-nightly.test.js`
- Issue: Exist in `tests/` but are not listed in `package.json` test scripts or `observability/TEST-GATES.md`. They are never run in CI.
- Fix approach: Add to `test:gate:optional` and create named scripts (e.g., `test:analytics-hourly`). Update `TEST-GATES.md`.

**Non-atomic nightly rollup write sequence:**
- Files: `modules/analytics/nightly-rollup.js:195-220`
- Issue: The rollup writes daily summary, updates rollup meta, deletes hourly fields, and updates meta again across multiple non-atomic Redis commands. A crash between steps leaves partial state.
- Mitigation: The cleanup recovery path (lines 126-149) handles incomplete runs on the next execution, but only if the process restarts and another rollup runs for the same day.
- Safe modification: Keep the recovery logic tested; add observability for `cleanup_recovered` status.

**`require.cache` test isolation for stream-route.js Maps:**
- Files: `modules/routing/stream-route.js:5-7`, `tests/helpers/runtime-fixtures.js`
- Issue: Module-level Maps (`inFlightStreamIntents`, `latestStreamSelectionByClient`) retain state across tests if the module is not reloaded via `require.cache` deletion.
- Safe modification: Document the isolation pattern explicitly in test helpers.

## Scaling Limits

**Hard cap of 2 concurrent active sessions:**
- Current limit: `MAX_SESSIONS = 2` (configurable via env var, but no per-tenant or per-region splitting).
- Behavior: Third concurrent client is blocked with `blocked:slot_taken` regardless of episode or endpoint.
- Scaling path: Make `MAX_SESSIONS` configurable per deployment; add adaptive rotation policy.

**`analytics:hourly` hash grows unbounded without explicit TTL:**
- Current behavior: `HOURLY_ANALYTICS_TTL_SEC` env var must be set explicitly; if not set, the hash has no expiry.
- Impact: Hash grows indefinitely if nightly rollup never runs or fields aren't cleaned up.
- Fix: Ensure `HOURLY_ANALYTICS_TTL_SEC` is always set in deployment config.

## Dependencies at Risk

**`stremio-addon-sdk` — single critical runtime dependency:**
- Status: `package-lock.json` is now committed, providing version pinning.
- Residual risk: The SDK controls addon routing and manifest protocol. Upstream breaking changes require testing before upgrade.
- Mitigation: Contract tests in `tests/contract-stream.test.js` cover the stream route surface.

---

*Concerns audit: 2026-02-25*
