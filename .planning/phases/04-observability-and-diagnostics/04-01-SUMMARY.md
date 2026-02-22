---
phase: 04-observability-and-diagnostics
plan: 01
subsystem: api
tags: [observability, telemetry, correlation-id, pino, contract-tests]
requires:
  - phase: 03-stream-reliability-controls
    provides: deterministic degraded mapping and latest-request-wins stream reliability controls
provides:
  - Request-scoped AsyncLocalStorage correlation IDs with response header propagation
  - Canonical structured telemetry taxonomy for request/policy/dependency/completion events
  - Deterministic failure source classification across broker, redis, validation, and policy
  - Observability contract tests locking correlation propagation and source normalization
affects: [phase-04-02-operator-diagnostics, telemetry-queries, incident-debugging]
tech-stack:
  added: [pino]
  patterns:
    - "Emit canonical event fields (event/category/source/cause/correlationId) at handler boundary"
    - "Classify reliability failures through shared observability taxonomy helpers"
key-files:
  created:
    - observability/context.js
    - observability/logger.js
    - observability/events.js
    - tests/contract-observability.test.js
  modified:
    - serverless.js
    - package.json
key-decisions:
  - "Wrap all requests in AsyncLocalStorage context and set X-Correlation-Id on responses for end-to-end traceability."
  - "Centralize source/cause classification in observability/events.js to prevent route-level telemetry drift."
  - "Keep degraded payload behavior unchanged while enriching operator telemetry with canonical taxonomy fields."
patterns-established:
  - "Use emitTelemetry helpers in request lifecycle and dependency boundaries, not ad-hoc log strings"
  - "Normalize unknown source labels to canonical taxonomy values before emission"
requirements-completed: [OBSV-01, OBSV-02]
duration: 6 min
completed: 2026-02-22
---

# Phase 4 Plan 1: Correlated Telemetry Foundation Summary

**Request-scoped correlation IDs, canonical structured telemetry taxonomy, and observability contract coverage now let operators trace and classify stream-path failures deterministically.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-22T10:23:20Z
- **Completed:** 2026-02-22T10:29:16Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Added dedicated observability primitives for request context, logger bindings/redaction, and canonical telemetry taxonomy helpers.
- Instrumented `serverless.js` request lifecycle and dependency/policy branches to emit correlated structured request, policy, dependency, degraded, and completion events.
- Added observability contract tests asserting shared correlation IDs per request, deterministic broker/redis/validation/policy source classification, and normalization of unknown source values.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create request context and structured telemetry primitives** - `a100dde` (feat)
2. **Task 2: Instrument server request lifecycle with correlated taxonomy events** - `a3de604` (feat)
3. **Task 3: Add observability contract tests for correlation and source taxonomy** - `9d8c042` (test)

**Plan metadata:** Recorded in a follow-up docs commit for planning artifacts.

## Files Created/Modified
- `observability/context.js` - AsyncLocalStorage correlation context with passthrough-or-generate behavior and response header binding.
- `observability/logger.js` - Structured logger abstraction with correlation bindings, sensitive-field redaction config, and test logger overrides.
- `observability/events.js` - Canonical event taxonomy and deterministic failure/source normalization helpers.
- `serverless.js` - Request-context wrapping, correlation response header propagation, and structured lifecycle/policy/dependency telemetry emission.
- `tests/contract-observability.test.js` - Contract assertions for correlation propagation and taxonomy classification guarantees.
- `package.json` - Added `test:contract:observability` script and `pino` runtime dependency.

## Decisions Made
- Emit observability events from canonical helpers only (`observability/events.js`) so route code does not invent new taxonomy fields.
- Keep stream/public API payloads unchanged (except `X-Correlation-Id` response header) and confine observability to structured telemetry fields.
- Bind correlation IDs at request ingress and reuse that ID across policy/dependency/degraded/completion events.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unknown-source normalization being overwritten in built telemetry events**
- **Found during:** Task 3 (observability contract tests)
- **Issue:** `buildEvent()` merged payload after canonical fields, allowing non-canonical `source` values to overwrite normalized taxonomy output.
- **Fix:** Changed merge order so canonical `event/category/source/cause/correlationId` always win after payload expansion.
- **Files modified:** `observability/events.js`
- **Verification:** `LOG_LEVEL=error npm run test:contract:observability`
- **Committed in:** `9d8c042`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was required to enforce deterministic source taxonomy and satisfy observability contract guarantees.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Correlated telemetry and deterministic source classification are now contract-locked at the request handler boundary.
- Ready for `04-02-PLAN.md` to expose operator-safe aggregated diagnostics and metrics over the new taxonomy.

---
*Phase: 04-observability-and-diagnostics*
*Completed: 2026-02-22*
