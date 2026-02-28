# Pitfalls Research — Server A → D Integration

**Codebase:** Server A (Stremio addon, Node.js CommonJS, Vercel serverless)
**Integration target:** Server D (not yet built)
**Researched:** 2026-02-28

---

## Critical Pitfalls

### C1: D Unreachable Silently Promotes to Success

**What goes wrong:**
If the D client's error handling isn't wired correctly into `executeBoundedDependency`, a failed D call could resolve to `undefined` rather than throwing. `stream-route.js` lines 122+ expect either a valid `{ url, title }` or a thrown error. If null resolves, `url` is undefined, HTTPS validation passes vacuously, and either a broken payload reaches Stremio or the process throws uncaught.

**Warning signs:**
- Stremio receives empty `streams: []` with no degraded notice
- `stream.degraded` hourly counter doesn't increment despite D being down
- No `quarantine:events` entries even though D is unreachable

**Prevention:**
D client must throw on every non-success path — no silent null returns. Mirror the existing broker client: throw with structured error code (`code: "dependency_timeout"`, `code: "dependency_unavailable"`) so `classifyFailure` in `observability/events.js` maps it correctly. Validate that `degradedPolicy` in `http-handler.js` has an entry for the D client source label.

**Phase:** D client interface definition — first thing that must be correct.

---

### C2: Contract Drift — A Assumes `{ url, title }`, D Ships Something Else

**What goes wrong:**
After migration, A uses `response.title` from D directly. If D's actual response is `{ streamUrl, episodeTitle }` or nested, the title field will be `undefined`. The stream payload formatter receives `undefined`, Stremio shows blank episode titles. This fails silently — no error is thrown.

**Warning signs:**
- Episode titles are blank or "undefined" in Stremio UI
- Tests pass because the stub returns expected shape, but live D doesn't
- No Redis or log entries indicate failure (response is structurally valid, just semantically wrong)

**Prevention:**
Add explicit field presence checks in the D client after receiving a response:
- Assert `typeof response.url === "string"` and `response.url.startsWith("https://")`
- Assert `typeof response.title === "string"` and `response.title.length > 0`

Throw a `validation_error` on contract violation so it surfaces in `quarantine:events`. Write validation once in the D client, not scattered across callers.

**Phase:** D client interface definition; re-verify when D ships its first endpoint.

---

### C3: Log Shipping During Shutdown Window Creates a Race With Rollup

**What goes wrong:**
Both nightly rollup and log shipping to D will run during the same shutdown window and both read `quarantine:events` from Redis. If they run concurrently, both see a partial list or one sees a list the other has already cleared. Data sent to D is not the same data that ends up in `daily:summary`. This failure is entirely silent.

**Warning signs:**
- `quarantine:events` Redis list is empty after shutdown window but D received fewer events than expected
- `daily:summary` shows 0 quarantine entries despite events being present before the window
- Both operations complete without errors

**Prevention:**
Sequence these operations — rollup first, then ship to D. Do not parallelize. Do not have log shipping mutate (pop/delete) `quarantine:events` — read non-destructively (LRANGE, not LPOP). Rollup owns cleanup of `quarantine:events`.

**Phase:** Log shipping implementation — do not start without this sequencing documented.

---

### C4: Timeout on D Stalls the Entire Request Pipeline

**What goes wrong:**
Broker client uses 60s timeout. With `MAX_SESSIONS=2`, one stuck D call occupying a session slot means 50% of capacity is unavailable. D is unproven — it may be slow or degraded during early rollout.

**Warning signs:**
- Session gate starts returning `blocked:slot_taken` during periods when D is slow
- Vercel function timeout logs appear
- Redis `system:active_sessions` has entries with timestamps far in the past not rotating

**Prevention:**
D client must use much shorter timeouts than broker: 3–5s maximum for first attempt, no more than 8–10s total budget. Wire through same `executeBoundedDependency` pattern but with tighter parameters. Degradation path already works — reach it quickly, not after 60 seconds.

**Phase:** D client interface definition. Timeout values must be part of the interface spec.

---

### C5: User-Agent Forwarding Failing Silently Is Invisible

**What goes wrong:**
If UA forwarding uses a bare empty catch (`try { ... } catch { }`), a misconfigured D endpoint produces zero signal. Operators have no way to know UA data stopped flowing to D.

**Warning signs:**
- D's UA storage shows no records, no errors in A
- `quarantine:events` has no D-related entries
- Hourly analytics in A look normal

**Prevention:**
UA forwarding must not use a bare empty catch. Emit a `warn`-level log entry on failure, or increment a dedicated reliability counter (`ua_forward_error`) visible in `/operator/metrics`. Data loss is acceptable (fire-and-forget), but the failure must be observable.

**Phase:** UA forwarding implementation.

---

## Common Mistakes

### M1: Replacing broker-client.js Instead of Creating a New Module

Create `modules/integrations/d-client.js` as a new module with an explicit interface. Do not delete or repurpose `broker-client.js` until D is confirmed live. Keep it as the reference implementation and use the existing dependency injection chain to swap resolvers.

### M2: Forgetting That `resolveEpisode` Is Injected, Not Called Directly

`stream-route.js` receives `resolveEpisode` as an injected dependency — it's wired in `http-handler.js` lines 369–385 and passed down. Audit every place `resolveEpisode` is assigned. Tests that cover stream resolution must inject a D-shaped response stub, not a broker-shaped one.

### M3: Leaving Title Extraction Code as a Fallback

Remove the filename extraction code at the same time as adding `response.title` consumption. Do not leave it as a fallback. If D doesn't return a title, that's a contract violation (C2) and should throw, not silently fall back to filename parsing.

### M4: Not Validating D Client Config at Startup

D client configuration must be validated at handler initialization time, not on first request. Mirror how `redis-client.js` validates env vars (throws "Missing Redis configuration"). Add D's config vars to the startup validation path.

### M5: Writing Tests Against the Stub Shape and Forgetting to Retest Against D's Actual Shape

Write a dedicated integration test file (skippable with `D_INTEGRATION_TESTS=1`) that exercises the D client against a real or mock HTTP server. Tag it clearly: "must run before removing D stub." The skipped test is a forcing function — it cannot be deleted without intention.

---

## Regression Risks

### R1: Degradation Policy — Source Label Change

`DEGRADED_STREAM_POLICY` maps `(source, cause)` tuples to response modes. If D client uses a different source label than `"broker"`, the policy map won't find a match. **Test:** Send a request when D is unreachable. Verify Stremio receives a valid degraded payload, not a 500.

### R2: Session Gate Timing — D Timeout Must Not Outlive Session Slot

If a D call takes longer than `inactivityLimitSec`, the session may expire during resolution. **Test:** Simulate a D call exceeding `inactivityLimitSec`. Verify Redis session state is consistent.

### R3: `inFlightStreamIntents` Deduplication — Key Must Match New Resolution Path

If D client introduces any key transformation, the deduplication map key may not match across concurrent requests. **Test:** Send two simultaneous requests for the same episode. Verify only one D call is made.

### R4: Time Window — Must Not Be Delayed by D Client Code

`runNightlyMaintenance()` runs when the first request arrives during shutdown window. D client or log shipping code must not delay its return. **Test:** Simulate a request during shutdown window with slow D. Verify response is still `blocked:shutdown_window`.

### R5: Hourly Analytics — Existing Field Names Must Not Change

`trackHourlyEvent` writes `stream.requests`, `stream.success`, `stream.degraded`. Rollup and analytics endpoints read these exact field names. **Test:** After integration, query `/operator/analytics`. Verify all existing counters increment correctly.

### R6: Four Unwired Tests Cover Integration-Adjacent Paths

CONCERNS.md Bug 4: these tests never run in CI:
- `tests/analytics-hourly.test.js`
- `tests/analytics-nightly-rollup.test.js`
- `tests/session-view-ttl.test.js`
- `tests/request-controls-nightly.test.js`

Wire these tests **before** integration begins — they are the regression net for exactly the paths this work modifies.

---

## Testing Gaps

### T1: D Unavailability Cannot Be Tested Against a Real D

Requires test fixtures that simulate: hanging HTTP server (timeout), 500/connection refused (error classification), malformed response (contract validation). D client must be designed so these failure modes can be injected in tests.

**Gap:** D client test file must be created as part of the interface definition phase, not deferred.

### T2: Log Shipping Race Condition Is Not Unit-Testable in Isolation

The rollup vs log shipping race requires integration-level testing with concurrent operation and mock Redis recording read order. This is hard to reproduce deterministically.

**Gap:** Sequencing must be enforced by code structure, not by test. Document and make it reviewable.

### T3: Stremio Protocol Compliance Cannot Be Tested Without a Stremio Client

**Gap:** Add schema validation test for the stream payload that checks exact Stremio-required fields (`url`, `title`, `name`, metadata) via JSON schema assertion against `modules/presentation/stream-payloads.js` output.

### T4: UA Forwarding Cannot Confirm D Storage Without D Running

Tests can confirm A made the call with correct UA, but cannot confirm D stored it. This is acceptable during stub phase.

**Gap:** Document as explicit manual verification step required before removing the stub.

### T5: Nightly Rollup Bugs Will Contaminate Log Shipping Tests

CONCERNS.md documents Bug 1 (analytics gap in shutdown window), Bug 2 (HyperLogLog unimplemented), Bug 3 (daily rollup unique count always zero). These exist in code paths log shipping will touch.

**Gap:** Fix Bug 1, Bug 2, Bug 3 before writing log shipping tests. Do not write tests against known-broken behavior.

---

*Pitfalls research: 2026-02-28*
