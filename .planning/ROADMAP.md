# Roadmap: add-jipi

## Overview

This roadmap hardens the existing addon without breaking Stremio compatibility, moving from stable contract behavior to secure boundaries, reliable dependency handling, diagnosable operations, and maintainable modular code with deterministic test coverage.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Contract Compatibility Baseline** - Preserve manifest, catalog, and stream contract behavior for supported episodes.
- [x] **Phase 2: Security Boundary Hardening** - Restrict operational surfaces and enforce trusted request identity.
- [x] **Phase 3: Stream Reliability Controls** - Make stream-path dependency and policy behavior deterministic under failure and load. (completed 2026-02-22)
- [x] **Phase 4: Observability and Diagnostics** - Make degraded behavior traceable and measurable without exposing sensitive internals. (completed 2026-02-22)
- [ ] **Phase 5: Modularization and Test Governance** - Split core concerns into maintainable modules with reliable automated validation.

## Phase Details

### Phase 1: Contract Compatibility Baseline
**Goal**: Users can install and use the addon with protocol-valid manifest, catalog, and stream responses for supported episodes.
**Depends on**: Nothing (first phase)
**Requirements**: CONT-01, CONT-02, CONT-03
**Success Criteria** (what must be TRUE):
  1. User can install the addon in Stremio and receive a valid `manifest.json` response.
  2. User can browse the addon catalog and receive valid payloads for supported content.
  3. User requesting a supported episode receives a protocol-valid stream response that plays in client flow.
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Harden manifest/catalog compatibility and add automated contract checks.
- [x] 01-02-PLAN.md — Harden stream contract behavior and verify Stremio client flow.

### Phase 2: Security Boundary Hardening
**Goal**: Operational and admin capabilities are only available to authorized operators, with trusted client attribution and minimal exposure.
**Depends on**: Phase 1
**Requirements**: SECU-01, SECU-02, SECU-03, SECU-04
**Success Criteria** (what must be TRUE):
  1. Unauthorized requests to diagnostics/admin routes are denied, while authorized operators can access them.
  2. Request handling uses trusted client identity sources so spoofed forwarded headers do not alter attribution.
  3. Public-facing diagnostic responses never expose raw IPs or internal error details.
  4. Browser requests are accepted only from explicitly allowed origins and headers.
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Add operator auth gating, trusted client attribution, and diagnostics/public redaction with security contract tests.
- [x] 02-02-PLAN.md — Enforce explicit CORS allowlist and preflight behavior with CORS contract tests.

### Phase 3: Stream Reliability Controls
**Goal**: Stream resolution remains deterministic and protocol-safe under concurrency and dependency degradation.
**Depends on**: Phase 2
**Requirements**: RELY-01, RELY-02, RELY-03
**Success Criteria** (what must be TRUE):
  1. Concurrent stream requests enforce capacity/session policy atomically without inconsistent admission outcomes.
  2. Stream-path dependency calls complete within bounded time (timeouts/retry limits) rather than hanging requests.
  3. When broker or Redis fails, users still receive deterministic protocol-safe fallback behavior.
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Implement atomic concurrency gating and bounded dependency execution with reliability contract tests.
- [x] 03-02-PLAN.md — Enforce deterministic degraded response mapping and latest-request-wins reliability behavior.

### Phase 4: Observability and Diagnostics
**Goal**: Operators can quickly diagnose failed or degraded behavior through correlated, structured, and safely exposed telemetry.
**Depends on**: Phase 3
**Requirements**: OBSV-01, OBSV-02, OBSV-03
**Success Criteria** (what must be TRUE):
  1. Operators can follow a failing request path end-to-end with a correlation ID across request, policy, and dependency events.
  2. Operational telemetry clearly classifies failures by source (broker, Redis, validation, policy).
  3. Operators can query health and key reliability metrics without seeing sensitive internals.
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Add request-scoped correlation telemetry and canonical failure taxonomy with observability contracts.
- [x] 04-02-PLAN.md — Expose operator-safe health/metrics diagnostics with redaction and auth-boundary contracts.
- [x] 04-03-PLAN.md — Close diagnostics projection wiring gap for `/health/details` and lock projector-aligned health contract tests.

### Phase 5: Modularization and Test Governance
**Goal**: Maintainers can change core backend concerns safely with modular boundaries and deterministic test coverage.
**Depends on**: Phase 4
**Requirements**: MAINT-01, MAINT-02, MAINT-03
**Success Criteria** (what must be TRUE):
  1. Maintainer can update routing, policy, integrations, and presentation code in separate modules with clear boundaries.
  2. Maintainer can run automated tests that validate stream contract behavior and failure branches before deployment.
  3. Maintainer can run deterministic tests that reproduce time-window and session-gating policy behavior.
**Plans**: 6 plans

Plans:
- [x] 05-01-PLAN.md — Scaffold boundary policy/integration modules and document import-direction rules.
- [ ] 05-02-PLAN.md — Scaffold routing/presentation module roots and publish module export map.
- [ ] 05-03-PLAN.md — Rewire request-controls through modular policy/integration boundaries.
- [ ] 05-04-PLAN.md — Rewire stream orchestration/presentation with thin entrypoint composition.
- [ ] 05-05-PLAN.md — Modularize operator/public routing and presentation and finalize boundary examples.
- [ ] 05-06-PLAN.md — Add deterministic policy tests and required pre-deploy contract/failure test gates.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contract Compatibility Baseline | 2/2 | Complete    | 2026-02-21 |
| 2. Security Boundary Hardening | 2/2 | Complete    | 2026-02-22 |
| 3. Stream Reliability Controls | 2/2 | Complete    | 2026-02-22 |
| 4. Observability and Diagnostics | 3/3 | Complete    | 2026-02-22 |
| 5. Modularization and Test Governance | 1/6 | In progress | - |
