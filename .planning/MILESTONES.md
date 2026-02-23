# Project Milestones: add-jipi

## v1.0.1 Trial Analytics Patch (Shipped: 2026-02-23)

**Delivered:** Stream-path analytics/session controls with deterministic nightly rollup and secured operator visibility, without changing stream-only gating behavior.

**Phases completed:** 7-7 (7 plans total)

**Key accomplishments:**
- Added temporary session snapshots with TTL-backed active-session indexing for operator diagnostics.
- Added ultra-light hourly analytics tracking (`HINCRBY`/`EXPIRE` + optional `PFADD`) on policy and stream outcomes.
- Added permanent single-key daily summary storage and lock-protected idempotent nightly rollup with hourly cleanup.
- Added operator endpoints for analytics visibility and manual nightly rollup trigger.
- Added patch-focused tests plus updated security-boundary contracts while keeping required/optional gates green.

**Stats:**
- 12 files changed
- 998 insertions, 14 deletions
- 1 phase, 7 plans, 22 tasks
- 1 day from patch start to ship

**Git range:** `d709cd3` -> `826afe3`

**What's next:** Start v1.1 milestone scoping with fresh requirements via `/gsd-new-milestone`.

---

## v1.0 MVP Hardening (Shipped: 2026-02-22)

**Delivered:** Contract-safe, security-hardened, reliability-bounded, observable, modularized addon runtime with audit debt captured and resolved for shipment readiness.

**Phases completed:** 1-6 (18 plans total)

**Key accomplishments:**
- Hardened manifest/catalog/stream contract compatibility and added executable handler-level contract suites.
- Locked operator-only diagnostics access, trusted client attribution, sanitized public diagnostics, and explicit CORS allowlist behavior.
- Added atomic Redis admission control and bounded broker execution with deterministic degraded/fallback response mapping.
- Added correlation-aware observability, bounded reliability metrics, and shared diagnostics projection contracts.
- Modularized routing/policy/integration/presentation boundaries and added deterministic policy + failure-branch required gate tests.
- Converted remaining milestone audit debt into explicit manual runbooks and clarified `modules/index.js` as maintainer-only manifest metadata.

**Stats:**
- 90 files changed
- 11,544 insertions, 513 deletions
- 6 phases, 18 plans, 41 tasks
- 2 days from start to ship

**Git range:** `cc4759b` -> `33323e9`

**Verification note:** Integration/network verification requiring authenticated HTTP calls is deferred to manual runbooks and external tester execution.

**What's next:** Define v1.1 scope with fresh requirements and roadmap via `/gsd-new-milestone`.

---
