# Codebase Concerns

**Analysis Date:** 2026-02-21

## Tech Debt

**Monolithic request handler in server entrypoint:**
- Issue: A single file mixes HTTP routing, HTML rendering, Redis client logic, request throttling, stream resolution, and telemetry handling.
- Files: `serverless.js`
- Impact: Changes in one concern can regress unrelated behavior, and debugging production failures requires scanning a large file with tightly coupled branches.
- Fix approach: Split `serverless.js` into modules for routing, Redis access, stream resolution, and admin views, then keep `module.exports` as a thin composition layer.

**Unused and stale code paths:**
- Issue: Unused symbols (`getSecondsToJerusalem0100`, `BROWSER_UA`, `NEUTRAL_ORIGIN`) remain in production code.
- Files: `serverless.js:13`, `serverless.js:14`, `serverless.js:93`
- Impact: Dead code increases cognitive load and can mislead maintainers into assuming behavior that does not exist.
- Fix approach: Remove unused constants/functions or wire them into real behavior with tests proving necessity.

**Error swallowing without observability:**
- Issue: Multiple `catch` blocks ignore exceptions and return fallback behavior without any logging.
- Files: `serverless.js:245`, `serverless.js:288`, `addon.js:97`
- Impact: Silent failures hide root causes, reduce incident diagnosability, and make flaky integration failures hard to reproduce.
- Fix approach: Log structured error metadata (request path, episode id, integration source) before returning fallback responses.

## Known Bugs

**Session limiting can be bypassed via spoofed forwarded headers:**
- Symptoms: A client can appear as arbitrary IPs by setting `x-forwarded-for`, affecting slot enforcement and quarantine attribution.
- Files: `serverless.js:57`, `serverless.js:191`, `serverless.js:203`
- Trigger: Send requests directly with forged `x-forwarded-for` headers when running behind infrastructure that does not sanitize incoming forwarding headers.
- Workaround: Not reliable in code today; mitigation depends on edge/network proxy hardening.

**Admin quarantine page can break layout or execute injected markup:**
- Symptoms: `/quarantine` renders broker error text and other event fields directly into HTML cells without escaping.
- Files: `serverless.js:305`, `serverless.js:310`, `serverless.js:328`
- Trigger: Broker/error content containing HTML or script-like payloads is stored in Redis and then rendered in the quarantine table.
- Workaround: Restrict access to `/quarantine` at edge level until server-side HTML escaping is added.

## Security Considerations

**Unauthenticated operational endpoint exposure:**
- Risk: `/quarantine` discloses IP addresses, episode identifiers, and operational error telemetry to any caller.
- Files: `serverless.js:360`, `serverless.js:317`, `serverless.js:323`
- Current mitigation: None detected in application code.
- Recommendations: Require authentication for `/quarantine` or disable the route in production and expose metrics via a protected backend channel.

**Overly permissive CORS on JSON responses:**
- Risk: `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: *` are set globally for JSON responses, broadening cross-origin access.
- Files: `serverless.js:105`, `serverless.js:108`, `serverless.js:109`
- Current mitigation: None detected in application code.
- Recommendations: Restrict allowed origins/headers to known clients and apply route-specific CORS policy.

**No explicit timeout for external fetch calls:**
- Risk: Calls to broker and Upstash REST can hang until platform/network timeout, consuming concurrent execution capacity.
- Files: `addon.js:50`, `serverless.js:30`
- Current mitigation: Generic top-level `try/catch` fallback responses.
- Recommendations: Use `AbortController` with bounded timeouts and fail-fast retry policy for idempotent reads.

## Performance Bottlenecks

**High Redis round-trip count per stream request:**
- Problem: Session gating and stream resolution use many sequential Redis requests (`ZREMRANGEBYSCORE`, `ZSCORE`, `ZCARD`, `ZADD`, `EXPIRE`, plus per-request `GET/SET`).
- Files: `serverless.js:197`, `serverless.js:200`, `serverless.js:201`, `serverless.js:213`, `serverless.js:214`, `serverless.js:234`, `serverless.js:270`
- Cause: Commands are executed as independent HTTP calls through REST API, increasing latency and variance.
- Improvement path: Batch related commands with pipeline/multi semantics and reduce duplicate reads on hot path.

**Server-side HTML construction for full quarantine table on each request:**
- Problem: The quarantine page rebuilds a full HTML table by mapping/parsing up to 50 events per request.
- Files: `serverless.js:295`, `serverless.js:301`, `serverless.js:314`
- Cause: No caching and synchronous string building in request path.
- Improvement path: Render JSON API for events and client-side view, or cache rendered output with short TTL.

## Fragile Areas

**Time-window control logic coupled to runtime locale/timezone parsing:**
- Files: `serverless.js:69`, `serverless.js:176`, `serverless.js:182`
- Why fragile: Availability behavior depends on `Intl.DateTimeFormat` parsing and manual arithmetic around reset windows.
- Safe modification: Keep pure functions for time calculations, add deterministic unit tests for boundary values (00:00, 00:59, 01:00, 07:59, 08:00 Jerusalem).
- Test coverage: No test files detected (`**/*.test.*` and `**/*.spec.*` not present in repository).

**Stream fallback behavior hides integration failures:**
- Files: `addon.js:83`, `addon.js:97`, `serverless.js:277`, `serverless.js:290`
- Why fragile: Integration errors collapse into empty streams or test video responses, masking whether broker, Redis, or parsing failed.
- Safe modification: Return machine-readable failure codes and log correlation IDs while preserving client-safe stream fallback.
- Test coverage: No automated tests detected for broker error branches.

## Scaling Limits

**Hard cap of two concurrent active sessions:**
- Current capacity: `MAX_SESSIONS = 2` globally.
- Limit: Third concurrent client is rejected with `blocked:slot_taken`, regardless of region, tenant, or endpoint criticality.
- Scaling path: Move to configurable per-environment limit with adaptive policy (per-IP + token bucket + global cap).

**Single-instance in-memory-free architecture with centralized Redis counters:**
- Current capacity: Throughput constrained by sequential Redis REST calls per request and external broker latency.
- Limit: Latency and failure amplification under burst traffic because each request depends on multiple remote operations.
- Scaling path: Reduce hot-path dependencies (cache policy, command batching, bounded retries) and separate admin/reporting endpoints from stream path.

## Dependencies at Risk

**`stremio-addon-sdk` as single critical runtime dependency:**
- Risk: Addon routing and interface behavior depend on one SDK package with no lockfile pinned in repository.
- Impact: Dependency updates can change runtime behavior unexpectedly across deployments.
- Migration plan: Commit a lockfile (`package-lock.json`) and add compatibility tests around `manifest`, `catalog`, and `stream` handlers in `addon.js`.

## Missing Critical Features

**No authentication/authorization for administrative route access:**
- Problem: Operational data endpoint is publicly accessible.
- Blocks: Safe production observability and compliance with basic privacy controls.

**No structured observability pipeline:**
- Problem: Errors are often swallowed or returned to clients without centralized logs/metrics traces.
- Blocks: Reliable incident triage, SLO monitoring, and root-cause analysis.

## Test Coverage Gaps

**Core request control and session-gating logic untested:**
- What's not tested: Time-window shutdown, slot allocation/rejection, and Redis-failure fallback behavior.
- Files: `serverless.js:171`, `serverless.js:197`, `serverless.js:203`, `serverless.js:369`
- Risk: Behavior regressions can lock users out or allow over-capacity access unnoticed.
- Priority: High

**Broker resolution and stream formatting branches untested:**
- What's not tested: JSON parse failures, non-HTTPS URL rejection, and broker error mapping to fallback streams.
- Files: `addon.js:52`, `addon.js:64`, `serverless.js:253`, `serverless.js:277`
- Risk: Integration breakages present as generic empty streams without early detection.
- Priority: High

---

*Concerns audit: 2026-02-21*
