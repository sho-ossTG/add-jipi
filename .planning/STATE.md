---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Server A v2
current_phase: none
status: planning
last_updated: "2026-03-03T00:00:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

**Project:** Server A — add-jipi
**Initialized:** 2026-02-28
**Milestone archived:** v1.0 (shipped 2026-03-03)

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-03)

**Core value:** Users get a stream link with the correct episode title — A delegates all lookup to D.
**Current focus:** Planning v2.0 — carry-forward gap closure (PRE-3, FR-5, FR-3/metrics) + next features

## Status

- [x] v1.0 milestone shipped and archived
- [x] ROADMAP.md reorganized with milestone grouping
- [x] PROJECT.md evolved (validated requirements moved, active v2 items listed)
- [x] RETROSPECTIVE.md written
- [ ] v2.0 requirements defined (`/gsd:new-milestone`)

## Next Action

Start v2.0 milestone: `/gsd:new-milestone`

## Decisions

- Use explicit `npm run` orchestration in `test:gate:required` so prerequisite test inclusion and ordering are auditable.
- [Phase 00]: Nightly uniqueEstimateTotal now derives from requests.total HyperLogLog counts while preserving gate semantics.
- [Phase 00]: Shutdown-window blocked requests run best-effort analytics tracking to maintain rollup continuity.
- [Phase 00]: Keep redis timeout/retry defaults by wrapping the shared helper with redis-specific default values.
- [Phase 00]: Preserve broker and redis exported helper API surface while migrating internals to shared implementation.
- [Phase 01-d-client-interface-stub]: Map non-timeout D transport failures to dependency_unavailable for stable degradation semantics.
- [Phase 01-d-client-interface-stub]: Keep UA/log side channels fire-and-forget with silent failure handling in Phase 1.
- [Phase 02]: Kept injected.brokerClient duck-typed resolver branch intact to preserve existing seam compatibility while swapping auto-created transport to D.
- [Phase 02]: Updated source literals to d only within stream-route while leaving dependency broker and http-handler policy labels untouched for deferred Phase 5 cleanup.
- [Phase 02]: Treat validation_error as an explicit degraded-stream contract case in stream failure tests.
- [Phase 02]: Reliability transport tests should enforce D payload/env assumptions and reject broker-shaped links-array expectations.
- [Phase 03]: Kept d-client fire-and-forget silent catch semantics but added optional onFailure callback so routing can observe failures without integration-layer logger coupling.
- [Phase 03]: Wired ua_forward_error as a dedicated stats key via injected callback from http-handler instead of reusing stats:broker_error.
- [Phase 03]: Assert non-blocking UA behavior with unresolved /api/ua promise and timeout race in stream contracts.
- [Phase 03]: Capture ua_forward_failed warnings through test logger injection to lock route-level observability semantics.
- [Phase 04]: Keep pull endpoint auth under existing operator boundary and lock unauthorized/authorized behavior in tests.
- [Phase 04]: Enforce strict invalid_day and dependency_unavailable contracts before runtime implementation.
- [Phase 04-nightly-log-shipping]: Keep /operator/logs/pending inside handleOperatorRoute with existing operator token auth.
- [Phase 04-nightly-log-shipping]: Use LRANGE snapshot plus per-entry LREM for day-scoped pending-log acknowledgment deletes.
- [Phase 04-nightly-log-shipping]: Enforce strict invalid_day and dependency_unavailable contracts with route-level read/delete audit logging.
- [Phase 05]: Applied a clean-cut rename from stats:broker_error to stats:d_error with no migration shim.
- [Phase 05]: Removed injected brokerClient seam and enforced d as the only runtime dependency label.
- [Phase 05]: Added dedicated broker-deprecation contract suite/script to enforce artifact, seam, and D-taxonomy invariants.
- [Phase 05]: Used grep-tool verification fallback because rg was unavailable in this executor environment.
- [Phase 05]: Removed residual stats:broker_error contract assertion to keep active test/runtime references D-only.
- [Phase 05]: Deferred remaining broker-source normalization fallback cleanup in `observability/metrics.js` to milestone v2.
- [v1.0 audit]: Deferred PRE-3 (executeBoundedDependency sole-definition gap in redis-client.js and http-handler.js) to v2.
- [v1.0 audit]: Deferred FR-5 (post-rollup shipFailureLogs push wiring in operator-routes.js and request-controls.js) to v2. Phase 4 delivered pull endpoints only.
- [v1.0 audit]: All three gaps accepted; milestone v1.0 closed as tech_debt.
