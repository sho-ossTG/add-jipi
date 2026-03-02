# Milestones

## v1.0 Server A to D Integration (Shipped: 2026-03-03)

**Phases completed:** 6 phases, 12 plans
**Stats:** 47 commits | 57 files changed | +5,075 / -1,720 lines | ~6,940 JS LOC | 4 days (2026-02-28 → 2026-03-03)
**Requirements:** 12/15 satisfied (3 deferred to v2: PRE-3, FR-5, FR-3/metrics.js)

**Key accomplishments:**
- Created `d-client.js` — contract-documented factory with bounded-timeout resolve, error classification, and fire-and-forget side channels
- Wired `createDClient` as live resolution transport in `stream-route.js` and `addon.js` — titles now come from D's response, not filename parsing
- Implemented non-blocking UA forwarding with route-owned warn observability and dedicated `ua_forward_error` reliability counter
- Built day-scoped `GET/DELETE /operator/logs/pending` pull endpoints for operator D-consumption
- Deleted `broker-client.js` and completed D-only telemetry cutover — locked with dedicated broker-deprecation regression suite
- Wired 4 previously-untested analytics/session test files into npm gate and fixed 3 nightly rollup bugs

**Known gaps (deferred to v2):**
- PRE-3: `executeBoundedDependency` still defined locally in `redis-client.js` and inlined in `http-handler.js` (sole-definition goal not met)
- FR-5: Post-rollup `shipFailureLogs` push to D never wired in `operator-routes.js` or `request-controls.js`
- FR-3/metrics: Broker-source fallback normalization branch remains in `observability/metrics.js:58`

---

