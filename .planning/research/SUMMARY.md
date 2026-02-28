# Research Summary — Server A → D Integration

**Synthesized:** 2026-02-28
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Overall Confidence:** HIGH (based on direct codebase analysis, not external references)

---

## Key Findings

**1. Zero new dependencies required.**
Every pattern needed already exists in the codebase. `executeBoundedDependency`, jitter-backoff retry, Redis optional-availability (env-var stub mode), fire-and-forget side channels — all of these are live in `broker-client.js` and `redis-client.js`. The D client is a clone-and-adapt, not a greenfield build.

**2. The integration is a single seam swap, not a refactor.**
D client plugs into one injection point: `resolveEpisodeResolver` in `stream-route.js`. The calling contract (`resolveEpisode(episodeId)` → `{ url, title }`) does not change. The rest of the request pipeline — policy gates, session management, analytics, degraded stream policy — is untouched.

**3. Four tests that must pass are currently not wired in CI.**
PITFALLS.md R6 / CONCERNS.md Bug 4: `analytics-hourly`, `analytics-nightly-rollup`, `session-view-ttl`, and `request-controls-nightly` test files exist but never run. These cover exactly the paths this integration modifies. They must be wired before integration begins.

**4. Three existing bugs in the rollup path must be fixed before log shipping is built.**
CONCERNS.md Bug 1 (analytics gap in shutdown window), Bug 2 (HyperLogLog unimplemented), Bug 3 (daily rollup unique count always zero) all live in `nightly-rollup.js` — the same path log shipping will touch. Writing log shipping tests against broken code will produce false confidence.

**5. The HTTP contract between A and D does not yet exist.**
`POST /api/resolve`, `POST /api/ua`, and `POST /api/logs` are proposed shapes documented in ARCHITECTURE.md and FEATURES.md. They are not yet agreed with the D team. Nothing can be wired until this contract is signed off.

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP client | Native `fetch` | Already in use; no new deps |
| Retry/timeout | `executeBoundedDependency` (shared) | Duplicated across broker/redis — extract before adding third copy |
| Stub mode | `D_BASE_URL` unset → structured error | Mirrors Redis optional-availability pattern exactly |
| UA forwarding | Fire-and-forget, no await, no retry | UA is low-value; retrying adds complexity for no gain |
| Log ship trigger | `POST /operator/ship/logs` via Vercel Cron | No process exit hooks in serverless; route + cron is the only viable pattern |
| D client timeouts | 3–5s attempt / 8–10s total | D is local infra, not external; 60s broker timeouts are dangerous with `MAX_SESSIONS=2` |

**Do not use:** axios/got/node-fetch, p-retry/async-retry, external scheduler services, process exit hooks.

---

## Architecture Approach

The D client (`modules/integrations/d-client.js`) is a new factory module exposing three functions:
- `resolveEpisode(episodeId)` — replaces the broker-client call; same injection point
- `forwardUserAgent(userAgent, episodeId)` — fire-and-forget side channel
- `shipFailureLogs(events)` — fire-and-forget nightly side channel

**Files that change:**
- `modules/integrations/d-client.js` — new
- `addon.js` — swap import + instantiation
- `modules/routing/stream-route.js` — swap resolver; remove title extraction; add UA forward call
- `modules/routing/operator-routes.js` — add log ship trigger
- `modules/routing/http-handler.js` — pass `D_BASE_URL` into dependency builder

**Files that do not change:** all policy, session, analytics, and operator auth modules.

`broker-client.js` is kept as reference until D is confirmed live in production, then deleted.

**Boundary rule:** A must never call B or C directly. All resolution flows through D's `/api/resolve`. Any code that inspects broker URLs or parses filenames is dead code to be removed.

---

## Critical Constraints

1. **D client must throw on every non-success path.** Silent null returns cause vacuous HTTPS validation passes and broken Stremio payloads with no error surfacing. No silent null returns anywhere in the D client.

2. **Log shipping must run after rollup, not concurrently.** Both operations touch `quarantine:events`. Log shipping reads non-destructively (LRANGE, not LPOP). Rollup owns the cleanup. This ordering must be enforced by code structure, not tests.

3. **D source label must match `DEGRADED_STREAM_POLICY` map keys.** If the D client uses a different source label than `"broker"`, the policy map won't find a match and degraded requests will 500 instead of returning a valid degraded payload. Use `"broker"` for now; update to `"d"` in a future milestone.

4. **Contract must be defined and agreed before wiring.** A uses `response.title` and `response.url` verbatim. If D ships a different shape, titles are silently blank and no error is thrown. The contract is the prerequisite for all other phases.

5. **Vercel serverless has no process exit hooks.** Any shutdown-triggered work must be route-based and externally triggered (Vercel Cron or equivalent). This is not negotiable on the platform.

---

## Top Risks

**C1 — D failure silently promotes to success.**
If error handling in the D client isn't correctly wired, a failed D call resolves to `undefined` instead of throwing. The HTTPS validation passes vacuously, the degraded path is never reached, no quarantine event is written, and Stremio gets a broken payload. Mitigation: throw on all non-success paths; unit test each error class (timeout, 404, 503, malformed response).

**C3 — Race condition between nightly rollup and log shipping.**
Both operations run in the same shutdown window and both read `quarantine:events`. Concurrent reads produce split or missing data, with no error thrown by either operation. Mitigation: enforce sequential execution (rollup first, ship second); log shipping reads non-destructively and does not clear the list.

**C4 — D timeout stalls the entire request pipeline.**
With `MAX_SESSIONS=2`, one 60s-timeout D call blocks 50% of capacity. During early D rollout, D may be slow or degraded. Mitigation: set D timeouts to 3–5s attempt / 8–10s total — tight enough to reach the degradation path quickly.

---

## Recommended Phase Order

**Phase 0: Prerequisites (before integration code is written)**
- Wire the 4 unwired CI test files (R6)
- Fix nightly rollup Bug 1, Bug 2, Bug 3 (T5)
- Define and agree the D HTTP contract with the D team
- Rationale: without these, integration will be built on a broken foundation and the regression net will have holes

**Phase 1: D Client Module — stub-first**
- Extract `executeBoundedDependency` to shared module
- Build `d-client.js` with stub mode; all three functions no-op when `D_BASE_URL` unset
- Write contract tests for stub behavior and all error classes (C1, C2 mitigation)
- Nothing in the request path changes yet; safe to deploy

**Phase 2: Wire resolveEpisode into resolution path**
- Update `resolveEpisodeResolver` in `stream-route.js` to fall through to `createDClient`
- Update `addon.js` import/instantiation
- Remove title extraction (`cleanTitle`, `resolveBrokerFilename`) — no fallback (M3)
- Update stream contract tests to inject D-shaped stubs
- Verify degraded path still works with D source label (R1)

**Phase 3: UA Forwarding**
- Add fire-and-forget `forwardUserAgent` call in `stream-route.js` success branch
- Emit `warn`-level log on failure — not a bare empty catch (C5)
- Confirm it never propagates errors into critical path

**Phase 4: Nightly Log Shipping**
- Add `shipFailureLogs` trigger in `operator-routes.js`, sequenced after rollup (C3)
- Log shipping reads non-destructively; rollup owns cleanup
- Test that shipping failure does not block rollup response
- Add `failuresShipped` count to rollup response body

**Phase 5: Broker Client Deprecation**
- After D is live and stable in production: remove all `broker-client.js` references
- Delete `broker-client.js`
- Update telemetry source label from `"broker"` to `"d"` in `observability/events.js`

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Based on direct codebase read; zero unknowns on A's side |
| Features | HIGH | Scope is clear; anti-features explicitly documented |
| Architecture | HIGH | Integration seam is well-defined; one injection point |
| Pitfalls | HIGH | Based on codebase analysis of real existing bugs |
| D contract | LOW | Contract is proposed, not agreed — biggest remaining unknown |
| Vercel Cron config | MEDIUM | Pattern is sound; exact `vercel.json` syntax needs verification at implementation |

**Gaps requiring attention during planning:**
- D HTTP contract must be agreed before Phase 1 ends (blocks Phase 2)
- D's actual response shape must be validated against stub shape before removing the stub (T4)
- Vercel Cron tier availability and syntax (verify at Phase 4)
- Whether stub mode falls back to direct broker call or returns degraded (STACK.md open question — recommend degraded, not fallback, to enforce boundary)
